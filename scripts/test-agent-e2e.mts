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

  /*
   * Liveness must advance on every beat, and a moved DHCP lease must still be recorded.
   *
   * These two guard a change that is invisible from the response. The heartbeat route used to
   * write `lastSeenAt` itself while `verifyAgentSecret` wrote it again unawaited, so two UPDATEs
   * raced for this row on every beat and the detached one could land last. The route now writes
   * only fields that actually changed — nothing at all on a normal beat — which puts the whole
   * weight of agent liveness on the stamp in `verifyAgentSecret`. If that stamp is ever detached
   * again, or the conditional update stops noticing a change, one of these fails.
   */
  await new Promise((resolve) => setTimeout(resolve, 1100));

  const moved = await cloud.heartbeat({
    version: '0.1.1',
    lanHost: '192.168.99.11',
    lanPort: 18081,
    spooled: 0,
    devices: [],
  });
  check('a second heartbeat is accepted', moved.ok);

  const agentMoved = await db().deviceAgent.findUniqueOrThrow({ where: { id: agentRow.id } });
  check(
    'liveness advances on every beat, not only the first',
    agentMoved.lastSeenAt !== null &&
      agentAfter.lastSeenAt !== null &&
      agentMoved.lastSeenAt.getTime() > agentAfter.lastSeenAt.getTime(),
  );
  check('a moved LAN address is recorded', agentMoved.lanHost === '192.168.99.11');
  check('a moved listener port is recorded', agentMoved.lanPort === 18081);
  check('an upgraded connector build is recorded', agentMoved.version === '0.1.1');

  // -------------------------------------------------------------------------
  /*
   * A terminal whose stored password cannot be decrypted must not take the site down.
   *
   * This is a regression, and it reached production. `rosterFor` decrypted inside a `.map()`, so
   * one device saved under a different `ENCRYPTION_KEY` — a database copied between installations
   * — threw on every heartbeat and answered 500. The site lost its liveness stamp, the roster for
   * every *other* terminal, and the cloud clock the connector refuses to set terminal time
   * without: one misconfigured row read as a completely dead site, and the response named
   * neither the device nor the reason.
   */
  section('an unreadable terminal credential is contained');

  const unreadable = await db().device.create({
    data: {
      name: `ujian-e2e-rosak-${String(stamp)}`,
      host: '192.168.99.251',
      agentId: agentRow.id,
      username: 'admin',
      // Well-formed `v1:` envelope, valid base64url, wrong key material.
      passwordEncrypted: 'v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB:CCCCCCCC',
    },
  });
  devices.push(unreadable.id);

  const degraded = await cloud.heartbeat({
    version: '0.1.0',
    lanHost: '192.168.99.10',
    lanPort: 18080,
    spooled: 0,
    devices: [],
  });
  check('the heartbeat still succeeds', degraded.ok);

  if (degraded.ok) {
    const served = degraded.value.devices.map((entry) => entry.deviceId);
    check('the terminal with an unreadable password is withheld', !served.includes(unreadable.id));
    check('the healthy terminal at the same site is still served', served.includes(device.id));
    check(
      'and still carries its real credential',
      degraded.value.devices.find((entry) => entry.deviceId === device.id)?.password ===
        'kata-laluan-terminal',
    );
    check('the cloud clock is still returned', noteCloudTime(degraded.value.now));
  }

  const withheld = await db().device.findUniqueOrThrow({ where: { id: unreadable.id } });
  check(
    'the devices screen is told what to do about it',
    (withheld.lastError ?? '').includes('ENCRYPTION_KEY') && withheld.lastErrorAt !== null,
  );
  check('the withheld terminal is marked offline', withheld.status === 'offline');

  const healthy = await db().device.findUniqueOrThrow({ where: { id: device.id } });
  check('the healthy terminal is not marked with an error', healthy.lastError === null);

  // Removed again so the sections that follow drive the roster they expect.
  await db().device.delete({ where: { id: unreadable.id } });

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

  // -------------------------------------------------------------------------
  /*
   * The settings the device editor shows for a connector site.
   *
   * The cloud cannot read a terminal behind a connector — a browser request cannot wait for the
   * next poll — so the connector reads on its own timer and reports. Without it every settings tab
   * renders empty, and an operator who opens one learns nothing about the unit in front of them.
   *
   * The terminal in this suite is not reachable, which makes this the case worth driving: every
   * read fails, and the sweep still has to produce reported conditions rather than throwing. One
   * unreadable document must not cost the others, because abandoning the pass would leave the tabs
   * empty — reproducing one level up the exact failure this path removes.
   */
  section('terminal settings reach the cloud even when the reads fail');

  const { Snapshotter } = await import('../apps/agent/src/snapshots.js');
  const snapshotter = new Snapshotter(cloud, roster);

  await snapshotter.runOnce();
  check('the sweep completes rather than throwing', snapshotter.stats.sweeps === 1);
  check('and something was reported', snapshotter.stats.reported > 0);

  const snapshotRows = await db().deviceSnapshot.findMany({ where: { deviceId: device.id } });
  check('the cloud stored what arrived', snapshotRows.length > 0);

  const refused = snapshotRows.filter((row) => row.error !== null);
  check('an unreachable terminal is recorded as a reason, not as silence', refused.length > 0);
  check(
    'and no payload is invented for a read that never answered',
    refused.every((row) => row.payload === null && row.readAt === null),
  );

  /*
   * Diagnostics succeeds even here, and that is the contract rather than an accident.
   *
   * `vendorWarnings` must not throw for a diagnostic that is merely unavailable — an empty list is
   * the honest answer, because the absence of a vendor-shaped fault is itself a finding. So this
   * one carries a payload while the network reads carry reasons, and an assertion that every row
   * must hold an error would be wrong about the design rather than about the code. It was, once.
   */
  const diagnostics = snapshotRows.find((row) => row.kind === 'diagnostics');
  check('diagnostics still reports, because an empty warning list is an answer', diagnostics?.error === null);
  check('and it carries the capability document the screen explains itself with',
    (diagnostics?.payload ?? '').includes('capabilities'));

  /*
   * A later success has to replace the error, and the last good values have to survive a later
   * failure. Driven here through the real endpoint rather than the storage function, because the
   * wire schema is the part that could reject a driver-contract shape.
   */
  const reported = await cloud.snapshots({
    deviceId: device.id,
    snapshots: [
      {
        kind: 'door',
        payload: { door: { openDuration: 5 }, reader: null, options: {} },
        readAt: new Date(),
        error: null,
      },
    ],
  });
  check('a successful read is accepted by the endpoint', reported.ok);

  const doorRow = await db().deviceSnapshot.findUniqueOrThrow({
    where: { deviceId_kind: { deviceId: device.id, kind: 'door' } },
  });
  check('the driver shape survived the wire', (doorRow.payload ?? '').includes('openDuration'));
  check('and the earlier error is cleared, because the condition is over', doorRow.error === null);

  // -------------------------------------------------------------------------
  /*
   * The point of the whole exercise: a read on an agent terminal now answers.
   *
   * Earlier in this suite the same call was refused, because nothing had been reported yet — and
   * that refusal is correct, it says to wait rather than pretending. What must not happen is the
   * refusal surviving a report, which is what left the editor showing six empty tabs for a site
   * that was working perfectly.
   */
  section('a read on an agent terminal answers once the connector has reported');

  const reporting = driverFor(await db().device.findUniqueOrThrow({ where: { id: device.id } }));

  const readDoor = await reporting.access.door(1);
  check('the stored door settings come back', readDoor !== null);
  check(
    'and they are the values the connector reported, not invented ones',
    (readDoor as { openDuration?: number } | null)?.openDuration === 5,
  );

  const readOptions = await reporting.access.options();
  check('an absent option list is empty rather than a refusal', typeof readOptions === 'object');

  /*
   * A read the terminal refused carries the connector's own reason, not a generic one.
   *
   * The clock was reported in the sweep above — as a failure, because this terminal is not
   * reachable. So the refusal here is not "the connector has not said yet", it is "the connector
   * tried and the terminal would not answer", and the difference decides what somebody does next:
   * wait, or go and look at the unit.
   *
   * Written the other way round first, asserting the not-yet-reported wording. That was wrong:
   * every kind had been reported, some of them as errors. The distinction is what the value is,
   * not whether a row exists.
   */
  let clockReason = '';
  try {
    await reporting.clock.read();
  } catch (error) {
    clockReason = error instanceof Error ? error.message : '';
  }
  check('a read the terminal refused is still refused here', clockReason !== '');
  check(
    "and it carries the connector's own reason rather than a generic one",
    clockReason.includes('tidak dapat membaca') && !clockReason.includes('belum melaporkan'),
  );

  // -------------------------------------------------------------------------
  /*
   * Settings writes, and the three that stay refused.
   *
   * These were all refused until the connector could report what a terminal currently holds — a
   * write with no read is a form somebody saves blind, choosing a verification mode without
   * knowing the present one. Now that reads answer, the write has something to be a change *to*.
   *
   * The three still refused are refused at the point of queueing, because queueing would break
   * each rather than fix it. Asserted here so that "we could queue this too" does not quietly
   * become true later.
   */
  section('settings writes are queued, and three stay refused');

  const writable = driverFor(await db().device.findUniqueOrThrow({ where: { id: device.id } }));

  const ntpAck = await writable.clock.configureNtp({ host: '192.168.99.1', timeZone: 'CST-8:00:00' });
  check('an NTP host is queued rather than refused', ntpAck.confirmed === false);

  const doorAck = await writable.access.setDoor(1, { openDuration: 7 });
  check('door settings are queued', doorAck.confirmed === false);

  const modeAck = await writable.attendance.setMode('manual');
  check('an attendance mode is queued', modeAck.confirmed === false);

  const clearAck = await writable.lifecycle.clearCallback(2);
  check('clearing a push slot is queued, because it needs only the slot number', clearAck.confirmed === false);

  const refuse = async (run: () => Promise<unknown>): Promise<string> => {
    try {
      await run();
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : '';
    }
  };

  const manualClock = await refuse(() => writable.clock.setManually(new Date(), 'CST-8:00:00'));
  check('setting the clock by hand is still refused', manualClock !== '');
  const openDoor = await refuse(() => writable.access.open(1));
  check('releasing the door is still refused', openDoor !== '');
  const setPush = await refuse(() =>
    writable.lifecycle.configureCallback({
      host: '1.2.3.4',
      port: 8080,
      path: '/hik/events',
      slot: 1,
    }),
  );
  check('setting a push target is still refused', setPush !== '');

  /*
   * The queued work is then collectable and runnable. The terminal is unreachable in this suite,
   * so each is deferred rather than reported — which is the correct outcome and proves the
   * executor recognises the kinds rather than failing them as unknown.
   */
  const queuedKinds = await db().deviceCommand.findMany({
    where: { deviceId: device.id, status: 'pending' },
    select: { kind: true },
  });
  const kinds = new Set(queuedKinds.map((row) => row.kind));
  check('all four writes are waiting in the queue', kinds.size === 4);
  check('and each is a kind this connector build recognises', ['clock.ntp', 'door.settings', 'attendance.mode', 'push.clear'].every((kind) => kinds.has(kind)));

  await executor.runOnce();
  const afterWrites = await db().deviceCommand.findMany({
    where: { deviceId: device.id, kind: { in: ['clock.ntp', 'door.settings', 'attendance.mode', 'push.clear'] } },
  });
  check(
    'an unreachable terminal defers them rather than failing them as unrecognised',
    afterWrites.every((row) => row.status === 'sent'),
  );

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
