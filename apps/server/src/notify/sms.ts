import { decryptSecret } from '../crypto.js';
import { db } from '../db.js';
import { logger } from '../logger.js';

/**
 * SMS through Infobip.
 *
 * Written against the REST API directly rather than through the vendor SDK. The call is
 * one POST with three fields; an SDK would add a dependency that has to be kept current
 * for no behaviour this system needs, and it would bury the failure detail that the test
 * button exists to surface.
 *
 * Endpoint and payload per Infobip's own documentation:
 * https://www.infobip.com/docs/api/channels/sms
 */

export interface SmsSettings {
  enabled: boolean;
  baseUrl: string;
  apiKeyEncrypted: string | null;
  senderId: string;
}

export interface SmsOutcome {
  messageId: string;
  /** Infobip's own status group: `PENDING`, `DELIVERED`, `REJECTED`, and so on. */
  status: string;
  statusDescription: string;
  to: string;
  /** Billable segments. A message over one segment costs more than one message. */
  segments: number;
}

/** GSM 03.38 is 160 characters a segment; anything outside it forces UCS-2 at 70. */
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
/** These occupy two GSM characters each rather than one. */
const GSM_EXTENDED = '^{}\\[~]|€';

/**
 * Length in billable segments.
 *
 * Worth computing rather than guessing at, because a single accented character drops the
 * limit from 160 to 70 and turns a one-part message into three. That shows up as a
 * tripled invoice, not as an error.
 */
export function smsSegments(text: string): { unicode: boolean; length: number; segments: number } {
  let length = 0;
  let unicode = false;

  for (const character of text) {
    if (GSM_EXTENDED.includes(character)) {
      length += 2;
    } else if (GSM_BASIC.includes(character)) {
      length += 1;
    } else {
      unicode = true;
      break;
    }
  }

  if (unicode) {
    // UCS-2: 70 per single message, 67 per part once concatenated.
    const count = [...text].length;
    return {
      unicode: true,
      length: count,
      segments: count <= 70 ? 1 : Math.ceil(count / 67),
    };
  }

  return {
    unicode: false,
    length,
    segments: length <= 160 ? 1 : Math.ceil(length / 153),
  };
}

/**
 * Normalises a Malaysian mobile number to the E.164 form Infobip expects.
 *
 * `0123456789` and `+60123456789` are the same number written two ways, and an operator
 * will enter either. Sending the local form gets it silently dropped rather than
 * rejected, so it is corrected here instead of being validated at the field.
 */
export function normaliseMsisdn(input: string, defaultCountry = '60'): string {
  const digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits.slice(1);
  if (digits.startsWith('0')) return `${defaultCountry}${digits.slice(1)}`;
  return digits;
}

/** Strips a scheme and trailing slash: Infobip gives the base URL as a bare host. */
function normaliseBaseUrl(raw: string): string {
  return raw.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/**
 * Always `https`, except on loopback.
 *
 * The API key travels in a request header, so plaintext to a real gateway would put a
 * hospital credential on the wire. Loopback is the one address where there is no wire:
 * nothing leaves the machine, so there is nothing to intercept. The carve-out exists so
 * the send path can be verified against a local stand-in rather than mocked, and it is
 * narrow enough that it cannot be turned into a way of sending credentials in clear.
 */
function schemeFor(host: string): 'http' | 'https' {
  const name = host.split(':')[0]?.toLowerCase() ?? '';
  const loopback = name === 'localhost' || name === '127.0.0.1' || name === '::1' || name === '[::1]';
  return loopback ? 'http' : 'https';
}

export interface SmsMessage {
  to: string;
  text: string;
}

export async function sendSmsWith(
  settings: SmsSettings,
  message: SmsMessage,
): Promise<SmsOutcome> {
  const host = normaliseBaseUrl(settings.baseUrl);
  if (host.length === 0) throw new Error('Base URL Infobip belum ditetapkan.');
  if (settings.apiKeyEncrypted === null || settings.apiKeyEncrypted.length === 0) {
    throw new Error('Kunci API Infobip belum ditetapkan.');
  }
  if (settings.senderId.trim().length === 0) {
    throw new Error('Sender ID belum ditetapkan.');
  }

  const to = normaliseMsisdn(message.to);
  const body = {
    messages: [
      {
        sender: settings.senderId.trim(),
        destinations: [{ to }],
        content: { text: message.text },
      },
    ],
  };

  // Bounded so a gateway that accepts the connection and stalls cannot hold a request
  // open past the point the operator has concluded the screen is broken.
  const abort = AbortSignal.timeout(20_000);

  let response: Response;
  try {
    response = await fetch(`${schemeFor(host)}://${host}/sms/3/messages`, {
      method: 'POST',
      headers: {
        // Infobip's own scheme: the literal word `App`, then the key.
        authorization: `App ${decryptSecret(settings.apiKeyEncrypted)}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: abort,
    });
  } catch (cause) {
    throw new Error(describeNetworkError(cause, host));
  }

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(describeApiError(response.status, payload, text));
  }

  const first = (payload as { messages?: Array<Record<string, unknown>> } | null)?.messages?.[0];
  const status = (first?.['status'] ?? {}) as Record<string, unknown>;
  const group = String(status['groupName'] ?? 'UNKNOWN');
  const description = String(status['description'] ?? '');

  /**
   * A 200 does not mean delivered.
   *
   * Infobip accepts the request and reports per-message status, so a rejected sender or
   * a blocked destination comes back inside a successful response. Treating 200 as sent
   * is how a gateway appears to work for a week while nothing arrives.
   */
  if (group === 'REJECTED' || group === 'UNDELIVERABLE') {
    throw new Error(
      `Infobip menolak mesej: ${description || group}. ` +
        'Selalunya Sender ID tidak berdaftar, atau nombor destinasi tidak disahkan pada akaun percubaan.',
    );
  }

  const segments = smsSegments(message.text).segments;

  return {
    messageId: String(first?.['messageId'] ?? ''),
    status: group,
    statusDescription: description,
    to,
    segments,
  };
}

/** Sends through the stored configuration. The entry point for notifications. */
export async function sendSms(message: SmsMessage): Promise<SmsOutcome> {
  const config = await db().smsConfig.findUnique({ where: { id: 1 } });
  if (!config) throw new Error('SMS belum dikonfigurasikan.');
  if (!config.enabled) throw new Error('SMS dimatikan.');

  const outcome = await sendSmsWith(config, message);
  logger().info({ to: outcome.to, status: outcome.status, segments: outcome.segments }, 'SMS sent');
  return outcome;
}

function describeNetworkError(cause: unknown, host: string): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const name = cause instanceof Error ? cause.name : '';

  if (name === 'TimeoutError' || /timeout|aborted/i.test(raw)) {
    return 'Infobip tidak menjawab dalam masa yang ditetapkan. Dalam pemasangan LAN, semak sama ada pelayan ini dibenarkan keluar ke internet.';
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) {
    return `Nama host "${host}" tidak dapat diselesaikan. Semak Base URL — ia unik untuk akaun anda dan bukan api.infobip.com.`;
  }
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/i.test(raw)) {
    return `Tidak dapat menghubungi ${host}. Biasanya firewall keluar, bukan tetapan Infobip.`;
  }
  if (/certificate|CERT_|self.signed/i.test(raw)) {
    return 'Sertifikat TLS tidak dipercayai. Biasanya proksi korporat yang memintas trafik keluar.';
  }
  return raw;
}

/**
 * Turns an Infobip error response into something that names the field to change.
 *
 * The raw body is a `requestError.serviceException` object whose text is accurate but
 * says nothing about which of the three settings is wrong.
 */
function describeApiError(status: number, payload: unknown, raw: string): string {
  const exception = (
    payload as { requestError?: { serviceException?: Record<string, unknown> } } | null
  )?.requestError?.serviceException;
  const detail = String(exception?.['text'] ?? exception?.['messageId'] ?? raw.slice(0, 200));

  switch (status) {
    case 401:
      return `Infobip menolak kunci API. Semak kunci itu, dan bahawa ia disalin sepenuhnya. (${detail})`;
    case 403:
      return `Kunci API sah tetapi tiada kebenaran menghantar SMS. Kunci itu memerlukan skop "sms:message:send". (${detail})`;
    case 400:
      return `Infobip menolak permintaan sebagai tidak sah: ${detail}. Semak Sender ID dan format nombor destinasi.`;
    case 404:
      return `Endpoint tidak dijumpai pada Base URL itu. Semak ia adalah host akaun anda, contohnya xyz123.api.infobip.com. (${detail})`;
    case 429:
      return 'Had kadar Infobip dicapai. Cuba sebentar lagi.';
    default:
      break;
  }

  if (status >= 500) {
    return `Infobip melaporkan ralat pelayan (${String(status)}). Ini di pihak mereka, bukan konfigurasi ini. (${detail})`;
  }
  return `Infobip menjawab ${String(status)}: ${detail}`;
}
