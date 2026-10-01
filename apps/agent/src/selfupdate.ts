import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, statfs } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { AGENT_VERSION, formatAgentUpdateFailure, type AgentUpdateStage } from '@attendance/shared';

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
 * **Ownership is not enough, and that was learned on a real site.** The unit's sandbox decides what
 * this process may write: `ProtectSystem=strict` mounts everything read-only except the paths in
 * `ReadWritePaths`, whoever owns them. The installer used to list only the state directory, so the
 * very first update could not fetch, and the screen said nothing more than that `git pull` had
 * failed. The checkout has to be in `ReadWritePaths`, and HOME has to point somewhere writable,
 * because npm cannot install without a cache. `preflight()` checks both before anything moves.
 *
 * ## Why this cannot brick the site
 *
 * Six properties, in the order they are met.
 *
 * **Everything it will write is checked first.** A sandbox that does not allow the write is
 * otherwise discovered by the first tool to try — at best `git pull`, at worst `npm ci` after it has
 * already deleted `node_modules`.
 *
 * **Only the build that was asked for is built.** The fetched code declares its own version, and
 * code that is not the requested build is left unbuilt. Building it anyway restarts into a version
 * the cloud still calls out of date, which asks again on the next heartbeat: a rebuild and restart
 * every minute at a site nobody is watching.
 *
 * **The build happens before the exit.** This process decides when it dies, so nothing can kill an
 * install halfway — the failure mode of running `systemctl restart` from inside a shell script that
 * is still running `npm ci`.
 *
 * **A failed build means no restart.** It reports the reason and keeps running on the old code.
 * That is the rollback: the running process already has its modules and its compiled entry point
 * loaded, so it is unaffected by a broken tree on disk.
 *
 * **`npm ci` is skipped unless the lockfile actually changed, and refused without room for it.**
 * This is the one genuinely dangerous step: `npm ci` deletes `node_modules` before reinstalling, so
 * a failure partway leaves an install with no dependencies and the next restart dies. Most connector
 * updates do not touch dependencies, so skipping it removes that exposure entirely for the common
 * case. A deliberate departure from the project's "always `npm ci`" rule, and the reason is that
 * this machine is unattended in another building.
 *
 * **The compiled entry point is verified before exiting.** A build that reports success but leaves
 * no `dist/main.js` would otherwise produce a restart loop nobody is there to see.
 *
 * ## What reaches the screen
 *
 * `<stage>: <what the tool printed>`, through `formatAgentUpdateFailure`. The stage becomes a label
 * in the reader's language on the cloud; the rest is git's or npm's own output, which is what
 * somebody standing at the machine will search for.
 */

/** Where the installer put the clone. The service's working directory is the same path. */
const INSTALL_DIR = process.cwd();

/** Long enough for `npm ci` on a slow hospital link, short enough to not hang a connector all day. */
const STEP_TIMEOUT_MS = 10 * 60_000;

/**
 * Free space required before `npm ci` runs.
 *
 * About twice what a cold install of this lockfile takes — `node_modules` is roughly 500 MB, and npm
 * keeps its downloaded tarballs in the cache beside it. Refusing with room to spare is cheap; running
 * out halfway is the outcome this whole file is arranged to avoid.
 */
const MIN_FREE_FOR_INSTALL = 1024 ** 3;

/** Lines of tool output kept, and their total length, so the stage label and context both fit. */
const OUTPUT_LINES = 4;
const OUTPUT_MAX = 380;

export interface UpdateOutcome {
  /** True when the new code is built and this process should exit for systemd to restart it. */
  restart: boolean;
  /** `<stage>: <detail>` explaining why it did not happen. Null on success. */
  error: string | null;
}

type StepResult = { ok: true; stdout: string } | { ok: false; detail: string };

async function step(command: string, args: string[]): Promise<StepResult> {
  try {
    const { stdout } = await run(command, args, {
      cwd: INSTALL_DIR,
      timeout: STEP_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      /*
       * `npm` writes progress to stderr and exits 0, so stderr alone is not failure — only a
       * non-zero exit is, which `execFile` reports by rejecting.
       *
       * `GIT_TERMINAL_PROMPT=0` so a remote that wants credentials fails at once and says so, rather
       * than waiting on a terminal this process will never have.
       */
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        NO_UPDATE_NOTIFIER: '1',
        npm_config_fund: 'false',
        npm_config_audit: 'false',
      },
    });
    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, detail: describeFailure(command, args, error) };
  }
}

/** The line that names the cause, in the order tools usually print one. */
const PRIMARY =
  /^(fatal|error):|\berror TS\d{4}\b|\b(EACCES|EROFS|ENOSPC|EPERM|ENOENT|ENOTDIR|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN)\b|read-only file system|permission denied|no space left/i;

/** A line that at least reports failure, for output where nothing names the cause directly. */
const SECONDARY = /\berror\b|ERR!|\bfailed\b/i;

/** npm's footer, which follows every failure and explains none of them. */
const NOISE =
  /^npm (error|ERR!|warn|WARN)\s+(A complete log of this run|Log files were not written|You can rerun the command)/i;

/**
 * A failed step, in the tool's own words.
 *
 * `execFile` rejects with `Command failed: <command>` as the first line of its message and the
 * process's output after it. Only that first line used to be kept, which is the one line that says
 * nothing: the first update on a real site reached the screen as "Command failed: git pull
 * --ff-only", and the reason — a read-only file system — was in the part that had been cut.
 */
export function describeFailure(command: string, args: readonly string[], error: unknown): string {
  const what = [command, ...args].join(' ');
  const failure = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown;
    signal?: unknown;
    killed?: unknown;
    stdout?: unknown;
    stderr?: unknown;
  };

  const status =
    failure.killed === true
      ? `timeout ${String(STEP_TIMEOUT_MS / 1000)}s`
      : typeof failure.code === 'number'
        ? `exit ${String(failure.code)}`
        : // A string code is the spawn itself failing: ENOENT means the command is not installed.
          typeof failure.code === 'string'
          ? failure.code
          : typeof failure.signal === 'string'
            ? failure.signal
            : 'failed';

  const output = salientOutput(asText(failure.stderr), asText(failure.stdout));
  return redact(output === '' ? `${what} (${status})` : `${what} (${status}): ${output}`);
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return '';
}

/**
 * The few lines of output that say why, rather than the last few.
 *
 * The cause is rarely last. npm closes every failure with the same footer, `npm run` puts its own
 * lifecycle lines on stderr while the compiler's errors are on stdout, and git follows a refusal with
 * advice. So the first line that names a cause is looked for in both streams, and the lines after it
 * kept as context — a file list after "would be overwritten", npm's path after its error code.
 */
export function salientOutput(stderr: string, stdout: string): string {
  const lines = (value: string): string[] =>
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !NOISE.test(line));

  const errorLines = lines(stderr);
  const outputLines = lines(stdout);

  for (const pattern of [PRIMARY, SECONDARY]) {
    for (const stream of [errorLines, outputLines]) {
      const at = stream.findIndex((line) => pattern.test(line));
      if (at >= 0) return clip(stream.slice(at, at + OUTPUT_LINES));
    }
  }

  return clip((errorLines.length > 0 ? errorLines : outputLines).slice(-OUTPUT_LINES));
}

function clip(lines: string[]): string {
  const joined = lines.join('\n');
  return joined.length > OUTPUT_MAX ? `${joined.slice(0, OUTPUT_MAX - 1)}…` : joined;
}

/**
 * Credentials that can appear in tool output, masked before the line leaves this machine.
 *
 * A token in the remote URL is the usual way a private repository gets cloned, and git repeats the
 * URL in its errors. That line then travels to the cloud and onto a screen anybody with the devices
 * permission can open.
 */
export function redact(value: string): string {
  return value
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, 'gh_***')
    .replace(/\b(hk(?:ag|en|a)_)[A-Za-z0-9_-]+/g, '$1***');
}

/** The connector version a copy of `schemas/agent.ts` declares, or null when it cannot be found. */
export function parseAgentVersion(source: string): string | null {
  return /export const AGENT_VERSION\s*=\s*'([^']+)'/.exec(source)?.[1] ?? null;
}

/** Where npm will keep its cache: `npm_config_cache` when set, otherwise `~/.npm`, as npm decides. */
function npmCacheDir(): string {
  const configured = process.env['npm_config_cache'];
  return configured !== undefined && configured !== '' ? configured : join(homedir(), '.npm');
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code: unknown };
    if (typeof code === 'string') return code;
  }
  return error instanceof Error ? error.message : 'error';
}

/**
 * Every place this update will write, checked before anything is touched.
 *
 * `access(W_OK)` answers EROFS for a read-only mount as well as EACCES for ownership, so one call
 * covers both the systemd sandbox and a tree left owned by root after an update by hand — which is
 * also how a partly root-owned `node_modules` would make `npm ci` fail halfway through deleting it.
 *
 * Returns the first path that cannot be written and why, or null when the update may proceed.
 */
export async function preflight(installDir: string, cacheDir: string): Promise<string | null> {
  const required = [installDir, join(installDir, '.git')];
  // Created by the step that needs them when absent, so only an existing one has to be writable.
  const ifPresent = [
    join(installDir, 'node_modules'),
    join(installDir, 'packages', 'shared', 'dist'),
    join(installDir, 'apps', 'agent', 'dist'),
  ];

  for (const path of [...required, ...ifPresent]) {
    try {
      await access(path, constants.W_OK);
    } catch (error) {
      const code = errorCode(error);
      if (code === 'ENOENT' && ifPresent.includes(path)) continue;
      return `${path}: ${code}`;
    }
  }

  try {
    await mkdir(cacheDir, { recursive: true });
    await access(cacheDir, constants.W_OK);
  } catch (error) {
    return `npm cache ${cacheDir}: ${errorCode(error)}`;
  }

  return null;
}

async function freeBytes(path: string): Promise<number | null> {
  try {
    const stats = await statfs(path);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

function megabytes(bytes: number): string {
  return String(Math.floor(bytes / 1024 ** 2));
}

function stopped(stage: AgentUpdateStage, detail: string): UpdateOutcome {
  logger().error({ stage, detail }, 'Self-update stopped');
  return { restart: false, error: formatAgentUpdateFailure(stage, detail) };
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

  const blocked = await preflight(INSTALL_DIR, npmCacheDir());
  if (blocked !== null) return stopped('preflight', blocked);

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
    return stopped('fetch', pull.detail);
  }

  /*
   * Only the requested build is built.
   *
   * The commonest way to get here with the wrong code is the order of a deployment: the repository
   * already carries a newer connector while the cloud still runs the build before it. Building that
   * would restart into a version the cloud calls out of date, be asked again, and loop. Checked
   * after the pull and not before, because the pull is what decides which code there is.
   *
   * Read from git like the lockfile. A file that no longer declares the constant this way — moved in
   * some later refactor — is let through rather than blocking every update after it.
   */
  const declared = await step('git', ['show', 'HEAD:packages/shared/src/schemas/agent.ts']);
  const fetchedVersion = declared.ok ? parseAgentVersion(declared.stdout) : null;
  if (fetchedVersion === null) {
    log.warn('Could not read AGENT_VERSION from the fetched code; building it anyway');
  } else if (fetchedVersion !== targetVersion) {
    return stopped(
      'source',
      `fetched ${fetchedVersion}, requested ${targetVersion}, running ${AGENT_VERSION}`,
    );
  }

  const lockAfter = await step('git', ['rev-parse', 'HEAD:package-lock.json']);
  const dependenciesChanged =
    !lockBefore.ok || !lockAfter.ok || lockBefore.stdout.trim() !== lockAfter.stdout.trim();

  if (dependenciesChanged) {
    const free = await freeBytes(INSTALL_DIR);
    if (free !== null && free < MIN_FREE_FOR_INSTALL) {
      return stopped(
        'space',
        `${INSTALL_DIR}: ${megabytes(free)} MB free, npm ci needs ${megabytes(MIN_FREE_FOR_INSTALL)} MB`,
      );
    }

    log.info('Dependencies changed, installing');
    const install = await step('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    if (!install.ok) {
      /*
       * The dangerous outcome, and its label says so: `npm ci` removes `node_modules` first, so this
       * connector is now running from memory with nothing on disk to restart from. It stays up and
       * keeps collecting, but it must not exit — and somebody has to look at it before it is
       * restarted for any other reason.
       */
      return stopped('install', install.detail);
    }
  } else {
    log.info('Lockfile unchanged, skipping install');
  }

  const packages = await step('npx', ['tsc', '--build']);
  if (!packages.ok) return stopped('packages', packages.detail);

  const built = await step('npm', ['run', 'build:prod', '--workspace', '@attendance/agent']);
  if (!built.ok) return stopped('build', built.detail);

  /*
   * Verified rather than assumed. A build that exits zero and leaves no entry point would otherwise
   * produce a restart loop at a site nobody is watching, and the last thing the journal would show
   * is this process reporting success.
   */
  const entry = join(INSTALL_DIR, 'apps', 'agent', 'dist', 'main.js');
  try {
    await access(entry);
  } catch {
    return stopped('entry', entry);
  }

  log.info({ to: targetVersion }, 'Self-update built; exiting for systemd to restart on new code');
  return { restart: true, error: null };
}
