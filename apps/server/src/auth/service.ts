import argon2 from 'argon2';
import { generateSecret, generateURI, verifySync } from 'otplib';

import { decryptSecret, encryptSecret, hashSessionToken, newSessionToken } from '../crypto.js';
import { db } from '../db.js';
import { loadEnv } from '../env.js';
import { forbidden, unauthorized } from '../http.js';
import { logger } from '../logger.js';
import { securityPolicy } from '../security/policy.js';
import { hashPassword, needsRehash, verifyPassword } from './password.js';

export { hashPassword, verifyPassword } from './password.js';

// The lockout threshold and duration were constants here. They now come from
// `securityPolicy()`, which defaults to the same 5 attempts and 15 minutes, so an
// installation that never opens the Security screen behaves exactly as before.

export interface AuthenticatedUser {
  accountId: number;
  staffId: number;
  employeeNo: string;
  fullName: string;
  email: string;
  accountType: string;
  roleName: string;
  /**
   * Carried because an approval chain rung can name a role rather than a person.
   *
   * The name alone will not do: comparing role names would break the moment somebody
   * renames a role, and the chain stores the id.
   */
  roleId: number;
  permissions: Record<string, string[]>;
  /**
   * The language this person chose, or null to follow the deployment default.
   *
   * Carried on the session because it is resolved from the same account row the session
   * already loads, and because the alternative is a lookup on every request that needs to
   * know which words to send. Not a secret: it is one of the five thousand things about a
   * person that the person themselves set.
   */
  locale: string | null;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: AuthenticatedUser;
}

/**
 * Verifies credentials and opens a session.
 *
 * Failures are reported with one generic message regardless of cause, so the
 * response cannot be used to discover which addresses have accounts.
 */
export async function login(input: {
  email: string;
  password: string;
  totp?: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<LoginResult> {
  const prisma = db();
  const account = await prisma.userAccount.findUnique({
    where: { email: input.email.toLowerCase() },
    include: { role: true, staff: true },
  });

  const genericFailure = unauthorized('Emel atau kata laluan tidak betul');

  if (!account || !account.passwordHash) throw genericFailure;

  if (account.lockedUntil && account.lockedUntil > new Date()) {
    const seconds = Math.ceil((account.lockedUntil.getTime() - Date.now()) / 1000);
    throw forbidden(`Akaun dikunci sementara. Cuba lagi dalam ${seconds}s.`);
  }

  if (account.status === 'suspended') throw forbidden('Akaun digantung');
  if (account.status === 'pending') {
    throw forbidden('Akaun belum diaktifkan. Sahkan melalui emel jemputan.');
  }
  if (account.role.status !== 'active') {
    throw forbidden(`Peranan "${account.role.name}" telah dinyahaktifkan. Hubungi pentadbir.`);
  }

  const passwordOk = await verifyPassword(account.passwordHash, input.password);
  if (!passwordOk) {
    await registerFailedLogin(account.id, account.failedLoginCount, {
      label: account.staff.fullName,
      ipAddress: input.ipAddress,
      reason: 'Kata laluan salah',
    });
    throw genericFailure;
  }

  /*
   * Upgrade the stored hash while the plaintext is in hand.
   *
   * A hash cannot be converted without the password, and the password exists for exactly
   * this moment. Doing it here is what lets the hashing function change without forcing a
   * reset on every account — the old hashes disappear as people log in.
   *
   * Failure is swallowed deliberately. The login already succeeded, and refusing it
   * because a housekeeping write failed would turn a working credential into a lockout.
   */
  if (needsRehash(account.passwordHash)) {
    try {
      await prisma.userAccount.update({
        where: { id: account.id },
        data: { passwordHash: await hashPassword(input.password) },
      });
    } catch (error) {
      logger().warn({ err: error, accountId: account.id }, 'Could not upgrade a password hash');
    }
  }

  const env = loadEnv();

  /**
   * Second factor for administrators.
   *
   * Staff app accounts are exempt by design: enforcing TOTP across thousands of
   * phones is not workable, so those rely on device binding instead.
   *
   * When a code is supplied it is always verified, even with enforcement off. A
   * setting that silently ignores a submitted credential is worse than no
   * setting, because it makes a broken authenticator look like it is working.
   */
  if (account.accountType === 'admin' && account.totpSecretEncrypted) {
    if (input.totp) {
      if (!verifyTotp(account.totpSecretEncrypted, input.totp)) {
        await registerFailedLogin(account.id, account.failedLoginCount, {
          label: account.staff.fullName,
          ipAddress: input.ipAddress,
          reason: 'Kod 2FA tidak sah',
        });
        throw unauthorized('Kod 2FA tidak sah');
      }
    } else if (env.REQUIRE_ADMIN_2FA) {
      throw unauthorized('Kod 2FA diperlukan');
    }
  } else if (account.accountType === 'admin' && env.REQUIRE_ADMIN_2FA) {
    throw forbidden('Akaun admin perlu menyiapkan 2FA sebelum log masuk');
  }
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000);

  await prisma.$transaction([
    prisma.session.create({
      data: {
        tokenHash: hashSessionToken(token),
        accountId: account.id,
        expiresAt,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    }),
    prisma.userAccount.update({
      where: { id: account.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    }),
    // Written inside the same transaction as the session, so a login can never
    // exist without its log entry.
    prisma.activityLog.create({
      data: {
        accountId: account.id,
        actorLabel: account.staff.fullName,
        level: 'info',
        category: 'auth',
        source: 'web',
        action: 'auth.login',
        detail: `${account.accountType} · ${account.role.name}`,
        ipAddress: input.ipAddress ?? null,
      },
    }),
  ]);

  return {
    token,
    expiresAt,
    user: toAuthenticatedUser(account),
  };
}

async function registerFailedLogin(
  accountId: number,
  currentCount: number,
  context: { label: string; ipAddress?: string; reason: string },
): Promise<void> {
  const { maxFailedLogins, lockoutMinutes } = await securityPolicy();
  const next = currentCount + 1;
  const locked = next >= maxFailedLogins;

  await db().userAccount.update({
    where: { id: accountId },
    data: {
      failedLoginCount: next,
      lockedUntil: locked ? new Date(Date.now() + lockoutMinutes * 60_000) : null,
    },
  });

  /**
   * Recorded even though the response to the caller stays generic.
   *
   * The login response deliberately reveals nothing about why it failed, so this
   * is the only place a repeated attempt against one account is visible. A security
   * log holding successes and no failures cannot answer the question it exists for.
   */
  await db().activityLog.create({
    data: {
      accountId,
      actorLabel: context.label,
      level: locked ? 'error' : 'warn',
      category: 'auth',
      source: 'web',
      action: 'auth.login_failed',
      detail: locked
        ? `${context.reason} · percubaan ${String(next)}, akaun dikunci ${String(lockoutMinutes)} minit`
        : `${context.reason} · percubaan ${String(next)} daripada ${String(maxFailedLogins)}`,
      ipAddress: context.ipAddress ?? null,
    },
  });
}

/** Resolves a session cookie, sliding `lastSeenAt` forward. */
export async function resolveSession(token: string): Promise<AuthenticatedUser | null> {
  const prisma = db();
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { account: { include: { role: true, staff: true } } },
  });

  if (!session || session.revokedAt) return null;
  if (session.expiresAt <= new Date()) return null;
  if (session.account.status !== 'active') return null;
  // Deactivating a role denies access to everyone holding it, without deleting the
  // role and losing what the accounts under it were allowed to do.
  if (session.account.role.status !== 'active') return null;

  /**
   * Throttled so an active operator does not generate a write per request.
   *
   * ## Why the cutoff is in the `WHERE` and not only in the `if`
   *
   * This runs on every authenticated request, and a screen opening fires several at once. All of
   * them read the same session row, all of them find `lastSeenAt` older than a minute, and all of
   * them then wrote to that one row at the same moment — which MariaDB refuses with 1020, "record
   * has changed since last read".
   *
   * Moving the condition into the statement makes it a compare-and-swap: the first writer matches,
   * the rest match nothing and become no-ops. That removes the contention rather than tolerating
   * it, and it is the same shape as `exchangeEnrolToken` claiming a token.
   *
   * ## And why it cannot fail the request
   *
   * `updateMany` rather than `update` because the singular form reads the row back and carries the
   * optimistic check this is avoiding, and because a session that vanished mid-request should not
   * raise `RecordNotFound` on a liveness stamp. The swallowed rejection is the same trade
   * `revokeSession` makes below: failing the request an operator is waiting on, because a
   * last-seen timestamp could not be written, is the wrong way round.
   */
  const staleBefore = new Date(Date.now() - 60_000);
  if (session.lastSeenAt < staleBefore) {
    await prisma.session
      .updateMany({
        where: { tokenHash: session.tokenHash, lastSeenAt: { lt: staleBefore } },
        data: { lastSeenAt: new Date() },
      })
      .catch(() => undefined);
  }

  return toAuthenticatedUser(session.account);
}

export async function revokeSession(token: string): Promise<void> {
  await db()
    .session.updateMany({
      where: { tokenHash: hashSessionToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    })
    .catch(() => undefined);
}

/** Generates a TOTP secret and the URI an authenticator app can scan. */
export function createTotpSecret(
  email: string,
  issuer = 'Sistem Kehadiran',
): { secret: string; encrypted: string; otpauthUrl: string } {
  const secret = generateSecret();
  return {
    secret,
    encrypted: encryptSecret(secret),
    otpauthUrl: generateURI({ issuer, label: email, secret }),
  };
}

/**
 * Checks a TOTP code.
 *
 * A one-step tolerance is allowed on each side, which covers the common case of
 * a phone clock a few seconds out or a code entered as the window turns over.
 * Widening it further would enlarge the replay window for no practical gain.
 */
export function verifyTotp(encryptedSecret: string, code: string): boolean {
  return verifySync({
    secret: decryptSecret(encryptedSecret),
    token: code,
    epochTolerance: 30,
  }).valid;
}

type AccountWithRelations = {
  id: number;
  email: string;
  accountType: string;
  locale: string | null;
  role: { id: number; name: string; status: string; permissions: unknown };
  staff: { id: number; employeeNo: string; fullName: string };
};

function toAuthenticatedUser(account: AccountWithRelations): AuthenticatedUser {
  return {
    accountId: account.id,
    staffId: account.staff.id,
    employeeNo: account.staff.employeeNo,
    fullName: account.staff.fullName,
    email: account.email,
    accountType: account.accountType,
    roleName: account.role.name,
    roleId: account.role.id,
    permissions: (account.role.permissions ?? {}) as Record<string, string[]>,
    locale: account.locale,
  };
}

/** True when the role grants an action on a module. */
export function can(user: AuthenticatedUser, module: string, action: string): boolean {
  const granted = user.permissions[module];
  return Array.isArray(granted) && granted.includes(action);
}
