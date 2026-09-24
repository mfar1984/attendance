import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { AGENT_VERSION } from '@attendance/shared';

import { logger } from './logging.js';

const run = promisify(execFile);

/**
 * Updates this connector in place, on request from the cloud.
 *
 * Replaces the only remaining reason somebody had to reach a site by SSH. The alternative was one
 * person with network access to every hospital, which does not scale past the second site and does
 * not survive that person being on leave.
 *
 * ## No root, no inbound port, no VPN
 *
 * The service unit carries `Restart=always` with `RestartSec=5`, so this process does not need
 * permission to restart itself — it exits, and systemd brings it back on the new code five seconds
 * later. That one line in the unit file is what makes the whole feature possible without a sudoers
 * rule, a privileged helper, or a tunnel into the hospital network.
 *
 * `/opt/attendance` is owned by the service user, so `git pull` and the build run as the same
 * account with no elevation.
 *
 * ## Why this cannot brick the site
 *
 * Four properties, in the order they matter.
 *
 * **The build happens before the exit.** This process decides when it dies, so nothing can kill an
 * install halfway — the failure mode of running `systemctl restart` from inside a shell script that
 * is still running `npm ci`.
 *
 * **A failed build means no restart.** It reports the reason and keeps running on the old code.
 * That is the rollback: the running process already has its modules and its compiled entry point
 * loaded, so it is unaffected by a broken tree on disk.
 *
 * **`npm ci` is skipped unless the lockfile actually changed.** This is the one genuinely dangerous
 * step: `npm ci` deletes `node_modules` before reinstalling, so a failure partway leaves an install
 * with no dependencies and the next restart dies. Most connector updates do not touch dependencies,
 * so skipping it removes that exposure entirely for the common case. A deliberate departure from
 * the project's "always `npm ci`" rule, and the reason is that this machine is unattended in
 * another building.
 *
 * **The compiled entry point is verified before exiting.** A build that reports success but leaves
 * no `dist/main.js` would otherwise produce a restart loop nobody is there to see.
 */

/** Where the installer put the clone. The service's working directory is the same path. */
const INSTALL_DIR = process.cwd();

/** Long enough for `npm ci` on a slow hospital link, short enough to not hang a connector all day. */
const STEP_TIMEOUT_MS = 10 * 60_000;

export interface UpdateOutcome {
  /** True when the new code is built and this process should exit for systemd to restart it. */
  restart: boolean;
  /** Why it did not happen. Null on success. */
  error: string | null;
}

async function step(command: string, args: string[]): Promise<{ ok: true; stdout: string } | { ok: false; detail: string }> {
  try {
    const { stdout } = await run(command, args, {
      cwd: INSTALL_DIR,
      timeout: STEP_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      /*
       * `npm` writes progress to stderr and exits 0, so stderr alone is not failure — only a
       * non-zero exit is, which `execFile` reports by rejecting.
       */
      env: { ...process.env, NO_UPDATE_NOTIFIER: '1', npm_config_fund: 'false', npm_config_audit: 'false' },
    });
    return { ok: true, stdout };
  } catch (error) {
    const detail =
      error instanceof Error
        ? `${command} ${args[0] ?? ''}: ${error.message.split('\n')[0] ?? error.message}`
        : `${command} gagal`;
    return { ok: false, detail };
  }
}

/**
 * Runs the update. Never throws: the caller is a timer, and a thrown update would take the
 * connector's own loop with it.
 */
export async function selfUpdate(targetVersion: string): Promise<UpdateOutcome> {
  const log = logger();

  if (targetVersion === AGENT_VERSION) {
    /*
     * The cloud asked, but this build already matches. Reported as success with no restart so the
     * request clears — a stale request must not cause a pointless rebuild of a current site.
     */
    log.info({ version: AGENT_VERSION }, 'Update requested but this build is already current');
    return { restart: false, error: null };
  }

  log.info({ from: AGENT_VERSION, to: targetVersion }, 'Starting self-update');

  /*
   * The lockfile hash before and after the pull is what decides whether dependencies are installed.
   * Read from git rather than the file so a half-written working tree cannot make them look equal.
   */
  const lockBefore = await step('git', ['rev-parse', 'HEAD:package-lock.json']);

  const pull = await step('git', ['pull', '--ff-only']);
  if (!pull.ok) {
    /*
     * `--ff-only` on purpose. A merge here would produce a tree nobody reviewed on a machine nobody
     * can reach, and a conflict would leave the clone in a state the next update cannot recover
     * from. Refusing keeps the site on known code.
     */
    log.error({ detail: pull.detail }, 'Self-update could not fetch new code');
    return { restart: false, error: `Tidak dapat mengambil kod baharu. ${pull.detail}` };
  }

  const lockAfter = await step('git', ['rev-parse', 'HEAD:package-lock.json']);
  const dependenciesChanged =
    !lockBefore.ok || !lockAfter.ok || lockBefore.stdout.trim() !== lockAfter.stdout.trim();

  if (dependenciesChanged) {
    log.info('Dependencies changed, installing');
    const install = await step('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    if (!install.ok) {
      /*
       * The dangerous outcome, and it is named rather than glossed: `npm ci` removes
       * `node_modules` first, so this connector is now running from memory with nothing on disk to
       * restart from. It stays up and keeps collecting, but it must not exit — and somebody has to
       * look at it before it is restarted for any other reason.
       */
      log.error({ detail: install.detail }, 'Self-update could not install dependencies');
      return {
        restart: false,
        error:
          `Pemasangan kebergantungan gagal, jadi connector ini kekal pada kod lama dan TIDAK ` +
          `boleh dimulakan semula sampai ia dibetulkan dengan tangan. ${install.detail}`,
      };
    }
  } else {
    log.info('Lockfile unchanged, skipping install');
  }

  const packages = await step('npx', ['tsc', '--build']);
  if (!packages.ok) {
    log.error({ detail: packages.detail }, 'Self-update could not build packages');
    return { restart: false, error: `Bina pakej gagal. ${packages.detail}` };
  }

  const built = await step('npm', ['run', 'build:prod', '--workspace', '@attendance/agent']);
  if (!built.ok) {
    log.error({ detail: built.detail }, 'Self-update could not build the connector');
    return { restart: false, error: `Bina connector gagal. ${built.detail}` };
  }

  /*
   * Verified rather than assumed. A build that exits zero and leaves no entry point would otherwise
   * produce a restart loop at a site nobody is watching, and the last thing the journal would show
   * is this process reporting success.
   */
  const entry = join(INSTALL_DIR, 'apps', 'agent', 'dist', 'main.js');
  try {
    await access(entry);
  } catch {
    log.error({ entry }, 'Self-update built without producing an entry point');
    return {
      restart: false,
      error: 'Bina selesai tetapi apps/agent/dist/main.js tiada, jadi restart dibatalkan.',
    };
  }

  log.info({ to: targetVersion }, 'Self-update built; exiting for systemd to restart on new code');
  return { restart: true, error: null };
}
