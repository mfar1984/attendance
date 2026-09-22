import { createTransport, type Transporter } from 'nodemailer';

import { decryptSecret } from '../crypto.js';
import { db } from '../db.js';
import { logger } from '../logger.js';

/**
 * Outbound mail through a named profile.
 *
 * The profile is selected by `key`, never by row id, so a caller says "accounting" and
 * stays correct after the profile is renamed or repointed at a different relay.
 *
 * Nothing here is queued. A send either completes or throws, and the caller decides
 * what that means — a test send reports it to the operator, and a future scheduled
 * report will need its own retry record rather than pretending this layer has one.
 */

export interface SmtpProfile {
  key: string;
  name: string;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  active: boolean;
  host: string;
  port: number;
  encryption: string;
  timeoutSeconds: number;
  maxRetries: number;
  authenticate: boolean;
  username: string | null;
  passwordEncrypted: string | null;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendOutcome {
  messageId: string;
  /** How many tries it took, so a relay that only works on the second is visible. */
  attempts: number;
  accepted: string[];
  rejected: string[];
}

/**
 * Host, port and encryption a provider expects.
 *
 * A preset only fills the form. The stored values stay authoritative, so a preset
 * corrected in a later release cannot silently repoint a profile somebody already
 * configured and tested.
 */
export const PROVIDER_PRESETS = {
  custom: { label: 'Custom SMTP', host: '', port: 587, encryption: 'tls' },
  gmail: { label: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 465, encryption: 'ssl' },
  outlook365: {
    label: 'Microsoft 365',
    host: 'smtp.office365.com',
    port: 587,
    encryption: 'tls',
  },
  ses: {
    label: 'Amazon SES',
    host: 'email-smtp.ap-southeast-1.amazonaws.com',
    port: 587,
    encryption: 'tls',
  },
} as const;

export type ProviderKey = keyof typeof PROVIDER_PRESETS;

export const ENCRYPTION_MODES = ['none', 'tls', 'ssl'] as const;

/**
 * Builds a transport for one profile.
 *
 * Created per send rather than pooled. Pooling matters at volume, and nothing sends at
 * volume yet; a cached transport that holds a stale password after an edit is the
 * failure that would arrive first.
 */
function buildTransport(profile: SmtpProfile): Transporter {
  const timeout = Math.max(1, profile.timeoutSeconds) * 1000;

  return createTransport({
    host: profile.host,
    port: profile.port,
    // `ssl` is implicit TLS from the first byte, normally 465. `tls` is STARTTLS,
    // normally 587, and `requireTLS` makes the upgrade mandatory rather than
    // opportunistic — without it a relay that omits STARTTLS silently sends the
    // credentials in clear.
    secure: profile.encryption === 'ssl',
    ...(profile.encryption === 'tls' ? { requireTLS: true } : {}),
    ...(profile.encryption === 'none' ? { ignoreTLS: true } : {}),
    ...(profile.authenticate && profile.username
      ? {
          auth: {
            user: profile.username,
            pass:
              profile.passwordEncrypted === null ? '' : decryptSecret(profile.passwordEncrypted),
          },
        }
      : {}),
    // All three, because a relay can accept the connection and then stall at any of
    // them. Only bounding the connect leaves a request open on a silent server.
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
  });
}

/** `Nama <alamat>`, quoted when the display name contains a comma or quote. */
function formatAddress(name: string, address: string): string {
  if (name.trim().length === 0) return address;
  const escaped = name.replace(/"/g, '\\"');
  return /[",<>:;]/.test(name) ? `"${escaped}" <${address}>` : `${name} <${address}>`;
}

/**
 * Sends one message, retrying up to the profile's limit.
 *
 * Retries only transient failures. A rejected password or a refused recipient will be
 * rejected identically on every attempt, so retrying those only delays the error the
 * operator needs to read.
 */
export async function sendThroughProfile(
  profile: SmtpProfile,
  message: MailMessage,
): Promise<SendOutcome> {
  const attempts = Math.max(1, profile.maxRetries);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const transport = buildTransport(profile);
    try {
      const result = await transport.sendMail({
        from: formatAddress(profile.fromName, profile.fromEmail),
        ...(profile.replyTo === null ? {} : { replyTo: profile.replyTo }),
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html === undefined ? {} : { html: message.html }),
      });

      return {
        messageId: result.messageId,
        attempts: attempt,
        accepted: (result.accepted ?? []).map(String),
        rejected: (result.rejected ?? []).map(String),
      };
    } catch (cause) {
      lastError = cause;
      if (isPermanent(cause) || attempt === attempts) break;
      logger().warn(
        { profile: profile.key, attempt, error: describeSmtpError(cause) },
        'SMTP send failed, retrying',
      );
      // Linear backoff. A relay rate-limiting us needs a pause, not a tighter loop.
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    } finally {
      transport.close();
    }
  }

  throw lastError instanceof Error ? lastError : new Error(describeSmtpError(lastError));
}

/**
 * Sends through the profile named by `key`.
 *
 * The entry point every future notification should use. Refuses an inactive profile
 * rather than falling back to another one: mail arriving from an unexpected sender is
 * worse than mail that did not arrive, because nobody investigates the first.
 */
export async function sendMail(key: string, message: MailMessage): Promise<SendOutcome> {
  const profile = await db().emailProfile.findUnique({ where: { key } });
  if (!profile) throw new Error(`Profil emel "${key}" tidak dijumpai`);
  if (!profile.active) throw new Error(`Profil emel "${key}" tidak aktif`);

  return sendThroughProfile(profile, message);
}

/** Failures that will repeat identically, so retrying only delays the message. */
function isPermanent(cause: unknown): boolean {
  const code = errorCode(cause);
  if (code === 'EAUTH' || code === 'EENVELOPE') return true;

  // 5xx is a permanent SMTP refusal; 4xx is the transient class.
  const status = (cause as { responseCode?: number } | null)?.responseCode;
  return typeof status === 'number' && status >= 500 && status < 600;
}

function errorCode(cause: unknown): string {
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}

/**
 * Turns an SMTP failure into something an operator can act on.
 *
 * The raw errors name a syscall or a TLS constant, which says nothing about which field
 * on the form is wrong. This is the whole value of the test button: not that it failed,
 * but what to change.
 */
export function describeSmtpError(cause: unknown): string {
  const code = errorCode(cause);
  const raw = cause instanceof Error ? cause.message : String(cause);

  /*
   * The message is read before the code, because nodemailer's code is not the syscall.
   * A refused connection arrives as `ESOCKET` and a DNS failure as `EDNS`, with the real
   * errno only in the text — so switching on the code alone blames the encryption mode
   * for a port that simply has nothing behind it.
   */
  if (/ECONNREFUSED/.test(raw)) {
    return 'Tiada apa-apa mendengar pada host dan port itu. Semak port, dan sama ada relay membenarkan sambungan dari pelayan ini.';
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(raw)) {
    return 'Nama host itu tidak dapat diselesaikan. Dalam mod LAN, DNS luar mungkin tidak dapat dicapai sama sekali.';
  }
  if (/EHOSTUNREACH|ENETUNREACH/.test(raw)) {
    return 'Tiada laluan ke host itu dari pelayan ini. Biasanya masalah routing atau VLAN, bukan tetapan SMTP.';
  }
  if (/ECONNRESET/.test(raw)) {
    return 'Pelayan menutup sambungan secara mendadak. Selalunya ia menolak sambungan tanpa penyulitan, atau alamat sumber ini tidak dibenarkan.';
  }
  if (/self.signed|unable to verify|CERT_|ALTNAME/i.test(raw)) {
    return `Sertifikat pelayan tidak dipercayai. Relay dalaman dengan sertifikat sendiri perlu sertifikatnya dipasang pada pelayan ini, atau gunakan port tanpa penyulitan di dalam LAN. (${raw})`;
  }
  if (/wrong version number|packet length too long|SSL routines/i.test(raw)) {
    return 'Mod penyulitan tidak sepadan dengan port. SSL pada port STARTTLS menghasilkan ralat ini — cuba TLS untuk 587, SSL untuk 465.';
  }

  switch (code) {
    case 'EAUTH':
      return `Pelayan menolak kredensial. Semak pengguna dan kata laluan. (${raw})`;
    case 'ETIMEDOUT':
    case 'ETIMEOUT':
      return 'Pelayan tidak menjawab dalam masa yang ditetapkan. Biasanya firewall menjatuhkan sambungan secara senyap, bukan menolaknya.';
    case 'EDNS':
      return `Nama host itu tidak dapat diselesaikan. (${raw})`;
    case 'EENVELOPE':
      return `Pelayan menolak alamat pengirim atau penerima. (${raw})`;
    case 'ESOCKET':
      return `Sambungan terputus semasa berjabat tangan. Semak mod penyulitan terhadap port yang digunakan. (${raw})`;
    default:
      return raw;
  }
}
