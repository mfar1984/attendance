/**
 * The whole connector loop, against a real server.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/test-agent-e2e.mts
 *
 * Starts the cloud on a loopback port, points a connector at it, and drives the connector's own
 * modules — not a mock of them. Enrolment, heartbeat, roster, spool, forward, and the rows that
 * end up in the database.
 *
 * Why this exists on top of the route tests: those prove the cloud answers correctly when asked
 * correctly. This proves the connector asks correctly, which is the half that a hand-written
 * client gets wrong. The interesting assertions are the ones about what survives failure — a
 * batch held when the cloud is unreachable, and the same batch delivered twice without storing
 * anything twice.
 *
 * Rows are prefixed `ujian-e2e-` and removed at the end.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PunchDirection, RawEventKind, VerifyMethod } from '@attendance/shared';

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
const stateDir = mkdtempSync(join(tmpdir(), 'attendance-agent-ujian-'));

const app = await buildApp();
await app.listen({ host: '127.0.0.1', port: 0 });
const address = app.server.address();
const port = typeof address === 'object' && address !== null ? address.port : 0;
const cloudUrl = `http://127.0.0.1:${String(port)}`;

const agents: number[] = [];
const devices: number[] = [];

try {
  // -------------------------------------------------------------------------
  section('setup');

  const token = issueEnrolToken();
  const agentRow = await db().deviceAgent.create({
    data: {
      name: `ujian-e2e-${String(stamp)}`,
      agentKey: issueAgentKey(),
      enrolTokenHash: token.tokenHash,
      enrolExpiresAt: token.expiresAt,
    },
  });
  agents.push(agentRow.id);

  const device = await db().device.create({
    data: {
      name: `ujian-e2e-peranti-${String(stamp)}`,
      host: '192.168.99.250',
      agentId: agentRow.id,
      username: 'admin',
      passwordEncrypted: encryptSecret('kata-laluan-terminal'),
      serialNumber: `UJIANE2E-${String(stamp)}`,
    },
  });
  devices.push(device.id);

  check('the cloud is listening on a loopback port', port > 0);

  /*
   * The connector reads its configuration from the environment once and caches it, so this has to
   * be set before its modules are imported. That is also true on a real installation, where
   * systemd supplies it.
   */
  process.env['NODE_ENV'] = 'development';
  process.env['CLOUD_URL'] = cloudUrl;
  process.env['STATE_DIR'] = stateDir;
  process.env['INGEST_PASSWORD'] = 'ujian1234';
  process.env['LAN_HOST'] = '192.168.99.10';
  process.env['LISTEN_PORT'] = '18080';
  process.env['LOG_LEVEL'] = 'fatal';
  delete process.env['ENROL_TOKEN'];

  const { loadConfig, assertSecureCloud } = await import('../apps/agent/src/config.js');
  const config = loadConfig();

  let secureRefused = false;
  try {
    assertSecureCloud({ ...config, CLOUD_URL: 'http://attendance.example.com', NODE_ENV: 'production' });
  } catch {
    secureRefused = true;
  }
  check('a plaintext public cloud URL is refused', secureRefused);

  let loopbackAllowed = true;
  try {
    assertSecureCloud(config);
  } catch {
    loopbackAllowed = false;
  }
  check('a loopback cloud is allowed in development', loopbackAllowed);

  // -------------------------------------------------------------------------
  section('enrolment');

  const { Cloud } = await import('../apps/agent/src/cloud.js');
  const cloud = new Cloud(config);
  check('a fresh connector holds no credential', !cloud.enrolled);

  const enrolled = await cloud.enrol(token.token);
  check('enrolment succeeds against the real endpoint', enrolled.ok);
  check('the connector now holds a credential', cloud.enrolled);

  const credentialFile = join(stateDir, 'credential');
  const stored = readFileSync(credentialFile, 'utf8').trim();
  check('the credential is written to disk', stored.startsWith('hkag_'));
  check(
    'the stored credential is the one the cloud issued',
    enrolled.ok && stored === enrolled.value.secret,
  );

  const reEnrol = await cloud.enrol(token.token);
  check('the token cannot be used a second time', !reEnrol.ok);

  // -------------------------------------------------------------------------
  section('heartbeat and roster');

  const { Roster } = await import('../apps/agent/src/roster.js');
  const { SiteState } = await import('../apps/agent/src/state.js');
  const { clockIsTrusted, cloudNow, noteCloudTime, resetClockForTests } = await import(
    '../apps/agent/src/clock.js'
  );

  resetClockForTests();
  check('a connector refuses to write a terminal clock before it has the cloud time', !clockIsTrusted());
  check('and has no time to offer', cloudNow() === null);

  const roster = new Roster();
  const state = new SiteState();

  const beat = await cloud.heartbeat({
    version: '0.1.0',
    lanHost: '192.168.99.10',
    lanPort: 18080,
    spooled: 0,
    devices: [],
  });
  check('a heartbeat is accepted', beat.ok);

  if (!beat.ok) throw new Error('heartbeat failed, the rest depends on it');

  check('the reply carries the cloud clock', noteCloudTime(beat.value.now));
  check('the connector will now set terminal clocks', clockIsTrusted());

  const assignments = beat.value.devices;
  check('the roster holds the assigned terminal', assignments.some((d) => d.deviceId === device.id));
  check(
    'the roster carries the terminal credential, decrypted',
    assignments.find((d) => d.deviceId === device.id)?.password === 'kata-laluan-terminal',
  );

  roster.replace(assignments);
  check('a driver is built for the terminal', roster.get(device.id) !== undefined);
  check('the terminal is reachable by its address', roster.findByAddress('192.168.99.250') !== undefined);
  check(
    'a terminal at another address is not matched',
    roster.findByAddress('10.9.9.9') === undefined,
  );

  const agentAfter = await db().deviceAgent.findUniqueOrThrow({ where: { id: agentRow.id } });
  check('the cloud recorded the LAN address the terminals should use', agentAfter.lanHost === '192.168.99.10');
  check('the cloud recorded the connector version', agentAfter.version === '0.1.0');
  check('the cloud recorded the heartbeat', agentAfter.lastSeenAt !== null);

  // -------------------------------------------------------------------------
  section('spool and forward');

  const { Spool } = await import('../apps/agent/src/spool.js');
  const { Forwarder } = await import('../apps/agent/src/forwarder.js');

  const spool = new Spool(config);
  const forwarder = new Forwarder(config, cloud, spool);

  check('the spool starts empty', spool.count() === 0);

  const eventKey = `isapi:ujian-e2e-${String(stamp)}`;
  const payload = {
    eventKey,
    kind: RawEventKind.identified,
    verifyMethod: VerifyMethod.face,
    at: new Date().toISOString(),
    employeeNo: 'UJIAN-E2E',
    personName: 'Ujian Hujung ke Hujung',
    sequence: 4242,
    direction: PunchDirection.unknown,
    cardNo: null,
    doorNo: 1,
    readerNo: 1,
    pictureUrl: null,
    native: { major: 5, minor: 75, verifyMode: 'face', maskWorn: null, direction: null },
    payload: { asal: 'ujian-e2e' },
  };

  spool.add(device.id, 'pull', payload);
  check('an event is held on disk', spool.count() === 1);

  const held = spool.next(100);
  check('the batch is homogeneous by terminal', held?.deviceId === device.id);
  check('the batch reports how it arrived', held?.arrivedVia === 'pull');

  await forwarder.drain();
  check('the spool is empty after a successful drain', spool.count() === 0);

  const rawRow = await db().rawEvent.findFirst({ where: { deviceId: device.id, eventKey } });
  check('the event reached the database', rawRow !== null);
  check('it is recorded as having arrived by pull', rawRow?.arrivedVia === 'pull');
  check('the sequence survived the round trip', Number(rawRow?.serialNo) === 4242);
  check('the vendor payload survived as evidence', rawRow?.payload !== null);

  /*
   * The property the whole spool design rests on: a lost response must cost a duplicate, never a
   * missing scan. Re-spooling the same event models exactly that.
   */
  spool.add(device.id, 'pull', payload);
  await forwarder.drain();
  const rawCount = await db().rawEvent.count({ where: { deviceId: device.id, eventKey } });
  check('re-delivering the same event stores it once', rawCount === 1);
  check('the spool drained anyway', spool.count() === 0);

  // -------------------------------------------------------------------------
  section('an unreachable cloud holds events rather than losing them');

  const { Cloud: CloudClass } = await import('../apps/agent/src/cloud.js');
  const offlineCloud = new CloudClass({ ...config, CLOUD_URL: 'http://127.0.0.1:1' });
  const offlineForwarder = new Forwarder(config, offlineCloud, spool);

  /*
   * A distinct sequence as well as a distinct key.
   *
   * `(deviceId, serialNo)` is unique in its own right, and a Hikvision serial genuinely is unique
   * per device — so two different events sharing one was test data that could not occur. It was
   * worth the detour: the collision surfaced as a 500, which a connector classifies as retryable,
   * so the batch would have been held forever and stopped the spool draining behind it. That is
   * now caught and counted as a duplicate.
   */
  spool.add(device.id, 'pull', { ...payload, eventKey: `${eventKey}-offline`, sequence: 4243 });
  await offlineForwarder.drain();
  check('the event is still held when the cloud cannot be reached', spool.count() === 1);

  const notStored = await db().rawEvent.count({
    where: { deviceId: device.id, eventKey: `${eventKey}-offline` },
  });
  check('and nothing was written to the database', notStored === 0);

  await forwarder.drain();
  check('it delivers once the cloud is reachable again', spool.count() === 0);
  const recovered = await db().rawEvent.count({
    where: { deviceId: device.id, eventKey: `${eventKey}-offline` },
  });
  check('the held event reached the database after recovery', recovered === 1);

  // -------------------------------------------------------------------------
  section('a refused batch is dropped so the spool keeps draining');

  /*
   * A malformed event will be refused every time it is offered. Holding it would block every
   * event behind it, and the only visible symptom would be a disk filling up while the site went
   * quiet — so it is discarded, loudly.
   */
  spool.add(device.id, 'pull', { ...payload, eventKey: '', sequence: 4244 } as never);
  spool.add(device.id, 'pull', { ...payload, eventKey: `${eventKey}-selepas`, sequence: 4245 });
  check('two events are held', spool.count() === 2);

  await forwarder.drain();
  check('the spool drained past the refused batch', spool.count() === 0);

  const after = await db().rawEvent.count({
    where: { deviceId: device.id, eventKey: `${eventKey}-selepas` },
  });
  check('the event behind the refused one still arrived', after === 1);

  // -------------------------------------------------------------------------
  section('state reporting');

  state.notePush(device.id);
  const onlineReport = state.report(device.id);
  check('a push marks the terminal online', onlineReport.status === 'online');

  state.notePullFailure(device.id, 'connect ETIMEDOUT');
  const failedReport = state.report(device.id);
  check('a newer failure marks it offline', failedReport.status === 'offline');
  check('and carries the reason', failedReport.lastError === 'connect ETIMEDOUT');

  state.notePush(device.id);
  const recoveredReport = state.report(device.id);
  check('a later push clears the failure', recoveredReport.status === 'online');
  check('and the error with it', recoveredReport.lastError === null);

  const unseen = state.report(999_999);
  check('a terminal never observed is unknown, not offline', unseen.status === 'unknown');

  // -------------------------------------------------------------------------
  section('the cloud queues for an agent terminal instead of dialling it');

  const { driverFor, releaseAllClients } = await import('../apps/server/src/devices/registry.js');
  const { AgentProxyDriver } = await import('../apps/server/src/devices/drivers/agent-proxy.js');
  const { DriverOperation, supports, unavailableReason } = await import(
    '@attendance/terminal-drivers'
  );

  const agentDeviceRow = await db().device.findUniqueOrThrow({ where: { id: device.id } });
  const proxy = driverFor(agentDeviceRow);

  check('an agent terminal gets the proxy driver', proxy instanceof AgentProxyDriver);
  check('writes are declared queued rather than inline', proxy.capabilities.writeModel === 'queued');
  check(
    'the terminal is declared device-initiated',
    proxy.capabilities.reachability === 'deviceInitiated',
  );
  check(
    'the reconcile worker is told not to pull it',
    !supports(proxy.capabilities, DriverOperation.pullEvents),
  );
  check(
    'opening a door is refused with a reason a screen can show',
    (unavailableReason(proxy.capabilities, DriverOperation.openDoor) ?? '').includes('connector'),
  );

  let readRefused = false;
  try {
    await proxy.identity.read();
  } catch {
    readRefused = true;
  }
  check('a live read is refused rather than blocking', readRefused);

  /*
   * The operation the whole command path exists for. Before the proxy this threw a network error,
   * because the cloud tried to open a socket to a private address — and the screen reported it as
   * a device fault.
   */
  const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
  const ack = await proxy.biometrics.enrolFace('UJIAN-E2E', jpeg);
  check('enrolling a face is accepted', ack.confirmed === false);
  check('and returns the queue row it was recorded as', !ack.confirmed && ack.commandId.length > 0);

  const queued = await db().deviceCommand.findFirstOrThrow({
    where: { deviceId: device.id, kind: 'face.enroll' },
  });
  check('the command is queued against this terminal', queued.deviceId === device.id);
  check('it is keyed on the person so a newer photo supersedes it', queued.subject === 'UJIAN-E2E');
  check('it starts pending', queued.status === 'pending');

  const queuedArgs = JSON.parse(queued.payload) as { employeeNo: string; jpegBase64: string };
  check('the payload names the person', queuedArgs.employeeNo === 'UJIAN-E2E');
  check(
    'the photograph survived the round trip',
    Buffer.from(queuedArgs.jpegBase64, 'base64').equals(jpeg),
  );

  await proxy.biometrics.enrolFace('UJIAN-E2E', jpeg);
  const stillOne = await db().deviceCommand.count({
    where: { deviceId: device.id, kind: 'face.enroll', status: 'pending' },
  });
  check('a second upload supersedes rather than queues twice', stillOne === 1);

  // -------------------------------------------------------------------------
  section('the connector collects the command');

  const { Executor } = await import('../apps/agent/src/executor.js');
  const executor = new Executor(cloud, roster);

  /*
   * Pointed at a closed loopback port so the attempt fails immediately with a connection refused
   * rather than waiting out a fifteen-second timeout against an address nobody answers.
   */
  await db().device.update({
    where: { id: device.id },
    data: { host: '127.0.0.1', port: 9, useHttps: false },
  });
  const refreshed = await cloud.heartbeat({
    version: '0.1.0',
    lanHost: '192.168.99.10',
    lanPort: 18080,
    spooled: 0,
    devices: [],
  });
  if (refreshed.ok) roster.replace(refreshed.value.devices);

  await executor.runOnce();

  /*
   * The subtle half of this design. A terminal that did not answer is almost always one being
   * restarted, so the command must be left unacknowledged for the cloud's sweep to offer again —
   * acknowledging it as failed would discard an enrolment over a momentary blip.
   */
  check('an unreachable terminal defers the command', executor.stats.deferred >= 1);
  check('and nothing is counted as failed', executor.stats.failed === 0);

  /*
   * Looked up by state rather than by the id captured earlier.
   *
   * The second upload superseded the first, so `queued` is now `failed` carrying "replaced by a
   * newer command" — which is correct, and is exactly the row an assertion on the original id
   * would have caught by mistake.
   */
  const superseded = await db().deviceCommand.findUniqueOrThrow({ where: { id: queued.id } });
  check('the superseded upload is marked failed', superseded.status === 'failed');
  check(
    'and says it was replaced rather than that it broke',
    (superseded.result ?? '').includes('Digantikan'),
  );

  const deferred = await db().deviceCommand.findFirstOrThrow({
    where: { deviceId: device.id, kind: 'face.enroll', status: 'sent' },
  });
  check(
    'the collected command stays sent so the stale sweep can re-offer it',
    deferred.completedAt === null,
  );
  check('it counted one attempt', deferred.attempts === 1);

  // -------------------------------------------------------------------------
  section('a command this build cannot run is failed, not retried forever');

  const unknown = await db().deviceCommand.create({
    data: {
      deviceId: device.id,
      kind: 'option.set',
      payload: JSON.stringify({ apa: 'pun' }),
    },
  });

  await executor.runOnce();

  const afterUnknown = await db().deviceCommand.findUniqueOrThrow({ where: { id: unknown.id } });
  check('an unrecognised command is marked failed', afterUnknown.status === 'failed');
  check(
    'and the reason tells the operator to update the connector',
    (afterUnknown.result ?? '').includes('Kemas kini connector'),
  );

  const malformed = await db().deviceCommand.create({
    data: {
      deviceId: device.id,
      kind: 'face.remove',
      subject: 'X',
      payload: 'bukan json',
    },
  });
  await executor.runOnce();
  const afterMalformed = await db().deviceCommand.findUniqueOrThrow({ where: { id: malformed.id } });
  check('a payload that will not parse is failed', afterMalformed.status === 'failed');

  await releaseAllClients();

  spool.close();
  await roster.closeAll();
} finally {
  await app.close();

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
    await sweep('commands', () => prisma.deviceCommand.deleteMany({ where: { deviceId: { in: devices } } }));
    await sweep('exceptions', () => prisma.attendanceException.deleteMany({ where: { deviceId: { in: devices } } }));
    await sweep('unmapped', () => prisma.unmappedDeviceUser.deleteMany({ where: { deviceId: { in: devices } } }));
    await sweep('raw events', () => prisma.rawEvent.deleteMany({ where: { deviceId: { in: devices } } }));
    await sweep('sync state', () => prisma.deviceSyncState.deleteMany({ where: { deviceId: { in: devices } } }));
    await sweep('devices', () => prisma.device.deleteMany({ where: { id: { in: devices } } }));
  }
  if (agents.length > 0) {
    await sweep('agents', () => prisma.deviceAgent.deleteMany({ where: { id: { in: agents } } }));
  }
  await disconnectDb();

  rmSync(stateDir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nSemua lulus' : `\n${String(failures)} semakan GAGAL`);
process.exit(failures === 0 ? 0 : 1);
