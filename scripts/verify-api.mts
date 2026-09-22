/**
 * End-to-end check against a running server.
 *
 * Exercises the real path an operator takes: log in with password plus TOTP,
 * pull events off the terminal, rebuild attendance, then read the dashboard.
 * Nothing is mocked.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-api.mts <password> <totpSecret>
 */
import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.argv[3];

if (!password || !totpSecret) {
  console.error('Usage: verify-api.mts <adminPassword> <totpSecret>');
  process.exit(2);
}

let cookie = '';
let failures = 0;

console.log(`\n=== Health ===`);
const health = await call('GET', '/api/health');
show('mode', String(health.body['mode']));
check('health responds ok', health.body['ok'] === true);

console.log(`\n=== Login rejects a wrong password ===`);
const bad = await call('POST', '/api/auth/login', {
  email,
  password: 'definitely-not-it',
  totp: generateSync({ secret: totpSecret }),
});
check('wrong password is refused', bad.status === 401);
show('message', String(bad.body['error']));

console.log(`\n=== Second factor for administrators ===`);
const noTotp = await call('POST', '/api/auth/login', { email, password });
// Enforcement is a setting, so the expected outcome depends on it. Asserting one
// fixed answer would make this script fail on a correctly configured server.
const enforced = process.env['REQUIRE_ADMIN_2FA'] !== 'false';
if (enforced) {
  check('admin login without 2FA is refused', noTotp.status === 401);
} else {
  check('2FA not enforced, so login without a code is allowed', noTotp.status === 200);
  show('note', 'REQUIRE_ADMIN_2FA=false — hidupkan semula untuk produksi');
}

console.log(`\n=== A wrong TOTP is still rejected even when not enforced ===`);
const wrongTotp = await call('POST', '/api/auth/login', { email, password, totp: '000000' });
check('a supplied but invalid code is never ignored', wrongTotp.status === 401);

console.log(`\n=== Login ===`);
const login = await call('POST', '/api/auth/login', {
  email,
  password,
  totp: generateSync({ secret: totpSecret }),
});
check('login succeeds', login.status === 200);
if (login.status === 200) {
  const user = login.body['user'] as Record<string, unknown>;
  show('user', `${String(user['fullName'])} (${String(user['roleName'])})`);
  show('employeeNo', String(user['employeeNo']));
  check('session cookie issued', cookie.length > 0);
} else {
  show('error', String(login.body['error']));
}

console.log(`\n=== Session restore ===`);
const me = await call('GET', '/api/auth/me');
check('/api/auth/me resolves the session', me.status === 200);

console.log(`\n=== Terminal health, which is what measures the clock ===`);
const deviceHealth = await call('POST', '/api/devices/1/check');
check('health probe succeeds', deviceHealth.status === 200);
show('status', String(deviceHealth.body['status']));
show('clock drift', `${String(deviceHealth.body['clockDriftSeconds'])}s`);
show('clock mode', String(deviceHealth.body['clockMode']));
show(
  'enrolled',
  `${String(deviceHealth.body['enrolled'])} / ${String(deviceHealth.body['faceCapacity'])}`,
);
for (const warning of (deviceHealth.body['warnings'] as string[]) ?? []) {
  show('  warn', warning);
}
if (deviceHealth.body['error']) show('  error', String(deviceHealth.body['error']));

console.log(`\n=== Device pull from the real terminal ===`);
const sync = await call('POST', '/api/devices/1/sync');
check('sync completes', sync.status === 200);
show('serial cursor', `${String(sync.body['fromSerialNo'])} -> ${String(sync.body['toSerialNo'])}`);
show('stored', String(sync.body['stored']));
show('duplicates', String(sync.body['duplicates']));
show('punches', String(sync.body['punches']));
if (sync.body['error']) show('error', String(sync.body['error']));

console.log(`\n=== Idempotency: pull again ===`);
const again = await call('POST', '/api/devices/1/sync');
check('second pull stores nothing new', again.body['stored'] === 0);

console.log(`\n=== Recompute attendance ===`);
const recompute = await call('POST', '/api/attendance/recompute', {
  from: '2026-07-01',
  to: '2026-08-28',
});
check('recompute runs', recompute.status === 200);
show('staff processed', String(recompute.body['staffProcessed']));
show('records written', String(recompute.body['recordsWritten']));
show('exceptions', String(recompute.body['exceptionsRaised']));

console.log(`\n=== Dashboard ===`);
const dashboard = await call('GET', '/api/dashboard');
check('dashboard responds', dashboard.status === 200);
const today = dashboard.body['today'] as Record<string, unknown>;
show('staff total', String(today['staffTotal']));
show('missing biometrics', String(today['missingBiometrics']));
const devices = dashboard.body['devices'] as Array<Record<string, unknown>>;
for (const device of devices) {
  show(
    `device ${String(device['name'])}`,
    `${String(device['status'])} drift=${String(device['clockDriftSeconds'])}s ` +
      `serial=${String(device['lastSerialNo'])} enrolled=${String(device['enrolled'])}`,
  );
}
const exceptions = dashboard.body['exceptions'] as Array<Record<string, unknown>>;
show('open exceptions', String(exceptions.length));
for (const exception of exceptions.slice(0, 5)) {
  show(`  ${String(exception['kind'])}`, String(exception['detail']));
}

console.log(`\n=== Authorisation ===`);
const noCookie = cookie;
cookie = '';
const denied = await call('GET', '/api/dashboard');
check('dashboard requires a session', denied.status === 401);
cookie = noCookie;

console.log(`\n=== Ingest endpoint demands Digest ===`);
const push = await call('POST', '/hik/events', { eventType: 'heartBeat' });
check('unauthenticated push is refused', push.status === 401);
show('challenge', push.headers.get('www-authenticate')?.slice(0, 60) ?? '(none)');

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

  const setCookie = response.headers.getSetCookie();
  for (const entry of setCookie) {
    const pair = entry.split(';')[0];
    if (pair?.startsWith('attendance_session=')) cookie = pair;
  }

  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    const json: unknown = JSON.parse(text);
    parsed = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }

  return { status: response.status, body: parsed, headers: response.headers };
}

function show(label: string, value: string): void {
  console.log(`  ${label.padEnd(24)} ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
