import { decryptSecret } from '../crypto.js';
import { db } from '../db.js';
import { logger } from '../logger.js';

/**
 * Telegram notifications through a bot.
 *
 * Two calls are used: `getMe` to prove the token, and `sendMessage` to post. They are
 * separate on the screen as well, because they fail for different reasons and the
 * distinction is the whole diagnosis — a valid token that cannot post means the bot was
 * never added to the channel, which no amount of retyping the token will fix.
 *
 * Messages are sent as plain text. Telegram's `parse_mode` requires escaping a set of
 * characters that appear in ordinary Malay names and in the timestamps these messages
 * carry, and an unescaped one is rejected with a parse error rather than sent plainly.
 */

/**
 * Telegram's API host, overridable only to loopback.
 *
 * The bot token travels in the URL path, so pointing this at an arbitrary host would hand
 * the token to it. Loopback is the exception because nothing leaves the machine, and the
 * override exists so the request shape can be verified against a local stand-in instead
 * of being asserted from the outside. Any other value is ignored.
 */
function apiBase(): string {
  const override = process.env['TELEGRAM_API_BASE'];
  if (override !== undefined && /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(override)) {
    return override;
  }
  return 'https://api.telegram.org';
}

export interface TelegramSettings {
  enabled: boolean;
  botTokenEncrypted: string | null;
  chatId: string;
}

export interface BotIdentity {
  id: number;
  username: string | null;
  firstName: string;
}

export interface TelegramOutcome {
  messageId: number;
  /** Echoed back by Telegram, so the operator sees where it actually landed. */
  chatTitle: string;
  chatId: string;
}

interface TelegramReply {
  ok: boolean;
  result?: unknown;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

async function callApi(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/bot${token}/${method}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (cause) {
    throw new Error(describeNetworkError(cause));
  }

  const text = await response.text();
  let payload: TelegramReply;
  try {
    payload = JSON.parse(text) as TelegramReply;
  } catch {
    throw new Error(`Telegram menjawab dengan sesuatu yang bukan JSON (${String(response.status)}).`);
  }

  // Telegram reports failure in the body as well as the status, and the `description`
  // is the only part that says what to change.
  if (!payload.ok) throw new Error(describeApiError(payload, method));

  return payload.result;
}

/**
 * Confirms the token and returns who the bot is.
 *
 * Offered on its own because it separates "the token is wrong" from "the bot is not in
 * the channel". Reading the username back also means it is never typed by hand and so
 * cannot disagree with the token it belongs to.
 */
export async function verifyBotToken(token: string): Promise<BotIdentity> {
  const result = (await callApi(token, 'getMe')) as Record<string, unknown>;

  return {
    id: Number(result['id']),
    username: typeof result['username'] === 'string' ? result['username'] : null,
    firstName: String(result['first_name'] ?? ''),
  };
}

export async function sendTelegramWith(
  settings: TelegramSettings,
  text: string,
): Promise<TelegramOutcome> {
  if (settings.botTokenEncrypted === null || settings.botTokenEncrypted.length === 0) {
    throw new Error('Token bot belum ditetapkan.');
  }
  if (settings.chatId.trim().length === 0) {
    throw new Error('Channel ID belum ditetapkan.');
  }

  const result = (await callApi(decryptSecret(settings.botTokenEncrypted), 'sendMessage', {
    chat_id: settings.chatId.trim(),
    text,
    // The notifications this sends are informational; a preview card for a URL inside
    // one would push the message itself off screen.
    link_preview_options: { is_disabled: true },
  })) as Record<string, unknown>;

  const chat = (result['chat'] ?? {}) as Record<string, unknown>;

  return {
    messageId: Number(result['message_id']),
    chatTitle: String(chat['title'] ?? chat['username'] ?? chat['first_name'] ?? ''),
    chatId: String(chat['id'] ?? settings.chatId),
  };
}

/** Sends through the stored configuration. The entry point for notifications. */
export async function sendTelegram(text: string): Promise<TelegramOutcome> {
  const config = await db().telegramConfig.findUnique({ where: { id: 1 } });
  if (!config) throw new Error('Telegram belum dikonfigurasikan.');
  if (!config.enabled) throw new Error('Telegram dimatikan.');

  const outcome = await sendTelegramWith(config, text);
  logger().info({ chatId: outcome.chatId, messageId: outcome.messageId }, 'Telegram message sent');
  return outcome;
}

function describeNetworkError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const name = cause instanceof Error ? cause.name : '';

  if (name === 'TimeoutError' || /timeout|aborted/i.test(raw)) {
    return 'api.telegram.org tidak menjawab dalam masa yang ditetapkan. Dalam pemasangan LAN, semak sama ada pelayan ini dibenarkan keluar ke internet.';
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) {
    return 'api.telegram.org tidak dapat diselesaikan. Pelayan ini mungkin tiada DNS keluar sama sekali.';
  }
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/i.test(raw)) {
    return 'Tidak dapat menghubungi api.telegram.org. Biasanya firewall keluar — Telegram juga disekat oleh sebahagian rangkaian korporat.';
  }
  if (/certificate|CERT_|self.signed/i.test(raw)) {
    return 'Sertifikat TLS tidak dipercayai. Biasanya proksi korporat yang memintas trafik keluar.';
  }
  return raw;
}

/**
 * Maps Telegram's `description` onto the field that is actually wrong.
 *
 * The descriptions are accurate but written for a bot developer: "chat not found" does
 * not say that the bot has to be added to the channel as an administrator first, which
 * is the single most common reason this fails on a first setup.
 */
function describeApiError(payload: TelegramReply, method: string): string {
  const code = payload.error_code ?? 0;
  const description = payload.description ?? 'tiada butiran';

  if (code === 401) {
    return 'Telegram menolak token bot. Semak ia disalin sepenuhnya dari @BotFather — bentuknya nombor, titik bertindih, kemudian rentetan panjang.';
  }
  if (code === 404 && method === 'getMe') {
    return 'Token itu bukan token bot yang sah.';
  }
  if (/chat not found/i.test(description)) {
    return 'Channel itu tidak dijumpai. Untuk channel awam gunakan @namachannel; untuk yang persendirian gunakan ID numerik -100…. Bot juga mesti sudah ditambah ke channel itu.';
  }
  if (/not enough rights|not a member|CHAT_ADMIN_REQUIRED/i.test(description)) {
    return 'Bot ada dalam channel tetapi tidak dibenarkan menghantar. Jadikan ia administrator channel dengan kebenaran "Post Messages".';
  }
  if (/bot was blocked/i.test(description)) {
    return 'Pengguna itu telah menyekat bot. Mereka perlu membuka semula sekatan sebelum bot boleh menghantar.';
  }
  if (/bot can't initiate conversation/i.test(description)) {
    return 'Bot tidak boleh memulakan perbualan. Pengguna itu perlu menghantar /start kepada bot sekali dahulu.';
  }
  if (code === 429) {
    const wait = payload.parameters?.retry_after;
    return `Had kadar Telegram dicapai${wait === undefined ? '' : ` — cuba lagi dalam ${String(wait)} saat`}.`;
  }

  return `Telegram menolak permintaan (${String(code)}): ${description}`;
}
