/**
 * Verifies the self-service profile and the header alert feed.
 *
 * The point of this file is one boundary: a person may change their phone number and may
 * not change their employee number or their department. The first is a preference; the
 * second two are the join key to every attendance row and the driver of payroll subtotals.
 * Everything else here is secondary.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-profile.mts <password>
 */
import { randomBytes } from 'node:crypto';

import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-profile.mts <adminPassword>');
  process.exit(2);
}

let cookie = '';
let failures = 0;

const { db } = await import('../apps/server/src/db.js');

/**
 * Restores the administrator password on a crash.
 *
 * This script changes it deliberately, and a mid-run failure would otherwise leave a test
 * value in the database with no obvious sign of which one.
 */
const TEMPORARY_PASSWORD = 'Sement4raProfil!';

for (const signal of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(signal, (cause: unknown) => {
    console.error(`\n[CRASH] ${signal}:`, cause);
    void rescue().finally(() => process.exit(1));
  });
}

await warmUpPrisma();
await loginWith(password);
check('logged in', cookie.length > 0);

const original = (await call('GET', '/api/profile')).body;
const originalEditable = original['editable'] as Record<string, string>;

// ---------------------------------------------------------------------------
console.log('\n=== The payload separates what you own from what HR owns ===');
// ---------------------------------------------------------------------------

check('the profile responds', typeof original['editable'] === 'object');
check('with a managed block', typeof original['managed'] === 'object');
check('a photo block', typeof original['photo'] === 'object');
check('and the limits the form states', typeof original['limits'] === 'object');

const editableKeys = Object.keys(originalEditable);
check(
  'the editable block holds exactly the owned fields',
  [
    'phone',
    'position',
    'addressLine1',
    'addressLine2',
    'city',
    'state',
    'postcode',
    'country',
    'contactEmail',
  ].every((key) => editableKeys.includes(key)),
);
show('boleh disunting', editableKeys.join(', '));

const managed = original['managed'] as Record<string, unknown>;
check(
  'the managed block holds what HR owns',
  ['employeeNo', 'fullName', 'icNo', 'department', 'location', 'loginEmail', 'roleName'].every(
    (key) => key in managed,
  ),
);
// Neither appears among the editable fields, so the form has nothing to bind them to.
check('and none of those are editable', !editableKeys.includes('employeeNo') && !editableKeys.includes('department'));
show('diuruskan HR', `${String(managed['employeeNo'])} · ${String(managed['department'])}`);

/**
 * The terminal credential counts, kept beside the avatar so the screen can say they are
 * different things. Somebody who thinks replacing their photo re-enrols their face has been
 * told something false by the interface.
 */
const biometrics = managed['biometrics'] as Record<string, number>;
check('terminal credentials are reported separately from the avatar', typeof biometrics === 'object');
check('with all three counts', ['face', 'fingerprint', 'card'].every((key) => key in biometrics));
show('kredensial', JSON.stringify(biometrics));

check('no password hash appears anywhere', !JSON.stringify(original).toLowerCase().includes('passwordhash'));
check('nor the TOTP secret', !JSON.stringify(original).toLowerCase().includes('totpsecret'));
check('nor the encrypted door PIN', !JSON.stringify(original).toLowerCase().includes('doorpin'));

// ---------------------------------------------------------------------------
console.log('\n=== Owned fields save ===');
// ---------------------------------------------------------------------------

const mine = {
  phone: '+60128887777',
  position: 'Pegawai Teknologi Maklumat F41',
  addressLine1: 'No. 12, Jalan Tunku Abdul Rahman',
  addressLine2: 'Taman Sibu Jaya',
  city: 'Sibu',
  state: 'Sarawak',
  postcode: '96000',
  country: 'Malaysia',
  contactEmail: 'faizan.peribadi@contoh.com',
};

const saved = await call('PUT', '/api/profile', mine);
check('the owned fields save', saved.status === 200);

const readBack = (await call('GET', '/api/profile')).body['editable'] as Record<string, string>;
check('and read back exactly as sent', JSON.stringify(readBack) === JSON.stringify(mine));
show('jawatan', readBack['position'] ?? '');
show('alamat', `${readBack['city'] ?? ''}, ${readBack['state'] ?? ''} ${readBack['postcode'] ?? ''}`);

// Written to the staff row, not to a side table: the same columns the directory reads.
const staffRow = await db().staff.findFirst({ where: { employeeNo: String(managed['employeeNo']) } });
check('they land on the staff record', staffRow?.position === mine.position);
check('and the address too', staffRow?.city === 'Sibu' && staffRow?.postcode === '96000');

const cleared = await call('PUT', '/api/profile', { ...mine, addressLine2: '', position: '' });
check('a blank field is accepted', cleared.status === 200);
const afterClear = await db().staff.findFirst({ where: { employeeNo: String(managed['employeeNo']) } });
// Stored as NULL rather than an empty string, so "not set" has one representation.
check('and stored as null rather than an empty string', afterClear?.addressLine2 === null);

const badEmail = await call('PUT', '/api/profile', { ...mine, contactEmail: 'bukan-emel' });
check('an invalid contact email is refused', badEmail.status === 400);
show('message', String(badEmail.body['error']));

// ---------------------------------------------------------------------------
console.log('\n=== Interface language is the caller\u2019s own choice ===');
// ---------------------------------------------------------------------------

/**
 * The language a person reads is theirs, and the options travel with the profile.
 *
 * They have to: `GET /api/translations` is gated on `settings.translation:view`, and five
 * thousand staff hold no settings permission at all. A picker whose options live behind a
 * permission is a picker with no options.
 */
const language = original['language'] as {
  chosen: string;
  fallback: { code: string; name: string } | null;
  options: { code: string; name: string; isSource: boolean }[];
};

check('the profile carries a language block', typeof language === 'object');
check('with the options to choose from', Array.isArray(language.options));
// Only active languages. An unfinished one renders half a screen in the source language,
// which reads as a broken screen rather than as an unfinished translation.
const localeRows = await db().translationLocale.findMany({ select: { code: true, active: true } });
const inactive = new Set(localeRows.filter((row) => !row.active).map((row) => row.code));
check(
  'and only languages that are switched on',
  language.options.every((option) => !inactive.has(option.code)),
);
show('ditawarkan', language.options.map((option) => option.code).join(', ') || '(tiada)');
show('pilihan semasa', language.chosen === '' ? 'ikut lalai' : language.chosen);

/**
 * A language nobody is offering is refused, not accepted and ignored.
 *
 * Accepting it would leave the screen showing a choice the interface is not honouring, and
 * the person reads that as the translation being broken rather than the language being
 * unavailable.
 */
const madeUp = await call('PUT', '/api/profile', { ...mine, locale: 'xx' });
check('an unknown language is refused', madeUp.status === 409);
check('and the refusal names it', String(madeUp.body['error']).includes('xx'));
show('message', String(madeUp.body['error']));

const offered = language.options.find((option) => !option.isSource) ?? language.options[0];

if (offered === undefined) {
  show('dilangkau', 'tiada bahasa aktif untuk diuji');
} else {
  const picked = await call('PUT', '/api/profile', { ...mine, locale: offered.code });
  check(`choosing ${offered.code} is accepted`, picked.status === 200);

  // On the account, not the staff row: the preference belongs to the login, and the staff
  // table holds rows for people who never sign in.
  const account = await db().userAccount.findFirst({
    where: { staff: { employeeNo: String(managed['employeeNo']) } },
    select: { locale: true },
  });
  check('it lands on the account row', account?.locale === offered.code);

  /**
   * The session is what the client reads, so the choice has to arrive there.
   *
   * Resolved server-side rather than left to the browser: one answer to "which language is
   * this session in", and the client cannot hold a different one.
   */
  const me = (await call('GET', '/api/auth/me')).body['display'] as Record<string, unknown>;
  check('and the session reports it', me['locale'] === offered.code);
  show('sesi', String(me['locale']));

  // The dictionary the interface actually renders from follows the same code.
  const dictionary = (await call('GET', `/api/translations/dictionary?locale=${offered.code}`)).body;
  check('the dictionary answers for that language', dictionary['locale'] === offered.code);

  const back = await call('PUT', '/api/profile', { ...mine, locale: '' });
  check('clearing it is accepted', back.status === 200);
  const afterReset = await db().userAccount.findFirst({
    where: { staff: { employeeNo: String(managed['employeeNo']) } },
    select: { locale: true },
  });
  // Null rather than an empty string, so "follow the default" has one representation — and
  // so moving the default later moves this person with it.
  check('and stored as null rather than an empty string', afterReset?.locale === null);

  const defaulted = (await call('GET', '/api/auth/me')).body['display'] as Record<string, unknown>;
  check(
    'the session falls back to the deployment default',
    defaulted['locale'] === (language.fallback?.code ?? 'ms'),
  );
  show('lalai', String(defaulted['locale']));
}

/**
 * Omitting the key leaves the choice alone.
 *
 * Absent and `''` are different instructions — "do not touch it" and "clear it" — and a
 * single optional field could not carry both if absent were treated as a clear.
 */
const untouched = await call('PUT', '/api/profile', mine);
check('a save without the key is accepted', untouched.status === 200);

// ---------------------------------------------------------------------------
console.log('\n=== HR-owned fields cannot be written through here ===');
// ---------------------------------------------------------------------------

/**
 * The check this file exists for.
 *
 * Refused rather than silently stripped. A strip would be safe — the column would not
 * change — but it would answer 200, and somebody probing the boundary would learn nothing
 * while the log recorded a successful profile update.
 */
for (const [label, extra] of [
  ['the employee number', { employeeNo: '999999' }],
  ['the full name', { fullName: 'Nama Lain' }],
  ['the department', { departmentId: 1 }],
  ['the department by name', { department: 'Kewangan' }],
  ['the IC number', { icNo: '900101015555' }],
  ['the login email', { loginEmail: 'lain@hospital.local' }],
  ['the role', { roleId: 1 }],
  ['the avatar path', { photoPath: '../../../.env' }],
  ['the account status', { status: 'active' }],
  ['the biometric face count', { numOfFace: 5 }],
] as const) {
  const response = await call('PUT', '/api/profile', { ...mine, ...extra });
  check(`${label} is refused`, response.status === 400);
  if (response.status !== 400) show('status', String(response.status));
}

const named = await call('PUT', '/api/profile', { ...mine, employeeNo: '999999' });
check('and the refusal names the key that was rejected', String(named.body['error']).includes('employeeNo'));
show('message', String(named.body['error']));

const stillMine = await db().staff.findFirst({ where: { employeeNo: String(managed['employeeNo']) } });
check('the employee number is untouched', stillMine?.employeeNo === managed['employeeNo']);
check('and so is the department', stillMine?.departmentId === staffRow?.departmentId);

// ---------------------------------------------------------------------------
console.log('\n=== Avatar upload ===');
// ---------------------------------------------------------------------------

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

const uploaded = await upload('photo.png', png, 'image/png');
check('a PNG is accepted', uploaded.status === 200);
check('and answers with a URL rather than a path', String(uploaded.body['url']).startsWith('/api/profile/photo/'));
show('hasil', JSON.stringify(uploaded.body));

const fetched = await fetch(`${BASE}/api/profile/photo/${String(staffRow?.id)}`, {
  headers: { cookie },
});
check('the avatar is served back', fetched.status === 200);
check('with the type read from the bytes', fetched.headers.get('content-type') === 'image/png');
// Private: these are pictures of colleagues, not public assets.
check('and a private cache header', (fetched.headers.get('cache-control') ?? '').includes('private'));
await fetched.body?.cancel();

const anonymous = await fetch(`${BASE}/api/profile/photo/${String(staffRow?.id)}`);
check('an avatar is not served without a session', anonymous.status === 401);

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const svgUpload = await upload('me.svg', svg, 'image/svg+xml');
check('an SVG is refused', svgUpload.status === 409);
check('and the refusal says why', String(svgUpload.body['error']).includes('skrip'));

const liar = await upload('me.png', svg, 'image/png');
// The declared type is a string the client chose, so it must not be what decides.
check('an SVG relabelled as a PNG is still refused', liar.status === 409);

const oversize = await upload('huge.png', Buffer.concat([png, randomBytes(512 * 1024 + 256)]), 'image/png');
check('a file over the ceiling is refused', oversize.status === 409 || oversize.status === 413);

const otherPersons = await fetch(`${BASE}/api/profile/photo/999999`, { headers: { cookie } });
check('an avatar for a staff id that does not exist is a 404', otherPersons.status === 404);

const removed = await call('DELETE', '/api/profile/photo');
check('the avatar can be removed', removed.status === 200);
check('and is then absent', (await call('GET', '/api/profile')).body['photo']?.['set'] === false);

// Removing an avatar must not touch the terminal credentials.
const afterRemove = await db().staff.findFirst({ where: { employeeNo: String(managed['employeeNo']) } });
check('removing it leaves the biometric counts alone', afterRemove?.numOfFace === staffRow?.numOfFace);
show('muka', `${String(afterRemove?.numOfFace)} templat masih didaftar`);

// ---------------------------------------------------------------------------
console.log('\n=== Changing your own password ===');
// ---------------------------------------------------------------------------

const wrongCurrent = await call('POST', '/api/profile/password', {
  currentPassword: 'pasti-bukan-ini',
  newPassword: TEMPORARY_PASSWORD,
});
/**
 * Required, unlike the administrator reset. A session left open on an unlocked machine must
 * not be enough to lock the owner out of their own account.
 */
check('a wrong current password is refused', wrongCurrent.status === 409);
show('message', String(wrongCurrent.body['error']));

await new Promise((resolve) => setTimeout(resolve, 400));
const attempts = await db().activityLog.count({
  where: { action: 'profile.password_failed', createdAt: { gte: new Date(Date.now() - 60_000) } },
});
// A run of these against one account is somebody guessing.
check('and the attempt is recorded', attempts > 0);

const same = await call('POST', '/api/profile/password', {
  currentPassword: password,
  newPassword: password,
});
check('reusing the current password is refused', same.status === 409);

const tooShort = await call('POST', '/api/profile/password', {
  currentPassword: password,
  newPassword: 'Pendek1',
});
check('a password under the policy minimum is refused', tooShort.status === 409);
check('by the same policy the administrator path uses', String(tooShort.body['error']).includes('aksara'));
show('message', String(tooShort.body['error']));

/** A second session, so the revocation can be observed rather than assumed. */
const other = await openSecondSession(password);
check('a second session can be opened', other.length > 0);
check('and it works', (await callAs(other, 'GET', '/api/profile')).status === 200);

const changed = await call('POST', '/api/profile/password', {
  currentPassword: password,
  newPassword: TEMPORARY_PASSWORD,
});
check('the password changes', changed.status === 200);
check('and the answer says what it did to other devices', String(changed.body['note']).includes('peranti lain'));

/**
 * This is the pair that matters. The other session dies because it was opened with the old
 * password — which is what a leak would be using. This one survives, because being signed
 * out by your own successful change reads as the change having failed.
 */
check('the other session is revoked', (await callAs(other, 'GET', '/api/profile')).status === 401);
check('and this one still works', (await call('GET', '/api/profile')).status === 200);

check('the old password no longer logs in', !(await canLogIn(password)));
check('and the new one does', await canLogIn(TEMPORARY_PASSWORD));

// Put it back. Login again first, since the change above revoked nothing of ours but the
// helper reassigns the cookie.
await loginWith(TEMPORARY_PASSWORD);
const restored = await call('POST', '/api/profile/password', {
  currentPassword: TEMPORARY_PASSWORD,
  newPassword: password,
});
check('the original password is restored', restored.status === 200);
await loginWith(password);
check('and logs in again', cookie.length > 0);

// ---------------------------------------------------------------------------
console.log('\n=== The alert feed behind the bell ===');
// ---------------------------------------------------------------------------

const alerts = await call('GET', '/api/alerts');
check('alerts respond', alerts.status === 200);
check('with a list', Array.isArray(alerts.body['alerts']));
check('a total', typeof alerts.body['total'] === 'number');
check('and the worst tone, so the badge can be coloured', 'worst' in alerts.body);

const list = (alerts.body['alerts'] ?? []) as Array<Record<string, unknown>>;
check(
  'every alert carries what the row renders',
  list.every((alert) => ['id', 'tone', 'title', 'detail', 'count', 'to'].every((key) => key in alert)),
);
// A badge that leads to a 403 teaches people to ignore the badge.
check(
  'and points at a screen rather than an API path',
  list.every((alert) => String(alert['to']).startsWith('/') && !String(alert['to']).startsWith('/api')),
);
show('amaran', list.map((alert) => `${String(alert['id'])}(${String(alert['count'])})`).join(', ') || 'tiada');
show('paling teruk', String(alerts.body['worst']));

/**
 * Counted as conditions rather than rows. Five offline terminals is one thing to go and
 * deal with, and a badge reading "47" for the same fault is a badge people stop reading.
 */
check('the total counts conditions, not rows', alerts.body['total'] === list.length);

const tones = new Set(list.map((alert) => String(alert['tone'])));
check('tones stay within the three the badge knows', [...tones].every((tone) => ['danger', 'warn', 'info'].includes(tone)));

const anonymousAlerts = await fetch(`${BASE}/api/alerts`);
check('alerts need a session', anonymousAlerts.status === 401);

await finish();

// ---------------------------------------------------------------------------

async function finish(): Promise<never> {
  console.log('\n=== Cleanup ===');

  await loginWith(password).catch(() => undefined);

  const restore = await call('PUT', '/api/profile', {
    phone: originalEditable['phone'] ?? '',
    position: originalEditable['position'] ?? '',
    addressLine1: originalEditable['addressLine1'] ?? '',
    addressLine2: originalEditable['addressLine2'] ?? '',
    city: originalEditable['city'] ?? '',
    state: originalEditable['state'] ?? '',
    postcode: originalEditable['postcode'] ?? '',
    country: originalEditable['country'] ?? '',
    contactEmail: originalEditable['contactEmail'] ?? '',
  });
  check('the original profile is restored', restore.status === 200);

  const account = await db().userAccount.findUnique({ where: { id: 1 } });
  check('the account is left unlocked', account?.lockedUntil === null);
  check('and the original password works', await canLogIn(password));

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

async function rescue(): Promise<void> {
  console.error('\n=== Emergency restore ===');

  for (const candidate of [password, TEMPORARY_PASSWORD]) {
    await loginWith(candidate).catch(() => undefined);
    if (cookie.length === 0) continue;

    if (candidate !== password) {
      const back = await call('POST', '/api/profile/password', {
        currentPassword: candidate,
        newPassword: password,
      });
      console.error(`  kata laluan dipulihkan: ${String(back.status)}`);
    }
    console.error('  kata laluan asal berkuat kuasa.');
    return;
  }

  console.error(
    `  TIDAK DAPAT LOG MASUK. Kata laluan mungkin masih "${TEMPORARY_PASSWORD}" — ` +
      'log masuk dengannya dan tukar semula di Profil Saya.',
  );
}

async function upload(
  filename: string,
  bytes: Buffer,
  contentType: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const boundary = `----kehadiran${randomBytes(8).toString('hex')}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);

  const response = await fetch(`${BASE}/api/profile/photo`, {
    method: 'POST',
    headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat([head, bytes, tail]),
  });

  return { status: response.status, body: await parse(response) };
}

/** A cookie from a separate login, so revocation can be observed on a real session. */
async function openSecondSession(secret: string): Promise<string> {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: secret,
      ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
    }),
  });

  for (const entry of response.headers.getSetCookie()) {
    const pair = entry.split(';')[0];
    if (pair?.startsWith('attendance_session=')) return pair;
  }
  return '';
}

async function canLogIn(secret: string): Promise<boolean> {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: secret,
      ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
    }),
  });
  return response.status === 200;
}

async function loginWith(secret: string): Promise<void> {
  cookie = '';
  await call('POST', '/api/auth/login', {
    email,
    password: secret,
    ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
  });
}

async function callAs(
  sessionCookie: string,
  method: string,
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE}${path}`, { method, headers: { cookie: sessionCookie } });
  return { status: response.status, body: await parse(response) };
}

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, Record<string, unknown> | undefined> & Record<string, unknown> }> {
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

async function parse(response: Response): Promise<Record<string, never>> {
  const text = await response.text();
  try {
    return (JSON.parse(text) ?? {}) as Record<string, never>;
  } catch {
    return { raw: text.slice(0, 200) } as unknown as Record<string, never>;
  }
}

async function warmUpPrisma(): Promise<void> {
  await db().staff.count();
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

function show(label: string, value: string): void {
  console.log(`         ${label}: ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
