import { buildApp } from './app.js';
import { disconnectDb } from './db.js';
import { releaseAllClients } from './devices/registry.js';
import { loadEnv } from './env.js';
import { logger } from './logger.js';
import { startRetentionWorker, stopRetentionWorker } from './retention/purge.js';
import { startBackupWorker, stopBackupWorker } from './routes/backup.js';
import { startSyncWorker, stopSyncWorker } from './sync/worker.js';

const env = loadEnv();
const log = logger();

const app = await buildApp();

await app.listen({ port: env.PORT, host: env.HOST });
log.info(
  { port: env.PORT, mode: env.CONNECTOR_MODE },
  'Attendance server listening',
);

startSyncWorker();
// Checks hourly and does nothing unless retention has been switched on. An
// installation that has made no retention decision keeps everything.
startRetentionWorker();
// Same shape, same opt-in. An installation that has made no backup decision is not
// quietly filled with dumps of its own database.
startBackupWorker();

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
