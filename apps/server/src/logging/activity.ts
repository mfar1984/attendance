import type { FastifyRequest } from 'fastify';

import { db } from '../db.js';
import { logger } from '../logger.js';

/**
 * Activity log vocabulary and the one way to write to it.
 *
 * Severity and category are stored on the row rather than inferred when it is
 * read, so the counters above the log table can be answered from an index. That
 * only holds if every writer sets them, which is why this module exists instead of
 * call sites reaching for `prisma.activityLog.create` directly.
 */

export type ActivityLevel = 'info' | 'warn' | 'error' | 'debug';

export const ACTIVITY_LEVELS: ActivityLevel[] = ['info', 'warn', 'error', 'debug'];

/**
 * Functional areas, mirroring the sections of the permission registry.
 *
 * Deliberately the same vocabulary: an operator filtering the log by "Tetapan"
 * should be looking at the same boundary the system enforces permissions on. A
 * second, parallel taxonomy would drift within a release.
 */
export const ACTIVITY_CATEGORIES = [
  'auth',
  'attendance',
  'staff',
  'schedule',
  'reports',
  'devices',
  'users',
  'roles',
  'settings',
  // Outbound channels and the public API. Separate from `settings` because the question
  // "who called the API" is asked on its own, and mixing it into settings changes buries
  // it under every toggle somebody flipped.
  'integration',
  'backup',
  'retention',
  'system',
] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

/** `api` is a caller holding a token rather than a person holding a session. */
export type ActivitySource = 'web' | 'terminal' | 'app' | 'api' | 'system';

export interface ActivityInput {
  action: string;
  category: ActivityCategory;
  /** Defaults to `info`. */
  level?: ActivityLevel;
  /** Defaults to `web`, or `system` when there is no request. */
  source?: ActivitySource;
  detail?: string | null;
  /** Present for a request-driven entry; absent for scheduled work. */
  request?: FastifyRequest;
  /** Overrides the actor when the entry is not attributable to the session. */
  actorLabel?: string;
  accountId?: number | null;
}

/**
 * Appends one entry.
 *
 * Never throws. A failure to record an action must not fail the action itself: an
 * operator who cannot deactivate a departed employee because the audit table is
 * full has a worse problem than a missing log line. The failure is logged instead.
 */
/**
 * Minimum severity, from `logging.level`.
 *
 * Cached for thirty seconds because this is consulted on every logged action, and the
 * setting is not something that changes between two requests.
 *
 * Only `debug` and `info` can be suppressed. The options offered on the screen stop at
 * `warn`, so there is no setting that discards a warning or an error — those are the
 * entries that answer "who deleted a month of scans", and a verbosity control that can
 * throw them away is not a verbosity control, it is a way to work unobserved.
 */
const LEVEL_ORDER: Record<ActivityLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let levelCache: { at: number; value: number } | null = null;

export function invalidateLogPolicy(): void {
  levelCache = null;
}

async function minimumLevel(): Promise<number> {
  if (levelCache !== null && Date.now() - levelCache.at < 30_000) return levelCache.value;

  let value = LEVEL_ORDER.info;
  try {
    const row = await db().setting.findUnique({ where: { key: 'logging.level' } });
    const stored = typeof row?.value === 'string' ? row.value : 'info';
    value = LEVEL_ORDER[stored as ActivityLevel] ?? LEVEL_ORDER.info;
  } catch {
    // A settings table that cannot be read must not stop the log from being written.
    value = LEVEL_ORDER.info;
  }

  levelCache = { at: Date.now(), value };
  return value;
}

export async function recordActivity(input: ActivityInput): Promise<void> {
  const user = input.request?.user;
  const level = input.level ?? 'info';

  // Checked before the insert, so a quiet log level is actually cheaper rather than
  // writing the row and hiding it at read time.
  if (LEVEL_ORDER[level] < (await minimumLevel())) return;

  try {
    await db().activityLog.create({
      data: {
        accountId: input.accountId ?? user?.accountId ?? null,
        actorLabel: input.actorLabel ?? user?.fullName ?? 'Sistem',
        level,
        category: input.category,
        source: input.source ?? (input.request ? 'web' : 'system'),
        action: input.action,
        detail: input.detail?.slice(0, 500) ?? null,
        path: input.request?.url.slice(0, 190) ?? null,
        ipAddress: input.request?.ip ?? null,
      },
    });
  } catch (error) {
    logger().error({ err: error, action: input.action }, 'Failed to append activity log');
  }
}

/**
 * Severity for an action name, used to backfill rows written before the column
 * existed and as a fallback for any writer that omits it.
 *
 * Anything that destroys data is `warn` even on success, because the entry that
 * matters when someone asks why a month of scans is missing is the one recording
 * that it was removed on purpose.
 */
export function levelForAction(action: string): ActivityLevel {
  if (action.endsWith('_failed') || action.includes('error')) return 'error';
  if (action.startsWith('retention') || action.includes('purge') || action.includes('delete')) {
    return 'warn';
  }
  return 'info';
}

export function categoryForAction(action: string): ActivityCategory {
  if (action.startsWith('auth')) return 'auth';
  // Ahead of the `export` test below, which would otherwise claim `api.export` for
  // reports.
  if (
    action.startsWith('api') ||
    action.startsWith('webhook') ||
    action.startsWith('sms') ||
    action.startsWith('telegram') ||
    action.startsWith('email')
  ) {
    return 'integration';
  }
  if (action.startsWith('backup')) return 'backup';
  if (action.startsWith('retention')) return 'retention';
  if (action.startsWith('staff')) return 'staff';
  if (action.startsWith('device')) return 'devices';
  if (action.startsWith('report') || action.includes('export')) return 'reports';
  if (action.startsWith('user')) return 'users';
  if (action.startsWith('role')) return 'roles';
  if (action.startsWith('setting')) return 'settings';
  if (action.startsWith('attendance') || action.includes('recompute')) return 'attendance';
  return 'system';
}
