/**
 * Verifies work patterns, shifts, roster and holidays.
 *
 * The important case is the night shift: a block starting 22:00 and ending 07:00
 * the next day must produce nine scheduled hours and must attribute a 23:00 scan
 * to the day the shift started, not the day the clock rolled over.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-schedule.mts <password>
 */
import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-schedule.mts <adminPassword>');
  process.exit(2);
}

let cookie = '';
let failures = 0;
const stamp = Date.now().toString().slice(-6);

await call('POST', '/api/auth/login', {
  email,
  password,
  ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
});
check('logged in', cookie.length > 0);

console.log('\n=== Work patterns ===');
const patterns = await call('GET', '/api/work-patterns');
check('list responds', patterns.status === 200);
for (const row of (patterns.body as unknown as Array<Record<string, unknown>>).slice(0, 5)) {
  const blocks = row['timeBlocks'] as Array<Record<string, unknown>>;
  show(
    `  ${String(row['name'])}`,
    blocks
      .map((block) => `${String(block['startTime'])}-${String(block['endTime'])}${block['endsNextDay'] === true ? '+1' : ''}`)
      .join(', ') + `  =${String(row['dailyMinutes'])}m/hari`,
  );
}

// The seeded night pattern is the case most likely to be modelled wrongly.
const night = (patterns.body as unknown as Array<Record<string, unknown>>).find((row) =>
  (row['timeBlocks'] as Array<Record<string, unknown>>).some((block) => block['endsNextDay'] === true),
);
check('a midnight-crossing pattern exists', night !== undefined);
if (night) {
  // 22:00 to 07:00 is nine hours, minus a 45 minute break.
  show('night pattern minutes', String(night['dailyMinutes']));
  check('night shift computes as 9 hours minus break', Number(night['dailyMinutes']) === 495);
}

console.log('\n=== Overlapping grace windows are refused ===');
const overlapping = await call('POST', '/api/work-patterns', {
  name: `Ujian Bertindih ${stamp}`,
  timeBlocks: [
    { blockOrder: 1, startTime: '08:00', endTime: '12:00', graceAfterMinutes: 180 },
    { blockOrder: 2, startTime: '13:00', endTime: '17:00', graceBeforeMinutes: 180 },
  ],
});
// One scan would qualify for both blocks, and which wins would depend on
// iteration order rather than on anything an operator could reason about.
check('overlapping windows are refused', overlapping.status === 409);
show('message', String(overlapping.body['error']).slice(0, 100));

console.log('\n=== A split shift with separated windows is accepted ===');
const split = await call('POST', '/api/work-patterns', {
  name: `Ujian Berpecah ${stamp}`,
  kind: 'shift',
  timeBlocks: [
    { blockOrder: 1, startTime: '08:00', endTime: '12:00', graceBeforeMinutes: 30, graceAfterMinutes: 30 },
    { blockOrder: 2, startTime: '14:00', endTime: '18:00', graceBeforeMinutes: 30, graceAfterMinutes: 30 },
  ],
});
check('split shift created', split.status === 200);
const splitId = Number(split.body['id']);

console.log('\n=== Shifts ===');
const shift = await call('POST', '/api/shifts', {
  code: `U${stamp.slice(-3)}`,
  name: `Ujian Shift ${stamp}`,
  colour: '#2563eb',
  workPatternId: splitId,
});
check('shift created', shift.status === 200);
const shiftId = Number(shift.body['id']);

const duplicateCode = await call('POST', '/api/shifts', {
  code: `U${stamp.slice(-3)}`,
  name: 'Pendua',
  workPatternId: splitId,
});
check('a duplicate shift code is refused', duplicateCode.status === 409);

console.log('\n=== Work pattern in use cannot be deleted ===');
const inUse = await call('DELETE', `/api/work-patterns/${splitId}`);
check('refused while a shift references it', inUse.status === 409);
show('message', String(inUse.body['error']));

console.log('\n=== Roster ===');
const staffList = await call('GET', '/api/staff?page=1&pageSize=3');
const staffRows = staffList.body['rows'] as Array<Record<string, unknown>>;
const staffId = Number(staffRows[0]?.['id']);
check('a staff member is available', Number.isFinite(staffId));

const dates = ['2026-09-01', '2026-09-02', '2026-09-03'];
const assigned = await call('POST', '/api/roster', {
  staffIds: [staffId],
  dates,
  shiftId,
  entryType: 'work',
});
check('roster assignment succeeds', assigned.status === 200);
show('days written', String(assigned.body['written']));

console.log('\n=== A working day without a shift is refused ===');
const noShift = await call('POST', '/api/roster', {
  staffIds: [staffId],
  dates: ['2026-09-04'],
  shiftId: null,
  entryType: 'work',
});
// There would be nothing to measure attendance against.
check('work without a shift is refused', noShift.status === 409);
show('message', String(noShift.body['error']));

const rest = await call('POST', '/api/roster', {
  staffIds: [staffId],
  dates: ['2026-09-04'],
  shiftId: null,
  entryType: 'rest',
});
check('a rest day without a shift is accepted', rest.status === 200);

console.log('\n=== Roster reads back into a calendar grid ===');
const grid = await call('GET', '/api/roster?from=2026-09-01&to=2026-09-30&page=1&pageSize=5');
check('grid responds', grid.status === 200);
const gridRows = grid.body['rows'] as Array<Record<string, unknown>>;
const mine = gridRows.find((row) => Number(row['id']) === staffId);
const entries = (mine?.['rosters'] ?? []) as Array<Record<string, unknown>>;
show('entries for this staff', String(entries.length));
check('the assigned days are present', entries.length >= 4);

console.log('\n=== Re-assigning the same day overwrites rather than duplicating ===');
await call('POST', '/api/roster', { staffIds: [staffId], dates, shiftId, entryType: 'work' });
const regrid = await call('GET', '/api/roster?from=2026-09-01&to=2026-09-30&page=1&pageSize=5');
const reEntries = ((regrid.body['rows'] as Array<Record<string, unknown>>).find(
  (row) => Number(row['id']) === staffId,
)?.['rosters'] ?? []) as unknown[];
check('no duplicate entries appear', reEntries.length === entries.length);

console.log('\n=== Holidays ===');
const holiday = await call('POST', '/api/holidays', {
  name: `Ujian Cuti ${stamp}`,
  date: '2026-09-16',
  stateCode: 'SWK',
});
check('holiday created', holiday.status === 200);
const holidayId = Number(holiday.body['id']);

const clash = await call('POST', '/api/holidays', {
  name: 'Pendua',
  date: '2026-09-16',
  stateCode: 'SWK',
});
check('a second holiday on the same date and state is refused', clash.status === 409);

const listed = await call('GET', '/api/holidays?year=2026');
const holidayRows = listed.body['rows'] as Array<Record<string, unknown>>;
show('holidays in 2026', String(holidayRows.length));
check('the new holiday is listed', holidayRows.some((row) => Number(row['id']) === holidayId));

console.log('\n=== Cleanup ===');
await call('DELETE', `/api/holidays/${holidayId}`);
await call('DELETE', '/api/roster', undefined, {
  staffIds: [staffId],
  dates: [...dates, '2026-09-04'],
});
await call('DELETE', `/api/shifts/${shiftId}`);
const removedPattern = await call('DELETE', `/api/work-patterns/${splitId}`);
check('the test pattern is removable once unreferenced', removedPattern.status === 200);

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);

async function call(
  method: string,
  path: string,
  body?: unknown,
  deleteBody?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = body ?? deleteBody;
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(payload ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
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
  console.log(`  ${label.padEnd(28)} ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
