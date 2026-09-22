/**
 * Verifies department and location CRUD, including the guards.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-org.mts <password>
 */
import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-org.mts <adminPassword>');
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

console.log('\n=== Departments ===');
const listed = await call('GET', '/api/departments');
check('list responds', listed.status === 200);
const existing = listed.body as unknown as Array<Record<string, unknown>>;
show('departments', String(existing.length));
for (const row of existing.slice(0, 5)) {
  show(`  ${String(row['name'])}`, `${String(row['staffCount'])} staf`);
}

const parentName = `Ujian Induk ${Date.now().toString().slice(-6)}`;
const created = await call('POST', '/api/departments', { name: parentName });
check('create succeeds', created.status === 200);
const parentId = Number(created.body['id']);

const duplicate = await call('POST', '/api/departments', { name: parentName });
check('a duplicate name is refused', duplicate.status === 409);

const childName = `${parentName} Anak`;
const child = await call('POST', '/api/departments', { name: childName, parentId });
check('a child department can be created', child.status === 200);
const childId = Number(child.body['id']);

console.log('\n=== Hierarchy guards ===');
const selfParent = await call('PATCH', `/api/departments/${parentId}`, { parentId });
check('a department cannot be its own parent', selfParent.status === 409);
show('message', String(selfParent.body['error']));

// Making the parent a child of its own child would close a loop, which would make
// any tree walk in reporting recurse forever.
const cycle = await call('PATCH', `/api/departments/${parentId}`, { parentId: childId });
check('a cycle is refused', cycle.status === 409);
show('message', String(cycle.body['error']));

console.log('\n=== Delete guards ===');
const withChild = await call('DELETE', `/api/departments/${parentId}`);
check('a department with sub-departments cannot be deleted', withChild.status === 409);
show('message', String(withChild.body['error']));

// A department that real staff belong to must not be removable in one click.
const populated = existing.find((row) => Number(row['staffCount']) > 0);
if (populated) {
  const attempt = await call('DELETE', `/api/departments/${String(populated['id'])}`);
  check('a department with staff cannot be deleted', attempt.status === 409);
  show('message', String(attempt.body['error']));
} else {
  show('note', 'no populated department to test against');
}

await call('DELETE', `/api/departments/${childId}`);
const cleaned = await call('DELETE', `/api/departments/${parentId}`);
check('an empty department can be deleted', cleaned.status === 200);

console.log('\n=== Locations ===');
const locations = await call('GET', '/api/locations');
check('list responds', locations.status === 200);
for (const row of (locations.body as unknown as Array<Record<string, unknown>>).slice(0, 5)) {
  show(
    `  ${String(row['name'])}`,
    `radius=${String(row['geofenceRadiusM'])}m staf=${String(row['staffCount'])} terminal=${String(row['deviceCount'])}`,
  );
}

const locationName = `Ujian Lokasi ${Date.now().toString().slice(-6)}`;
const newLocation = await call('POST', '/api/locations', {
  name: locationName,
  latitude: 2.287,
  longitude: 111.8305,
  geofenceRadiusM: 150,
});
check('create succeeds', newLocation.status === 200);
const locationId = Number(newLocation.body['id']);

console.log('\n=== Coordinate validation ===');
const badLat = await call('PATCH', `/api/locations/${locationId}`, { latitude: 200 });
check('an out-of-range latitude is refused', badLat.status === 400);
show('message', String(badLat.body['error']));

const badRadius = await call('PATCH', `/api/locations/${locationId}`, { geofenceRadiusM: 5 });
check('a radius below the minimum is refused', badRadius.status === 400);

const okUpdate = await call('PATCH', `/api/locations/${locationId}`, { geofenceRadiusM: 300 });
check('a valid radius is accepted', okUpdate.status === 200);

const removed = await call('DELETE', `/api/locations/${locationId}`);
check('an unused location can be deleted', removed.status === 200);

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
  console.log(`  ${label.padEnd(26)} ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
