import { buildApp } from './app.js';
import { loadDotEnvIfNeeded } from './bootstrap.js';
import { disconnectDb } from './db.js';
import { releaseAllClients } from './devices/registry.js';
import { loadEnv } from './env.js';
import { logger } from './logger.js';
import { startRetentionWorker, stopRetentionWorker } from './retention/purge.js';
import { startBackupWorker, stopBackupWorker } from './routes/backup.js';
import { startSyncWorker, stopSyncWorker } from './sync/worker.js';

loadDotEnvIfNeeded();

const env = loadEnv();
const log = logger();

const app = await buildApp();

await app.listen({ port: env.PORT, host: env.HOST });
log.info(
  { port: env.PORT, mode: env.CONNECTOR_MODE, workers: env.RUN_WORKERS },
  'Attendance server listening',
);

/**
 * Background work is opt-out, because not every host will keep this process alive.
 *
 * A supervisor that stops an idle application — Passenger's pool idle timeout is the
 * common case, and on shared hosting it is not ours to change — takes the timers with
 * it. The reconcile pull would then run for a few minutes after each request and stop,
 * which is worse than not running: the devices screen keeps reporting a cursor that
 * advanced this morning, so a pull that has been dead all day looks like one that is
 * merely quiet.
 *
 * Where this is off, the same work runs from cron against the one-shot scripts. Nothing
 * here is skipped; it is moved to a scheduler that is actually allowed to schedule.
 */
if (env.RUN_WORKERS) {
  startSyncWorker();
  // Checks hourly and does nothing unless retention has been switched on. An
  // installation that has made no retention decision keeps everything.
  startRetentionWorker();
  // Same shape, same opt-in. An installation that has made no backup decision is not
  // quietly filled with dumps of its own database.
  startBackupWorker();
} else {
  log.info(
    'Background workers are disabled; retention, backup and the reconcile pull must run from cron',
  );
}

/**
 * Ordered shutdown.
 *
 * The sync worker is stopped first so a pass in flight cannot write after the
 * database pool is gone, which would otherwise leave a device's cursor advanced
 * past events that were never stored.
 */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void (async () => {
      log.info({ signal }, 'Shutting down');
      stopSyncWorker();
      stopRetentionWorker();
      stopBackupWorker();
      await app.close();
      await releaseAllClients();
      await disconnectDb();
      process.exit(0);
    })();
  });
}
