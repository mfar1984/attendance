/**
 * What kind of day a date was for one person, and what rate that day is paid at.
 *
 * A database read, not an HTTP call to ourselves. Both facts already live here: the
 * roster says whether the person was on a rest day, and the holiday calendar says
 * whether it was a public holiday.
 */
import { db } from '../db.js';
import { dateOnlyKey } from '../time.js';

import { STATUTORY_MULTIPLIER, type OvertimeDayType } from './overtime.js';

export interface ResolvedOvertimeDay {
  dayType: OvertimeDayType;
  holidayName: string | null;
  /** The active rate for this day type, when one is configured. */
  rateId: number | null;
  rateName: string | null;
  multiplier: number;
  /** True when no rate is configured and the statutory floor is standing in. */
  usingStatutoryFloor: boolean;
}

/**
 * Rest day comes from this person's roster, not from a fixed Saturday and Sunday.
 *
 * Hospital shifts rotate. A global weekend would make a ward nurse whose rest day is
 * Tuesday paid at the weekday floor for it, and paid at the rest-day rate for a Sunday
 * she was rostered to work. `entryType === 'rest'` is the same test the attendance
 * engine and the leave day count already use, so all three agree.
 *
 * A date with no roster row is not a rest day. Unknown is not the same as off, and
 * guessing here would silently double somebody's rate.
 */
export async function resolveOvertimeDay(
  staffId: number,
  workDate: Date,
): Promise<ResolvedOvertimeDay> {
  const prisma = db();

  const [roster, holiday] = await Promise.all([
    prisma.rosterEntry.findUnique({
      where: { staffId_workDate: { staffId, workDate } },
      select: { entryType: true },
    }),
    /*
     * `stateCode` is not filtered, matching the leave day count. This is one hospital
     * in one state, and a calendar that two modules read differently is a calendar
     * that produces two different answers for the same day.
     */
    prisma.holiday.findFirst({
      where: { date: workDate },
      select: { name: true },
    }),
  ]);

  const isRestDay = roster?.entryType === 'rest';
  const isHoliday = holiday !== null;

  const dayType: OvertimeDayType =
    isHoliday && isRestDay
      ? 'holidayRestDay'
      : isHoliday
        ? 'holiday'
        : isRestDay
          ? 'restDay'
          : 'weekday';

  const rate = await prisma.overtimeRate.findFirst({
    where: { dayType, active: true },
    orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    select: { id: true, name: true, multiplier: true },
  });

  return {
    dayType,
    holidayName: holiday?.name ?? null,
    rateId: rate?.id ?? null,
    rateName: rate?.name ?? null,
    /*
     * Falling back to the statutory floor rather than to 1.5 means a missing
     * public-holiday rate does not quietly underpay by half.
     */
    multiplier: rate ? Number(rate.multiplier) : STATUTORY_MULTIPLIER[dayType],
    usingStatutoryFloor: rate === null,
  };
}

/**
 * Minutes the engine measured as overtime on that day.
 *
 * Zero when there is no record — the day was never computed, so there is no evidence
 * to claim against. The caller turns that into a refusal that says so.
 */
export async function measuredOvertimeMinutes(staffId: number, workDate: Date): Promise<number> {
  const record = await db().attendanceRecord.findUnique({
    where: { staffId_workDate: { staffId, workDate } },
    select: { overtimeMinutes: true },
  });
  return record?.overtimeMinutes ?? 0;
}

/**
 * The person's claimed overtime minutes for the calendar month of `workDate`.
 *
 * Pending and approved together, because the 104-hour cap is about hours worked and not
 * hours already signed off — a dozen pending claims would otherwise walk past it one at
 * a time. `exceptId` leaves a claim out of its own total.
 */
export async function claimedMinutesInMonth(
  staffId: number,
  workDate: Date,
  exceptId?: number,
): Promise<number> {
  const year = workDate.getUTCFullYear();
  const month = workDate.getUTCMonth();
  const from = new Date(Date.UTC(year, month, 1));
  const to = new Date(Date.UTC(year, month + 1, 0));

  const rows = await db().overtimeRequest.findMany({
    where: {
      staffId,
      status: { in: ['pending', 'approved'] },
      workDate: { gte: from, lte: to },
      ...(exceptId === undefined ? {} : { id: { not: exceptId } }),
    },
    select: { requestedMinutes: true },
  });

  return rows.reduce((total, row) => total + row.requestedMinutes, 0);
}

/** `YYYYMM` for the request number, from a calendar date. */
export function yearMonthOf(workDate: Date): string {
  return dateOnlyKey(workDate).slice(0, 7).replace('-', '');
}
