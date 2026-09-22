import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { addressMatches } from '../api/guard.js';
import { db } from '../db.js';
import { ICLOCK_PATH } from '../ingest/iclock.js';
import { INGEST_PATH } from '../ingest/routes.js';

/**
 * Maintenance mode.
 *
 * Refuses operator traffic while somebody works on the system, so a half-finished
 * migration or a restore in progress is not being read and written against at the same
 * time.
 *
 * The one thing it must never refuse is the terminal. A scan that is rejected is not
 * retried by the device in any form this application can rely on — the event leaves the
 * terminal's small ring buffer and is gone. Blocking the ingest path would turn an
 * hour of maintenance into an hour of attendance that never existed, and the whole
 * system is built on the raw log being complete.
 */

export interface MaintenanceState {
  enabled: boolean;
  message: string;
  /** Comma-separated addresses, CIDR ranges, or trailing wildcards. */
  allowIps: string;
}

const DEFAULT_MESSAGE =
  'Sistem sedang diselenggara. Perekodan kehadiran di terminal tidak terjejas.';

const DEFAULTS: MaintenanceState = { enabled: false, message: DEFAULT_MESSAGE, allowIps: '' };

/**
 * Cached for fifteen seconds.
 *
 * This is checked on every request, so reading two rows each time would make the
 * maintenance check the most expensive thing about a request that is not in maintenance.
 * Fifteen seconds is the cost of switching it on: long enough to be cheap, short enough
 * that the operator sees it take effect while still looking at the screen. Stated on the
 * screen, because a toggle that appears not to work gets clicked again.
 */
const CACHE_MS = 15_000;

let cache: { at: number; value: MaintenanceState } | null = null;

export function invalidateMaintenance(): void {
  cache = null;
}

export async function maintenanceState(): Promise<MaintenanceState> {
  if (cache !== null && Date.now() - cache.at < CACHE_MS) return cache.value;

  const rows = await db().setting.findMany({
    where: { key: { in: ['maintenance.enabled', 'maintenance.message', 'maintenance.allowIps'] } },
  });
  const values = new Map(rows.map((row) => [row.key, row.value]));

  const value: MaintenanceState = {
    enabled: values.get('maintenance.enabled') === true,
    message: asText(values.get('maintenance.message')) || DEFAULT_MESSAGE,
    allowIps: asText(values.get('maintenance.allowIps')),
  };

  cache = { at: Date.now(), value };
  return value;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Whether an address is on an allow list.
 *
 * Three forms, because an operator writing this list is not going to reach for CIDR:
 * an exact address, a CIDR range, and a trailing wildcard (`192.168.1.*`) which is the
 * form people actually type. An empty list allows nothing — unlike the API whitelist,
 * where empty means unrestricted, because here the list exists specifically to name the
 * exceptions to a closed door.
 */
export function addressAllowedByList(address: string, list: string): boolean {
  const candidate = normalise(address);
  if (candidate.length === 0) return false;

  for (const raw of list.split(',')) {
    const entry = raw.trim();
    if (entry.length === 0) continue;

    // Loopback in either form. A browser on the server itself may arrive as `::1`
    // while the operator typed `127.0.0.1`, and refusing that is a lockout for the
    // one address most likely to be doing the maintenance.
    if (isLoopback(entry) && isLoopback(candidate)) return true;

    if (entry.endsWith('*')) {
      if (candidate.startsWith(entry.slice(0, -1))) return true;
      continue;
    }

    if (entry.includes('/')) {
      if (addressMatches(candidate, entry)) return true;
      continue;
    }

    if (normalise(entry) === candidate) return true;
  }

  return false;
}

function normalise(address: string): string {
  const trimmed = address.trim().replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(trimmed);
  return mapped?.[1] ?? trimmed;
}

function isLoopback(address: string): boolean {
  const value = normalise(address);
  return value === '127.0.0.1' || value === '::1' || value === 'localhost';
}

/**
 * The request hook.
 *
 * Registered after the auth hooks so `request.user` is already resolved, which is what
 * lets the exemptions below be meaningful.
 */
export function registerMaintenanceHook(app: FastifyInstance): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    /**
     * Exempt before anything else is considered.
     *
     * `INGEST_PATH` carries scans and heartbeats — see the file header. `/api/health` is
     * how a monitor or a load balancer decides whether this process is alive, and a
     * process in maintenance is alive. The settings endpoints are how maintenance mode
     * gets switched back off, so refusing them would make the mode one-way.
     */
    if (
      request.url.startsWith(INGEST_PATH) ||
      /**
       * A callback terminal is exempt for a sharper reason than the Hikvision path.
       *
       * It keeps its records until acknowledged, so a 503 during maintenance would have it
       * retry indefinitely — and it also polls for queued work, which would mean a face
       * enrolment stays uncollected for the whole window with nothing to show it was blocked.
       */
      request.url.startsWith(ICLOCK_PATH) ||
      request.url.startsWith('/api/health') ||
      request.url.startsWith('/api/settings') ||
      request.url.startsWith('/api/auth/')
    ) {
      return;
    }

    const state = await maintenanceState();
    if (!state.enabled) return;

    if (addressAllowedByList(clientAddress(request), state.allowIps)) return;

    reply.header('retry-after', '900');
    return reply.status(503).send({
      error: state.message,
      code: 'maintenance',
      maintenance: true,
    });
  });
}

/** Honours a proxy header, the same way the session and API layers do. */
function clientAddress(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return (forwarded.split(',')[0] ?? request.ip).trim();
  }
  return request.ip;
}
