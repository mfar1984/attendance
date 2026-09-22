/**
 * Verifies the retention purge against synthetic aged data.
 *
 * Real data in this installation is only weeks old, so a purge run against it would
 * delete nothing and prove nothing. This inserts events dated years back, checks
 * that the preview counts them, runs the purge, and then checks what survived: the
 * punch must remain with its evidence link cleared, and the recent events must be
 * untouched.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-retention.mts <password>
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { generateSync } from 'otplib';

const run = promisify(execFile);

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-retention.mts <adminPassword>');
  process.exit(2);
}

const database = new URL(process.env['DATABASE_URL'] ?? '');
const MYSQL_ARGS = [
  `--host=${database.hostname}`,
  `--port=${database.port || '3306'}`,
  `--user=${decodeURIComponent(database.username)}`,
  '--skip-column-names',
  database.pathname.replace(/^\//, ''),
];

let cookie = '';
let failures = 0;

/** Marks every row this script creates, so cleanup can never touch real data. */
const TAG = 'RETENSI-UJIAN';

await call('POST', '/api/auth/login', {
  email,
  password,
  ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
});
check('logged in', cookie.length > 0);

// ---------------------------------------------------------------------------
console.log('\n=== Floor on the retention window ===');
// ---------------------------------------------------------------------------

const preview0 = await call('GET', '/api/retention');
check('the retention preview responds', preview0.status === 200);
const floor = Number(preview0.body['minimumRawEventMonths']);
show('minimum months', String(floor));

const tooShort = await call('PUT', '/api/settings', {
  values: { 'retention.rawEventMonths': floor - 1 },
});
check('a window below the floor is refused', tooShort.status === 409);
show('message', String(tooShort.body['error']));

const atFloor = await call('PUT', '/api/settings', {
  values: { 'retention.rawEventMonths': floor },
});
check('a window at the floor is accepted', atFloor.status === 200);

// ---------------------------------------------------------------------------
console.log('\n=== Baseline ===');
// ---------------------------------------------------------------------------

// Cleared up front as well as at the end, so a run that failed part way through
// cannot leave rows that make the next run assert against the wrong record.
await sql(`DELETE FROM attendance_exceptions WHERE detail = '${TAG}'`);
await sql(
  `DELETE FROM punches WHERE rawEventId IN (SELECT id FROM raw_events WHERE personName = '${TAG}')`,
);
await sql(`DELETE FROM raw_events WHERE personName = '${TAG}'`);

const baseline = await call('GET', '/api/retention');
const startingTotal = Number(baseline.body['totalRawEvents']);
show('raw events held', String(startingTotal));
show('oldest event', String(baseline.body['oldestEventAt']));
show('cut-off', String(baseline.body['rawCutoff']));
check('nothing real is due for deletion', Number(baseline.body['rawEventsDue']) === 0);

// ---------------------------------------------------------------------------
console.log('\n=== Aged data ===');
// ---------------------------------------------------------------------------

const deviceId = Number(await sqlValue('SELECT id FROM devices ORDER BY id LIMIT 1'));
const staffId = Number(await sqlValue('SELECT id FROM staff ORDER BY id LIMIT 1'));
check('a device and a staff record exist to attach to', deviceId > 0 && staffId > 0);

/**
 * Serial numbers far above anything the terminal has issued.
 *
 * `(deviceId, serialNo)` is unique and is what makes ingest idempotent, so a
 * collision here would either fail the insert or, worse, look like a real event.
 */
const BASE_SERIAL = 900_000_000;

// Five years back: comfortably past any floor. One carries a picture reference and
// one carries a punch, so both dependent paths are exercised.
const OLD = 5;
const ROWS = 40;

const values: string[] = [];
for (let index = 0; index < ROWS; index += 1) {
  const serial = BASE_SERIAL + index;
  const picture = index % 4 === 0 ? `'http://192.168.1.250/pic/${String(serial)}.jpg'` : 'NULL';
  values.push(
    `(${String(deviceId)}, ${String(serial)}, 5, 75, ` +
      `DATE_SUB(NOW(), INTERVAL ${String(OLD)} YEAR), 'L00001', '${TAG}', ${picture}, 'pull', NOW())`,
  );
}

await sql(
  'INSERT INTO raw_events (deviceId, serialNo, major, minor, eventTime, employeeNo, personName, ' +
    `pictureUrl, arrivedVia, receivedAt) VALUES ${values.join(', ')}`,
);
show('aged events inserted', String(ROWS));

// A punch and an exception hanging off the oldest one, which is the case that
// matters: the derived record must survive its evidence being removed.
const oldestId = Number(
  await sqlValue(
    `SELECT id FROM raw_events WHERE personName = '${TAG}' ORDER BY serialNo LIMIT 1`,
  ),
);
await sql(
  `INSERT INTO punches (staffId, deviceId, rawEventId, punchAt, direction, method, source, suppressed, createdAt) ` +
    `VALUES (${String(staffId)}, ${String(deviceId)}, ${String(oldestId)}, ` +
    `DATE_SUB(NOW(), INTERVAL ${String(OLD)} YEAR), 'in', 'face', 'device', 0, NOW())`,
);

await sql(
  `INSERT INTO attendance_exceptions (kind, staffId, deviceId, rawEventId, occurredAt, detail, createdAt) ` +
    `VALUES ('duplicate_scan', ${String(staffId)}, ${String(deviceId)}, ${String(oldestId)}, ` +
    `DATE_SUB(NOW(), INTERVAL ${String(OLD)} YEAR), '${TAG}', NOW())`,
);

// Looked up rather than taken from LAST_INSERT_ID: every `mysql -e` call opens its
// own connection, and that function is per-connection state.
const punchId = Number(
  await sqlValue(`SELECT id FROM punches WHERE rawEventId = ${String(oldestId)}`),
);
const exceptionId = Number(
  await sqlValue(
    `SELECT id FROM attendance_exceptions WHERE detail = '${TAG}' ORDER BY id DESC LIMIT 1`,
  ),
);
check('the punch and exception were attached', punchId > 0 && exceptionId > 0);
show('punch / exception', `${String(punchId)} / ${String(exceptionId)}`);

// ---------------------------------------------------------------------------
console.log('\n=== Preview sees it ===');
// ---------------------------------------------------------------------------

const loaded = await call('GET', '/api/retention');
check(
  'the preview counts the aged events',
  Number(loaded.body['rawEventsDue']) === ROWS,
);
show('due for deletion', String(loaded.body['rawEventsDue']));
show('picture refs due', String(loaded.body['picturesDue']));
// Measured as a delta: the picture window is shorter than the event window, so real
// events already sit inside it and the absolute figure is not the tagged count.
check(
  'picture references are counted on their own shorter window',
  Number(loaded.body['picturesDue']) - Number(baseline.body['picturesDue']) === ROWS / 4,
);
show('picture refs before', String(baseline.body['picturesDue']));
check(
  'the punch losing its evidence link is reported up front',
  Number(loaded.body['punchesAffected']) >= 1,
);
show('punches affected', String(loaded.body['punchesAffected']));
check(
  'the oldest event now reflects the aged data',
  new Date(String(loaded.body['oldestEventAt'])).getFullYear() <= new Date().getFullYear() - OLD + 1,
);

// A preview must not delete. This is the whole point of it being a separate read.
check(
  'the preview deleted nothing',
  Number(await sqlValue(`SELECT COUNT(*) FROM raw_events WHERE personName = '${TAG}'`)) === ROWS,
);

// ---------------------------------------------------------------------------
console.log('\n=== Purge ===');
// ---------------------------------------------------------------------------

const purge = await call('POST', '/api/retention/run');
check('the purge runs', purge.status === 200);
if (purge.status !== 200) show('error', String(purge.body['error']));
show('raw events deleted', String(purge.body['rawEventsDeleted']));
show('picture refs cleared', String(purge.body['picturesCleared']));
show('exception links cleared', String(purge.body['exceptionLinksCleared']));
show('batches', String(purge.body['batches']));
show('duration', `${String(purge.body['durationMs'])}ms`);
check('it completed in one pass', purge.body['incomplete'] === false);
check('every aged event was removed', Number(purge.body['rawEventsDeleted']) === ROWS);

check(
  'no tagged row survives',
  Number(await sqlValue(`SELECT COUNT(*) FROM raw_events WHERE personName = '${TAG}'`)) === 0,
);

// The central guarantee: retention removes evidence, never the derived record that
// payroll was computed from.
const punchSurvives = Number(
  await sqlValue(`SELECT COUNT(*) FROM punches WHERE id = ${String(punchId)}`),
);
check('the punch survived the deletion of its raw event', punchSurvives === 1);

const punchLink = await sqlValue(
  `SELECT IFNULL(rawEventId, 'NULL') FROM punches WHERE id = ${String(punchId)}`,
);
check('its evidence link was nulled, not left dangling', punchLink === 'NULL');

const exceptionLink = await sqlValue(
  `SELECT IFNULL(rawEventId, 'NULL') FROM attendance_exceptions WHERE id = ${String(exceptionId)}`,
);
check('the exception link was nulled too', exceptionLink === 'NULL');

const exceptionSurvives = Number(
  await sqlValue(`SELECT COUNT(*) FROM attendance_exceptions WHERE id = ${String(exceptionId)}`),
);
check('the exception itself survived', exceptionSurvives === 1);

// Recent data must be untouched. A purge that takes anything inside the window is
// the worst possible failure here.
const remaining = await call('GET', '/api/retention');
check(
  'every recent event is still present',
  Number(remaining.body['totalRawEvents']) === startingTotal,
);
show('raw events held', String(remaining.body['totalRawEvents']));
check('nothing is left due', Number(remaining.body['rawEventsDue']) === 0);

// ---------------------------------------------------------------------------
console.log('\n=== It is recorded ===');
// ---------------------------------------------------------------------------

const activity = await call('GET', '/api/logs/activity?pageSize=5');
const rows = activity.body['rows'] as Array<Record<string, unknown>>;
const detail = rows.find((row) => String(row['action']) === 'retention.purge');
check('the purge is in the activity log', detail !== undefined);
show('logged as', String(detail?.['detail']));

// A warning even on success. This is the entry that explains a gap in the raw log a
// year from now, so it must not sit among the routine logins.
check('recorded as a warning, not routine information', String(detail?.['level']) === 'warn');
check('and filed under the retention category', String(detail?.['category']) === 'retention');
show('level / kategori', `${String(detail?.['level'])} / ${String(detail?.['category'])}`);

const audit = await call('GET', '/api/logs/audit?entityType=RawEvent&pageSize=5');
check('and in the audit trail', Number(audit.body['total']) > 0);
const entry = (audit.body['rows'] as Array<Record<string, unknown>>)[0];
show('audit entity', String(entry?.['entityId']));
show('audit reason', String(entry?.['reason']));
check(
  'the audit entry records the cut-off, so the gap is explainable',
  String(entry?.['entityId']).startsWith('<'),
);

// ---------------------------------------------------------------------------
console.log('\n=== Idempotence ===');
// ---------------------------------------------------------------------------

const second = await call('POST', '/api/retention/run');
check('a second run is harmless', second.status === 200);
check('and removes nothing', Number(second.body['rawEventsDeleted']) === 0);

// ---------------------------------------------------------------------------
console.log('\n=== Cleanup ===');
// ---------------------------------------------------------------------------

await sql(`DELETE FROM punches WHERE id = ${String(punchId)}`);
await sql(`DELETE FROM attendance_exceptions WHERE id = ${String(exceptionId)}`);
await sql(`DELETE FROM raw_events WHERE personName = '${TAG}'`);
// Left switched off: this is a test run, not a policy decision for the installation.
await call('PUT', '/api/settings', { values: { 'retention.autoPurgeEnabled': false } });
check(
  'test rows removed',
  Number(await sqlValue(`SELECT COUNT(*) FROM raw_events WHERE personName = '${TAG}'`)) === 0,
);

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);

// ---------------------------------------------------------------------------

async function sql(statement: string): Promise<string> {
  // The password goes through the environment rather than argv, which is visible to
  // any process listing on the machine.
  const { stdout } = await run('mysql', [...MYSQL_ARGS, '-e', statement], {
    env: { ...process.env, MYSQL_PWD: decodeURIComponent(database.password) },
  });
  return stdout.trim();
}

async function sqlValue(statement: string): Promise<string> {
  return (await sql(statement)).split('\n')[0]?.trim() ?? '';
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

function show(label: string, value: string): void {
  console.log(`  ${label.padEnd(32)} ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
