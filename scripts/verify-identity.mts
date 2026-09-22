/**
 * Checks per-device identity mapping against the live terminal.
 *
 * The scenario this guards: one person carries a different `employeeNo` on every
 * terminal. Resolution must go through the mapping table, and an unmapped
 * identifier must be queued rather than guessed at.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-identity.mts <password> <totpSecret>
 */
import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.argv[3];

if (!password || !totpSecret) {
  console.error('Usage: verify-identity.mts <adminPassword> <totpSecret>');
  process.exit(2);
}

let cookie = '';
let failures = 0;

await call('POST', '/api/auth/login', {
  email,
  password,
  totp: generateSync({ secret: totpSecret }),
});
check('logged in', cookie.length > 0);

console.log('\n=== Import the terminal roster ===');
const imported = await call('POST', '/api/devices/1/import-users');
check('import succeeds', imported.status === 200);
show('device users', String(imported.body['deviceUsers']));
show('auto-mapped', String(imported.body['autoMapped']));
show('already mapped', String(imported.body['alreadyMapped']));
show('needs review', String(imported.body['needsReview']));

console.log('\n=== Mappings awaiting confirmation ===');
const unconfirmed = await call('GET', '/api/identity/unconfirmed');
const pending = unconfirmed.body as unknown as Array<Record<string, unknown>>;
show('count', String(pending.length));
for (const row of pending) {
  const device = row['device'] as Record<string, unknown>;
  const staff = row['staff'] as Record<string, unknown>;
  show(
    `  ${String(device['name'])}`,
    `device id "${String(row['deviceEmployeeNo'])}" -> staf #${String(staff['employeeNo'])} ${String(staff['fullName'])}`,
  );
}
check('exact id match was auto-paired but left unconfirmed', pending.length > 0);

console.log('\n=== Identifiers with nobody to attach to ===');
const unmapped = await call('GET', '/api/identity/unmapped');
const orphans = unmapped.body as unknown as Array<Record<string, unknown>>;
show('count', String(orphans.length));
for (const row of orphans) {
  const device = row['device'] as Record<string, unknown>;
  show(
    `  ${String(device['name'])}`,
    `id "${String(row['deviceEmployeeNo'])}" nama-di-terminal "${String(row['deviceName'] ?? '-')}" ` +
      `muka=${String(row['numOfFace'])} scan=${String(row['scanCount'])}`,
  );
}
check('unknown identifier is queued, not guessed', orphans.length > 0);

console.log('\n=== Terminal identities held by one person ===');
const identities = await call('GET', '/api/staff/1/identities');
check('identities endpoint responds', identities.status === 200);
show('canonical no', String(identities.body['canonicalEmployeeNo']));
show('name', String(identities.body['fullName']));
const rows = identities.body['identities'] as Array<Record<string, unknown>>;
for (const row of rows) {
  show(
    `  ${String(row['deviceName'])}`,
    `id pada terminal = "${String(row['deviceEmployeeNo'])}" disahkan=${String(row['confirmed'])}`,
  );
}
const credentials = identities.body['credentials'] as Record<string, unknown>;
show(
  'credentials',
  `muka=${String(credentials['face'])} cap-jari=${String(credentials['fingerprint'])} kad=${String(credentials['card'])}`,
);
check('mapping recorded for the physical terminal', rows.length > 0);

console.log('\n=== Confirming a mapping backfills past scans ===');
const first = rows[0];
if (first) {
  const confirmed = await call('POST', '/api/identity/map', {
    deviceId: first['deviceId'],
    deviceEmployeeNo: first['deviceEmployeeNo'],
    staffId: 1,
  });
  check('mapping confirmed', confirmed.status === 200);
  show('backfilled scans', String(confirmed.body['backfilled']));
  // A registry key, not a sentence: the route has no reader whose language to resolve to.
  check('and reports the outcome as a registry key', typeof confirmed.body['noteKey'] === 'string');
  show('noteKey', String(confirmed.body['noteKey']));
}

console.log('\n=== A staff member cannot hold two ids on one terminal ===');
const clash = await call('POST', '/api/identity/map', {
  deviceId: 1,
  deviceEmployeeNo: '2001',
  staffId: 1,
});
check('second id for the same person on the same terminal is refused', clash.status === 409);
show('message', String(clash.body['error']));

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
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
  let parsed: Record<string, unknown> = {};
  try {
    const json: unknown = JSON.parse(text);
    parsed = (json ?? {}) as Record<string, unknown>;
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

function show(label: string, value: string): void {
  console.log(`  ${label.padEnd(26)} ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
