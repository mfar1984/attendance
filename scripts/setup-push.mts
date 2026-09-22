/**
 * Points each terminal's notification slot at our ingest endpoint, then waits to
 * see whether anything actually arrives.
 *
 * Configuring push is not the same as push working: the terminal accepts the
 * settings without testing them, and if it cannot reach us it reports nothing and
 * simply drops every event. The heartbeat is the proof, which is why this script
 * waits for one instead of declaring success after the write.
 *
 * Push remains an optimisation regardless. The firmware keeps no queue and never
 * retries, so the reconcile pull stays the safety net.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/setup-push.mts <password> [serverIp]
 */
import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const serverIp = process.argv[3] ?? '192.168.1.102';
const port = Number(process.env['PORT'] ?? 8080);
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: setup-push.mts <adminPassword> [serverIp]');
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

console.log(`=== Configuring push to ${serverIp}:${port}/hik/events ===`);
for (const device of devices) {
  const id = String(device['id']);
  const name = String(device['name']);

  const result = await call('POST', `/api/devices/${id}/push`, {
    host: serverIp,
    port,
    path: '/hik/events',
    useHttps: false,
    slot: 1,
  });

  console.log(
    result.status === 200
      ? `  ${name}: ${String(result.body['configured'])}`
      : `  ${name}: FAILED ${String(result.body['error'])}`,
  );
}

console.log('\n=== Reading the configuration back off the terminals ===');
for (const device of devices) {
  const id = String(device['id']);
  const hosts = (await call('GET', `/api/devices/${id}/push`)).body as unknown as Array<
    Record<string, unknown>
  >;
  for (const host of hosts) {
    const address = String(host['hostName'] || host['ipAddress'] || '(unset)');
    console.log(
      `  slot ${String(host['id'])}: ${String(host['protocolType'])} ${address}:${String(host['portNo'])}` +
        `${String(host['url'])} auth=${String(host['httpAuthenticationMethod'])}`,
    );
  }
}

/**
 * Baseline taken before waiting, so an event that arrives during the wait is
 * distinguishable from one already stored by the pull worker.
 */
const before = await pushCount();
console.log(`\n=== Waiting 75s for a heartbeat or event (arrivedVia='push') ===`);
console.log(`  pushed rows before: ${before}`);

await new Promise((resolve) => setTimeout(resolve, 75_000));

const after = await pushCount();
const health = await call('GET', '/api/ingest/stats');
const stats = health.body;

console.log(`  pushed rows after : ${after}`);
console.log(`  heartbeats seen   : ${String(stats['heartbeats'] ?? 'n/a')}`);
console.log(`  auth rejections   : ${String(stats['rejected'] ?? 'n/a')}`);
console.log(`  last contact      : ${String(stats['lastContactAt'] ?? 'never')}`);

if (Number(stats['heartbeats'] ?? 0) > 0 || after > before) {
  console.log('\n  Push is reaching the server.\n');
} else {
  console.log(
    '\n  Nothing arrived. The terminal accepted the settings but cannot reach us.\n' +
      '  Most likely the Windows Firewall is dropping inbound connections to this\n' +
      `  port. Allow it with, as Administrator:\n\n` +
      `    New-NetFirewallRule -DisplayName "Attendance ingest ${port}" \`\n` +
      `      -Direction Inbound -Protocol TCP -LocalPort ${port} -Action Allow\n\n` +
      '  Attendance keeps working either way: the reconcile pull collects the same\n' +
      '  events every 60s. Push only makes them realtime.\n',
  );
}

async function pushCount(): Promise<number> {
  const result = await call('GET', '/api/ingest/stats');
  return Number(result.body['pushedEvents'] ?? 0);
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
