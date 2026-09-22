import type { FastifyInstance } from 'fastify';
import type { LabelKey } from '@attendance/shared';
import { z } from 'zod';

import { invalidateApiSettings, rateLimitState } from '../api/guard.js';
import { availableScopes, issueToken, sanitiseScopes } from '../api/tokens.js';
import {
  SIGNATURE_TOLERANCE_SECONDS,
  checkTarget,
  deliver,
  generateWebhookSecret,
} from '../api/webhooks.js';
import { requirePermission } from '../auth/plugin.js';
import { encryptSecret } from '../crypto.js';
import { db, jsonSafe } from '../db.js';
import { loadEnv } from '../env.js';
import { conflict, forUpdate, notFound, parseBody, unauthorized } from '../http.js';
import { recordActivity } from '../logging/activity.js';
import { NOTIFICATION_TRIGGERS, sanitiseTriggers } from '../notify/triggers.js';
import { DEFAULT_POLICY, invalidatePolicy, securityPolicy } from '../security/policy.js';

/**
 * Administration of the public API, its tokens, the webhook subscriptions and the
 * authentication policy.
 *
 * Reached with a session and a permission, unlike the API it configures. A token must
 * never be able to widen its own scopes or read another one, which is why none of this
 * lives behind `requireApiScope`.
 */
export async function apiAdminRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // API configuration
  // -------------------------------------------------------------------------

  app.get(
    '/api/api-config',
    { preHandler: requirePermission('settings.integration.api', 'view') },
    async () => {
      const row = await db().apiConfig.findUnique({ where: { id: 1 } });
      const env = loadEnv();

      return jsonSafe({
        enabled: row?.enabled ?? false,
        requireToken: row?.requireToken ?? true,
        logRequests: row?.logRequests ?? true,
        allowAllOrigins: row?.allowAllOrigins ?? false,
        allowedOrigins: list(row?.allowedOrigins),
        rateLimitEnabled: row?.rateLimitEnabled ?? true,
        maxPerMinute: row?.maxPerMinute ?? 120,
        ipWhitelist: list(row?.ipWhitelist),
        /** Read-only, so the screen can show what a caller should point at. */
        baseUrl: '/api/public',
        /*
          Three of these state a literal scope name, which is a stored value an operator
          matches character for character and is not translated. `whoami` requires no
          particular scope, so its requirement is prose — and prose arrives as a key.
        */
        endpoints: [
          {
            method: 'GET',
            path: '/api/public/whoami',
            scopeKey: 'api.scope.anyToken' satisfies LabelKey,
          },
          { method: 'GET', path: '/api/public/staff', scope: 'staff.directory:view' },
          { method: 'GET', path: '/api/public/attendance', scope: 'attendance.records:view' },
          { method: 'GET', path: '/api/public/leave', scope: 'schedule.leave:view' },
        ],
        // Stated because it changes what these settings are worth: on a LAN install the
        // API is only reachable from inside the hospital network to begin with.
        connectorMode: env.CONNECTOR_MODE,
      });
    },
  );

  const configSchema = z.object({
    enabled: z.boolean(),
    requireToken: z.boolean(),
    logRequests: z.boolean(),
    allowAllOrigins: z.boolean(),
    allowedOrigins: z.array(z.string().trim().max(200)).max(50),
    rateLimitEnabled: z.boolean(),
    maxPerMinute: z.coerce.number().int().min(1).max(100_000),
    ipWhitelist: z.array(z.string().trim().max(64)).max(100),
  });

  app.put(
    '/api/api-config',
    { preHandler: requirePermission('settings.integration.api', 'edit') },
    async (request) => {
      const body = parseBody(configSchema, request.body);

      /**
       * Serving the API unauthenticated is allowed but not by accident.
       *
       * A read-only feed on an isolated VLAN is a legitimate arrangement. Enabled with no
       * token requirement and no address filter is not — that is the whole staff directory
       * available to anything that can route to the port.
       */
      if (body.enabled && !body.requireToken && body.ipWhitelist.length === 0) {
        throw conflict(
          'API tidak boleh dihidupkan tanpa token DAN tanpa senarai putih IP. ' +
            'Itu bermakna direktori staf terbuka kepada apa-apa yang boleh menghubungi port ini. ' +
            'Hidupkan "Perlukan token", atau hadkan kepada alamat tertentu.',
        );
      }

      // Rejected here rather than silently dropped, so a typo in a CIDR does not read as
      // an address that simply never matches.
      for (const entry of body.ipWhitelist) {
        if (!looksLikeAddressOrCidr(entry)) {
          throw conflict(`"${entry}" bukan alamat IP atau CIDR yang sah.`);
        }
      }
      for (const origin of body.allowedOrigins) {
        if (!/^https?:\/\/[^/]+$/i.test(origin)) {
          throw conflict(
            `"${origin}" bukan origin yang sah. Bentuknya skema dan host tanpa laluan, ` +
              'contohnya https://portal.hospital.local',
          );
        }
      }

      const data = {
        enabled: body.enabled,
        requireToken: body.requireToken,
        logRequests: body.logRequests,
        allowAllOrigins: body.allowAllOrigins,
        allowedOrigins: body.allowedOrigins,
        rateLimitEnabled: body.rateLimitEnabled,
        maxPerMinute: body.maxPerMinute,
        ipWhitelist: body.ipWhitelist,
      };

      await db().apiConfig.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
      invalidateApiSettings();

      await recordActivity({
        request,
        action: 'api.config_update',
        category: 'integration',
        // A warning rather than routine: this changes who can reach the data.
        level: body.enabled ? 'warn' : 'info',
        detail:
          `${body.enabled ? 'dihidupkan' : 'dimatikan'} · ` +
          `token ${body.requireToken ? 'wajib' : 'TIDAK wajib'} · ` +
          `had ${body.rateLimitEnabled ? String(body.maxPerMinute) + '/min' : 'tiada'} · ` +
          `${String(body.ipWhitelist.length)} entri senarai putih`,
      });

      return jsonSafe({ ok: true });
    },
  );

  // -------------------------------------------------------------------------
  // Tokens
  // -------------------------------------------------------------------------

  app.get(
    '/api/api-tokens',
    { preHandler: requirePermission('settings.integration.api', 'view') },
    async () => {
      const rows = await db().apiToken.findMany({ orderBy: [{ createdAt: 'desc' }] });
      const now = new Date();

      return jsonSafe({
        scopes: availableScopes(),
        tokens: rows.map((row) => ({
          id: row.id,
          name: row.name,
          // The prefix, never the token. There is no endpoint that returns the value: it
          // exists once, in the response to the request that created it.
          prefix: row.prefix,
          scopes: sanitiseScopes(row.scopes),
          expiresAt: row.expiresAt,
          revokedAt: row.revokedAt,
          supersededAt: row.supersededAt,
          graceUntil: row.graceUntil,
          rotatedToPrefix: row.rotatedToPrefix,
          lastUsedAt: row.lastUsedAt,
          lastUsedIp: row.lastUsedIp,
          requestCount: row.requestCount,
          createdAt: row.createdAt,
          status: tokenStatus(row, now),
          /** What this token has spent of the current minute, for the status panel. */
          rateWindow: rateLimitState(`token:${String(row.id)}`),
        })),
      });
    },
  );

  app.post(
    '/api/api-tokens',
    { preHandler: requirePermission('settings.integration.api', 'create') },
    async (request) => {
      if (!request.user) throw unauthorized();

      const body = parseBody(
        z.object({
          name: z.string().trim().min(1).max(120),
          scopes: z.array(z.string().trim().max(64)).min(1).max(80),
          /** Null for no expiry, which is allowed and labelled as such on the screen. */
          expiresInDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
        }),
        request.body,
      );

      const scopes = sanitiseScopes(body.scopes);
      if (scopes.length === 0) {
        throw conflict('Tiada skop sah dipilih. Token tanpa skop tidak boleh membaca apa-apa.');
      }

      const policy = await securityPolicy();
      const days =
        body.expiresInDays === undefined
          ? policy.tokenDefaultDays
          : body.expiresInDays;

      const issued = issueToken();
      const row = await db().apiToken.create({
        data: {
          name: body.name,
          prefix: issued.prefix,
          tokenHash: issued.tokenHash,
          scopes,
          expiresAt:
            days === null || days === 0 ? null : new Date(Date.now() + days * 86_400_000),
          createdBy: request.user.accountId,
        },
      });

      await recordActivity({
        request,
        action: 'api.token_create',
        category: 'integration',
        level: 'warn',
        detail: `${row.prefix} · ${row.name} · ${String(scopes.length)} skop · ${scopes.join(', ')}`,
      });

      return jsonSafe({
        id: row.id,
        prefix: row.prefix,
        expiresAt: row.expiresAt,
        /**
         * The only time this value exists outside the caller's hands.
         *
         * Not stored in a readable form and not retrievable afterwards. If it is lost the
         * answer is to rotate, which is why rotation exists as a first-class action.
         */
        token: issued.token,
      });
    },
  );

  app.post(
    '/api/api-tokens/:id/revoke',
    { preHandler: requirePermission('settings.integration.api', 'edit') },
    async (request) => {
      const id = idParam(request.params);
      const existing = await db().apiToken.findUnique({ where: { id } });
      if (!existing) throw notFound('Token tidak dijumpai');
      if (existing.revokedAt !== null) throw conflict('Token ini sudah dibatalkan.');

      await db().apiToken.update({ where: { id }, data: { revokedAt: new Date() } });

      await recordActivity({
        request,
        action: 'api.token_revoke',
        category: 'integration',
        level: 'warn',
        detail: `${existing.prefix} · ${existing.name} · berkuat kuasa serta-merta`,
      });

      return jsonSafe({ ok: true });
    },
  );

  /**
   * Issues a replacement and lets the old one run out.
   *
   * The alternative — revoke and create — leaves every caller failing between the two
   * steps. Here the old token keeps working for the grace window, so a deployment can pick
   * up the new value on its own schedule and the old one simply stops afterwards.
   */
  app.post(
    '/api/api-tokens/:id/rotate',
    { preHandler: requirePermission('settings.integration.api', 'create') },
    async (request) => {
      if (!request.user) throw unauthorized();

      const id = idParam(request.params);
      const existing = await db().apiToken.findUnique({ where: { id } });
      if (!existing) throw notFound('Token tidak dijumpai');
      if (existing.revokedAt !== null) throw conflict('Token yang dibatalkan tidak boleh diputar.');
      if (existing.supersededAt !== null) {
        throw conflict('Token ini sudah diputar. Gunakan penggantinya.');
      }

      const policy = await securityPolicy();
      const issued = issueToken();
      const graceUntil = new Date(Date.now() + policy.rotationGraceHours * 3_600_000);

      const replacement = await db().apiToken.create({
        data: {
          name: existing.name,
          prefix: issued.prefix,
          tokenHash: issued.tokenHash,
          // Carried over rather than re-chosen: rotation replaces a credential, it is not
          // an opportunity to quietly change what the credential can do.
          scopes: sanitiseScopes(existing.scopes),
          expiresAt: existing.expiresAt,
          createdBy: request.user.accountId,
        },
      });

      await db().apiToken.update({
        where: { id },
        data: {
          supersededAt: new Date(),
          graceUntil,
          rotatedToPrefix: replacement.prefix,
        },
      });

      await recordActivity({
        request,
        action: 'api.token_rotate',
        category: 'integration',
        level: 'warn',
        detail:
          `${existing.prefix} → ${replacement.prefix} · ${existing.name} · ` +
          `token lama sah sehingga ${graceUntil.toISOString()}`,
      });

      return jsonSafe({
        id: replacement.id,
        prefix: replacement.prefix,
        expiresAt: replacement.expiresAt,
        graceUntil,
        token: issued.token,
      });
    },
  );

  app.delete(
    '/api/api-tokens/:id',
    { preHandler: requirePermission('settings.integration.api', 'delete') },
    async (request) => {
      const id = idParam(request.params);
      const existing = await db().apiToken.findUnique({ where: { id } });
      if (!existing) throw notFound('Token tidak dijumpai');

      /**
       * A live token is revoked, not deleted.
       *
       * Deleting the row removes the only record of what the token was allowed to do,
       * while the activity log still refers to its prefix. Revoke first, then the row can
       * go once it is no longer the answer to a question.
       */
      if (existing.revokedAt === null) {
        throw conflict(
          'Batalkan token ini dahulu. Membuang barisnya sekarang akan menghilangkan ' +
            'rekod apa yang dibenarkannya, sedangkan log aktiviti masih merujuk prefiksnya.',
        );
      }

      await db().apiToken.delete({ where: { id } });

      await recordActivity({
        request,
        action: 'api.token_delete',
        category: 'integration',
        detail: `${existing.prefix} · ${existing.name}`,
      });

      return { ok: true };
    },
  );

  // -------------------------------------------------------------------------
  // Webhooks
  // -------------------------------------------------------------------------

  app.get(
    '/api/webhooks',
    { preHandler: requirePermission('settings.integration.api', 'view') },
    async () => {
      const rows = await db().webhook.findMany({ orderBy: [{ createdAt: 'desc' }] });

      return jsonSafe({
        triggers: NOTIFICATION_TRIGGERS,
        signature: {
          header: 'X-Kehadiran-Signature',
          format: 't=<unix>,v1=<hmac-sha256 hex>',
          signedPayload: '<t>.<raw request body>',
          toleranceSeconds: SIGNATURE_TOLERANCE_SECONDS,
        },
        webhooks: rows.map(({ secretEncrypted, ...row }) => ({
          ...row,
          events: sanitiseTriggers(row.events),
          /** Presence only. The signing key is shown once, at creation. */
          secretSet: secretEncrypted.length > 0,
        })),
      });
    },
  );

  const webhookSchema = z.object({
    name: z.string().trim().min(1).max(120),
    url: z.string().trim().min(8).max(500),
    events: z.array(z.string().trim().max(48)).min(1).max(64),
    active: z.boolean().default(true),
  });

  app.post(
    '/api/webhooks',
    { preHandler: requirePermission('settings.integration.api', 'create') },
    async (request) => {
      const body = parseBody(webhookSchema, request.body);

      const events = sanitiseTriggers(body.events);
      if (events.length === 0) {
        throw conflict('Tiada peristiwa sah dipilih. Webhook tanpa peristiwa tidak akan dipanggil.');
      }

      // Checked before it is stored, so an unusable target is refused at the point the
      // operator can still see what they typed.
      const target = await checkTarget(body.url);
      if (!target.ok) throw conflict(target.reason ?? 'URL tidak dibenarkan.');

      const secret = generateWebhookSecret();
      const row = await db().webhook.create({
        data: {
          name: body.name,
          url: body.url,
          secretEncrypted: encryptSecret(secret),
          events,
          active: body.active,
        },
      });

      await recordActivity({
        request,
        action: 'webhook.create',
        category: 'integration',
        level: 'warn',
        detail: `${row.name} → ${row.url} (${target.resolved ?? '?'}) · ${events.join(', ')}`,
      });

      return jsonSafe({
        id: row.id,
        /** Shown once. The receiver needs it to verify signatures. */
        secret,
      });
    },
  );

  app.patch(
    '/api/webhooks/:id',
    { preHandler: requirePermission('settings.integration.api', 'edit') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(forUpdate(webhookSchema), request.body);

      const existing = await db().webhook.findUnique({ where: { id } });
      if (!existing) throw notFound('Webhook tidak dijumpai');

      if (body.url !== undefined) {
        const target = await checkTarget(body.url);
        if (!target.ok) throw conflict(target.reason ?? 'URL tidak dibenarkan.');
      }

      const events = body.events === undefined ? undefined : sanitiseTriggers(body.events);
      if (events !== undefined && events.length === 0) {
        throw conflict('Tiada peristiwa sah dipilih.');
      }

      const row = await db().webhook.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.url !== undefined ? { url: body.url } : {}),
          ...(events !== undefined ? { events } : {}),
          // Switching it back on clears the automatic disable, otherwise it would read as
          // active while still carrying the reason it was stopped.
          ...(body.active !== undefined
            ? body.active
              ? { active: true, failureCount: 0, disabledReason: null }
              : { active: false }
            : {}),
        },
      });

      await recordActivity({
        request,
        action: 'webhook.update',
        category: 'integration',
        detail: `${row.name} → ${row.url} · ${row.active ? 'aktif' : 'tidak aktif'}`,
      });

      return jsonSafe({ ok: true });
    },
  );

  /** Issues a new signing key. The old one stops working immediately. */
  app.post(
    '/api/webhooks/:id/regenerate-secret',
    { preHandler: requirePermission('settings.integration.api', 'edit') },
    async (request) => {
      const id = idParam(request.params);
      const existing = await db().webhook.findUnique({ where: { id } });
      if (!existing) throw notFound('Webhook tidak dijumpai');

      const secret = generateWebhookSecret();
      await db().webhook.update({ where: { id }, data: { secretEncrypted: encryptSecret(secret) } });

      await recordActivity({
        request,
        action: 'webhook.regenerate_secret',
        category: 'integration',
        level: 'warn',
        // Said plainly because the receiver breaks the moment this runs.
        detail: `${existing.name} · kunci lama tidak lagi sah`,
      });

      return jsonSafe({ secret });
    },
  );

  app.delete(
    '/api/webhooks/:id',
    { preHandler: requirePermission('settings.integration.api', 'delete') },
    async (request) => {
      const id = idParam(request.params);
      const existing = await db().webhook.findUnique({ where: { id } });
      if (!existing) throw notFound('Webhook tidak dijumpai');

      await db().webhook.delete({ where: { id } });

      await recordActivity({
        request,
        action: 'webhook.delete',
        category: 'integration',
        level: 'warn',
        detail: `${existing.name} → ${existing.url}`,
      });

      return { ok: true };
    },
  );

  /** Sends a real signed request, so the receiver can be checked end to end. */
  app.post(
    '/api/webhooks/:id/test',
    { preHandler: requirePermission('settings.integration.api', 'test') },
    async (request) => {
      const id = idParam(request.params);
      const existing = await db().webhook.findUnique({ where: { id } });
      if (!existing) throw notFound('Webhook tidak dijumpai');

      const outcome = await deliver(id, {
        trigger: 'webhook.test',
        data: {
          message: 'Ujian dari Sistem Kehadiran Hospital Sibu.',
          webhook: existing.name,
          sentAt: new Date().toISOString(),
        },
      });

      await recordActivity({
        request,
        action: 'webhook.test',
        category: 'integration',
        level: outcome.ok ? 'info' : 'warn',
        detail:
          `${existing.name} · ${outcome.ok ? 'berjaya' : 'gagal'} · ` +
          `cubaan ${String(outcome.attempt)} · ${outcome.error ?? `HTTP ${String(outcome.httpStatus)}`}`,
      });

      return jsonSafe(outcome);
    },
  );

  app.get(
    '/api/webhooks/:id/deliveries',
    { preHandler: requirePermission('settings.integration.api', 'view') },
    async (request) => {
      const id = idParam(request.params);
      const query = z
        .object({ limit: z.coerce.number().int().min(1).max(100).default(25) })
        .parse(request.query);

      const rows = await db().webhookDelivery.findMany({
        where: { webhookId: id },
        orderBy: { createdAt: 'desc' },
        take: query.limit,
      });

      return jsonSafe({
        deliveries: rows.map((row) => ({
          id: String(row.id),
          event: row.event,
          attempt: row.attempt,
          ok: row.ok,
          httpStatus: row.httpStatus,
          durationMs: row.durationMs,
          error: row.error,
          responseBody: row.responseBody,
          createdAt: row.createdAt,
        })),
      });
    },
  );

  // -------------------------------------------------------------------------
  // Security policy
  // -------------------------------------------------------------------------

  app.get(
    '/api/security-config',
    { preHandler: requirePermission('settings.security', 'view') },
    async () => {
      const policy = await securityPolicy();
      const env = loadEnv();
      const now = new Date();

      const [lockedAccounts, failedLastDay, activeTokens, expiringTokens, failingWebhooks] =
        await Promise.all([
          db().userAccount.count({ where: { lockedUntil: { gt: now } } }),
          db().activityLog.count({
            where: {
              action: 'auth.login_failed',
              createdAt: { gte: new Date(Date.now() - 86_400_000) },
            },
          }),
          db().apiToken.count({
            where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          }),
          db().apiToken.count({
            where: {
              revokedAt: null,
              expiresAt: { gt: now, lt: new Date(Date.now() + 14 * 86_400_000) },
            },
          }),
          db().webhook.count({ where: { failureCount: { gt: 0 } } }),
        ]);

      return jsonSafe({
        policy,
        defaults: DEFAULT_POLICY,
        /**
         * Fixed at deploy time, shown read-only.
         *
         * Presenting these as editable would be presenting a control that silently does
         * nothing: they are read once at boot and changing the row would not move them.
         */
        environment: {
          requireAdmin2fa: env.REQUIRE_ADMIN_2FA,
          sessionTtlHours: env.SESSION_TTL_HOURS,
          connectorMode: env.CONNECTOR_MODE,
          nodeEnv: env.NODE_ENV,
        },
        /** Live posture, so the screen is worth opening when nothing is being changed. */
        posture: {
          lockedAccounts,
          failedLoginsLastDay: failedLastDay,
          activeTokens,
          tokensExpiringSoon: expiringTokens,
          webhooksFailing: failingWebhooks,
        },
      });
    },
  );

  app.put(
    '/api/security-config',
    { preHandler: requirePermission('settings.security', 'edit') },
    async (request) => {
      const body = parseBody(
        z.object({
          // Floors rather than free numbers: one attempt locks a person out of their own
          // account on a typo, and a four-character minimum is not a password policy.
          maxFailedLogins: z.coerce.number().int().min(3).max(50),
          lockoutMinutes: z.coerce.number().int().min(1).max(1440),
          passwordMinLength: z.coerce.number().int().min(8).max(128),
          tokenDefaultDays: z.coerce.number().int().min(0).max(3650),
          rotationGraceHours: z.coerce.number().int().min(1).max(720),
        }),
        request.body,
      );

      await db().securityConfig.upsert({
        where: { id: 1 },
        create: { id: 1, ...body },
        update: body,
      });
      invalidatePolicy();

      await recordActivity({
        request,
        action: 'api.security_update',
        category: 'integration',
        level: 'warn',
        detail:
          `kunci selepas ${String(body.maxFailedLogins)} percubaan selama ${String(body.lockoutMinutes)} minit · ` +
          `kata laluan min ${String(body.passwordMinLength)} · ` +
          `token lalai ${body.tokenDefaultDays === 0 ? 'tanpa luput' : `${String(body.tokenDefaultDays)} hari`}`,
      });

      return jsonSafe({ ok: true });
    },
  );
}

function tokenStatus(
  row: {
    revokedAt: Date | null;
    expiresAt: Date | null;
    supersededAt: Date | null;
    graceUntil: Date | null;
  },
  now: Date,
): 'active' | 'revoked' | 'expired' | 'grace' | 'superseded' {
  if (row.revokedAt !== null) return 'revoked';
  if (row.expiresAt !== null && row.expiresAt <= now) return 'expired';
  if (row.supersededAt !== null) {
    return row.graceUntil !== null && row.graceUntil > now ? 'grace' : 'superseded';
  }
  return 'active';
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

/** A bare IPv4/IPv6 address, or either with a prefix length. */
function looksLikeAddressOrCidr(entry: string): boolean {
  const [address, bits] = entry.split('/');
  if (address === undefined || address.length === 0) return false;

  const v4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(address);
  const v6 = /^[0-9a-f:]+$/i.test(address) && address.includes(':');
  if (!v4 && !v6) return false;

  if (v4 && address.split('.').some((part) => Number(part) > 255)) return false;

  if (bits === undefined) return true;
  const length = Number(bits);
  return Number.isInteger(length) && length >= 0 && length <= (v4 ? 32 : 128);
}

function idParam(params: unknown): number {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
  if (!parsed.success) throw notFound('Rekod tidak dijumpai');
  return parsed.data.id;
}
