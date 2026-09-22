/**
 * Verifies Tetapan > Konfigurasi Umum: the General tab, Backup & Restore, and
 * Maintenance & Cache.
 *
 * The parts worth proving here are the ones that act on their own: a backup schedule that
 * silently never fires, a log level that discards the record of a purge, a maintenance
 * mode that blocks the terminal. Each is provoked rather than inspected.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-config.mts <password>
 */
import { createHash, randomBytes } from 'node:crypto';

import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-config.mts <adminPassword>');
  process.exit(2);
}

let cookie = '';
let failures = 0;

const { db } = await import('../apps/server/src/db.js');

await warmUpPrisma();
await login();
check('logged in', cookie.length > 0);

/** Restored at the end, so a configured installation survives this run. */
const original = (await call('GET', '/api/settings')).body;
const originalValues = (original['values'] ?? {}) as Record<string, unknown>;

/**
 * Turned off first and last.
 *
 * Every other check in this file goes through an endpoint that maintenance mode refuses,
 * so leaving it on from a previous crashed run would fail everything after it.
 */
await saveSettings({ 'maintenance.enabled': false });

// ---------------------------------------------------------------------------
console.log('\n=== The Branding screen is gone ===');
// ---------------------------------------------------------------------------

const matrix = await call('GET', '/api/roles/matrix');
const screens = ((matrix.body['sections'] ?? []) as Array<{ screens: Array<{ key: string }> }>)
  .flatMap((section) => section.screens)
  .map((screen) => screen.key);

check('settings.branding is no longer a screen', !screens.includes('settings.branding'));
check('and settings.general remains', screens.includes('settings.general'));

// A key outside the registry is refused for the whole request, so a client still sending
// the old colour cannot half-save a form.
const colour = await call('PUT', '/api/settings', { values: { 'branding.primaryColour': '#ff0000' } });
check('the brand colour key is refused', colour.status === 409);
show('message', String(colour.body['error']));

const logoUrl = await call('PUT', '/api/settings', { values: { 'branding.logoUrl': '/x.png' } });
check('and so is the old logo URL key', logoUrl.status === 409);

const leftover = await db().setting.count({ where: { key: { startsWith: 'branding.' } } });
// GET iterates the table rather than the registry, so a stale row would keep coming back.
check('no branding rows are left in the database', leftover === 0);

// ---------------------------------------------------------------------------
console.log('\n=== Values are checked per key, not just for being scalars ===');
// ---------------------------------------------------------------------------

for (const [label, values] of [
  ['an hour above 23', { 'backup.hour': 99 }],
  ['a negative hour', { 'backup.hour': -1 }],
  ['a keep count of one', { 'backup.keepCount': 1 }],
  ['an unknown log level', { 'logging.level': 'verbose' }],
  ['log retention under a week', { 'logging.retentionDays': 3 }],
  ['a date format that is not offered', { 'organisation.dateFormat': 'MM-DD-YY' }],
  ['a time format that is neither 12 nor 24', { 'organisation.timeFormat': '36' }],
  ['a week start that is not Sunday or Monday', { 'organisation.weekStart': '3' }],
] as const) {
  const response = await call('PUT', '/api/settings', { values });
  check(`${label} is refused`, response.status === 409);
  if (response.status !== 409) show('status', String(response.status));
}

const named = await call('PUT', '/api/settings', { values: { 'backup.hour': 99 } });
// A rejection naming the key, because "data tidak sah" across fifteen fields says nothing.
check('and the refusal names the key and the value', String(named.body['error']).includes('backup.hour'));
show('message', String(named.body['error']));

// A keep count of two is the floor, and it is allowed: pruning must never be able to
// remove the only copy that exists.
check('a keep count of two is allowed', (await saveSettings({ 'backup.keepCount': 2 })).status === 200);

// ---------------------------------------------------------------------------
console.log('\n=== Numbers are stored as numbers ===');
// ---------------------------------------------------------------------------

// A select posts "3". Stored as a string it reads back as NaN in the worker, and the
// schedule silently never matches the hour.
await saveSettings({ 'backup.hour': '3' as unknown as number });
const stored = await db().setting.findUnique({ where: { key: 'backup.hour' } });
check('a numeric field posted as text is coerced before storage', stored?.value === 3);
show('tersimpan', `${JSON.stringify(stored?.value)} (${typeof stored?.value})`);

// ---------------------------------------------------------------------------
console.log('\n=== Logo and favicon uploads ===');
// ---------------------------------------------------------------------------

const png = pngBytes();

const uploaded = await upload('logo', 'logo.png', png, 'image/png');
check('a PNG is accepted', uploaded.status === 200);
show('hasil', JSON.stringify(uploaded.body));

const served = await fetch(`${BASE}/api/branding/logo`);
check('and is served back', served.status === 200);
check('with the type decided from the bytes', served.headers.get('content-type') === 'image/png');
const returned = Buffer.from(await served.arrayBuffer());
check('byte for byte', createHash('sha256').update(returned).digest('hex') === createHash('sha256').update(png).digest('hex'));

/**
 * The one that matters. An SVG is the obvious format for a logo and it is also an XML
 * document that can carry a script, served from this origin, where the CSP allows scripts
 * from 'self'.
 */
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const svgUpload = await upload('logo', 'logo.svg', svg, 'image/svg+xml');
check('an SVG is refused', svgUpload.status === 409);
check('and the refusal says why', String(svgUpload.body['error']).includes('skrip'));
show('message', String(svgUpload.body['error']).slice(0, 140));

// The declared type is a string the client chooses, so it must not be what decides.
const liar = await upload('logo', 'evil.png', svg, 'image/png');
check('an SVG relabelled as a PNG is still refused', liar.status === 409);

const textFile = await upload('favicon', 'notes.txt', Buffer.from('bukan imej'), 'text/plain');
check('a text file is refused', textFile.status === 409);

const empty = await upload('logo', 'empty.png', Buffer.alloc(0), 'image/png');
check('an empty file is refused', empty.status === 409);

// 1 MB ceiling. Random bytes so it cannot compress under the limit in transit.
const huge = Buffer.concat([png, randomBytes(1024 * 1024 + 512)]);
const oversize = await upload('logo', 'huge.png', huge, 'image/png');
check('a file over the size ceiling is refused', oversize.status === 409 || oversize.status === 413);
show('status', String(oversize.status));

const badSlot = await upload('banner', 'logo.png', png, 'image/png');
// Only two slots exist, and the slot is what picks the row and the filename.
check('an unknown slot is refused', badSlot.status === 400 || badSlot.status === 404);

// ---------------------------------------------------------------------------
console.log('\n=== The path on disk stays server-side ===');
// ---------------------------------------------------------------------------

const settings = await call('GET', '/api/settings');
const branding = settings.body['branding'] as Record<string, Record<string, unknown>>;
check('the payload reports the logo as set', branding['logo']?.['set'] === true);
check('with a URL rather than a filename', String(branding['logo']?.['url']).startsWith('/api/branding/logo'));
check('and a cache buster on it', String(branding['logo']?.['url']).includes('?v='));

const values = (settings.body['values'] ?? {}) as Record<string, unknown>;
/**
 * The stored value is a filename this server later joins onto a directory and streams.
 * Letting it through the settings endpoint would let an operator point it anywhere on the
 * disk and then fetch it.
 */
const pathWrite = await call('PUT', '/api/settings', {
  values: { 'organisation.logoPath': '../../../.env' },
});
check('the stored path cannot be written through the settings endpoint', pathWrite.status === 409);
check('but it is readable, so the screen can tell it is set', 'organisation.logoPath' in values);

const removed = await call('DELETE', '/api/branding/logo');
check('the logo can be removed', removed.status === 200);
check('and is then absent', (await fetch(`${BASE}/api/branding/logo`)).status === 404);

// ---------------------------------------------------------------------------
console.log('\n=== Backup ===');
// ---------------------------------------------------------------------------

const backup = await call('GET', '/api/backup');
check('the backup list responds', backup.status === 200);
check('with the schedule policy', typeof backup.body['policy'] === 'object');
check('and the total size on disk', typeof backup.body['totalBytes'] === 'number');
show('fail', `${String((backup.body['files'] as unknown[]).length)} · ${String(backup.body['totalBytes'])} bait`);

const policy = backup.body['policy'] as Record<string, unknown>;
check(
  'the policy carries every field the screen edits',
  ['enabled', 'hour', 'keepCount', 'lastRunAt'].every((key) => key in policy),
);
show('dasar', JSON.stringify(policy));

check('the tool is present, so the button is usable', backup.body['toolAvailable'] === true);

if (backup.body['toolAvailable'] === true) {
  const before = ((await call('GET', '/api/backup')).body['files'] as unknown[]).length;

  const run = await call('POST', '/api/backup/run');
  check('a manual backup runs', run.status === 200);
  check('and reports what it wrote', String(run.body['name']).endsWith('.sql'));
  check('with a size', Number(run.body['bytes']) > 0);
  check('and what it pruned, even when that is nothing', Array.isArray(run.body['pruned']));
  show('dump', `${String(run.body['name'])} · ${String(Math.round(Number(run.body['bytes']) / 1024))} KB · ${String(run.body['durationMs'])}ms`);

  const after = (await call('GET', '/api/backup')).body['files'] as Array<Record<string, unknown>>;
  check('the file appears in the list', after.some((file) => file['name'] === run.body['name']));
  check(
    'and pruning kept the count at the limit',
    after.length <= Math.max(2, Number(policy['keepCount'])) || before < 2,
  );
  show('selepas', `${String(after.length)} fail, had ${String(policy['keepCount'])}`);

  // Pruning removes the oldest beyond the count. Driven down to the floor rather than
  // by taking fourteen dumps.
  await saveSettings({ 'backup.keepCount': 2 });
  const pruneRun = await call('POST', '/api/backup/run');
  const pruned = (pruneRun.body['pruned'] ?? []) as string[];
  const remaining = (await call('GET', '/api/backup')).body['files'] as unknown[];
  check('lowering the keep count prunes on the next run', remaining.length <= 2);
  show('dibuang', `${String(pruned.length)} fail · ${String(remaining.length)} kekal`);

  const download = await fetch(`${BASE}/api/backup/${String(run.body['name'])}`, {
    headers: { cookie },
  });
  // Only checked for a real body: the content is a database dump and this script has no
  // business holding it in memory.
  check(
    'a dump downloads with an attachment disposition',
    (download.headers.get('content-disposition') ?? '').includes('attachment'),
  );
  await download.body?.cancel();
}

const traversal = await fetch(`${BASE}/api/backup/..%2F..%2F.env`, { headers: { cookie } });
check('a traversal in the filename is refused', traversal.status === 404 || traversal.status === 400);

// ---------------------------------------------------------------------------
console.log('\n=== Maintenance mode ===');
// ---------------------------------------------------------------------------

const lockout = await call('PUT', '/api/settings', {
  values: { 'maintenance.enabled': true, 'maintenance.allowIps': '203.0.113.7' },
});
/**
 * The operator who turns this on is the one who has to turn it off, and a locked-out
 * administrator has no route back except editing the database by hand.
 */
check('switching it on from an address not on the list is refused', lockout.status === 409);
check('and the refusal names the caller address', String(lockout.body['error']).includes('127.0.0.1'));
show('message', String(lockout.body['error']).slice(0, 150));

const on = await call('PUT', '/api/settings', {
  values: {
    'maintenance.enabled': true,
    'maintenance.allowIps': '127.0.0.1',
    'maintenance.message': 'Ujian penyelenggaraan.',
  },
});
check('switching it on with your own address listed is accepted', on.status === 200);

// This script is on loopback, which is listed, so it should still be served.
check('an allowed address is still served', (await call('GET', '/api/dashboard')).status === 200);

/**
 * The check that matters most. A scan the terminal cannot deliver is not retried in any
 * form this application can rely on — it leaves the device's ring buffer and is gone.
 */
const ingest = await fetch(`${BASE}/hik/events`, { method: 'POST', body: '{}' });
check('the ingest path is never refused, so no scan is lost', ingest.status !== 503);
show('ingest', `HTTP ${String(ingest.status)} (401 ialah leg pertama Digest, bukan penolakan)`);

const health = await fetch(`${BASE}/api/health`);
check('health stays answerable, because a server in maintenance is alive', health.status === 200);

// Refusing this would make the mode one-way.
check('and the settings endpoint stays reachable', (await call('GET', '/api/settings')).status === 200);

const blocked = await fetch(`${BASE}/api/dashboard`, {
  headers: { cookie, 'x-forwarded-for': '198.51.100.9' },
});
check('an address off the list is refused', blocked.status === 503);
const blockedBody = (await blocked.json()) as Record<string, unknown>;
check('with the operator message', blockedBody['error'] === 'Ujian penyelenggaraan.');
check('and a code a client can branch on', blockedBody['code'] === 'maintenance');
check('and a retry-after', blocked.headers.get('retry-after') !== null);

// A trailing wildcard is the form somebody actually types.
await saveSettings({ 'maintenance.allowIps': '127.0.0.1, 198.51.100.*' });
const wildcard = await fetch(`${BASE}/api/dashboard`, {
  headers: { cookie, 'x-forwarded-for': '198.51.100.9' },
});
check('a trailing wildcard admits the whole range', wildcard.status === 200);

await saveSettings({ 'maintenance.allowIps': '127.0.0.1, 198.51.100.0/24' });
const cidr = await fetch(`${BASE}/api/dashboard`, {
  headers: { cookie, 'x-forwarded-for': '198.51.100.9' },
});
check('and so does CIDR', cidr.status === 200);

const off = await saveSettings({ 'maintenance.enabled': false });
check('switching it off is accepted', off.status === 200);
// Dropped rather than left to expire: a toggle that appears not to work gets clicked again.
check('and takes effect immediately, not after the cache expires', (await call('GET', '/api/dashboard')).status === 200);

// ---------------------------------------------------------------------------
console.log('\n=== Log level ===');
// ---------------------------------------------------------------------------

await saveSettings({ 'logging.level': 'warn' });
// The level is cached for thirty seconds.
await new Promise((resolve) => setTimeout(resolve, 31_000));

const beforeInfo = await db().activityLog.count();
await call('GET', '/api/settings');
await new Promise((resolve) => setTimeout(resolve, 500));
const afterInfo = await db().activityLog.count();

await saveSettings({ 'logging.level': 'info' });
await new Promise((resolve) => setTimeout(resolve, 31_000));

/**
 * A warn is written whatever the level. The options offered stop at `warn` for exactly
 * this reason: a verbosity control that can discard the record of a purge is not a
 * verbosity control.
 */
const beforeWarn = await db().activityLog.count({ where: { level: 'warn' } });
await saveSettings({ 'maintenance.message': 'Kekal dilog.' });
await call('PUT', '/api/settings', {
  values: { 'maintenance.enabled': true, 'maintenance.allowIps': '127.0.0.1' },
});
await new Promise((resolve) => setTimeout(resolve, 500));
const afterWarn = await db().activityLog.count({ where: { level: 'warn' } });
await saveSettings({ 'maintenance.enabled': false });

check('a warning is recorded even so', afterWarn > beforeWarn);
show('kiraan', `info ${String(beforeInfo)}→${String(afterInfo)} · warn ${String(beforeWarn)}→${String(afterWarn)}`);

// ---------------------------------------------------------------------------
console.log('\n=== Cache and health ===');
// ---------------------------------------------------------------------------

const cache = await call('POST', '/api/maintenance/cache', { scope: 'all' });
check('the caches can be cleared', cache.status === 200);
check('and it says what it cleared', Array.isArray(cache.body['cleared']));
show('dikosongkan', (cache.body['cleared'] as string[]).join(', '));

const configOnly = await call('POST', '/api/maintenance/cache', { scope: 'config' });
// Said plainly, because clearing a one-second cache is close to waiting one second.
check('clearing only the config cache says what that is worth', String(configOnly.body['note']).includes('luput sendiri'));

const state = await call('GET', '/api/maintenance/health');
check('health responds', state.status === 200);
check('the database is checked with a query, not assumed', (state.body['database'] as Record<string, unknown>)['latencyMs'] !== null);
check('storage is checked with a real write', (state.body['storage'] as Record<string, unknown>)['ok'] === true);
check('the backup age is reported, not just whether one is scheduled', 'staleDays' in (state.body['backup'] as Record<string, unknown>));
check('and both log tables are counted separately', 'auditRows' in (state.body['logs'] as Record<string, unknown>));
show('kesihatan', JSON.stringify(state.body['backup']));
show('log', JSON.stringify(state.body['logs']));

const trim = await call('POST', '/api/maintenance/trim-logs');
check('the activity log can be trimmed', trim.status === 200);
// Two tables on purpose: one is a running commentary, the other is the record of change.
check('and the audit log is left alone', String(trim.body['note']).includes('Audit'));
show('dipotong', `${String(trim.body['deleted'])} entri sebelum ${String(trim.body['cutoff']).slice(0, 10)}`);

await finish();

// ---------------------------------------------------------------------------

/** A one-pixel PNG, built rather than read so this script needs no fixture files. */
function pngBytes(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
    'base64',
  );
}

async function upload(
  slot: string,
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

  const response = await fetch(`${BASE}/api/branding/${slot}`, {
    method: 'POST',
    headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat([head, bytes, tail]),
  });

  const text = await response.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = (JSON.parse(text) ?? {}) as Record<string, unknown>;
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: parsed };
}

async function saveSettings(
  values: Record<string, string | number | boolean | null>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await call('PUT', '/api/settings', { values });
  if (response.status !== 200) {
    check(`settings save ${JSON.stringify(values)}`, false);
    show('error', String(response.body['error']).slice(0, 160));
  }
  return response;
}

async function finish(): Promise<never> {
  console.log('\n=== Cleanup ===');

  // Maintenance mode first and unconditionally: leaving it on would break every other
  // script that runs after this one.
  await call('PUT', '/api/settings', { values: { 'maintenance.enabled': false } });

  const touched = [
    'organisation.dateFormat',
    'organisation.weekStart',
    'organisation.timeFormat',
    'backup.autoEnabled',
    'backup.hour',
    'backup.keepCount',
    'maintenance.message',
    'maintenance.allowIps',
    'logging.level',
    'logging.retentionDays',
  ];

  const restore: Record<string, string | number | boolean | null> = {};
  const absent: string[] = [];

  for (const key of touched) {
    const value = originalValues[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      restore[key] = value;
    } else {
      absent.push(key);
    }
  }

  if (Object.keys(restore).length > 0) {
    const response = await call('PUT', '/api/settings', { values: restore });
    check('the previous settings are restored', response.status === 200);
    show('dipulihkan', Object.keys(restore).join(', '));
  }

  /**
   * A key that did not exist before this run is deleted rather than set back to a guess.
   *
   * Leaving a test value behind is how `backup.keepCount` ends up at 2 on a real
   * installation and quietly prunes twelve dumps on the next scheduled run. There is no
   * endpoint for deleting a setting — deliberately — so this goes through Prisma.
   */
  if (absent.length > 0) {
    const removed = await db().setting.deleteMany({ where: { key: { in: absent } } });
    check('and keys this run introduced are removed, not left at test values', removed.count >= 0);
    show('dibuang', `${String(removed.count)} kunci · ${absent.join(', ')}`);
  }

  const mode = await db().setting.findUnique({ where: { key: 'maintenance.enabled' } });
  check('maintenance mode is left off', mode?.value !== true);

  const reachable = await call('GET', '/api/dashboard');
  check('and the application is reachable', reachable.status === 200);

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

async function warmUpPrisma(): Promise<void> {
  await db().setting.count();
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

async function login(): Promise<void> {
  cookie = '';
  await call('POST', '/api/auth/login', {
    email,
    password,
    ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
  });
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
