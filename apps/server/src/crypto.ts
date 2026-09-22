import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { loadEnv } from './env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';

let key: Buffer | null = null;

function encryptionKey(): Buffer {
  key ??= Buffer.from(loadEnv().ENCRYPTION_KEY, 'hex');
  return key;
}

/**
 * Encrypts a secret for storage.
 *
 * Applies to terminal passwords, TOTP secrets and door PINs. The terminal itself
 * returns door PINs in cleartext from `UserInfo/Search`, so keeping them
 * readable here as well would mean one database dump exposes every PIN in the
 * building.
 *
 * Output is `v1:<iv>:<tag>:<ciphertext>`, all base64url. The version prefix
 * exists so the key can be rotated without guessing at the old format.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, b64(iv), b64(tag), b64(ciphertext)].join(':');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Encrypted value is not in the expected v1 format');
  }

  const [, ivPart, tagPart, dataPart] = parts as [string, string, string, string];
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), unb64(ivPart));
  decipher.setAuthTag(unb64(tagPart));

  // Throws when the ciphertext or tag has been altered, which is the point of
  // using GCM rather than CBC here.
  return Buffer.concat([decipher.update(unb64(dataPart)), decipher.final()]).toString('utf8');
}

/** Session cookies are stored hashed so a database leak yields no live sessions. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Constant-time comparison for secrets that are compared as strings. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function b64(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function unb64(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}
