import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads `.env` when the process was not started with `--env-file`.
 *
 * Development and `npm start` both pass the flag. A managed host does neither: Passenger
 * and similar supervisors execute the entry file directly, so the flag never applies and
 * every variable arrives empty. `loadEnv()` then fails at boot naming fifteen missing
 * fields, which reads as a broken build rather than as an unloaded file.
 *
 * Existing variables win. A host that sets configuration through its own control panel is
 * the authority, and a stale `.env` left behind in the clone must not override it.
 *
 * Shared by the server and the cron entry point, because a scheduled job that resolves its
 * configuration differently from the service is a job whose environment nobody has checked.
 */
export function loadDotEnvIfNeeded(): void {
  if (process.env['DATABASE_URL'] !== undefined) return;

  const candidates = [
    resolve(process.cwd(), '.env'),
    // From `apps/server/dist`, the repository root is three levels up.
    resolve(import.meta.dirname, '../../../.env'),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    process.loadEnvFile(candidate);
    return;
  }
}
