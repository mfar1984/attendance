import { db } from '../db.js';
import { conflict } from '../http.js';

/**
 * Authentication policy the operator controls.
 *
 * These were constants in the code. They are configurable because the numbers a hospital
 * wants are a policy decision, and because opening a public API makes the login surface
 * worth tightening rather than leaving at whatever the first developer typed.
 *
 * The defaults are the values those constants held, so an installation that never touches
 * this screen behaves exactly as before.
 */

export interface SecurityPolicy {
  maxFailedLogins: number;
  lockoutMinutes: number;
  passwordMinLength: number;
  tokenDefaultDays: number;
  rotationGraceHours: number;
}

export const DEFAULT_POLICY: SecurityPolicy = {
  maxFailedLogins: 5,
  lockoutMinutes: 15,
  passwordMinLength: 12,
  tokenDefaultDays: 90,
  rotationGraceHours: 24,
};

/**
 * Cached briefly.
 *
 * Read on every login and every password change, so a database round trip per call would
 * put the policy lookup on the critical path of authentication. Five seconds is short
 * enough that a change takes effect while the operator is still on the screen.
 */
let cache: { at: number; value: SecurityPolicy } | null = null;

export function invalidatePolicy(): void {
  cache = null;
}

export async function securityPolicy(): Promise<SecurityPolicy> {
  if (cache !== null && Date.now() - cache.at < 5000) return cache.value;

  const row = await db().securityConfig.findUnique({ where: { id: 1 } });
  const value: SecurityPolicy =
    row === null
      ? DEFAULT_POLICY
      : {
          maxFailedLogins: row.maxFailedLogins,
          lockoutMinutes: row.lockoutMinutes,
          passwordMinLength: row.passwordMinLength,
          tokenDefaultDays: row.tokenDefaultDays,
          rotationGraceHours: row.rotationGraceHours,
        };

  cache = { at: Date.now(), value };
  return value;
}

/**
 * Checks a password against the configured minimum.
 *
 * Length only. Composition rules — a digit, a symbol, mixed case — push people towards
 * `Password1!` and towards writing it on a monitor, and the length is what actually
 * resists guessing.
 */
export async function assertPasswordAcceptable(password: string): Promise<void> {
  const { passwordMinLength } = await securityPolicy();
  if (password.length < passwordMinLength) {
    throw conflict(`Kata laluan mesti sekurang-kurangnya ${String(passwordMinLength)} aksara.`);
  }
}
