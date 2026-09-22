import Holidays from 'date-holidays';

import { STATE_LABEL, libraryStateCode, type StateCode } from '@attendance/shared';
import { dateOnlyFromKey } from '../time.js';

/**
 * The gazetted public holidays for one year, for the nation and for a set of states.
 *
 * The only place `date-holidays` is called, and the only place a numeric state code exists. That
 * boundary is the whole point: the library identifies Malaysian states by number and silently falls
 * back to the national list when handed anything else, so a letter code reaching it produces a
 * plausible-looking result with no state days in it at all.
 *
 * ## One row per state, not an array column
 *
 * `Holiday` is unique on `(date, stateCode)`, so a day observed in three states is three rows. That
 * is deliberate: the leave engine asks "is this date a holiday" with a plain indexed lookup, and it
 * would otherwise be a JSON containment test on every day of every range it prices.
 *
 * A day that is national is one row with `stateCode: null`, and a state day that the library also
 * reports nationally is not duplicated — the national row wins and the state copies are dropped,
 * because a date that is already a holiday for everybody cannot also be a holiday for some.
 */
export interface GazettedHoliday {
  name: string;
  /** Calendar date: midnight UTC of the day meant, per the date-only domain. */
  date: Date;
  /**
   * The state that gazettes it. Never null from a sync.
   *
   * `Holiday.stateCode` is nullable because a company-declared day can apply to every office, but
   * the gazette always knows which state a day came from and throwing that away is what broke the
   * office filter. See the note on `gazettedHolidays`.
   */
  stateCode: string;
}

/** Only gazetted days off. The library also reports observances and bank days, which are not. */
const OBSERVED_TYPES = new Set(['public']);

/**
 * Built from the selected states only, one row per observing state.
 *
 * ## The library's national list is not used
 *
 * `new Holidays('MY')` looks like "the days observed everywhere" and is not. For 2026 it returns
 * sixteen days, two of which — Deepavali and Hari Nuzul Al-Quran — are absent from Sarawak's list,
 * because Sarawak does not gazette them. The attendance engine reads this table without filtering by
 * state (see the note in `hr/overtime-day.ts`), so writing those two for a Sarawak-only installation
 * would silently stop two working days a year counting as working days, in a table payroll divides
 * by.
 *
 * ## Nothing is ever collapsed to `stateCode: null`
 *
 * An earlier version marked a day nationwide when every *selected* state observed it. With one state
 * selected that made every day nationwide, which threw away the only record of which state each day
 * came from — so switching the office list from Sarawak to Melaka left Gawai Dayak in the table as a
 * federal holiday, unfilterable and unremovable. The bug was not the cleanup; it was destroying the
 * information the cleanup needed.
 *
 * `stateCode: null` now means one thing only: a day the organisation declared for every office.
 * Nothing inferred, and nothing the gazette writes.
 *
 * Whether a day happens to be observed everywhere is a question for the screen, computed from the
 * saved office list at render. It is not a fact about the row.
 */
export function gazettedHolidays(year: number, states: StateCode[]): GazettedHoliday[] {
  if (states.length === 0) return [];

  const out: GazettedHoliday[] = [];
  const seen = new Set<string>();

  for (const state of states) {
    for (const entry of listFor(year, state)) {
      /*
       * `(date, stateCode)` is the table's unique key, and one state's list can carry two entries on
       * the same date — two names for one day. The first name wins rather than the insert failing.
       */
      const dedup = `${entry.key}|${state}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);

      out.push({ name: entry.name, date: dateOnlyFromKey(entry.key), stateCode: state });
    }
  }

  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * One pass over the library, reduced to `YYYY-MM-DD` keys.
 *
 * The library returns a local datetime string; only the date part is kept, because these are
 * calendar dates and carrying a time would put them in the wrong domain — and `@db.Date` would
 * truncate them by their UTC part anyway.
 */
function listFor(year: number, state: StateCode): Array<{ key: string; name: string }> {
  const numeric = libraryStateCode(state);
  /*
   * Thrown rather than falling through to a national lookup.
   *
   * `new Holidays('MY', 'swk')` does not fail — it returns the national list. Measured on 2026:
   * the numeric code gives Sarawak 19 days, the letter code gives 16. So an unmapped code here
   * would produce a successful sync that is quietly missing every state day, and nothing on the
   * screen would say so.
   */
  if (numeric === null) throw new Error(`Kod negeri tidak dikenali: ${state}`);

  const rows = new Holidays('MY', numeric).getHolidays(year) ?? [];

  const out: Array<{ key: string; name: string }> = [];
  for (const row of rows) {
    if (!OBSERVED_TYPES.has(String(row.type))) continue;
    const key = String(row.date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    out.push({ key, name: String(row.name) });
  }
  return out;
}

/** For messages and the activity log, where a bare code reads as noise. */
export function stateNameList(codes: readonly string[]): string {
  return codes.map((code) => STATE_LABEL[code] ?? code).join(', ');
}
