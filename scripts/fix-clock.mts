/**
 * Hands the terminal clock over to NTP and rebuilds the affected records.
 *
 * The terminal shipped with `timeMode: manual` and its NTP server pointing at
 * 192.0.0.64, a factory placeholder that never answers. The result is a clock
 * that drifts without bound while the device keeps working perfectly, so nothing
 * reports a fault and every attendance record silently inherits the error.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/fix-clock.mts <password> [ntpHost]
 */
import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
/**
 * Defaults to the LAN gateway rather than a public server. A LAN-local source
 * keeps the clock synchronised even when the site loses its internet link, which
 * is the situation this deployment has to survive.
 */
const ntpHost = process.argv[3] ?? '192.168.1.1';
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: fix-clock.mts <adminPassword> [ntpHost]');
  process.exit(2);
}

let cookie = '';

await call('POST', '/api/auth/login', {
  email,
  password,
  ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
});
if (!cookie) {
  console.error('Login failed. Check the password, or set ADMIN_TOTP_SECRET if 2FA is enforced.');
  process.exit(1);
}

console.log('=== Before ===');
const before = await call('GET', '/api/dashboard');
const beforeDevices = before.body['devices'] as Array<Record<string, unknown>>;
for (const device of beforeDevices) {
  console.log(
    `  ${String(device['name']).padEnd(16)} drift=${String(device['clockDriftSeconds'])}s ` +
      `mode=${String(device['clockMode'])} status=${String(device['status'])}`,
  );
}

console.log(`\n=== Pointing terminals at ${ntpHost} ===`);
for (const device of beforeDevices) {
  const id = device['id'];
  const result = await call('POST', `/api/devices/${String(id)}/clock/ntp`, {
    host: ntpHost,
    // Hikvision inverts the sign: CST-8:00:00 denotes UTC+8.
    timeZone: 'CST-8:00:00',
    intervalMinutes: 60,
  });

  if (result.status !== 200) {
    console.log(`  ${String(device['name'])}: FAILED ${String(result.body['error'])}`);
    continue;
  }
  console.log(
    `  ${String(device['name'])}: timeMode=${String(result.body['timeMode'])} ` +
      `drift=${String(result.body['driftSeconds'])}s`,
  );
}

// The device needs a moment to complete its first synchronisation; reading the
// drift immediately would report the pre-sync value and look like a failure.
console.log('\nWaiting 20s for the first synchronisation...');
await new Promise((resolve) => setTimeout(resolve, 20_000));

console.log('\n=== After ===');
for (const device of beforeDevices) {
  const id = device['id'];
  const health = await call('POST', `/api/devices/${String(id)}/check`);
  console.log(
    `  ${String(device['name']).padEnd(16)} drift=${String(health.body['clockDriftSeconds'])}s ` +
      `mode=${String(health.body['clockMode'])} status=${String(health.body['status'])}`,
  );
  for (const warning of (health.body['warnings'] as string[]) ?? []) {
    console.log(`    warn: ${warning}`);
  }
}

console.log('\n=== Rebuilding attendance ===');
const recompute = await call('POST', '/api/attendance/recompute', {
  from: '2026-06-01',
  to: '2026-08-31',
});
console.log(`  staff processed : ${String(recompute.body['staffProcessed'])}`);
console.log(`  records written : ${String(recompute.body['recordsWritten'])}`);
console.log(`  exceptions      : ${String(recompute.body['exceptionsRaised'])}`);

console.log(
  '\nNote: scans already stored keep the timestamps the terminal reported at the\n' +
    'time, which were wrong. Recomputing re-derives records from those timestamps,\n' +
    'it cannot invent the correct instant. Only scans from now on are accurate.\n',
);

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
