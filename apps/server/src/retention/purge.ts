import { unlink } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { db } from '../db.js';
import { loadEnv } from '../env.js';
import { logger } from '../logger.js';
import { recordActivity } from '../logging/activity.js';

/**
 * Retention purge.
 *
 * This is the one process in the system that destroys evidence, so it is built to
 * be reluctant. `raw_events` is the verbatim terminal log and the only thing that
 * settles a challenge to a pay figure; once a month of it is gone, that month can
 * never be recomputed and no dispute about it can be answered.
 *
 * Three properties follow from that:
 *
 *  - Opt-in. It never runs on a default. An installation that has not made a
 *    retention decision keeps everything.
 *  - Floored. A window shorter than `MINIMUM_RAW_EVENT_MONTHS` is refused, because
 *    the realistic reason for setting one is disk pressure, and the realistic cost
 *    is being unable to answer a payslip query from last quarter.
 *  - Recorded. Every pass writes what it removed and from which cut-off, so the
 *    absence of old records is itself explainable.
 */

/**
 * Shortest raw-log window the system will accept.
 *
 * Chosen so a full annual pay cycle, including a year-end correction run, is always
 * still reconstructible.
 */
export const MINIMUM_RAW_EVENT_MONTHS = 12;

/** Rows removed per statement, so a first run over years of data does not hold the table. */
const BATCH_SIZE = 1_000;

/** Ceiling on one pass. Work left over is picked up by the next one. */
const MAX_PASS_MS = 60_000;

export interface RetentionPolicy {
  enabled: boolean;
  rawEventMonths: number;
  pictureMonths: number;
  /** Local hour the daily pass runs at. */
  purgeHour: number;
  lastPurgeAt: string | null;
}

export interface RetentionPreview {
  policy: RetentionPolicy;
  minimumRawEventMonths: number;
  rawCutoff: string;
  pictureCutoff: string;
  /** Rows that would go on the next pass. */
  rawEventsDue: number;
  picturesDue: number;
  /** Oldest and newest stored event, so the window can be judged against real data. */
  oldestEventAt: string | null;
  newestEventAt: string | null;
  totalRawEvents: number;
  /** Punches whose evidence link would be cleared. The punches themselves survive. */
  punchesAffected: number;
}

export interface PurgeOutcome {
  rawEventsDeleted: number;
  picturesCleared: number;
  pictureFilesDeleted: number;
  exceptionLinksCleared: number;
  rawCutoff: string;
  pictureCutoff: string;
  batches: number;
  durationMs: number;
  /** Set when more remained than one pass could take. */
  incomplete: boolean;
}

const DEFAULTS = { rawEventMonths: 24, pictureMonths: 6, purgeHour: 3 };

export async function loadRetentionPolicy(): Promise<RetentionPolicy> {
  const rows = await db().setting.findMany({
    where: {
      key: {
        in: [
          'retention.autoPurgeEnabled',
          'retention.rawEventMonths',
          'retention.pictureMonths',
          'retention.purgeHour',
          'retention.lastPurgeAt',
        ],
      },
    },
  });

  const values = new Map(rows.map((row) => [row.key, row.value]));

  return {
    enabled: values.get('retention.autoPurgeEnabled') === true,
    // Clamped upward as a second line of defence. The settings route refuses a
    // shorter window, but a value written before that guard existed, or straight
    // into the database, must not be honoured either.
    rawEventMonths: Math.max(
      MINIMUM_RAW_EVENT_MONTHS,
      toNumber(values.get('retention.rawEventMonths'), DEFAULTS.rawEventMonths),
    ),
    pictureMonths: Math.max(1, toNumber(values.get('retention.pictureMonths'), DEFAULTS.pictureMonths)),
    purgeHour: clampHour(toNumber(values.get('retention.purgeHour'), DEFAULTS.purgeHour)),
    lastPurgeAt: typeof values.get('retention.lastPurgeAt') === 'string'
      ? String(values.get('retention.lastPurgeAt'))
      : null,
  };
}

/** What a pass would remove, without removing it. */
export async function previewPurge(): Promise<RetentionPreview> {
  const policy = await loadRetentionPolicy();
  const rawCutoff = monthsAgo(policy.rawEventMonths);
  const pictureCutoff = monthsAgo(policy.pictureMonths);
  const prisma = db();

  const [rawEventsDue, picturesDue, bounds, totalRawEvents, punchesAffected] = await Promise.all([
    prisma.rawEvent.count({ where: { eventTime: { lt: rawCutoff } } }),
    prisma.rawEvent.count({
      where: { eventTime: { lt: pictureCutoff }, pictureUrl: { not: null } },
    }),
    prisma.rawEvent.aggregate({ _min: { eventTime: true }, _max: { eventTime: true } }),
    prisma.rawEvent.count(),
    prisma.punch.count({ where: { rawEvent: { eventTime: { lt: rawCutoff } } } }),
  ]);

  return {
    policy,
    minimumRawEventMonths: MINIMUM_RAW_EVENT_MONTHS,
    rawCutoff: rawCutoff.toISOString(),
    pictureCutoff: pictureCutoff.toISOString(),
    rawEventsDue,
    picturesDue,
    oldestEventAt: bounds._min.eventTime?.toISOString() ?? null,
    newestEventAt: bounds._max.eventTime?.toISOString() ?? null,
    totalRawEvents,
    punchesAffected,
  };
}

/**
 * Removes data that has aged past the policy.
 *
 * Deletes in batches so people clocking in are not blocked by a long-running
 * statement, and stops at `MAX_PASS_MS` rather than running unbounded. Stopping
 * early is safe: the next pass resumes from the same cut-off.
 */
export async function runPurge(actor: { accountId: number | null; label: string }): Promise<PurgeOutcome> {
  const policy = await loadRetentionPolicy();
  const rawCutoff = monthsAgo(policy.rawEventMonths);
  const pictureCutoff = monthsAgo(policy.pictureMonths);
  const prisma = db();
  const startedAt = Date.now();

  let rawEventsDeleted = 0;
  let batches = 0;
  let incomplete = false;

  /**
   * Picture references are cleared before rows are deleted.
   *
   * These point at the terminal's own storage, which is a small ring buffer that
   * has long since overwritten anything this old. Clearing the reference stops the
   * UI offering a snapshot link that can only fail. `picturePath` is unlinked when
   * present, for installations that mirror snapshots locally.
   */
  const withFiles = await prisma.rawEvent.findMany({
    where: { eventTime: { lt: pictureCutoff }, picturePath: { not: null } },
    select: { id: true, picturePath: true },
    take: 5_000,
  });

  let pictureFilesDeleted = 0;
  const storageRoot = resolve(process.cwd(), loadEnv().STORAGE_DIR);

  for (const row of withFiles) {
    const target = safeStoragePath(storageRoot, row.picturePath);
    if (target === null) continue;
    try {
      await unlink(target);
      pictureFilesDeleted += 1;
    } catch {
      // A snapshot already gone is the desired end state, so a missing file is not
      // an error worth failing the pass over.
    }
  }

  const cleared = await prisma.rawEvent.updateMany({
    where: {
      eventTime: { lt: pictureCutoff },
      OR: [{ pictureUrl: { not: null } }, { picturePath: { not: null } }],
    },
    data: { pictureUrl: null, picturePath: null },
  });

  let exceptionLinksCleared = 0;

  for (;;) {
    if (Date.now() - startedAt > MAX_PASS_MS) {
      incomplete = true;
      break;
    }

    // Selected by id then deleted by id: a bare `deleteMany` with a date predicate
    // rescans the same range on every iteration.
    const doomed = await prisma.rawEvent.findMany({
      where: { eventTime: { lt: rawCutoff } },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    });
    if (doomed.length === 0) break;

    const ids = doomed.map((row) => row.id);

    /**
     * Exception links are cleared before the rows go.
     *
     * `AttendanceException.rawEventId` carries no foreign key, because an exception
     * has to be recordable for an event that was never stored. That also means
     * nothing would stop it pointing at a deleted row, so it is nulled deliberately
     * rather than left dangling. Done per batch, against the exact ids about to be
     * removed.
     *
     * `Punch.rawEventId` needs no equivalent: its relation is `onDelete: SetNull`,
     * so the punch survives with its evidence link cleared by the database.
     */
    const unlinked = await prisma.attendanceException.updateMany({
      where: { rawEventId: { in: ids } },
      data: { rawEventId: null },
    });
    exceptionLinksCleared += unlinked.count;

    const result = await prisma.rawEvent.deleteMany({ where: { id: { in: ids } } });

    rawEventsDeleted += result.count;
    batches += 1;
  }

  const outcome: PurgeOutcome = {
    rawEventsDeleted,
    picturesCleared: cleared.count,
    pictureFilesDeleted,
    exceptionLinksCleared,
    rawCutoff: rawCutoff.toISOString(),
    pictureCutoff: pictureCutoff.toISOString(),
    batches,
    durationMs: Date.now() - startedAt,
    incomplete,
  };

  await recordPurge(actor, outcome);
  return outcome;
}

/**
 * Writes the pass to both logs.
 *
 * The audit entry is what makes a gap in the raw log explainable a year later. A
 * purge that leaves no trace is indistinguishable from data loss.
 */
async function recordPurge(
  actor: { accountId: number | null; label: string },
  outcome: PurgeOutcome,
): Promise<void> {
  const summary =
    `${String(outcome.rawEventsDeleted)} log scan dibuang sebelum ${outcome.rawCutoff.slice(0, 10)}, ` +
    `${String(outcome.picturesCleared)} rujukan gambar dikosongkan` +
    (outcome.incomplete ? ' (belum selesai, disambung pas berikutnya)' : '');

  await recordActivity({
    action: 'retention.purge',
    category: 'retention',
    // A warning even when it succeeds: this is the entry that explains a gap in the
    // raw log a year from now.
    level: 'warn',
    source: actor.accountId === null ? 'system' : 'web',
    accountId: actor.accountId,
    actorLabel: actor.label,
    detail: summary,
  });

  if (outcome.rawEventsDeleted > 0 || outcome.picturesCleared > 0) {
    await db().auditLog.create({
      data: {
        accountId: actor.accountId,
        actorLabel: actor.label,
        action: 'delete',
        entityType: 'RawEvent',
        entityId: `<${outcome.rawCutoff.slice(0, 10)}`,
        changes: JSON.parse(
          JSON.stringify({
            rawEvents: { before: outcome.rawEventsDeleted, after: 0 },
            pictureRefs: { before: outcome.picturesCleared, after: 0 },
          }),
        ) as object,
        reason: `Polisi simpanan data. Batch: ${String(outcome.batches)}.`,
      },
    });
  }

  logger().info({ ...outcome }, 'Retention purge finished');
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

let timer: NodeJS.Timeout | null = null;

/**
 * Daily pass, checked hourly.
 *
 * An hourly tick that compares the local date against the last recorded run is
 * enough here and survives restarts, which a `setTimeout` to the next 03:00 does
 * not. Cron would be a dependency for one job.
 */
export function startRetentionWorker(): void {
  const tick = async (): Promise<void> => {
    try {
      const policy = await loadRetentionPolicy();
      if (!policy.enabled) return;

      const now = new Date();
      if (now.getHours() !== policy.purgeHour) return;
      if (policy.lastPurgeAt !== null && sameLocalDay(new Date(policy.lastPurgeAt), now)) return;

      logger().info({ rawEventMonths: policy.rawEventMonths }, 'Retention purge starting');
      await runPurge({ accountId: null, label: 'Sistem (berjadual)' });

      /**
       * The activity log is trimmed in the same pass.
       *
       * Same daily rhythm, and one timer is easier to reason about than two that can drift
       * apart. The audit log is deliberately not included: the activity log is a running
       * commentary that grows without bound, while the audit log is the record of what
       * changed and is kept.
       */
      const { trimActivityLogIfDue } = await import('../routes/maintenance.js');
      const trimmed = await trimActivityLogIfDue();
      if (trimmed > 0) logger().info({ trimmed }, 'Activity log trimmed');

      await db().setting.upsert({
        where: { key: 'retention.lastPurgeAt' },
        create: { key: 'retention.lastPurgeAt', value: now.toISOString(), secret: false },
        update: { value: now.toISOString() },
      });
    } catch (error) {
      logger().error({ err: error }, 'Retention purge pass failed');
    }
  };

  timer = setInterval(() => void tick(), 3_600_000);
  logger().info('Retention worker started (hourly check, runs when enabled)');
}

export function stopRetentionWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// ---------------------------------------------------------------------------

/**
 * Calendar-month subtraction, not a fixed number of days.
 *
 * "24 months" has to mean the same date two years back, otherwise the cut-off
 * drifts against the pay periods people are actually reasoning about.
 */
function monthsAgo(months: number): Date {
  const when = new Date();
  when.setMonth(when.getMonth() - months);
  return when;
}

function sameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/**
 * Resolves a stored path, refusing anything that escapes the storage directory.
 *
 * The value comes from a database column rather than a request, but this process
 * runs unattended and calls `unlink`, so a corrupted or crafted row must not be
 * able to reach outside the snapshot folder.
 */
function safeStoragePath(root: string, stored: string | null): string | null {
  if (stored === null || stored.length === 0) return null;
  if (isAbsolute(stored)) return null;

  const target = resolve(root, stored);
  return target.startsWith(root) ? target : null;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function clampHour(value: number): number {
  return value >= 0 && value <= 23 ? value : DEFAULTS.purgeHour;
}
