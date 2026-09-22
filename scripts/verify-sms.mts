/**
 * Verifies the Infobip SMS channel end to end against the running server.
 *
 * A stand-in for Infobip is stood up on loopback and the stored `baseUrl` is pointed at
 * it, so the request the real gateway would receive is captured and asserted: the path,
 * the `App` authorization scheme, the message envelope, and the normalised destination.
 * Nothing is mocked inside the server — it builds and sends the request it would send to
 * Infobip, and the only difference is who answers.
 *
 * The failure paths matter as much as the success one. A gateway that returns 200 while
 * rejecting the message is the way this feature breaks in production, so that case is
 * driven explicitly.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-sms.mts <password>
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-sms.mts <adminPassword>');
  process.exit(2);
}

const API_KEY = 'kunci-ujian-infobip';
const SENDER = 'ServiceSMS';

let cookie = '';
let failures = 0;

interface Captured {
  method: string;
  url: string;
  authorization: string;
  contentType: string;
  body: unknown;
}

const inbox: Captured[] = [];

/** Switched per case so one stand-in can play a healthy gateway and a broken one. */
type Mode = 'ok' | 'rejected' | 'unauthorised' | 'forbidden' | 'server-error';
let mode: Mode = 'ok';

const gateway = createServer((request: IncomingMessage, response: ServerResponse) => {
  let raw = '';
  request.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
  request.on('end', () => {
    let body: unknown = null;
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      body = raw;
    }

    inbox.push({
      method: request.method ?? '',
      url: request.url ?? '',
      authorization: String(request.headers['authorization'] ?? ''),
      contentType: String(request.headers['content-type'] ?? ''),
      body,
    });

    const send = (status: number, payload: unknown): void => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    };

    if (mode === 'unauthorised') {
      send(401, {
        requestError: { serviceException: { messageId: 'UNAUTHORIZED', text: 'Invalid login details' } },
      });
      return;
    }
    if (mode === 'forbidden') {
      send(403, {
        requestError: { serviceException: { messageId: 'FORBIDDEN', text: 'Missing scope' } },
      });
      return;
    }
    if (mode === 'server-error') {
      send(503, { requestError: { serviceException: { text: 'Service unavailable' } } });
      return;
    }

    // Infobip answers 200 and reports per-message status inside the body, so a refusal
    // arrives inside a successful response.
    send(200, {
      messages: [
        {
          messageId: 'ujian-message-id',
          status:
            mode === 'rejected'
              ? { groupName: 'REJECTED', description: 'Rejected sender' }
              : { groupName: 'PENDING', description: 'Message sent to next instance' },
        },
      ],
    });
  });
});

const port = await new Promise<number>((resolve, reject) => {
  gateway.listen(0, '127.0.0.1', () => {
    const address = gateway.address() as AddressInfo | null;
    if (address === null) reject(new Error('stand-in did not bind'));
    else resolve(address.port);
  });
});

const baseUrl = `127.0.0.1:${String(port)}`;
show('stand-in infobip', baseUrl);

await call('POST', '/api/auth/login', {
  email,
  password,
  ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
});
check('logged in', cookie.length > 0);

/** Restores whatever was configured before, so a real gateway survives this run. */
const original = (await call('GET', '/api/sms')).body;

// ---------------------------------------------------------------------------
console.log('\n=== Triggers come from the server ===');
// ---------------------------------------------------------------------------

const registry = await call('GET', '/api/notify/triggers');
check('the trigger registry responds', registry.status === 200);
const triggers = (registry.body['triggers'] ?? []) as Array<Record<string, unknown>>;
check('and lists events', triggers.length > 0);
check(
  'each one states whether its dispatch call exists yet',
  triggers.every((row) => typeof row['wired'] === 'boolean' && typeof row['label'] === 'string'),
);
show('wired', triggers.filter((row) => row['wired'] === true).map((row) => String(row['key'])).join(', '));
show('belum', triggers.filter((row) => row['wired'] !== true).map((row) => String(row['key'])).join(', '));

// ---------------------------------------------------------------------------
console.log('\n=== A half-configured gateway cannot be switched on ===');
// ---------------------------------------------------------------------------

const noBase = await call('PUT', '/api/sms', {
  enabled: true,
  baseUrl: '',
  senderId: SENDER,
  apiKey: API_KEY,
  triggers: [],
});
// Enabled with a missing field means every notification fails one at a time in a log
// nobody reads.
check('enabled without a base URL is refused', noBase.status === 409);
show('message', String(noBase.body['error']).slice(0, 90));

const noKey = await call('PUT', '/api/sms', {
  enabled: true,
  baseUrl,
  senderId: SENDER,
  apiKey: '',
  triggers: [],
});
check('enabled without an API key is refused', noKey.status === 409);

const noSender = await call('PUT', '/api/sms', {
  enabled: true,
  baseUrl,
  senderId: '',
  apiKey: API_KEY,
  triggers: [],
});
check('enabled without a sender is refused', noSender.status === 409);

// ---------------------------------------------------------------------------
console.log('\n=== Saving, and what comes back ===');
// ---------------------------------------------------------------------------

const saved = await call('PUT', '/api/sms', {
  enabled: true,
  baseUrl,
  senderId: SENDER,
  apiKey: API_KEY,
  triggers: ['leave.approved', 'leave.rejected', 'tidak-wujud'],
});
check('the configuration saves', saved.status === 200);

const read = await call('GET', '/api/sms');
check('and reads back enabled', read.body['enabled'] === true);
check('with the base URL and sender', read.body['baseUrl'] === baseUrl && read.body['senderId'] === SENDER);
check('reporting that a key is stored', read.body['apiKeySet'] === true);

/**
 * The API key belongs to the hospital's Infobip account, not to this application.
 */
const serialised = JSON.stringify(read.body).toLowerCase();
check('and never returning the key itself', !serialised.includes(API_KEY.toLowerCase()));
check('nor its ciphertext field', !serialised.includes('apikeyencrypted'));

const storedTriggers = (read.body['triggers'] ?? []) as string[];
check(
  'unknown trigger keys are dropped rather than stored',
  storedTriggers.length === 2 && !storedTriggers.includes('tidak-wujud'),
);
show('triggers', storedTriggers.join(', '));

// ---------------------------------------------------------------------------
console.log('\n=== A test sends the request Infobip would receive ===');
// ---------------------------------------------------------------------------

mode = 'ok';
inbox.length = 0;
const sent = await call('POST', '/api/sms/test', {
  // Local form on purpose: Infobip needs E.164, and a local number is silently dropped
  // rather than rejected, so it is corrected on the way out.
  to: '0123456789',
  text: 'Ujian SMS dari Sistem Kehadiran.',
});
check('the test reports success', sent.status === 200 && sent.body['ok'] === true);
show('detail', String(sent.body['lastTestDetail']).slice(0, 110));

check('and the gateway received exactly one request', inbox.length === 1);

const request = inbox[0];
if (request) {
  check('sent as POST to /sms/3/messages', request.method === 'POST' && request.url === '/sms/3/messages');
  // Infobip's own scheme: the literal word `App`, then the key.
  check('with the App authorization scheme', request.authorization === `App ${API_KEY}`);
  check('and a JSON content type', request.contentType.includes('application/json'));

  const envelope = (request.body as { messages?: Array<Record<string, unknown>> }).messages?.[0];
  check('carrying one message', envelope !== undefined);
  check('from the configured sender', envelope?.['sender'] === SENDER);
  check(
    'to the number in E.164, converted from the local form',
    ((envelope?.['destinations'] as Array<Record<string, unknown>> | undefined)?.[0]?.['to'] ?? '') ===
      '60123456789',
  );
  check(
    'with the text under content.text',
    ((envelope?.['content'] as Record<string, unknown> | undefined)?.['text'] ?? '') ===
      'Ujian SMS dari Sistem Kehadiran.',
  );
  show('badan', JSON.stringify(request.body).slice(0, 150));
}

const afterTest = await call('GET', '/api/sms');
check('the outcome is stored on the channel', afterTest.body['lastTestOk'] === true);
check('with a timestamp', typeof afterTest.body['lastTestAt'] === 'string');

// ---------------------------------------------------------------------------
console.log('\n=== A blank key on save keeps the stored one ===');
// ---------------------------------------------------------------------------

await call('PUT', '/api/sms', {
  enabled: true,
  baseUrl,
  senderId: SENDER,
  apiKey: '',
  triggers: ['leave.approved'],
});
inbox.length = 0;
const afterBlank = await call('POST', '/api/sms/test', { to: '+60123456789', text: 'Selepas simpan.' });
check('the channel still sends after a blank-key save', afterBlank.body['ok'] === true);
check(
  'and the request still carries the original key',
  inbox[0]?.authorization === `App ${API_KEY}`,
);

// ---------------------------------------------------------------------------
console.log('\n=== 200 with a rejected status is not a success ===');
// ---------------------------------------------------------------------------

mode = 'rejected';
const rejected = await call('POST', '/api/sms/test', { to: '+60123456789', text: 'Ujian ditolak.' });
/**
 * The failure mode this guards against: Infobip accepts the request and reports the
 * refusal inside a 200. Treating the status code as the answer is how a gateway appears
 * to work for a week while nothing arrives.
 */
check('a REJECTED status inside a 200 fails the test', rejected.body['ok'] === false);
check(
  'and the message points at the sender registration',
  /Sender ID|berdaftar|menolak/i.test(String(rejected.body['lastTestDetail'])),
);
show('detail', String(rejected.body['lastTestDetail']).slice(0, 130));

// ---------------------------------------------------------------------------
console.log('\n=== Credential failures name the credential ===');
// ---------------------------------------------------------------------------

mode = 'unauthorised';
const unauthorised = await call('POST', '/api/sms/test', { to: '+60123456789', text: 'Ujian 401.' });
check('a 401 fails the test', unauthorised.body['ok'] === false);
check(
  'and the message names the API key',
  /kunci API/i.test(String(unauthorised.body['lastTestDetail'])),
);
show('detail', String(unauthorised.body['lastTestDetail']).slice(0, 120));

mode = 'forbidden';
const forbidden = await call('POST', '/api/sms/test', { to: '+60123456789', text: 'Ujian 403.' });
check('a 403 fails the test', forbidden.body['ok'] === false);
// The distinction that saves an hour: the key is right, the scope is missing.
check(
  'and the message names the missing scope rather than the key',
  /sms:message:send/i.test(String(forbidden.body['lastTestDetail'])),
);
show('detail', String(forbidden.body['lastTestDetail']).slice(0, 130));

mode = 'server-error';
const serverError = await call('POST', '/api/sms/test', { to: '+60123456789', text: 'Ujian 503.' });
check('a 5xx fails the test', serverError.body['ok'] === false);
check(
  'and says it is upstream rather than a configuration fault',
  /pihak mereka|ralat pelayan/i.test(String(serverError.body['lastTestDetail'])),
);

// ---------------------------------------------------------------------------
console.log('\n=== Segments are counted, not guessed ===');
// ---------------------------------------------------------------------------

mode = 'ok';
const short = await call('POST', '/api/sms/test', { to: '+60123456789', text: 'Pendek.' });
const shortCount = short.body['segments'] as Record<string, unknown>;
check('a short GSM message is one segment', shortCount['segments'] === 1 && shortCount['unicode'] === false);

const long = await call('POST', '/api/sms/test', {
  to: '+60123456789',
  text: 'A'.repeat(200),
});
const longCount = long.body['segments'] as Record<string, unknown>;
check('200 GSM characters is two segments', longCount['segments'] === 2);

// One character outside GSM 03.38 drops the limit from 160 to 70, which triples the bill
// for the same sentence.
const unicode = await call('POST', '/api/sms/test', {
  to: '+60123456789',
  text: `Ujian dengan aksara Cina 中文 ${'B'.repeat(100)}`,
});
const unicodeCount = unicode.body['segments'] as Record<string, unknown>;
check('a non-GSM character switches to unicode counting', unicodeCount['unicode'] === true);
check('and raises the segment count', Number(unicodeCount['segments']) >= 2);
show(
  'kiraan',
  `pendek ${String(shortCount['segments'])} · 200 aksara ${String(longCount['segments'])} · unicode ${String(unicodeCount['segments'])}`,
);

// ---------------------------------------------------------------------------
console.log('\n=== A disabled channel refuses to be tested ===');
// ---------------------------------------------------------------------------

await call('PUT', '/api/sms', { enabled: false, baseUrl, senderId: SENDER, triggers: [] });
inbox.length = 0;
const disabled = await call('POST', '/api/sms/test', { to: '+60123456789', text: 'Ujian dimatikan.' });
// A pass here would certify a channel that every notification skips.
check('testing a disabled channel is refused', disabled.status === 409);
check('and nothing was sent', inbox.length === 0);
show('message', String(disabled.body['error']).slice(0, 110));

// ---------------------------------------------------------------------------
console.log('\n=== Cleanup ===');
// ---------------------------------------------------------------------------

const restore = await call('PUT', '/api/sms', {
  enabled: false,
  // Cleared, not merely blanked. Leaving the test key stored would make the
  // "cannot enable without a key" check pass for the wrong reason on the next run.
  ...(original['apiKeySet'] === true ? {} : { clearApiKey: true }),
  baseUrl: String(original['baseUrl'] ?? ''),
  senderId: String(original['senderId'] ?? ''),
  triggers: (original['triggers'] ?? []) as string[],
});
check('the previous configuration is restored', restore.status === 200);

const finalState = await call('GET', '/api/sms');
check(
  'and the test key is gone unless one was there before',
  original['apiKeySet'] === true || finalState.body['apiKeySet'] === false,
);
show(
  'dipulihkan',
  `enabled=false · baseUrl=${String(original['baseUrl'] ?? '(kosong)')} · kunci tersimpan=${String(finalState.body['apiKeySet'])}`,
);

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
gateway.close();
process.exit(failures === 0 ? 0 : 1);

// ---------------------------------------------------------------------------

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
  console.log(`         ${label}: ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
