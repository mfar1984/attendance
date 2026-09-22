/**
 * Verifies timezone arithmetic, including across a DST transition.
 *
 * Malaysia has no DST, so a bug here would stay invisible on this deployment and
 * only surface if the setting is ever changed. Tested against a DST zone so the
 * logic is known correct rather than merely untested.
 */
import {
  addDateOnlyDays,
  asDateOnly,
  dateOnlyFromKey,
  dateOnlyKey,
  dateOnlySpan,
  eachDateOnly,
  eachZonedDay,
  timeOnDateOnly,
  zonedDateOnly,
  fromZonedTime,
  toHikvisionTimeZone,
  zoneOffsetMinutes,
  zonedDateKey,
  zonedStartOfDay,
  zonedTimeOnDay,
} from '../apps/server/src/time.js';

let failures = 0;

function check(description: string, actual: unknown, expected: unknown): void {
  const pass = String(actual) === String(expected);
  console.log(`  ${pass ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!pass) {
    console.log(`         expected ${String(expected)}`);
    console.log(`         actual   ${String(actual)}`);
    failures += 1;
  }
}

const KL = 'Asia/Kuala_Lumpur';
const NY = 'America/New_York';

console.log('\n=== Offsets ===');
check('Kuala Lumpur is UTC+8', zoneOffsetMinutes(new Date('2026-08-28T00:00:00Z'), KL), 480);
check('New York in January is UTC-5', zoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), NY), -300);
check('New York in July is UTC-4 (DST)', zoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), NY), -240);

console.log('\n=== Work date for a scan just after local midnight ===');
{
  // 00:30 on 29 August in Kuala Lumpur is 16:30 on 28 August UTC. A server
  // running in UTC would file this against the wrong day.
  const scan = new Date('2026-08-28T16:30:00Z');
  check('local date is 29 August', zonedDateKey(scan, KL), '2026-08-29');
  check(
    'work date is local midnight on 29 August',
    zonedStartOfDay(scan, KL).toISOString(),
    '2026-08-28T16:00:00.000Z',
  );
}

console.log('\n=== Night shift crossing midnight ===');
{
  const day = zonedStartOfDay(new Date('2026-08-28T12:00:00Z'), KL);
  const start = zonedTimeOnDay(day, '22:00', KL);
  const nextDay = zonedStartOfDay(new Date(day.getTime() + 26 * 3_600_000), KL);
  const end = zonedTimeOnDay(nextDay, '07:00', KL);

  check('shift starts 22:00 local on 28 Aug', start.toISOString(), '2026-08-28T14:00:00.000Z');
  // 07:00 local on 29 August is still 28 August in UTC, which is precisely the
  // confusion this module exists to remove.
  check('shift ends 07:00 local on 29 Aug', end.toISOString(), '2026-08-28T23:00:00.000Z');
  check('next local day resolves to 29 Aug', zonedDateKey(nextDay, KL), '2026-08-29');
  check('duration is 9 hours', (end.getTime() - start.getTime()) / 3_600_000, 9);
}

console.log('\n=== Spring forward: 08:00 stays 08:00 local ===');
{
  // New York moves to DST on 8 March 2026 at 02:00 local.
  const before = zonedTimeOnDay(zonedStartOfDay(new Date('2026-03-07T17:00:00Z'), NY), '08:00', NY);
  const after = zonedTimeOnDay(zonedStartOfDay(new Date('2026-03-09T17:00:00Z'), NY), '08:00', NY);

  check('7 March 08:00 EST is 13:00 UTC', before.toISOString(), '2026-03-07T13:00:00.000Z');
  check('9 March 08:00 EDT is 12:00 UTC', after.toISOString(), '2026-03-09T12:00:00.000Z');
  // A naive "add 24 hours" would keep the UTC hour identical and drift the local
  // start time by an hour on the day after the transition.
  check(
    'the UTC instant shifts by an hour, the local time does not',
    (after.getTime() - before.getTime()) / 3_600_000,
    47,
  );
}

console.log('\n=== Day iteration across a DST boundary ===');
{
  const days = [...eachZonedDay(new Date('2026-03-06T17:00:00Z'), new Date('2026-03-10T17:00:00Z'), NY)];
  check('yields five days without skipping or repeating', days.length, 5);
  check(
    'dates are consecutive',
    days.map((day) => zonedDateKey(day, NY)).join(','),
    '2026-03-06,2026-03-07,2026-03-08,2026-03-09,2026-03-10',
  );
}

console.log('\n=== Round trip ===');
{
  const built = fromZonedTime({ year: 2026, month: 8, day: 28, hour: 8, minute: 58 }, KL);
  check('08:58 local is 00:58 UTC', built.toISOString(), '2026-08-28T00:58:00.000Z');
}

/**
 * Calendar dates, which are a different domain from instants.
 *
 * `@db.Date` columns are truncated by Prisma using UTC parts, so a date-only value
 * has to be UTC midnight of the intended day. Storing `zonedStartOfDay` there loses a
 * day for every zone east of UTC — and because the value read back is fed into the
 * next query, the loss compounds on each round trip.
 */
console.log('\n=== Calendar dates are UTC midnight, not local midnight ===');
{
  // 09:00 local on 29 August in Malaysia.
  const instant = new Date('2026-08-29T01:00:00Z');

  check(
    'the instant of local midnight is the previous UTC day',
    zonedStartOfDay(instant, KL).toISOString(),
    '2026-08-28T16:00:00.000Z',
  );
  check(
    'but the calendar date is 29 August at UTC midnight',
    zonedDateOnly(instant, KL).toISOString(),
    '2026-08-29T00:00:00.000Z',
  );
  check('and its key names the local day', dateOnlyKey(zonedDateOnly(instant, KL)), '2026-08-29');

  // The compounding case: a value read back out and used again must not move.
  let value = dateOnlyFromKey('2026-08-29');
  for (let round = 0; round < 5; round += 1) value = asDateOnly(value);
  check('a date-only value survives repeated round trips', dateOnlyKey(value), '2026-08-29');

  // Just before local midnight, where a UTC reading lands on the wrong day.
  check(
    'late-evening local time still resolves to the local day',
    dateOnlyKey(zonedDateOnly(new Date('2026-08-29T15:59:00Z'), KL)),
    '2026-08-29',
  );
  check(
    'and just after local midnight belongs to the next day',
    dateOnlyKey(zonedDateOnly(new Date('2026-08-29T16:01:00Z'), KL)),
    '2026-08-30',
  );

  // Western zones are the mirror case, and the reason the helper takes a zone.
  check(
    'a zone west of UTC reads its own local day',
    dateOnlyKey(zonedDateOnly(new Date('2026-08-29T03:00:00Z'), NY)),
    '2026-08-28',
  );
}

console.log('\n=== Calendar date iteration and spans ===');
{
  const days = [...eachDateOnly(dateOnlyFromKey('2026-12-27'), dateOnlyFromKey('2027-01-02'))];
  check('a range crossing new year yields seven days', days.length, 7);
  check(
    'and stays on the calendar dates asked for',
    days.map(dateOnlyKey).join(','),
    '2026-12-27,2026-12-28,2026-12-29,2026-12-30,2026-12-31,2027-01-01,2027-01-02',
  );
  check(
    'the span counts both ends',
    dateOnlySpan(dateOnlyFromKey('2026-12-27'), dateOnlyFromKey('2027-01-02')),
    7,
  );

  // A DST boundary must not swallow or duplicate a calendar day either.
  const march = [...eachDateOnly(dateOnlyFromKey('2026-03-06'), dateOnlyFromKey('2026-03-10'))];
  check('five days across a DST boundary', march.map(dateOnlyKey).join(','), '2026-03-06,2026-03-07,2026-03-08,2026-03-09,2026-03-10');
}

console.log('\n=== Calendar date back into instants ===');
{
  const day = dateOnlyFromKey('2026-08-28');
  check(
    '08:00 on a calendar day is 00:00 UTC in Malaysia',
    timeOnDateOnly(day, '08:00', KL).toISOString(),
    '2026-08-28T00:00:00.000Z',
  );
  check(
    'and midnight on it is 16:00 UTC the day before',
    timeOnDateOnly(day, '00:00', KL).toISOString(),
    '2026-08-27T16:00:00.000Z',
  );
  // The night-shift case, now anchored on a calendar date rather than an instant.
  check(
    '22:00 on the calendar day is 14:00 UTC',
    timeOnDateOnly(day, '22:00', KL).toISOString(),
    '2026-08-28T14:00:00.000Z',
  );
  check(
    '07:00 the next calendar day is 23:00 UTC',
    timeOnDateOnly(addDateOnlyDays(day, 1), '07:00', KL).toISOString(),
    '2026-08-28T23:00:00.000Z',
  );
  // Western zone: reading the day from UTC parts is what keeps this correct.
  check(
    '08:00 on a calendar day in New York is 12:00 UTC in August (EDT)',
    timeOnDateOnly(day, '08:00', NY).toISOString(),
    '2026-08-28T12:00:00.000Z',
  );
}

console.log('\n=== Hikvision inverted timezone notation ===');
check('UTC+8 is written CST-8:00:00', toHikvisionTimeZone(480), 'CST-8:00:00');
check('UTC-5 is written CST+5:00:00', toHikvisionTimeZone(-300), 'CST+5:00:00');

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
