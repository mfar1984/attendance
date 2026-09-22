/**
 * Verifies the per-type policy gates on leave, against the running server.
 *
 * Separate from `verify-leave`, which asserts the side effect of an approval — roster rows and
 * recompute. This one asserts the gates that decide whether an application may exist at all, and
 * the unit its days are counted in. They are different failure modes: a broken gate lets somebody
 * file maternity leave who cannot take it, and nothing downstream looks wrong.
 *
 * Three behaviours, each of which is invisible until it is wrong:
 *
 *   eligibility  — a gendered category refuses the wrong gender, and refuses an unrecorded one
 *                  rather than waving it through
 *   countedIn    — a calendar-counted type charges rest days and public holidays, and a
 *                  working-counted one does not
 *   requiresDocument — a category needing evidence cannot be approved without it, but can still
 *                  be rejected
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-leave-policy.mts <password>
 */
import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-leave-policy.mts <adminPassword>');
  process.exit(2);
}

let cookie = '';
let failures = 0;

/**
 * Everything this run changed, restored at the end whether or not it passed.
 *
 * The script edits a real leave type and a real staff row, so leaving either altered would make
 * the next run assert against a fixture it did not set up — and would leave a gendered restriction
 * on a category somebody uses.
 */
let typeId: number | null = null;
let staffId: number | null = null;
/**
 * The type's real settings, captured before anything is changed.
 *
 * An earlier version restored `eligibility: 'all'` unconditionally and quietly wiped the statutory
 * `female` restriction off maternity leave — the script left the fixture *more* wrong than it found
 * it. Restore has to put back what was there, not what the author assumed was there.
 */
let originalCountedIn = 'working';
let originalEligibility = 'all';
let originalRequiresDocument = false;
/** The staff member's real hire date, so the band tests can move it and put it back. */
let originalHireDate: string | null = null;
let sickTypeId: number | null = null;
const opened: number[] = [];
/** The rest day this run placed, so the fixture does not keep it. */
let restRoster: { staffId: number; date: string } | null = null;

process.on('uncaughtException', (cause) => {
  console.error('\n', cause);
  void restore().then(() => process.exit(1));
});
process.on('unhandledRejection', (cause) => {
  console.error('\n', cause);
  void restore().then(() => process.exit(1));
});

await call('POST', '/api/auth/login', {
  email,
  password,
  ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
});
check('logged in', cookie.length > 0);

// ---------------------------------------------------------------------------
console.log('\n=== Fixture ===');
// ---------------------------------------------------------------------------

const types = (await call('GET', '/api/leave-types')).body as unknown as Array<
  Record<string, unknown>
>;
const maternity = types.find((row) => row['code'] === 'ML');
check('the maternity type exists', maternity !== undefined);
if (!maternity) finish();
typeId = Number(maternity['id']);
originalCountedIn = String(maternity['countedIn'] ?? 'working');
originalEligibility = String(maternity['eligibility'] ?? 'all');
originalRequiresDocument = maternity['requiresDocument'] === true;

const staffPage = (await call('GET', '/api/staff?pageSize=1')).body;
const rows = (staffPage['rows'] ?? []) as Array<Record<string, unknown>>;
check('a staff row is available', rows.length > 0);
if (rows.length === 0) finish();
staffId = Number(rows[0]?.['id']);
show('fixture', `jenis #${String(typeId)} · staf #${String(staffId)} ${String(rows[0]?.['fullName'])}`);

// Captured before the band tests move it, so the person keeps the date they actually started on.
const detail = (await call('GET', `/api/staff/${String(staffId)}`)).body;
originalHireDate =
  typeof detail['hireDate'] === 'string' ? String(detail['hireDate']).slice(0, 10) : null;
show('tarikh mula asal', originalHireDate ?? '∅');

// A window well clear of today, so nothing this script files can reach the recompute window.
const from = '2027-03-01';
const to = '2027-03-03';

// ---------------------------------------------------------------------------
console.log('\n=== Eligibility ===');
// ---------------------------------------------------------------------------

check(
  'the type can be restricted to one gender',
  (await call('PATCH', `/api/leave-types/${String(typeId)}`, { eligibility: 'female' })).status ===
    200,
);
const readBack = ((await call('GET', '/api/leave-types')).body as unknown as Array<
  Record<string, unknown>
>).find((row) => row['code'] === 'ML');
check('and it reads back', readBack?.['eligibility'] === 'female');

await call('PATCH', `/api/staff/${String(staffId)}`, { gender: null });
const unrecorded = await apply();
/*
 * The important one. A gate that passes whatever it cannot verify is not a gate, and most of this
 * directory was imported from terminals that carry no gender at all — so "unrecorded" is the
 * common case, not the edge case.
 */
check('an unrecorded gender is refused, not waved through', unrecorded.status === 409);
check(
  'and the refusal names the field to fill',
  String(unrecorded.body['error']).includes('Jantina'),
);
show('mesej', String(unrecorded.body['error']).slice(0, 140));

await call('PATCH', `/api/staff/${String(staffId)}`, { gender: 'male' });
const wrong = await apply();
check('the wrong gender is refused', wrong.status === 409);
show('mesej', String(wrong.body['error']).slice(0, 140));

await call('PATCH', `/api/staff/${String(staffId)}`, { gender: 'female' });
const right = await apply();
check('the matching gender is accepted', right.status === 200 || right.status === 201);
const requestId = Number(right.body['id']);
if (Number.isFinite(requestId)) opened.push(requestId);

// ---------------------------------------------------------------------------
console.log('\n=== Counted in ===');
// ---------------------------------------------------------------------------

/*
 * A rest day is placed inside the window first, and this is the whole reason the section is worth
 * running.
 *
 * Without one, both modes return the same number — this directory carries no rest roster rows in
 * 2027, so a weekend is an ordinary working day as far as the engine is concerned. An earlier
 * version of this script asserted "calendar charges three days" over a clean range and passed
 * while proving nothing: working days would also have been three.
 */
const restDay = '2027-03-02';
const restWrite = await call('POST', '/api/roster', {
  staffIds: [staffId],
  dates: [restDay],
  shiftId: null,
  entryType: 'rest',
});
check('a rest day can be placed inside the window', restWrite.status === 200);
if (restWrite.status === 200) restRoster = { staffId: staffId, date: restDay };
show('hari rehat', restDay);

await call('PATCH', `/api/leave-types/${String(typeId)}`, { countedIn: 'calendar' });
const asCalendar = await quote();
check('counted in calendar days, the rest day is charged', Number(asCalendar.body['days']) === 3);
check('and it is still reported as a rest day', Number(asCalendar.body['restDays']) === 1);
show(
  'kalendar',
  `days=${String(asCalendar.body['days'])} restDays=${String(asCalendar.body['restDays'])} ` +
    `totalDays=${String(asCalendar.body['totalDays'])}`,
);

await call('PATCH', `/api/leave-types/${String(typeId)}`, { countedIn: 'working' });
const asWorking = await quote();
check('counted in working days, the same range charges one less', Number(asWorking.body['days']) === 2);
check('the rest day count is unchanged', Number(asWorking.body['restDays']) === 1);
show(
  'bekerja',
  `days=${String(asWorking.body['days'])} restDays=${String(asWorking.body['restDays'])} ` +
    `totalDays=${String(asWorking.body['totalDays'])}`,
);

/*
 * The invariant payroll depends on: the days debited and the `leave` roster rows written are the
 * same set. A calendar type that charged three and wrote two would report less leave than it took
 * off the balance, and the two figures have to reconcile.
 */
check(
  'the two modes actually differ, so the setting does something',
  Number(asCalendar.body['days']) !== Number(asWorking.body['days']),
);

// Left as calendar, which is what maternity is, for the document section below.
await call('PATCH', `/api/leave-types/${String(typeId)}`, { countedIn: 'calendar' });

// ---------------------------------------------------------------------------
console.log('\n=== Supporting document ===');
// ---------------------------------------------------------------------------

check(
  'a type can be made to require a document',
  (await call('PATCH', `/api/leave-types/${String(typeId)}`, { requiresDocument: true })).status ===
    200,
);

const blocked = await call('POST', `/api/leave-requests/${String(requestId)}/decide`, {
  decision: 'approved',
});
check('approval without one is refused', blocked.status === 409);
check(
  'and the refusal says what is missing',
  String(blocked.body['error']).toLowerCase().includes('dokumen'),
);
show('mesej', String(blocked.body['error']).slice(0, 140));

/*
 * Rejection stays open. Refusing an application because it has no evidence is exactly a decision
 * somebody needs to be able to make, and requiring the missing document in order to say "no" would
 * leave the request pending forever.
 */
const rejected = await call('POST', `/api/leave-requests/${String(requestId)}/decide`, {
  decision: 'rejected',
  note: 'Tiada sijil perubatan dilampirkan.',
});
check('but rejection is still allowed without one', rejected.status === 200);

// ---------------------------------------------------------------------------
console.log('\n=== Service bands ===');
// ---------------------------------------------------------------------------

/*
 * Read through the balances endpoint rather than by inspecting the type, because the band is
 * resolved per person. A test that asserted the three numbers are stored would pass while the
 * engine still handed everybody the first one.
 */
const sick = types.find((row) => row['code'] === 'MC');
check('the sick leave type is graded', sick?.['serviceTiers'] === true);
show(
  'band',
  `${String(sick?.['annualDays'])} / ${String(sick?.['annualDaysTier2'])} / ` +
    `${String(sick?.['annualDaysTier3'])}`,
);
const sickId = Number(sick?.['id']);
// Recorded so `restore()` turns carry-forward back off even if a check below throws.
sickTypeId = sickId;

/** The entitlement the balances endpoint reports for MC in `year`. */
async function sickEntitlement(year: number): Promise<Record<string, unknown>> {
  const body = (await call('GET', `/api/leave-balance/${String(staffId)}?year=${String(year)}`)).body;
  const list = (body['balances'] ?? []) as Array<Record<string, unknown>>;
  const hit = list.find((row) => Number((row['type'] as Record<string, unknown>)['id']) === sickId);
  /*
   * Throws rather than returning undefined, because a missing row makes every numeric assertion
   * below compare `NaN` — and `NaN !== NaN` is true, so the "the bands actually differ" check
   * passed against no data at all on the first run of this section. A test that goes green when the
   * endpoint is not there is worse than no test.
   */
  if (!hit) throw new Error(`No MC balance row for ${String(year)} — check the endpoint path.`);
  return hit;
}

const thisYear = new Date().getUTCFullYear();

await call('PATCH', `/api/staff/${String(staffId)}`, { hireDate: `${String(thisYear - 1)}-06-01` });
const band1 = Number((await sickEntitlement(thisYear))['annualDays']);
check('under two years of service gets the first band', band1 === 14);
show('baru', `annualDays=${String(band1)}`);

await call('PATCH', `/api/staff/${String(staffId)}`, { hireDate: `${String(thisYear - 3)}-06-01` });
const band2 = Number((await sickEntitlement(thisYear))['annualDays']);
check('three years of service gets the second band', band2 === 18);
show('3 tahun', `annualDays=${String(band2)}`);

await call('PATCH', `/api/staff/${String(staffId)}`, { hireDate: `${String(thisYear - 9)}-06-01` });
const band3 = Number((await sickEntitlement(thisYear))['annualDays']);
check('nine years of service gets the third band', band3 === 22);
show('9 tahun', `annualDays=${String(band3)}`);

check(
  'the three bands actually differ, so the grading does something',
  Number.isFinite(band1) && band1 !== band2 && band2 !== band3,
);

// ---------------------------------------------------------------------------
console.log('\n=== Carry forward ===');
// ---------------------------------------------------------------------------

/*
 * Carry-in is derived from the previous year, so the assertion is that turning the flag on changes
 * this year's entitlement without anything being written for the year boundary. Nothing was taken
 * last year, so the whole band carries — and the cap is what stops it being the whole band.
 */
const withoutCarry = await sickEntitlement(thisYear);
check('with carry off, nothing is carried in', Number(withoutCarry['carriedIn']) === 0);
check('and the total is the band alone', Number(withoutCarry['annualDays']) === 22);

await call('PATCH', `/api/leave-types/${String(sickId)}`, {
  carryForward: true,
  carryForwardMaxDays: 5,
});
const capped = await sickEntitlement(thisYear);
check('with carry on, last year unused is carried in', Number(capped['carriedIn']) === 5);
check(
  'the total is the band plus the carry',
  Number(capped['annualDays']) ===
    Number(capped['entitlementBase']) + Number(capped['carriedIn']),
);
show(
  'berhad 5',
  `base=${String(capped['entitlementBase'])} carriedIn=${String(capped['carriedIn'])} ` +
    `total=${String(capped['annualDays'])}`,
);

await call('PATCH', `/api/leave-types/${String(sickId)}`, { carryForwardMaxDays: null });
const uncapped = await sickEntitlement(thisYear);
/*
 * Uncapped, the carry is last year's whole band — nothing was taken, so all of it is unused. That
 * this exceeds the capped figure is the assertion: it proves the cap was doing work rather than
 * happening to agree.
 */
check('uncapped, more carries than the cap allowed', Number(uncapped['carriedIn']) > 5);
check(
  'and it is last year band, not this year',
  Number(uncapped['carriedIn']) === Number(uncapped['entitlementBase']),
);
show(
  'tanpa had',
  `carriedIn=${String(uncapped['carriedIn'])} total=${String(uncapped['annualDays'])}`,
);

await restore();
finish();

// ---------------------------------------------------------------------------

async function apply(): Promise<{ status: number; body: Record<string, unknown> }> {
  return call('POST', '/api/leave-requests', {
    staffId,
    leaveTypeId: typeId,
    fromDate: from,
    toDate: to,
  });
}

/** The same window as `apply`, priced without filing anything. */
async function quote(): Promise<{ status: number; body: Record<string, unknown> }> {
  return call(
    'GET',
    `/api/leave-requests/quote?staffId=${String(staffId)}&leaveTypeId=${String(typeId)}` +
      `&from=${from}&to=${to}`,
  );
}

/** Puts the fixture back. Safe to call twice. */
async function restore(): Promise<void> {
  for (const id of opened.splice(0)) {
    const current = await call('GET', `/api/leave-requests/${String(id)}`);
    if (current.body['status'] === 'pending' || current.body['status'] === 'approved') {
      await call('POST', `/api/leave-requests/${String(id)}/cancel`, {
        note: 'Dibatalkan oleh verify-leave-policy.',
      });
    }
  }
  if (typeId !== null) {
    await call('PATCH', `/api/leave-types/${String(typeId)}`, {
      eligibility: originalEligibility,
      requiresDocument: originalRequiresDocument,
      countedIn: originalCountedIn,
    });
  }
  if (sickTypeId !== null) {
    await call('PATCH', `/api/leave-types/${String(sickTypeId)}`, {
      carryForward: false,
      carryForwardMaxDays: null,
    });
  }
  if (staffId !== null) {
    await call('PATCH', `/api/staff/${String(staffId)}`, {
      gender: null,
      ...(originalHireDate === null ? {} : { hireDate: originalHireDate }),
    });
  }
  if (restRoster) {
    await call('DELETE', '/api/roster', {
      staffIds: [restRoster.staffId],
      dates: [restRoster.date],
    });
    restRoster = null;
  }
}

function finish(): never {
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
