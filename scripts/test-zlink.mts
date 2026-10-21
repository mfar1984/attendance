/**
 * Regression suite for the ZKBio Zlink wire format.
 *
 * No server and no database: these are pure functions, and they are the ones that decide whether a
 * callback carrying attendance is accepted. That makes them worth a suite of their own rather than
 * a line in a verification script — the same reason `test-time.mts` exists.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/test-zlink.mts
 *
 * ## What this proves, and what it cannot
 *
 * It proves the signature matches an independently computed MD5, that the replay window is
 * enforced in both directions, that a tampered signature fails, and that the decryption is the
 * exact inverse of an AES-128-CBC encrypt keyed the way the platform's reference describes —
 * including when the ciphertext arrives hex-encoded rather than base64, which the reference does
 * not specify.
 *
 * It cannot prove the reference is right about those factors. Only a real callback from Zlink does
 * that, and the first one will either verify or log precisely which step failed.
 */

import { createCipheriv, createHash } from 'node:crypto';

import {
  ZLINK_CALLBACK_TOLERANCE_MS,
  ZLINK_SUCCESS,
  decryptZlinkPayload,
  verifyZlinkCallback,
  zlinkCallbackSignature,
  zlinkRetryable,
  zlinkSucceeded,
  zlinkTokenRejected,
  zlinkVerificationReply,
} from '../apps/server/src/devices/drivers/zlink/protocol.js';

let failures = 0;

function check(ok: boolean, what: string, detail = ''): void {
  if (ok) {
    console.log(`  [ok]   ${what}`);
  } else {
    failures += 1;
    console.log(`  [FAIL] ${what}${detail === '' ? '' : ` :: ${detail}`}`);
  }
}

/*
 * Stand-ins, with the lengths the platform actually issues.
 *
 * Sixteen characters for the key and the IV, because that is what makes the cipher AES-128 — a
 * fixture with a 32-character key would pass here while the production path threw on a length
 * `createDecipheriv` rejects. Thirty-two for the verification token, which is only hashed and so
 * has no length constraint, but matching reality costs nothing.
 *
 * Deliberately distinguishable from each other. The first version of this file built all three by
 * overwriting a real value with a repeated character, which made the token and the "wrong token"
 * case the same string — so the assertion that a different token fails was asserting nothing, and
 * the suite caught it on the first run.
 */
const APP_KEY = 'AppKeyFixture001';
const ENCRYPTION_KEY = 'EncIvFixture0001';
const VERIFICATION_TOKEN = 'VerificationTokenFixture00000001';
const OTHER_TOKEN = 'VerificationTokenFixture00000002';

console.log('\nSignature');

{
  const timestamp = '1772107200000';
  const nonce = 'a1b2c3d4';

  /*
   * Computed here independently rather than by calling the function under test, so this asserts
   * the algorithm and not merely that the function is self-consistent.
   */
  const expected = createHash('md5')
    .update(`${VERIFICATION_TOKEN}${timestamp}${nonce}`, 'utf8')
    .digest('hex');

  const actual = zlinkCallbackSignature(VERIFICATION_TOKEN, timestamp, nonce);
  check(actual === expected, 'MD5 over token + timestamp + nonce, concatenated', actual);
  check(actual.length === 32, 'thirty-two characters, as the reference specifies', String(actual.length));
  check(actual === actual.toLowerCase(), 'lowercase');

  const now = Number(timestamp);
  check(
    verifyZlinkCallback(VERIFICATION_TOKEN, { sign: actual, timestamp, nonce }, now).ok,
    'a correct signature verifies',
  );

  /*
   * Upper case accepted on the way in. The reference says the signature is lowercase, but a
   * platform that sent it upper case would otherwise be refused on a signature that is
   * cryptographically correct — and the failure would read as tampering.
   */
  check(
    verifyZlinkCallback(
      VERIFICATION_TOKEN,
      { sign: actual.toUpperCase(), timestamp, nonce },
      now,
    ).ok,
    'an upper-case signature is accepted rather than read as tampering',
  );

  const tampered = `${actual.slice(0, 31)}${actual.endsWith('0') ? '1' : '0'}`;
  const verdict = verifyZlinkCallback(VERIFICATION_TOKEN, { sign: tampered, timestamp, nonce }, now);
  check(!verdict.ok && verdict.reason === 'mismatch', 'one altered character fails');

  const wrongNonce = verifyZlinkCallback(
    VERIFICATION_TOKEN,
    { sign: actual, timestamp, nonce: 'd4c3b2a1' },
    now,
  );
  check(!wrongNonce.ok, 'the nonce is inside the signed material');

  check(OTHER_TOKEN !== VERIFICATION_TOKEN, 'the fixtures are actually different', OTHER_TOKEN);
  const wrongToken = verifyZlinkCallback(OTHER_TOKEN, { sign: actual, timestamp, nonce }, now);
  check(!wrongToken.ok, 'a different verification token fails');
}

console.log('\nReplay window');

{
  const nonce = 'a1b2c3d4';
  const now = 1772107200000;

  const at = (offsetMs: number): ReturnType<typeof verifyZlinkCallback> => {
    const timestamp = String(now + offsetMs);
    const sign = zlinkCallbackSignature(VERIFICATION_TOKEN, timestamp, nonce);
    return verifyZlinkCallback(VERIFICATION_TOKEN, { sign, timestamp, nonce }, now);
  };

  check(at(0).ok, 'now is accepted');
  check(at(-ZLINK_CALLBACK_TOLERANCE_MS + 1000).ok, 'inside the window, behind');
  check(at(ZLINK_CALLBACK_TOLERANCE_MS - 1000).ok, 'inside the window, ahead');

  const old = at(-ZLINK_CALLBACK_TOLERANCE_MS - 1000);
  check(!old.ok && old.reason === 'stale', 'a captured request replayed later is refused');

  /*
   * Checked in both directions deliberately. Only bounding the past leaves a forged timestamp far
   * in the future valid forever, which is the same hole as not bounding it at all.
   */
  const future = at(ZLINK_CALLBACK_TOLERANCE_MS + 1000);
  check(!future.ok && future.reason === 'stale', 'and so is one dated in the future');
}

console.log('\nMalformed callbacks');

{
  const cases: Array<[string, Parameters<typeof verifyZlinkCallback>[1]]> = [
    ['no parameters at all', {}],
    ['no signature', { timestamp: '1772107200000', nonce: 'a1b2c3d4' }],
    ['no timestamp', { sign: 'x'.repeat(32), nonce: 'a1b2c3d4' }],
    ['no nonce', { sign: 'x'.repeat(32), timestamp: '1772107200000' }],
    ['empty signature', { sign: '', timestamp: '1772107200000', nonce: 'a1b2c3d4' }],
    ['a timestamp that is not a number', { sign: 'x'.repeat(32), timestamp: 'soon', nonce: 'a1b2c3d4' }],
  ];

  for (const [what, query] of cases) {
    const verdict = verifyZlinkCallback(VERIFICATION_TOKEN, query);
    check(!verdict.ok && verdict.reason === 'malformed', `refused: ${what}`);
  }
}

console.log('\nPayload decryption');

{
  /** Encrypts the way the reference describes, so the test asserts an inverse rather than itself. */
  const encrypt = (plaintext: string, encoding: 'base64' | 'hex'): string => {
    const cipher = createCipheriv(
      'aes-128-cbc',
      Buffer.from(APP_KEY, 'utf8'),
      Buffer.from(ENCRYPTION_KEY, 'utf8'),
    );
    return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString(encoding);
  };

  const echo = 'zlink-url-verification-echo-1234';
  check(
    decryptZlinkPayload(encrypt(echo, 'base64'), APP_KEY, ENCRYPTION_KEY) === echo,
    'base64 ciphertext round-trips',
  );

  /*
   * Hex as well, because the reference never states the encoding — it names the three decryption
   * factors and calls the input "an encrypted string". Supporting both is what stops the first
   * real callback failing on a detail nobody could have read off the page.
   */
  check(
    decryptZlinkPayload(encrypt(echo, 'hex'), APP_KEY, ENCRYPTION_KEY) === echo,
    'hex ciphertext round-trips too',
  );

  // A real event body rather than a short token, since padding behaviour differs across a block
  // boundary and an event is the case that actually matters.
  const body = JSON.stringify({
    event: 'attendance.punch',
    data: { personId: 'P001', deviceSn: 'VGU6262300102', punchTime: '2026-08-28 08:03:00' },
  });
  check(
    decryptZlinkPayload(encrypt(body, 'base64'), APP_KEY, ENCRYPTION_KEY) === body,
    'a full event body round-trips',
  );

  // Exactly one block, and exactly one block minus one byte: the two padding edges.
  for (const length of [15, 16, 17, 31, 32]) {
    const value = 'x'.repeat(length);
    check(
      decryptZlinkPayload(encrypt(value, 'base64'), APP_KEY, ENCRYPTION_KEY) === value,
      `${String(length)} bytes round-trips`,
    );
  }

  check(
    decryptZlinkPayload(encrypt(echo, 'base64'), 'WrongKeyFixture1', ENCRYPTION_KEY) !== echo,
    'the wrong key does not yield the plaintext',
  );
  check(
    decryptZlinkPayload(encrypt(echo, 'base64'), APP_KEY, 'WrongIvFixture01') !== echo,
    'nor does the wrong IV',
  );

  /*
   * Null rather than a throw. This runs inside a route that answers a platform which retries, so
   * an exception would become a 500 and the retries would fail identically — while the reason
   * stayed in a stack trace instead of a log line naming the step.
   */
  check(decryptZlinkPayload('not base64 at all !!!', APP_KEY, ENCRYPTION_KEY) === null, 'garbage returns null');
  check(decryptZlinkPayload('', APP_KEY, ENCRYPTION_KEY) === null, 'an empty value returns null');
  check(
    decryptZlinkPayload(encrypt(echo, 'base64'), 'short', ENCRYPTION_KEY) === null,
    'a key of the wrong length returns null rather than throwing',
  );
}

console.log('\nResponse envelope');

{
  check(zlinkSucceeded({ code: ZLINK_SUCCESS }), 'ZCOP0000 is success');
  /*
   * The trap this guards. Every other API here answers `0` or an HTTP status; this one sends a
   * string, and a failed operation arrives as HTTP 200 with a ZKER code. Reading it the habitual
   * way would record every business refusal as a success.
   */
  check(!zlinkSucceeded({ code: 0 }), 'numeric zero is NOT success');
  check(!zlinkSucceeded({ code: '0' }), 'the string zero is not either');
  check(!zlinkSucceeded({ code: 'ZKER0997' }), 'an error code is not success');
  check(!zlinkSucceeded({}), 'a missing code is not success');

  check(zlinkRetryable('ZKER0993'), 'rate limiting is retryable');
  check(zlinkRetryable('ZKER0992'), 'interface busy is retryable');
  check(zlinkRetryable('ZKER0999'), 'an internal error is retryable');
  check(!zlinkRetryable('ZKER0997'), 'an invalid parameter is not');
  check(!zlinkRetryable('ZKER0998'), 'a business exception is not');
  check(
    !zlinkRetryable('ZKER0991'),
    'an IP blacklist refusal is not — it needs the address whitelisted, not another attempt',
  );

  check(zlinkTokenRejected(401, ''), 'a 401 means exchange a fresh token');
  check(!zlinkTokenRejected(200, 'ZKER0993'), 'rate limiting does not');

  const reply = zlinkVerificationReply('plain echo');
  check(
    reply.code === ZLINK_SUCCESS && reply.data === 'plain echo',
    'the handshake reply carries the decrypted echo',
    JSON.stringify(reply),
  );
}

console.log(failures === 0 ? '\nSemua lulus\n' : `\n${String(failures)} GAGAL\n`);
process.exit(failures === 0 ? 0 : 1);
