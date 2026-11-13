/**
 * The third state a terminal write can be in, exercised through the real route stack.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/test-staff-sync-pending.mts
 *
 * Uses `app.inject()` rather than a listening server, so this needs no port, no `npm run dev` and
 * no admin password — the same pattern as `test-device-capabilities.mts` and `test-agent-routes.mts`.
 *
 * ## Why this has to be run and not merely compiled
 *
 * `DeviceSyncOutcome.pending` and `FaceEnrolOutcome.pending` are both optional, and the screens
 * now branch on them to draw an amber "waiting for the terminal" state instead of a green tick.
 * An optional field that never arrives does not throw: `row.pending === true` is simply false
 * everywhere, every queued write silently goes back to reading as done, and `tsc` has nothing to
 * say about it — which is exactly how the browser's own `DeviceSyncOutcome` went for as long as it
 * did without declaring the field at all.
 *
 * So the field is proved present, proved `true` for a queued write, proved absent for a failure,
 * and proved to survive serialisation: the assertion on the raw reply body is there because
 * `jsonSafe` walks the whole object and a `pending` dropped on the way out would leave every check
 * above it passing against an object the browser never receives.
 *
 * ## What is also checked, and why
 *
 * That `pending` is not cosmetic. A queued push leaves `device_enrolments.syncedAt` null and a row
 * in `device_commands` for the terminal to collect, and a queued face leaves `staff.numOfFace` at
 * zero — three places where the server already records "the unit does not have this yet" while the
 * dialog was reporting it as done. If `pending` ever disagreed with those, the field would be the
 * thing that is wrong rather than the screens.
 *
 * Every row is prefixed `ujian-pending-` and removed at the end.
 */
import { DeviceProtocol, DeviceStatus, DeviceVendor } from '@attendance/shared';

import { buildApp } from '../apps/server/src/app.js';
import { encryptSecret, hashSessionToken, newSessionToken } from '../apps/server/src/crypto.js';
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

/** One terminal's outcome, typed loosely so a missing field is a failed check and not a crash. */
interface Outcome {
  deviceId?: unknown;
  deviceName?: unknown;
  ok?: unknown;
  pending?: unknown;
  error?: unknown;
}

async function session(): Promise<string> {
  const role = await db().role.create({
    data: {
      name: `ujian-pending-${String(stamp)}`,
      permissions: {
        'staff.directory': ['view', 'create', 'edit', 'delete', 'resync'],
        'staff.biometrics': ['view', 'create', 'delete'],
      },
    },
  });
  roles.push(role.id);

  const staff = await db().staff.create({
    data: { employeeNo: `UJIANPENDING-${String(stamp)}`, fullName: 'Ujian Pending' },
  });
  staffIds.push(staff.id);

  const account = await db().userAccount.create({
    data: {
      staffId: staff.id,
      accountType: 'admin',
      status: 'active',
      email: `ujian-pending-${String(stamp)}@contoh.local`,
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

  return `attendance_session=${token}`;
}

/**
 * A JPEG header, which is all `assertUsableJpeg` reads.
 *
 * SOI, then an SOF0 declaring 100x100 so the minimum-pixels check passes, then EOI. Nothing
 * decodes these bytes: the ZKTeco driver base64s them into a queued command, which is the whole
 * point — the picture is never sent anywhere during this test.
 */
function jpegHeader(): Buffer {
  return Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0x64, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9, // EOI
  ]);
}

/** Every outcome for one device, out of a reply that holds several. */
function forDevice(rows: Outcome[], deviceId: number): Outcome | undefined {
  return rows.find((row) => row.deviceId === deviceId);
}

try {
  const cookie = await session();

  /*
    A queued terminal and an unreachable one, so one reply carries two of the three states.

    The ZKTeco row needs no credentials — TA Push identifies a unit by its serial — and carries a
    firmware new enough for a pushed face, because an older one is declared unavailable and
    refused rather than queued, which is a fourth state and a different test.
  */
  const queued = await db().device.create({
    data: {
      name: `ujian-pending-zk-${String(stamp)}`,
      vendor: DeviceVendor.zkteco,
      protocol: DeviceProtocol.taPush,
      host: `10.253.0.${String((stamp % 200) + 1)}`,
      serialNumber: `UJIANPENDING-ZK-${String(stamp)}`,
      firmware: 'V1.5.0',
      status: DeviceStatus.unknown,
      active: true,
    },
  });
  devices.push(queued.id);

  const unreachable = await db().device.create({
    data: {
      name: `ujian-pending-hik-${String(stamp)}`,
      vendor: DeviceVendor.hikvision,
      protocol: DeviceProtocol.isapi,
      host: `10.253.1.${String((stamp % 200) + 1)}`,
      serialNumber: `UJIANPENDING-HIK-${String(stamp)}`,
      status: DeviceStatus.unknown,
      active: true,
      username: 'admin',
      passwordEncrypted: encryptSecret('ujian-pending'),
    },
  });
  devices.push(unreachable.id);

  // -------------------------------------------------------------------------
  section('creating a staff member across both terminals');

  const employeeNo = `UJIANPENDING-STAF-${String(stamp)}`;
  const created = await app.inject({
    method: 'POST',
    url: '/api/staff',
    headers: { cookie },
    payload: {
      employeeNo,
      fullName: 'Ujian Pending Staf',
      active: true,
      deviceIds: [queued.id, unreachable.id],
    },
  });
  check('the create answers 200', created.statusCode === 200);

  const createdBody = created.json() as { id: number; sync: Outcome[] };
  const subject = createdBody.id;
  if (typeof subject === 'number') staffIds.push(subject);

  check('both terminals are reported on', createdBody.sync.length === 2);

  const pushedQueued = forDevice(createdBody.sync, queued.id);
  const pushedFailed = forDevice(createdBody.sync, unreachable.id);

  check('the queued terminal reports the write as accepted', pushedQueued?.ok === true);
  /*
    The assertion this whole script exists for. `ok` alone is what the staff form used to read, and
    on this protocol it means "recorded here", not "the terminal has it".
  */
  check('and reports it as not yet confirmed', pushedQueued?.pending === true);
  check(
    'the `pending` key is present on that row, not merely absent',
    pushedQueued !== undefined && 'pending' in pushedQueued,
  );
  check('the unreachable terminal reports a failure', pushedFailed?.ok === false);
  check(
    'and carries an error rather than a pending flag, so the three states stay apart',
    typeof pushedFailed?.error === 'string' && pushedFailed.pending !== true,
  );

  // -------------------------------------------------------------------------
  section('nothing collapses it on the way out');

  /*
    Read off the raw body, not the parsed object.

    `jsonSafe` walks the whole reply to make Decimals and BigInts serialisable, and a `pending`
    lost in there would leave every check above passing against something the browser never sees.
  */
  check('the reply body literally carries `"pending":true`', created.body.includes('"pending":true'));
  check(
    'and does not report every row as pending, which would make the flag meaningless',
    (created.body.match(/"pending":true/g) ?? []).length === 1,
  );

  // -------------------------------------------------------------------------
  section('the server records the same thing in three other places');

  const enrolment = await db().deviceEnrolment.findUnique({
    where: { deviceId_deviceEmployeeNo: { deviceId: queued.id, deviceEmployeeNo: employeeNo } },
    select: { syncedAt: true, confirmed: true },
  });
  check('the enrolment row exists, so the assignment is recorded', enrolment !== null);
  check(
    'with `syncedAt` null, which is the row refusing to assert the terminal has the person',
    enrolment?.syncedAt === null,
  );

  const commands = await db().deviceCommand.count({ where: { deviceId: queued.id } });
  check('a command is queued for the terminal to collect, so the write is durable', commands > 0);

  // -------------------------------------------------------------------------
  section('re-pushing an existing assignment');

  const resynced = await app.inject({
    method: 'POST',
    url: `/api/staff/${String(subject)}/resync`,
    headers: { cookie },
  });
  check('the resync answers 200', resynced.statusCode === 200);

  const resyncBody = resynced.json() as { sync: Outcome[] };
  check(
    'the queued terminal is still unconfirmed, so "pushed again" does not read as "corrected"',
    forDevice(resyncBody.sync, queued.id)?.pending === true,
  );

  // -------------------------------------------------------------------------
  section('enrolling a face, which is what somebody scans with');

  const face = await app.inject({
    method: 'POST',
    url: `/api/staff/${String(subject)}/face`,
    headers: { cookie, 'content-type': 'image/jpeg' },
    payload: jpegHeader(),
  });
  check('the face upload answers 200', face.statusCode === 200);

  const faceBody = face.json() as { results: Outcome[] };
  const faceQueued = forDevice(faceBody.results, queued.id);
  check('the queued terminal accepts the picture', faceQueued?.ok === true);
  check('and reports it as not yet collected', faceQueued?.pending === true);

  /*
    `faces.ts` only mirrors this for a confirmed enrolment, deliberately — it is what the directory
    reads to answer "can this person clock in". So the directory has been telling the truth about a
    queued face for as long as the dialog was reporting it as done, which is the disagreement the
    amber row removes.
  */
  const mirrored = await db().staff.findUnique({
    where: { id: subject },
    select: { numOfFace: true },
  });
  check(
    'and `staff.numOfFace` stays at zero, so the directory does not claim they can scan',
    mirrored?.numOfFace === 0,
  );

  // -------------------------------------------------------------------------
  section('deactivating, where a queued removal has a security consequence');

  const deactivated = await app.inject({
    method: 'DELETE',
    url: `/api/staff/${String(subject)}`,
    headers: { cookie },
  });
  check('the deactivation answers 200', deactivated.statusCode === 200);

  const removalBody = deactivated.json() as { removal: Outcome[] };
  const removedQueued = forDevice(removalBody.removal, queued.id);
  check('the removal is accepted by the driver', removedQueued?.ok === true);
  /*
    Until the unit collects this, the person is still on it and can still open that door — on the
    screen whose entire job is to report that they cannot.
  */
  check('and reported as not yet confirmed by the terminal', removedQueued?.pending === true);
} finally {
  await app.close();

  /** Cleanup reports what it could not remove, so a leftover row is not a later investigation. */
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
    await sweep('queued commands', () =>
      prisma.deviceCommand.deleteMany({ where: { deviceId: { in: devices } } }),
    );
    await sweep('enrolments', () =>
      prisma.deviceEnrolment.deleteMany({ where: { deviceId: { in: devices } } }),
    );
    await sweep('sync state', () =>
      prisma.deviceSyncState.deleteMany({ where: { deviceId: { in: devices } } }),
    );
    await sweep('devices', () => prisma.device.deleteMany({ where: { id: { in: devices } } }));
  }
  if (staffIds.length > 0) {
    // Accounts, sessions and audit rows cascade from the staff row.
    await sweep('staff', () => prisma.staff.deleteMany({ where: { id: { in: staffIds } } }));
  }
  if (roles.length > 0) {
    await sweep('roles', () => prisma.role.deleteMany({ where: { id: { in: roles } } }));
  }

  await disconnectDb();
}

console.log(failures === 0 ? '\nSemua lulus' : `\n${String(failures)} semakan GAGAL`);
process.exit(failures === 0 ? 0 : 1);
