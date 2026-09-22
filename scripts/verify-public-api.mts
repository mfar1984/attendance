/**
 * Verifies the public API and its access controls against the running server.
 *
 * Everything here is driven from outside, the way a real caller would: the token is used
 * as a bearer credential over HTTP, and the guards are tested by being tripped rather than
 * by reading the code that implements them.
 *
 * Prisma is used for two setup steps the API deliberately does not expose — backdating an
 * expiry and closing a rotation grace window — because there is no legitimate endpoint for
 * making a credential older than it is.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-public-api.mts <password>
 */
import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-public-api.mts <adminPassword>');
  process.exit(2);
}

let cookie = '';
let failures = 0;
const createdTokens: number[] = [];

/** The full config body, so a partial change does not blank the rest. */
let currentConfig: Record<string, unknown> = {};

const { db } = await import('../apps/server/src/db.js');

await warmUpPrisma();

await call('POST', '/api/auth/login', {
  email,
  password,
  ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
});
check('logged in', cookie.length > 0);

/** Restored at the end, so a configured API survives this run. */
const original = (await call('GET', '/api/api-config')).body;

// ---------------------------------------------------------------------------
console.log('\n=== Disabled, the API is absent rather than forbidden ===');
// ---------------------------------------------------------------------------

await saveConfig({ enabled: false });

for (const path of ['/whoami', '/staff', '/attendance?from=2026-08-01&to=2026-08-02', '/leave']) {
  const response = await callPublic('GET', path);
  /**
   * 404 and not 403. An endpoint that admits it exists is an endpoint worth coming back
   * to with a longer word list.
   */
  check(`GET /api/public${path} answers 404 while disabled`, response.status === 404);
}

// ---------------------------------------------------------------------------
console.log('\n=== A wide-open configuration is refused ===');
// ---------------------------------------------------------------------------

const wideOpen = await call('PUT', '/api/api-config', {
  ...configBody(),
  enabled: true,
  requireToken: false,
  ipWhitelist: [],
});
// Enabled, no token, no address filter is the whole staff directory available to anything
// that can route to the port.
check('enabled with no token and no whitelist is refused', wideOpen.status === 409);
show('message', String(wideOpen.body['error']).slice(0, 130));

const badCidr = await call('PUT', '/api/api-config', {
  ...configBody(),
  ipWhitelist: ['203.0.113.0/33'],
});
// Refused rather than dropped: a silently ignored entry reads as an address that simply
// never matches.
check('an out-of-range prefix length is refused', badCidr.status === 409);

const badOrigin = await call('PUT', '/api/api-config', {
  ...configBody(),
  allowedOrigins: ['portal.hospital.local'],
});
check('an origin without a scheme is refused', badOrigin.status === 409);
show('message', String(badOrigin.body['error']).slice(0, 110));

// ---------------------------------------------------------------------------
console.log('\n=== Scopes come from the permission registry ===');
// ---------------------------------------------------------------------------

const listing = await call('GET', '/api/api-tokens');
check('the token list responds', listing.status === 200);
const scopes = (listing.body['scopes'] ?? []) as Array<Record<string, string>>;
check('and offers scopes', scopes.length > 0);
/**
 * Read-only only. A write scope would let a token change attendance with no person
 * attached to the change, and the audit trail is built on there always being one.
 */
check(
  'only view and export are offered, never a write action',
  scopes.every((entry) => /:(view|export)$/.test(entry.scope)),
);
show('contoh skop', scopes.slice(0, 3).map((entry) => entry.scope).join(', '));

// ---------------------------------------------------------------------------
console.log('\n=== Issuing a token ===');
// ---------------------------------------------------------------------------

await saveConfig({ enabled: true, requireToken: true, maxPerMinute: 1000 });

const issued = await call('POST', '/api/api-tokens', {
  name: 'Ujian verifikasi',
  scopes: ['staff.directory:view', 'attendance.records:view'],
  expiresInDays: 30,
});
check('the token is issued', issued.status === 200);
const token = String(issued.body['token'] ?? '');
const tokenId = Number(issued.body['id']);
if (issued.status === 200) createdTokens.push(tokenId);

check('and the value is returned exactly once, here', token.startsWith('hka_'));
show('prefix', String(issued.body['prefix']));

const noScopes = await call('POST', '/api/api-tokens', {
  name: 'Tiada skop',
  scopes: ['tidak.wujud:view'],
});
check('a token whose scopes are all unknown is refused', noScopes.status === 409);

// ---------------------------------------------------------------------------
console.log('\n=== The token value is never readable again ===');
// ---------------------------------------------------------------------------

const afterIssue = await call('GET', '/api/api-tokens');
const serialised = JSON.stringify(afterIssue.body);
check('the list never returns the token', !serialised.includes(token));
check('nor its hash', !serialised.toLowerCase().includes('tokenhash'));

const row = ((afterIssue.body['tokens'] ?? []) as Array<Record<string, unknown>>).find(
  (entry) => entry['id'] === tokenId,
);
check('but it does return the prefix, so a token can be identified', row?.['prefix'] === issued.body['prefix']);
check('and its status', row?.['status'] === 'active');

// The stored form is a hash, not the value. Checked directly because this is the property
// that makes a database dump useless for API access.
const stored = await db().apiToken.findUnique({ where: { id: tokenId } });
check('the database holds a hash, not the token', stored?.tokenHash !== token);
check('and the hash is 64 hex characters (sha-256)', /^[0-9a-f]{64}$/.test(stored?.tokenHash ?? ''));

// ---------------------------------------------------------------------------
console.log('\n=== Authentication ===');
// ---------------------------------------------------------------------------

const anonymous = await callPublic('GET', '/staff');
check('no token is refused', anonymous.status === 401);

const garbage = await callPublic('GET', '/staff', 'hka_tidak-sah-sama-sekali');
check('an unknown token is refused', garbage.status === 401);
check(
  'and the refusal does not say whether the token exists',
  String(garbage.body['error']) === String(anonymous.body['error']),
);
show('message', String(garbage.body['error']));

const notOurs = await callPublic('GET', '/staff', 'Bearer-something-else');
check('a token without our prefix is refused', notOurs.status === 401);

const good = await callPublic('GET', '/staff?pageSize=2', token);
check('a valid token with the right scope is served', good.status === 200);
check('and the response carries data', Array.isArray(good.body['data']));
show('staf', `${String(good.body['total'])} jumlah, ${String((good.body['data'] as unknown[]).length)} dipaparkan`);

// The header variant exists because integration tools that cannot set Authorization would
// otherwise put the token in a query string, where it lands in access logs.
const viaApiKey = await callPublic('GET', '/staff?pageSize=1', token, 'x-api-key');
check('X-Api-Key is accepted as well as Bearer', viaApiKey.status === 200);

// ---------------------------------------------------------------------------
console.log('\n=== Scopes are enforced per endpoint ===');
// ---------------------------------------------------------------------------

const noLeaveScope = await callPublic('GET', '/leave', token);
check('an endpoint outside the token scopes is refused', noLeaveScope.status === 403);
// Named, because the caller is authenticated: this helps whoever owns the token.
check(
  'and the message names the missing scope',
  String(noLeaveScope.body['error']).includes('schedule.leave:view'),
);
show('message', String(noLeaveScope.body['error']));

const whoami = await callPublic('GET', '/whoami', token);
check('whoami works without a scope of its own', whoami.status === 200);
const identity = whoami.body['token'] as Record<string, unknown>;
check('and reports what the token may do', Array.isArray(identity['scopes']));
show('skop', (identity['scopes'] as string[]).join(', '));

// ---------------------------------------------------------------------------
console.log('\n=== Usage is recorded ===');
// ---------------------------------------------------------------------------

// The counter is updated fire-and-forget, so it may lag the request by a moment.
await new Promise((resolve) => setTimeout(resolve, 400));
const used = await db().apiToken.findUnique({ where: { id: tokenId } });
check('the request counter advanced', (used?.requestCount ?? 0) > 0);
check('and the last use was recorded', used?.lastUsedAt !== null);
show('kiraan', `${String(used?.requestCount)} permintaan · ${String(used?.lastUsedIp)}`);

// ---------------------------------------------------------------------------
console.log('\n=== Revocation is immediate ===');
// ---------------------------------------------------------------------------

const throwaway = await call('POST', '/api/api-tokens', {
  name: 'Untuk dibatalkan',
  scopes: ['staff.directory:view'],
});
const throwawayId = Number(throwaway.body['id']);
const throwawayToken = String(throwaway.body['token']);
createdTokens.push(throwawayId);

check('it works before revocation', (await callPublic('GET', '/staff', throwawayToken)).status === 200);
await call('POST', `/api/api-tokens/${String(throwawayId)}/revoke`);
check('and is refused after', (await callPublic('GET', '/staff', throwawayToken)).status === 401);

const deleteLive = await call('DELETE', `/api/api-tokens/${String(tokenId)}`);
// The row is the only record of what the token was allowed to do, while the activity log
// still refers to its prefix.
check('a live token cannot be deleted outright', deleteLive.status === 409);
show('message', String(deleteLive.body['error']).slice(0, 120));

// ---------------------------------------------------------------------------
console.log('\n=== An expired token stops working ===');
// ---------------------------------------------------------------------------

await db().apiToken.update({
  where: { id: tokenId },
  data: { expiresAt: new Date(Date.now() - 60_000) },
});
check('an expired token is refused', (await callPublic('GET', '/staff', token)).status === 401);

await db().apiToken.update({
  where: { id: tokenId },
  data: { expiresAt: new Date(Date.now() + 86_400_000) },
});
check('and works again once the expiry is in the future', (await callPublic('GET', '/staff', token)).status === 200);

// ---------------------------------------------------------------------------
console.log('\n=== Rotation leaves no window where every call fails ===');
// ---------------------------------------------------------------------------

const rotated = await call('POST', `/api/api-tokens/${String(tokenId)}/rotate`);
check('rotation issues a replacement', rotated.status === 200);
const newToken = String(rotated.body['token'] ?? '');
const newTokenId = Number(rotated.body['id']);
createdTokens.push(newTokenId);
check('with a different value', newToken !== token && newToken.startsWith('hka_'));
show('putaran', `${String(issued.body['prefix'])} → ${String(rotated.body['prefix'])}`);

check('the replacement works', (await callPublic('GET', '/staff', newToken)).status === 200);
/**
 * The point of the grace window. Revoke-then-create would fail every call between the two
 * steps; here the old value keeps working until the deployment has picked up the new one.
 */
check('and the old one still works during the grace window', (await callPublic('GET', '/staff', token)).status === 200);

const rotatedRow = await db().apiToken.findUnique({ where: { id: tokenId } });
check('the old token records what replaced it', rotatedRow?.rotatedToPrefix === rotated.body['prefix']);
check('the replacement carries the same scopes, unchanged', await sameScopes(tokenId, newTokenId));

const rotateTwice = await call('POST', `/api/api-tokens/${String(tokenId)}/rotate`);
check('a token that has already been rotated cannot be rotated again', rotateTwice.status === 409);

await db().apiToken.update({
  where: { id: tokenId },
  data: { graceUntil: new Date(Date.now() - 60_000) },
});
check('once the grace window closes the old token is refused', (await callPublic('GET', '/staff', token)).status === 401);

// ---------------------------------------------------------------------------
console.log('\n=== Rate limiting ===');
// ---------------------------------------------------------------------------

/**
 * A fresh token, because the window is keyed per token and counts from the first call.
 * Reusing one that has already been exercised would start the test mid-window.
 */
const limitToken = await call('POST', '/api/api-tokens', {
  name: 'Ujian had kadar',
  scopes: ['staff.directory:view'],
});
createdTokens.push(Number(limitToken.body['id']));
const throttled = String(limitToken.body['token']);

await saveConfig({ enabled: true, requireToken: true, rateLimitEnabled: true, maxPerMinute: 3 });

const codes: number[] = [];
for (let attempt = 0; attempt < 6; attempt += 1) {
  codes.push((await callPublic('GET', '/staff?pageSize=1', throttled)).status);
}
check('the limit is enforced', codes.includes(429));
check('and requests under the limit still pass', codes.filter((code) => code === 200).length >= 3);
show('kod', codes.join(', '));

const limited = await callPublic('GET', '/staff?pageSize=1', throttled);
check('the refusal names how long to wait', limited.headers['retry-after'] !== undefined);
check('and states the limit that was hit', limited.headers['x-ratelimit-limit'] === '3');
show('retry-after', `${String(limited.headers['retry-after'])}s daripada had ${String(limited.headers['x-ratelimit-limit'])}`);

// Keyed per token, so one noisy integration cannot exhaust what everything sharing its
// address is allowed.
check(
  'a different token is unaffected by the first one hitting the limit',
  (await callPublic('GET', '/staff?pageSize=1', newToken)).status === 200,
);

await saveConfig({ enabled: true, requireToken: true, rateLimitEnabled: false, maxPerMinute: 1000 });
check('and turning the limit off restores service', (await callPublic('GET', '/staff?pageSize=1', throttled)).status === 200);

// ---------------------------------------------------------------------------
console.log('\n=== Address filtering ===');
// ---------------------------------------------------------------------------

await saveConfig({ enabled: true, requireToken: true, ipWhitelist: ['203.0.113.0/24'] });
const blocked = await callPublic('GET', '/staff', newToken);
// 404 again: an address that is not allowed here should not learn that the endpoint exists.
check('an address outside the whitelist is refused', blocked.status === 404);

await saveConfig({ enabled: true, requireToken: true, ipWhitelist: ['127.0.0.1'] });
check('and allowed once its address is listed', (await callPublic('GET', '/staff', newToken)).status === 200);

await saveConfig({ enabled: true, requireToken: true, ipWhitelist: ['127.0.0.0/8'] });
check('CIDR notation matches too', (await callPublic('GET', '/staff', newToken)).status === 200);
await saveConfig({ ipWhitelist: [] });

// ---------------------------------------------------------------------------
console.log('\n=== CORS ===');
// ---------------------------------------------------------------------------

await saveConfig({ allowAllOrigins: true });
const anyOrigin = await callPublic('GET', '/staff?pageSize=1', newToken, 'authorization', {
  origin: 'https://somewhere.example',
});
check('any origin is echoed as * when allowed', anyOrigin.headers['access-control-allow-origin'] === '*');

await saveConfig({ allowAllOrigins: false, allowedOrigins: ['https://portal.hospital.local'] });
const listed = await callPublic('GET', '/staff?pageSize=1', newToken, 'authorization', {
  origin: 'https://portal.hospital.local',
});
check('a listed origin is echoed back', listed.headers['access-control-allow-origin'] === 'https://portal.hospital.local');
// Required whenever the value is not `*`: without it a shared cache can serve one origin's
// response to another.
check('with Vary: Origin, so a cache cannot cross-serve it', (listed.headers['vary'] ?? '').includes('Origin'));

const unlisted = await callPublic('GET', '/staff?pageSize=1', newToken, 'authorization', {
  origin: 'https://elsewhere.example',
});
check('an unlisted origin gets no allow header', unlisted.headers['access-control-allow-origin'] === undefined);

// A browser will not attach credentials to a preflight, so requiring a token there would
// make every browser caller fail before it started.
const preflight = await fetch(`${BASE}/api/public/staff`, {
  method: 'OPTIONS',
  headers: { origin: 'https://portal.hospital.local' },
});
check('preflight is answered without a token', preflight.status === 204);

await saveConfig({ allowAllOrigins: false, allowedOrigins: [] });

// ---------------------------------------------------------------------------
console.log('\n=== Refusals reach the activity log ===');
// ---------------------------------------------------------------------------

await callPublic('GET', '/staff', 'hka_untuk-dilog');
await new Promise((resolve) => setTimeout(resolve, 400));
const rejections = await db().activityLog.count({
  where: { action: 'api.rejected', createdAt: { gte: new Date(Date.now() - 120_000) } },
});
/**
 * Rejections are always recorded, even with request logging off. The setting controls the
 * noise of successful traffic; a refused call is the one that matters.
 */
check('a refused call is recorded', rejections > 0);
show('penolakan dilog', String(rejections));

// ---------------------------------------------------------------------------
console.log('\n=== Period bounds ===');
// ---------------------------------------------------------------------------

const wide = await callPublic('GET', '/attendance?from=2020-01-01&to=2026-12-31', newToken);
check('an unbounded period is refused rather than timing out', wide.status === 409);
show('message', String(wide.body['error']).slice(0, 100));

const reversed = await callPublic('GET', '/attendance?from=2026-08-31&to=2026-08-01', newToken);
check('a reversed period is refused', reversed.status === 409);

// ---------------------------------------------------------------------------
console.log('\n=== Personal data stays inside ===');
// ---------------------------------------------------------------------------

const staffPayload = JSON.stringify((await callPublic('GET', '/staff?pageSize=5', newToken)).body);
for (const field of ['icNo', 'phone', 'email', 'doorPin']) {
  check(`the staff feed does not expose ${field}`, !staffPayload.includes(field));
}

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
  await db().apiConfig.findUnique({ where: { id: 1 } });
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

async function sameScopes(oldId: number, newId: number): Promise<boolean> {
  const [before, after] = await Promise.all([
    db().apiToken.findUnique({ where: { id: oldId }, select: { scopes: true } }),
    db().apiToken.findUnique({ where: { id: newId }, select: { scopes: true } }),
  ]);
  return JSON.stringify(before?.scopes) === JSON.stringify(after?.scopes);
}

function configBody(): Record<string, unknown> {
  return {
    enabled: currentConfig['enabled'] ?? false,
    requireToken: currentConfig['requireToken'] ?? true,
    logRequests: currentConfig['logRequests'] ?? true,
    allowAllOrigins: currentConfig['allowAllOrigins'] ?? false,
    allowedOrigins: currentConfig['allowedOrigins'] ?? [],
    rateLimitEnabled: currentConfig['rateLimitEnabled'] ?? true,
    maxPerMinute: currentConfig['maxPerMinute'] ?? 120,
    ipWhitelist: currentConfig['ipWhitelist'] ?? [],
  };
}

async function saveConfig(patch: Record<string, unknown>): Promise<void> {
  currentConfig = { ...configBody(), ...patch };
  const response = await call('PUT', '/api/api-config', currentConfig);
  if (response.status !== 200) {
    check(`config save (${JSON.stringify(patch)})`, false);
    show('error', JSON.stringify(response.body).slice(0, 160));
  }
  // The guard caches settings for a second, so a change needs that long to take effect.
  await new Promise((resolve) => setTimeout(resolve, 1100));
}

async function finish(): Promise<never> {
  console.log('\n=== Cleanup ===');

  for (const id of createdTokens) {
    await call('POST', `/api/api-tokens/${String(id)}/revoke`).catch(() => undefined);
    await db().apiToken.delete({ where: { id } }).catch(() => undefined);
  }
  show('token dibuang', String(createdTokens.length));

  currentConfig = {
    enabled: original['enabled'] ?? false,
    requireToken: original['requireToken'] ?? true,
    logRequests: original['logRequests'] ?? true,
    allowAllOrigins: original['allowAllOrigins'] ?? false,
    allowedOrigins: original['allowedOrigins'] ?? [],
    rateLimitEnabled: original['rateLimitEnabled'] ?? true,
    maxPerMinute: original['maxPerMinute'] ?? 120,
    ipWhitelist: original['ipWhitelist'] ?? [],
  };
  const restored = await call('PUT', '/api/api-config', currentConfig);
  check('the previous API configuration is restored', restored.status === 200);
  show('dipulihkan', `enabled=${String(currentConfig['enabled'])}`);

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

  return { status: response.status, body: await parse(response) };
}

/**
 * A public API call.
 *
 * Deliberately does not send the session cookie: a caller of the public API has no
 * session, and letting one ride along would test the wrong thing entirely.
 */
async function callPublic(
  method: string,
  path: string,
  token?: string,
  header: 'authorization' | 'x-api-key' = 'authorization',
  extra: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown>; headers: Record<string, string> }> {
  const headers: Record<string, string> = { ...extra };
  if (token !== undefined) {
    headers[header] = header === 'authorization' ? `Bearer ${token}` : token;
  }

  const response = await fetch(`${BASE}/api/public${path}`, { method, headers });
  const flat: Record<string, string> = {};
  response.headers.forEach((value, key) => (flat[key] = value));

  return { status: response.status, body: await parse(response), headers: flat };
}

async function parse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    return (JSON.parse(text) ?? {}) as Record<string, unknown>;
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

function show(label: string, value: string): void {
  console.log(`         ${label}: ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
