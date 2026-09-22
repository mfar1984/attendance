/**
 * Verifies leave applications against the running server.
 *
 * The status field is not the point of this module — the side effect is. What is
 * asserted here is that approving a request writes `leave` onto the roster, recomputes
 * the affected days, and turns the person's attendance records into `on_leave`; that
 * cancelling takes those rows back out; and that the guards which stop two requests
 * writing the same day, or a rejection arriving with no reason, actually hold.
 *
 * The window is deliberately in the past. The engine never computes a day that has
 * not happened, so a future range would approve cleanly and prove nothing about the
 * recompute — which is the half of the feature that decides whether somebody is paid.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-leave.mts <password>
 */
import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-leave.mts <adminPassword>');
  process.exit(2);
}

let cookie = '';
let failures = 0;

/** Requests and roster rows this run created, undone at the end whatever happens. */
const opened: number[] = [];
let restRoster: { staffId: number; date: string } | null = null;

await call('POST', '/api/auth/login', {
  email,
  password,
  ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
});
check('logged in', cookie.length > 0);

// ---------------------------------------------------------------------------
console.log('\n=== Leave types ===');
// ---------------------------------------------------------------------------

const types = (await call('GET', '/api/leave-types')).body as unknown as Array<
  Record<string, unknown>
>;
check('the seeded types are present', Array.isArray(types) && types.length >= 4);
for (const type of types) {
  show(
    `  ${String(type['code'])}`,
    `${String(type['name'])} · ${String(type['annualDays'])} hari · ` +
      `${type['paid'] === true ? 'bergaji' : 'tanpa gaji'}` +
      `${type['allowBackdated'] === true ? ' · boleh ke belakang' : ''}` +
      `${type['requiresApproval'] === true ? ' · perlu kelulusan' : ' · auto'}`,
  );
}

const annual = types.find((row) => row['code'] === 'AL');
const medical = types.find((row) => row['code'] === 'MC');
check('annual leave (AL) exists and refuses backdating', annual?.['allowBackdated'] === false);
check('medical leave (MC) exists and allows backdating', medical?.['allowBackdated'] === true);

if (!annual || !medical) {
  console.log('\nCannot continue without AL and MC. Run the seed first.\n');
  process.exit(1);
}

const annualId = Number(annual['id']);
const medicalId = Number(medical['id']);

// ---------------------------------------------------------------------------
console.log('\n=== Subject and window ===');
// ---------------------------------------------------------------------------

const staffList = (await call('GET', '/api/leave-requests/staff-search?q=&limit=1')).body as
  unknown as Array<Record<string, unknown>>;
check('the staff picker returns somebody', Array.isArray(staffList) && staffList.length > 0);
if (!Array.isArray(staffList) || staffList.length === 0) process.exit(1);

const subject = staffList[0]!;
const staffId = Number(subject['id']);
const employeeNo = String(subject['employeeNo']);
show('staf', `${String(subject['fullName'])} (${employeeNo})`);

const start = addDays(todayKey(), -20);
const end = addDays(start, 6);
const restDay = addDays(start, 3);
show('julat ujian', `${start} hingga ${end} (7 hari kalendar, sudah lepas)`);

// A rest day inside the window, so the exclusion has something to exclude. Without
// one the rest-day arithmetic is never exercised and the test proves less than it looks.
const restWrite = await call('POST', '/api/roster', {
  staffIds: [staffId],
  dates: [restDay],
  shiftId: null,
  entryType: 'rest',
});
check('a rest day can be placed inside the window', restWrite.status === 200);
if (restWrite.status === 200) restRoster = { staffId, date: restDay };
show('hari rehat', restDay);

// ---------------------------------------------------------------------------
console.log('\n=== The quote is read before the request is filed ===');
// ---------------------------------------------------------------------------

const quote = await call(
  'GET',
  `/api/leave-requests/quote?staffId=${String(staffId)}&leaveTypeId=${String(medicalId)}` +
    `&from=${start}&to=${end}`,
);
check('quote responds', quote.status === 200);

const chargeable = Number(quote.body['days']);
const restDays = Number(quote.body['restDays']);
const holidays = Number(quote.body['holidays']);
const totalDays = Number(quote.body['totalDays']);

show(
  'kiraan',
  `${String(chargeable)} hari dicaj · ${String(restDays)} rehat · ${String(holidays)} cuti umum · ` +
    `${String(totalDays)} kalendar`,
);
check('the range covers seven calendar days', totalDays === 7);
check('every calendar day is accounted for exactly once', chargeable + restDays + holidays === 7);
// The reason the rest day was placed above: a Sunday is not charged against leave.
check('the rest day is excluded from the charge', restDays === 1 && chargeable === 6);
check('the quote does not leak a list of every date', !('workDates' in quote.body));
check('the quote knows the range is backdated', quote.body['backdated'] === true);
check('and that this type permits it', quote.body['allowBackdated'] === true);

const annualDays = Number(quote.body['annualDays']);
const taken = Number(quote.body['taken']);
const pending = Number(quote.body['pending']);
check(
  'the remaining balance nets off both approved and pending days',
  quote.body['remaining'] === (annualDays === 0 ? null : annualDays - taken - pending),
);

// ---------------------------------------------------------------------------
console.log('\n=== Backdating is refused per type, not globally ===');
// ---------------------------------------------------------------------------

const backdatedAnnual = await call('POST', '/api/leave-requests', {
  staffId,
  leaveTypeId: annualId,
  fromDate: start,
  toDate: end,
  reason: 'Ujian: AL ke belakang',
});
check('annual leave cannot be filed for a range already past', backdatedAnnual.status === 409);
show('message', String(backdatedAnnual.body['error']).slice(0, 120));

// ---------------------------------------------------------------------------
console.log('\n=== Filing, then the guards around it ===');
// ---------------------------------------------------------------------------

const created = await call('POST', '/api/leave-requests', {
  staffId,
  leaveTypeId: medicalId,
  fromDate: start,
  toDate: end,
  reason: 'Ujian verifikasi cuti',
});
check('the request is filed', created.status === 200);
if (created.status !== 200) {
  show('error', String(created.body['error']));
  await cleanup();
  finish();
}

const requestId = Number(created.body['id']);
opened.push(requestId);
check('it is charged the working days, not the calendar days', Number(created.body['days']) === chargeable);
check('a type that needs approval opens as pending', created.body['status'] === 'pending');

// The dates must come back as the dates that were sent. A `DATE` column truncated in
// UTC while the value was local midnight used to shift this by a day, and the shift
// compounded on every read.
const filed = await call('GET', `/api/leave-requests/${String(requestId)}`);
check(
  'the stored range is the range that was requested',
  String(filed.body['fromDate']).slice(0, 10) === start &&
    String(filed.body['toDate']).slice(0, 10) === end,
);
show('disimpan', `${String(filed.body['fromDate']).slice(0, 10)} → ${String(filed.body['toDate']).slice(0, 10)}`);

const overlap = await call('POST', '/api/leave-requests', {
  staffId,
  leaveTypeId: medicalId,
  fromDate: addDays(start, 2),
  toDate: addDays(start, 3),
  reason: 'Ujian bertindih',
});
// Two live requests over one day would each write the same roster row on approval,
// and the second would overwrite the first without saying so.
check('an overlapping request is refused', overlap.status === 409);
show('message', String(overlap.body['error']).slice(0, 120));

const noReason = await call('POST', `/api/leave-requests/${String(requestId)}/decide`, {
  decision: 'rejected',
  note: '',
});
check('a rejection with no reason is refused', noReason.status === 409);
show('message', String(noReason.body['error']).slice(0, 120));

// ---------------------------------------------------------------------------
console.log('\n=== Pending days already count against the balance ===');
// ---------------------------------------------------------------------------

const balance = await call('GET', `/api/leave-balance/${String(staffId)}?year=${start.slice(0, 4)}`);
check('balance responds', balance.status === 200);
const medicalBalance = (
  balance.body['balances'] as Array<Record<string, unknown>> | undefined
)?.find((row) => (row['type'] as Record<string, unknown>)['code'] === 'MC');
check(
  'the pending request is already held against the entitlement',
  Number(medicalBalance?.['pending'] ?? 0) >= chargeable,
);
show(
  'MC',
  `${String(medicalBalance?.['taken'] ?? 0)} diambil · ${String(medicalBalance?.['pending'] ?? 0)} menunggu · ` +
    `${String(medicalBalance?.['remaining'] ?? 'tiada had')} baki`,
);

// ---------------------------------------------------------------------------
console.log('\n=== Approval writes the roster and recomputes the days ===');
// ---------------------------------------------------------------------------

const decided = await call('POST', `/api/leave-requests/${String(requestId)}/decide`, {
  decision: 'approved',
  note: 'Ujian verifikasi',
});
check('the approval succeeds', decided.status === 200);

const applied = decided.body['applied'] as Record<string, unknown> | undefined;
check('and it reports what it wrote', applied !== undefined);
show(
  'applied',
  `${String(applied?.['rosterWritten'])} ditulis · ${String(applied?.['rosterReplaced'])} shift digantikan · ` +
    `${String(applied?.['rosterSkipped'])} dilangkau · ${String(applied?.['recordsWritten'])} rekod dikira semula`,
);

// The invariant that has to hold for payroll: the days written onto the roster are
// exactly the days the entitlement was charged for. Writing `leave` over the rest day
// would inflate the report's leave count above what the balance was debited.
check(
  'the roster rows written match the days charged',
  Number(applied?.['rosterWritten']) === chargeable,
);
check(
  'and the rest day was left alone',
  Number(applied?.['rosterSkipped']) === restDays + holidays,
);

const roster = await call(
  'GET',
  `/api/roster?from=${start}&to=${end}&search=${encodeURIComponent(employeeNo)}&page=1&pageSize=1`,
);
const rosterRow = (roster.body['rows'] as Array<Record<string, unknown>> | undefined)?.[0];
check('the roster grid returns this person', String(rosterRow?.['employeeNo'] ?? '') === employeeNo);
const entries = (rosterRow?.['rosters'] ?? []) as Array<Record<string, unknown>>;
const leaveEntries = entries.filter((row) => row['entryType'] === 'leave');
show('roster', entries.map((row) => `${String(row['workDate']).slice(0, 10)}=${String(row['entryType'])}`).join(' '));

check('the calendar now shows leave days for this person', leaveEntries.length === chargeable);
check(
  'and each one names the request that created it',
  leaveEntries.length > 0 &&
    leaveEntries.every((row) => String(row['notes'] ?? '').includes(`#${String(requestId)}`)),
);
check(
  'the rest day is still a rest day',
  entries.some((row) => String(row['workDate']).slice(0, 10) === restDay && row['entryType'] === 'rest'),
);
// The dates the grid keys its cells off must be the dates that were asked for.
check(
  'no leave row landed on the rest day',
  !leaveEntries.some((row) => String(row['workDate']).slice(0, 10) === restDay),
);
check(
  'the first leave row is the first day of the range',
  leaveEntries.some((row) => String(row['workDate']).slice(0, 10) === start),
);
check(
  'and the last leave row is the last day of the range',
  leaveEntries.some((row) => String(row['workDate']).slice(0, 10) === end),
);

/**
 * The check that distinguishes this from a status flip.
 *
 * Approving without recomputing leaves the person reported absent for days they were
 * given off, and that only surfaces in the payroll export.
 */
const records = await call(
  'GET',
  `/api/attendance/records?staffId=${String(staffId)}&from=${start}&to=${end}&page=1&pageSize=50`,
);
const byStatus = (records.body['byStatus'] ?? {}) as Record<string, number>;
show('status kehadiran', JSON.stringify(byStatus));
check('the recomputed days are on_leave', (byStatus['on_leave'] ?? 0) === chargeable);
check('the rest day is recorded as a rest day', (byStatus['rest_day'] ?? 0) === restDays);
check(
  'and none of them was left as absent',
  (byStatus['absent'] ?? 0) === 0 && (byStatus['late'] ?? 0) === 0,
);

// The monthly report is the figure payroll reads, so it has to agree with the roster.
const monthly = await call(
  'GET',
  `/api/reports/monthly?from=${start}&to=${end}&search=${encodeURIComponent(employeeNo)}&page=1&pageSize=1`,
);
const monthlyRow = (monthly.body['rows'] as Array<Record<string, unknown>> | undefined)?.[0];
check(
  'the monthly report counts the same number of leave days',
  Number(monthlyRow?.['leaveDays']) === chargeable,
);
check(
  'and the period it echoes back is the period asked for',
  (monthly.body['period'] as Record<string, unknown> | undefined)?.['from'] === start &&
    (monthly.body['period'] as Record<string, unknown> | undefined)?.['to'] === end,
);
show(
  'laporan',
  `${String(monthlyRow?.['leaveDays'])} bercuti · ${String(monthlyRow?.['absentDays'])} tidak hadir · ` +
    `${String(monthlyRow?.['restDays'])} rehat · ${String(monthlyRow?.['scheduledDays'])} dijadualkan`,
);

const twice = await call('POST', `/api/leave-requests/${String(requestId)}/decide`, {
  decision: 'rejected',
  note: 'Ujian keputusan kedua',
});
check('a decided request cannot be decided again', twice.status === 409);

// ---------------------------------------------------------------------------
console.log('\n=== Cancellation takes the roster rows back out ===');
// ---------------------------------------------------------------------------

const cancelled = await call('POST', `/api/leave-requests/${String(requestId)}/cancel`, {
  note: 'Ujian pembatalan',
});
check('the cancellation succeeds', cancelled.status === 200);
check('and it removes exactly the rows it wrote', Number(cancelled.body['rosterRemoved']) === chargeable);
// The original shifts are not restored: the roster keeps no history of what it
// replaced, and inventing one would put people on shifts nobody re-checked.
check('and it says the previous shifts were not restored', String(cancelled.body['note'] ?? '').length > 0);
show('note', String(cancelled.body['note'] ?? '').slice(0, 140));

const after = await call(
  'GET',
  `/api/roster?from=${start}&to=${end}&search=${encodeURIComponent(employeeNo)}&page=1&pageSize=1`,
);
const afterRow = (after.body['rows'] as Array<Record<string, unknown>> | undefined)?.[0];
const afterEntries = (afterRow?.['rosters'] ?? []) as Array<Record<string, unknown>>;
check(
  'the calendar no longer shows leave days',
  !afterEntries.some((row) => row['entryType'] === 'leave'),
);
check(
  'and the rest day it did not write survived the cancellation',
  afterEntries.some((row) => row['entryType'] === 'rest'),
);

const afterRecords = await call(
  'GET',
  `/api/attendance/records?staffId=${String(staffId)}&from=${start}&to=${end}&page=1&pageSize=50`,
);
const afterStatus = (afterRecords.body['byStatus'] ?? {}) as Record<string, number>;
show('status kehadiran', JSON.stringify(afterStatus));
check('and no day is still reported as leave', (afterStatus['on_leave'] ?? 0) === 0);

const cancelTwice = await call('POST', `/api/leave-requests/${String(requestId)}/cancel`, {
  note: 'Ujian',
});
check('a cancelled request cannot be cancelled again', cancelTwice.status === 409);

// ---------------------------------------------------------------------------
console.log('\n=== A range with no working days is refused ===');
// ---------------------------------------------------------------------------

const restOnly = await call('POST', '/api/leave-requests', {
  staffId,
  leaveTypeId: medicalId,
  fromDate: restDay,
  toDate: restDay,
  reason: 'Ujian hari rehat sahaja',
});
check('a request covering only a rest day is refused', restOnly.status === 409);
show('message', String(restOnly.body['error']).slice(0, 120));
if (restOnly.status === 200) opened.push(Number(restOnly.body['id']));

// ---------------------------------------------------------------------------
console.log('\n=== A type with history cannot be deleted ===');
// ---------------------------------------------------------------------------

const inUse = (await call('GET', '/api/leave-types')).body as unknown as Array<
  Record<string, unknown>
>;
const withHistory = inUse.find((row) => Number(row['requestCount']) > 0);
if (withHistory) {
  const refused = await call('DELETE', `/api/leave-types/${String(withHistory['id'])}`);
  // Past requests still have to name what was taken, so the type is deactivated
  // rather than removed.
  check('a type carrying requests is refused deletion', refused.status === 409);
  show('message', String(refused.body['error']).slice(0, 120));
} else {
  show('dilangkau', 'tiada jenis cuti dengan sejarah');
}

await cleanup();
finish();

// ---------------------------------------------------------------------------

/** Undoes everything this run created, so a second run starts from the same place. */
async function cleanup(): Promise<void> {
  console.log('\n=== Cleanup ===');

  let removed = 0;
  for (const id of opened) {
    const response = await call('POST', `/api/leave-requests/${String(id)}/cancel`, {
      note: 'Pembersihan skrip verifikasi',
    });
    if (response.status === 200) removed += 1;
  }
  show('permohonan ditarik', `${String(removed)} daripada ${String(opened.length)}`);

  if (restRoster) {
    const response = await call('DELETE', '/api/roster', {
      staffIds: [restRoster.staffId],
      dates: [restRoster.date],
    });
    show('hari rehat dibuang', String(response.body['removed'] ?? 0));
  }
}

function finish(): never {
  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

function todayKey(): string {
  const now = new Date();
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function addDays(key: string, days: number): string {
  const base = new Date(`${key}T00:00:00`);
  base.setDate(base.getDate() + days);
  return `${String(base.getFullYear())}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
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
  console.log(`         ${label}: ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
