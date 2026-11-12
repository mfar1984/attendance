/**
 * `DELETE /api/devices/:id`, exercised through the real route stack.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/test-device-removal.mts
 *
 * Uses `app.inject()` rather than a listening server, so this needs no port, no `npm run dev` and
 * no admin password — it builds the application in-process and dispatches through the actual
 * handlers, guards and error mapping. Sessions are written straight into `sessions`, which is the
 * only part login does that matters here.
 *
 * ## Why this has to be run and not merely compiled
 *
 * `tsc` does not reject a field missing from a Prisma `select`, and this is a route that deletes
 * rows. The thing being proved is the refusal: that a terminal holding evidence is refused **and
 * that the evidence is still there afterwards**. A route that answered 409 after cascading the raw
 * events away would pass a test that only read the status code.
 *
 * Every row is prefixed `ujian-padam-` and removed at the end.
 */
import { DeviceStatus, PunchDirection, PunchSource, RawEventKind, VerifyMethod } from '@attendance/shared';

import { buildApp } from '../apps/server/src/app.js';
import { hashSessionToken, newSessionToken } from '../apps/server/src/crypto.js';
import { db, disconnectDb } from '../apps/server/src/db.js';

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

const roles: number[] = [];
const staffIds: number[] = [];
const devices: number[] = [];

/** A session for a role holding exactly these grants, as a cookie header. */
async function sessionFor(
  label: string,
  permissions: Record<string, string[]>,
): Promise<{ cookie: string }> {
  const role = await db().role.create({
    data: { name: `ujian-padam-${label}-${String(stamp)}`, permissions },
  });
  roles.push(role.id);

  const staff = await db().staff.create({
    data: {
      employeeNo: `UJIANPADAM-${label.toUpperCase()}-${String(stamp)}`,
      fullName: `Ujian Padam ${label}`,
    },
  });
  staffIds.push(staff.id);

  const account = await db().userAccount.create({
    data: {
      staffId: staff.id,
      accountType: 'admin',
      status: 'active',
      email: `ujian-padam-${label}-${String(stamp)}@contoh.local`,
      roleId: role.id,
    },
  });

  const token = newSessionToken();
  await db().session.create({
    data: {
      tokenHash: hashSessionToken(token),
      accountId: account.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });

  return { cookie: `attendance_session=${token}` };
}

/** A deactivated terminal with nothing referring to it: the deletable shape. */
async function makeDevice(label: string, active = false): Promise<number> {
  const device = await db().device.create({
    data: {
      name: `ujian-padam-${label}-${String(stamp)}`,
      host: `10.255.${String(devices.length)}.${String((stamp % 200) + 1)}`,
      username: 'admin',
      serialNumber: `UJIANPADAM-${label.toUpperCase()}-${String(stamp)}`,
      status: DeviceStatus.unknown,
      active,
    },
  });
  devices.push(device.id);

  // Every real terminal has one. It is the row the whole operation was blocked on in production.
  await db().deviceSyncState.create({ data: { deviceId: device.id, lastSerialNo: BigInt(41) } });

  return device.id;
}

/** The row as the device list reports it, which is what greys the control. */
async function listRow(
  cookie: string,
  id: number,
): Promise<{ removal?: { removable: boolean; blockers: Array<{ key: string }> } } | undefined> {
  const listed = await app.inject({ method: 'GET', url: '/api/devices', headers: { cookie } });
  const rows = listed.json() as Array<{
    id: number;
    removal?: { removable: boolean; blockers: Array<{ key: string }> };
  }>;
  return rows.find((row) => row.id === id);
}

try {
  const admin = await sessionFor('penuh', {
    'settings.devices': ['view', 'edit', 'delete'],
    'staff.directory': ['view'],
  });
  const editor = await sessionFor('ubah', { 'settings.devices': ['view', 'edit'] });

  // -------------------------------------------------------------------------
  section('the gate');

  const anonymous = await app.inject({ method: 'DELETE', url: '/api/devices/1' });
  check('an unauthenticated request is refused', anonymous.statusCode === 401);

  const spare = await makeDevice('kebenaran');
  const byEditor = await app.inject({
    method: 'DELETE',
    url: `/api/devices/${String(spare)}`,
    headers: { cookie: editor.cookie },
  });
  check('`edit` alone does not permit deletion', byEditor.statusCode === 403);
  check(
    'the terminal is still there after the refusal',
    (await db().device.findUnique({ where: { id: spare } })) !== null,
  );

  const missing = await app.inject({
    method: 'DELETE',
    url: '/api/devices/99999999',
    headers: { cookie: admin.cookie },
  });
  check('an unknown terminal is 404', missing.statusCode === 404);

  // -------------------------------------------------------------------------
  section('an active terminal is refused — deactivate first');

  const live = await makeDevice('aktif', true);

  const liveRow = await listRow(admin.cookie, live);
  check('the list reports it as not removable', liveRow?.removal?.removable === false);
  check(
    'the list names the deactivation step as the reason',
    liveRow?.removal?.blockers[0]?.key === 'device.remove.blocked.active',
  );

  const liveDelete = await app.inject({
    method: 'DELETE',
    url: `/api/devices/${String(live)}`,
    headers: { cookie: admin.cookie },
  });
  check('deleting an active terminal is refused with 409', liveDelete.statusCode === 409);
  check(
    'the refusal says to deactivate it first',
    (liveDelete.json() as { error?: string }).error?.includes('Nyahaktifkannya dahulu') === true,
  );
  check(
    'the active terminal is still there',
    (await db().device.findUnique({ where: { id: live } })) !== null,
  );

  // -------------------------------------------------------------------------
  section('a terminal holding raw events is refused, and keeps them');

  const withEvents = await makeDevice('bukti');
  await db().rawEvent.create({
    data: {
      deviceId: withEvents,
      eventKey: `isapi:ujian-padam-${String(stamp)}`,
      serialNo: BigInt(7),
      eventKind: RawEventKind.identified,
      verifyMethod: VerifyMethod.face,
      eventTime: new Date(),
      employeeNo: 'UJIAN-PADAM-1',
      arrivedVia: 'push',
      payload: { asal: 'ujian' },
    },
  });

  const eventRow = await listRow(admin.cookie, withEvents);
  check('the list reports it as not removable', eventRow?.removal?.removable === false);
  check(
    'the list names the raw scan log as the reason',
    eventRow?.removal?.blockers[0]?.key === 'device.remove.blocked.rawEvents',
  );

  const eventDelete = await app.inject({
    method: 'DELETE',
    url: `/api/devices/${String(withEvents)}`,
    headers: { cookie: admin.cookie },
  });
  check('the delete is refused with 409', eventDelete.statusCode === 409);
  check(
    'the refusal names the count',
    (eventDelete.json() as { error?: string }).error?.includes('1 log scan mentah') === true,
  );

  /*
   * The assertion this script exists for. A naive `prisma.device.delete()` would have answered 200
   * and taken the log with it; one that refuses after cascading would still pass a status check.
   */
  check(
    'the raw event survived the refusal',
    (await db().rawEvent.count({ where: { deviceId: withEvents } })) === 1,
  );
  check(
    'the terminal survived the refusal',
    (await db().device.findUnique({ where: { id: withEvents } })) !== null,
  );

  // -------------------------------------------------------------------------
  section('a punch blocks, even though its relation is SetNull');

  const withPunch = await makeDevice('punch');
  const punchStaff = await db().staff.create({
    data: {
      employeeNo: `UJIANPADAM-PUNCH-${String(stamp)}`,
      fullName: 'Ujian Padam Punch',
    },
  });
  staffIds.push(punchStaff.id);
  await db().punch.create({
    data: {
      staffId: punchStaff.id,
      deviceId: withPunch,
      punchAt: new Date(),
      source: PunchSource.terminal,
      method: VerifyMethod.face,
      direction: PunchDirection.in,
    },
  });

  const punchRow = await listRow(admin.cookie, withPunch);
  check(
    'the list names the punches as the reason',
    punchRow?.removal?.blockers[0]?.key === 'device.remove.blocked.punches',
  );

  const punchDelete = await app.inject({
    method: 'DELETE',
    url: `/api/devices/${String(withPunch)}`,
    headers: { cookie: admin.cookie },
  });
  check('the delete is refused with 409', punchDelete.statusCode === 409);
  check(
    'the punch still names the terminal that recorded it',
    (await db().punch.count({ where: { deviceId: withPunch } })) === 1,
  );

  // -------------------------------------------------------------------------
  section('an exception blocks, and nothing in the database would have');

  /*
   * `attendance_exceptions.deviceId` carries no foreign key — the model declares no relation at
   * all. So this is the one blocker with nothing behind it: without the check in `removal.ts` the
   * delete would succeed and leave the row pointing at an id the exceptions screen cannot resolve.
   */
  const withException = await makeDevice('pengecualian');
  const exception = await db().attendanceException.create({
    data: {
      kind: 'unknown_employee',
      deviceId: withException,
      occurredAt: new Date(),
      detail: 'ujian padam',
    },
  });

  const exceptionRow = await listRow(admin.cookie, withException);
  check(
    'the list names the exceptions as the reason',
    exceptionRow?.removal?.blockers[0]?.key === 'device.remove.blocked.exceptions',
  );

  const exceptionDelete = await app.inject({
    method: 'DELETE',
    url: `/api/devices/${String(withException)}`,
    headers: { cookie: admin.cookie },
  });
  check('the delete is refused with 409', exceptionDelete.statusCode === 409);
  check(
    'the exception still names the terminal that raised it',
    (await db().attendanceException.findUnique({ where: { id: exception.id } }))?.deviceId ===
      withException,
  );

  // -------------------------------------------------------------------------
  section('a staff mapping blocks');

  const withEnrolment = await makeDevice('pemetaan');
  await db().deviceEnrolment.create({
    data: {
      deviceId: withEnrolment,
      staffId: punchStaff.id,
      deviceEmployeeNo: '1001',
      confirmed: true,
    },
  });

  const enrolmentRow = await listRow(admin.cookie, withEnrolment);
  check(
    'the list names the mappings as the reason',
    enrolmentRow?.removal?.blockers[0]?.key === 'device.remove.blocked.enrolments',
  );

  const enrolmentDelete = await app.inject({
    method: 'DELETE',
    url: `/api/devices/${String(withEnrolment)}`,
    headers: { cookie: admin.cookie },
  });
  check('the delete is refused with 409', enrolmentDelete.statusCode === 409);
  check(
    'the mapping survived',
    (await db().deviceEnrolment.count({ where: { deviceId: withEnrolment } })) === 1,
  );

  // -------------------------------------------------------------------------
  section('a terminal nothing refers to is deleted, with its bookkeeping');

  const stale = await makeDevice('basi');
  await db().deviceCommand.create({
    data: { deviceId: stale, kind: 'person.upsert', subject: 'UJIAN', payload: 'DATA UPDATE' },
  });
  await db().deviceSnapshot.create({
    data: { deviceId: stale, kind: 'identity', payload: '{}', readAt: new Date() },
  });
  await db().unmappedDeviceUser.create({
    data: { deviceId: stale, deviceEmployeeNo: '4242', deviceName: 'ujian padam' },
  });

  const staleRow = await listRow(admin.cookie, stale);
  check('the list reports it as removable', staleRow?.removal?.removable === true);
  check('the list names no blocker', staleRow?.removal?.blockers.length === 0);

  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/devices/${String(stale)}`,
    headers: { cookie: admin.cookie },
  });
  check('the delete succeeds', removed.statusCode === 200);

  const body = removed.json() as {
    ok?: boolean;
    swept?: { syncState: number; commands: number; snapshots: number; unmapped: number };
  };
  check('the reply reports the sweep', body.ok === true);
  check('the sync state row is reported as removed', body.swept?.syncState === 1);
  check('the pending command is reported as removed', body.swept?.commands === 1);
  check('the connector snapshot is reported as removed', body.swept?.snapshots === 1);
  check('the unmapped identifier is reported as removed', body.swept?.unmapped === 1);

  check(
    'the terminal is gone',
    (await db().device.findUnique({ where: { id: stale } })) === null,
  );
  /*
   * The row that blocked the operation in production, verified gone. It is `Cascade`, so the
   * database would have taken it anyway — the point is that the explicit delete did, which is what
   * keeps the set of swept tables written down rather than inherited from the schema.
   */
  check(
    'its sync state is gone',
    (await db().deviceSyncState.findUnique({ where: { deviceId: stale } })) === null,
  );
  check(
    'its commands are gone',
    (await db().deviceCommand.count({ where: { deviceId: stale } })) === 0,
  );
  check(
    'its snapshots are gone',
    (await db().deviceSnapshot.count({ where: { deviceId: stale } })) === 0,
  );
  check(
    'its unmapped identifiers are gone',
    (await db().unmappedDeviceUser.count({ where: { deviceId: stale } })) === 0,
  );

  const gone = await app.inject({
    method: 'DELETE',
    url: `/api/devices/${String(stale)}`,
    headers: { cookie: admin.cookie },
  });
  check('deleting it again is 404', gone.statusCode === 404);

  const listedAfter = await listRow(admin.cookie, stale);
  check('it is no longer in the list', listedAfter === undefined);
} finally {
  await app.close();

  /**
   * Cleanup reports what it could not remove.
   *
   * Dependents first and in reference order. The device delete cascades most of them, but naming
   * each keeps the failure specific when one does block — and a cleanup that hides its own
   * failures turns every leftover row into the same investigation later.
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
    await sweep('exceptions', () =>
      prisma.attendanceException.deleteMany({ where: { deviceId: { in: devices } } }),
    );
    await sweep('punches', () => prisma.punch.deleteMany({ where: { deviceId: { in: devices } } }));
    await sweep('enrolments', () =>
      prisma.deviceEnrolment.deleteMany({ where: { deviceId: { in: devices } } }),
    );
    await sweep('commands', () =>
      prisma.deviceCommand.deleteMany({ where: { deviceId: { in: devices } } }),
    );
    await sweep('snapshots', () =>
      prisma.deviceSnapshot.deleteMany({ where: { deviceId: { in: devices } } }),
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
  if (staffIds.length > 0) {
    // Accounts and their sessions cascade from the staff row.
    await sweep('staff', () => prisma.staff.deleteMany({ where: { id: { in: staffIds } } }));
  }
  if (roles.length > 0) {
    await sweep('roles', () => prisma.role.deleteMany({ where: { id: { in: roles } } }));
  }

  await disconnectDb();
}

console.log(failures === 0 ? '\nSemua lulus' : `\n${String(failures)} semakan GAGAL`);
process.exit(failures === 0 ? 0 : 1);
