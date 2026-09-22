import { CAPABILITY_DOCUMENTS } from '@attendance/hik-isapi';
import { DEVICE_LIMITS, DeviceProtocol } from '@attendance/shared';
import type { Device } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requirePermission } from '../auth/plugin.js';
import { db, jsonSafe } from '../db.js';
import { loadEnv } from '../env.js';
import { conflict, notFound, parseBody, unauthorized } from '../http.js';
import { DriverOperation, supports } from './driver/index.js';
import { clientFor, driverFor, releaseClient } from './registry.js';

/**
 * Live terminal configuration.
 *
 * Split from `devices/routes.ts` because the two answer different questions. That file
 * owns the record this application keeps about a terminal — address, credentials,
 * location — and its writes go to MySQL. Everything here reads and writes the terminal
 * itself over ISAPI, and nothing here is mirrored into the database.
 *
 * Not mirroring is the decision worth stating. A cached copy of a door setting is a
 * second version of the truth, and the moment somebody changes it at the keypad the
 * screen is confidently wrong. So an offline terminal renders as unreadable rather than
 * as its last known values, which is the honest answer: an unreachable unit genuinely
 * has no configuration anybody here can report.
 *
 * What replaces the mirror is the audit trail. Every write below records who changed
 * what, because without a row in `audit_logs` there is no record anywhere that somebody
 * turned off remote verification or widened the door open duration — the terminal keeps
 * no attributable log of its own.
 */
export async function deviceTerminalRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // Identity — read only
  // -------------------------------------------------------------------------

  /**
   * What this box is, and what it is holding.
   *
   * `deviceInfo` is already stored on the record by the health check, but this reads it
   * live: the point of the tab is to answer "is the unit at this address the one we think
   * it is", and a stored copy cannot answer that after somebody swaps the hardware.
   */
  app.get(
    '/api/devices/:id/terminal/identity',
    { preHandler: requirePermission('settings.devices', 'view') },
    async (request) => {
      const device = await requireDevice(idParam(request.params));
      const driver = driverFor(device);

      // Concurrent here, serialised in the driver: the transport keeps one request in flight
      // per unit, so this reads as parallel without producing parallel traffic.
      const [info, counts] = await Promise.all([
        driver.identity.read(),
        driver.identity.counts(),
      ]);

      // Advisory, and separately fallible: a firmware that hides the face library must
      // not blank out the identity block beside it.
      const libraries = await driver.identity.faceStores().catch(() => []);
      const capacity = await driver.identity.capacity().catch(() => null);

      return jsonSafe({
        info,
        counts,
        libraries,
        capacity,
        /** Held in our record rather than on the unit, and shown for comparison. */
        record: {
          serialNumber: device.serialNumber,
          faceCapacity: device.faceCapacity,
          doorNo: device.doorNo,
        },
      });
    },
  );

  // -------------------------------------------------------------------------
  // Clock
  // -------------------------------------------------------------------------

  /**
   * Clock state, including the NTP slots as the terminal currently holds them.
   *
   * The slots matter: the screen used to offer an empty text box, so an operator could
   * not tell whether NTP was already pointed somewhere sensible or still at the factory
   * placeholder. An empty box beside a working configuration invites overwriting it.
   */
  app.get(
    '/api/devices/:id/terminal/clock',
    { preHandler: requirePermission('settings.devices', 'view') },
    async (request) => {
      const device = await requireDevice(idParam(request.params));
      const driver = driverFor(device);

      const clock = await driver.clock.read();
      /**
       * The NTP slot list stays on the raw ISAPI client.
       *
       * It is Hikvision's own multi-slot model, and no other protocol here has an equivalent
       * to expose. Reading it through a neutral method would mean every driver implementing a
       * concept only one of them has. Allowed to come back empty so the tab still renders.
       */
      const servers = await clientFor(device).system.ntpServers().catch(() => []);

      return jsonSafe({
        driftSeconds: clock.driftSeconds,
        deviceTime: clock.deviceTime,
        serverTime: clock.serverTime,
        manualClock: clock.source === 'manual',
        timeMode: clock.source,
        timeZone: clock.rawTimeZone,
        utcOffsetMinutes: clock.utcOffsetMinutes,
        servers,
        /** So the screen can offer the organisation's zone instead of a hardcoded one. */
        orgTimeZone: loadEnv().ORG_TIMEZONE,
      });
    },
  );

  /**
   * Writes an absolute time, for a site with no reachable NTP host.
   *
   * Separate from the NTP route rather than a mode flag on it, because the two leave the
   * terminal in different states and one of them is a dead end: a manually set clock
   * starts drifting again immediately, and nothing corrects it. The screen says so.
   */
  app.post(
    '/api/devices/:id/terminal/clock/manual',
    { preHandler: requirePermission('settings.devices', 'clock') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const device = await requireDevice(idParam(request.params));

      const body = parseBody(
        z.object({
          /** Absent means "this server's clock, right now", which is the usual intent. */
          at: z.coerce.date().optional(),
          timeZone: z.string().trim().min(1).max(64),
        }),
        request.body,
      );

      const when = body.at ?? new Date();
      const driver = driverFor(device);
      await driver.clock.setManually(when, body.timeZone);

      // Read back, so the reply reports the resulting drift rather than "accepted".
      const clock = await driver.clock.read();
      await db().device.update({
        where: { id: device.id },
        data: { clockDriftS: clock.driftSeconds, clockMode: 'manual' },
      });

      await writeTerminalAudit(request.user, device, {
        timeMode: { before: null, after: 'manual' },
        localTime: { before: null, after: when.toISOString() },
        timeZone: { before: null, after: body.timeZone },
      });

      return jsonSafe({ driftSeconds: clock.driftSeconds, timeMode: 'manual' });
    },
  );

  // -------------------------------------------------------------------------
  // Attendance mode
  // -------------------------------------------------------------------------

  app.get(
    '/api/devices/:id/terminal/attendance',
    { preHandler: requirePermission('settings.devices', 'view') },
    async (request) => {
      const device = await requireDevice(idParam(request.params));
      return jsonSafe(await driverFor(device).attendance.mode());
    },
  );

  /**
   * Changes how the terminal labels a scan.
   *
   * Only `mode` is written. `attendanceStatusTime` and `reqAttendanceStatus` are read
   * and displayed, but the firmware treats them as part of the mode's own definition and
   * this application has nothing that reads them — writing settings nothing consumes is
   * how a screen grows controls that appear to work and change nothing.
   */
  app.put(
    '/api/devices/:id/terminal/attendance',
    { preHandler: requirePermission('settings.devices', 'terminal') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const device = await requireDevice(idParam(request.params));

      const body = parseBody(
        z.object({ mode: z.enum(['disable', 'manual', 'auto', 'manualAndAuto']) }),
        request.body,
      );

      const driver = driverFor(device);
      const before = await driver.attendance.mode().catch(() => null);
      await driver.attendance.setMode(body.mode);

      await writeTerminalAudit(request.user, device, {
        attendanceMode: { before: before?.mode ?? null, after: body.mode },
      });

      return jsonSafe(await driver.attendance.mode());
    },
  );

  // -------------------------------------------------------------------------
  // Door and authentication
  // -------------------------------------------------------------------------

  /**
   * Everything behind "how does this door decide to open".
   *
   * Four reads, and three of them are allowed to come back empty. `AcsCfg` is answered
   * by every unit in this family; door parameters, reader configuration and the
   * capability documents are not, and a tab that fails whole because one optional
   * endpoint is missing hides the settings that were readable.
   *
   * The authentication option list comes from the device rather than from this
   * repository. A hardcoded list offers modes the unit rejects and hides ones it
   * accepts, and both failures look like bugs in this application.
   */
  app.get(
    '/api/devices/:id/terminal/door',
    { preHandler: requirePermission('settings.devices', 'view') },
    async (request) => {
      const device = await requireDevice(idParam(request.params));
      const driver = driverFor(device);

      const door = await driver.access.door(device.doorNo).catch(() => null);
      const reader = await driver.access.reader(1).catch(() => null);

      /**
       * Option lists straight from the unit's own capability document.
       *
       * `defaultVerifyMode` is asked for and is expected to be absent: the probe against
       * V4.38.0 shows the firmware holds a value for it but publishes no `opt` list. The
       * screen handles that by offering a documented list marked as unverified, which is
       * honest about the one case where a write can be refused.
       */
      const options = await driver.access.options().catch(() => ({}) as Record<string, string[]>);

      return jsonSafe({
        /**
         * Hikvision `AcsCfg`, and null on anything else.
         *
         * Not routed through the driver contract on purpose. Every field in here is specific
         * to this vendor — remote verification, and which of the person's details the screen
         * shows during a scan — so a neutral method for it would oblige every driver to
         * implement a concept only one of them has.
         *
         * Null is the honest answer for another protocol, and it lets the screen omit the
         * card rather than render switches that read as off when they are absent. Field names
         * are as this firmware actually spells them: `showCapPic` and `showUserInfo` from the
         * ISAPI reference do not exist on this unit.
         */
        acs: await readAcsConfig(device),
        door,
        reader,
        options,
        doorNo: device.doorNo,
        /** So the screen can tell "this vendor has no such control" from "not answering". */
        capabilities: driver.capabilities,
      });
    },
  );

  /**
   * Writes door and authentication settings.
   *
   * Guarded by `terminal` rather than `edit`. Deciding a person's phone number and
   * deciding whether a face alone opens a door are different jobs held by different
   * people — the same reason `settings.security` is a separate screen from
   * `settings.integration.api`. An `edit` grant handed out so somebody could rename a
   * terminal must not also let them weaken the authentication on it.
   *
   * The three groups are written independently and their outcomes reported separately,
   * because they are three endpoints: the reader accepting a change while the door
   * refuses one is a real result, and collapsing it into a single success or failure
   * would either overstate or hide it.
   */
  app.put(
    '/api/devices/:id/terminal/door',
    { preHandler: requirePermission('settings.devices', 'terminal') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const device = await requireDevice(idParam(request.params));

      const body = parseBody(
        z.object({
          acs: z
            .object({
              remoteCheckDoorEnabled: z.boolean().optional(),
              showPicture: z.boolean().optional(),
              showEmployeeNo: z.boolean().optional(),
              showName: z.boolean().optional(),
              desensitiseEmployeeNo: z.boolean().optional(),
              desensitiseName: z.boolean().optional(),
              voicePrompt: z.boolean().optional(),
            })
            .optional(),
          door: z
            .object({
              openDuration: z.coerce.number().int().min(1).max(255).optional(),
              disabledOpenDuration: z.coerce.number().int().min(1).max(255).optional(),
              magneticAlarmTimeout: z.coerce.number().int().min(0).max(255).optional(),
              magneticType: z.enum(['alwaysClose', 'alwaysOpen']).optional(),
            })
            .optional(),
          reader: z
            .object({
              defaultVerifyMode: z.string().trim().min(1).max(48).optional(),
              /**
               * Not bounded to a range here.
               *
               * The accepted set on V4.38.0 is 3, 5, 6, 12 and 13 — not a 1-5 scale, so a
               * `min(1).max(5)` would accept 1, 2 and 4 that the device refuses while
               * blocking 6, 12 and 13 that it accepts. The device's own capability list is
               * the authority, and it is what the screen builds its control from.
               */
              fingerprintLevel: z.coerce.number().int().min(0).max(255).optional(),
              faceMatchThresholdN: z.coerce.number().int().min(0).max(100).optional(),
              livingBodyDetect: z.boolean().optional(),
              liveDetLevel: z.enum(['general', 'enhancive', 'professional']).optional(),
            })
            .optional(),
        }),
        request.body,
      );

      const driver = driverFor(device);
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      const failures: Array<{ group: string; error: string }> = [];

      if (body.acs !== undefined && Object.keys(body.acs).length > 0) {
        // Hikvision-only, same reasoning as the read above: these fields have no equivalent
        // on another protocol, so they stay off the neutral contract.
        const client = clientFor(device);
        const before = await client.system.acsConfig().catch(() => ({}) as Record<string, unknown>);
        try {
          await client.system.setAcsConfig(body.acs);
          for (const [key, value] of Object.entries(body.acs)) {
            changes[`acs.${key}`] = { before: before[key] ?? null, after: value };
          }
        } catch (error) {
          failures.push({ group: 'acs', error: describe(error) });
        }
      }

      if (body.door !== undefined && Object.keys(body.door).length > 0) {
        /**
         * Read immediately before the write, because the audit row needs the live previous
         * value. A stored copy would record what this application last believed rather than
         * what the terminal actually held, and somebody changing a setting at the keypad is
         * exactly the case the audit trail is for.
         */
        const before = await driver.access.door(device.doorNo).catch(() => null);
        try {
          await driver.access.setDoor(device.doorNo, {
            ...(body.door.openDuration === undefined
              ? {}
              : { openSeconds: body.door.openDuration }),
            ...(body.door.disabledOpenDuration === undefined
              ? {}
              : { extendedOpenSeconds: body.door.disabledOpenDuration }),
            ...(body.door.magneticAlarmTimeout === undefined
              ? {}
              : { heldOpenAlarmSeconds: body.door.magneticAlarmTimeout }),
            ...(body.door.magneticType === undefined
              ? {}
              : { sensorRestState: body.door.magneticType }),
          });
          for (const [key, value] of Object.entries(body.door)) {
            changes[`door.${key}`] = {
              before: before === null ? null : (before.raw[key] ?? null),
              after: value,
            };
          }
        } catch (error) {
          failures.push({ group: 'door', error: describe(error) });
        }
      }

      if (body.reader !== undefined && Object.keys(body.reader).length > 0) {
        const before = await driver.access.reader(1).catch(() => null);
        try {
          await driver.access.setReader(1, {
            ...(body.reader.defaultVerifyMode === undefined
              ? {}
              : { verifyMode: body.reader.defaultVerifyMode }),
            ...(body.reader.fingerprintLevel === undefined
              ? {}
              : { fingerprintLevel: body.reader.fingerprintLevel }),
            ...(body.reader.faceMatchThresholdN === undefined
              ? {}
              : { faceThreshold: body.reader.faceMatchThresholdN }),
            ...(body.reader.livingBodyDetect === undefined
              ? {}
              : { livenessEnabled: body.reader.livingBodyDetect }),
            ...(body.reader.liveDetLevel === undefined
              ? {}
              : { livenessLevel: body.reader.liveDetLevel }),
          });
          for (const [key, value] of Object.entries(toReaderPatch(body.reader))) {
            changes[`reader.${key}`] = {
              before: before === null ? null : (before.raw[key] ?? null),
              after: value,
            };
          }
        } catch (error) {
          failures.push({ group: 'reader', error: describe(error) });
        }
      }

      // Written even on a partial failure: what did change has to be attributable, and
      // an audit trail that only records clean runs is missing exactly the events
      // somebody will be asked about later.
      if (Object.keys(changes).length > 0) {
        await writeTerminalAudit(request.user, device, changes);
      }

      return jsonSafe({ applied: Object.keys(changes), failures });
    },
  );

  /**
   * Releases the lock once.
   *
   * Under `terminal` and audited, because this is the one control on the screen that
   * physically opens a door with nobody presenting a credential. The row it writes is
   * the only record that it happened attributably — the terminal logs a door event, but
   * not who asked for it from a browser.
   */
  app.post(
    '/api/devices/:id/terminal/door/open',
    { preHandler: requirePermission('settings.devices', 'terminal') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const device = await requireDevice(idParam(request.params));

      await driverFor(device).access.open(device.doorNo);
      await writeTerminalAudit(request.user, device, {
        doorOpen: { before: null, after: `pintu ${String(device.doorNo)} dibuka dari jauh` },
      });

      return { ok: true };
    },
  );

  // -------------------------------------------------------------------------
  // Push slots
  // -------------------------------------------------------------------------

  /**
   * Clears one notification slot.
   *
   * The wrapper for this has existed unused since the module was written, which left the
   * screen able to point a slot somewhere but never to release it — so a terminal moved
   * between servers kept posting to the old one until somebody found the keypad menu.
   */
  app.delete(
    '/api/devices/:id/push/:slot',
    { preHandler: requirePermission('settings.devices', 'sync') },
    async (request) => {
      if (!request.user) throw unauthorized();

      const params = z
        .object({
          id: z.coerce.number().int().positive(),
          slot: z.coerce.number().int().min(1).max(DEVICE_LIMITS.notificationHostSlots),
        })
        .safeParse(request.params);
      if (!params.success) throw notFound('Peranti tidak dijumpai');

      const device = await requireDevice(params.data.id);
      await driverFor(device).lifecycle.clearCallback(params.data.slot);

      await writeTerminalAudit(request.user, device, {
        pushSlot: { before: `slot ${String(params.data.slot)}`, after: null },
      });

      return { ok: true };
    },
  );

  // -------------------------------------------------------------------------
  // Reboot
  // -------------------------------------------------------------------------

  /**
   * Restarts the terminal.
   *
   * Reachability is probed first, and that is the whole design of this route. The firmware
   * drops the connection while answering a reboot, so the command throws either way — and
   * without knowing the unit answered a moment ago, "rebooting now" and "was never there"
   * are indistinguishable. One cheap read separates them, so the reply can say which
   * happened instead of guessing.
   *
   * Under `terminal` alongside remote door open: both have a physical consequence at the
   * door, and neither belongs to whoever was granted `edit` to fix a typo in an address.
   */
  app.post(
    '/api/devices/:id/terminal/reboot',
    { preHandler: requirePermission('settings.devices', 'terminal') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const device = await requireDevice(idParam(request.params));

      const driver = driverFor(device);

      // Fails with the device's own reason when the unit is already unreachable, rather
      // than reporting a reboot that never left this server.
      try {
        await driver.identity.read();
      } catch (error) {
        throw conflict(
          `Terminal "${device.name}" tidak dapat dihubungi, jadi arahan restart tidak dihantar: ` +
            describe(error),
        );
      }

      /**
       * The driver swallows the dropped connection, because that is the expected outcome
       * rather than a fault: the unit stops answering mid-reply.
       *
       * Which means this reply can no longer distinguish "dropped" from "answered cleanly".
       * It is reported as dropped because that is what happens on every unit this runs
       * against, and a reachability probe succeeded a moment ago — so the alternative reading,
       * that the terminal was never there, is already ruled out.
       */
      const ack = await driver.lifecycle.reboot();
      const connectionDropped = true;

      /**
       * The cached auth challenge does not survive the restart, and a stale one makes every
       * request after this fail authentication until the cache happens to be evicted.
       *
       * Dropping the whole driver rather than just the challenge, because a queued-write
       * driver also holds in-flight state that a restart invalidates.
       */
      await releaseClient(device.id);

      /**
       * Marked offline rather than left reading online.
       *
       * It is about to be, for a minute or two. Leaving the last known status in place
       * would have the dashboard assert the door is answering while somebody stands in
       * front of it — and the health sweep only corrects that on its next pass.
       */
      await db().device.update({
        where: { id: device.id },
        data: { status: 'offline', lastErrorAt: new Date() },
      });

      await writeTerminalAudit(request.user, device, {
        reboot: { before: null, after: 'restart dari jauh' },
      });

      return { ok: true, connectionDropped, pending: !ack.confirmed };
    },
  );

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  /**
   * Whatever the terminal says about itself, unfiltered.
   *
   * `AcsCfg` is read in full here. The health check reads the same object and keeps one
   * flag out of it, so every other field the firmware reports has been invisible — which
   * is the state that makes a firmware change impossible to diagnose without a site
   * visit. Capability documents are included for the same reason: they are how the
   * option lists on the other tabs are built, so being able to see them is how a missing
   * control gets explained.
   */
  app.get(
    '/api/devices/:id/terminal/diagnostics',
    { preHandler: requirePermission('settings.devices', 'view') },
    async (request) => {
      const device = await requireDevice(idParam(request.params));
      const driver = driverFor(device);

      /**
       * Whatever the driver can say about its unit, in the driver's own shape.
       *
       * Deliberately unconstrained. Constraining it would filter out exactly the field that
       * turns out to have changed, which is the state that makes a firmware update
       * undiagnosable without a site visit.
       */
      const reported = await driver.diagnostics().catch(() => ({}));

      const syncState = await db().deviceSyncState.findUnique({ where: { deviceId: device.id } });
      const pullable = supports(driver.capabilities, DriverOperation.pullEvents);

      return jsonSafe({
        ...reported,
        protocol: driver.protocol,
        capabilities: driver.capabilities,
        cursor: {
          /**
           * Null on a protocol with no pull, rather than the stored zero.
           *
           * The column defaults to 0 and stays there for a callback terminal, which the screen
           * would otherwise render as `#0` — indistinguishable from a pull cursor that has
           * never advanced, on a unit where no cursor exists at all.
           */
          lastSerialNo: pullable ? (syncState?.lastSerialNo ?? null) : null,
          lastSyncAt: syncState?.lastSyncAt ?? null,
          lastPushAt: syncState?.lastPushAt ?? null,
          recoveredByPull: pullable ? (syncState?.recoveredByPull ?? 0) : null,
        },
        lastError: device.lastError,
        lastErrorAt: device.lastErrorAt,
      });
    },
  );
}

/**
 * Hikvision `AcsCfg`, or null on a terminal that has no such document.
 *
 * Kept off the driver contract deliberately. Every field in here belongs to one vendor —
 * remote verification, and which of a person's details appear on screen during a scan — so a
 * neutral method would oblige every driver to implement a concept only one of them has, and
 * the others would return nulls that read as faults.
 *
 * Null is the honest answer for another protocol, and it lets the screen omit the card
 * entirely rather than render switches that read as off when they are simply absent.
 */
async function readAcsConfig(device: Device): Promise<Record<string, unknown> | null> {
  if (device.protocol !== DeviceProtocol.isapi) return null;

  const acs = await clientFor(device)
    .system.acsConfig()
    .catch(() => null);
  if (acs === null) return null;

  return {
    remoteCheckDoorEnabled: acs['remoteCheckDoorEnabled'] ?? null,
    checkChannelType: acs['checkChannelType'] ?? null,
    remoteCheckTimeout: acs['remoteCheckTimeout'] ?? null,
    showPicture: acs['showPicture'] ?? null,
    showEmployeeNo: acs['showEmployeeNo'] ?? null,
    showName: acs['showName'] ?? null,
    desensitiseEmployeeNo: acs['desensitiseEmployeeNo'] ?? null,
    desensitiseName: acs['desensitiseName'] ?? null,
    voicePrompt: acs['voicePrompt'] ?? null,
  };
}

/**
 * Reader fields whose option list the screen needs.
 *
 * Asked for together in one capability read. `defaultVerifyMode` is included knowing this
 * firmware does not publish it, because a firmware that does should light the control up
 * without another change here.
 */
const READER_OPTION_FIELDS = [
  'defaultVerifyMode',
  'fingerPrintCheckLevel',
  'liveDetLevelSet',
  'cardReaderFunction',
] as const;

/**
 * Maps the request shape onto the field names the firmware uses.
 *
 * An explicit translation rather than passing the body through, because the two disagree
 * and the disagreement is not guessable: the reader calls the authentication mode
 * `defaultVerifyMode`, the fingerprint threshold `fingerPrintCheckLevel`, and the
 * anti-spoofing level `liveDetLevelSet`. A write to a name the device has never heard of
 * is accepted and ignored, which is the worst of the possible outcomes.
 *
 * The door group needs no such map: after the probe, the API and the firmware use the same
 * names for all four of its fields.
 */
function toReaderPatch(reader: {
  defaultVerifyMode?: string;
  fingerprintLevel?: number;
  faceMatchThresholdN?: number;
  livingBodyDetect?: boolean;
  liveDetLevel?: string;
}): Record<string, unknown> {
  return {
    ...(reader.defaultVerifyMode !== undefined
      ? { defaultVerifyMode: reader.defaultVerifyMode }
      : {}),
    ...(reader.fingerprintLevel !== undefined
      ? { fingerPrintCheckLevel: reader.fingerprintLevel }
      : {}),
    ...(reader.faceMatchThresholdN !== undefined
      ? { faceMatchThresholdN: reader.faceMatchThresholdN }
      : {}),
    ...(reader.livingBodyDetect !== undefined
      ? { livingBodyDetect: reader.livingBodyDetect }
      : {}),
    ...(reader.liveDetLevel !== undefined ? { liveDetLevelSet: reader.liveDetLevel } : {}),
  };
}

/**
 * Records a change made on a terminal.
 *
 * `entityType: 'Device'` with the terminal's own id, so the trail can be read per
 * terminal. Only the fields that moved are stored — a full before-and-after of `AcsCfg`
 * would bury the one flag somebody is asking about under thirty that did not change.
 */
async function writeTerminalAudit(
  user: { accountId: number; fullName: string },
  device: Device,
  changes: Record<string, { before: unknown; after: unknown }>,
): Promise<void> {
  await db().auditLog.create({
    data: {
      accountId: user.accountId,
      actorLabel: user.fullName,
      action: 'update',
      entityType: 'Device',
      entityId: String(device.id),
      // Through JSON so Date and other non-primitives satisfy Prisma's Json input.
      changes: JSON.parse(JSON.stringify(changes)) as object,
    },
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requireDevice(id: number): Promise<Device> {
  const device = await db().device.findUnique({ where: { id } });
  if (!device) throw notFound('Peranti tidak dijumpai');
  return device;
}

function idParam(params: unknown): number {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
  if (!parsed.success) throw notFound('Peranti tidak dijumpai');
  return parsed.data.id;
}
