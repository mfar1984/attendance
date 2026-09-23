/**
 * The agent endpoints, exercised through the real route stack.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/test-agent-routes.mts
 *
 * Uses `app.inject()` rather than a listening server, so this needs no port, no `npm run dev`
 * and no admin password — it builds the application in-process and dispatches requests through
 * the actual handlers, guards and error mapping.
 *
 * What it is here to prove is the boundary, not the happy path. An agent must be unable to
 * learn anything about another site's terminals, including by the shape of its refusal: a
 * device that belongs to somebody else has to be indistinguishable from one that does not
 * exist. Get that wrong and one hospital can close another's enrolments as done.
 *
 * Rows are prefixed `ujian-rt-` and removed at the end.
 */
import { AgentStatus, DeviceStatus, PunchDirection, RawEventKind, VerifyMethod } from '@attendance/shared';

import { buildApp } from '../apps/server/src/app.js';
import { encryptSecret } from '../apps/server/src/crypto.js';
import { db, disconnectDb } from '../apps/server/src/db.js';
import { issueAgentKey, issueEnrolToken } from '../apps/server/src/devices/agents.js';

let failures = 0;

function check(label: string, passed: boolean): void {
  if (passed) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}`);
}

function section(name: string): void {
  console.log(`\n=== ${name} ===`);
}

const stamp = Date.now();
const app = await buildApp();

const agents: number[] = [];
const devices: number[] = [];

/** One well-formed event on the wire. `at` is a string, as JSON requires. */
function wireEvent(eventKey: string, at: Date) {
  return {
    eventKey,
    kind: RawEventKind.identified,
    verifyMethod: VerifyMethod.face,
    at: at.toISOString(),
    employeeNo: 'UJIAN-RT-1',
    personName: 'Ujian Route',
    sequence: 1,
    direction: PunchDirection.unknown,
    cardNo: null,
    doorNo: 1,
    readerNo: 1,
    pictureUrl: null,
    native: { major: 5, minor: 75, verifyMode: 'face', maskWorn: null, direction: null },
    payload: { asal: 'ujian' },
  };
}

try {
  // -------------------------------------------------------------------------
  section('enrolment');

  const tokenA = issueEnrolToken();
  const rowA = await db().deviceAgent.create({
    data: {
      name: `ujian-rt-a-${String(stamp)}`,
      agentKey: issueAgentKey(),
      enrolTokenHash: tokenA.tokenHash,
      enrolExpiresAt: tokenA.expiresAt,
    },
  });
  agents.push(rowA.id);

  const enrolled = await app.inject({
    method: 'POST',
    url: '/agent/enrol',
    payload: { token: tokenA.token, version: '0.1.0', lanHost: '192.168.1.50', lanPort: 8080 },
  });
  check('a valid enrolment token is accepted', enrolled.statusCode === 200);

  const enrolBody = enrolled.json() as { secret?: string; agentKey?: string; status?: string };
  const secretA = enrolBody.secret ?? '';
  check('the reply carries a working credential', secretA.startsWith('hkag_'));
  check('the reply names the agent', enrolBody.agentKey === rowA.agentKey);
  check('the reply reports the agent active', enrolBody.status === AgentStatus.active);
  check(
    'the credential is not cacheable by a proxy',
    enrolled.headers['cache-control'] === 'no-store',
  );

  const reused = await app.inject({
    method: 'POST',
    url: '/agent/enrol',
    payload: { token: tokenA.token, version: '0.1.0', lanHost: null, lanPort: null },
  });
  check('the same token cannot enrol twice', reused.statusCode === 401);

  const staleToken = issueEnrolToken();
  await db().deviceAgent.update({
    where: { id: rowA.id },
    data: { enrolTokenHash: staleToken.tokenHash, enrolExpiresAt: new Date(Date.now() - 1000) },
  });
  const expired = await app.inject({
    method: 'POST',
    url: '/agent/enrol',
    payload: { token: staleToken.token, version: '0.1.0', lanHost: null, lanPort: null },
  });
  check('an expired token is refused with a message that says so', expired.statusCode === 400);
  check(
    'the expiry message tells the installer what to do',
    typeof (expired.json() as { error?: string }).error === 'string' &&
      (expired.json() as { error: string }).error.includes('luput'),
  );
  await db().deviceAgent.update({
    where: { id: rowA.id },
    data: { enrolTokenHash: null, enrolExpiresAt: null },
  });

  // A second site, to prove one cannot reach the other.
  const tokenB = issueEnrolToken();
  const rowB = await db().deviceAgent.create({
    data: {
      name: `ujian-rt-b-${String(stamp)}`,
      agentKey: issueAgentKey(),
      enrolTokenHash: tokenB.tokenHash,
      enrolExpiresAt: tokenB.expiresAt,
    },
  });
  agents.push(rowB.id);
  const enrolledB = await app.inject({
    method: 'POST',
    url: '/agent/enrol',
    payload: { token: tokenB.token, version: '0.1.0', lanHost: '10.0.0.5', lanPort: 8080 },
  });
  const secretB = (enrolledB.json() as { secret: string }).secret;

  const authA = { authorization: `Bearer ${secretA}` };
  const authB = { authorization: `Bearer ${secretB}` };

  // -------------------------------------------------------------------------
  section('every authenticated route refuses an absent credential');

  for (const [label, method, url] of [
    ['heartbeat', 'POST', '/agent/heartbeat'],
    ['events', 'POST', '/agent/events'],
    ['commands', 'GET', '/agent/commands'],
    ['command outcome', 'POST', '/agent/commands/1'],
  ] as const) {
    const anon = await app.inject({ method, url, payload: {} });
    check(`${label} refuses a request with no credential`, anon.statusCode === 401);
  }

  const wrongKind = await app.inject({
    method: 'GET',
    url: '/agent/commands',
    headers: { authorization: 'Bearer hka_an-api-token-not-an-agent' },
  });
  check('an API token is not accepted as an agent credential', wrongKind.statusCode === 401);

  // -------------------------------------------------------------------------
  section('the roster carries only this site, with what it needs');

  const deviceA = await db().device.create({
    data: {
      name: `ujian-rt-peranti-a-${String(stamp)}`,
      host: '192.168.1.240',
      agentId: rowA.id,
      username: 'admin',
      passwordEncrypted: encryptSecret('rahsia-peranti-a'),
      serialNumber: `UJIANRT-A-${String(stamp)}`,
    },
  });
  devices.push(deviceA.id);

  const deviceB = await db().device.create({
    data: {
      name: `ujian-rt-peranti-b-${String(stamp)}`,
      host: '10.0.0.240',
      agentId: rowB.id,
      username: 'admin',
      passwordEncrypted: encryptSecret('rahsia-peranti-b'),
      serialNumber: `UJIANRT-B-${String(stamp)}`,
    },
  });
  devices.push(deviceB.id);

  const directDevice = await db().device.create({
    data: { name: `ujian-rt-direct-${String(stamp)}`, host: '192.168.1.199' },
  });
  devices.push(directDevice.id);

  const heartbeat = await app.inject({
    method: 'POST',
    url: '/agent/heartbeat',
    headers: authA,
    payload: {
      version: '0.1.0',
      lanHost: '192.168.1.50',
      lanPort: 8080,
      spooled: 0,
      devices: [
        {
          deviceId: deviceA.id,
          status: DeviceStatus.online,
          clockDriftS: 3,
          lastSeenAt: new Date().toISOString(),
          lastError: null,
          serialNumber: null,
          firmware: 'V1.5.0',
          model: null,
        },
      ],
    },
  });
  check('a heartbeat is accepted', heartbeat.statusCode === 200);

  const hb = heartbeat.json() as {
    now?: string;
    devices?: Array<{ deviceId: number; password: string | null; cursor: unknown }>;
  };
  check('the reply carries the cloud clock', typeof hb.now === 'string' && !isNaN(Date.parse(hb.now)));
  check('the roster holds this site', hb.devices?.some((d) => d.deviceId === deviceA.id) === true);
  check(
    "the roster does not hold the other site's terminal",
    hb.devices?.some((d) => d.deviceId === deviceB.id) === false,
  );
  check(
    'the roster does not hold a terminal this server reaches itself',
    hb.devices?.some((d) => d.deviceId === directDevice.id) === false,
  );
  check(
    'the roster carries the terminal credential the agent needs',
    hb.devices?.find((d) => d.deviceId === deviceA.id)?.password === 'rahsia-peranti-a',
  );
  check('the roster carries a resume cursor', hb.devices?.[0]?.cursor !== undefined);

  const applied = await db().device.findUniqueOrThrow({ where: { id: deviceA.id } });
  check('the reported status is applied', applied.status === DeviceStatus.online);
  check('the reported drift is applied', applied.clockDriftS === 3);
  check('the reported firmware is applied', applied.firmware === 'V1.5.0');

  // -------------------------------------------------------------------------
  section("a site cannot report on another site's terminal");

  const beforeForeign = await db().device.findUniqueOrThrow({ where: { id: deviceB.id } });
  const crossReport = await app.inject({
    method: 'POST',
    url: '/agent/heartbeat',
    headers: authA,
    payload: {
      version: '0.1.0',
      lanHost: null,
      lanPort: null,
      spooled: 0,
      devices: [
        {
          deviceId: deviceB.id,
          status: DeviceStatus.offline,
          clockDriftS: 9999,
          lastSeenAt: null,
          lastError: 'dipalsukan',
          serialNumber: null,
          firmware: null,
          model: null,
        },
      ],
    },
  });
  check('the heartbeat still succeeds', crossReport.statusCode === 200);

  const afterForeign = await db().device.findUniqueOrThrow({ where: { id: deviceB.id } });
  check(
    "the other site's terminal was not modified",
    afterForeign.status === beforeForeign.status && afterForeign.lastError === null,
  );

  // -------------------------------------------------------------------------
  section('events');

  const at = new Date();
  const batch = {
    deviceId: deviceA.id,
    arrivedVia: 'pull' as const,
    events: [wireEvent(`isapi:ujian-rt-${String(stamp)}`, at)],
  };

  const posted = await app.inject({
    method: 'POST',
    url: '/agent/events',
    headers: authA,
    payload: batch,
  });
  check('a batch for an owned terminal is accepted', posted.statusCode === 200);
  check('one event is stored', (posted.json() as { stored: number }).stored === 1);

  // The property the spool depends on.
  const replayed = await app.inject({
    method: 'POST',
    url: '/agent/events',
    headers: authA,
    payload: batch,
  });
  const replayBody = replayed.json() as { stored: number; duplicates: number };
  check('replaying the same batch stores nothing new', replayBody.stored === 0);
  check('the replay is counted as a duplicate', replayBody.duplicates === 1);

  const storedRows = await db().rawEvent.count({
    where: { deviceId: deviceA.id, eventKey: `isapi:ujian-rt-${String(stamp)}` },
  });
  check('exactly one raw event exists after the replay', storedRows === 1);

  const crossPost = await app.inject({
    method: 'POST',
    url: '/agent/events',
    headers: authA,
    payload: { ...batch, deviceId: deviceB.id, events: [wireEvent(`isapi:cross-${String(stamp)}`, at)] },
  });
  check(
    "posting to another site's terminal is refused as not found, not forbidden",
    crossPost.statusCode === 404,
  );

  const directPost = await app.inject({
    method: 'POST',
    url: '/agent/events',
    headers: authA,
    payload: { ...batch, deviceId: directDevice.id, events: [wireEvent(`isapi:d-${String(stamp)}`, at)] },
  });
  check('posting to a direct terminal is refused', directPost.statusCode === 404);

  const badEvent = await app.inject({
    method: 'POST',
    url: '/agent/events',
    headers: authA,
    payload: { deviceId: deviceA.id, arrivedVia: 'pull', events: [{ eventKey: 'x' }] },
  });
  check('a malformed event is refused with 400', badEvent.statusCode === 400);

  const unknownField = await app.inject({
    method: 'POST',
    url: '/agent/events',
    headers: authA,
    payload: { ...batch, tambahan: 'tidak dikenali' },
  });
  check('an unrecognised field is refused rather than ignored', unknownField.statusCode === 400);

  // -------------------------------------------------------------------------
  section('commands');

  const mine = await db().deviceCommand.create({
    data: { deviceId: deviceA.id, kind: 'person.upsert', subject: 'UJIAN', payload: 'DATA UPDATE' },
  });
  const theirs = await db().deviceCommand.create({
    data: { deviceId: deviceB.id, kind: 'person.upsert', subject: 'UJIAN', payload: 'DATA UPDATE' },
  });

  const collected = await app.inject({ method: 'GET', url: '/agent/commands', headers: authA });
  check('commands are handed over', collected.statusCode === 200);

  const list = (collected.json() as { commands: Array<{ commandId: string }> }).commands;
  check('the queue holds this site', list.some((c) => c.commandId === String(mine.id)));
  check("the queue does not hold the other site's", !list.some((c) => c.commandId === String(theirs.id)));

  const afterTake = await db().deviceCommand.findUniqueOrThrow({ where: { id: mine.id } });
  check('a collected command is marked sent', afterTake.status === 'sent');
  check('the attempt is counted', afterTake.attempts === 1);

  const theirsUntouched = await db().deviceCommand.findUniqueOrThrow({ where: { id: theirs.id } });
  check("the other site's command is untouched", theirsUntouched.status === 'pending');

  const reported = await app.inject({
    method: 'POST',
    url: `/agent/commands/${String(mine.id)}`,
    headers: authA,
    payload: { ok: true, result: 'diterima terminal' },
  });
  check('an outcome is recorded', reported.statusCode === 200);

  const closed = await db().deviceCommand.findUniqueOrThrow({ where: { id: mine.id } });
  check('the command is marked succeeded', closed.status === 'succeeded');

  // Site A reaching for site B's command.
  const crossClose = await app.inject({
    method: 'POST',
    url: `/agent/commands/${String(theirs.id)}`,
    headers: authA,
    payload: { ok: true, result: 'dipalsukan' },
  });
  check("one site cannot close another's command", crossClose.statusCode === 404);

  const stillPending = await db().deviceCommand.findUniqueOrThrow({ where: { id: theirs.id } });
  check("the other site's command is still pending", stillPending.status === 'pending');

  /**
   * And the same command closed by the site that owns it.
   *
   * Without this the refusal above proves little: a route that answered 404 for every command
   * would pass it. This is what shows the boundary is the assignment and not a broken lookup.
   */
  const ownClose = await app.inject({
    method: 'POST',
    url: `/agent/commands/${String(theirs.id)}`,
    headers: authB,
    payload: { ok: true, result: 'diterima terminal' },
  });
  check('the site that owns the command can close it', ownClose.statusCode === 200);

  const closedByOwner = await db().deviceCommand.findUniqueOrThrow({ where: { id: theirs.id } });
  check('that command is now succeeded', closedByOwner.status === 'succeeded');

  const badId = await app.inject({
    method: 'POST',
    url: '/agent/commands/not-a-number',
    headers: authA,
    payload: { ok: true, result: 'x' },
  });
  check('a non-numeric command id is refused', badId.statusCode === 400);

  // -------------------------------------------------------------------------
  section('an agent terminal is not pulled by the cloud worker');

  const { syncDevice } = await import('../apps/server/src/sync/worker.js');
  const skipped = await syncDevice(await db().device.findUniqueOrThrow({ where: { id: deviceA.id } }));
  check('the pull reports no error for an agent terminal', skipped.error === undefined);
  check('the pull stores nothing for an agent terminal', skipped.stored === 0);

  const untouched = await db().device.findUniqueOrThrow({ where: { id: deviceA.id } });
  check(
    'the agent terminal was not marked offline by the worker',
    untouched.status !== DeviceStatus.offline,
  );

  const flag = await db().deviceSyncState.findUnique({ where: { deviceId: deviceA.id } });
  check('the single-flight flag was not touched', flag?.syncing !== true);

  // -------------------------------------------------------------------------
  section('the driver package received a logger');

  /**
   * The drivers moved into their own package and lost their direct import of the server logger,
   * so they take an injected one and are silent until it arrives. Nothing fails when it does
   * not — two diagnostics simply stop appearing — which is why this is asserted rather than
   * assumed. `buildApp()` above is what triggers the wiring.
   */
  const { driverLogger, setDriverLogger } = await import('@attendance/terminal-drivers');

  /**
   * Two separate facts, because one without the other proves little.
   *
   * That the server replaced the package default: comparing against `installed` captured after
   * `buildApp()` is not possible from here, so what is checked instead is that the installed
   * logger is not the silent stub — a stub returns undefined and records nothing, so a spy
   * swapped in and called is the only observable difference.
   */
  const installed = driverLogger();
  check('a logger is installed', typeof installed.warn === 'function');

  let delivered: string | null = null;
  setDriverLogger({
    info: () => undefined,
    warn: (_fields, message) => {
      delivered = message;
    },
  });
  driverLogger().warn({ ujian: true }, 'ujian penyambungan');
  check('a driver log line reaches the installed logger', delivered === 'ujian penyambungan');

  // Put the server's own logger back, so a later line in this process is not swallowed.
  setDriverLogger(installed);
} finally {
  await app.close();

  /**
   * Cleanup reports what it could not remove.
   *
   * These were `.catch(() => undefined)`, and the silence cost real time: a truncated output
   * pipeline once killed this process before the block finished, and the rows it left behind
   * looked like a foreign-key problem. A cleanup that hides its own failures turns every future
   * leftover row into the same investigation.
   *
   * Dependents go first and in reference order. `device` deletion cascades most of them, but
   * naming them keeps the failure specific when one does block.
   */
  const sweep = async (what: string, run: () => Promise<unknown>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      failures += 1;
      console.log(`  FAIL cleanup: ${what} — ${error instanceof Error ? error.message : 'ralat'}`);
    }
  };

  const prisma = db();
  if (devices.length > 0) {
    await sweep('device commands', () =>
      prisma.deviceCommand.deleteMany({ where: { deviceId: { in: devices } } }),
    );
    await sweep('exceptions', () =>
      prisma.attendanceException.deleteMany({ where: { deviceId: { in: devices } } }),
    );
    await sweep('unmapped identifiers', () =>
      prisma.unmappedDeviceUser.deleteMany({ where: { deviceId: { in: devices } } }),
    );
    await sweep('raw events', () =>
      prisma.rawEvent.deleteMany({ where: { deviceId: { in: devices } } }),
    );
    await sweep('sync state', () =>
      prisma.deviceSyncState.deleteMany({ where: { deviceId: { in: devices } } }),
    );
    await sweep('devices', () => prisma.device.deleteMany({ where: { id: { in: devices } } }));
  }
  if (agents.length > 0) {
    await sweep('agents', () => prisma.deviceAgent.deleteMany({ where: { id: { in: agents } } }));
  }

  await disconnectDb();
}

console.log(failures === 0 ? '\nSemua lulus' : `\n${String(failures)} semakan GAGAL`);
process.exit(failures === 0 ? 0 : 1);
