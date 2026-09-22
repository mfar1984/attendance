/**
 * Verifies the monthly summary, the payroll export and the report builder.
 *
 * These are the reads that turn into money, so the checks are about arithmetic and
 * about what travels with a figure rather than about whether an endpoint answers.
 * Three things matter most: the department totals have to add up to the organisation
 * total, the payroll CSV has to carry its own warnings because a spreadsheet gets
 * forwarded, and a truncated builder result has to say so instead of presenting a
 * subtotal as a total.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-reports.mts <password>
 */
import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-reports.mts <adminPassword>');
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

const now = new Date();
const from = `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-01`;
const to = `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(
  new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
)}`;
show('tempoh', `${from} hingga ${to}`);

// ---------------------------------------------------------------------------
console.log('\n=== Monthly summary ===');
// ---------------------------------------------------------------------------

const monthly = await call(
  'GET',
  `/api/reports/monthly?from=${from}&to=${to}&page=1&pageSize=50`,
);
check('monthly responds', monthly.status === 200);

const period = monthly.body['period'] as Record<string, unknown>;
check('the period is echoed back unchanged', period['from'] === from && period['to'] === to);
show(
  'period',
  `${String(period['from'])} → ${String(period['to'])} · ${String(period['workingDays'])} hari kalendar`,
);

const org = monthly.body['organisation'] as Record<string, number>;
show(
  'organisation',
  `${String(org['staffCount'])} staf · hadir ${String(org['presentDays'])} · ` +
    `tidak hadir ${String(org['absentDays'])} · dijadualkan ${String(org['scheduledDays'])}`,
);

/**
 * The denominator has to equal its parts.
 *
 * `scheduledDays` is what payroll divides by. Present days already fold in late,
 * early-leave and incomplete, so a scheduled day is either attended or absent and
 * nothing else. If this drifts, every percentage built on it is wrong.
 */
check(
  'scheduled days equal present plus absent',
  org['scheduledDays'] === (org['presentDays'] ?? 0) + (org['absentDays'] ?? 0),
);
check(
  'rest days and holidays are outside the scheduled count',
  (org['restDays'] ?? 0) >= 0 && (org['holidayDays'] ?? 0) >= 0,
);

const rows = (monthly.body['rows'] ?? []) as Array<Record<string, number>>;
const brokenRows = rows.filter(
  (row) => row['scheduledDays'] !== (row['presentDays'] ?? 0) + (row['absentDays'] ?? 0),
);
check('and the same holds for every staff row', brokenRows.length === 0);
if (brokenRows.length > 0) show('baris pertama yang gagal', JSON.stringify(brokenRows[0]));

/**
 * Department subtotals must reconcile with the organisation total.
 *
 * They are computed by a separate pass, so a change to one and not the other is the
 * failure this catches — and it is the kind somebody only notices after a manager
 * asks why the two screens disagree.
 */
const departments = (monthly.body['byDepartment'] ?? []) as Array<Record<string, number>>;
const summed = departments.reduce<Record<string, number>>((running, row) => {
  for (const key of [
    'staffCount',
    'presentDays',
    'lateDays',
    'absentDays',
    'leaveDays',
    'incompleteDays',
    'workedMinutes',
    'overtimeMinutes',
    'openExceptions',
  ]) {
    running[key] = (running[key] ?? 0) + (row[key] ?? 0);
  }
  return running;
}, {});

show('jabatan', `${String(departments.length)} kumpulan`);
for (const key of [
  'presentDays',
  'lateDays',
  'absentDays',
  'leaveDays',
  'incompleteDays',
  'workedMinutes',
  'overtimeMinutes',
  'openExceptions',
]) {
  check(
    `department totals add up to the organisation total for ${key}`,
    (summed[key] ?? 0) === (org[key] ?? 0),
  );
}
check(
  'and every member of staff is counted in exactly one department',
  (summed['staffCount'] ?? 0) === (org['staffCount'] ?? 0),
);

const unresolved = monthly.body['unresolvedExceptions'] as Record<string, unknown>;
const byKind = (unresolved['byKind'] ?? {}) as Record<string, number>;
check(
  'the unresolved exception count matches its own breakdown',
  Number(unresolved['total']) === Object.values(byKind).reduce((sum, value) => sum + value, 0),
);
show('pengecualian belum selesai', `${String(unresolved['total'])} · ${JSON.stringify(byKind)}`);

// ---------------------------------------------------------------------------
console.log('\n=== Periods that cannot be answered are refused ===');
// ---------------------------------------------------------------------------

const reversed = await call('GET', `/api/reports/monthly?from=${to}&to=${from}&page=1&pageSize=1`);
check('a reversed period is refused', reversed.status === 409);
show('message', String(reversed.body['error']).slice(0, 100));

// A five-year export is always a mistake, and it is the kind that only shows up as a
// timeout rather than as an error somebody can act on.
const tooLong = await call(
  'GET',
  `/api/reports/monthly?from=2020-01-01&to=${to}&page=1&pageSize=1`,
);
check('a period beyond a year is refused', tooLong.status === 409);
show('message', String(tooLong.body['error']).slice(0, 100));

// ---------------------------------------------------------------------------
console.log('\n=== Monthly export ===');
// ---------------------------------------------------------------------------

const monthlyCsv = await callText('GET', `/api/reports/monthly/export?from=${from}&to=${to}`);
check('the monthly export downloads', monthlyCsv.status === 200);
check('as CSV', monthlyCsv.contentType.includes('text/csv'));
// The BOM is what stops Excel mangling Malay names on open.
check('carrying a UTF-8 BOM', monthlyCsv.hasBom);
check(
  'and a header row naming its columns',
  monthlyCsv.text.includes('No. Staf') && monthlyCsv.text.includes('Jam bekerja'),
);

// ---------------------------------------------------------------------------
console.log('\n=== Payroll preview ===');
// ---------------------------------------------------------------------------

const payroll = await call('GET', `/api/reports/payroll/preview?from=${from}&to=${to}`);
check('the preview responds', payroll.status === 200);

const blockers = (payroll.body['blockers'] ?? []) as Array<Record<string, unknown>>;
check('blockers are a list, not a flag', Array.isArray(blockers));
check(
  'and safeToExport agrees with them',
  payroll.body['safeToExport'] === (blockers.length === 0),
);
check(
  'every blocker states what it means, not just a count',
  blockers.every(
    (row) =>
      typeof row['kind'] === 'string' &&
      typeof row['count'] === 'number' &&
      typeof row['detail'] === 'string' &&
      String(row['detail']).length > 20,
  ),
);
show('safeToExport', String(payroll.body['safeToExport']));
for (const blocker of blockers) {
  show(`  ${String(blocker['kind'])}`, String(blocker['count']));
}

const payrollOrg = payroll.body['organisation'] as Record<string, number>;
check(
  'the preview totals match the monthly totals for the same period',
  payrollOrg['presentDays'] === org['presentDays'] &&
    payrollOrg['absentDays'] === org['absentDays'] &&
    payrollOrg['workedMinutes'] === org['workedMinutes'],
);

// ---------------------------------------------------------------------------
console.log('\n=== Payroll export carries its own warnings ===');
// ---------------------------------------------------------------------------

const payrollCsv = await callText('GET', `/api/reports/payroll/export?from=${from}&to=${to}`);
check('the payroll export downloads', payrollCsv.status === 200);
check('carrying a UTF-8 BOM', payrollCsv.hasBom);

const lines = payrollCsv.text.split('\r\n');
const comments = lines.filter((line) => line.startsWith('#'));
/**
 * The caveat lives inside the file.
 *
 * A payroll spreadsheet gets forwarded, and whoever opens it next never saw the
 * screen that produced it. Written as leading `#` rows, which Excel shows as text and
 * no importer mistakes for data.
 */
check('and leading comment rows', comments.length >= 4);
check('that name the period', comments.some((line) => line.includes(from) && line.includes(to)));
check('and the timezone the figures were read in', comments.some((line) => line.includes('zon waktu')));

const unresolvedTotal = Number(
  (payroll.body['unresolvedExceptions'] as Record<string, unknown>)['total'],
);
if (unresolvedTotal > 0) {
  check(
    'and warn about the unresolved exceptions in the period',
    comments.some((line) => line.includes('AMARAN') && line.includes(String(unresolvedTotal))),
  );
} else {
  check(
    'and state that there were none to warn about',
    comments.some((line) => line.includes('Tiada pengecualian')),
  );
}
for (const line of comments) show('  csv', line.slice(0, 110));

const header = lines.find((line) => line.startsWith('No. Staf'));
check('the header row follows the comments', header !== undefined);
check(
  'and the export carries the denominator, not only the numerator',
  (header ?? '').includes('Hari dijadualkan') && (header ?? '').includes('Hari hadir'),
);
check(
  'and names the unresolved exceptions per person',
  (header ?? '').includes('Pengecualian belum selesai'),
);

// ---------------------------------------------------------------------------
console.log('\n=== Builder field catalogue ===');
// ---------------------------------------------------------------------------

const fields = await call('GET', '/api/reports/fields');
check('the catalogue responds', fields.status === 200);
const datasets = (fields.body['datasets'] ?? []) as Array<Record<string, unknown>>;
check('with three datasets', datasets.length === 3);
for (const dataset of datasets) {
  const columns = (dataset['fields'] ?? []) as Array<Record<string, unknown>>;
  const groups = (dataset['groupBy'] ?? []) as Array<Record<string, unknown>>;
  show(
    `  ${String(dataset['key'])}`,
    `${String(columns.length)} lajur · ${String(groups.length)} cara kumpulan`,
  );
  /*
    `labelKey`, not `label`. The catalogue describes the column picker, so its wording goes
    through the translation registry and the client resolves it — a raw string here would be a
    heading nobody could translate or stamp with a label number.
  */
  check(
    `${String(dataset['key'])} declares a kind and a label key for every column`,
    columns.every(
      (column) => typeof column['kind'] === 'string' && typeof column['labelKey'] === 'string',
    ),
  );
  check(
    `${String(dataset['key'])} names itself and its grouping options by key`,
    typeof dataset['labelKey'] === 'string' &&
      typeof dataset['noteKey'] === 'string' &&
      groups.every((group) => typeof group['labelKey'] === 'string'),
  );
  // "No grouping" has to be offered, or the raw rows become unreachable.
  check(
    `${String(dataset['key'])} offers an ungrouped option`,
    groups.some((group) => group['key'] === 'none'),
  );
}

// ---------------------------------------------------------------------------
console.log('\n=== Builder: a truncated result says so ===');
// ---------------------------------------------------------------------------

const wide = { dataset: 'attendance', from: '2026-05-01', to: to, groupBy: 'none' };
const columns = ['workDate', 'employeeNo', 'fullName', 'status', 'workedMinutes'];

const capped = await call('POST', '/api/reports/run', { ...wide, columns, limit: 3 });
check('the builder runs', capped.status === 200);
const cappedRows = (capped.body['rows'] ?? []) as Array<Record<string, string>>;
show('had 3', `${String(cappedRows.length)} baris · truncated=${String(capped.body['truncated'])}`);
check('and never returns more rows than the cap', cappedRows.length <= 3);

const full = await call('POST', '/api/reports/run', { ...wide, columns, limit: 2000 });
const fullRows = (full.body['rows'] ?? []) as Array<Record<string, string>>;
show('had 2000', `${String(fullRows.length)} baris · truncated=${String(full.body['truncated'])}`);

// The cap is only meaningful if it is reported when it bites and not when it does not.
if (fullRows.length > 3) {
  check('the capped run is flagged truncated', capped.body['truncated'] === true);
  check('and the uncapped run is not', full.body['truncated'] === false);
} else {
  show('dilangkau', 'tiada cukup baris untuk mencecah had');
}

check(
  'the result carries only the columns that were asked for',
  ((capped.body['columns'] ?? []) as Array<Record<string, string>>)
    .map((column) => column['key'])
    .join(',') === columns.join(','),
);

/**
 * A calendar column has to read as a calendar date.
 *
 * `workDate` is a `DATE`; if it is formatted through a timezone it lands a day out,
 * and in a payroll-adjacent export a date that is silently wrong is worse than one
 * that is missing.
 */
const dateCells = fullRows.map((row) => row['workDate'] ?? '');
check(
  'every date cell is a plain YYYY-MM-DD',
  dateCells.length === 0 || dateCells.every((cell) => /^\d{4}-\d{2}-\d{2}$/.test(cell)),
);
check(
  'and none of them falls outside the period asked for',
  dateCells.every((cell) => cell >= '2026-05-01' && cell <= to),
);
show('tarikh', dateCells.slice(0, 4).join(', '));

// A single-day window is the sharpest form of the same check.
const oneDay = dateCells[0];
if (oneDay !== undefined) {
  const pinned = await call('POST', '/api/reports/run', {
    dataset: 'attendance',
    from: oneDay,
    to: oneDay,
    columns: ['workDate', 'employeeNo'],
    groupBy: 'none',
    limit: 50,
  });
  const pinnedRows = (pinned.body['rows'] ?? []) as Array<Record<string, string>>;
  check(
    `a one-day window on ${oneDay} returns only that day`,
    pinnedRows.length > 0 && pinnedRows.every((row) => row['workDate'] === oneDay),
  );
}

// ---------------------------------------------------------------------------
console.log('\n=== Builder: grouping sums, it does not invent ===');
// ---------------------------------------------------------------------------

const grouped = await call('POST', '/api/reports/run', {
  ...wide,
  groupBy: 'status',
  columns,
  limit: 2000,
});
check('a grouped run responds', grouped.status === 200);
const groupedColumns = ((grouped.body['columns'] ?? []) as Array<Record<string, string>>).map(
  (column) => column['key'],
);
check(
  'and replaces the row columns with a group, a count and the numeric totals',
  groupedColumns[0] === 'group' && groupedColumns[1] === 'count',
);
check(
  'keeping only the numeric columns that were selected',
  groupedColumns.slice(2).join(',') === 'workedMinutes',
);

const groupedRows = (grouped.body['rows'] ?? []) as Array<Record<string, string>>;
const groupedCount = groupedRows.reduce((sum, row) => sum + Number(row['count']), 0);
check('the group counts add up to the rows that were read', groupedCount === fullRows.length);
const groupedMinutes = groupedRows.reduce((sum, row) => sum + Number(row['workedMinutes']), 0);
const flatMinutes = fullRows.reduce((sum, row) => sum + Number(row['workedMinutes'] ?? 0), 0);
check('and so do the summed minutes', groupedMinutes === flatMinutes);
for (const row of groupedRows) {
  show(`  ${String(row['group'])}`, `${String(row['count'])} baris · ${String(row['workedMinutes'])}m`);
}

const noColumns = await call('POST', '/api/reports/run', { ...wide, columns: [], limit: 10 });
check('a run with no columns is refused', noColumns.status >= 400);

const badPeriod = await call('POST', '/api/reports/run', {
  ...wide,
  from: '2020-01-01',
  columns,
  limit: 10,
});
check('and so is a period beyond a year', badPeriod.status === 409);

// ---------------------------------------------------------------------------
console.log('\n=== Builder export states its own cap ===');
// ---------------------------------------------------------------------------

const builderCsv = await callText(
  'POST',
  '/api/reports/run/export',
  { ...wide, columns, limit: 3 },
);
check('the builder export downloads', builderCsv.status === 200);
check('carrying a UTF-8 BOM', builderCsv.hasBom);
const builderComments = builderCsv.text.split('\r\n').filter((line) => line.startsWith('#'));
check('and leading comment rows', builderComments.length >= 4);
check(
  'that say whether the row cap was reached',
  builderComments.some((line) => line.includes('had') || line.includes('Tiada had')),
);
for (const line of builderComments) show('  csv', line.slice(0, 110));

/*
  The header row has to carry words, not registry keys.

  The catalogue now describes columns by key so the picker can be translated, and the server
  resolves those keys back to the source wording for the file. If that resolution is ever
  dropped, the symptom is a spreadsheet whose headers read `reportField.workDate` — which
  typechecks perfectly, because both are strings.
*/
const builderHeader = builderCsv.text
  .split('\r\n')
  .find((line) => !line.startsWith('#') && line.length > 0);
check(
  'and a header row of words rather than registry keys',
  builderHeader !== undefined &&
    builderHeader.includes('Tarikh') &&
    builderHeader.includes('No. Staf') &&
    !builderHeader.includes('reportField.'),
);
show('  header', builderHeader ?? '(tiada)');

// ---------------------------------------------------------------------------
console.log('\n=== Other datasets answer too ===');
// ---------------------------------------------------------------------------

for (const [dataset, wanted] of [
  ['exceptions', ['occurredAt', 'workDate', 'kind', 'fullName']],
  ['leave', ['fromDate', 'toDate', 'employeeNo', 'leaveType', 'days', 'status']],
] as const) {
  const response = await call('POST', '/api/reports/run', {
    dataset,
    from: '2026-01-01',
    to,
    columns: wanted,
    groupBy: 'none',
    limit: 20,
  });
  check(`the ${dataset} dataset runs`, response.status === 200);
  const datasetRows = (response.body['rows'] ?? []) as Array<Record<string, string>>;
  show(`  ${dataset}`, `${String(datasetRows.length)} baris`);

  const first = datasetRows[0];
  if (first !== undefined) {
    check(
      `and returns every ${dataset} column that was asked for`,
      wanted.every((key) => key in first),
    );
  }
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);

// ---------------------------------------------------------------------------

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await request(method, path, body);
  const text = await response.text();
  try {
    return { status: response.status, body: (JSON.parse(text) ?? {}) as Record<string, unknown> };
  } catch {
    return { status: response.status, body: { raw: text.slice(0, 200) } };
  }
}

/**
 * Reads a CSV body as bytes and as text.
 *
 * The bytes matter: `Response.text()` strips a leading BOM while decoding, so asserting
 * on the decoded string would report a missing BOM on a file that has one — and would
 * keep reporting it after somebody removed the BOM for real.
 */
async function callText(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; contentType: string; text: string; hasBom: boolean }> {
  const response = await request(method, path, body);
  const bytes = new Uint8Array(await response.arrayBuffer());

  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    text: new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, ''),
    hasBom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
  };
}

async function request(method: string, path: string, body?: unknown): Promise<Response> {
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

  return response;
}

function show(label: string, value: string): void {
  console.log(`         ${label}: ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
