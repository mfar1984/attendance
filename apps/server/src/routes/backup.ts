import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { LabelKey } from '@attendance/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requirePermission } from '../auth/plugin.js';
import { db } from '../db.js';
import { loadEnv, parseDatabaseUrl } from '../env.js';
import { conflict, notFound, unauthorized } from '../http.js';
import { logger } from '../logger.js';
import { recordActivity } from '../logging/activity.js';

/**
 * Database backup.
 *
 * The terminal is not a fallback copy of anything. Its internal log is capped and
 * overwrites the oldest records once full, so this database is the only place the
 * attendance history exists, and it is what payroll is computed from. Losing it
 * means losing the evidence for wages already paid.
 *
 * Restore is deliberately absent. It is a destructive, one-way operation that
 * replaces live data, and the correct moment to run it is when the application is
 * stopped. The command to run is printed instead, so the person doing it knows
 * exactly what they are executing.
 */

/**
 * Filename shape this module produces and the only shape it will accept back.
 *
 * Validated on every read and delete: the name arrives from the client, and
 * joining an unchecked string onto a directory path is how a download endpoint
 * turns into arbitrary file access.
 */
const FILE_PATTERN = /^[a-z0-9_-]+-\d{8}-\d{6}\.sql$/;

/**
 * Where dumps live and what they are dumps of.
 *
 * Resolved on call rather than at import: `loadEnv()` throws on a bad environment, and a
 * module that throws while being imported takes the whole process down before the logger
 * exists to say why.
 */
function target(): { directory: string; connection: ReturnType<typeof parseDatabaseUrl> } {
  const env = loadEnv();
  return {
    directory: resolve(process.cwd(), env.BACKUP_DIR),
    connection: parseDatabaseUrl(env.DATABASE_URL),
  };
}

export interface BackupPolicy {
  enabled: boolean;
  /** Local hour the daily dump runs at. */
  hour: number;
  /** Dumps kept before the oldest are pruned. */
  keepCount: number;
  lastRunAt: string | null;
}

const POLICY_DEFAULTS = { hour: 2, keepCount: 14 };

export async function loadBackupPolicy(): Promise<BackupPolicy> {
  const rows = await db().setting.findMany({
    where: {
      key: { in: ['backup.autoEnabled', 'backup.hour', 'backup.keepCount', 'backup.lastRunAt'] },
    },
  });
  const values = new Map(rows.map((row) => [row.key, row.value]));

  const hour = Number(values.get('backup.hour') ?? POLICY_DEFAULTS.hour);
  const keep = Number(values.get('backup.keepCount') ?? POLICY_DEFAULTS.keepCount);

  return {
    enabled: values.get('backup.autoEnabled') === true,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : POLICY_DEFAULTS.hour,
    // Clamped upward as a second line of defence, the same way the retention floor is.
    // A `keepCount` of zero or one written straight into the database would make the
    // pruner delete the dump it had just taken.
    keepCount: Number.isFinite(keep) && keep >= 2 ? Math.floor(keep) : POLICY_DEFAULTS.keepCount,
    lastRunAt: typeof values.get('backup.lastRunAt') === 'string'
      ? String(values.get('backup.lastRunAt'))
      : null,
  };
}

export interface BackupFile {
  name: string;
  bytes: number;
  createdAt: string;
}

export async function listBackups(): Promise<BackupFile[]> {
  const { directory } = target();
  await mkdir(directory, { recursive: true });

  const names = (await readdir(directory)).filter((name) => FILE_PATTERN.test(name));
  const files = await Promise.all(
    names.map(async (name) => {
      const info = await stat(join(directory, name));
      return { name, bytes: info.size, createdAt: info.mtime.toISOString() };
    }),
  );

  files.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return files;
}

export interface BackupOutcome {
  name: string;
  bytes: number;
  durationMs: number;
  pruned: string[];
}

/**
 * Takes one dump and prunes what falls out of the retention count.
 *
 * Extracted from the route so the scheduler runs exactly the same path an operator does.
 * A scheduled job that takes a different code path is a job whose failure mode nobody has
 * seen, and this one runs at two in the morning with nobody watching.
 */
export async function runBackup(): Promise<BackupOutcome> {
  if (!(await hasMysqldump())) {
    throw conflict(
      'mysqldump tidak dijumpai pada pelayan ini. Pasang MySQL client tools, atau ' +
        'jadualkan backup di luar aplikasi.',
    );
  }

  const { directory, connection } = target();
  await mkdir(directory, { recursive: true });

  const name = `${connection.database}-${timestamp(new Date())}.sql`;
  const startedAt = Date.now();

  await runMysqldump(connection, join(directory, name));
  const info = await stat(join(directory, name));

  const policy = await loadBackupPolicy();
  const pruned = await pruneBackups(policy.keepCount);

  return { name, bytes: info.size, durationMs: Date.now() - startedAt, pruned };
}

/**
 * Removes the oldest dumps beyond `keepCount`.
 *
 * Runs after a successful dump rather than before, so a failed dump never reduces the
 * number of copies that exist. Unbounded dumps fill the disk that the database is also
 * on, which turns a backup policy into an outage.
 */
export async function pruneBackups(keepCount: number): Promise<string[]> {
  const files = await listBackups();
  if (files.length <= keepCount) return [];

  const { directory } = target();
  const doomed = files.slice(keepCount);

  for (const file of doomed) {
    await unlink(join(directory, file.name)).catch(() => undefined);
  }
  return doomed.map((file) => file.name);
}

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  const { directory, connection } = target();

  app.get('/api/backup', { preHandler: requirePermission('settings.backup', 'view') }, async () => {
    const files = await listBackups();
    const policy = await loadBackupPolicy();
    const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);

    return {
      directory,
      files,
      policy,
      totalBytes,
      toolAvailable: await hasMysqldump(),
      /**
       * Shown rather than executed.
       *
       * A restore button in a web UI is a single click that overwrites every
       * attendance record in the system, reachable by anyone who reaches this
       * screen. Printing the command keeps the decision with the person running it.
       */
      restoreHint:
        `mysql -h ${connection.host} -P ${connection.port} -u ${connection.user} ` +
        `${connection.database} < <fail-backup.sql>`,
      /**
       * A key, not the words.
       *
       * The warning belongs beside the command the route builds, but resolving it to Malay
       * here would fix the language for every reader of the response.
       */
      restoreWarningKey: 'backup.restore.warning' satisfies LabelKey,
    };
  });

  app.post('/api/backup/run', { preHandler: requirePermission('settings.backup', 'create') }, async (request) => {
    if (!request.user) throw unauthorized();

    const outcome = await runBackup();

    await recordActivity({
      request,
      action: 'backup.create',
      category: 'backup',
      detail:
        `${outcome.name} (${formatBytes(outcome.bytes)}) dalam ${String(outcome.durationMs)}ms` +
        (outcome.pruned.length > 0
          ? ` · ${String(outcome.pruned.length)} fail lama dibuang`
          : ''),
    });

    return {
      ...outcome,
      noteKey: 'backup.run.note' satisfies LabelKey,
    };
  });

  app.get(
    '/api/backup/:name',
    { preHandler: requirePermission('settings.backup', 'download') },
    async (request, reply) => {
      if (!request.user) throw unauthorized();

      const params = z.object({ name: z.string() }).parse(request.params);
      if (!FILE_PATTERN.test(params.name)) throw notFound('Fail backup tidak dijumpai');

      const target = join(directory, params.name);
      const info = await stat(target).catch(() => null);
      if (!info) throw notFound('Fail backup tidak dijumpai');

      /**
       * A download is logged as a warning, not as routine information.
       *
       * The file holds every attendance record and every hashed credential in the
       * system. Somebody taking a copy off the server is the single most sensitive
       * read available here, and it should stand out in the log rather than sit
       * among the logins.
       */
      await recordActivity({
        request,
        action: 'backup.download',
        category: 'backup',
        level: 'warn',
        detail: `${params.name} (${formatBytes(info.size)})`,
      });

      reply.header('content-type', 'application/sql');
      reply.header('content-length', String(info.size));
      reply.header('content-disposition', `attachment; filename="${params.name}"`);
      return reply.send(createReadStream(target));
    },
  );

  app.delete(
    '/api/backup/:name',
    { preHandler: requirePermission('settings.backup', 'delete') },
    async (request) => {
      const params = z.object({ name: z.string() }).parse(request.params);
      if (!FILE_PATTERN.test(params.name)) throw notFound('Fail backup tidak dijumpai');

      const files = (await readdir(directory).catch(() => [])).filter((entry) =>
        FILE_PATTERN.test(entry),
      );
      // Refuses to leave the system with nothing. Deleting the only backup is
      // almost always a mistake, and it is silent until it matters.
      if (files.length <= 1 && files.includes(params.name)) {
        throw conflict('Ini satu-satunya backup yang ada. Jalankan backup baharu dahulu.');
      }

      await unlink(join(directory, params.name));
      return { ok: true };
    },
  );
}

/**
 * `YYYYMMDD-HHMMSS` in local time, matching `FILE_PATTERN`.
 *
 * Local rather than UTC so the filename reads as the moment the operator ran it.
 * Built field by field: slicing an ISO string leaves a fractional-seconds dot in
 * the name, which then fails the very pattern that guards reads of it.
 */
function timestamp(when: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${String(when.getFullYear())}${pad(when.getMonth() + 1)}${pad(when.getDate())}` +
    `-${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`
  );
}

/** Resolves true when `mysqldump` can be executed. */
async function hasMysqldump(): Promise<boolean> {
  return new Promise((resolveResult) => {
    const probe = spawn('mysqldump', ['--version'], { shell: false });
    probe.on('error', () => resolveResult(false));
    probe.on('close', (code) => resolveResult(code === 0));
  });
}

function runMysqldump(
  connection: ReturnType<typeof parseDatabaseUrl>,
  target: string,
): Promise<void> {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(
      'mysqldump',
      [
        `--host=${connection.host}`,
        `--port=${String(connection.port)}`,
        `--user=${connection.user}`,
        // Consistent snapshot without locking writes out, so a backup taken
        // during a shift change does not block anyone clocking in.
        '--single-transaction',
        '--quick',
        '--routines',
        '--events',
        '--default-character-set=utf8mb4',
        `--result-file=${target}`,
        connection.database,
      ],
      {
        // The password goes through the environment rather than argv: arguments are
        // visible to any process listing on the machine.
        env: { ...process.env, MYSQL_PWD: connection.password },
        shell: false,
      },
    );

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (cause) => rejectResult(cause));
    child.on('close', (code) => {
      if (code === 0) {
        resolveResult();
        return;
      }
      rejectResult(new Error(`mysqldump keluar dengan kod ${String(code)}: ${stderr.slice(0, 400)}`));
    });
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

let timer: NodeJS.Timeout | null = null;

/**
 * Daily dump, checked hourly.
 *
 * Same shape as the retention worker, and for the same reasons: an hourly tick compared
 * against the last recorded run survives a restart, which a `setTimeout` to the next
 * 02:00 does not, and cron would be a dependency for two jobs.
 *
 * Opt-in. An installation that has made no backup decision is not quietly filled with
 * dumps of its own database.
 */
export function startBackupWorker(): void {
  const tick = async (): Promise<void> => {
    try {
      const policy = await loadBackupPolicy();
      if (!policy.enabled) return;

      const now = new Date();
      if (now.getHours() !== policy.hour) return;
      if (policy.lastRunAt !== null && sameLocalDay(new Date(policy.lastRunAt), now)) return;

      /**
       * The marker is written before the dump, not after.
       *
       * A dump of a large database can outlast the hour it started in, and on failure the
       * tick would otherwise retry it on the next pass — repeatedly, for the rest of that
       * hour, each attempt loading the whole database again. One attempt per day is the
       * correct behaviour even when that attempt fails; the failure is in the log.
       */
      await db().setting.upsert({
        where: { key: 'backup.lastRunAt' },
        create: { key: 'backup.lastRunAt', value: now.toISOString(), secret: false },
        update: { value: now.toISOString() },
      });

      logger().info({ hour: policy.hour }, 'Scheduled backup starting');
      const outcome = await runBackup();

      await recordActivity({
        action: 'backup.create',
        category: 'backup',
        source: 'system',
        actorLabel: 'Sistem (berjadual)',
        detail:
          `${outcome.name} (${formatBytes(outcome.bytes)}) dalam ${String(outcome.durationMs)}ms` +
          (outcome.pruned.length > 0
            ? ` · ${String(outcome.pruned.length)} fail lama dibuang`
            : ''),
      });

      logger().info({ name: outcome.name, bytes: outcome.bytes }, 'Scheduled backup complete');
    } catch (error) {
      logger().error({ err: error }, 'Scheduled backup failed');

      // Recorded where the operator looks, not only in the process log. A backup that
      // silently stopped running a month ago is indistinguishable from one that works.
      await recordActivity({
        action: 'backup.failed',
        category: 'backup',
        source: 'system',
        level: 'error',
        actorLabel: 'Sistem (berjadual)',
        detail: error instanceof Error ? error.message.slice(0, 400) : 'Sebab tidak diketahui',
      }).catch(() => undefined);
    }
  };

  timer = setInterval(() => void tick(), 3_600_000);
  logger().info('Backup worker started (hourly check, runs when enabled)');
}

export function stopBackupWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function sameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
