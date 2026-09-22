import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const REALM = 'attendance-ingest';
const NONCE_TTL_MS = 5 * 60_000;

/**
 * Issued nonces, with the highest nonce count already seen for each.
 *
 * Tracking the counter is what makes a captured Authorization header unusable a
 * second time. Without it, anyone who can observe one push can replay it and
 * forge attendance punches.
 */
const issued = new Map<string, { createdAt: number; highestNc: number }>();

const md5 = (input: string): string => createHash('md5').update(input, 'utf8').digest('hex');

export function digestChallenge(): string {
  pruneExpired();
  const nonce = randomBytes(16).toString('hex');
  issued.set(nonce, { createdAt: Date.now(), highestNc: 0 });
  return `Digest realm="${REALM}", qop="auth", nonce="${nonce}", algorithm=MD5`;
}

export type DigestVerdict =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'malformed' | 'stale' | 'replayed' | 'mismatch' };

/**
 * Verifies a Digest Authorization header from the terminal.
 *
 * The terminal's firmware limits this password to 8-16 characters, so the shared
 * secret is short by design. That is exactly why the nonce and counter checks
 * matter: they are what stand between a short password and an open endpoint.
 */
export function verifyDigest(input: {
  header: string | undefined;
  method: string;
  uri: string;
  username: string;
  password: string;
}): DigestVerdict {
  if (!input.header) return { ok: false, reason: 'missing' };

  const scheme = /^\s*Digest\s+/i.exec(input.header);
  if (!scheme) return { ok: false, reason: 'malformed' };

  const params: Record<string, string> = {};
  const pattern = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^\s,]+))/g;
  for (const match of input.header.slice(scheme[0].length).matchAll(pattern)) {
    const key = match[1];
    if (key) params[key.toLowerCase()] = match[2] ?? match[3] ?? '';
  }

  const nonce = params['nonce'];
  const response = params['response'];
  const username = params['username'];
  if (!nonce || !response || !username) return { ok: false, reason: 'malformed' };

  pruneExpired();
  const record = issued.get(nonce);
  if (!record) return { ok: false, reason: 'stale' };

  const qop = params['qop'];
  const nc = params['nc'];
  const cnonce = params['cnonce'];

  if (qop) {
    if (!nc || !cnonce) return { ok: false, reason: 'malformed' };
    const counter = Number.parseInt(nc, 16);
    if (!Number.isFinite(counter)) return { ok: false, reason: 'malformed' };
    // Equal or lower means this exact request was already accepted.
    if (counter <= record.highestNc) return { ok: false, reason: 'replayed' };
    record.highestNc = counter;
  }

  if (username !== input.username) return { ok: false, reason: 'mismatch' };

  // The device signs the URI it sent, which may or may not include the query
  // string. Both forms are accepted rather than rejecting a valid push.
  const uriFromHeader = params['uri'] ?? input.uri;
  const ha1 = md5(`${input.username}:${REALM}:${input.password}`);
  const ha2 = md5(`${input.method}:${uriFromHeader}`);
  const expected = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);

  return constantTimeEqual(expected, response) ? { ok: true } : { ok: false, reason: 'mismatch' };
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function pruneExpired(): void {
  const cutoff = Date.now() - NONCE_TTL_MS;
  for (const [nonce, record] of issued) {
    if (record.createdAt < cutoff) issued.delete(nonce);
  }
}
