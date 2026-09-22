/**
 * Turns off remote door verification on every terminal.
 *
 * The terminals shipped with `remoteCheckDoorEnabled: true` pointing at the Ezviz
 * cloud channel. Every event in the log carries `remoteCheckResult: "timeout"`
 * without exception, so the feature has never once succeeded - it simply makes
 * each authentication wait out its five second timeout before letting the person
 * through. Across a shift change that is a queue at the door.
 *
 * This does change access control behaviour, so it is a deliberate, separate
 * action rather than something folded into a health check.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/fix-remote-check.mts <password>
 */
import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: fix-remote-check.mts <adminPassword>');
  process.exit(2);
}

let cookie = '';

await call('POST', '/api/auth/login', {
  email,
  password,
  ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
});
if (!cookie) {
  console.error('Login failed.');
  process.exit(1);
}

const dashboard = await call('GET', '/api/dashboard');
const devices = dashboard.body['devices'] as Array<Record<string, unknown>>;

for (const device of devices) {
  const id = String(device['id']);
  const name = String(device['name']);

  const result = await call('POST', `/api/devices/${id}/remote-check/disable`);
  if (result.status !== 200) {
    console.log(`  ${name}: FAILED ${String(result.body['error'])}`);
    continue;
  }

  const health = await call('POST', `/api/devices/${id}/check`);
  const warnings = (health.body['warnings'] as string[]) ?? [];
  console.log(`  ${name}: remote check disabled, status=${String(health.body['status'])}`);
  if (warnings.length === 0) {
    console.log('    no outstanding warnings');
  }
  for (const warning of warnings) {
    console.log(`    warn: ${warning}`);
  }
}

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
