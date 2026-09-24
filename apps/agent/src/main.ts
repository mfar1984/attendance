import type { AgentHeartbeat } from '@attendance/shared';

import { clockIsTrusted, localDriftSeconds, noteCloudTime } from './clock.js';
import { Cloud } from './cloud.js';
import { assertSecureCloud, loadConfig } from './config.js';
import { Executor } from './executor.js';
import { Forwarder } from './forwarder.js';
import { resolveLanHost } from './lan.js';
import { createListener } from './listener.js';
import { logger } from './logging.js';
import { Puller } from './puller.js';
import { Roster } from './roster.js';
import { Snapshotter } from './snapshots.js';
import { Spool } from './spool.js';
import { SiteState } from './state.js';

/**
 * The on-site connector.
 *
 * Four things happen on timers, and all four are outbound. Nothing here waits to be contacted by
 * the cloud, which is what lets a hospital publish one egress rule and no ingress one.
 *
 *   heartbeat  liveness, the device snapshot, and the roster + cloud clock coming back
 *   pull       the reconcile pull on the LAN, which is the job the cloud cannot do at all
 *   forward    spooled events to the cloud, oldest first
 *   listen     terminals pushing to us (not a timer, but the fourth path)
 *
 * The listener is started last and stopped first, because accepting an event this process cannot
 * spool is the one thing worse than refusing it.
 */

const config = loadConfig();
assertSecureCloud(config);

const log = logger();

const spool = new Spool(config);
const cloud = new Cloud(config);
const state = new SiteState();
const roster = new Roster();

/**
 * First boot: exchange the installer's token for a credential.
 *
 * Fails hard rather than starting without one. A connector that accepted pushes while unable to
 * deliver them would fill its disk and report nothing, and the site would look like it was
 * working right up until somebody asked for a report.
 */
if (!cloud.enrolled) {
  if (!config.ENROL_TOKEN) {
    log.fatal(
      'This connector has no credential and no enrolment token. Generate a token on the devices ' +
        'screen and re-run the installer.',
    );
    process.exit(1);
  }

  const enrolled = await cloud.enrol(config.ENROL_TOKEN);
  if (!enrolled.ok) {
    log.fatal(
      { failure: enrolled.failure },
      'Enrolment was refused. A token is single-use and expires within the hour; generate a new ' +
        'one and run the installer again.',
    );
    process.exit(1);
  }
}

const puller = new Puller(config, roster, spool, state);
const forwarder = new Forwarder(config, cloud, spool);
const executor = new Executor(cloud, roster);
const snapshotter = new Snapshotter(cloud, roster);
const { app, stats } = createListener(config, roster, spool, state);

/**
 * One heartbeat: report what we know, take back the roster and the cloud's clock.
 *
 * The roster is applied before anything else uses it, so a terminal added on the devices screen
 * is served within one heartbeat without anybody visiting the site.
 */
async function heartbeat(): Promise<void> {
  const devices = roster.all().map((entry) => state.report(entry.assignment.deviceId));

  /*
   * Resolved on every beat rather than once at boot.
   *
   * A DHCP lease moves, and then the address on the devices screen is a confident lie while the
   * terminals push somewhere nobody answers. Detecting it here does not repoint the terminals — it
   * makes the mismatch visible instead of silent. An explicit `LAN_HOST` still wins.
   */
  const lanHost = await resolveLanHost(config.LAN_HOST ?? null, config.CLOUD_URL);

  const payload: AgentHeartbeat = {
    version: config.version,
    lanHost,
    lanPort: config.LISTEN_PORT,
    spooled: spool.count(),
    devices,
  };

  const result = await cloud.heartbeat(payload);
  if (!result.ok) {
    log.warn({ failure: result.failure }, 'Heartbeat failed');
    return;
  }

  /*
   * The cloud's clock, recorded before the roster.
   *
   * Until this has arrived at least once, the connector refuses to write a terminal clock at
   * all — a Raspberry Pi has no battery-backed clock, and a connector that set fifteen terminals
   * from its own unsynced one would corrupt every timestamp at the site while looking entirely
   * authoritative.
   */
  if (!noteCloudTime(result.value.now)) {
    log.warn({ now: result.value.now }, 'Cloud reported a clock value that could not be parsed');
  }

  roster.replace(result.value.devices);
  state.retain(result.value.devices.map((device) => device.deviceId));

  const drift = localDriftSeconds();
  if (drift !== null && Math.abs(drift) > 60) {
    /*
     * Reported, not corrected. Fixing the system clock is the operating system's job, and doing
     * it from here would fight whatever NTP is also trying to do. But a connector an hour out is
     * worth seeing, because its own log timestamps are then misleading too.
     */
    log.warn({ driftSeconds: drift }, "This machine's own clock disagrees with the cloud");
  }
}

/**
 * Runs a job on a timer without letting two of them overlap.
 *
 * A pull that takes longer than its interval would otherwise stack, and stacked passes fight over
 * the same terminal's request queue — which on this firmware means out-of-order Digest counters
 * and a unit that starts refusing everything. Skipping a tick is the correct response to being
 * behind.
 */
function every(seconds: number, name: string, job: () => Promise<void>): NodeJS.Timeout {
  let running = false;

  return setInterval(() => {
    if (running) {
      log.debug({ job: name }, 'Skipping a tick because the previous one is still running');
      return;
    }
    running = true;
    void job()
      .catch((error: unknown) => {
        // Swallowed here so a thrown job cannot kill its own timer. A connector whose pull loop
        // died silently while the listener kept answering is the exact failure this project
        // already had once on the server, undetected for three weeks.
        log.error({ job: name, err: error }, 'Scheduled job failed');
      })
      .finally(() => {
        running = false;
      });
  }, seconds * 1000);
}

/*
 * The first heartbeat runs before the listener opens.
 *
 * It is what supplies the roster, and without a roster every push would be refused as coming
 * from a terminal this connector does not serve. Refusing a real event is worse than being
 * unavailable for a moment, because the firmware does not retry.
 */
await heartbeat();

await app.listen({ host: config.LISTEN_HOST, port: config.LISTEN_PORT });

log.info(
  {
    cloud: config.CLOUD_URL,
    listen: `${config.LISTEN_HOST}:${String(config.LISTEN_PORT)}`,
    advertised: config.advertisedHost,
    devices: roster.all().length,
    spooled: spool.count(),
    clockTrusted: clockIsTrusted(),
  },
  'Connector started',
);

const timers = [
  every(config.HEARTBEAT_SECONDS, 'heartbeat', heartbeat),
  every(config.PULL_SECONDS, 'pull', () => puller.runOnce()),
  every(5, 'forward', () => forwarder.drain()),
  /*
   * Enrolments feel exactly as slow as this interval. It is the gap between somebody uploading a
   * photograph on the screen and the terminal accepting it, so it is deliberately the shortest of
   * the timers that talk to the cloud.
   */
  every(config.COMMAND_POLL_SECONDS, 'commands', () => executor.runOnce()),
  /*
   * The device editor's data for this site.
   *
   * Slowest of the timers, and the only one that exists for a screen rather than for attendance.
   * The cloud cannot read a terminal behind a connector, so without this every settings tab is
   * empty — and an operator who opens one learns nothing about the unit in front of them.
   */
  every(config.SNAPSHOT_SECONDS, 'snapshots', () => snapshotter.runOnce()),
];

/**
 * Ordered shutdown.
 *
 * The listener closes first so no further event is accepted, then the forwarder is given one last
 * chance to deliver what is spooled. The spool is durable either way, so this is about latency
 * rather than safety — a restart during a deployment should not leave a site an hour behind.
 */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void (async () => {
      log.info({ signal, spooled: spool.count() }, 'Shutting down');

      for (const timer of timers) clearInterval(timer);
      await app.close();
      await forwarder.drain().catch(() => undefined);
      await roster.closeAll();
      spool.close();

      log.info({ stats }, 'Connector stopped');
      process.exit(0);
    })();
  });
}
