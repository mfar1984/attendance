import type { LabelKey } from '@attendance/shared';
import { parseStateCodes } from '@attendance/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { assertCan, requireAnyPermission, requirePermission } from '../auth/plugin.js';
import {
  ACTION_LABELS,
  actionLabel,
  PERMISSION_SECTIONS,
  PermissionError,
  SELF_REPAIR_REQUIREMENTS,
  SETTINGS_SCREEN_KEYS,
  STANDARD_ACTIONS,
  countGranted,
  settingScreen,
  totalPermissionCount,
  validatePermissions,
} from '../auth/permissions.js';
import { can, hashPassword } from '../auth/service.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import { db, jsonSafe } from '../db.js';
import { loadEnv } from '../env.js';
import { clientIp, conflict, forUpdate, notFound, parseBody, unauthorized } from '../http.js';
import { recordActivity } from '../logging/activity.js';
import { addressAllowedByList, invalidateMaintenance } from '../maintenance/mode.js';
import { MINIMUM_RAW_EVENT_MONTHS, previewPurge, runPurge } from '../retention/purge.js';
import { brandingStatus } from './branding.js';
import { assertPasswordAcceptable } from '../security/policy.js';

/**
 * Settings the operator controls at runtime.
 *
 * Distinct from environment variables, which describe where the system runs and
 * cannot change without a restart. Anything here is safe to edit while people are
 * clocking in.
 */
const SETTING_KEYS = [
  'organisation.name',
  'organisation.timezone',
  'organisation.dateFormat',
  'organisation.weekStart',
  'organisation.timeFormat',
  /**
   * `organisation.logoPath` and `organisation.faviconPath` are deliberately absent.
   *
   * They hold a filesystem path that a route later reads and streams. Letting them
   * through this endpoint would mean an operator could point them anywhere on the
   * disk and then fetch it. The upload route is their only writer, and it derives the
   * path itself rather than accepting one.
   */
  'attendance.driftWarnSeconds',
  'attendance.dedupWindowSeconds',
  'retention.rawEventMonths',
  'retention.pictureMonths',
  'retention.autoPurgeEnabled',
  'retention.purgeHour',
  'backup.autoEnabled',
  'backup.hour',
  'backup.keepCount',
  'maintenance.enabled',
  'maintenance.message',
  'maintenance.allowIps',
  'logging.level',
  'logging.retentionDays',
  'integration.emailHost',
  'integration.emailPort',
  'integration.emailUser',
  'integration.emailPassword',
  'integration.emailFrom',
  // SMS and Telegram moved to `sms_config` and `telegram_config` with their own routes.
  // They carry a trigger list, which is an array, and this endpoint only accepts scalars —
  // and typed columns beat a JSON blob for values that a send path reads on every message.

  /*
   * Public holidays.
   *
   * `integration.holidayFeedUrl` was here and is gone. It was a box for an iCal URL that nothing
   * ever fetched — the tab asked for a feed, stored the string, and the holiday list stayed
   * whatever somebody had typed in by hand. A field that accepts input and does nothing teaches
   * the operator the screen is broken, which is the same reason a search box that does not filter
   * is worse than no search box.
   *
   * What replaced it is a real sync off `date-holidays`, which needs to know which states this
   * organisation has offices in — a day gazetted in Sarawak is not a holiday in Johor.
   *
   * `enabled` is separate from `autoSync` on purpose. Turning `enabled` off stops leave treating
   * gazetted days as holidays at all; turning `autoSync` off just stops the list refreshing and
   * leaves it exactly as it is. Collapsing them into one switch would mean somebody who wanted to
   * stop the nightly refresh silently changed how every leave request is counted.
   *
   * Named `integration.holidays.*` rather than `holidays.*` deliberately. `settingScreen()` routes
   * by prefix and already has a branch for `integration.holiday`, and its own comment warns that a
   * new prefix without a branch lands under General silently — which would hand the holiday
   * settings to anyone who can rename the organisation. Reusing the prefix means there is no second
   * place to remember.
   */
  'integration.holidays.enabled',
  'integration.holidays.autoSync',
  /** JSON array of letter state codes. One canonical format, so the next read cannot mangle it. */
  'integration.holidays.includeStates',
  'integration.holidays.cacheMinutes',
  'integration.holidays.syncYear',
  /** Written by the sync, not by the form. Read-only on screen. */
  'integration.holidays.lastSync',
] as const;

/**
 * Keys whose values are encrypted at rest and never returned.
 *
 * Reads report `{ configured: true }` instead of the value, so a compromised
 * admin session cannot be used to harvest the SMTP or gateway credentials that
 * belong to the hospital rather than to this application.
 */
const SECRET_KEYS = new Set<string>(['integration.emailPassword']);

/**
 * Per-key value rules.
 *
 * The body schema only proves a value is a scalar. That was tolerable while every key
 * was a display preference, but it is not tolerable for keys something acts on
 * unattended: an hour of `99` means the nightly backup never runs and nothing says so,
 * and a `keepCount` of `0` means the pruner deletes the dump it just wrote.
 *
 * A rejection rather than a clamp, for the same reason as the retention floor — a value
 * quietly corrected leaves the screen showing one number and the server using another.
 */
const VALUE_RULES: Record<string, z.ZodType> = {
  'organisation.name': z.string().trim().max(120),
  'organisation.dateFormat': z.enum(['DD/MM/YYYY', 'YYYY-MM-DD', 'DD MMM YYYY']),
  'organisation.weekStart': z.enum(['0', '1']),
  'organisation.timeFormat': z.enum(['12', '24']),
  'attendance.dedupWindowSeconds': z.coerce.number().int().min(0).max(3600),
  'retention.pictureMonths': z.coerce.number().int().min(1).max(120),
  'retention.purgeHour': z.coerce.number().int().min(0).max(23),
  'retention.autoPurgeEnabled': z.boolean(),
  'backup.autoEnabled': z.boolean(),
  'backup.hour': z.coerce.number().int().min(0).max(23),
  // At least two, so pruning can never remove the only copy that exists.
  'backup.keepCount': z.coerce.number().int().min(2).max(365),
  'maintenance.enabled': z.boolean(),
  'maintenance.message': z.string().trim().max(500),
  'maintenance.allowIps': z.string().trim().max(500),
  'logging.level': z.enum(['debug', 'info', 'warn', 'error']),
  'logging.retentionDays': z.coerce.number().int().min(7).max(3650),
  'integration.holidays.enabled': z.boolean(),
  'integration.holidays.autoSync': z.boolean(),
  /**
   * Normalised on the way in, and rejected rather than filtered if anything is unrecognised.
   *
   * An unknown code would be handed to the sync, which answers with the national list when it
   * cannot place a state — so the run would look successful and return nothing for that office.
   * Better to refuse the save and name the value.
   */
  'integration.holidays.includeStates': z
    .union([z.string(), z.array(z.string())])
    .transform((value) => parseStateCodes(value))
    .refine(
      (codes) => codes.length > 0,
      'Pilih sekurang-kurangnya satu negeri, atau gunakan kod negeri yang sah',
    )
    .transform((codes) => JSON.stringify(codes)),
  // Zero means every scheduled tick syncs. Thirty days is the ceiling; beyond that the list is
  // stale enough that somebody would be better off pressing Sync now.
  'integration.holidays.cacheMinutes': z.coerce.number().int().min(0).max(43_200),
  'integration.holidays.syncYear': z.coerce.number().int().min(2000).max(2100),
  'integration.holidays.lastSync': z.string().trim().max(40),
};

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  const env = loadEnv();

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  /**
   * The settings bundle.
   *
   * Four screens read from this one endpoint, so the gate is "can view any settings
   * screen" and the payload is then narrowed to the keys this role may actually
   * see. Returning everything to anyone who can open one tab would make the
   * per-screen permissions decorative.
   */
  app.get(
    '/api/settings',
    { preHandler: requireAnyPermission(SETTINGS_SCREEN_KEYS, 'view') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const user = request.user;

      const rows = await db().setting.findMany();
      const values: Record<string, unknown> = {};

      for (const row of rows) {
        if (!can(user, settingScreen(row.key), 'view')) continue;
        // A secret is reported as present, never disclosed. An endpoint that echoes
        // a stored credential becomes the easiest way to extract it.
        values[row.key] = row.secret ? { configured: true } : row.value;
      }

      return jsonSafe({
        values,
        /**
         * Presence and a cache-busted URL, never the path on disk.
         *
         * The stored value is a filename this server later reads, so it stays server-side
         * for the same reason the upload route derives it rather than accepting it.
         */
        branding: await brandingStatus(),
        /** Read-only, because these are fixed at deploy time. */
        environment: {
          connectorMode: env.CONNECTOR_MODE,
          timezone: env.ORG_TIMEZONE,
          driftWarnSeconds: env.CLOCK_DRIFT_WARN_SECONDS,
          syncIntervalSeconds: env.SYNC_INTERVAL_SECONDS,
          requireAdmin2fa: env.REQUIRE_ADMIN_2FA,
          ingestPath: '/hik/events',
          /** The transport ceiling for the logo upload, so the screen can state it. */
          maxUploadBytes: 1024 * 1024,
        },
        // Narrowed the same way as the values, so a disabled input is a disabled
        // input rather than a save that fails after the fact.
        editableKeys: SETTING_KEYS.filter((key) => can(user, settingScreen(key), 'edit')),
      });
    },
  );

  app.put(
    '/api/settings',
    { preHandler: requireAnyPermission(SETTINGS_SCREEN_KEYS, 'edit') },
    async (request) => {
    if (!request.user) throw unauthorized();

    const body = parseBody(
      z.object({
        values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
      }),
      request.body,
    );

    const unknownKeys = Object.keys(body.values).filter(
      (key) => !SETTING_KEYS.includes(key as (typeof SETTING_KEYS)[number]),
    );
    if (unknownKeys.length > 0) {
      throw conflict(`Kunci tetapan tidak dikenali: ${unknownKeys.join(', ')}`);
    }

    // Checked per key against the screen that owns it. Without this, a role
    // holding only Integrasi edit could rewrite the organisation name and the
    // retention policy through the same request.
    for (const key of Object.keys(body.values)) {
      assertCan(request.user, settingScreen(key), 'edit');
    }

    /**
     * The retention floor is enforced here, not only in the purge.
     *
     * Rejecting the save is what makes the limit visible. Silently clamping would
     * leave an operator believing they had set six months while the system kept
     * twelve, and they would only find out from a deletion that never happened.
     */
    const requestedMonths = body.values['retention.rawEventMonths'];
    if (requestedMonths !== undefined && requestedMonths !== null) {
      const months = Number(requestedMonths);
      if (!Number.isFinite(months) || months < MINIMUM_RAW_EVENT_MONTHS) {
        throw conflict(
          `Log scan mentah mesti disimpan sekurang-kurangnya ${String(MINIMUM_RAW_EVENT_MONTHS)} bulan. ` +
            'Ia adalah bukti bagi gaji yang sudah dibayar, dan bulan yang dibuang tidak boleh ' +
            'dikira semula.',
        );
      }
    }

    // Checked per key, naming the key in the message. A single "data tidak sah" across a
    // form of fifteen fields tells the operator nothing about which one to fix.
    for (const [key, raw] of Object.entries(body.values)) {
      const rule = VALUE_RULES[key];
      if (rule === undefined || raw === null) continue;

      const checked = rule.safeParse(raw);
      if (!checked.success) {
        throw conflict(
          `${key}: ${checked.error.issues[0]?.message ?? 'nilai tidak sah'} (diterima: ${JSON.stringify(raw)})`,
        );
      }
      // The coerced form is what gets stored, so a numeric field arriving as "3" from a
      // select does not end up in the database as a string that later reads as NaN.
      body.values[key] = checked.data as string | number | boolean;
    }

    /**
     * Maintenance mode is not something to switch on by accident.
     *
     * Refused unless the caller's own address is covered, because the operator who turns
     * it on is the one who then has to turn it off, and a locked-out administrator has no
     * route back except editing the database by hand.
     */
    if (body.values['maintenance.enabled'] === true) {
      const listRaw = body.values['maintenance.allowIps'];
      const list = typeof listRaw === 'string'
        ? listRaw
        : String((await db().setting.findUnique({ where: { key: 'maintenance.allowIps' } }))?.value ?? '');

      const caller = clientIp(request) ?? '';
      if (!addressAllowedByList(caller, list)) {
        throw conflict(
          `Alamat anda (${caller}) tiada dalam senarai yang dibenarkan, jadi menghidupkan mod ` +
            'penyelenggaraan akan mengunci anda sendiri keluar. Tambah alamat itu ke senarai dahulu.',
        );
      }
    }

    for (const [key, raw] of Object.entries(body.values)) {
      const secret = SECRET_KEYS.has(key);

      // An empty secret means "leave as is" rather than "clear it", so saving the
      // form without retyping a password does not wipe it.
      if (secret && (raw === null || raw === '')) continue;

      // Prisma's Json input type does not accept a bare primitive in its
      // signature, so the value is widened through `unknown`. Scalars are valid
      // JSON and MySQL stores them correctly.
      const value = (secret ? encryptSecret(String(raw)) : raw) as unknown as object;

      await db().setting.upsert({
        where: { key },
        create: { key, value, secret, updatedBy: request.user.accountId },
        update: { value, secret, updatedBy: request.user.accountId },
      });
    }

    /**
     * Dropped rather than left to expire.
     *
     * The fifteen-second cache exists so the per-request check is cheap, not so that a
     * deliberate change waits. Turning maintenance mode off is the action of somebody who
     * wants the system back now, and a toggle that appears not to work gets clicked again.
     */
    if (Object.keys(body.values).some((key) => key.startsWith('maintenance.'))) {
      invalidateMaintenance();

      if (body.values['maintenance.enabled'] !== undefined) {
        await recordActivity({
          request,
          action: 'maintenance.mode',
          category: 'settings',
          // Never routine: while this is on, every operator screen is refused.
          level: 'warn',
          detail:
            body.values['maintenance.enabled'] === true
              ? `dihidupkan · dibenarkan: ${String(body.values['maintenance.allowIps'] ?? '(senarai tersimpan)')}`
              : 'dimatikan · akses operator dipulihkan',
        });
      }
    }

    await db().auditLog.create({
      data: {
        accountId: request.user.accountId,
        actorLabel: request.user.fullName,
        action: 'update',
        entityType: 'Setting',
        entityId: 'bulk',
        changes: JSON.parse(
          JSON.stringify(
            Object.fromEntries(
              Object.keys(body.values).map((key) => [
                key,
                { before: null, after: SECRET_KEYS.has(key) ? '[redacted]' : body.values[key] },
              ]),
            ),
          ),
        ) as object,
      },
    });

      return { ok: true };
    },
  );

  /** Reads back a secret for the integration that needs it. Never exposed to the UI. */
  app.get(
    '/api/settings/secret/:key',
    { preHandler: requireAnyPermission(SETTINGS_SCREEN_KEYS, 'edit') },
    async (request) => {
      if (!request.user) throw unauthorized();

      const params = z.object({ key: z.string() }).parse(request.params);
      if (!SECRET_KEYS.has(params.key)) throw notFound('Bukan tetapan rahsia');
      assertCan(request.user, settingScreen(params.key), 'edit');

      const row = await db().setting.findUnique({ where: { key: params.key } });
      if (!row) throw notFound('Tetapan tidak dijumpai');

      // Returns only whether it decrypts, so a broken encryption key is
      // diagnosable without printing the value.
      try {
        decryptSecret(String(row.value));
        return { key: params.key, decryptable: true };
      } catch {
        return { key: params.key, decryptable: false };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Roles
  // -------------------------------------------------------------------------

  app.get('/api/roles', { preHandler: requirePermission('settings.roles', 'view') }, async () => {
    const rows = await db().role.findMany({
      orderBy: [{ systemRole: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { accounts: true } } },
    });

    const total = totalPermissionCount();

    return jsonSafe(
      rows.map(({ _count, ...row }) => ({
        ...row,
        accountCount: _count.accounts,
        // Counted server-side against the registry, so a stale grant left behind by
        // a removed screen is not presented as coverage the role still has.
        permissionCount: countGranted((row.permissions ?? {}) as Record<string, string[]>),
        permissionTotal: total,
      })),
    );
  });

  /**
   * The permission matrix definition.
   *
   * Served from the registry rather than duplicated in the client, so a screen
   * cannot appear in the matrix without the server knowing how to enforce it, or
   * be enforced without ever appearing.
   */
  app.get(
    '/api/roles/matrix',
    { preHandler: requirePermission('settings.roles', 'view') },
    async () => ({
      sections: PERMISSION_SECTIONS,
      standardActions: STANDARD_ACTIONS,
      actionLabels: ACTION_LABELS,
      total: totalPermissionCount(),
    }),
  );

  const roleSchema = z.object({
    name: z.string().trim().min(1).max(64),
    description: z.union([z.literal(''), z.string().trim().max(255)]).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    permissions: z.record(z.string(), z.array(z.string())),
  });

  app.post('/api/roles', { preHandler: requirePermission('settings.roles', 'create') }, async (request) => {
    if (!request.user) throw unauthorized();

    const body = parseBody(roleSchema, request.body);
    const permissions = prunePermissions(body.permissions);
    assertValidPermissions(permissions);

    const clash = await db().role.findUnique({ where: { name: body.name } });
    if (clash) throw conflict(`Peranan "${body.name}" sudah ada`);

    const row = await db().role.create({
      data: {
        name: body.name,
        description: body.description && body.description.length > 0 ? body.description : null,
        status: body.status ?? 'active',
        permissions,
      },
    });

    await db().auditLog.create({
      data: {
        accountId: request.user.accountId,
        actorLabel: request.user.fullName,
        action: 'create',
        entityType: 'Role',
        entityId: String(row.id),
        changes: JSON.parse(
          JSON.stringify({
            name: { before: null, after: body.name },
            permissions: { before: null, after: countGranted(permissions) },
          }),
        ) as object,
      },
    });

    return jsonSafe({ id: row.id, permissionCount: countGranted(permissions) });
  });

  app.patch('/api/roles/:id', { preHandler: requirePermission('settings.roles', 'edit') }, async (request) => {
    if (!request.user) throw unauthorized();

    const id = idParam(request.params);
    const body = parseBody(forUpdate(roleSchema), request.body);

    const existing = await db().role.findUnique({ where: { id } });
    if (!existing) throw notFound('Peranan tidak dijumpai');

    const permissions =
      body.permissions !== undefined ? prunePermissions(body.permissions) : undefined;
    if (permissions !== undefined) assertValidPermissions(permissions);

    // A system role's name is referenced in the seed and in operator habit;
    // permissions can still be tuned.
    if (existing.systemRole && body.name !== undefined && body.name !== existing.name) {
      throw conflict('Nama peranan sistem tidak boleh ditukar');
    }

    // A system role held by live accounts cannot be switched off, because that
    // denies login to everyone holding it with no warning on this screen.
    if (existing.systemRole && body.status === 'inactive') {
      throw conflict('Peranan sistem tidak boleh dinyahaktifkan');
    }

    /**
     * Guards against a role editing away its own ability to be repaired.
     *
     * Checked for any role its holder is currently using, not only for Super Admin:
     * whoever is signed in with this role is the person who would have to undo the
     * change, and after the write they no longer can.
     */
    if (permissions !== undefined && request.user.roleName === existing.name) {
      for (const requirement of SELF_REPAIR_REQUIREMENTS) {
        if (!(permissions[requirement.key] ?? []).includes(requirement.action)) {
          throw conflict(
            `Peranan anda sendiri mesti mengekalkan "${actionLabel(requirement.action)}" ` +
              `untuk ${requirement.key}, jika tidak tiada sesiapa boleh membetulkannya semula.`,
          );
        }
      }
    }

    await db().role.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined
          ? { description: body.description.length > 0 ? body.description : null }
          : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(permissions !== undefined ? { permissions } : {}),
      },
    });

    await db().auditLog.create({
      data: {
        accountId: request.user.accountId,
        actorLabel: request.user.fullName,
        action: 'update',
        entityType: 'Role',
        entityId: String(id),
        changes: JSON.parse(
          JSON.stringify({
            permissions: { before: existing.permissions, after: body.permissions ?? existing.permissions },
          }),
        ) as object,
      },
    });

    return jsonSafe({ id });
  });

  app.delete('/api/roles/:id', { preHandler: requirePermission('settings.roles', 'delete') }, async (request) => {
    const id = idParam(request.params);

    const role = await db().role.findUnique({
      where: { id },
      include: { _count: { select: { accounts: true } } },
    });
    if (!role) throw notFound('Peranan tidak dijumpai');
    if (role.systemRole) throw conflict('Peranan sistem tidak boleh dibuang');
    if (role._count.accounts > 0) {
      throw conflict(`${role._count.accounts} akaun masih menggunakan peranan ini.`);
    }

    await db().role.delete({ where: { id } });
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // User accounts
  // -------------------------------------------------------------------------

  /**
   * Row counts for the tab badges.
   *
   * A separate read so the badges stay correct while a tab is filtered: they count
   * what each tab holds, not what the current filter left behind.
   */
  app.get(
    '/api/users/counts',
    { preHandler: requireAnyPermission([...USER_SCREENS, 'settings.users.apps'], 'view') },
    async () => {
      const [admin, staff, apps] = await Promise.all([
        db().userAccount.count({ where: { accountType: 'admin' } }),
        db().userAccount.count({ where: { accountType: 'staff' } }),
        db().appClient.count(),
      ]);
      return { admin, staff, apps };
    },
  );

  app.get('/api/users', { preHandler: requireAnyPermission(USER_SCREENS, 'view') }, async (request) => {
    if (!request.user) throw unauthorized();

    const query = z
      .object({
        accountType: z.enum(['admin', 'staff']).default('admin'),
        status: z.enum(['active', 'pending', 'suspended']).optional(),
        search: z.string().trim().max(128).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(30),
      })
      .parse(request.query);

    // Administrator and staff accounts are separate permissions. An HR clerk who
    // manages app logins has no business reading the administrator list.
    assertCan(request.user, userScreen(query.accountType), 'view');

    const search = query.search
      ? {
          OR: [
            { email: { contains: query.search } },
            { staff: { fullName: { contains: query.search } } },
            { staff: { employeeNo: { contains: query.search } } },
          ],
        }
      : {};

    const where = {
      accountType: query.accountType,
      ...(query.status ? { status: query.status } : {}),
      ...search,
    };

    const [total, rows, statusCounts] = await Promise.all([
      db().userAccount.count({ where }),
      db().userAccount.findMany({
        where,
        // Suspended and pending accounts first: those are the rows an operator came
        // to this screen to do something about.
        orderBy: [{ status: 'asc' }, { email: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          email: true,
          accountType: true,
          status: true,
          allowAppCheckIn: true,
          boundDeviceId: true,
          boundDeviceAt: true,
          lastLoginAt: true,
          lockedUntil: true,
          failedLoginCount: true,
          createdAt: true,
          totpConfirmedAt: true,
          role: { select: { id: true, name: true } },
          staff: {
            select: {
              id: true,
              employeeNo: true,
              fullName: true,
              active: true,
              department: { select: { name: true } },
            },
          },
        },
      }),
      // Counted without the status predicate, so the filter keeps showing what the
      // other statuses hold rather than zeroing them.
      db().userAccount.groupBy({
        by: ['status'],
        where: { accountType: query.accountType, ...search },
        _count: { _all: true },
      }),
    ]);

    const statuses: Record<string, number> = { active: 0, pending: 0, suspended: 0 };
    for (const row of statusCounts) statuses[row.status] = row._count._all;

    return jsonSafe({
      total,
      page: query.page,
      pageSize: query.pageSize,
      statuses,
      generatedAt: new Date().toISOString(),
      rows: rows.map(({ totpConfirmedAt, ...row }) => ({
        ...row,
        // Reported as a boolean; the secret itself is never sent.
        twoFactorEnabled: totpConfirmedAt !== null,
      })),
    });
  });

  /**
   * Removes an account.
   *
   * Requires the account to be suspended first. Two steps rather than one, because
   * this is reachable from a row of small icons and the accessible version of "are
   * you sure" is a state the record has to already be in.
   *
   * The audit trail survives: `activityLog` and `auditLog` carry `actorLabel` as
   * text alongside the id, so past entries still name the person after their login
   * is gone.
   */
  app.delete('/api/users/:id', { preHandler: requireAnyPermission(USER_SCREENS, 'view') }, async (request) => {
    if (!request.user) throw unauthorized();

    const id = idParam(request.params);
    const existing = await db().userAccount.findUnique({
      where: { id },
      include: { staff: { select: { fullName: true } } },
    });
    if (!existing) throw notFound('Akaun tidak dijumpai');

    assertCan(request.user, userScreen(existing.accountType), 'delete');

    if (id === request.user.accountId) {
      throw conflict('Anda tidak boleh membuang akaun anda sendiri.');
    }
    if (existing.status !== 'suspended') {
      throw conflict(
        'Gantung akaun ini dahulu sebelum membuangnya. Ini menghalang satu klik daripada ' +
          'memadam log masuk yang masih digunakan.',
      );
    }
    if (existing.accountType === 'admin') {
      await assertAdminRemains(id, { status: 'suspended' });
    }

    await db().userAccount.delete({ where: { id } });

    await db().auditLog.create({
      data: {
        accountId: request.user.accountId,
        actorLabel: request.user.fullName,
        action: 'delete',
        entityType: 'UserAccount',
        entityId: String(id),
        changes: JSON.parse(
          JSON.stringify({ email: { before: existing.email, after: null } }),
        ) as object,
        reason: `Akaun ${existing.staff.fullName} dibuang`,
      },
    });

    await recordActivity({
      request,
      action: 'users.delete',
      category: 'users',
      level: 'warn',
      detail: `${existing.email} (${existing.staff.fullName})`,
    });

    return { ok: true };
  });

  /**
   * Staff lookup for the account picker.
   *
   * Reports who already holds an account instead of leaving the operator to
   * discover it from a rejection after filling in the whole form. Scoped to
   * `users:create` rather than `staff:view`, because creating a login is the task
   * being performed here.
   */
  app.get(
    '/api/users/staff-search',
    { preHandler: requireAnyPermission(USER_SCREENS, 'create') },
    async (request) => {
      const query = z
        .object({
          q: z.string().trim().max(128).default(''),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        })
        .parse(request.query);

      const rows = await db().staff.findMany({
        where: {
          active: true,
          ...(query.q.length > 0
            ? {
                OR: [
                  { fullName: { contains: query.q } },
                  { employeeNo: { contains: query.q } },
                  { email: { contains: query.q } },
                ],
              }
            : {}),
        },
        orderBy: { fullName: 'asc' },
        take: query.limit,
        select: {
          id: true,
          employeeNo: true,
          fullName: true,
          email: true,
          department: { select: { name: true } },
          account: { select: { email: true } },
        },
      });

      return jsonSafe(
        rows.map(({ account, ...row }) => ({
          ...row,
          existingAccountEmail: account?.email ?? null,
        })),
      );
    },
  );

  app.post('/api/users', { preHandler: requireAnyPermission(USER_SCREENS, 'create') }, async (request) => {
    if (!request.user) throw unauthorized();

    const body = parseBody(
      z.object({
        /**
         * Required, always.
         *
         * Every login belongs to a person in the directory, so the audit trail can
         * always resolve to a real human rather than an account called "admin2".
         */
        staffId: z.number().int().positive(),
        email: z.email('Emel tidak sah').max(190),
        accountType: z.enum(['admin', 'staff']).default('admin'),
        roleId: z.number().int().positive(),
        // The floor is a hard minimum; the configured length is checked below, where the
        // policy can be read. Kept here as well so an obviously short value is refused by
        // validation rather than reaching the handler.
        password: z.string().min(8).max(200),
        allowAppCheckIn: z.boolean().default(false),
      }),
      request.body,
    );

    await assertPasswordAcceptable(body.password);

    // Checked against the type being asked for, not against a shared "users"
    // permission. Otherwise the endpoint that issues staff app logins is also the
    // one that mints administrators.
    assertCan(request.user, userScreen(body.accountType), 'create');

    const staff = await db().staff.findUnique({ where: { id: body.staffId } });
    if (!staff) throw notFound('Staf tidak dijumpai');

    const existingForStaff = await db().userAccount.findUnique({ where: { staffId: body.staffId } });
    if (existingForStaff) {
      // One account per person, so a single individual cannot split their own
      // audit trail across two logins.
      throw conflict(`${staff.fullName} sudah mempunyai akaun (${existingForStaff.email})`);
    }

    const emailClash = await db().userAccount.findUnique({
      where: { email: body.email.toLowerCase() },
    });
    if (emailClash) throw conflict('Emel ini sudah digunakan');

    const account = await db().userAccount.create({
      data: {
        staffId: body.staffId,
        email: body.email.toLowerCase(),
        accountType: body.accountType,
        // Administrators start active; staff app accounts are claimed by the
        // person before they become usable.
        status: body.accountType === 'admin' ? 'active' : 'pending',
        passwordHash: await hashPassword(body.password),
        roleId: body.roleId,
        allowAppCheckIn: body.allowAppCheckIn,
      },
    });

    await db().auditLog.create({
      data: {
        accountId: request.user.accountId,
        actorLabel: request.user.fullName,
        action: 'create',
        entityType: 'UserAccount',
        entityId: String(account.id),
        changes: JSON.parse(
          JSON.stringify({ email: { before: null, after: account.email } }),
        ) as object,
      },
    });

    return jsonSafe({
      id: account.id,
      noteKey:
        body.accountType === 'admin' && env.REQUIRE_ADMIN_2FA
          ? ('users.create.needs2fa' satisfies LabelKey)
          : undefined,
    });
  });

  app.patch('/api/users/:id', { preHandler: requireAnyPermission(USER_SCREENS, 'view') }, async (request) => {
    if (!request.user) throw unauthorized();

    const id = idParam(request.params);
    const body = parseBody(
      z.object({
        roleId: z.number().int().positive().optional(),
        status: z.enum(['active', 'pending', 'suspended']).optional(),
        allowAppCheckIn: z.boolean().optional(),
        password: z.string().min(8).max(200).optional(),
        /** Clears the device binding so a replacement phone can be paired. */
        resetDeviceBinding: z.boolean().optional(),
      }),
      request.body,
    );

    if (body.password !== undefined) await assertPasswordAcceptable(body.password);

    const existing = await db().userAccount.findUnique({
      where: { id },
      include: { role: true, staff: { select: { fullName: true } } },
    });
    if (!existing) throw notFound('Akaun tidak dijumpai');

    /**
     * Each field carries its own permission.
     *
     * Suspending an account, resetting its password and releasing its device
     * binding are different acts with different consequences, so a role can be
     * given one without the others. A single blanket `edit` would make "can unlock
     * a locked-out nurse" and "can change an administrator's password" the same
     * grant.
     */
    const screen = userScreen(existing.accountType);
    if (body.roleId !== undefined || body.allowAppCheckIn !== undefined) {
      assertCan(request.user, screen, 'edit');
    }
    if (body.status === 'suspended') assertCan(request.user, screen, 'suspend');
    if (body.status === 'active') assertCan(request.user, screen, 'activate');
    if (body.status === 'pending') assertCan(request.user, screen, 'edit');
    if (body.password !== undefined) assertCan(request.user, screen, 'reset');
    if (body.resetDeviceBinding === true) assertCan(request.user, screen, 'unbind');

    /**
     * Refuses to suspend your own login.
     *
     * The operator doing this is the one holding the session; suspending it takes
     * effect on the next request and leaves nobody able to undo it except through
     * the database. A second administrator must perform the suspension.
     */
    if (body.status !== undefined && body.status !== 'active' && id === request.user.accountId) {
      throw conflict(
        'Anda tidak boleh menggantung akaun anda sendiri. Minta admin lain melakukannya.',
      );
    }

    // Keeps at least one usable administrator. Suspending the last one, or moving
    // it to a role without settings access, locks everyone out of this screen.
    if (
      existing.accountType === 'admin' &&
      ((body.status !== undefined && body.status !== 'active') || body.roleId !== undefined)
    ) {
      await assertAdminRemains(id, body);
    }

    await db().userAccount.update({
      where: { id },
      data: {
        ...(body.roleId !== undefined ? { roleId: body.roleId } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.allowAppCheckIn !== undefined ? { allowAppCheckIn: body.allowAppCheckIn } : {}),
        ...(body.password !== undefined ? { passwordHash: await hashPassword(body.password) } : {}),
        ...(body.resetDeviceBinding === true ? { boundDeviceId: null, boundDeviceAt: null } : {}),
        // Any of these changes clears a lockout: an operator acting on the account
        // is the intervention the lockout was waiting for.
        ...(body.status !== undefined || body.password !== undefined
          ? { lockedUntil: null, failedLoginCount: 0 }
          : {}),
      },
    });

    // Changing a password or suspending an account must end existing sessions,
    // otherwise the person carries on with the session they already hold.
    if (body.password !== undefined || body.status === 'suspended') {
      await db().session.updateMany({
        where: { accountId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await db().auditLog.create({
      data: {
        accountId: request.user.accountId,
        actorLabel: request.user.fullName,
        action: 'update',
        entityType: 'UserAccount',
        entityId: String(id),
        changes: JSON.parse(
          JSON.stringify({
            ...(body.status !== undefined
              ? { status: { before: existing.status, after: body.status } }
              : {}),
            ...(body.roleId !== undefined
              ? { role: { before: existing.role.name, after: body.roleId } }
              : {}),
            ...(body.allowAppCheckIn !== undefined
              ? { allowAppCheckIn: { before: existing.allowAppCheckIn, after: body.allowAppCheckIn } }
              : {}),
            // The value is never recorded, only that it moved.
            ...(body.password !== undefined
              ? { password: { before: '[redacted]', after: '[reset]' } }
              : {}),
            ...(body.resetDeviceBinding === true
              ? { boundDevice: { before: existing.boundDeviceId, after: null } }
              : {}),
          }),
        ) as object,
      },
    });

    return jsonSafe({ id, staffName: existing.staff.fullName });
  });

  // -------------------------------------------------------------------------
  // App clients
  // -------------------------------------------------------------------------

  app.get('/api/app-clients', { preHandler: requirePermission('settings.users.apps', 'view') }, async () => {
    const rows = await db().appClient.findMany({ orderBy: { name: 'asc' } });
    // The secret hash never leaves the server.
    return jsonSafe(rows.map(({ secretHash: _omitted, ...row }) => row));
  });

  app.post('/api/app-clients', { preHandler: requirePermission('settings.users.apps', 'create') }, async (request) => {
    const body = parseBody(
      z.object({
        name: z.string().trim().min(1).max(120),
        platform: z.enum(['android', 'ios', 'web']),
        minVersion: z.union([z.literal(''), z.string().trim().max(32)]).optional(),
      }),
      request.body,
    );

    const { randomBytes } = await import('node:crypto');
    const clientId = `app_${body.platform.slice(0, 3)}_${randomBytes(8).toString('hex')}`;
    const secret = randomBytes(24).toString('base64url');

    const row = await db().appClient.create({
      data: {
        name: body.name,
        platform: body.platform,
        clientId,
        secretHash: await hashPassword(secret),
        minVersion: body.minVersion && body.minVersion.length > 0 ? body.minVersion : null,
      },
    });

    // The only time the secret is ever visible. Stored hashed, like a password.
    return jsonSafe({
      id: row.id,
      clientId,
      secret,
      noteKey: 'users.apps.secret.issued' satisfies LabelKey,
    });
  });

  /**
   * Suspends a client, raises its minimum version, or rotates its secret.
   *
   * Revocation has to exist for the same reason the secret is only shown once: a
   * build that has leaked its credential must be stoppable without waiting for
   * every handset to be reinstalled. Raising `minVersion` is the softer form of
   * the same control — it forces an update rather than cutting access off.
   */
  app.patch('/api/app-clients/:id', { preHandler: requirePermission('settings.users.apps', 'view') }, async (request) => {
    if (!request.user) throw unauthorized();

    const id = idParam(request.params);
    const body = parseBody(
      z.object({
        status: z.enum(['active', 'suspended']).optional(),
        minVersion: z.union([z.literal(''), z.string().trim().max(32)]).optional(),
        rotateSecret: z.boolean().optional(),
      }),
      request.body,
    );

    if (body.minVersion !== undefined) assertCan(request.user, 'settings.users.apps', 'edit');
    if (body.status === 'suspended') assertCan(request.user, 'settings.users.apps', 'suspend');
    if (body.status === 'active') assertCan(request.user, 'settings.users.apps', 'activate');
    if (body.rotateSecret === true) assertCan(request.user, 'settings.users.apps', 'rotate');

    const existing = await db().appClient.findUnique({ where: { id } });
    if (!existing) throw notFound('Klien app tidak dijumpai');

    let secret: string | undefined;
    if (body.rotateSecret === true) {
      const { randomBytes } = await import('node:crypto');
      secret = randomBytes(24).toString('base64url');
    }

    await db().appClient.update({
      where: { id },
      data: {
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.minVersion !== undefined
          ? { minVersion: body.minVersion.length > 0 ? body.minVersion : null }
          : {}),
        ...(secret !== undefined ? { secretHash: await hashPassword(secret) } : {}),
      },
    });

    await db().auditLog.create({
      data: {
        accountId: request.user.accountId,
        actorLabel: request.user.fullName,
        action: 'update',
        entityType: 'AppClient',
        entityId: String(id),
        changes: JSON.parse(
          JSON.stringify({
            ...(body.status !== undefined
              ? { status: { before: existing.status, after: body.status } }
              : {}),
            ...(body.minVersion !== undefined
              ? { minVersion: { before: existing.minVersion, after: body.minVersion } }
              : {}),
            ...(secret !== undefined ? { secret: { before: '[redacted]', after: '[rotated]' } } : {}),
          }),
        ) as object,
      },
    });

    return jsonSafe({
      id,
      ...(secret !== undefined
        ? { secret, noteKey: 'users.apps.secret.rotated' satisfies LabelKey }
        : {}),
    });
  });

  /** Same two-step rule as accounts: suspend first, then remove. */
  app.delete(
    '/api/app-clients/:id',
    { preHandler: requirePermission('settings.users.apps', 'delete') },
    async (request) => {
      if (!request.user) throw unauthorized();

      const id = idParam(request.params);
      const existing = await db().appClient.findUnique({ where: { id } });
      if (!existing) throw notFound('Klien app tidak dijumpai');

      if (existing.status !== 'suspended') {
        throw conflict(
          'Gantung klien ini dahulu. Membuangnya secara terus akan memutuskan setiap ' +
            'telefon yang masih menggunakan secret itu tanpa amaran.',
        );
      }

      await db().appClient.delete({ where: { id } });

      await db().auditLog.create({
        data: {
          accountId: request.user.accountId,
          actorLabel: request.user.fullName,
          action: 'delete',
          entityType: 'AppClient',
          entityId: String(id),
          changes: JSON.parse(
            JSON.stringify({ clientId: { before: existing.clientId, after: null } }),
          ) as object,
          reason: `Klien "${existing.name}" dibuang`,
        },
      });

      await recordActivity({
        request,
        action: 'appclient.delete',
        category: 'users',
        level: 'warn',
        detail: `${existing.name} (${existing.clientId})`,
      });

      return { ok: true };
    },
  );

  // -------------------------------------------------------------------------
  // Retention
  // -------------------------------------------------------------------------

  /**
   * What the policy would remove, before it removes anything.
   *
   * Offered as its own read so an operator can see the real figures against real
   * data before switching the schedule on. "Delete everything older than 24 months"
   * means nothing until you know it is 180,000 rows and the oldest one is from 2024.
   */
  app.get(
    '/api/retention',
    { preHandler: requirePermission('settings.maintenance', 'view') },
    async () => jsonSafe(await previewPurge()),
  );

  app.post(
    '/api/retention/run',
    { preHandler: requirePermission('settings.maintenance', 'purge') },
    async (request) => {
      if (!request.user) throw unauthorized();

      const outcome = await runPurge({
        accountId: request.user.accountId,
        label: request.user.fullName,
      });

      return jsonSafe({
        ...outcome,
        noteKey: outcome.incomplete
          ? ('maintenance.retention.purge.incomplete' satisfies LabelKey)
          : undefined,
      });
    },
  );

  // -------------------------------------------------------------------------
  // Logs
  // -------------------------------------------------------------------------

  const activityQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(30),
    level: z.enum(['info', 'warn', 'error', 'debug']).optional(),
    category: z.string().trim().max(32).optional(),
    source: z.enum(['web', 'terminal', 'app', 'system']).optional(),
    accountId: z.coerce.number().int().positive().optional(),
    search: z.string().trim().max(190).optional(),
    from: z.string().trim().max(10).optional(),
    to: z.string().trim().max(10).optional(),
  });

  app.get('/api/logs/activity', { preHandler: requirePermission('settings.logs.activity', 'view') }, async (request) => {
    const query = activityQuery.parse(request.query);

    // Built without the level predicate as well as with it: the severity counters
    // have to keep showing what the other levels hold, otherwise clicking WARN
    // zeroes ERROR and the row disappears rather than becoming reachable.
    const withoutLevel = activityWhere({ ...query, level: undefined });
    const where = activityWhere(query);

    const [total, rows, levelCounts, categoryCounts, actorCounts] = await Promise.all([
      db().activityLog.count({ where }),
      db().activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      db().activityLog.groupBy({ by: ['level'], where: withoutLevel, _count: { _all: true } }),
      db().activityLog.groupBy({
        by: ['category'],
        where: activityWhere({ ...query, category: undefined }),
        _count: { _all: true },
      }),
      db().activityLog.groupBy({
        by: ['accountId', 'actorLabel'],
        where: activityWhere({ ...query, accountId: undefined }),
        _count: { _all: true },
        orderBy: { _count: { accountId: 'desc' } },
        take: 50,
      }),
    ]);

    const levels: Record<string, number> = { info: 0, warn: 0, error: 0, debug: 0 };
    for (const row of levelCounts) levels[row.level] = row._count._all;

    return jsonSafe({
      total,
      page: query.page,
      pageSize: query.pageSize,
      rows,
      /** Drives the severity chips. */
      levels,
      categories: categoryCounts
        .map((row) => ({ key: row.category, count: row._count._all }))
        .sort((left, right) => right.count - left.count),
      actors: actorCounts
        .filter((row) => row.accountId !== null)
        .map((row) => ({
          accountId: row.accountId as number,
          label: row.actorLabel,
          count: row._count._all,
        })),
      /** Shown in the footer, so a stale page is visibly stale. */
      generatedAt: new Date().toISOString(),
    });
  });

  /**
   * CSV of the current filter.
   *
   * Exports the filtered set rather than the visible page: an operator narrowing to
   * one account over one week wants those rows, not the thirty in front of them.
   * Capped, because an unbounded export of this table is a way to exhaust memory.
   */
  app.get(
    '/api/logs/activity/export',
    { preHandler: requirePermission('settings.logs.activity', 'export') },
    async (request, reply) => {
      const query = activityQuery.parse(request.query);
      const rows = await db().activityLog.findMany({
        where: activityWhere(query),
        orderBy: { createdAt: 'desc' },
        take: 20_000,
      });

      await recordActivity({
        request,
        action: 'logs.export',
        category: 'settings',
        detail: `Log aktiviti: ${String(rows.length)} baris`,
      });

      const csv = toCsv(
        ['Masa', 'Tahap', 'Kategori', 'Sumber', 'Tindakan', 'Butiran', 'Pengguna', 'IP', 'Laluan'],
        rows.map((row) => [
          formatStamp(row.createdAt),
          row.level,
          row.category,
          row.source,
          row.action,
          row.detail ?? '',
          row.actorLabel,
          row.ipAddress ?? '',
          row.path ?? '',
        ]),
      );

      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="log-aktiviti-${stampSlug()}.csv"`)
        .send(csv);
    },
  );

  /**
   * What changed, from what, to what, and why.
   *
   * Append-only: there is no create, update or delete route for this table
   * anywhere, which is what makes it usable when a pay figure is challenged.
   */
  const auditQuery = z.object({
    entityType: z.string().trim().max(64).optional(),
    entityId: z.string().trim().max(64).optional(),
    action: z.enum(['create', 'update', 'delete']).optional(),
    accountId: z.coerce.number().int().positive().optional(),
    search: z.string().trim().max(190).optional(),
    from: z.string().trim().max(10).optional(),
    to: z.string().trim().max(10).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(30),
  });

  app.get('/api/logs/audit', { preHandler: requirePermission('settings.logs.audit', 'view') }, async (request) => {
    const query = auditQuery.parse(request.query);
    const where = auditWhere(query);

    const [total, rows, actionCounts, entityCounts, actorCounts] = await Promise.all([
      db().auditLog.count({ where }),
      db().auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      db().auditLog.groupBy({
        by: ['action'],
        where: auditWhere({ ...query, action: undefined }),
        _count: { _all: true },
      }),
      db().auditLog.groupBy({
        by: ['entityType'],
        where: auditWhere({ ...query, entityType: undefined }),
        _count: { _all: true },
      }),
      db().auditLog.groupBy({
        by: ['accountId', 'actorLabel'],
        where: auditWhere({ ...query, accountId: undefined }),
        _count: { _all: true },
        orderBy: { _count: { accountId: 'desc' } },
        take: 50,
      }),
    ]);

    const actions: Record<string, number> = { create: 0, update: 0, delete: 0 };
    for (const row of actionCounts) actions[row.action] = row._count._all;

    return jsonSafe({
      total,
      page: query.page,
      pageSize: query.pageSize,
      rows,
      actions,
      entityTypes: entityCounts
        .map((row) => ({ key: row.entityType, count: row._count._all }))
        .sort((left, right) => right.count - left.count),
      actors: actorCounts
        .filter((row) => row.accountId !== null)
        .map((row) => ({
          accountId: row.accountId as number,
          label: row.actorLabel,
          count: row._count._all,
        })),
      generatedAt: new Date().toISOString(),
    });
  });

  app.get(
    '/api/logs/audit/export',
    { preHandler: requirePermission('settings.logs.audit', 'export') },
    async (request, reply) => {
      const query = auditQuery.parse(request.query);
      const rows = await db().auditLog.findMany({
        where: auditWhere(query),
        orderBy: { createdAt: 'desc' },
        take: 20_000,
      });

      await recordActivity({
        request,
        action: 'logs.export',
        category: 'settings',
        detail: `Log audit: ${String(rows.length)} baris`,
      });

      const csv = toCsv(
        ['Masa', 'Tindakan', 'Jenis', 'ID', 'Pelaku', 'Perubahan', 'Sebab', 'IP'],
        rows.map((row) => [
          formatStamp(row.createdAt),
          row.action,
          row.entityType,
          row.entityId,
          row.actorLabel,
          row.changes === null ? '' : JSON.stringify(row.changes),
          row.reason ?? '',
          row.ipAddress ?? '',
        ]),
      );

      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="log-audit-${stampSlug()}.csv"`)
        .send(csv);
    },
  );
}

/** Shared predicate builder, so the list and its facet counts cannot diverge. */
function activityWhere(query: {
  level?: string;
  category?: string;
  source?: string;
  accountId?: number;
  search?: string;
  from?: string;
  to?: string;
}): Record<string, unknown> {
  return {
    ...(query.level ? { level: query.level } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.accountId !== undefined ? { accountId: query.accountId } : {}),
    ...dateRange(query.from, query.to),
    ...(query.search
      ? {
          OR: [
            { detail: { contains: query.search } },
            { actorLabel: { contains: query.search } },
            { action: { contains: query.search } },
            { ipAddress: { contains: query.search } },
            { path: { contains: query.search } },
          ],
        }
      : {}),
  };
}

function auditWhere(query: {
  entityType?: string;
  entityId?: string;
  action?: string;
  accountId?: number;
  search?: string;
  from?: string;
  to?: string;
}): Record<string, unknown> {
  return {
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.accountId !== undefined ? { accountId: query.accountId } : {}),
    ...dateRange(query.from, query.to),
    ...(query.search
      ? {
          OR: [
            { actorLabel: { contains: query.search } },
            { entityType: { contains: query.search } },
            { entityId: { contains: query.search } },
            { reason: { contains: query.search } },
            { ipAddress: { contains: query.search } },
          ],
        }
      : {}),
  };
}

/**
 * Inclusive day range.
 *
 * `to` is pushed to the end of its day, because a user picking the same date in both
 * boxes means "that day" and would otherwise match nothing.
 */
function dateRange(from?: string, to?: string): Record<string, unknown> {
  if (!from && !to) return {};
  const createdAt: Record<string, Date> = {};
  if (from) createdAt['gte'] = new Date(`${from}T00:00:00`);
  if (to) createdAt['lte'] = new Date(`${to}T23:59:59.999`);
  return { createdAt };
}

/**
 * CSV with a UTF-8 BOM.
 *
 * The BOM is what stops Excel mangling Malay names on open, the same reason the
 * staff import template carries one.
 */
function toCsv(headers: string[], rows: string[][]): string {
  const escape = (value: string): string =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const lines = [headers.map(escape).join(',')];
  for (const row of rows) lines.push(row.map(escape).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function formatStamp(when: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${String(when.getFullYear())}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ` +
    `${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`
  );
}

function stampSlug(): string {
  return formatStamp(new Date()).replace(/[: ]/g, '-');
}

/**
 * Refuses any grant that would allow the device log to be altered.
 *
 * Enforced server-side rather than only hidden in the UI, because the permission
 * map is free-form JSON and a crafted request would otherwise slip through.
 */
/**
 * Refuses a change that would leave no administrator able to reach this screen.
 *
 * Counts accounts other than the one being edited that are active, of type admin,
 * and hold `settings.update`. Checking the permission rather than the role name
 * matters because a custom role can be the only administrative one in a given
 * deployment.
 */
async function assertAdminRemains(
  accountId: number,
  change: { status?: string; roleId?: number },
): Promise<void> {
  const others = await db().userAccount.findMany({
    where: { id: { not: accountId }, accountType: 'admin', status: 'active' },
    select: { role: { select: { permissions: true } } },
  });

  const stillCapable = others.some((row) => grantsRoleAdmin(row.role.permissions));
  if (stillCapable) return;

  // The edit is only a problem if it is what removes the capability.
  if (change.roleId !== undefined && change.status === undefined) {
    const target = await db().role.findUnique({ where: { id: change.roleId } });
    if (target && grantsRoleAdmin(target.permissions)) return;
  }

  throw conflict(
    'Ini akaun admin terakhir yang masih boleh menguruskan peranan. Cipta atau aktifkan ' +
      'admin lain dahulu, jika tidak tiada sesiapa boleh membetulkannya semula.',
  );
}

/**
 * Whether a permission map can still repair role configuration.
 *
 * Keyed on `settings.roles:edit` rather than on a role name, because the only role
 * that matters here is whichever one a given deployment uses for administration,
 * and that can be a custom one.
 */
function grantsRoleAdmin(permissions: unknown): boolean {
  const map = (permissions ?? {}) as Record<string, string[]>;
  return (map['settings.roles'] ?? []).includes('edit');
}

/** Screens that back the two account tabs, for the outer gate on shared endpoints. */
const USER_SCREENS = ['settings.users.admin', 'settings.users.staff'];

function userScreen(accountType: string): string {
  return accountType === 'admin' ? 'settings.users.admin' : 'settings.users.staff';
}

/**
 * Drops empty and duplicate entries before storing.
 *
 * Keeps the saved shape a list of what the role can do. An empty array makes a role
 * read as configured for a screen it cannot touch, and that difference then shows in
 * the granted count on the roles list.
 */
function prunePermissions(permissions: Record<string, string[]>): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [key, actions] of Object.entries(permissions)) {
    const unique = [...new Set(actions)];
    if (unique.length > 0) result[key] = unique;
  }
  return result;
}

/** Translates a registry rejection into an HTTP conflict. */
function assertValidPermissions(permissions: Record<string, string[]>): void {
  try {
    validatePermissions(permissions);
  } catch (cause) {
    if (cause instanceof PermissionError) throw conflict(cause.message);
    throw cause;
  }
}

function idParam(params: unknown): number {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
  if (!parsed.success) throw notFound('Rekod tidak dijumpai');
  return parsed.data.id;
}
