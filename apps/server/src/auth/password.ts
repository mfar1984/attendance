import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

import { logger } from '../logger.js';

/**
 * Password hashing.
 *
 * `scrypt` from `node:crypto`, not Argon2id, and the reason is deployment rather than
 * cryptography. Argon2id is the better function on paper and was used here first. But
 * `argon2` is a native module, and the shared host this runs on carries glibc 2.28 while
 * the published prebuild requires 2.34 — so `require('argon2')` fails with
 * `ERR_DLOPEN_FAILED` and every login is impossible. Compiling from source needs a
 * toolchain the host does not have, and would need redoing on every `npm ci`.
 *
 * A hash nobody can compute is not a stronger hash. scrypt is memory-hard, it is in the
 * Node standard library, and it cannot be broken by the host changing its base image.
 *
 * ## Parameters
 *
 * N=32768, r=8, p=1 costs 128*N*r = 32 MiB and roughly 100 ms per attempt. That matches
 * what the Argon2id configuration here was tuned for: this hash guards the ability to
 * rewrite payroll for thousands of people, and logins are infrequent enough that 100 ms
 * is not a throughput concern.
 *
 * `maxmem` is set above the 32 MiB requirement because Node's default ceiling is exactly
 * 32 MiB, and a cost that sits on the boundary throws rather than degrading.
 *
 * ## Why `argon2` is still in package.json, under `optionalDependencies`
 *
 * Only to read hashes written before this change. It sits under `optionalDependencies` so a
 * host that cannot even build it still completes `npm ci` — a deployment must not fail over
 * a package used solely to read old rows. It is never imported at the top level; see
 * `verifyLegacyArgon2` below.
 *
 * ## Format
 *
 * `scrypt$N$r$p$saltBase64$hashBase64`
 *
 * Self-describing on purpose. The cost of a KDF is expected to rise over the life of an
 * installation, and a stored hash that does not carry the parameters it was made with
 * cannot be verified after they change — which turns a routine hardening step into a
 * forced password reset for every account.
 */
/**
 * Hand-written rather than `promisify(scrypt)`.
 *
 * `crypto.scrypt` is overloaded with and without an options argument, and `promisify`
 * resolves to the one without — so passing a cost through it does not typecheck, and
 * casting the callback away would let a future edit drop the options silently.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

const PARAMS = { N: 32_768, r: 8, p: 1 } as const;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
/** 128*N*r is 32 MiB exactly; Node's default ceiling is the same number. */
const MAX_MEM = 64 * 1024 * 1024;

const PREFIX = 'scrypt';

export async function hashPassword(plaintext: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(plaintext, salt, KEY_BYTES, { ...PARAMS, maxmem: MAX_MEM });

  return [
    PREFIX,
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  if (hash.startsWith(`${PREFIX}$`)) return verifyScrypt(hash, plaintext);

  /*
   * An Argon2id hash written before the move.
   *
   * Verified through the old library where it can still be loaded, which is the case on a
   * developer machine and not on the shared host. Where it cannot load, this returns false
   * and the account needs a password reset — stated plainly rather than hidden, because a
   * login that fails for an environmental reason looks exactly like a wrong password.
   *
   * A successful verification here is reported to the caller so it can re-hash with scrypt,
   * which is how these disappear without anybody being locked out.
   */
  if (hash.startsWith('$argon2')) return verifyLegacyArgon2(hash, plaintext);

  // A malformed stored hash must read as "wrong password", never as success.
  return false;
}

/**
 * Whether a stored hash should be replaced after a successful login.
 *
 * Re-hashing on login is the only way to migrate: a hash cannot be converted without the
 * plaintext, and the plaintext exists for exactly one moment.
 */
export function needsRehash(hash: string): boolean {
  if (!hash.startsWith(`${PREFIX}$`)) return true;

  const parts = hash.split('$');
  return (
    parts[1] !== String(PARAMS.N) || parts[2] !== String(PARAMS.r) || parts[3] !== String(PARAMS.p)
  );
}

async function verifyScrypt(hash: string, plaintext: string): Promise<boolean> {
  const parts = hash.split('$');
  if (parts.length !== 6) return false;

  const [, rawN, rawR, rawP, rawSalt, rawKey] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // A stored cost is trusted only within bounds. Without this, a tampered row could name
  // a cost large enough to exhaust memory on every login attempt.
  if (N < 1024 || N > 1_048_576 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(rawKey ?? '', 'base64');
    actual = await scrypt(plaintext, Buffer.from(rawSalt ?? '', 'base64'), expected.length, {
      N,
      r,
      p,
      maxmem: MAX_MEM,
    });
  } catch {
    return false;
  }

  // `timingSafeEqual` throws on a length mismatch rather than returning false.
  if (expected.length !== actual.length || expected.length === 0) return false;
  return timingSafeEqual(expected, actual);
}

/** Cached so a host without a loadable `argon2` does not retry the import on every login. */
let argon2Module: { verify: (hash: string, plain: string) => Promise<boolean> } | null | undefined;

async function verifyLegacyArgon2(hash: string, plaintext: string): Promise<boolean> {
  if (argon2Module === undefined) {
    try {
      const loaded = (await import('argon2')) as unknown as {
        default?: { verify: (hash: string, plain: string) => Promise<boolean> };
        verify?: (hash: string, plain: string) => Promise<boolean>;
      };
      const verify = loaded.default?.verify ?? loaded.verify;
      argon2Module = verify === undefined ? null : { verify };
    } catch (error) {
      argon2Module = null;
      logger().warn(
        { err: error },
        'An account still holds an Argon2 password hash and argon2 cannot be loaded on this host. ' +
          'That account needs a password reset; new passwords are hashed with scrypt.',
      );
    }
  }

  if (argon2Module === null) return false;

  try {
    return await argon2Module.verify(hash, plaintext);
  } catch {
    return false;
  }
}
