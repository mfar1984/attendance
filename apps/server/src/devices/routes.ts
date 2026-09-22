import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  DEVICE_LIMITS,
  DeviceProtocol,
  DeviceVendor,
  VENDOR_PROTOCOLS,
  defaultProtocolFor,
  isProtocolFor,
  usesStoredCredentials,
} from '@attendance/shared';

import { requirePermission } from '../auth/plugin.js';
import { encryptSecret } from '../crypto.js';
import { db, jsonSafe } from '../db.js';
import { loadEnv } from '../env.js';
import { badRequest, conflict, forUpdate, notFound, parseBody } from '../http.js';
import { syncDevice } from '../sync/worker.js';
import { checkAllDevices, checkDevice } from './health.js';
import { clientFor, driverFor, releaseClient } from './registry.js';

const deviceInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /**
   * Manufacturer, and the protocol to speak to it with.
   *
   * Two fields rather than one because a manufacturer can ship several transports that are
   * not interchangeable. ZKTeco alone has TA Push, AC Push, BEST and a legacy binary
   * protocol, and a SenseFace 3A supports a different subset than an older unit — so
   * collapsing them would mean a vendor choice silently deciding a protocol the hardware may
   * not speak.
   */
  vendor: z.enum([DeviceVendor.hikvision, DeviceVendor.zkteco, DeviceVendor.dahua]),
  protocol: z
    .enum([DeviceProtocol.isapi, DeviceProtocol.taPush, DeviceProtocol.dahuaCgi])
    .optional(),
  host: z.string().trim().min(1).max(190),
  port: z.coerce.number().int().min(1).max(65535).default(443),
  useHttps: z.boolean().default(true),
  verifyTls: z.boolean().default(false),
  /**
   * Credentials, required only for a protocol that authenticates with them.
   *
   * Optional here and checked against the protocol below, rather than always required. A
   * callback protocol has no credential to give: TA Push identifies a unit by its serial
   * number, so demanding a password would mean inventing one and then showing a screen that
   * claims it protects something.
   */
  username: z.string().trim().min(1).max(64).optional(),
  password: z.string().min(1).optional(),
  locationId: z.number().int().positive().optional(),
  doorNo: z.coerce.number().int().min(1).default(1),
  /**
   * Whether the scheduled health sweep and the roster push consider this terminal.
   *
   * The column has existed since the first migration with nothing able to write it, so a
   * unit taken off the wall stayed in every sweep and reported offline forever — which is
   * indistinguishable from one that broke this morning, and that is the alert nobody can
   * afford to learn to ignore.
   */
  active: z.boolean().default(true),
});

/**
 * Resolves and checks the vendor/protocol pair.
 *
 * Kept as a function rather than a `superRefine` on the schema because `forUpdate` strips the
 * schema down to optional fields for the PATCH path, and a refinement written for the create
 * shape would then see an absent vendor and reject every partial edit.
 */
function resolveProtocol(vendor: DeviceVendor, protocol: string | undefined): DeviceProtocol {
  if (protocol === undefined) return defaultProtocolFor(vendor);

  if (!isProtocolFor(vendor, protocol)) {
    throw badRequest(
      `Protokol "${protocol}" tidak sah untuk ${vendor}. Pilihan: ` +
        VENDOR_PROTOCOLS[vendor].join(', '),
      'protocol',
    );
  }
  return protocol as DeviceProtocol;
}

/**
 * Refuses a terminal that cannot be reached with what was supplied.
 *
 * Checked before the row is written, because a device record with no usable credentials is one
 * that appears in the list, joins the health sweep, and reports offline forever — which is
 * indistinguishable from hardware that broke, and that is the alert nobody can afford to learn
 * to ignore.
 */
function assertCredentialsMatchProtocol(
  protocol: DeviceProtocol,
  credentials: { username?: string | undefined; password?: string | undefined },
  { passwordAlreadyStored = false }: { passwordAlreadyStored?: boolean } = {},
): void {
  if (!usesStoredCredentials(protocol)) return;

  if (credentials.username === undefined || credentials.username === '') {
    throw badRequest(
      `Protokol "${protocol}" memerlukan nama pengguna peranti.`,
      'username',
    );
  }
  if (!passwordAlreadyStored && (credentials.password === undefined || credentials.password === '')) {
    throw badRequest(`Protokol "${protocol}" memerlukan kata laluan peranti.`, 'password');
  }
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/devices',
    { preHandler: requirePermission('settings.devices', 'view') },
    async () => {
      const devices = await db().device.findMany({
        orderBy: { name: 'asc' },
        include: {
          location: { select: { id: true, name: true } },
          syncState: true,
          _count: { select: { enrolments: true } },
        },
      });

      // The stored password is never returned, not even encrypted: nothing in the
      // UI needs it, and an endpoint that emits it becomes the weak point.
      return jsonSafe(
        devices.map(({ passwordEncrypted: _omitted, ...device }) => ({
          ...device,
          enrolled: device._count.enrolments,
        })),
      );
    },
  );

  app.post(
    '/api/devices',
    { preHandler: requirePermission('settings.devices', 'create') },
    async (request) => {
      const body = parseBody(deviceInputSchema, request.body);

      const clash = await db().device.findFirst({ where: { host: body.host, port: body.port } });
      if (clash) throw conflict(`Peranti lain sudah menggunakan ${body.host}:${body.port}`);

      const protocol = resolveProtocol(body.vendor, body.protocol);
      assertCredentialsMatchProtocol(protocol, body);

      const device = await db().device.create({
        data: {
          name: body.name,
          vendor: body.vendor,
          protocol,
          host: body.host,
          port: body.port,
          useHttps: body.useHttps,
          verifyTls: body.verifyTls,
          /**
           * Null rather than an empty string for a protocol with no credentials.
           *
           * Null is a state the schema describes — "this protocol has none" — and an empty
           * string is a credential that would reach the wire, fail, and count towards the
           * firmware's lockout threshold.
           */
          username: body.username ?? null,
          passwordEncrypted:
            body.password === undefined ? null : encryptSecret(body.password),
          doorNo: body.doorNo,
          locationId: body.locationId ?? null,
          active: body.active,
        },
      });

      // Probed immediately so a typo in the address or credentials surfaces now
      // rather than as silently missing attendance tomorrow.
      const health = await checkDevice(device);
      return jsonSafe({ id: device.id, health });
    },
  );

  app.patch(
    '/api/devices/:id',
    { preHandler: requirePermission('settings.devices', 'edit') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(forUpdate(deviceInputSchema), request.body);

      const existing = await db().device.findUnique({ where: { id } });
      if (!existing) throw notFound('Peranti tidak dijumpai');

      /**
       * Vendor and protocol are fixed once the record exists.
       *
       * Not a convenience restriction. Every raw event and every ID mapping on this row was
       * produced under one protocol's semantics — `eventKey` is namespaced by it, and the
       * identifiers in `device_enrolments` are that protocol's own. Repointing the field would
       * reinterpret history rather than change a connection, and the history is the evidence
       * every attendance figure is derived from.
       *
       * The way to change a terminal's protocol is to add the new record and retire the old
       * one, which keeps both sets of events attributable to what actually produced them.
       */
      if (body.vendor !== undefined && body.vendor !== existing.vendor) {
        throw conflict(
          `Vendor tidak boleh ditukar selepas peranti dicipta (sekarang: ${existing.vendor}). ` +
            'Setiap event mentah dan pemetaan ID pada rekod ini milik vendor itu. ' +
            'Tambah rekod baharu untuk terminal baharu, dan nyahaktifkan yang lama.',
        );
      }
      if (body.protocol !== undefined && body.protocol !== existing.protocol) {
        throw conflict(
          `Protokol tidak boleh ditukar selepas peranti dicipta (sekarang: ${existing.protocol}). ` +
            'Kunci event pada rekod ini dinamaruangkan oleh protokol itu, jadi menukarnya akan ' +
            'menafsir semula sejarah dan bukan menukar sambungan.',
        );
      }

      /**
       * The same address check the create path makes.
       *
       * Two records pointing at one terminal both pull from it and both advance their
       * own cursor, so each sees roughly half the scans and neither is short in a way
       * anybody would notice.
       */
      const host = body.host ?? existing.host;
      const port = body.port ?? existing.port;
      if (host !== existing.host || port !== existing.port) {
        const clash = await db().device.findFirst({
          where: { host, port, id: { not: id } },
        });
        if (clash) throw conflict(`Peranti lain sudah menggunakan ${host}:${String(port)}`);
      }

      /**
       * Credentials re-checked against the protocol on edit, not only on create.
       *
       * Clearing a username on an ISAPI unit would leave a row that appears in the list, joins
       * the health sweep, and reports offline forever. `passwordAlreadyStored` is what lets an
       * edit leave the password field blank and keep the stored one — blank means "keep",
       * because the value is encrypted and never returned so it cannot mean "remove".
       */
      assertCredentialsMatchProtocol(
        existing.protocol as DeviceProtocol,
        {
          username: body.username ?? existing.username ?? undefined,
          password: body.password,
        },
        { passwordAlreadyStored: existing.passwordEncrypted !== null },
      );

      const device = await db().device.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.host !== undefined ? { host: body.host } : {}),
          ...(body.port !== undefined ? { port: body.port } : {}),
          ...(body.useHttps !== undefined ? { useHttps: body.useHttps } : {}),
          ...(body.verifyTls !== undefined ? { verifyTls: body.verifyTls } : {}),
          ...(body.username !== undefined ? { username: body.username } : {}),
          ...(body.password !== undefined
            ? { passwordEncrypted: encryptSecret(body.password) }
            : {}),
          ...(body.doorNo !== undefined ? { doorNo: body.doorNo } : {}),
          ...(body.locationId !== undefined ? { locationId: body.locationId } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        },
      });

      // The cached client holds the old address and challenge.
      await releaseClient(id);

      /**
       * Re-probed for the same reason the create path probes: a typo in the address or
       * credentials has to surface now rather than as silently missing attendance
       * tomorrow. Editing is in fact the likelier place to introduce one.
       *
       * Skipped for a terminal being deactivated. A unit taken off the wall is expected
       * to be unreachable, so probing it spends the connect timeout and then reports the
       * deactivation as if it had failed.
       */
      const health = device.active ? await checkDevice(device) : null;
      return jsonSafe({ id: device.id, health });
    },
  );

  app.get(
    '/api/devices/health',
    { preHandler: requirePermission('settings.devices', 'view') },
    async () => jsonSafe(await checkAllDevices()),
  );

  app.post(
    '/api/devices/:id/check',
    { preHandler: requirePermission('settings.devices', 'test') },
    async (request) => {
      const device = await requireDevice(idParam(request.params));
      return jsonSafe(await checkDevice(device));
    },
  );

  app.post(
    '/api/devices/:id/sync',
    { preHandler: requirePermission('settings.devices', 'sync') },
    async (request) => {
      const device = await requireDevice(idParam(request.params));
      return jsonSafe(await syncDevice(device));
    },
  );

  /**
   * Hands the terminal clock over to NTP.
   *
   * Writing the server alone is not enough: `timeMode` stays on `manual` and the
   * device keeps ignoring it, which is the state the test terminal shipped in.
   */
  app.post(
    '/api/devices/:id/clock/ntp',
    { preHandler: requirePermission('settings.devices', 'clock') },
    async (request) => {
      const device = await requireDevice(idParam(request.params));
      const body = parseBody(
        z.object({
          host: z.string().trim().min(1).max(64),
          // Hikvision's inverted POSIX notation: CST-8:00:00 means UTC+8.
          timeZone: z.string().trim().default('CST-8:00:00'),
          intervalMinutes: z.coerce.number().int().min(1).max(10080).default(60),
        }),
        request.body,
      );

      const driver = driverFor(device);
      await driver.clock.configureNtp(body);

      // Read back, so the reply reports the resulting state rather than "accepted".
      const clock = await driver.clock.read();
      await db().device.update({
        where: { id: device.id },
        data: { clockDriftS: clock.driftSeconds, clockMode: clock.source },
      });

      return { driftSeconds: clock.driftSeconds, timeMode: clock.source };
    },
  );

  /** Turns off remote verification, which otherwise delays every single scan. */
  app.post(
    '/api/devices/:id/remote-check/disable',
    { preHandler: requirePermission('settings.devices', 'edit') },
    async (request) => {
      const device = await requireDevice(idParam(request.params));
      /**
       * Still reaches for the ISAPI client directly, and deliberately so.
       *
       * Remote verification is a Hikvision concept with no neutral equivalent — no other
       * vendor here has a channel that delays every scan waiting for an external decision.
       * Giving the driver contract a method for it would put one vendor's setting into the
       * interface every vendor has to implement, which is the mistake this layer exists to
       * avoid. `clientFor` refuses a non-ISAPI unit with a message naming its protocol.
       */
      await clientFor(device).system.disableRemoteCheck();
      return { ok: true };
    },
  );

  /**
   * Points the terminal's push notification at this server.
   *
   * Authentication is always configured. The firmware defaults to `none`, which
   * leaves anyone who can reach the endpoint able to post forged punches.
   */
  app.post(
    '/api/devices/:id/push',
    { preHandler: requirePermission('settings.devices', 'sync') },
    async (request) => {
      const device = await requireDevice(idParam(request.params));
      const env = loadEnv();

      const body = parseBody(
        z.object({
          host: z.string().trim().min(1).max(64),
          port: z.coerce.number().int().min(1).max(65535),
          path: z.string().trim().max(DEVICE_LIMITS.ingestPathMaxLength).default('/hik/events'),
          useHttps: z.boolean().default(false),
          slot: z.coerce.number().int().min(1).max(DEVICE_LIMITS.notificationHostSlots).default(1),
        }),
        request.body,
      );

      await driverFor(device).lifecycle.configureCallback({
        ...body,
        auth: { username: env.INGEST_USERNAME, password: env.INGEST_PASSWORD },
        heartbeatSeconds: 30,
      });

      return { ok: true, configured: `${body.host}:${body.port}${body.path}` };
    },
  );

  app.get(
    '/api/devices/:id/push',
    { preHandler: requirePermission('settings.devices', 'view') },
    async (request) => {
      const device = await requireDevice(idParam(request.params));
      // Credentials are dropped inside the driver, so no caller here can reach them.
      return driverFor(device).lifecycle.callbackTargets();
    },
  );
}

async function requireDevice(id: number) {
  const device = await db().device.findUnique({ where: { id } });
  if (!device) throw notFound('Peranti tidak dijumpai');
  return device;
}

function idParam(params: unknown): number {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
  if (!parsed.success) throw notFound('Peranti tidak dijumpai');
  return parsed.data.id;
}
