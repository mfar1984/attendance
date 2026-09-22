/**
 * Operational snapshot: terminals, ingest health and the review queues.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/status.mts <password>
 */
import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: status.mts <adminPassword>');
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

const dashboard = (await call('GET', '/api/dashboard')).body;
const ingest = (await call('GET', '/api/ingest/stats')).body;
const unmapped = (await call('GET', '/api/identity/unmapped')).body as unknown as unknown[];
const unconfirmed = (await call('GET', '/api/identity/unconfirmed')).body as unknown as unknown[];

console.log('\n=== Terminals ===');
for (const device of dashboard['devices'] as Array<Record<string, unknown>>) {
  console.log(
    `  ${String(device['name']).padEnd(16)} ${String(device['status']).padEnd(9)} ` +
      `drift=${String(device['clockDriftSeconds'])}s (${String(device['clockMode'])})  ` +
      `serial=#${String(device['lastSerialNo'])}  ` +
      `enrolled=${String(device['enrolled'])}/${String(device['capacity'])}`,
  );
}

console.log('\n=== Ingest ===');
row('events via push', ingest['pushedEvents']);
row('events via pull', ingest['pulledEvents']);
row('heartbeats', ingest['heartbeats']);
row('auth rejections', ingest['rejected']);
// A non-zero count here means the terminal is talking to us and we are throwing
// the payload away, which is worse than it being unreachable.
row('undecodable bodies', ingest['undecodable']);
row('last contact', ingest['lastContactAt'] ?? 'never');

console.log('\n=== Needs a human ===');
row('unmapped terminal ids', unmapped.length);
row('mappings unconfirmed', unconfirmed.length);
row('open exceptions', (dashboard['exceptions'] as unknown[]).length);
row('staff without biometrics', (dashboard['today'] as Record<string, unknown>)['missingBiometrics']);
console.log('');

function row(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(26)} ${String(value)}`);
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
