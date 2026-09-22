/**
 * Timezone-aware date arithmetic for attendance.
 *
 * Every calculation here is anchored to the organisation's timezone, never the
 * server's. That distinction is not cosmetic: a night shift starting 01:00 in
 * Malaysia is 17:00 the previous day in UTC, so a server running in UTC would
 * file it against the wrong work date and the shift would appear to have no
 * check-in.
 *
 * Implemented with `Intl` rather than a fixed offset so zones that observe DST
 * are handled correctly. Malaysia does not, but the deployment target is a
 * setting, and a fixed offset is the kind of shortcut that silently breaks once
 * somebody changes it.
 */

/**
 * Offset of a zone from UTC at a given instant, in minutes east of UTC.
 *
 * Derived by formatting the instant in both zones and comparing, which is the
 * only approach that stays correct across a DST boundary.
 */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }

  // `hour` can format as 24 for midnight in some environments.
  const hour = (parts['hour'] ?? 0) % 24;

  const asUtc = Date.UTC(
    parts['year'] ?? 1970,
    (parts['month'] ?? 1) - 1,
    parts['day'] ?? 1,
    hour,
    parts['minute'] ?? 0,
    parts['second'] ?? 0,
  );

  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** Calendar parts of an instant as seen in a zone. */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function toZonedParts(instant: Date, timeZone: string): ZonedParts {
  const offset = zoneOffsetMinutes(instant, timeZone);
  const shifted = new Date(instant.getTime() + offset * 60_000);

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/**
 * Builds the instant matching a wall-clock time in a zone.
 *
 * Two passes: guess using the offset that applies at the naive instant, then
 * re-measure at the corrected instant. A single pass is wrong for times within a
 * DST transition, where the offset that applies is not the one the guess landed
 * in.
 */
export function fromZonedTime(
  parts: { year: number; month: number; day: number; hour?: number; minute?: number },
  timeZone: string,
): Date {
  const naive = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
  );

  const firstOffset = zoneOffsetMinutes(new Date(naive), timeZone);
  const candidate = naive - firstOffset * 60_000;

  const secondOffset = zoneOffsetMinutes(new Date(candidate), timeZone);
  if (secondOffset === firstOffset) return new Date(candidate);

  return new Date(naive - secondOffset * 60_000);
}

/**
 * Instant of local midnight for the day an instant falls on in a zone.
 *
 * An instant, not a calendar date: for Malaysia it is 16:00 UTC on the previous
 * day. Use it for time arithmetic — the start of a shift window, the earliest punch
 * that can belong to a day. Do **not** store it in a `@db.Date` column; see
 * `zonedDateOnly` for why.
 */
export function zonedStartOfDay(instant: Date, timeZone: string): Date {
  const parts = toZonedParts(instant, timeZone);
  return fromZonedTime({ year: parts.year, month: parts.month, day: parts.day }, timeZone);
}

// ---------------------------------------------------------------------------
// Date-only values
// ---------------------------------------------------------------------------

/**
 * Calendar dates, as distinct from instants.
 *
 * `workDate`, `fromDate`, `toDate`, `hireDate` and `holidays.date` are declared
 * `@db.Date` — a MySQL `DATE`, which has no time and no zone. Prisma truncates a
 * JS `Date` to that column using its **UTC** parts, so the only representation that
 * survives a round trip is UTC midnight of the intended calendar day.
 *
 * Storing `zonedStartOfDay` instead loses a day on every write for any zone east of
 * UTC, and because a value read back out is fed straight into the next query, the
 * loss compounds: approve a leave request and cancel it and the range has moved two
 * days. Hence a separate vocabulary for the two domains, so a value cannot be used
 * in the wrong one by accident.
 */

/** The calendar date an instant falls on in a zone, as a date-only value. */
export function zonedDateOnly(instant: Date, timeZone: string): Date {
  const parts = toZonedParts(instant, timeZone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

/**
 * Normalises a value that is already meant to be a calendar date.
 *
 * `z.coerce.date()` on `'2026-08-29'` produces UTC midnight, which is already
 * correct; this strips any time component that came with it without consulting a
 * zone, because there is no zone in a date.
 */
export function asDateOnly(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/** A date-only value from a `YYYY-MM-DD` key, with no zone round trip. */
export function dateOnlyFromKey(key: string): Date {
  const [year, month, day] = key.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

/** `YYYY-MM-DD` for a date-only value, read in UTC because that is how it is stored. */
export function dateOnlyKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Whole days between two date-only values, inclusive of both ends. */
export function dateOnlySpan(from: Date, to: Date): number {
  return Math.round((asDateOnly(to).getTime() - asDateOnly(from).getTime()) / 86_400_000) + 1;
}

export function addDateOnlyDays(value: Date, days: number): Date {
  return new Date(asDateOnly(value).getTime() + days * 86_400_000);
}

/**
 * Calendar dates from one to another, inclusive.
 *
 * Plain 24-hour steps are exact here: UTC has no daylight saving, which is the other
 * reason a date-only value is held in UTC rather than in the organisation's zone.
 */
export function* eachDateOnly(from: Date, to: Date): Generator<Date> {
  let cursor = asDateOnly(from);
  const last = asDateOnly(to);

  while (cursor <= last) {
    yield cursor;
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
}

/**
 * Instant of an `HH:mm` wall-clock time on a date-only value's day.
 *
 * The bridge from the calendar domain back into the instant domain. Reads the day
 * from the value's UTC parts and resolves the wall clock in the organisation's zone,
 * so it stays correct for zones west of UTC as well.
 */
export function timeOnDateOnly(dateOnly: Date, hhmm: string, timeZone: string): Date {
  const [hour, minute] = hhmm.split(':').map(Number);

  return fromZonedTime(
    {
      year: dateOnly.getUTCFullYear(),
      month: dateOnly.getUTCMonth() + 1,
      day: dateOnly.getUTCDate(),
      hour: hour ?? 0,
      minute: minute ?? 0,
    },
    timeZone,
  );
}

/** Instant of an `HH:mm` wall-clock time on a given local day. */
export function zonedTimeOnDay(day: Date, hhmm: string, timeZone: string): Date {
  const parts = toZonedParts(day, timeZone);
  const [hour, minute] = hhmm.split(':').map(Number);

  return fromZonedTime(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: hour ?? 0,
      minute: minute ?? 0,
    },
    timeZone,
  );
}

/** A stable key for grouping by local calendar day. */
export function zonedDateKey(instant: Date, timeZone: string): string {
  const parts = toZonedParts(instant, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function formatZonedTime(instant: Date, timeZone: string): string {
  const parts = toZonedParts(instant, timeZone);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}

export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * 86_400_000);
}

export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}

/**
 * Local days from one instant to another, inclusive.
 *
 * Walks by adding 24 hours then snapping back to local midnight, so a DST shift
 * cannot cause a day to be skipped or repeated.
 */
export function* eachZonedDay(from: Date, to: Date, timeZone: string): Generator<Date> {
  let cursor = zonedStartOfDay(from, timeZone);
  const last = zonedStartOfDay(to, timeZone);

  while (cursor <= last) {
    yield cursor;
    cursor = zonedStartOfDay(addMinutes(cursor, 26 * 60), timeZone);
  }
}

/**
 * Hikvision's timezone notation, which inverts the sign.
 *
 * `CST-8:00:00` denotes UTC+8. Getting this backwards puts a terminal sixteen
 * hours out, which looks like a broken clock rather than a wrong setting.
 */
export function toHikvisionTimeZone(offsetMinutesEastOfUtc: number): string {
  const sign = offsetMinutesEastOfUtc >= 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutesEastOfUtc);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return `CST${sign}${hours}:${String(minutes).padStart(2, '0')}:00`;
}
