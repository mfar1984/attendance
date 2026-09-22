import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { loadEnv } from '../env.js';
import { forbidden, unauthorized } from '../http.js';
import { actionLabel, screenLabel } from './permissions.js';
import { can, resolveSession, type AuthenticatedUser } from './service.js';

export const SESSION_COOKIE = 'attendance_session';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

/**
 * Cookie options for the session.
 *
 * `httpOnly` keeps the token out of reach of any script on the page, and
 * `sameSite: lax` blocks it from riding along on cross-site form posts.
 *
 * `secure` follows NODE_ENV rather than being hardcoded on: the LAN deployment
 * is reached over plain HTTP on an internal address, where a secure-only cookie
 * would simply never be sent and login would appear to succeed and then fail.
 */
export function sessionCookieOptions(expiresAt: Date): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  expires: Date;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: loadEnv().NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  };
}

/** Populates `request.user` when a valid session cookie is present. */
export async function attachUser(request: FastifyRequest): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return;

  const user = await resolveSession(token);
  if (user) request.user = user;
}

/** Rejects the request unless a session is present. */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.user) throw unauthorized();
}

/** Rejects the request unless the session grants an action on a screen. */
export function requirePermission(screen: string, action: string) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.user) throw unauthorized();
    assertCan(request.user, screen, action);
  };
}

/**
 * Rejects unless at least one of the screens grants the action.
 *
 * Needed where a single endpoint backs several screens, such as the settings
 * bundle that the Umum, Branding, Maintenance and Integrasi tabs all read from.
 * The handler then narrows what it returns to the screens the role can actually
 * see, so this check is the outer gate rather than the whole rule.
 */
export function requireAnyPermission(screens: string[], action: string) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.user) throw unauthorized();
    const user = request.user;
    if (!screens.some((screen) => can(user, screen, action))) {
      throw forbidden(`Peranan anda tiada kebenaran "${action}" untuk mana-mana skrin berkenaan`);
    }
  };
}

/**
 * Permission check usable inside a handler.
 *
 * Some routes cannot decide what they need until the body is parsed: creating a
 * user account requires administrator rights or staff rights depending on the
 * `accountType` being asked for, and an HR clerk who may issue app logins must not
 * be able to mint an administrator through the same endpoint.
 */
export function assertCan(user: AuthenticatedUser, screen: string, action: string): void {
  if (!can(user, screen, action)) {
    /*
      Resolved to the source wording here. The refusal is prose the caller reads, and the
      registry holds keys — a message naming `action.edit` would explain nothing.
    */
    throw forbidden(
      `Peranan anda tiada kebenaran "${actionLabel(action)}" untuk ${screenLabel(screen)}`,
    );
  }
}

export function registerAuthHooks(app: FastifyInstance): void {
  app.addHook('onRequest', attachUser);
}
