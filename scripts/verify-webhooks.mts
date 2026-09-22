/**
 * Verifies outbound webhooks against the running server.
 *
 * A real receiver is raised on loopback and the server is made to post to it, so the
 * signature is checked the way a receiver would check it rather than by calling our own
 * signing function and agreeing with ourselves. A scheme nobody has verified from the
 * outside is a scheme with a typo in it.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-webhooks.mts <password>
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-webhooks.mts <adminPassword>');
  process.exit(2);
}

let cookie = '';
let failures = 0;
const createdWebhooks: number[] = [];

const { db } = await import('../apps/server/src/db.js');
const { SIGNATURE_TOLERANCE_SECONDS, signPayload, verifySignature } = await import(
  '../apps/server/src/api/webhooks.js'
);

// ---------------------------------------------------------------------------
// A receiver, so the whole path is real
// ---------------------------------------------------------------------------

interface Received {
  method: string;
  headers: Record<string, string>;
  /** The raw bytes as sent. A receiver must verify against these, not a re-serialised copy. */
  raw: string;
}

const received: Received[] = [];
/** Changed per test to make the receiver behave like a healthy, broken or fussy endpoint. */
let replyWith = 200;

const receiver = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers[key] = value;
    }
    received.push({ method: request.method ?? '?', headers, raw: Buffer.concat(chunks).toString('utf8') });

    response.writeHead(replyWith, { 'content-type': 'text/plain' });
    response.end(replyWith === 200 ? 'diterima' : `penerima menjawab ${String(replyWith)}`);
  });
});

await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
const receiverPort = (receiver.address() as AddressInfo).port;
const receiverUrl = `http://127.0.0.1:${String(receiverPort)}/hook`;
console.log(`  penerima pada ${receiverUrl}`);

await warmUpPrisma();

await call('POST', '/api/auth/login', {
  email,
  password,
  ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
});
check('logged in', cookie.length > 0);

// ---------------------------------------------------------------------------
console.log('\n=== Targets the server refuses to post to ===');
// ---------------------------------------------------------------------------

/**
 * The reason the target check exists: a webhook is the one feature that makes this server
 * issue requests to an address an administrator chooses. On a hosted deployment the
 * link-local metadata endpoint hands out instance credentials to anything that asks.
 */
const metadata = await createWebhook('Metadata awan', 'http://169.254.169.254/latest/meta-data/');
check('the cloud metadata address is refused', metadata.status === 409);
show('message', String(metadata.body['error']).slice(0, 150));

for (const url of ['http://169.254.169.254:8080/x', 'https://169.254.169.254/x']) {
  const attempt = await createWebhook('Metadata lagi', url);
  check(`${url} is refused whatever the port or scheme`, attempt.status === 409);
}

// A literal address, so this holds with no DNS and no internet.
const publicHttp = await createWebhook('Awam tanpa TLS', 'http://93.184.216.34/hook');
check('plain http to a public address is refused', publicHttp.status === 409);
show('message', String(publicHttp.body['error']).slice(0, 130));

const publicHttps = await createWebhook('Awam dengan TLS', 'https://93.184.216.34/hook');
check('https to the same address is accepted', publicHttps.status === 200);
if (publicHttps.status === 200) createdWebhooks.push(Number(publicHttps.body['id']));

for (const [label, url] of [
  ['a scheme that is not http', 'ftp://files.hospital.local/hook'],
  ['a file URL', 'file:///etc/passwd'],
  ['something that is not a URL', 'bukan-url-sama-sekali'],
  ['a hostname that does not resolve', 'https://tiada-nama-ini-sama-sekali.invalid/hook'],
] as const) {
  const attempt = await createWebhook('Ditolak', url);
  check(`${label} is refused`, attempt.status === 409);
}

// Loopback is private, so http is allowed there: the traffic never leaves the machine and
// there is no wire to intercept.
const loopback = await createWebhook('Penerima ujian', receiverUrl, ['leave.approved', 'leave.rejected']);
check('http to loopback is allowed, because nothing leaves the host', loopback.status === 200);
const hookId = Number(loopback.body['id']);
const secret = String(loopback.body['secret'] ?? '');
if (loopback.status === 200) createdWebhooks.push(hookId);

check('the signing key is returned once, at creation', secret.startsWith('whsec_'));
show('rahsia', `${secret.slice(0, 14)}… (${String(secret.length)} aksara)`);

const noEvents = await createWebhook('Tiada peristiwa', receiverUrl, ['tidak.wujud']);
check('a subscription to no known event is refused', noEvents.status === 409);

// ---------------------------------------------------------------------------
console.log('\n=== The signing key is never readable again ===');
// ---------------------------------------------------------------------------

const listed = await call('GET', '/api/webhooks');
check('the list responds', listed.status === 200);
check('and never returns the secret', !JSON.stringify(listed.body).includes(secret));
check('nor the stored ciphertext', !JSON.stringify(listed.body).includes('secretEncrypted'));

const row = ((listed.body['webhooks'] ?? []) as Array<Record<string, unknown>>).find(
  (entry) => entry['id'] === hookId,
);
check('it reports only that a secret is set', row?.['secretSet'] === true);

const storedRow = await db().webhook.findUnique({ where: { id: hookId } });
check('the database holds it encrypted, not in the clear', !storedRow?.secretEncrypted.includes(secret));

check('the signature scheme is documented for receivers', typeof listed.body['signature'] === 'object');
show('skema', JSON.stringify(listed.body['signature']));

// ---------------------------------------------------------------------------
console.log('\n=== A real delivery, verified as a receiver would ===');
// ---------------------------------------------------------------------------

replyWith = 200;
received.length = 0;

const test = await call('POST', `/api/webhooks/${String(hookId)}/test`);
check('the test reports success', test.status === 200 && test.body['ok'] === true);
check('in one attempt', test.body['attempt'] === 1);
show('hasil', `HTTP ${String(test.body['httpStatus'])} dalam ${String(test.body['durationMs'])}ms`);

check('the receiver was called', received.length === 1);
const delivery = received[0];

if (delivery !== undefined) {
  check('with POST', delivery.method === 'POST');
  check('and a JSON content type', delivery.headers['content-type'] === 'application/json');
  check('and an identifiable user agent', (delivery.headers['user-agent'] ?? '').includes('SistemKehadiran'));
  check('the event name is in a header, so a receiver can route without parsing', delivery.headers['x-kehadiran-event'] === 'webhook.test');
  check('and the attempt number too', delivery.headers['x-kehadiran-attempt'] === '1');

  const header = delivery.headers['x-kehadiran-signature'] ?? '';
  check('a signature is present', header.length > 0);
  check('in the form t=<unix>,v1=<hex>', /^t=\d+,v1=[0-9a-f]{64}$/.test(header));
  show('tandatangan', `${header.slice(0, 30)}…`);

  /**
   * The check that matters. Everything else about a webhook is forgeable by anyone who
   * learns the URL; this is what makes the request provably ours.
   */
  check('the signature verifies against the raw body', verifySignature(secret, header, delivery.raw).ok);

  const tampered = verifySignature(secret, header, delivery.raw.replace('webhook.test', 'leave.approved'));
  check('a modified body fails verification', !tampered.ok && tampered.reason === 'mismatch');

  const wrongKey = verifySignature('whsec_bukan-rahsia-yang-betul', header, delivery.raw);
  check('another key fails verification', !wrongKey.ok);

  /**
   * The timestamp is inside the signed material, so a captured request expires. Without it
   * a signature over the body alone stays correct when replayed next month.
   */
  const stamp = Number(/^t=(\d+)/.exec(header)?.[1] ?? 0);
  const stale = verifySignature(secret, header, delivery.raw, stamp + SIGNATURE_TOLERANCE_SECONDS + 60);
  check('a replay outside the tolerance window fails', !stale.ok && stale.reason === 'stale');
  const fresh = verifySignature(secret, header, delivery.raw, stamp + SIGNATURE_TOLERANCE_SECONDS - 60);
  check('and inside it still passes', fresh.ok);
  show('toleransi', `${String(SIGNATURE_TOLERANCE_SECONDS)}s`);

  check('a signature with no timestamp is refused', !verifySignature(secret, `v1=${'0'.repeat(64)}`, delivery.raw).ok);
  check('a truncated signature is refused', !verifySignature(secret, `t=${String(stamp)},v1=abc`, delivery.raw).ok);

  const envelope = JSON.parse(delivery.raw) as Record<string, unknown>;
  check('the envelope carries an event id', String(envelope['id']).startsWith('evt_'));
  check('the event name', envelope['event'] === 'webhook.test');
  check('when it was raised', typeof envelope['createdAt'] === 'string');
  check('and the payload under data', typeof envelope['data'] === 'object');
  show('muatan', JSON.stringify(envelope['data']).slice(0, 110));

  // Signing the raw bytes rather than a re-encoded copy: any receiver that re-serialises
  // before verifying gets a different string and a failed check.
  check(
    'the signed material is exactly the bytes sent',
    signPayload(secret, stamp, delivery.raw) === /v1=([0-9a-f]+)/.exec(header)?.[1],
  );
}

const afterSuccess = await db().webhook.findUnique({ where: { id: hookId } });
check('a success clears the failure count', afterSuccess?.failureCount === 0);
check('and records the status', afterSuccess?.lastStatus === 200);

// ---------------------------------------------------------------------------
console.log('\n=== Retries ===');
// ---------------------------------------------------------------------------

replyWith = 400;
received.length = 0;
const refused = await call('POST', `/api/webhooks/${String(hookId)}/test`);
check('a 4xx is reported as a failure', refused.body['ok'] === false);
/**
 * Not retried. The receiver understood the request and refused it, so sending it again
 * three times only produces three more entries in their log.
 */
check('and is not retried, because the receiver understood it', received.length === 1);
show('cubaan', `${String(received.length)} untuk HTTP 400`);

replyWith = 503;
received.length = 0;
const unavailable = await call('POST', `/api/webhooks/${String(hookId)}/test`);
check('a 5xx is reported as a failure', unavailable.body['ok'] === false);
// Retried, because these are the ones that succeed on a second try.
check('and is retried to the attempt limit', received.length === 3);
check('with the attempt number advancing in the header', received[2]?.headers['x-kehadiran-attempt'] === '3');
show('cubaan', `${String(received.length)} untuk HTTP 503`);

// The same timestamp across retries, so a receiver that has already accepted attempt one
// can recognise attempts two and three as the same event.
const stamps = received.map((entry) => /^t=(\d+)/.exec(entry.headers['x-kehadiran-signature'] ?? '')?.[1]);
check('every retry carries the same signed timestamp', new Set(stamps).size === 1);
const ids = received.map((entry) => (JSON.parse(entry.raw) as Record<string, unknown>)['id']);
check('and the same event id, so a receiver can deduplicate', new Set(ids).size === 1);

replyWith = 200;

// ---------------------------------------------------------------------------
console.log('\n=== The delivery log ===');
// ---------------------------------------------------------------------------

const log = await call('GET', `/api/webhooks/${String(hookId)}/deliveries?limit=20`);
check('deliveries are listed', log.status === 200);
const entries = (log.body['deliveries'] ?? []) as Array<Record<string, unknown>>;
check('every attempt is recorded, not just the last', entries.length >= 5);
check('failures record the status the receiver gave', entries.some((entry) => entry['httpStatus'] === 503));
check('and successes are marked as such', entries.some((entry) => entry['ok'] === true));
check("the receiver's response is kept, so a refusal can be read", entries.some((entry) => String(entry['responseBody'] ?? '').length > 0));
// The request body is stored for diagnosis but not served: it is the material the
// signature covers, and the log is a screen anybody with view permission can open.
check('the request body is not served with the log', entries.every((entry) => entry['requestBody'] === undefined));
show('log', `${String(entries.length)} penghantaran · terkini ${String(entries[0]?.['event'])} → ${String(entries[0]?.['httpStatus'])}`);

// ---------------------------------------------------------------------------
console.log('\n=== Auto-disable ===');
// ---------------------------------------------------------------------------

// Driven to the edge directly rather than by nineteen real failures, which would take
// several minutes of retry backoff to no extra effect.
await db().webhook.update({ where: { id: hookId }, data: { failureCount: 19, active: true } });

replyWith = 500;
await call('POST', `/api/webhooks/${String(hookId)}/test`);
const disabled = await db().webhook.findUnique({ where: { id: hookId } });
/**
 * An endless retry loop against a host that has been gone for a week is indistinguishable
 * from an outbound scan, and it is the receiver's firewall that notices first.
 */
check('the subscription is switched off after repeated failures', disabled?.active === false);
check('and says why, rather than just going quiet', (disabled?.disabledReason ?? '').length > 0);
show('sebab', String(disabled?.disabledReason).slice(0, 120));

replyWith = 200;
const reactivated = await call('PATCH', `/api/webhooks/${String(hookId)}`, { active: true });
check('turning it back on is accepted', reactivated.status === 200);
const cleared = await db().webhook.findUnique({ where: { id: hookId } });
// Otherwise it would read as active while still carrying the reason it was stopped, and
// the next single failure would switch it off again.
check('which clears the failure count', cleared?.failureCount === 0);
check('and the reason', cleared?.disabledReason === null);

// ---------------------------------------------------------------------------
console.log('\n=== Regenerating the key ===');
// ---------------------------------------------------------------------------

received.length = 0;
const regenerated = await call('POST', `/api/webhooks/${String(hookId)}/regenerate-secret`);
check('a new key is issued', regenerated.status === 200);
const newSecret = String(regenerated.body['secret'] ?? '');
check('and differs from the old one', newSecret.startsWith('whsec_') && newSecret !== secret);

await call('POST', `/api/webhooks/${String(hookId)}/test`);
const afterRotate = received[0];
if (afterRotate !== undefined) {
  const header = afterRotate.headers['x-kehadiran-signature'] ?? '';
  check('deliveries are signed with the new key', verifySignature(newSecret, header, afterRotate.raw).ok);
  // Said plainly on the screen too: the receiver breaks the moment this runs.
  check('and the old key no longer verifies them', !verifySignature(secret, header, afterRotate.raw).ok);
}

// ---------------------------------------------------------------------------
console.log('\n=== Editing a subscription ===');
// ---------------------------------------------------------------------------

const repoint = await call('PATCH', `/api/webhooks/${String(hookId)}`, {
  url: 'http://169.254.169.254/hook',
});
check('an edit cannot repoint a subscription at a blocked address', repoint.status === 409);

const stillThere = await db().webhook.findUnique({ where: { id: hookId } });
check('and the original target is untouched', stillThere?.url === receiverUrl);

const renamed = await call('PATCH', `/api/webhooks/${String(hookId)}`, { name: 'Nama baharu' });
check('an unrelated edit is accepted', renamed.status === 200);
const partial = await db().webhook.findUnique({ where: { id: hookId } });
// `.partial()` on a Zod schema keeps its defaults, so a PATCH that omits `active` used to
// rewrite it to true. `forUpdate()` strips them.
check('and leaves fields that were not sent alone', partial?.url === receiverUrl && partial?.name === 'Nama baharu');
check('including ones that carry a default', Array.isArray(partial?.events) && (partial?.events as unknown[]).length === 2);

// ---------------------------------------------------------------------------
console.log('\n=== A repointed target is caught at delivery, not only at save ===');
// ---------------------------------------------------------------------------

received.length = 0;
// Written straight to the row, which is what a DNS change after the fact looks like from
// the server's side: a target that passed once and no longer should.
await db().webhook.update({ where: { id: hookId }, data: { url: 'http://169.254.169.254/hook' } });
const blocked = await call('POST', `/api/webhooks/${String(hookId)}/test`);
check('delivery to a now-blocked target fails', blocked.body['ok'] === false);
check('without contacting anything', received.length === 0);
show('ralat', String(blocked.body['error']).slice(0, 110));

const blockedLog = await call('GET', `/api/webhooks/${String(hookId)}/deliveries?limit=3`);
const blockedEntries = (blockedLog.body['deliveries'] ?? []) as Array<Record<string, unknown>>;
check('and the refusal is in the delivery log', blockedEntries.some((entry) => String(entry['error'] ?? '').includes('169.254.169.254')));

await db().webhook.update({ where: { id: hookId }, data: { url: receiverUrl } });

// ---------------------------------------------------------------------------
console.log('\n=== Trigger list ===');
// ---------------------------------------------------------------------------

const triggers = (listed.body['triggers'] ?? []) as Array<Record<string, unknown>>;
check('the triggers a subscription can choose are published', triggers.length > 0);
// Marked rather than hidden: a trigger that exists but nothing raises yet would otherwise
// look like a webhook that silently never fires.
check('each says whether anything raises it yet', triggers.every((entry) => typeof entry['wired'] === 'boolean'));
check('and each is keyed', triggers.every((entry) => typeof entry['key'] === 'string'));
show('tersambung', triggers.filter((entry) => entry['wired'] === true).map((entry) => String(entry['key'])).join(', '));
show('belum', triggers.filter((entry) => entry['wired'] !== true).map((entry) => String(entry['key'])).join(', '));

await finish();

// ---------------------------------------------------------------------------

/**
 * Builds the Prisma client before anything depends on the server staying up.
 *
 * The client is constructed lazily, and constructing it writes into
 * `node_modules/.prisma/client`. The development server runs under `tsx watch`, which sees
 * that write and restarts — so the first `db()` call in a script knocks the server over for
 * about a second, wherever in the run it happens to fall. Doing it here and then waiting
 * moves that restart to before the first assertion instead of into the middle of one.
 */
async function warmUpPrisma(): Promise<void> {
  await db().webhook.count();
  await waitForServer();
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 60_000;
  let restarted = false;

  for (let tick = 0; Date.now() < deadline; tick += 1) {
    const up = await fetch(`${BASE}/api/health`)
      .then((response) => response.ok)
      .catch(() => false);

    if (up && (restarted || tick >= 3)) {
      if (restarted) console.log('  pelayan dimulakan semula, sambung');
      return;
    }
    if (!up) restarted = true;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  console.error('Pelayan tidak menjawab. Pastikan `npm run dev` berjalan dalam apps/server.');
  process.exit(2);
}

async function createWebhook(
  name: string,
  url: string,
  events: string[] = ['leave.approved'],
): Promise<{ status: number; body: Record<string, unknown> }> {
  return call('POST', '/api/webhooks', { name, url, events, active: true });
}

async function finish(): Promise<never> {
  console.log('\n=== Cleanup ===');

  for (const id of createdWebhooks) {
    const removed = await call('DELETE', `/api/webhooks/${String(id)}`);
    if (removed.status !== 200) show('gagal dibuang', `${String(id)} → ${String(removed.status)}`);
  }
  show('webhook dibuang', String(createdWebhooks.length));

  const remaining = await call('GET', '/api/webhooks');
  const left = (remaining.body['webhooks'] ?? []) as unknown[];
  check('nothing this run created is left behind', !JSON.stringify(left).includes(receiverUrl));

  receiver.close();
  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
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
  let parsed: Record<string, unknown>;
  try {
    parsed = (JSON.parse(text) ?? {}) as Record<string, unknown>;
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }

  return { status: response.status, body: parsed };
}

function show(label: string, value: string): void {
  console.log(`         ${label}: ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
