import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requirePermission } from '../auth/plugin.js';
import { encryptSecret } from '../crypto.js';
import { db, jsonSafe } from '../db.js';
import { conflict, forUpdate, notFound, parseBody } from '../http.js';
import { recordActivity } from '../logging/activity.js';
import {
  ENCRYPTION_MODES,
  PROVIDER_PRESETS,
  describeSmtpError,
  sendThroughProfile,
} from '../notify/email.js';

/**
 * Named SMTP senders.
 *
 * Several profiles rather than one set of settings, because the mail this system sends
 * comes from different parts of the hospital and a recipient has to be able to tell
 * which — and reply to the right mailbox.
 *
 * The password is write-only throughout: it is encrypted on the way in and no endpoint
 * here returns it, not even in ciphertext. What is returned instead is
 * `passwordSet`, which is all the form needs to say "stored, leave blank to keep".
 */
export async function emailProfileRoutes(app: FastifyInstance): Promise<void> {
  const profileSchema = z.object({
    // Lowercase and dash-separated so the value that appears in code stays predictable.
    key: z
      .string()
      .trim()
      .min(2)
      .max(32)
      .regex(/^[a-z][a-z0-9-]*$/, 'Kunci hanya boleh huruf kecil, nombor dan tanda sengkang'),
    name: z.string().trim().min(1).max(120),
    fromName: z.string().trim().min(1).max(120),
    fromEmail: z.string().trim().email().max(190),
    replyTo: z.union([z.literal(''), z.string().trim().email().max(190)]).optional(),
    active: z.boolean().default(true),

    provider: z.enum(Object.keys(PROVIDER_PRESETS) as [string, ...string[]]).default('custom'),
    host: z.string().trim().min(1).max(190),
    port: z.coerce.number().int().min(1).max(65535).default(587),
    encryption: z.enum(ENCRYPTION_MODES).default('tls'),
    // Bounded: a ten-minute timeout holds a request open long past the point an
    // operator has concluded the screen is broken.
    timeoutSeconds: z.coerce.number().int().min(1).max(120).default(30),
    maxRetries: z.coerce.number().int().min(1).max(10).default(3),

    authenticate: z.boolean().default(true),
    username: z.union([z.literal(''), z.string().trim().max(190)]).optional(),
    password: z.union([z.literal(''), z.string().max(255)]).optional(),
  });

  /** Everything the screen renders, and nothing that could leak the credential. */
  const shape = {
    id: true,
    key: true,
    name: true,
    fromName: true,
    fromEmail: true,
    replyTo: true,
    active: true,
    provider: true,
    host: true,
    port: true,
    encryption: true,
    timeoutSeconds: true,
    maxRetries: true,
    authenticate: true,
    username: true,
    lastTestAt: true,
    lastTestOk: true,
    lastTestDetail: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  app.get(
    '/api/email-profiles',
    { preHandler: requirePermission('settings.integration.email', 'view') },
    async () => {
      const rows = await db().emailProfile.findMany({
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
        select: { ...shape, passwordEncrypted: true },
      });

      return jsonSafe({
        // Offered to the form so the picker cannot present a preset the server does not
        // know how to apply.
        providers: Object.entries(PROVIDER_PRESETS).map(([key, preset]) => ({ key, ...preset })),
        profiles: rows.map(({ passwordEncrypted, ...row }) => ({
          ...row,
          /** Presence only. The value never leaves the server. */
          passwordSet: passwordEncrypted !== null && passwordEncrypted.length > 0,
        })),
      });
    },
  );

  app.post(
    '/api/email-profiles',
    { preHandler: requirePermission('settings.integration.email', 'create') },
    async (request) => {
      const body = parseBody(profileSchema, request.body);

      const clash = await db().emailProfile.findUnique({ where: { key: body.key } });
      if (clash) throw conflict(`Profil dengan kunci "${body.key}" sudah ada`);

      if (body.authenticate && (body.username ?? '') === '') {
        throw conflict('Pengesahan dihidupkan tetapi tiada nama pengguna diberi.');
      }
      if (body.authenticate && (body.password ?? '') === '') {
        throw conflict('Pengesahan dihidupkan tetapi tiada kata laluan diberi.');
      }

      const row = await db().emailProfile.create({
        data: {
          key: body.key,
          name: body.name,
          fromName: body.fromName,
          fromEmail: body.fromEmail,
          replyTo: body.replyTo && body.replyTo.length > 0 ? body.replyTo : null,
          active: body.active,
          provider: body.provider,
          host: body.host,
          port: body.port,
          encryption: body.encryption,
          timeoutSeconds: body.timeoutSeconds,
          maxRetries: body.maxRetries,
          authenticate: body.authenticate,
          username: body.username && body.username.length > 0 ? body.username : null,
          passwordEncrypted:
            body.password && body.password.length > 0 ? encryptSecret(body.password) : null,
        },
        select: shape,
      });

      await recordActivity({
        request,
        action: 'email.profile_create',
        category: 'settings',
        detail: `${row.key} · ${row.fromEmail} melalui ${row.host}:${String(row.port)}`,
      });

      return jsonSafe(row);
    },
  );

  app.patch(
    '/api/email-profiles/:id',
    { preHandler: requirePermission('settings.integration.email', 'edit') },
    async (request) => {
      const id = idParam(request.params);
      // `key` is omitted from the editable set on purpose: notifications select a
      // profile by it, so renaming would silently detach every one that names it.
      const body = parseBody(forUpdate(profileSchema.omit({ key: true })), request.body);

      const existing = await db().emailProfile.findUnique({ where: { id } });
      if (!existing) throw notFound('Profil emel tidak dijumpai');

      const authenticate = body.authenticate ?? existing.authenticate;
      const username = body.username ?? existing.username ?? '';
      const hasPassword =
        (body.password ?? '').length > 0 ||
        (existing.passwordEncrypted !== null && existing.passwordEncrypted.length > 0);

      if (authenticate && username === '') {
        throw conflict('Pengesahan dihidupkan tetapi tiada nama pengguna diberi.');
      }
      if (authenticate && !hasPassword) {
        throw conflict('Pengesahan dihidupkan tetapi tiada kata laluan tersimpan.');
      }

      const row = await db().emailProfile.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.fromName !== undefined ? { fromName: body.fromName } : {}),
          ...(body.fromEmail !== undefined ? { fromEmail: body.fromEmail } : {}),
          ...(body.replyTo !== undefined
            ? { replyTo: body.replyTo.length > 0 ? body.replyTo : null }
            : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
          ...(body.provider !== undefined ? { provider: body.provider } : {}),
          ...(body.host !== undefined ? { host: body.host } : {}),
          ...(body.port !== undefined ? { port: body.port } : {}),
          ...(body.encryption !== undefined ? { encryption: body.encryption } : {}),
          ...(body.timeoutSeconds !== undefined ? { timeoutSeconds: body.timeoutSeconds } : {}),
          ...(body.maxRetries !== undefined ? { maxRetries: body.maxRetries } : {}),
          ...(body.authenticate !== undefined ? { authenticate: body.authenticate } : {}),
          ...(body.username !== undefined
            ? { username: body.username.length > 0 ? body.username : null }
            : {}),
          // Blank means "leave as is" rather than "clear it", the same rule the device
          // form follows: the stored value is never shown, so blank cannot mean empty.
          ...(body.password !== undefined && body.password.length > 0
            ? { passwordEncrypted: encryptSecret(body.password) }
            : {}),
        },
        select: shape,
      });

      await recordActivity({
        request,
        action: 'email.profile_update',
        category: 'settings',
        detail: `${row.key} · ${row.host}:${String(row.port)} · ${row.encryption}`,
      });

      return jsonSafe(row);
    },
  );

  app.delete(
    '/api/email-profiles/:id',
    { preHandler: requirePermission('settings.integration.email', 'delete') },
    async (request) => {
      const id = idParam(request.params);
      const existing = await db().emailProfile.findUnique({ where: { id } });
      if (!existing) throw notFound('Profil emel tidak dijumpai');

      await db().emailProfile.delete({ where: { id } });

      await recordActivity({
        request,
        action: 'email.profile_delete',
        category: 'settings',
        // A warning rather than routine: anything selecting this key stops sending, and
        // it stops silently.
        level: 'warn',
        detail: `${existing.key} · ${existing.fromEmail}`,
      });

      return { ok: true };
    },
  );

  /**
   * Sends a real message through the profile.
   *
   * A real send rather than a connection probe. Authenticating proves the credentials;
   * it does not prove the relay will accept this sender address, which is the thing
   * that actually fails in practice — a relay will happily log you in and then refuse
   * to send as an address you are not authorised to use.
   *
   * The outcome is stored on the profile, because "did this ever work" gets asked days
   * later by somebody who did not run the test.
   */
  app.post(
    '/api/email-profiles/:id/test',
    { preHandler: requirePermission('settings.integration.email', 'test') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(
        z.object({
          recipient: z.union([z.literal(''), z.string().trim().email().max(190)]).optional(),
        }),
        request.body,
      );

      const profile = await db().emailProfile.findUnique({ where: { id } });
      if (!profile) throw notFound('Profil emel tidak dijumpai');

      // An inactive profile is skipped when anything tries to send through it, so a
      // passing test against one would certify a sender that will never deliver.
      if (!profile.active) {
        throw conflict(
          'Profil ini tidak aktif. Hidupkan dan simpan dahulu — ujian yang lulus terhadap ' +
            'profil tidak aktif mengesahkan sesuatu yang tetap tidak akan menghantar.',
        );
      }

      // Defaults to the profile's own address, which is the one destination guaranteed
      // to exist and the one a misconfigured relay is most likely to accept.
      const recipient =
        body.recipient && body.recipient.length > 0 ? body.recipient : profile.fromEmail;

      const startedAt = Date.now();
      let ok = false;
      let detail: string;

      try {
        const outcome = await sendThroughProfile(profile, {
          to: recipient,
          subject: `Ujian profil emel "${profile.name}" — Sistem Kehadiran`,
          text: [
            `Ini emel ujian dari Sistem Kehadiran Hospital Sibu.`,
            ``,
            `Profil   : ${profile.name} (${profile.key})`,
            `Pengirim : ${profile.fromName} <${profile.fromEmail}>`,
            `Relay    : ${profile.host}:${String(profile.port)} (${profile.encryption})`,
            `Dijana   : ${new Date().toISOString()}`,
            ``,
            `Jika anda menerima ini, profil tersebut boleh menghantar.`,
          ].join('\n'),
        });

        ok = true;
        detail =
          `Emel ujian dihantar ke ${recipient}` +
          (outcome.attempts > 1 ? ` selepas ${String(outcome.attempts)} cubaan` : '') +
          (outcome.rejected.length > 0 ? ` · ditolak: ${outcome.rejected.join(', ')}` : '');
      } catch (cause) {
        detail = describeSmtpError(cause);
      }

      const elapsed = Date.now() - startedAt;

      const saved = await db().emailProfile.update({
        where: { id },
        data: {
          lastTestAt: new Date(),
          lastTestOk: ok,
          // Truncated to the column, so a relay that answers with a wall of text cannot
          // fail the write that records the failure.
          lastTestDetail: detail.slice(0, 500),
        },
        select: { lastTestAt: true, lastTestOk: true, lastTestDetail: true },
      });

      await recordActivity({
        request,
        action: 'email.profile_test',
        category: 'settings',
        level: ok ? 'info' : 'warn',
        detail: `${profile.key} → ${recipient} · ${ok ? 'berjaya' : 'gagal'} · ${String(elapsed)}ms`,
      });

      // 200 either way: a failed test is a successful read of a real answer, and the
      // screen needs the message rather than an error status.
      return jsonSafe({ ok, recipient, elapsedMs: elapsed, ...saved });
    },
  );
}

function idParam(params: unknown): number {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
  if (!parsed.success) throw notFound('Rekod tidak dijumpai');
  return parsed.data.id;
}
