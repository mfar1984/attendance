/**
 * Verifies staff CRUD against the live terminal.
 *
 * Creating a staff member must actually write a person onto the device, so this
 * reads the roster back off the hardware rather than trusting the API response.
 * The record is removed again at the end.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-staff-crud.mts <password>
 */
import { generateSync } from 'otplib';

import { HikvisionClient } from '@attendance/hik-isapi';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-staff-crud.mts <adminPassword>');
  process.exit(2);
}

const device = new HikvisionClient({
  baseUrl: process.env['HIK_HOST'] as string,
  username: process.env['HIK_USERNAME'] as string,
  password: process.env['HIK_PASSWORD'] as string,
  verifyTls: false,
});

let cookie = '';
let failures = 0;
const employeeNo = `T${Date.now().toString().slice(-8)}`;
let createdId: number | null = null;

try {
  await call('POST', '/api/auth/login', {
    email,
    password,
    ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
  });
  check('logged in', cookie.length > 0);

  const lookups = await call('GET', '/api/lookups');
  const devices = lookups.body['devices'] as Array<Record<string, unknown>>;
  const deviceId = devices[0]?.['id'];
  check('a terminal is registered', deviceId !== undefined);

  console.log('\n=== Validation rejects what the terminal would ===');
  const tooLong = await call('POST', '/api/staff', {
    employeeNo: 'X'.repeat(40),
    fullName: 'Ujian',
    active: true,
    deviceIds: [],
  });
  check('an employeeNo past 32 characters is refused', tooLong.status === 400);
  show('message', String(tooLong.body['error']));

  const badPin = await call('POST', '/api/staff', {
    employeeNo: `${employeeNo}X`,
    fullName: 'Ujian',
    doorPin: '12',
    active: true,
    deviceIds: [],
  });
  check('a PIN shorter than 4 digits is refused', badPin.status === 400);

  console.log('\n=== Create, and push to the terminal ===');
  const created = await call('POST', '/api/staff', {
    employeeNo,
    fullName: 'Ujian Sistem Kehadiran',
    doorPin: '842519',
    active: true,
    deviceIds: [deviceId],
  });
  check('create succeeds', created.status === 200);
  createdId = Number(created.body['id']);
  show('staff id', String(createdId));

  const sync = created.body['sync'] as Array<Record<string, unknown>>;
  for (const row of sync) {
    show(
      `  ${String(row['deviceName'])}`,
      row['ok'] === true ? 'berjaya' : `GAGAL ${String(row['error'])}`,
    );
  }
  check('pushed to every assigned terminal', sync.length > 0 && sync.every((row) => row['ok'] === true));

  console.log('\n=== Read the roster back off the hardware ===');
  const onDevice = await device.persons.find(employeeNo);
  check('the person exists on the terminal', onDevice !== null);
  if (onDevice) {
    show('name on terminal', onDevice.name);
    check('the name matches what we sent', onDevice.name === 'Ujian Sistem Kehadiran');
  }

  console.log('\n=== Duplicate employeeNo is refused ===');
  const duplicate = await call('POST', '/api/staff', {
    employeeNo,
    fullName: 'Pendua',
    active: true,
    deviceIds: [],
  });
  check('a second record with the same No. Staf is refused', duplicate.status === 409);

  console.log('\n=== The identifier cannot be renamed ===');
  const rename = await call('PATCH', `/api/staff/${createdId}`, { employeeNo: 'BERUBAH' });
  check('renaming employeeNo is refused', rename.status === 409);
  show('message', String(rename.body['error']).slice(0, 90));

  console.log('\n=== Update, and the change reaches the terminal ===');
  const updated = await call('PATCH', `/api/staff/${createdId}`, {
    fullName: 'Ujian Sistem Dikemaskini',
  });
  check('update succeeds', updated.status === 200);

  const afterUpdate = await device.persons.find(employeeNo);
  check(
    'the terminal shows the new name',
    afterUpdate?.name === 'Ujian Sistem Dikemaskini',
  );
  show('name on terminal', afterUpdate?.name ?? '(tiada)');

  console.log('\n=== The mapping was recorded as confirmed ===');
  const identities = await call('GET', `/api/staff/${createdId}/identities`);
  const rows = identities.body['identities'] as Array<Record<string, unknown>>;
  check('an identity row exists', rows.length > 0);
  // Confirmed without review because we chose the identifier on both sides.
  check('it is confirmed automatically', rows[0]?.['confirmed'] === true);
  show('device employeeNo', String(rows[0]?.['deviceEmployeeNo']));

  console.log('\n=== Deactivate removes them from the terminal ===');
  const removed = await call('DELETE', `/api/staff/${createdId}`);
  check('deactivate succeeds', removed.status === 200);
  show('note', String(removed.body['note']).slice(0, 100));

  const afterRemoval = await device.persons.find(employeeNo);
  check('the person is gone from the terminal', afterRemoval === null);

  const detail = await call('GET', `/api/staff/${createdId}`);
  check('the staff record is kept, not deleted', detail.status === 200);
  check('but marked inactive', detail.body['active'] === false);
  // Punches are evidence behind pay already issued, so a soft delete is the only
  // correct behaviour here.
  check('the door PIN is never returned', detail.body['doorPinEncrypted'] === undefined);
  show('hasDoorPin flag', String(detail.body['hasDoorPin']));
} finally {
  await device.close();
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
if (createdId !== null) {
  console.log(`  Rekod ujian #${createdId} (${employeeNo}) kekal sebagai tidak aktif.\n`);
}
process.exit(failures === 0 ? 0 : 1);

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  for (const entry of response.headers.getSetCookie()) {
    const pair = entry.split(';')[0];
    if (pair?.startsWith('attendance_session=')) cookie = pair;
  }

  const text = await response.text();
  try {
    return { status: response.status, body: (JSON.parse(text) ?? {}) as Record<string, unknown> };
  } catch {
    return { status: response.status, body: { raw: text.slice(0, 200) } };
  }
}

function show(label: string, value: string): void {
  console.log(`  ${label.padEnd(24)} ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
