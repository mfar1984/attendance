import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '../db.js';
import { clientIp, parseBody, unauthorized, userAgent } from '../http.js';
import { SESSION_COOKIE, requireAuth, sessionCookieOptions } from './plugin.js';
import { login, revokeSession } from './service.js';

const loginSchema = z.object({
  email: z.email('Emel tidak sah'),
  password: z.string().min(1, 'Kata laluan diperlukan'),
  /** Required for administrator accounts; ignored for staff app logins. */
  totp: z
    .string()
    .regex(/^\d{6}$/, 'Kod 2FA mesti 6 digit')
    .optional(),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', async (request, reply) => {
    const body = parseBody(loginSchema, request.body);

    const result = await login({
      email: body.email,
      password: body.password,
      ...(body.totp ? { totp: body.totp } : {}),
      ...(clientIp(request) ? { ipAddress: clientIp(request) } : {}),
      ...(userAgent(request) ? { userAgent: userAgent(request) } : {}),
    });

    reply.setCookie(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt));
    return {
      user: result.user,
      expiresAt: result.expiresAt,
      display: await displayPreferences(result.user.locale),
    };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await revokeSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /** Lets the web client restore state on reload without storing anything itself. */
  app.get('/api/auth/me', { preHandler: requireAuth }, async (request) => {
    if (!request.user) throw unauthorized();
    return { user: request.user, display: await displayPreferences(request.user.locale) };
  });
}

/**
 * Display preferences, carried on the session rather than read from `/api/settings`.
 *
 * Every screen formats a time, and only a handful of roles may view the settings bundle.
 * Reading them from there would mean a clerk sees 24-hour clocks because they cannot open
 * the page that says 12. The date and time formats are not secrets and not per-user — they
 * describe how this deployment writes a date.
 *
 * `locale` is the exception: it is per-person, and `chosen` is the code stored on the
 * account. Resolved here rather than on the client so there is one answer to "which
 * language is this session in" and the client cannot hold a different one.
 */
async function displayPreferences(chosen: string | null): Promise<{
  dateFormat: string;
  timeFormat: '12' | '24';
  weekStart: '0' | '1';
  organisationName: string | null;
  logoUrl: string | null;
  locale: string;
}> {
  const rows = await db().setting.findMany({
    where: {
      key: {
        in: [
          'organisation.dateFormat',
          'organisation.timeFormat',
          'organisation.weekStart',
          'organisation.name',
          'organisation.logoPath',
        ],
      },
    },
  });
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const text = (key: string): string | null =>
    typeof values.get(key) === 'string' ? String(values.get(key)) : null;

  /**
   * The language this session reads the interface in.
   *
   * The person's own choice where they made one, the deployment default otherwise, and the
   * source language if neither resolves — there is always a source, and it is the only
   * language guaranteed to be complete.
   *
   * The stored choice is checked against `active` on every read, not just when it was
   * saved. A language can be switched off after somebody picked it, and honouring a stale
   * choice would show that person the half-and-half screen `active` exists to prevent —
   * except silently, and only to them, which is the hardest version of it to diagnose.
   */
  const [picked, fallback] = await Promise.all([
    chosen === null
      ? Promise.resolve(null)
      : db()
          .translationLocale.findFirst({
            where: { code: chosen, active: true },
            select: { code: true },
          })
          .catch(() => null),
    db()
      .translationLocale.findFirst({ where: { isDefault: true, active: true }, select: { code: true } })
      .catch(() => null),
  ]);

  return {
    dateFormat: text('organisation.dateFormat') ?? 'DD/MM/YYYY',
    timeFormat: text('organisation.timeFormat') === '12' ? '12' : '24',
    weekStart: text('organisation.weekStart') === '0' ? '0' : '1',
    organisationName: text('organisation.name'),
    // The URL, never the filename. Absent rather than broken when nothing is uploaded.
    logoUrl: text('organisation.logoPath') === null ? null : '/api/branding/logo',
    locale: picked?.code ?? fallback?.code ?? 'ms',
  };
}
