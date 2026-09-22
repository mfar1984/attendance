/**
 * The period shape and the per-person aggregation, shared by reporting and payroll.
 *
 * Lifted out of `routes/reports.ts` when the payroll module needed the same figures. It is
 * deliberately one implementation: a payroll period that counted its own hours would be a
 * second attendance engine, and nobody reconciles the second against the first. The numbers a
 * payslip is built from are the numbers the payroll export shows, because they come from here.
 *
 * Nothing in this file writes. Every figure is derived from `AttendanceRecord`, which is itself
 * derived from the immutable raw log.
 */

import { db } from '../db.js';
import { conflict } from '../http.js';
import { dateOnlyFromKey, dateOnlyKey, dateOnlySpan, timeOnDateOnly } from '../time.js';
// ---------------------------------------------------------------------------
// Period and filters
// ---------------------------------------------------------------------------

export interface Period {
  /** Calendar bounds, for the `@db.Date` columns. */
  from: Date;
  to: Date;
  /**
   * Instant bounds, for the timestamp columns.
   *
   * `occurredAt` and `eventTime` are real instants, so filtering them by a calendar
   * date would take the UTC day and miss the eight hours at either end that belong to
   * the local one.
   */
  startsAt: Date;
  endsAt: Date;
  fromKey: string;
  toKey: string;
  dayCount: number;
}

/**
 * Resolves a reporting period in the organisation timezone.
 *
 * Refuses a reversed range and a span beyond a year: a five-year payroll export is
 * always a mistake, and it is the kind that only shows up as a timeout.
 */
export function parsePeriod(from: string, to: string, timeZone: string): Period {
  const start = dateOnlyFromKey(from);
  const end = dateOnlyFromKey(to);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw conflict('Tarikh tidak sah');
  }
  if (end < start) throw conflict('Tarikh tamat sebelum tarikh mula');

  const dayCount = dateOnlySpan(start, end);
  if (dayCount > 400) {
    throw conflict('Tempoh melebihi setahun. Pecahkan kepada beberapa tempoh yang lebih pendek.');
  }

  const startsAt = timeOnDateOnly(start, '00:00', timeZone);

  return {
    from: start,
    to: end,
    startsAt,
    endsAt: new Date(timeOnDateOnly(end, '00:00', timeZone).getTime() + 86_400_000),
    fromKey: dateOnlyKey(start),
    toKey: dateOnlyKey(end),
    dayCount,
  };
}

export function staffFilter(query: {
  departmentId?: number;
  locationId?: number;
  search?: string;
}): Record<string, unknown> {
  return {
    active: true,
    ...(query.departmentId !== undefined ? { departmentId: query.departmentId } : {}),
    ...(query.locationId !== undefined ? { locationId: query.locationId } : {}),
    ...(query.search
      ? {
          OR: [
            { fullName: { contains: query.search } },
            { employeeNo: { contains: query.search } },
          ],
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface StaffSummary {
  staffId: number;
  scheduledDays: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  leaveDays: number;
  restDays: number;
  holidayDays: number;
  incompleteDays: number;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  openExceptions: number;
}

/**
 * Approved overtime per person for a period, in minutes and ringgit.
 *
 * Deliberately separate from `summarise`, which reads attendance records. These are two
 * different facts and the export carries both:
 *
 *   `overtimeMinutes`  what the engine measured from scans
 *   `approvedMinutes`  what somebody authorised and priced
 *
 * They are not interchangeable, and collapsing them would hide the gap. Measured overtime
 * with no approved claim behind it is unpaid by design — somebody stayed late and nobody
 * signed for it. Payroll pays the approved figure.
 *
 * The amount is read from the stored column rather than recomputed from hours × rate ×
 * multiplier. That column was written once, at approval, from the hourly rate frozen at
 * submission. Recomputing here would reprice history the next time somebody edits a rate.
 */
export async function approvedOvertime(
  staffIds: number[],
  period: Period,
): Promise<Map<number, { minutes: number; amount: number }>> {
  const result = new Map<number, { minutes: number; amount: number }>();
  if (staffIds.length === 0) return result;

  const rows = await db().overtimeRequest.groupBy({
    by: ['staffId'],
    where: {
      staffId: { in: staffIds },
      status: 'approved',
      // `workDate` is a calendar column, so it is filtered with the calendar bounds.
      // Using the instant bounds would miss eight hours at each end of the period.
      workDate: { gte: period.from, lte: period.to },
    },
    _sum: { requestedMinutes: true, amount: true },
  });

  for (const row of rows) {
    result.set(row.staffId, {
      minutes: row._sum.requestedMinutes ?? 0,
      amount: Number(row._sum.amount ?? 0),
    });
  }
  return result;
}

/**
 * Overtime claims still waiting on a decision inside the period.
 *
 * Reported as a blocker rather than silently omitted. An unapproved claim is money the
 * export does not contain, and the person who filed it will notice on payday even though
 * nobody looking at the file would.
 */
export async function countPendingOvertime(
  staffIds: number[],
  period: Period,
): Promise<{ count: number; minutes: number }> {
  if (staffIds.length === 0) return { count: 0, minutes: 0 };

  const rows = await db().overtimeRequest.aggregate({
    where: {
      staffId: { in: staffIds },
      status: 'pending',
      workDate: { gte: period.from, lte: period.to },
    },
    _count: { _all: true },
    _sum: { requestedMinutes: true },
  });

  return { count: rows._count._all, minutes: rows._sum.requestedMinutes ?? 0 };
}

export function emptySummary(staffId: number): StaffSummary {
  return {
    staffId,
    scheduledDays: 0,
    presentDays: 0,
    lateDays: 0,
    absentDays: 0,
    leaveDays: 0,
    restDays: 0,
    holidayDays: 0,
    incompleteDays: 0,
    workedMinutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    openExceptions: 0,
  };
}

/**
 * Day counts and minute totals per person.
 *
 * Grouped in the database rather than in JavaScript: at five thousand staff over a
 * month that is 150,000 rows, and pulling them into the process to reduce them is how
 * a month-end report becomes a memory incident.
 */
export async function summarise(staffIds: number[], period: Period): Promise<StaffSummary[]> {
  if (staffIds.length === 0) return [];
  const prisma = db();

  const where = {
    staffId: { in: staffIds },
    workDate: { gte: period.from, lte: period.to },
  };

  const [byStatus, totals, exceptions] = await Promise.all([
    prisma.attendanceRecord.groupBy({
      by: ['staffId', 'status'],
      where,
      _count: { _all: true },
    }),
    prisma.attendanceRecord.groupBy({
      by: ['staffId'],
      where,
      _sum: {
        workedMinutes: true,
        lateMinutes: true,
        earlyLeaveMinutes: true,
        overtimeMinutes: true,
      },
    }),
    prisma.attendanceException.groupBy({
      by: ['staffId'],
      where: {
        staffId: { in: staffIds },
        resolvedAt: null,
        workDate: { gte: period.from, lte: period.to },
      },
      _count: { _all: true },
    }),
  ]);

  const result = new Map<number, StaffSummary>(
    staffIds.map((id) => [id, emptySummary(id)]),
  );

  for (const row of byStatus) {
    const summary = result.get(row.staffId);
    if (!summary) continue;
    const count = row._count._all;

    // `scheduledDays` counts days the person was expected to work, which excludes
    // rest days and holidays. Payroll needs the denominator, not just the numerator.
    switch (row.status) {
      case 'on_time':
        summary.presentDays += count;
        summary.scheduledDays += count;
        break;
      case 'late':
        summary.presentDays += count;
        summary.lateDays += count;
        summary.scheduledDays += count;
        break;
      case 'early_leave':
        summary.presentDays += count;
        summary.scheduledDays += count;
        break;
      case 'incomplete':
        summary.presentDays += count;
        summary.incompleteDays += count;
        summary.scheduledDays += count;
        break;
      case 'absent':
        summary.absentDays += count;
        summary.scheduledDays += count;
        break;
      case 'on_leave':
        summary.leaveDays += count;
        break;
      case 'rest_day':
        summary.restDays += count;
        break;
      case 'holiday':
        summary.holidayDays += count;
        break;
      default:
        break;
    }
  }

  for (const row of totals) {
    const summary = result.get(row.staffId);
    if (!summary) continue;
    summary.workedMinutes = row._sum.workedMinutes ?? 0;
    summary.lateMinutes = row._sum.lateMinutes ?? 0;
    summary.earlyLeaveMinutes = row._sum.earlyLeaveMinutes ?? 0;
    summary.overtimeMinutes = row._sum.overtimeMinutes ?? 0;
  }

  for (const row of exceptions) {
    if (row.staffId === null) continue;
    const summary = result.get(row.staffId);
    if (summary) summary.openExceptions = row._count._all;
  }

  return [...result.values()];
}

