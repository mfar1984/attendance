/**
 * Regression suite for noticing a connector that has stopped reporting.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/test-agent-liveness.mts
 *
 * Two halves. The rule — `agentIsSilent` — is pure and gets the bulk of the assertions, because
 * getting it wrong in one direction cries wolf and in the other hides a dead hospital. The sweep
 * itself is then run **once** against the database with real rows, because a Prisma `updateMany`
 * whose `where` names a field the model lacks passes `tsc` and fails at request time.
 *
 * ## What this is defending
 *
 * A connector-served terminal's status is written only by its agent's heartbeat. So when a
 * connector went quiet, nothing wrote anything and the status froze: Hospital Sibu was silent from
 * 21 October to 12 November with its terminal still reading ONLINE and the alert bell quiet,
 * because the bell counts terminals whose status is offline. Twenty-two days of attendance that
 * never existed.
 */

import { randomBytes } from 'node:crypto';

const { db, disconnectDb } = await import('../apps/server/src/db.js');
const { AGENT_SILENCE_MS, agentIsSilent, silenceReason, strandSilentAgentDevices } = await import(
  '../apps/server/src/devices/agent-liveness.js'
);

let failures = 0;
function check(ok: boolean, what: string, detail = ''): void {
  if (ok) {
    console.log(`  [ok]   ${what}`);
  } else {
    failures += 1;
    console.log(`  [FAIL] ${what}${detail === '' ? '' : ` :: ${detail}`}`);
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
console.log('\nThe sweep, against the database');

const TAG = `UJIAN-LIVE-${randomBytes(3).toString('hex')}`;
const prisma = db();
const cleanup: Array<() => Promise<void>> = [];

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
} finally {
  for (const step of cleanup) await step().catch(() => undefined);
  await disconnectDb();
}

console.log(failures === 0 ? '\nSemua lulus\n' : `\n${String(failures)} GAGAL\n`);
process.exit(failures === 0 ? 0 : 1);
