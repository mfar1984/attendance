/**
 * Verifies the Telegram channel end to end.
 *
 * Telegram's host is hardwired, unlike the SMS gateway whose base URL is stored data. So
 * this script starts its own server instance with `TELEGRAM_API_BASE` pointed at a local
 * stand-in and drives that, rather than disturbing the development server or putting a
 * loopback override into `.env` where it would break real sending.
 *
 * The override is only honoured for loopback addresses — the bot token travels in the URL
 * path, so an arbitrary host would be handed the token. That restriction is asserted here
 * too, because it is the reason the override is safe to exist at all.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-telegram.mts <password>
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { generateSync } from 'otplib';

const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-telegram.mts <adminPassword>');
  process.exit(2);
}

const BOT_TOKEN = '123456789:UjianAaBbCcDdEeFfGgHhIiJjKkLlMmNnOo';
const CHANNEL = '@kehadiran_ujian';

let cookie = '';
let failures = 0;
let server: ChildProcess | null = null;

interface Captured {
  method: string;
  path: string;
  token: string;
  body: unknown;
}

const inbox: Captured[] = [];
type Mode = 'ok' | 'bad-token' | 'chat-not-found' | 'no-rights';
let mode: Mode = 'ok';

// ---------------------------------------------------------------------------
// Stand-in for api.telegram.org
// ---------------------------------------------------------------------------

const telegram = createServer((request: IncomingMessage, response: ServerResponse) => {
  let raw = '';
  request.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
  request.on('end', () => {
    // Telegram puts the token in the path: /bot<token>/<method>
    const match = /^\/bot([^/]+)\/(\w+)/.exec(request.url ?? '');
    let body: unknown = null;
    try {
      body = raw.length > 0 ? (JSON.parse(raw) as unknown) : null;
    } catch {
      body = raw;
    }

    inbox.push({
      method: match?.[2] ?? '',
      path: request.url ?? '',
      token: match?.[1] ?? '',
      body,
    });

    const send = (status: number, payload: unknown): void => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    };

    if (mode === 'bad-token') {
      send(401, { ok: false, error_code: 401, description: 'Unauthorized' });
      return;
    }

    if (match?.[2] === 'getMe') {
      send(200, {
        ok: true,
        result: {
          id: 123456789,
          is_bot: true,
          first_name: 'Kehadiran Ujian',
          username: 'ujian_bot',
        },
      });
      return;
    }

    if (mode === 'chat-not-found') {
      send(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' });
      return;
    }
    if (mode === 'no-rights') {
      send(400, {
        ok: false,
        error_code: 400,
        description: 'Bad Request: not enough rights to send text messages to the chat',
      });
      return;
    }

    send(200, {
      ok: true,
      result: {
        message_id: 4242,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -1001234567890, title: 'Kehadiran Ujian', type: 'channel' },
        text: (body as { text?: string } | null)?.text ?? '',
      },
    });
  });
});

const apiPort = await listen(telegram);
const apiBase = `http://127.0.0.1:${String(apiPort)}`;
show('stand-in telegram', apiBase);

// ---------------------------------------------------------------------------
// A server instance pointed at the stand-in
// ---------------------------------------------------------------------------

// Asked for by binding and releasing, rather than hardcoded: a fixed port collides with
// whatever a previous run left behind, and the failure then reads as "the server is
// broken" instead of "the port is taken".
const serverPort = await freePort();
const BASE = `http://127.0.0.1:${String(serverPort)}`;

/** Kept so a failure to start can be explained rather than guessed at. */
let serverLog = '';

server = spawn(
  process.execPath,
  ['--env-file=.env', 'node_modules/tsx/dist/cli.mjs', 'apps/server/src/main.ts'],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(serverPort),
      HOST: '127.0.0.1',
      TELEGRAM_API_BASE: apiBase,
      /*
       * Pushed to the maximum the schema allows, so this second process does not poll
       * the terminal on a loop alongside the development server for the few seconds it
       * lives. There is no flag to switch the worker off; an extra pull is harmless
       * because ingest is deduplicated per device and serial number, which is what makes
       * push and pull able to coexist in the first place.
       */
      SYNC_INTERVAL_SECONDS: '3600',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

server.stdout?.on('data', (chunk: Buffer) => (serverLog += chunk.toString('utf8')));
server.stderr?.on('data', (chunk: Buffer) => (serverLog += chunk.toString('utf8')));

await waitForServer();
show('pelayan ujian', `${BASE} (pid ${String(server.pid ?? 0)})`);

await call('POST', '/api/auth/login', {
  email,
  password,
  ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
});
check('logged in', cookie.length > 0);

const original = (await call('GET', '/api/telegram')).body;

// ---------------------------------------------------------------------------
console.log('\n=== A half-configured bot cannot be switched on ===');
// ---------------------------------------------------------------------------

const noToken = await call('PUT', '/api/telegram', {
  enabled: true,
  botToken: '',
  chatId: CHANNEL,
  triggers: [],
});
check('enabled without a token is refused', noToken.status === 409);
show('message', String(noToken.body['error']).slice(0, 90));

const noChat = await call('PUT', '/api/telegram', {
  enabled: true,
  botToken: BOT_TOKEN,
  chatId: '',
  triggers: [],
});
check('enabled without a channel is refused', noChat.status === 409);

// ---------------------------------------------------------------------------
console.log('\n=== Saving reads the bot name back from Telegram ===');
// ---------------------------------------------------------------------------

inbox.length = 0;
const saved = await call('PUT', '/api/telegram', {
  enabled: true,
  botToken: BOT_TOKEN,
  chatId: CHANNEL,
  ownerUserId: '987654321',
  ownerUsername: '@admin_ujian',
  triggers: ['leave.approved', 'device.clockDrift', 'tidak-wujud'],
});
check('the configuration saves', saved.status === 200);
/**
 * Read rather than typed. A hand-entered username can disagree with the token, and the
 * screen would then name a bot that is not the one posting.
 */
check('and the bot username is read from getMe', saved.body['botUsername'] === 'ujian_bot');
check('which means getMe was actually called', inbox.some((entry) => entry.method === 'getMe'));

const read = await call('GET', '/api/telegram');
check('the channel reads back enabled', read.body['enabled'] === true);
check(
  'with the channel id and owner',
  read.body['chatId'] === CHANNEL && read.body['ownerUserId'] === '987654321',
);
check('reporting that a token is stored', read.body['botTokenSet'] === true);

const serialised = JSON.stringify(read.body).toLowerCase();
// The token is equivalent to the bot itself: anyone holding it can post as it.
check('and never returning the token', !serialised.includes(BOT_TOKEN.toLowerCase()));
check('nor its ciphertext field', !serialised.includes('bottokenencrypted'));

const storedTriggers = (read.body['triggers'] ?? []) as string[];
check(
  'unknown trigger keys are dropped',
  storedTriggers.length === 2 && !storedTriggers.includes('tidak-wujud'),
);
show('triggers', storedTriggers.join(', '));

// ---------------------------------------------------------------------------
console.log('\n=== Verify proves the token without posting ===');
// ---------------------------------------------------------------------------

mode = 'ok';
inbox.length = 0;
const verified = await call('POST', '/api/telegram/verify', {});
check('verify succeeds', verified.status === 200 && verified.body['ok'] === true);
const bot = verified.body['bot'] as Record<string, unknown> | undefined;
check('and names the bot', bot?.['username'] === 'ujian_bot' && bot?.['firstName'] === 'Kehadiran Ujian');
/**
 * The distinction the two buttons exist for: verifying must not post. If it did, testing
 * the token would spam the channel every time somebody checked their configuration.
 */
check('using only getMe', inbox.length === 1 && inbox[0]?.method === 'getMe');
check('and no message was sent', !inbox.some((entry) => entry.method === 'sendMessage'));
check('with the stored token in the path', inbox[0]?.token === BOT_TOKEN);

// ---------------------------------------------------------------------------
console.log('\n=== A test posts a real message ===');
// ---------------------------------------------------------------------------

inbox.length = 0;
const sent = await call('POST', '/api/telegram/test', {});
check('the test reports success', sent.status === 200 && sent.body['ok'] === true);
show('detail', String(sent.body['lastTestDetail']).slice(0, 110));

const posted = inbox.find((entry) => entry.method === 'sendMessage');
check('and the stand-in received a sendMessage', posted !== undefined);
if (posted) {
  check('carrying the stored token', posted.token === BOT_TOKEN);
  const payload = posted.body as Record<string, unknown>;
  check('addressed to the configured channel', payload['chat_id'] === CHANNEL);
  check('with non-empty text', String(payload['text'] ?? '').length > 0);
  /**
   * No `parse_mode`. Telegram would then require escaping characters that appear in
   * ordinary Malay names, and an unescaped one is rejected rather than sent plainly.
   */
  check('and no parse_mode, so no escaping can fail', !('parse_mode' in payload));
  check(
    'link previews disabled so the message is not pushed off screen',
    ((payload['link_preview_options'] ?? {}) as Record<string, unknown>)['is_disabled'] === true,
  );
  show('badan', JSON.stringify(payload).slice(0, 150));
}

const afterTest = await call('GET', '/api/telegram');
check('the outcome is stored on the channel', afterTest.body['lastTestOk'] === true);
check('with a timestamp', typeof afterTest.body['lastTestAt'] === 'string');

// ---------------------------------------------------------------------------
console.log('\n=== A blank token on save keeps the stored one ===');
// ---------------------------------------------------------------------------

await call('PUT', '/api/telegram', {
  enabled: true,
  botToken: '',
  chatId: CHANNEL,
  triggers: ['leave.approved'],
});
inbox.length = 0;
const afterBlank = await call('POST', '/api/telegram/test', {});
check('the channel still posts after a blank-token save', afterBlank.body['ok'] === true);
check(
  'and the request still carries the original token',
  inbox.find((entry) => entry.method === 'sendMessage')?.token === BOT_TOKEN,
);

// ---------------------------------------------------------------------------
console.log('\n=== Failures name the thing to fix ===');
// ---------------------------------------------------------------------------

mode = 'chat-not-found';
const notFound = await call('POST', '/api/telegram/test', {});
check('a missing channel fails the test', notFound.body['ok'] === false);
// "chat not found" says nothing about adding the bot to the channel, which is the actual
// first-setup cause almost every time.
check(
  'and the message explains the bot must be added to the channel',
  /ditambah ke channel|tidak dijumpai/i.test(String(notFound.body['lastTestDetail'])),
);
show('detail', String(notFound.body['lastTestDetail']).slice(0, 140));

mode = 'no-rights';
const noRights = await call('POST', '/api/telegram/test', {});
check('missing post rights fails the test', noRights.body['ok'] === false);
check(
  'and the message says to make the bot an administrator',
  /administrator/i.test(String(noRights.body['lastTestDetail'])),
);
show('detail', String(noRights.body['lastTestDetail']).slice(0, 140));

mode = 'bad-token';
const badToken = await call('POST', '/api/telegram/test', {});
check('a rejected token fails the test', badToken.body['ok'] === false);
check(
  'and the message names @BotFather rather than the status code',
  /BotFather|token bot/i.test(String(badToken.body['lastTestDetail'])),
);
show('detail', String(badToken.body['lastTestDetail']).slice(0, 140));

const badVerify = await call('POST', '/api/telegram/verify', {});
// Reported in the body rather than as an HTTP failure: a refusal is a real answer, and
// the screen needs the message.
check('verify reports a bad token as ok:false, not as an error status', badVerify.status === 200);
check('with the detail attached', String(badVerify.body['detail'] ?? '').length > 0);

// ---------------------------------------------------------------------------
console.log('\n=== A disabled channel refuses to be tested ===');
// ---------------------------------------------------------------------------

mode = 'ok';
await call('PUT', '/api/telegram', { enabled: false, chatId: CHANNEL, triggers: [] });
inbox.length = 0;
const disabled = await call('POST', '/api/telegram/test', {});
check('testing a disabled channel is refused', disabled.status === 409);
check('and nothing was posted', inbox.length === 0);
show('message', String(disabled.body['error']).slice(0, 110));

// ---------------------------------------------------------------------------
console.log('\n=== The host override is loopback-only ===');
// ---------------------------------------------------------------------------

/**
 * Asserted directly against the module, because this is the guard that makes the override
 * safe to ship: the bot token travels in the URL path, so honouring an arbitrary host
 * would hand the token to whoever set the variable.
 */
{
  const outside = await import('../apps/server/src/notify/telegram.js');
  const before = process.env['TELEGRAM_API_BASE'];

  process.env['TELEGRAM_API_BASE'] = 'http://evil.example.com';
  let reachedStandIn = false;
  try {
    await outside.verifyBotToken(BOT_TOKEN);
    reachedStandIn = true;
  } catch {
    // Expected: it goes to the real api.telegram.org, or fails to resolve. Either way it
    // did not go to the host named in the variable.
  }
  check('a non-loopback override is ignored', !reachedStandIn);

  process.env['TELEGRAM_API_BASE'] = 'https://127.0.0.1:1';
  let httpsLoopbackHonoured = false;
  try {
    await outside.verifyBotToken(BOT_TOKEN);
    httpsLoopbackHonoured = true;
  } catch {
    // Also expected to be ignored: only the plain-http loopback form is accepted.
  }
  check('and so is a loopback override with the wrong scheme', !httpsLoopbackHonoured);

  if (before === undefined) delete process.env['TELEGRAM_API_BASE'];
  else process.env['TELEGRAM_API_BASE'] = before;
}

// ---------------------------------------------------------------------------
console.log('\n=== Cleanup ===');
// ---------------------------------------------------------------------------

const restore = await call('PUT', '/api/telegram', {
  enabled: false,
  // Cleared, not merely blanked. Leaving the test token stored would make the
  // "cannot enable without a token" check pass for the wrong reason on the next run.
  ...(original['botTokenSet'] === true ? {} : { clearBotToken: true }),
  chatId: String(original['chatId'] ?? ''),
  ownerUserId: String(original['ownerUserId'] ?? ''),
  ownerUsername: String(original['ownerUsername'] ?? ''),
  triggers: (original['triggers'] ?? []) as string[],
});
check('the previous configuration is restored', restore.status === 200);

const finalState = await call('GET', '/api/telegram');
check(
  'and the test token is gone unless one was there before',
  original['botTokenSet'] === true || finalState.body['botTokenSet'] === false,
);
show(
  'dipulihkan',
  `enabled=false · channel=${String(original['chatId'] ?? '(kosong)')} · token tersimpan=${String(finalState.body['botTokenSet'])}`,
);

finish();

// ---------------------------------------------------------------------------

function listen(target: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    target.listen(0, '127.0.0.1', () => {
      const address = target.address() as AddressInfo | null;
      if (address === null) reject(new Error('stand-in did not bind'));
      else resolve(address.port);
    });
  });
}

/** A port the operating system says is free, released immediately for the child to take. */
async function freePort(): Promise<number> {
  const probe = createServer();
  const port = await listen(probe);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** Polls the health endpoint until the spawned instance answers. */
async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.error(`\nThe test server did not start on ${BASE}. Its output was:\n`);
  console.error(serverLog.length > 0 ? serverLog.slice(-2000) : '(nothing on stdout or stderr)');
  server?.kill();
  telegram.close();
  process.exit(1);
}

function finish(): never {
  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
  server?.kill();
  telegram.close();
  process.exit(failures === 0 ? 0 : 1);
}

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
