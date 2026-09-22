/**
 * Verifies the live stream end to end.
 *
 * Opens the SSE connection, then posts a synthetic event through the real ingest
 * endpoint - Digest handshake included - and checks it arrives on the stream. The
 * payload is shaped like the terminal's push format so the mapping from
 * `majorEventType`/`subEventType` is exercised rather than assumed.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-stream.mts <password>
 */
import { createHash, randomBytes } from 'node:crypto';

import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];
const ingestUser = process.env['INGEST_USERNAME'] ?? 'hikpush';
const ingestPass = process.env['INGEST_PASSWORD'] ?? '';

if (!password) {
  console.error('Usage: verify-stream.mts <adminPassword>');
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

console.log('\n=== Opening the live stream ===');
const received: Array<Record<string, unknown>> = [];
const controller = new AbortController();
let ready = false;

const streamPromise = (async () => {
  const response = await fetch(`${BASE}/api/stream/scans`, {
    headers: { cookie, accept: 'text/event-stream' },
    signal: controller.signal,
  });

  if (!response.ok || !response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const eventName = /^event:\s*(.+)$/m.exec(frame)?.[1]?.trim();
      const data = /^data:\s*(.+)$/m.exec(frame)?.[1];

      if (eventName === 'ready') ready = true;
      if (eventName === 'scan' && data) {
        try {
          received.push(JSON.parse(data) as Record<string, unknown>);
        } catch {
          // ignore
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
})();

await wait(600);
check('stream sends a ready frame', ready);

console.log('\n=== Posting a synthetic event through the ingest endpoint ===');
if (ingestPass.length === 0) {
  console.log('  INGEST_PASSWORD is unset; skipping.');
} else {
  const device = await firstDevice();
  if (!device) {
    console.log('  No registered terminal; skipping.');
  } else {
    // Above the stored range so it is treated as new rather than a duplicate.
    const serialNo = 900_000 + Math.floor(Math.random() * 90_000);
    const payload = {
      ipAddress: device.host,
      macAddress: device.macAddress ?? undefined,
      dateTime: new Date().toISOString(),
      eventType: 'AccessControllerEvent',
      AccessControllerEvent: {
        // Push uses these names, not `major`/`minor` as the search API does.
        majorEventType: 5,
        subEventType: 75,
        serialNo,
        employeeNoString: '1',
        name: 'Mohamad Faizan Bin Abdul Rahman',
        currentVerifyMode: 'faceOrFpOrCardOrPw',
      },
    };

    const status = await postDigest('/hik/events', payload);
    check('ingest accepts the event', status === 200);
    show('serialNo used', String(serialNo));

    await wait(1200);
    const match = received.find((scan) => String(scan['serialNo']) === String(serialNo));
    check('the event arrives on the live stream', match !== undefined);

    if (match) {
      show('name', String(match['name']));
      show('device', String(match['deviceName']));
      show('method', String(match['method']));
      show('suppressed', String(match['suppressed']));
      show('problem', String(match['problem'] ?? 'tiada'));
      // A scan seconds after an accepted one falls inside the dedup window, so
      // this is expected to be flagged rather than counted twice.
      check('a resolved staff member is attached', match['staffId'] !== null);
    }
  }
}

controller.abort();
await streamPromise.catch(() => undefined);

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);

async function firstDevice(): Promise<{ host: string; macAddress: string | null } | null> {
  const result = await call('GET', '/api/devices');
  const devices = result.body as unknown as Array<Record<string, unknown>>;
  const device = devices[0];
  if (!device) return null;
  return {
    host: String(device['host']),
    macAddress: device['macAddress'] === null ? null : String(device['macAddress']),
  };
}

/** Performs the two-leg Digest handshake the terminal uses. */
async function postDigest(path: string, payload: unknown): Promise<number> {
  const body = JSON.stringify(payload);
  const first = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

  if (first.status !== 401) return first.status;

  const header = first.headers.get('www-authenticate') ?? '';
  const params: Record<string, string> = {};
  for (const match of header.matchAll(/([a-z0-9_-]+)="?([^",]+)"?/gi)) {
    if (match[1]) params[match[1].toLowerCase()] = match[2] ?? '';
  }

  const md5 = (value: string): string => createHash('md5').update(value).digest('hex');
  const nc = '00000001';
  const cnonce = randomBytes(8).toString('hex');
  const ha1 = md5(`${ingestUser}:${params['realm']}:${ingestPass}`);
  const ha2 = md5(`POST:${path}`);
  const response = md5(`${ha1}:${params['nonce']}:${nc}:${cnonce}:auth:${ha2}`);

  const second = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization:
        `Digest username="${ingestUser}", realm="${params['realm']}", ` +
        `nonce="${params['nonce']}", uri="${path}", response="${response}", ` +
        `qop=auth, nc=${nc}, cnonce="${cnonce}"`,
    },
    body,
  });

  return second.status;
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function show(label: string, value: string): void {
  console.log(`  ${label.padEnd(24)} ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
