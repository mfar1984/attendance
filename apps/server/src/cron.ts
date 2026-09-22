/**
 * One-shot entry point for hosts that cannot keep a process alive.
 *
 * The server normally owns three timers. Where a supervisor stops the application when
 * it goes idle, those timers stop with it, so the same work is driven from cron instead:
 *
 *   node dist/cron.js sync        every minute
 *   node dist/cron.js retention   hourly
 *   node dist/cron.js backup      hourly
 *
 * Each job calls exactly the function the timer calls. A scheduled job that takes a
 * different code path is a job whose failure mode nobody has seen, and these run at two
 * in the morning with nobody watching.
 *
 * `retention` and `backup` are safe to run every hour regardless of policy: both read
 * their own schedule and do nothing outside their configured hour, and both do nothing
 * at all until somebody switches them on.
 *
 * Exit code is 1 on failure so cron's own mail carries the fact rather than swallowing it.
 */
import { loadDotEnvIfNeeded } from './bootstrap.js';

loadDotEnvIfNeeded();

const { disconnectDb } = await import('./db.js');
const { logger } = await import('./logger.js');

const log = logger();
const job = process.argv[2];

async function runSync(): Promise<void> {
  const { syncAllDevices } = await import('./sync/worker.js');
  const results = await syncAllDevices();

  const stored = results.reduce((total, result) => total + result.stored, 0);
  const failed = results.filter((result) => result.error !== undefined);

  log.info({ devices: results.length, stored, failed: failed.length }, 'Reconcile pull complete');

  // Named individually: "three failed" does not say which door to walk to.
  for (const result of failed) {
    log.warn({ device: result.deviceName, err: result.error }, 'Device sync failed');
  }
}

async function runRetention(): Promise<void> {
  const { runPurge, loadRetentionPolicy } = await import('./retention/purge.js');
  const policy = await loadRetentionPolicy();

  /*
   * The hour gate lives here rather than in cron's schedule so the policy stays the one
   * place the decision is recorded. Somebody changing the purge hour on the screen would
   * otherwise have to know a crontab exists and disagree with it.
   */
  if (new Date().getHours() !== policy.purgeHour) return;

  const outcome = await runPurge({ accountId: null, label: 'cron' });
  log.info({ outcome }, 'Retention pass complete');
}

async function runScheduledBackup(): Promise<void> {
  const { loadBackupPolicy, runBackup, pruneBackups } = await import('./routes/backup.js');
  const policy = await loadBackupPolicy();

  if (!policy.enabled) return;
  if (new Date().getHours() !== policy.hour) return;

  const outcome = await runBackup();
  const pruned = await pruneBackups(policy.keepCount);
  log.info({ name: outcome.name, bytes: outcome.bytes, pruned: pruned.length }, 'Backup complete');
}

const jobs: Record<string, () => Promise<void>> = {
  sync: runSync,
  retention: runRetention,
  backup: runScheduledBackup,
};

const run = job === undefined ? undefined : jobs[job];

if (run === undefined) {
  console.error(`Usage: node dist/cron.js <${Object.keys(jobs).join('|')}>`);
  await disconnectDb();
  process.exit(2);
}

try {
  await run();
  await disconnectDb();
  process.exit(0);
} catch (error) {
  log.error({ err: error, job }, 'Cron job failed');
  await disconnectDb();
  process.exit(1);
}
