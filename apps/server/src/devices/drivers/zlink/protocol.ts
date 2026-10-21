import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';

/**
 * ZKBio Zlink Open Platform wire format.
 *
 * ## What this is for
 *
 * A SenseFace terminal registered to ZKBio Zlink does not speak to this server at all. It speaks
 * to ZKTeco's cloud, and ZKTeco's cloud speaks to us — so there is no driver socket, no connector,
 * and no `/iclock` path. What there is instead is a REST gateway we call with a token, and a
 * callback URL that Zlink posts events to.
 *
 * That makes this the third delivery shape in this application, after Hikvision's push and
 * ZKTeco's own ADMS. It earns a file of its own for the same reason `zkteco/protocol.ts` does:
 * when a detail here turns out to be wrong, the correction is one edit with no reach into
 * anything else.
 *
 * ## Confidence, stated up front
 *
 * Everything below is taken from the platform's published reference — the error-code table, the
 * callback verification page, and the credential endpoint — rather than from transcription or
 * guesswork. That is a genuine difference from the TA Push file beside it, and it is why this
 * path is preferred for a unit that is already registered to Zlink.
 *
 * Two things are **not** confirmed and are marked where they appear:
 *
 *  - whether `echo` arrives base64-encoded or hex. The reference calls it "an encrypted string"
 *    and names the decryption factors without naming the encoding, so both are attempted.
 *  - the token exchange itself, which lives in `client.ts` and is not in this file. Roughly two
 *    hundred candidate paths were probed and every one answered 404, so it is read from the
 *    reference rather than inferred.
 */

// ---------------------------------------------------------------------------
// Response envelope
// ---------------------------------------------------------------------------

/**
 * Success. A **string**, not a number, and not zero.
 *
 * Worth stating because every other API in this application answers with an HTTP status and a
 * body, and the reflex is to read `code === 0`. Here `0` is never sent, `200` means the gateway
 * accepted the request rather than that the operation succeeded, and a failed operation arrives
 * as HTTP 200 with a `ZKER...` code. Reading the status alone would record every business refusal
 * as a success.
 */
export const ZLINK_SUCCESS = 'ZCOP0000';

export interface ZlinkEnvelope<T> {
  code: string;
  message: string;
  data: T;
}

export function zlinkSucceeded(envelope: { code?: unknown }): boolean {
  return envelope.code === ZLINK_SUCCESS;
}

/**
 * The documented error codes, and what each one means for the caller.
 *
 * Grouped by what to **do**, because that is the only distinction that matters at a call site:
 * retry later, or stop and report. Getting this backwards is how a queue either spins against a
 * permanent refusal or discards work over a momentary rate limit.
 */
const RETRYABLE = new Set([
  /** Internal server error. */
  'ZKER0999',
  /** Remote call exception, and its server-side variants. */
  'ZKER0996',
  'ZKER0994',
  /** Rate limited. */
  'ZKER0993',
  /** Interface busy. */
  'ZKER0992',
]);

/**
 * Whether a code describes a condition that may clear on its own.
 *
 * `ZKER0997` (invalid parameter), `ZKER0998` (business exception), `ZKER0995` (client error) and
 * `ZKER0991` (IP blacklisted) are all permanent: the request will be refused identically every
 * time, so retrying only delays the moment somebody is told what to fix. `ZKER0991` in particular
 * needs the server's address added to the platform's IP whitelist, which no amount of waiting
 * achieves.
 */
export function zlinkRetryable(code: string): boolean {
  return RETRYABLE.has(code);
}

/** Whether a code means the token is stale and a fresh one should be exchanged. */
export function zlinkTokenRejected(status: number, code: string): boolean {
  // The gateway answers 401 with an HTML body for a missing or expired token rather than an
  // envelope, so the status has to be read as well as the code.
  return status === 401 || code === 'ZCDE0001';
}

// ---------------------------------------------------------------------------
// Callback verification
// ---------------------------------------------------------------------------

/** How far out of step a callback timestamp may be. The reference states five minutes. */
export const ZLINK_CALLBACK_TOLERANCE_MS = 5 * 60_000;

/**
 * The signature Zlink puts on a callback.
 *
 * `MD5-32`, lowercase, over `verificationToken + timestamp + nonce` concatenated with no
 * separator. MD5 is the platform's choice, not ours — it is being verified, not generated, so
 * there is nothing to harden here and substituting something stronger would simply fail to match.
 *
 * What stops a replay is the timestamp being inside the signed material **and** inside a five
 * minute window: a signature over the nonce alone would stay valid forever.
 */
export function zlinkCallbackSignature(
  verificationToken: string,
  timestamp: string,
  nonce: string,
): string {
  return createHash('md5').update(`${verificationToken}${timestamp}${nonce}`, 'utf8').digest('hex');
}

export type CallbackVerdict =
  | { ok: true }
  | { ok: false; reason: 'malformed' | 'stale' | 'mismatch' };

/**
 * Verifies a callback the way the platform expects.
 *
 * Compared in constant time. A byte-by-byte early exit leaks how much of a forged signature was
 * correct, which over enough attempts is how one gets forged completely — and this endpoint
 * accepts attendance, which is payroll evidence with no delete path.
 */
export function verifyZlinkCallback(
  verificationToken: string,
  query: { sign?: string | undefined; timestamp?: string | undefined; nonce?: string | undefined },
  nowMs = Date.now(),
): CallbackVerdict {
  const { sign, timestamp, nonce } = query;
  if (
    sign === undefined ||
    timestamp === undefined ||
    nonce === undefined ||
    sign === '' ||
    timestamp === '' ||
    nonce === ''
  ) {
    return { ok: false, reason: 'malformed' };
  }

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return { ok: false, reason: 'malformed' };

  // Milliseconds, per the reference. Checked in both directions: a clock ahead of ours is as much
  // a reason to refuse as one behind.
  if (Math.abs(nowMs - sent) > ZLINK_CALLBACK_TOLERANCE_MS) return { ok: false, reason: 'stale' };

  const expected = zlinkCallbackSignature(verificationToken, timestamp, nonce);
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(sign.toLowerCase(), 'utf8');
  if (left.length !== right.length) return { ok: false, reason: 'mismatch' };

  return timingSafeEqual(left, right) ? { ok: true } : { ok: false, reason: 'mismatch' };
}

// ---------------------------------------------------------------------------
// Event payload decryption
// ---------------------------------------------------------------------------

/**
 * Decrypts a value Zlink encrypted for us.
 *
 * The reference names the three factors and nothing else: the ciphertext, the **AppKey** as the
 * key, and the **Encryption Key** as the IV. That is an unusual arrangement — the AppKey is also
 * an identifier that appears in configuration screens, so it is doing double duty as a secret —
 * but it is what the platform does, and both values are exactly sixteen characters, which makes
 * the cipher AES-128-CBC with no ambiguity left to resolve.
 *
 * Used for two things: the `echo` parameter of the URL-verification handshake, and the body of
 * every event that follows.
 *
 * ## The encoding is attempted rather than assumed
 *
 * The reference calls the input "an encrypted string" without saying how it is encoded. Base64 is
 * the overwhelming convention and is tried first; hex is tried after. Returning null rather than
 * throwing on both, because a callback that cannot be decrypted must be refused with a logged
 * reason — an exception here would answer 500 to a platform that retries, and the retries would
 * fail identically.
 */
export function decryptZlinkPayload(
  encrypted: string,
  appKey: string,
  encryptionKey: string,
): string | null {
  const key = Buffer.from(appKey, 'utf8');
  const iv = Buffer.from(encryptionKey, 'utf8');

  /*
   * Checked before use, because `createDecipheriv` throws on a wrong length and the message it
   * throws names neither value. A sixteen-byte key and IV is AES-128; anything else means the
   * credentials in settings are not the ones this scheme expects, which is a configuration fault
   * worth naming rather than a decryption failure.
   */
  if (key.length !== 16 || iv.length !== 16) return null;

  for (const encoding of ['base64', 'hex'] as const) {
    const ciphertext = Buffer.from(encrypted, encoding);
    // A base64 decode never fails in Node; it silently produces garbage. A length that is not a
    // whole number of AES blocks is the cheap way to notice before spending a decrypt on it.
    if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) continue;

    try {
      const decipher = createDecipheriv('aes-128-cbc', key, iv);
      const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      // PKCS#7 padding was valid and the result decodes as text, which together is strong enough
      // evidence that the encoding guess was right.
      if (plain.length > 0) return plain;
    } catch {
      // Wrong encoding, or genuinely not our ciphertext. Try the next encoding.
    }
  }

  return null;
}

/**
 * The reply Zlink requires for the URL-verification handshake.
 *
 * It sends `GET <our url>?sign&timestamp&nonce&echo` when the callback is saved in its console,
 * and expects the **decrypted** `echo` back in `data`. Answering the ciphertext, or an empty body,
 * fails verification — and a failed verification means the subscription is never activated, so no
 * event ever arrives and nothing on either screen says why.
 */
export function zlinkVerificationReply(plaintext: string): ZlinkEnvelope<string> {
  return { code: ZLINK_SUCCESS, message: 'Operation successful', data: plaintext };
}

/**
 * The reply for a refusal.
 *
 * A non-success code in a 200 body, which is this platform's own convention — answering an HTTP
 * error instead would make Zlink retry a request that can never succeed.
 */
export function zlinkRefusalReply(message: string): ZlinkEnvelope<null> {
  return { code: 'ZKER0997', message, data: null };
}
