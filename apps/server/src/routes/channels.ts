import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAnyPermission, requirePermission } from '../auth/plugin.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import { db, jsonSafe } from '../db.js';
import { conflict, parseBody } from '../http.js';
import { recordActivity } from '../logging/activity.js';
import { normaliseMsisdn, sendSmsWith, smsSegments } from '../notify/sms.js';
import { NOTIFICATION_TRIGGERS, sanitiseTriggers } from '../notify/triggers.js';
import { sendTelegramWith, verifyBotToken } from '../notify/telegram.js';

/**
 * SMS and Telegram configuration.
 *
 * Both are single-row settings with a credential, a trigger list and a test, so they
 * share this module rather than duplicating the same read-modify-test shape twice.
 *
 * Credentials are write-only throughout: encrypted on the way in, and no endpoint
 * returns them. What comes back is `apiKeySet` / `botTokenSet`, which is all the form
 * needs to say "stored, leave blank to keep".
 */
export async function channelRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // Shared
  // -------------------------------------------------------------------------

  /**
   * The trigger registry, served rather than duplicated in the client.
   *
   * A screen that carries its own copy of the event list will offer a toggle for
   * something the server has stopped raising.
   */
  app.get(
    '/api/notify/triggers',
    {
      preHandler: requireAnyPermission(
        ['settings.integration.email', 'settings.integration.sms', 'settings.integration.telegram'],
        'view',
      ),
    },
    async () => jsonSafe({ triggers: NOTIFICATION_TRIGGERS }),
  );

  const triggerList = z.array(z.string().trim().max(48)).max(64);

  // -------------------------------------------------------------------------
  // SMS via Infobip
  // -------------------------------------------------------------------------

  app.get(
    '/api/sms',
    { preHandler: requirePermission('settings.integration.sms', 'view') },
    async () => {
      const row = await db().smsConfig.findUnique({ where: { id: 1 } });

      return jsonSafe({
        enabled: row?.enabled ?? false,
        baseUrl: row?.baseUrl ?? '',
        senderId: row?.senderId ?? '',
        /** Presence only. The key never leaves the server. */
        apiKeySet: (row?.apiKeyEncrypted ?? '').length > 0,
        triggers: sanitiseTriggers(row?.triggers),
        lastTestAt: row?.lastTestAt ?? null,
        lastTestOk: row?.lastTestOk ?? null,
        lastTestDetail: row?.lastTestDetail ?? null,
      });
    },
  );

  app.put(
    '/api/sms',
    { preHandler: requirePermission('settings.integration.sms', 'edit') },
    async (request) => {
      const body = parseBody(
        z.object({
          enabled: z.boolean(),
          baseUrl: z.union([z.literal(''), z.string().trim().max(190)]),
          senderId: z.union([z.literal(''), z.string().trim().max(32)]),
          /** Blank means "keep the stored key", never "clear it". */
          apiKey: z.union([z.literal(''), z.string().max(255)]).optional(),
          /**
           * Removing it takes an explicit flag.
           *
           * Blank cannot mean "clear" — the stored value is never shown, so an operator
           * editing the sender would wipe the key every time they saved. But there has to
           * be some way out, or a decommissioned gateway's credential stays in the
           * database indefinitely.
           */
          clearApiKey: z.boolean().optional(),
          triggers: triggerList,
        }),
        request.body,
      );

      const existing = await db().smsConfig.findUnique({ where: { id: 1 } });
      const clearing = body.clearApiKey === true && (body.apiKey ?? '').length === 0;
      const keyStored = (existing?.apiKeyEncrypted ?? '').length > 0;
      const willHaveKey = (keyStored && !clearing) || (body.apiKey ?? '').length > 0;

      /**
       * Refusing to switch on a half-configured gateway.
       *
       * Enabled with no key means every notification that reaches it fails, one at a
       * time, in a log nobody is reading.
       */
      if (body.enabled) {
        if (!willHaveKey) throw conflict('Tidak boleh dihidupkan tanpa kunci API Infobip.');
        if (body.baseUrl.trim() === '') throw conflict('Tidak boleh dihidupkan tanpa Base URL.');
        if (body.senderId.trim() === '') throw conflict('Tidak boleh dihidupkan tanpa Sender ID.');
      }

      const data = {
        enabled: body.enabled,
        baseUrl: body.baseUrl.trim(),
        senderId: body.senderId.trim(),
        triggers: sanitiseTriggers(body.triggers),
        ...((body.apiKey ?? '').length > 0
          ? { apiKeyEncrypted: encryptSecret(body.apiKey as string) }
          : clearing
            ? { apiKeyEncrypted: null }
            : {}),
      };

      await db().smsConfig.upsert({
        where: { id: 1 },
        create: { id: 1, ...data },
        update: data,
      });

      await recordActivity({
        request,
        action: 'sms.config_update',
        category: 'settings',
        detail:
          `${body.enabled ? 'dihidupkan' : 'dimatikan'} · ${data.baseUrl || 'tiada base url'} · ` +
          `sender ${data.senderId || 'tiada'} · ${String(data.triggers.length)} pencetif`,
      });

      return jsonSafe({ ok: true });
    },
  );

  app.post(
    '/api/sms/test',
    { preHandler: requirePermission('settings.integration.sms', 'test') },
    async (request) => {
      const body = parseBody(
        z.object({
          to: z.string().trim().min(7).max(20),
          text: z.string().trim().min(1).max(600),
        }),
        request.body,
      );

      const config = await db().smsConfig.findUnique({ where: { id: 1 } });
      if (!config) throw conflict('Simpan tetapan SMS dahulu — ujian menggunakan kredensial tersimpan.');
      // Stated rather than silently allowed: a pass against a disabled gateway certifies
      // something that will not send.
      if (!config.enabled) {
        throw conflict('SMS dimatikan. Hidupkan dan simpan dahulu sebelum menguji.');
      }

      const startedAt = Date.now();
      let ok = false;
      let detail: string;

      try {
        const outcome = await sendSmsWith(config, { to: body.to, text: body.text });
        ok = true;
        detail =
          `Dihantar ke ${outcome.to} · status ${outcome.status}` +
          (outcome.segments > 1 ? ` · ${String(outcome.segments)} segmen` : '') +
          (outcome.statusDescription.length > 0 ? ` · ${outcome.statusDescription}` : '');
      } catch (cause) {
        detail = cause instanceof Error ? cause.message : String(cause);
      }

      const saved = await db().smsConfig.update({
        where: { id: 1 },
        data: { lastTestAt: new Date(), lastTestOk: ok, lastTestDetail: detail.slice(0, 500) },
        select: { lastTestAt: true, lastTestOk: true, lastTestDetail: true },
      });

      await recordActivity({
        request,
        action: 'sms.test',
        category: 'settings',
        level: ok ? 'info' : 'warn',
        detail: `${normaliseMsisdn(body.to)} · ${ok ? 'berjaya' : 'gagal'} · ${String(Date.now() - startedAt)}ms`,
      });

      // 200 either way: a refusal is a real answer, and the screen needs the message.
      return jsonSafe({ ok, ...saved, segments: smsSegments(body.text) });
    },
  );

  // -------------------------------------------------------------------------
  // Telegram
  // -------------------------------------------------------------------------

  app.get(
    '/api/telegram',
    { preHandler: requirePermission('settings.integration.telegram', 'view') },
    async () => {
      const row = await db().telegramConfig.findUnique({ where: { id: 1 } });

      return jsonSafe({
        enabled: row?.enabled ?? false,
        botUsername: row?.botUsername ?? null,
        chatId: row?.chatId ?? '',
        ownerUserId: row?.ownerUserId ?? '',
        ownerUsername: row?.ownerUsername ?? '',
        botTokenSet: (row?.botTokenEncrypted ?? '').length > 0,
        triggers: sanitiseTriggers(row?.triggers),
        lastTestAt: row?.lastTestAt ?? null,
        lastTestOk: row?.lastTestOk ?? null,
        lastTestDetail: row?.lastTestDetail ?? null,
      });
    },
  );

  app.put(
    '/api/telegram',
    { preHandler: requirePermission('settings.integration.telegram', 'edit') },
    async (request) => {
      const body = parseBody(
        z.object({
          enabled: z.boolean(),
          botToken: z.union([z.literal(''), z.string().max(255)]).optional(),
          /** Explicit, for the same reason as the SMS key. */
          clearBotToken: z.boolean().optional(),
          chatId: z.union([z.literal(''), z.string().trim().max(64)]),
          ownerUserId: z.union([z.literal(''), z.string().trim().regex(/^\d+$/).max(32)]).optional(),
          ownerUsername: z.union([z.literal(''), z.string().trim().max(64)]).optional(),
          triggers: triggerList,
        }),
        request.body,
      );

      const existing = await db().telegramConfig.findUnique({ where: { id: 1 } });
      const clearing = body.clearBotToken === true && (body.botToken ?? '').length === 0;
      const tokenStored = (existing?.botTokenEncrypted ?? '').length > 0;
      const willHaveToken = (tokenStored && !clearing) || (body.botToken ?? '').length > 0;

      if (body.enabled) {
        if (!willHaveToken) throw conflict('Tidak boleh dihidupkan tanpa token bot.');
        if (body.chatId.trim() === '') throw conflict('Tidak boleh dihidupkan tanpa Channel ID.');
      }

      /**
       * The bot username is read from Telegram, not typed.
       *
       * Asking for it invites a value that disagrees with the token, and the screen would
       * then name a bot that is not the one posting.
       */
      let botUsername = existing?.botUsername ?? null;
      // Cleared alongside the token: naming a bot whose credential is gone would suggest
      // the channel is still attached to it.
      if (clearing) botUsername = null;
      if ((body.botToken ?? '').length > 0) {
        try {
          botUsername = (await verifyBotToken(body.botToken as string)).username;
        } catch {
          // Left to the test button to report. Refusing the save here would mean a token
          // cannot be stored while the network is down.
          botUsername = null;
        }
      }

      const data = {
        enabled: body.enabled,
        chatId: body.chatId.trim(),
        ownerUserId: (body.ownerUserId ?? '').trim() || null,
        ownerUsername: (body.ownerUsername ?? '').trim() || null,
        botUsername,
        triggers: sanitiseTriggers(body.triggers),
        ...((body.botToken ?? '').length > 0
          ? { botTokenEncrypted: encryptSecret(body.botToken as string) }
          : clearing
            ? { botTokenEncrypted: null }
            : {}),
      };

      await db().telegramConfig.upsert({
        where: { id: 1 },
        create: { id: 1, ...data },
        update: data,
      });

      await recordActivity({
        request,
        action: 'telegram.config_update',
        category: 'settings',
        detail:
          `${body.enabled ? 'dihidupkan' : 'dimatikan'} · ${data.chatId || 'tiada channel'} · ` +
          `${String(data.triggers.length)} pencetif`,
      });

      return jsonSafe({ ok: true, botUsername });
    },
  );

  /** Proves the token without posting anything. */
  app.post(
    '/api/telegram/verify',
    { preHandler: requirePermission('settings.integration.telegram', 'test') },
    async (request) => {
      const config = await db().telegramConfig.findUnique({ where: { id: 1 } });
      if (config === null || config.botTokenEncrypted === null || config.botTokenEncrypted.length === 0) {
        throw conflict('Simpan token bot dahulu — pengesahan menggunakan token tersimpan.');
      }

      try {
        const identity = await verifyBotToken(decryptSecret(config.botTokenEncrypted));

        // Stored so the screen names the bot even if the token was saved while the
        // network was down and the username could not be read then.
        await db().telegramConfig.update({
          where: { id: 1 },
          data: { botUsername: identity.username },
        });

        await recordActivity({
          request,
          action: 'telegram.verify',
          category: 'settings',
          detail: `@${identity.username ?? String(identity.id)} disahkan`,
        });

        return jsonSafe({ ok: true, bot: identity });
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);

        await recordActivity({
          request,
          action: 'telegram.verify',
          category: 'settings',
          level: 'warn',
          detail: detail.slice(0, 200),
        });

        return jsonSafe({ ok: false, detail });
      }
    },
  );

  app.post(
    '/api/telegram/test',
    { preHandler: requirePermission('settings.integration.telegram', 'test') },
    async (request) => {
      // Optional: the server composes the message, the same way the email test does, so
      // the screen does not have to invent wording that then differs per client.
      const body = parseBody(
        z.object({ text: z.union([z.literal(''), z.string().trim().max(3000)]).optional() }),
        request.body ?? {},
      );

      const config = await db().telegramConfig.findUnique({ where: { id: 1 } });
      if (!config) {
        throw conflict('Simpan tetapan Telegram dahulu — ujian menggunakan kredensial tersimpan.');
      }
      if (!config.enabled) {
        throw conflict('Telegram dimatikan. Hidupkan dan simpan dahulu sebelum menguji.');
      }

      const text =
        body.text !== undefined && body.text.length > 0
          ? body.text
          : [
              'Ujian Sistem Kehadiran Hospital Sibu.',
              '',
              `Channel: ${config.chatId}`,
              `Bot: ${config.botUsername === null ? '(belum disahkan)' : `@${config.botUsername}`}`,
              `Dijana: ${new Date().toISOString()}`,
              '',
              'Jika anda melihat ini, bot tersebut boleh menyiarkan ke channel ini.',
            ].join('\n');

      const startedAt = Date.now();
      let ok = false;
      let detail: string;

      try {
        const outcome = await sendTelegramWith(config, text);
        ok = true;
        detail =
          `Dihantar ke ${outcome.chatTitle || outcome.chatId} · mesej #${String(outcome.messageId)}`;
      } catch (cause) {
        detail = cause instanceof Error ? cause.message : String(cause);
      }

      const saved = await db().telegramConfig.update({
        where: { id: 1 },
        data: { lastTestAt: new Date(), lastTestOk: ok, lastTestDetail: detail.slice(0, 500) },
        select: { lastTestAt: true, lastTestOk: true, lastTestDetail: true },
      });

      await recordActivity({
        request,
        action: 'telegram.test',
        category: 'settings',
        level: ok ? 'info' : 'warn',
        detail: `${config.chatId} · ${ok ? 'berjaya' : 'gagal'} · ${String(Date.now() - startedAt)}ms`,
      });

      return jsonSafe({ ok, ...saved });
    },
  );
}
