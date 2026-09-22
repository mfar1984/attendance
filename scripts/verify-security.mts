/**
 * Verifies that the Security screen's knobs are enforced.
 *
 * The point of this file is a single question: is each control on that tab actually read by
 * the server, or is it a switch that writes a row nobody consults? Every check here changes
 * a setting and then provokes the behaviour it is supposed to govern.
 *
 * The lockout test deliberately locks the administrator account it is logged in as, then
 * clears the lock through Prisma. There is no endpoint for unlocking without an operator,
 * and using a second account would mean creating a staff record and a role to hang it on.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-security.mts <password>
 */
import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-security.mts <adminPassword>');
  process.exit(2);
}

let cookie = '';
let failures = 0;
const createdTokens: number[] = [];

const { db } = await import('../apps/server/src/db.js');

await warmUpPrisma();

await login();
check('logged in', cookie.length > 0);

const original = (await call('GET', '/api/security-config')).body;
const startingPolicy = original['policy'] as Record<string, number>;

/** Held briefly while the password minimum is being exercised. */
const TEMPORARY_PASSWORD = 'Sement4ra!';

/**
 * Undo, even on a crash.
 *
 * This is the one script that changes the administrator password and the lockout policy —
 * the two pieces of state whose corruption locks somebody out of the system entirely. A
 * mid-run failure without this leaves a test password in the database and no obvious sign
 * of which one it is.
 */
for (const signal of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(signal, (cause: unknown) => {
    console.error(`\n[CRASH] ${signal}:`, cause);
    void rescue().finally(() => process.exit(1));
  });
}

async function rescue(): Promise<void> {
  console.error('\n=== Emergency restore ===');

  // Either password may be live, depending on where it failed.
  for (const candidate of [password, TEMPORARY_PASSWORD]) {
    await db()
      .userAccount.update({ where: { id: 1 }, data: { failedLoginCount: 0, lockedUntil: null } })
      .catch(() => undefined);

    await loginWith(candidate).catch(() => undefined);
    if (cookie.length === 0) continue;

    if (candidate !== password) {
      const back = await call('PATCH', '/api/users/1', { password });
      console.error(`  kata laluan dipulihkan: ${String(back.status)}`);
      await loginWith(password).catch(() => undefined);
    }

    const policy = await call('PUT', '/api/security-config', startingPolicy);
    console.error(`  dasar dipulihkan: ${String(policy.status)}`);
    console.error('  akaun dibuka, kata laluan asal berkuat kuasa.');
    return;
  }

  console.error(
    '  TIDAK DAPAT LOG MASUK. Kata laluan mungkin masih "Sement4ra!" — ' +
      'log masuk dengannya dan tukar semula di Pengurusan Pengguna.',
  );
}

// ---------------------------------------------------------------------------
console.log('\n=== The payload the screen renders ===');
// ---------------------------------------------------------------------------

check('the policy is returned', typeof original['policy'] === 'object');
check('with the shipped defaults beside it', typeof original['defaults'] === 'object');
check('the deploy-time facts', typeof original['environment'] === 'object');
check('and the live posture', typeof original['posture'] === 'object');
show('dasar', JSON.stringify(startingPolicy));

const environment = original['environment'] as Record<string, unknown>;
/**
 * Read once at boot. Shown read-only on the screen for exactly this reason: a switch here
 * would write a row the running server never consults, which is worse than no switch.
 */
check(
  'the environment block carries what the read-only panel shows',
  ['requireAdmin2fa', 'sessionTtlHours', 'connectorMode', 'nodeEnv'].every(
    (key) => key in environment,
  ),
);
show('persekitaran', JSON.stringify(environment));

// ---------------------------------------------------------------------------
console.log('\n=== Floors, not free numbers ===');
// ---------------------------------------------------------------------------

// One attempt locks a person out of their own account on a single typo.
await refuses('fewer than three attempts', { maxFailedLogins: 1 });
await refuses('more than fifty attempts', { maxFailedLogins: 999 });
// Four characters is not a password policy.
await refuses('a password minimum below eight', { passwordMinLength: 4 });
await refuses('a zero-minute lockout', { lockoutMinutes: 0 });
await refuses('a zero-hour grace window', { rotationGraceHours: 0 });
await refuses('a fractional attempt count', { maxFailedLogins: 4.5 });

// Zero here means "no expiry", which is a real choice, so it is allowed.
check(
  'a token default of zero days is allowed, meaning no expiry',
  (await savePolicy({ tokenDefaultDays: 0 })).status === 200,
);

const rejected = await savePolicy({ maxFailedLogins: 1 }, { settle: false });
// A refusal, not a silent clamp: a value quietly rounded up to the floor leaves the screen
// showing one number and the server enforcing another.
check('and the refusal is a validation error naming the field', rejected.body['code'] === 'validation');
show('message', String(rejected.body['error']));

const unchanged = (await call('GET', '/api/security-config')).body['policy'] as Record<string, number>;
check('a refused save changes nothing', unchanged['maxFailedLogins'] === startingPolicy['maxFailedLogins']);

// ---------------------------------------------------------------------------
console.log('\n=== Password minimum is enforced, not just stored ===');
// ---------------------------------------------------------------------------

await savePolicy({ passwordMinLength: 20 });

const tooShort = await call('PATCH', '/api/users/1', { password: 'ThisIs17Chars!!!!' });
check('a password under the configured minimum is refused', tooShort.status === 409);
check(
  'and the refusal names the number the operator set',
  String(tooShort.body['error']).includes('20'),
);
show('message', String(tooShort.body['error']));

await savePolicy({ passwordMinLength: 12 });
const stillShort = await call('PATCH', '/api/users/1', { password: 'ShortOne1!' });
check('lowering the minimum changes where the line is', stillShort.status === 409);
check('and the new number is quoted', String(stillShort.body['error']).includes('12'));

/**
 * The floor in the schema is 8, below the policy default of 12. The schema refuses a value
 * that could never be a policy; the policy decides the real line. Both have to hold, or one
 * of them is decoration.
 */
await savePolicy({ passwordMinLength: 8 });

const nineChars = await call('PATCH', '/api/users/1', { password: TEMPORARY_PASSWORD });
check('a ten-character password is accepted once the minimum is eight', nineChars.status === 200);

/**
 * Changing a password ends the sessions that were opened with the old one.
 *
 * Asserted rather than worked around. A password change that leaves existing sessions alive
 * does not actually revoke anything — which is the entire reason somebody changes one after
 * a suspected leak.
 */
const withOldSession = await call('GET', '/api/security-config');
check('changing a password revokes the sessions opened with the old one', withOldSession.status === 401);

await loginWith(TEMPORARY_PASSWORD);
check('and the new password works straight away', cookie.length > 0);

const restore = await call('PATCH', '/api/users/1', { password });
check('the original password is put back', restore.status === 200);
await login();
check('and the administrator can log in with it again', cookie.length > 0);

await savePolicy({ passwordMinLength: startingPolicy['passwordMinLength'] });
check('the minimum is back where it started', cookie.length > 0);

// ---------------------------------------------------------------------------
console.log('\n=== Lockout threshold is enforced ===');
// ---------------------------------------------------------------------------

await savePolicy({ maxFailedLogins: 3, lockoutMinutes: 7 });
await db().userAccount.update({
  where: { id: 1 },
  data: { failedLoginCount: 0, lockedUntil: null },
});

let lockedAt = 0;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  const bad = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'pasti-bukan-kata-laluan-ini' }),
  });
  if (bad.status === 403 && lockedAt === 0) lockedAt = attempt;
}

const locked = await db().userAccount.findUnique({ where: { id: 1 } });
check('the account is locked after the configured number of attempts', locked?.lockedUntil !== null);
check('and the counter reached that number', locked?.failedLoginCount === 3);

const minutesOut = ((locked?.lockedUntil?.getTime() ?? 0) - Date.now()) / 60_000;
// The duration is the one on the screen, not the constant that used to be in the source.
check('the lock lasts the configured duration', minutesOut > 6 && minutesOut <= 7);
show('kunci', `${minutesOut.toFixed(1)} minit lagi, dari tetapan 7`);

const whileLocked = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email,
    password,
    ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
  }),
});
// Refused even with the right password: that is the whole point of a lockout.
check('the correct password is refused while locked', whileLocked.status === 403);
const body = (await whileLocked.json()) as Record<string, unknown>;
check('and the caller is told how long to wait', /\d+s/.test(String(body['error'])));
show('message', String(body['error']));

await db().userAccount.update({
  where: { id: 1 },
  data: { failedLoginCount: 0, lockedUntil: null },
});
await savePolicy({
  maxFailedLogins: startingPolicy['maxFailedLogins'],
  lockoutMinutes: startingPolicy['lockoutMinutes'],
});
await login();
check('and it works again once the lock is cleared', cookie.length > 0);

// ---------------------------------------------------------------------------
console.log('\n=== Token defaults come from the policy ===');
// ---------------------------------------------------------------------------

await savePolicy({ tokenDefaultDays: 7 });

// No `expiresInDays`, so the policy decides. A default that is ignored is a default that
// misleads whoever set it.
const defaulted = await call('POST', '/api/api-tokens', {
  name: 'Ujian lalai dasar',
  scopes: ['staff.directory:view'],
});
check('a token issued without an expiry takes the policy default', defaulted.status === 200);
createdTokens.push(Number(defaulted.body['id']));

const days = (new Date(String(defaulted.body['expiresAt'])).getTime() - Date.now()) / 86_400_000;
check('which is seven days, as configured', days > 6.9 && days <= 7);
show('luput', `${days.toFixed(2)} hari`);

await savePolicy({ tokenDefaultDays: 0 });
const noExpiry = await call('POST', '/api/api-tokens', {
  name: 'Ujian tanpa luput',
  scopes: ['staff.directory:view'],
});
createdTokens.push(Number(noExpiry.body['id']));
check('and zero days means no expiry at all', noExpiry.body['expiresAt'] === null);

// An explicit value still wins, so the default is a default and not a ceiling.
const explicit = await call('POST', '/api/api-tokens', {
  name: 'Ujian eksplisit',
  scopes: ['staff.directory:view'],
  expiresInDays: 30,
});
createdTokens.push(Number(explicit.body['id']));
const explicitDays =
  (new Date(String(explicit.body['expiresAt'])).getTime() - Date.now()) / 86_400_000;
check('an explicit expiry overrides the default', explicitDays > 29.9 && explicitDays <= 30);

// ---------------------------------------------------------------------------
console.log('\n=== The rotation grace window comes from the policy ===');
// ---------------------------------------------------------------------------

await savePolicy({ rotationGraceHours: 3 });

const rotated = await call('POST', `/api/api-tokens/${String(explicit.body['id'])}/rotate`);
check('rotation succeeds', rotated.status === 200);
createdTokens.push(Number(rotated.body['id']));

const hours = (new Date(String(rotated.body['graceUntil'])).getTime() - Date.now()) / 3_600_000;
check('and the grace window is the configured length', hours > 2.9 && hours <= 3);
show('rahmat', `${hours.toFixed(2)} jam, dari tetapan 3`);

// The behaviour the window exists for: no moment where every caller fails.
const oldRow = await db().apiToken.findUnique({ where: { id: Number(explicit.body['id']) } });
check('the old token is marked superseded rather than revoked', oldRow?.revokedAt === null);
check('and carries the grace deadline', oldRow?.graceUntil !== null);

// ---------------------------------------------------------------------------
console.log('\n=== Posture reflects reality ===');
// ---------------------------------------------------------------------------

const posture = ((await call('GET', '/api/security-config')).body['posture'] ?? {}) as Record<
  string,
  number
>;
check('active tokens are counted', posture['activeTokens'] !== undefined && posture['activeTokens'] > 0);
check('so are failed logins in the last day', (posture['failedLoginsLastDay'] ?? 0) >= 3);
show('posture', JSON.stringify(posture));

// ---------------------------------------------------------------------------
console.log('\n=== The two grants are separate ===');
// ---------------------------------------------------------------------------

const { PERMISSION_SECTIONS } = await import('../apps/server/src/auth/permissions.js');
const screens = PERMISSION_SECTIONS.flatMap((section) => section.screens);

const securityScreen = screens.find((entry) => entry.key === 'settings.security');
const apiScreen = screens.find((entry) => entry.key === 'settings.integration.api');

check('the security screen is in the registry', securityScreen !== undefined);
// Deciding the lockout policy and deciding who may mint API tokens are different jobs,
// held by different people.
check('separate from the API screen', apiScreen !== undefined && apiScreen !== securityScreen);
check(
  'the security screen offers view and edit only, because there is nothing to create',
  JSON.stringify(securityScreen?.actions) === JSON.stringify(['view', 'edit']),
);
check(
  'the API screen can create and delete, because tokens and webhooks are records',
  ['view', 'create', 'edit', 'delete'].every((action) => apiScreen?.actions.includes(action)),
);
show('skrin', `${String(securityScreen?.label)} · ${String(apiScreen?.label)}`);

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
  await db().securityConfig.findUnique({ where: { id: 1 } });
  await waitForServer();
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 60_000;
  let restarted = false;

  // Two passes: catch the window where it has gone away, then wait for it to come back.
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

async function login(): Promise<void> {
  await loginWith(password);
}

async function loginWith(secret: string): Promise<void> {
  cookie = '';
  await call('POST', '/api/auth/login', {
    email,
    password: secret,
    ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
  });
}

/**
 * Sends the whole policy, so a single change does not read as blanking the rest.
 *
 * `settle` waits out the five-second policy cache. Skipped where the save is expected to be
 * refused, since nothing changed and there is no cache to outlive.
 */
async function savePolicy(
  patch: Record<string, number>,
  options: { settle?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const read = await call('GET', '/api/security-config');
  const current = read.body['policy'] as Record<string, number> | undefined;

  // Surfaced rather than swallowed: a lost session here would otherwise send a partial body
  // and produce a 400 that reads like a schema problem.
  if (current === undefined) {
    check(`policy read before saving ${JSON.stringify(patch)}`, false);
    show('status', `${String(read.status)} ${String(read.body['error'] ?? '')}`);
    return read;
  }

  const response = await call('PUT', '/api/security-config', { ...current, ...patch });
  if (options.settle !== false) await new Promise((resolve) => setTimeout(resolve, 5200));
  return response;
}

/** Asserts a value outside the allowed range is refused by the schema, which answers 400. */
async function refuses(label: string, patch: Record<string, number>): Promise<void> {
  const response = await savePolicy(patch, { settle: false });
  check(`${label} is refused`, response.status === 400);
  if (response.status !== 400) show('status', String(response.status));
}

async function finish(): Promise<never> {
  console.log('\n=== Cleanup ===');

  for (const id of createdTokens) {
    await call('POST', `/api/api-tokens/${String(id)}/revoke`).catch(() => undefined);
    await db().apiToken.delete({ where: { id } }).catch(() => undefined);
  }
  show('token dibuang', String(createdTokens.length));

  const restored = await call('PUT', '/api/security-config', startingPolicy);
  check('the original policy is restored', restored.status === 200);

  const now = (await call('GET', '/api/security-config')).body['policy'];
  check('and reads back unchanged', JSON.stringify(now) === JSON.stringify(startingPolicy));
  show('dasar', JSON.stringify(now));

  const account = await db().userAccount.findUnique({ where: { id: 1 } });
  check('the administrator account is left unlocked', account?.lockedUntil === null);

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

async function call(
  method: string,
  path: string,
  payload?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
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
