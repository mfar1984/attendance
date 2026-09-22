import { isIP } from 'node:net';

import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../db.js';
import { HttpError, forbidden, notFound, unauthorized } from '../http.js';
import { recordActivity } from '../logging/activity.js';
import { readTokenFromHeaders, tokenCan, verifyToken, type TokenIdentity } from './tokens.js';

/**
 * The gate in front of every public API route.
 *
 * Layered deliberately, cheapest and least revealing first: the master switch, then the
 * address filter, then the rate limit, then the credential. A caller that is not allowed
 * to be here at all should never reach the point of having its token examined.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** Set once a public API request has been authenticated. */
    apiToken?: TokenIdentity;
  }
}

export interface ApiSettings {
  enabled: boolean;
  requireToken: boolean;
  logRequests: boolean;
  allowAllOrigins: boolean;
  allowedOrigins: string[];
  rateLimitEnabled: boolean;
  maxPerMinute: number;
  ipWhitelist: string[];
}

const DEFAULTS: ApiSettings = {
  enabled: false,
  requireToken: true,
  logRequests: true,
  allowAllOrigins: false,
  allowedOrigins: [],
  rateLimitEnabled: true,
  maxPerMinute: 120,
  ipWhitelist: [],
};

/**
 * Cached for a second.
 *
 * Reading five settings from the database on every API call would make the rate limit the
 * second most expensive thing about a request. A second is short enough that switching the
 * API off takes effect while the operator is still looking at the screen.
 */
let cache: { at: number; value: ApiSettings } | null = null;

export function invalidateApiSettings(): void {
  cache = null;
}

export async function apiSettings(): Promise<ApiSettings> {
  if (cache !== null && Date.now() - cache.at < 1000) return cache.value;

  const row = await db().apiConfig.findUnique({ where: { id: 1 } });
  const value: ApiSettings = row === null
    ? DEFAULTS
    : {
        enabled: row.enabled,
        requireToken: row.requireToken,
        logRequests: row.logRequests,
        allowAllOrigins: row.allowAllOrigins,
        allowedOrigins: stringList(row.allowedOrigins),
        rateLimitEnabled: row.rateLimitEnabled,
        maxPerMinute: row.maxPerMinute,
        ipWhitelist: stringList(row.ipWhitelist),
      };

  cache = { at: Date.now(), value };
  return value;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

// ---------------------------------------------------------------------------
// Address filtering
// ---------------------------------------------------------------------------

/**
 * Whether an address falls inside an allowed entry.
 *
 * Supports a bare address or CIDR notation, for both IPv4 and IPv6. Written here rather
 * than pulled in as a dependency because the whole of it is thirty lines and a supply
 * chain addition to an access control is a poor trade.
 */
export function addressMatches(address: string, entry: string): boolean {
  const candidate = normaliseAddress(address);
  const [range, bitsText] = entry.trim().split('/');
  if (range === undefined || range.length === 0) return false;

  const target = normaliseAddress(range);
  if (bitsText === undefined) return candidate === target;

  const bits = Number(bitsText);
  if (!Number.isInteger(bits) || bits < 0) return false;

  const left = toBytes(candidate);
  const right = toBytes(target);
  // A v4 address never matches a v6 range, and comparing them byte-wise would silently
  // produce a wrong answer rather than a refusal.
  if (left === null || right === null || left.length !== right.length) return false;
  if (bits > left.length * 8) return false;

  const wholeBytes = Math.floor(bits / 8);
  for (let index = 0; index < wholeBytes; index += 1) {
    if (left[index] !== right[index]) return false;
  }

  const remainder = bits % 8;
  if (remainder === 0) return true;

  const mask = 0xff << (8 - remainder);
  return ((left[wholeBytes] ?? 0) & mask) === ((right[wholeBytes] ?? 0) & mask);
}

/** IPv4-mapped IPv6 (`::ffff:10.0.0.1`) is how Node reports v4 on a dual-stack socket. */
function normaliseAddress(address: string): string {
  const trimmed = address.trim().replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(trimmed);
  return mapped?.[1] ?? trimmed;
}

function toBytes(address: string): number[] | null {
  const kind = isIP(address);
  if (kind === 4) {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return null;
    }
    return parts;
  }
  if (kind !== 6) return null;

  // Expands `::` so every group is present before splitting into bytes.
  const [head, tail] = address.split('::');
  const left = head === undefined || head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;

  const groups = [...left, ...Array.from({ length: address.includes('::') ? missing : 0 }, () => '0'), ...right];
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    const value = Number.parseInt(group === '' ? '0' : group, 16);
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) return null;
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}

function addressAllowed(address: string, whitelist: string[]): boolean {
  // Empty means unrestricted. Stated on the screen, because an empty allow list reading
  // as "deny everything" would be the other reasonable guess.
  if (whitelist.length === 0) return true;
  return whitelist.some((entry) => addressMatches(address, entry));
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * A fixed-window counter, per token where there is one and per address otherwise.
 *
 * In memory on purpose: this is a single-process LAN server, and a shared store would add
 * an outage mode to a limiter whose job is to keep the service up. The window is fixed
 * rather than sliding, which allows a burst of up to twice the limit across a boundary —
 * acceptable for protecting a read-only feed, and cheap enough to be reliable.
 */
const counters = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string, maxPerMinute: number): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const existing = counters.get(key);

  if (existing === undefined || existing.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + 60_000 });
    // Swept opportunistically so an address that calls once does not occupy a slot for
    // the lifetime of the process.
    if (counters.size > 5000) {
      for (const [entry, state] of counters) if (state.resetAt <= now) counters.delete(entry);
    }
    return { allowed: true, retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > maxPerMinute) {
    return { allowed: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

/** Exposed so the screen can show what a token has spent of its allowance. */
export function rateLimitState(key: string): { count: number; resetAt: number } | null {
  return counters.get(key) ?? null;
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

/**
 * Applies the configured origin policy.
 *
 * Worth being clear about what this is not: CORS is enforced by browsers, so it restricts
 * a page running in somebody's browser and does nothing at all to a server-to-server
 * caller. It is not an access control, and the screen says so.
 */
export function applyCors(reply: FastifyReply, origin: string | undefined, settings: ApiSettings): void {
  if (settings.allowAllOrigins) {
    reply.header('access-control-allow-origin', '*');
  } else if (origin !== undefined && settings.allowedOrigins.includes(origin)) {
    reply.header('access-control-allow-origin', origin);
    // Required whenever the value is not `*`: without it a shared cache can serve one
    // origin's response to another.
    reply.header('vary', 'Origin');
  }

  reply.header('access-control-allow-methods', 'GET, OPTIONS');
  reply.header('access-control-allow-headers', 'authorization, x-api-key, content-type');
  reply.header('access-control-max-age', '600');
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

/**
 * Guards one public route, requiring one scope.
 *
 * Returns a Fastify preHandler. Rejections are deliberately uninformative to the caller
 * while being specific in the log: telling an unauthenticated client that its token is
 * "expired" rather than "unknown" confirms it guessed a real one.
 */
export function requireApiScope(screen: string, action: string) {
  return guardWith({ screen, action });
}

/**
 * Authenticates without demanding a scope.
 *
 * For the introspection endpoint only: it reveals nothing the token holder does not
 * already have, and it is the first thing an integrator calls to find out whether the
 * credential works at all. Requiring a scope there would mean a token with the wrong
 * scopes cannot even discover what it does hold.
 */
export function requireApiAuth() {
  return guardWith(null);
}

function guardWith(need: { screen: string; action: string } | null) {
  return async function guard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const settings = await apiSettings();
    const address = clientAddress(request);

    /**
     * A disabled API is absent, not forbidden.
     *
     * 404 rather than 403 because an endpoint that admits it exists is an endpoint worth
     * coming back to.
     */
    if (!settings.enabled) throw notFound();

    applyCors(reply, request.headers.origin, settings);

    if (!addressAllowed(address, settings.ipWhitelist)) {
      await logRejection(request, `alamat ${address} tidak dalam senarai putih`);
      throw notFound();
    }

    let identity: TokenIdentity | undefined;

    if (settings.requireToken) {
      const result = await verifyToken(readTokenFromHeaders(request.headers), address);
      if (!result.ok) {
        await logRejection(request, `token ditolak: ${result.reason}`);
        throw unauthorized('Token API tidak sah atau tiada');
      }
      identity = result.identity;

      if (need !== null && !tokenCan(identity, need.screen, need.action)) {
        await logRejection(
          request,
          `token ${identity.prefix} tiada skop ${need.screen}:${need.action}`,
        );
        // Told plainly: the caller is authenticated, so naming the missing scope helps
        // whoever owns the token rather than helping an attacker.
        throw forbidden(`Token ini tiada skop "${need.screen}:${need.action}"`);
      }

      request.apiToken = identity;
    }

    if (settings.rateLimitEnabled) {
      // Keyed by token where there is one, so one noisy integration cannot exhaust the
      // allowance of everything sharing its address.
      const key = identity === undefined ? `ip:${address}` : `token:${String(identity.id)}`;
      const verdict = rateLimit(key, settings.maxPerMinute);
      reply.header('x-ratelimit-limit', String(settings.maxPerMinute));

      if (!verdict.allowed) {
        reply.header('retry-after', String(verdict.retryAfter));
        await logRejection(request, `had kadar dicapai (${key})`);
        throw new HttpError(
          429,
          `Had kadar API dicapai. Cuba lagi dalam ${String(verdict.retryAfter)}s.`,
          'rate_limited',
        );
      }
    }

    if (settings.logRequests) {
      await recordActivity({
        request,
        action: 'api.request',
        category: 'integration',
        source: 'api',
        detail:
          `${request.method} ${request.url}` +
          (identity === undefined ? ' · tanpa token' : ` · ${identity.prefix} (${identity.name})`) +
          (identity?.superseded === true ? ' · token diputar, dalam tempoh rahmat' : ''),
      });
    }
  };
}

/** Honours a proxy header, the same way the session layer does. */
function clientAddress(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return (forwarded.split(',')[0] ?? request.ip).trim();
  }
  return request.ip;
}

/**
 * Rejections are always recorded, even when request logging is off.
 *
 * The setting controls whether successful traffic is logged. A refused call is the one
 * that matters, and losing it because somebody turned down the noise would remove the
 * only trace of an attempt.
 */
async function logRejection(request: FastifyRequest, detail: string): Promise<void> {
  await recordActivity({
    request,
    action: 'api.rejected',
    category: 'integration',
    source: 'api',
    level: 'warn',
    detail: `${request.method} ${request.url} · ${detail}`,
  });
}
