/**
 * Checks the operational read endpoints and the exception resolve flow.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-operations.mts <password>
 */
import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-operations.mts <adminPassword>');
  process.exit(2);
}

let cookie = '';
let failures = 0;

await call('POST', '/api/auth/login', {
  email,
  password,
  ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
});
check('logged in', cookie.length > 0);

console.log('\n=== Lookups ===');
const lookups = await call('GET', '/api/lookups');
check('responds', lookups.status === 200);
show('timezone', String(lookups.body['timeZone']));
show('devices', String((lookups.body['devices'] as unknown[]).length));

console.log('\n=== Exceptions ===');
const open = await call('GET', '/api/exceptions?page=1&pageSize=50&resolved=false');
check('responds', open.status === 200);
show('open total', String(open.body['total']));
show('by kind', JSON.stringify(open.body['openByKind']));
const exceptionRows = open.body['rows'] as Array<Record<string, unknown>>;
for (const row of exceptionRows.slice(0, 4)) {
  show(`  ${String(row['kind'])}`, String(row['detail']).slice(0, 70));
}

console.log('\n=== Exceptions: a resolution requires a reason ===');
const first = exceptionRows[0];
if (first) {
  const rejected = await call('POST', `/api/exceptions/${String(first['id'])}/resolve`, { note: 'x' });
  check('a too-short note is refused', rejected.status === 400);
  show('message', String(rejected.body['error']));

  const accepted = await call('POST', `/api/exceptions/${String(first['id'])}/resolve`, {
    note: 'Disemak semasa ujian sistem, tiada tindakan diperlukan',
  });
  check('resolving with a reason succeeds', accepted.status === 200);

  const after = await call('GET', '/api/exceptions?page=1&pageSize=50&resolved=false');
  check(
    'the resolved row leaves the open queue',
    Number(after.body['total']) === Number(open.body['total']) - 1,
  );
}

console.log('\n=== Raw device log ===');
const raw = await call('GET', '/api/raw-events?page=1&pageSize=5');
check('responds', raw.status === 200);
show('total', String(raw.body['total']));
const rawRows = raw.body['rows'] as Array<Record<string, unknown>>;
for (const row of rawRows.slice(0, 5)) {
  const punch = row['punch'] as Record<string, unknown> | null;
  show(
    `  #${String(row['serialNo'])}`,
    `${String(row['major'])}:${String(row['minor'])} via=${String(row['arrivedVia'])} ` +
      `id=${String(row['employeeNo'] ?? '-')} punch=${punch === null ? 'tiada' : punch['suppressed'] ? 'ditapis' : 'direkod'}`,
  );
}

console.log('\n=== Raw log: identified-only filter ===');
const identified = await call('GET', '/api/raw-events?page=1&pageSize=50&identifiedOnly=true');
check('filter responds', identified.status === 200);
show('identified events', String(identified.body['total']));
check(
  'every row is a person authentication',
  (identified.body['rows'] as Array<Record<string, unknown>>).every(
    (row) => Number(row['major']) === 5 && [38, 75, 113].includes(Number(row['minor'])),
  ),
);

console.log('\n=== Raw log: push and pull are both present ===');
const pushed = await call('GET', '/api/raw-events?page=1&pageSize=1&arrivedVia=push');
const pulled = await call('GET', '/api/raw-events?page=1&pageSize=1&arrivedVia=pull');
show('via push', String(pushed.body['total']));
show('via pull', String(pulled.body['total']));
check('both delivery paths have stored events', Number(pushed.body['total']) > 0 && Number(pulled.body['total']) > 0);

console.log('\n=== Attendance records ===');
const records = await call(
  'GET',
  '/api/attendance/records?page=1&pageSize=10&from=2026-06-01&to=2026-08-31',
);
check('responds', records.status === 200);
show('total', String(records.body['total']));
show('by status', JSON.stringify(records.body['byStatus']));
for (const row of (records.body['rows'] as Array<Record<string, unknown>>).slice(0, 5)) {
  const staff = row['staff'] as Record<string, unknown>;
  show(
    `  ${String(row['workDate']).slice(0, 10)}`,
    `${String(staff['fullName'])} ${String(row['status'])} ` +
      `lewat=${String(row['lateMinutes'])}m kerja=${String(row['workedMinutes'])}m ` +
      `blok=${(row['blocks'] as unknown[]).length}`,
  );
}

console.log('\n=== Raw log is read-only ===');
// No mutating route exists for the raw log. These must not resolve to a handler.
for (const [method, path] of [
  ['DELETE', '/api/raw-events/1'],
  ['PATCH', '/api/raw-events/1'],
] as const) {
  const attempt = await call(method, path);
  check(`${method} ${path} is not routable`, attempt.status === 404 || attempt.status === 405);
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
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
