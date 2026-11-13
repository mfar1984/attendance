/**
 * Regression suite for noticing a terminal that has stopped reporting — at both layers.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/test-agent-liveness.mts
 *
 * The rules — `agentIsSilent` and `reportedDeviceStatus` — are pure and get the bulk of the
 * assertions, because getting either wrong in one direction cries wolf and in the other hides a
 * dead hospital. Each is then run against the real thing that applies it: the sweep against the
 * database with real rows, and the per-terminal rule through `buildApp()` + `inject()` on the
 * actual heartbeat route. Both because a Prisma statement naming a field the model lacks passes
 * `tsc` and fails at request time, and because a rule nothing calls is a rule that does nothing.
 *
 * ## What this is defending
 *
 * **Layer one — the connector goes silent.** A connector-served terminal's status is written only
 * by its agent's heartbeat, so when a connector went quiet nothing wrote anything and the status
 * froze: Hospital Sibu was silent from 21 October to 12 November with its terminal still reading
 * ONLINE and the alert bell quiet, because the bell counts terminals whose status is offline.
 * Twenty-two days of attendance that never existed.
 *
 * **Layer two — the connector is fine and one terminal is mute.** The connector's own rule has no
 * staleness bound: a terminal observed once is reported `online` forever after. On a callback
 * protocol nothing dials the unit, so its silence is invisible — device 6 `Pejabat Faeez` sat green
 * for eighteen hours on the strength of a single hand-run handshake. Both layers are kept in one
 * suite because they compose, and a change to either should run the other's assertions.
 */

import { randomBytes } from 'node:crypto';

import { DeviceProtocol, DeviceStatus } from '@attendance/shared';
import { TA_PUSH_POLL_SECONDS } from '@attendance/terminal-drivers';

const { db, disconnectDb } = await import('../apps/server/src/db.js');
const { buildApp } = await import('../apps/server/src/app.js');
const { issueAgentKey, issueEnrolToken } = await import('../apps/server/src/devices/agents.js');
const {
  AGENT_SILENCE_MS,
  TERMINAL_SILENCE_MS,
  TERMINAL_SILENCE_POLLS,
  agentIsSilent,
  reportedDeviceStatus,
  silenceReason,
  strandSilentAgentDevices,
  terminalIsSilent,
  terminalSilenceReason,
} = await import('../apps/server/src/devices/agent-liveness.js');

let failures = 0;
function check(ok: boolean, what: string, detail = ''): void {
  if (ok) {
    console.log(`  [ok]   ${what}`);
  } else {
    failures += 1;
    console.log(`  [FAIL] ${what}${detail === '' ? '' : ` :: ${detail}`}`);
  }
}

/**
 * Removal that reports what it could not remove.
 *
 * A cleanup hiding its own failures turns every future leftover row into an investigation of the
 * wrong thing — so a blocked delete is counted as a failure here rather than swallowed.
 */
async function sweep(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    failures += 1;
    console.log(`  [FAIL] cleanup: ${what} — ${error instanceof Error ? error.message : 'ralat'}`);
  }
}

const NOW = new Date('2026-11-12T10:00:00.000Z');
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

// ---------------------------------------------------------------------------
console.log('\nThe rule');

check(
  !agentIsSilent({ status: 'active', lastSeenAt: ago(0) }, NOW),
  'a connector heard from just now is not silent',
);
check(
  !agentIsSilent({ status: 'active', lastSeenAt: ago(60_000) }, NOW),
  'nor one a minute ago',
);

/*
 * The boundary matters because `HEARTBEAT_SECONDS` caps at 900. A window that did not exceed the
 * slowest configurable interval would mark a healthy slow site offline between its own beats.
 */
check(
  !agentIsSilent({ status: 'active', lastSeenAt: ago(900_000) }, NOW),
  'a site on the slowest allowed interval survives one full beat',
);
check(
  !agentIsSilent({ status: 'active', lastSeenAt: ago(AGENT_SILENCE_MS - 1000) }, NOW),
  'just inside the window is not silent',
);
check(
  agentIsSilent({ status: 'active', lastSeenAt: ago(AGENT_SILENCE_MS + 1000) }, NOW),
  'just outside it is',
);
check(
  AGENT_SILENCE_MS > 900_000,
  'and the window is wider than the slowest heartbeat a site can be set to',
  String(AGENT_SILENCE_MS),
);

/* The case that actually happened. */
check(
  agentIsSilent({ status: 'active', lastSeenAt: new Date('2026-10-21T21:29:59.000Z') }, NOW),
  'twenty-two days of silence is silence',
);

/*
 * A revoked credential cannot heartbeat, and `revokeAgent` leaves its devices attached on purpose
 * so they read as stranded rather than as reassigned. This is what makes them read that way — so
 * the clock must not be consulted.
 */
check(
  agentIsSilent({ status: 'revoked', lastSeenAt: ago(0) }, NOW),
  'a revoked connector is silent even if it was seen a second ago',
);
check(
  agentIsSilent({ status: 'pending', lastSeenAt: ago(0) }, NOW),
  'and so is one that never enrolled',
);
check(
  agentIsSilent({ status: 'active', lastSeenAt: null }, NOW),
  'an active row that has never been used is silent',
);

// ---------------------------------------------------------------------------
console.log('\nWhat the operator reads');

{
  const reason = silenceReason('Hospital Sibu', new Date('2026-10-21T21:29:59.000Z'));
  check(reason.includes('Hospital Sibu'), 'the connector is named', reason);
  check(reason.includes('2026-10-21 21:29'), 'and when it was last heard from');
  check(
    reason.includes('bukan terminal rosak'),
    'and it says this is not a faulty terminal — which is the whole point',
  );
  check(reason.length <= 500, 'inside the column width', String(reason.length));

  const never = silenceReason('Tapak Baharu', null);
  check(never.includes('belum pernah'), 'a connector that never reported reads differently', never);
}

// ---------------------------------------------------------------------------
console.log('\nAturan satu terminal');

/*
 * The bound is derived from the interval the terminal was actually told to poll on, so the margin
 * is asserted rather than trusted. A bound of one or two polls would fire on a single dropped
 * request; one wider than the connector's own silence window would make a mute terminal invisible
 * until the whole site was called dark.
 */
check(
  TERMINAL_SILENCE_MS === TA_PUSH_POLL_SECONDS * TERMINAL_SILENCE_POLLS * 1000,
  'the window is the advertised poll interval times the allowed misses',
  String(TERMINAL_SILENCE_MS),
);
check(
  TERMINAL_SILENCE_MS >= TA_PUSH_POLL_SECONDS * 1000 * 10,
  'and the margin is at least ten polls',
  `${String(TERMINAL_SILENCE_MS)}ms vs ${String(TA_PUSH_POLL_SECONDS * 1000)}ms per poll`,
);
check(
  TERMINAL_SILENCE_MS < AGENT_SILENCE_MS,
  'a mute terminal surfaces before a dark site does',
  `${String(TERMINAL_SILENCE_MS)} vs ${String(AGENT_SILENCE_MS)}`,
);

check(
  !terminalIsSilent({ lastSeenAt: ago(10_000) }, NOW),
  'a terminal seen ten seconds ago is not silent',
);
check(
  !terminalIsSilent({ lastSeenAt: ago(TA_PUSH_POLL_SECONDS * 1000) }, NOW),
  'nor one exactly one poll interval ago',
);
check(
  !terminalIsSilent({ lastSeenAt: ago(TERMINAL_SILENCE_MS - 1000) }, NOW),
  'just inside the window is not silent',
);
check(
  terminalIsSilent({ lastSeenAt: ago(TERMINAL_SILENCE_MS + 1000) }, NOW),
  'just outside it is',
);

/* The case that is live on production right now. */
check(
  terminalIsSilent({ lastSeenAt: ago(18 * 3600_000) }, NOW),
  'eighteen hours of silence is silence',
);

/*
 * Null is NOT silent, and that is constraint 1. A connector keeps its observations in memory, so
 * one that just restarted reports every terminal with no timestamp — and calling those dead would
 * put a false alarm on the dashboard on every service restart.
 */
check(!terminalIsSilent({ lastSeenAt: null }, NOW), 'nothing observed is not evidence of death');

/*
 * The Pi has no battery-backed clock, so its stamp can land ahead of the cloud's. Arithmetic that
 * read a negative age as stale would mark a healthy site offline for being early.
 */
check(
  !terminalIsSilent({ lastSeenAt: new Date(NOW.getTime() + 5 * 60_000) }, NOW),
  'a connector clock running ahead does not make its terminal stale',
);

// ---------------------------------------------------------------------------
console.log('\nKeputusan laporan');

/** One device report, with only the three fields the rule reads. */
const reportOf = (
  status: DeviceStatus,
  lastSeenAt: Date | null,
  lastError: string | null = null,
): { status: DeviceStatus; lastSeenAt: Date | null; lastError: string | null } => ({
  status,
  lastSeenAt,
  lastError,
});

{
  // Case 2: a ZKTeco terminal unplugged an hour ago, with the connector still heartbeating.
  const stale = reportedDeviceStatus(
    reportOf(DeviceStatus.online, ago(60 * 60_000)),
    DeviceProtocol.taPush,
    NOW,
  );
  check(
    stale.status === DeviceStatus.offline,
    'case 2 · a callback terminal claiming online after an hour of silence is offline',
    stale.status,
  );
  check(
    stale.lastError !== null && stale.lastError.includes('2026-11-12 09:00'),
    'and the message names the instant it was last heard from',
    stale.lastError ?? 'null',
  );

  // Case 1: the same terminal polling normally.
  const fresh = reportedDeviceStatus(
    reportOf(DeviceStatus.online, ago(TA_PUSH_POLL_SECONDS * 1000)),
    DeviceProtocol.taPush,
    NOW,
  );
  check(
    fresh.status === DeviceStatus.online && fresh.lastError === null,
    'case 1 · one polling normally stays online with no message',
    JSON.stringify(fresh),
  );

  // Cases 3 and 5: nothing observed. Grey, never green and never a false alarm.
  const blank = reportedDeviceStatus(
    reportOf(DeviceStatus.unknown, null),
    DeviceProtocol.taPush,
    NOW,
  );
  check(
    blank.status === DeviceStatus.unknown && blank.lastError === null,
    'cases 3 and 5 · nothing observed reads unknown, not online and not offline',
    JSON.stringify(blank),
  );

  /*
   * A report that claims `online` with no timestamp has no evidence behind it either. It cannot be
   * taken at face value, and it cannot be called dead — a connector one poll into its life looks
   * exactly like this.
   */
  const unevidenced = reportedDeviceStatus(
    reportOf(DeviceStatus.online, null),
    DeviceProtocol.taPush,
    NOW,
  );
  check(
    unevidenced.status === DeviceStatus.unknown,
    'an online claim with no timestamp behind it is downgraded to unknown',
    unevidenced.status,
  );

  /*
   * An explicit failure report is better information than a timestamp, so it survives untouched.
   */
  const failing = reportedDeviceStatus(
    reportOf(DeviceStatus.offline, ago(60 * 60_000), 'ECONNREFUSED pada 192.168.0.23'),
    DeviceProtocol.taPush,
    NOW,
  );
  check(
    failing.status === DeviceStatus.offline && failing.lastError === 'ECONNREFUSED pada 192.168.0.23',
    "a connector reporting its own failure keeps its own words",
    JSON.stringify(failing),
  );

  const degraded = reportedDeviceStatus(
    reportOf(DeviceStatus.degraded, ago(60 * 60_000)),
    DeviceProtocol.taPush,
    NOW,
  );
  check(degraded.status === DeviceStatus.degraded, 'and a degraded report passes through');

  /*
   * Case 4: a request-response protocol is exempt, proven with a *stale* timestamp so the
   * exemption is shown to be real rather than merely untriggered. The connector dials these units,
   * so a failure is observable and already flips the report — and `PULL_SECONDS` goes up to an
   * hour, so silence here is not evidence of anything.
   */
  const pulled = reportedDeviceStatus(
    reportOf(DeviceStatus.online, ago(45 * 60_000)),
    DeviceProtocol.isapi,
    NOW,
  );
  check(
    pulled.status === DeviceStatus.online && pulled.lastError === null,
    'case 4 · an ISAPI terminal pulled on a slow cycle is left online',
    JSON.stringify(pulled),
  );
  check(
    reportedDeviceStatus(
      reportOf(DeviceStatus.online, ago(TA_PUSH_POLL_SECONDS * 1000)),
      DeviceProtocol.isapi,
      NOW,
    ).status === DeviceStatus.online,
    'and so is one pulled a moment ago',
  );

  /* The exemption follows `REQUEST_RESPONSE_PROTOCOLS`, not a hardcoded 'isapi'. */
  check(
    reportedDeviceStatus(
      reportOf(DeviceStatus.online, ago(45 * 60_000)),
      DeviceProtocol.dahuaCgi,
      NOW,
    ).status === DeviceStatus.online,
    'Dahua CGI is exempt too, because the exemption is the protocol class',
  );

  /*
   * The message must not change between beats. The route only rewrites `lastErrorAt` when the
   * message changed, so a message quoting an elapsed duration would move the timestamp every
   * sixty seconds and bury when the silence began.
   */
  const seen = ago(60 * 60_000);
  const early = reportedDeviceStatus(
    reportOf(DeviceStatus.online, seen),
    DeviceProtocol.taPush,
    NOW,
  );
  const later = reportedDeviceStatus(
    reportOf(DeviceStatus.online, seen),
    DeviceProtocol.taPush,
    new Date(NOW.getTime() + 20 * 60_000),
  );
  check(
    early.lastError === later.lastError,
    'the same silence reads the same twenty minutes later',
    `${String(early.lastError)} / ${String(later.lastError)}`,
  );

  const reason = terminalSilenceReason(seen, TERMINAL_SILENCE_MS);
  check(reason.includes('minit'), 'the message states the window it exceeded', reason);
  check(
    reason.includes('Connectornya masih melaporkan'),
    'and says the connector is not the problem — which is what sends somebody to the right place',
  );
  check(reason.length <= 500, 'inside the column width', String(reason.length));
}

// ---------------------------------------------------------------------------
console.log('\nThe sweep, against the database');

const TAG = `UJIAN-LIVE-${randomBytes(3).toString('hex')}`;
const prisma = db();
const cleanup: Array<() => Promise<void>> = [];

/** Built only for the route section below, and closed before the connection is released. */
let app: Awaited<ReturnType<typeof buildApp>> | null = null;
const routeAgents: number[] = [];
const routeDevices: number[] = [];

try {
  const makeAgent = async (name: string, status: string, lastSeenAt: Date | null) => {
    const row = await prisma.deviceAgent.create({
      data: {
        name: `${TAG} ${name}`,
        agentKey: `agent_${randomBytes(9).toString('base64url')}`,
        status,
        lastSeenAt,
        ...(status === 'active' ? { enrolledAt: new Date() } : {}),
      },
      select: { id: true },
    });
    return row.id;
  };

  const makeDevice = async (name: string, agentId: number | null, status: string) => {
    const row = await prisma.device.create({
      data: {
        name: `${TAG} ${name}`,
        vendor: 'zkteco',
        protocol: 'ta-push',
        host: `10.255.255.${String(Math.floor(Math.random() * 200) + 1)}`,
        port: 80,
        serialNumber: `${TAG}-${name}`,
        agentId,
        active: true,
        status,
      },
      select: { id: true },
    });
    return row.id;
  };

  const silentId = await makeAgent('senyap', 'active', new Date(Date.now() - 3 * 24 * 3600_000));
  const liveId = await makeAgent('hidup', 'active', new Date());
  const revokedId = await makeAgent('ditarik', 'revoked', new Date());

  const stranded = await makeDevice('terminal-senyap', silentId, 'online');
  const degraded = await makeDevice('terminal-degraded', silentId, 'degraded');
  const healthy = await makeDevice('terminal-hidup', liveId, 'online');
  const orphan = await makeDevice('terminal-ditarik', revokedId, 'online');
  const direct = await makeDevice('terminal-terus', null, 'online');

  cleanup.push(async () => {
    await prisma.deviceSyncState.deleteMany({ where: { device: { name: { startsWith: TAG } } } });
    await prisma.device.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.deviceAgent.deleteMany({ where: { name: { startsWith: TAG } } });
  });

  const first = await strandSilentAgentDevices();
  check(first.devices >= 3, 'the sweep ran and changed rows', JSON.stringify(first));

  const read = async (id: number) =>
    prisma.device.findUniqueOrThrow({
      where: { id },
      select: { status: true, lastError: true, lastErrorAt: true, lastSeenAt: true },
    });

  check((await read(stranded)).status === 'offline', 'a silent connector strands its terminal');
  check(
    (await read(degraded)).status === 'offline',
    'including one that was degraded — silence is less knowledge, not more',
  );
  check(
    (await read(orphan)).status === 'offline',
    'a revoked connector strands its terminals too',
  );

  /*
   * The two that must not be touched. A live connector's terminal, and a terminal this server
   * reaches itself — the latter belongs to the health probe and the reconcile pull, and a second
   * writer would fight them.
   */
  check((await read(healthy)).status === 'online', 'a live connector is left alone');
  check((await read(direct)).status === 'online', 'and so is a directly-reached terminal');

  const reason = (await read(stranded)).lastError ?? '';
  check(reason.includes(TAG), 'the stranded terminal names its connector', reason.slice(0, 80));

  /*
   * `lastSeenAt` is the evidence of how long attendance has been missing. Overwriting it with
   * "now" would destroy the one number that answers that question.
   */
  check((await read(stranded)).lastSeenAt === null, 'and lastSeenAt is not rewritten');

  // A second pass must be a no-op, or every sweep moves `lastErrorAt` forward and the moment the
  // silence began is lost.
  const firstAt = (await read(stranded)).lastErrorAt;
  const second = await strandSilentAgentDevices();
  check(second.devices === 0, 'a second pass changes nothing', JSON.stringify(second));
  check(
    (await read(stranded)).lastErrorAt?.getTime() === firstAt?.getTime(),
    'so when the silence started is preserved',
  );

  /*
   * Recovery. The heartbeat route writes the agent's own report, which is the only writer that can
   * honestly say the condition is over — asserted here by doing what that route does.
   */
  await prisma.deviceAgent.update({ where: { id: silentId }, data: { lastSeenAt: new Date() } });
  await prisma.device.update({
    where: { id: stranded },
    data: { status: 'online', lastError: null, lastErrorAt: null },
  });

  const third = await strandSilentAgentDevices();
  check(
    third.devices === 0 && (await read(stranded)).status === 'online',
    'once the connector reports again, the sweep leaves it recovered',
    JSON.stringify(third),
  );

  // -------------------------------------------------------------------------
  console.log('\nMelalui route heartbeat');

  /*
   * The wiring `tsc` cannot certify. The rule above is pure and provable on its own; what it does
   * not show is that the heartbeat route calls it, passes the device's real protocol, and writes
   * the verdict rather than the claim. Dispatched through `app.inject()`, so this needs no port,
   * no `npm run dev` and no password.
   *
   * These timestamps are relative to the real clock, not `NOW`: the route judges each report with
   * `new Date()`.
   */
  const server = await buildApp();
  app = server;
  const since = (ms: number): string => new Date(Date.now() - ms).toISOString();

  /*
   * Registered before the first row exists, and it reads the id arrays when it runs rather than
   * now — so a failed assertion halfway through still takes its rows with it.
   */
  cleanup.push(async () => {
    if (routeDevices.length > 0) {
      await sweep('device commands', () =>
        prisma.deviceCommand.deleteMany({ where: { deviceId: { in: routeDevices } } }),
      );
      await sweep('exceptions', () =>
        prisma.attendanceException.deleteMany({ where: { deviceId: { in: routeDevices } } }),
      );
      await sweep('unmapped identifiers', () =>
        prisma.unmappedDeviceUser.deleteMany({ where: { deviceId: { in: routeDevices } } }),
      );
      await sweep('raw events', () =>
        prisma.rawEvent.deleteMany({ where: { deviceId: { in: routeDevices } } }),
      );
      await sweep('sync state', () =>
        prisma.deviceSyncState.deleteMany({ where: { deviceId: { in: routeDevices } } }),
      );
      await sweep('route devices', () =>
        prisma.device.deleteMany({ where: { id: { in: routeDevices } } }),
      );
    }
    if (routeAgents.length > 0) {
      await sweep('route connectors', () =>
        prisma.deviceAgent.deleteMany({ where: { id: { in: routeAgents } } }),
      );
    }
  });

  const enrolToken = issueEnrolToken();
  const connector = await prisma.deviceAgent.create({
    data: {
      name: `${TAG} connector-route`,
      agentKey: issueAgentKey(),
      enrolTokenHash: enrolToken.tokenHash,
      enrolExpiresAt: enrolToken.expiresAt,
    },
    select: { id: true },
  });
  routeAgents.push(connector.id);

  const enrolled = await server.inject({
    method: 'POST',
    url: '/agent/enrol',
    payload: { token: enrolToken.token, version: '0.1.0', lanHost: '10.255.255.9', lanPort: 8080 },
  });
  const secret = (enrolled.json() as { secret?: string }).secret ?? '';
  check(secret.startsWith('hkag_'), 'the test connector holds a working credential');
  const auth = { authorization: `Bearer ${secret}` };

  const makeRouteDevice = async (name: string, vendor: string, protocol: string) => {
    const row = await prisma.device.create({
      data: {
        name: `${TAG} ${name}`,
        vendor,
        protocol,
        host: `10.255.254.${String(routeDevices.length + 1)}`,
        port: 80,
        serialNumber: `${TAG}-R-${name}`,
        agentId: connector.id,
        active: true,
        status: DeviceStatus.unknown,
      },
      select: { id: true },
    });
    routeDevices.push(row.id);
    return row.id;
  };

  const mute = await makeRouteDevice('zk-bisu', 'zkteco', DeviceProtocol.taPush);
  const polling = await makeRouteDevice('zk-hidup', 'zkteco', DeviceProtocol.taPush);
  const pulled = await makeRouteDevice('hik-ditarik', 'hikvision', DeviceProtocol.isapi);

  /** One device report on the wire, as a connector with no staleness bound composes it. */
  const wireReport = (deviceId: number, lastSeenAt: string | null) => ({
    deviceId,
    status: DeviceStatus.online,
    clockDriftS: 2,
    lastSeenAt,
    lastError: null,
    serialNumber: null,
    firmware: null,
    model: null,
  });

  /** Device 6's own situation: eighteen hours since the one observation there has ever been. */
  const MUTE_FOR_MS = 18 * 3600_000;
  const muteSeenAt = since(MUTE_FOR_MS);

  const beat = async (devices: unknown[]) =>
    server.inject({
      method: 'POST',
      url: '/agent/heartbeat',
      headers: auth,
      payload: { version: '0.1.0', lanHost: '10.255.255.9', lanPort: 8080, spooled: 0, devices },
    });

  const claiming = [
    wireReport(mute, muteSeenAt),
    wireReport(polling, since(10_000)),
    wireReport(pulled, since(45 * 60_000)),
  ];

  const firstBeat = await beat(claiming);
  check(firstBeat.statusCode === 200, 'the heartbeat is accepted', String(firstBeat.statusCode));

  const muteRow = await read(mute);
  check(
    muteRow.status === DeviceStatus.offline,
    'case 2 · a mute callback terminal lands offline even though the connector claimed online',
    muteRow.status,
  );
  check(
    muteRow.lastError !== null && muteRow.lastError.includes('tidak melaporkan apa-apa sejak'),
    'with the staleness prose on the row the operator opens',
    muteRow.lastError?.slice(0, 80) ?? 'null',
  );

  /*
   * The evidence of how long attendance has been missing. Neither `now` — which would say the
   * terminal was heard from seconds ago — nor null, which would erase the question.
   */
  check(
    muteRow.lastSeenAt !== null &&
      Math.abs(muteRow.lastSeenAt.getTime() - Date.parse(muteSeenAt)) < 1500,
    'and the stale instant is stored as reported',
    muteRow.lastSeenAt?.toISOString() ?? 'null',
  );

  const pollingRow = await read(polling);
  check(
    pollingRow.status === DeviceStatus.online && pollingRow.lastError === null,
    'case 1 · one polling normally is left online',
    JSON.stringify(pollingRow),
  );

  const pulledRow = await read(pulled);
  check(
    pulledRow.status === DeviceStatus.online,
    'case 4 · an ISAPI terminal with a 45-minute-old pull is left online',
    pulledRow.status,
  );

  /*
   * The beat repeats every sixty seconds. If each one rewrote `lastErrorAt`, the record of when
   * the silence began would be destroyed — and that is the number somebody needs.
   */
  const stampedAt = muteRow.lastErrorAt;
  const secondBeat = await beat(claiming);
  check(secondBeat.statusCode === 200, 'a second identical heartbeat is accepted');
  const afterSecond = await read(mute);
  check(
    afterSecond.lastErrorAt?.getTime() === stampedAt?.getTime(),
    'and does not move when the silence started',
    `${String(stampedAt?.toISOString())} -> ${String(afterSecond.lastErrorAt?.toISOString())}`,
  );

  /* Recovery, which is the terminal dialling in and nothing else. */
  const recovered = await beat([wireReport(mute, since(5_000))]);
  check(recovered.statusCode === 200, 'the terminal reports in again');
  const recoveredRow = await read(mute);
  check(
    recoveredRow.status === DeviceStatus.online && recoveredRow.lastError === null,
    'and the row goes back to online with the message cleared',
    JSON.stringify(recoveredRow),
  );

  /*
   * Case 5, and it is not a simulation: this payload is literally what a connector sends after a
   * restart. Its observations live in memory, so every terminal is reported `unknown` with no
   * timestamp — and nothing here may read that as death.
   */
  const restarted = await beat([
    { ...wireReport(mute, null), status: DeviceStatus.unknown, clockDriftS: null },
    { ...wireReport(polling, null), status: DeviceStatus.unknown, clockDriftS: null },
    { ...wireReport(pulled, null), status: DeviceStatus.unknown, clockDriftS: null },
  ]);
  check(restarted.statusCode === 200, 'the first heartbeat after a connector restart is accepted');

  const afterRestart = await prisma.device.findMany({
    where: { id: { in: [mute, polling, pulled] } },
    select: { id: true, status: true, lastSeenAt: true },
  });
  check(
    afterRestart.every((row) => row.status !== DeviceStatus.offline),
    'case 5 · a restart marks nothing offline',
    JSON.stringify(afterRestart.map((row) => row.status)),
  );
  check(
    afterRestart.find((row) => row.id === mute)?.status === DeviceStatus.unknown,
    'the callback terminal reads unknown — grey, not green and not a false alarm',
  );
  check(
    afterRestart.find((row) => row.id === mute)?.lastSeenAt !== null,
    'and its last real contact survives the connector forgetting it',
    String(afterRestart.find((row) => row.id === mute)?.lastSeenAt),
  );

  /*
   * Case 3, reached the only way it can be: a terminal that has never dialled in, reported by a
   * connector that has been running long enough to have observed something if there were anything
   * to observe. Indistinguishable from a restart in the report, so it is `unknown` — not green,
   * and with no stored `lastSeenAt` at all.
   */
  const virgin = await makeRouteDevice('zk-tiada', 'zkteco', DeviceProtocol.taPush);
  const neverSeen = await beat([{ ...wireReport(virgin, null), status: DeviceStatus.unknown }]);
  check(neverSeen.statusCode === 200, 'a report for a terminal never heard from is accepted');
  const virginRow = await read(virgin);
  check(
    virginRow.status === DeviceStatus.unknown && virginRow.lastSeenAt === null,
    'case 3 · one that never dialled in reads unknown with an empty SEEN column',
    JSON.stringify(virginRow),
  );

} finally {
  if (app !== null) await app.close();
  for (const step of cleanup) await step().catch(() => undefined);
  await disconnectDb();
}

console.log(failures === 0 ? '\nSemua lulus\n' : `\n${String(failures)} GAGAL\n`);
process.exit(failures === 0 ? 0 : 1);
