import { AttendanceStatus, ExceptionKind } from '@attendance/shared';

import { db } from '../db.js';
import { loadEnv } from '../env.js';
import { logger } from '../logger.js';
import {
  addDateOnlyDays,
  addMinutes,
  asDateOnly,
  dateOnlyKey,
  eachDateOnly,
  formatZonedTime,
  minutesBetween,
  timeOnDateOnly,
  zonedDateOnly,
} from '../time.js';

export interface RecomputeSummary {
  staffProcessed: number;
  recordsWritten: number;
  exceptionsRaised: number;
}

interface ScheduledBlock {
  order: number;
  start: Date;
  end: Date;
  breakMinutes: number;
  graceBefore: number;
  graceAfter: number;
}

/**
 * Rebuilds attendance for a date range from stored punches.
 *
 * Raw events are immutable precisely so this can be re-run: after a terminal
 * clock is corrected, after a shift rule changes, or after an identity mapping is
 * fixed. Records are replaced in place; nothing derived is authoritative.
 *
 * All day boundaries come from the organisation timezone, never the server's.
 *
 * `from` and `to` are calendar dates, not instants: they are compared against
 * `@db.Date` columns and iterated as days.
 */
export async function recomputeRange(
  from: Date,
  to: Date,
  staffIds?: number[],
): Promise<RecomputeSummary> {
  const prisma = db();
  const timeZone = loadEnv().ORG_TIMEZONE;

  const summary: RecomputeSummary = {
    staffProcessed: 0,
    recordsWritten: 0,
    exceptionsRaised: 0,
  };

  const staff = await prisma.staff.findMany({
    where: {
      active: true,
      ...(staffIds && staffIds.length > 0 ? { id: { in: staffIds } } : {}),
    },
    select: { id: true },
  });

  const rangeStart = asDateOnly(from);
  const rangeEnd = asDateOnly(to);

  /**
   * Clears the exceptions this engine previously derived for the range.
   *
   * Without this every run appends another copy, so the review queue fills with
   * duplicates of the same finding and the count stops meaning anything.
   *
   * Scoped to the kinds the engine itself produces. Exceptions raised during
   * ingest - an unrecognised face, an unmapped identifier - describe what the
   * terminal reported and are not ours to re-derive. Resolved rows are also kept,
   * because a note somebody wrote is a record of a decision.
   */
  await prisma.attendanceException.deleteMany({
    where: {
      resolvedAt: null,
      kind: {
        in: [
          ExceptionKind.missingCheckOut,
          ExceptionKind.missingCheckIn,
          ExceptionKind.outsideRoster,
        ],
      },
      workDate: { gte: rangeStart, lte: rangeEnd },
      ...(staffIds && staffIds.length > 0 ? { staffId: { in: staffIds } } : {}),
    },
  });

  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: rangeStart, lte: rangeEnd } },
    select: { date: true },
  });
  const holidayKeys = new Set(holidays.map((holiday) => dateOnlyKey(holiday.date)));

  /**
   * Never computes past today.
   *
   * A day that has not happened yet cannot be an absence. Writing one inflates
   * every absence report and, worse, looks authoritative. A generous end date is
   * a normal thing for an operator to enter, so the guard belongs here rather
   * than in the request validation.
   */
  const today = zonedDateOnly(new Date(), timeZone);
  const effectiveEnd = rangeEnd > today ? today : rangeEnd;

  for (const person of staff) {
    summary.staffProcessed += 1;

    for (const day of eachDateOnly(rangeStart, effectiveEnd)) {
      const result = await recomputeDay(person.id, day, holidayKeys.has(dateOnlyKey(day)));
      if (result.written) summary.recordsWritten += 1;
      summary.exceptionsRaised += result.exceptions;
    }
  }

  logger().info({ ...summary, timeZone }, 'Attendance recompute finished');
  return summary;
}

/** Rebuilds one staff member's record for one local work date, given as a date-only. */
export async function recomputeDay(
  staffId: number,
  workDate: Date,
  isHoliday = false,
): Promise<{ written: boolean; exceptions: number }> {
  const prisma = db();
  const timeZone = loadEnv().ORG_TIMEZONE;
  const day = asDateOnly(workDate);
  let exceptions = 0;

  const roster = await prisma.rosterEntry.findUnique({
    where: { staffId_workDate: { staffId, workDate: day } },
    include: { shift: { include: { workPattern: { include: { timeBlocks: true } } } } },
  });

  if (roster?.entryType === 'leave') {
    await writeRecord(staffId, day, AttendanceStatus.onLeave, null, []);
    return { written: true, exceptions };
  }
  if (roster?.entryType === 'rest') {
    await writeRecord(staffId, day, AttendanceStatus.restDay, null, []);
    return { written: true, exceptions };
  }

  // Falls back to the staff member's default pattern when the day is not
  // explicitly rostered, which is the normal case for office staff.
  let pattern = roster?.shift?.workPattern ?? null;
  if (!pattern) {
    const person = await prisma.staff.findUnique({
      where: { id: staffId },
      select: { workPattern: { include: { timeBlocks: true } } },
    });
    pattern = person?.workPattern ?? null;
  }

  const blocks = buildBlocks(day, pattern?.timeBlocks ?? [], timeZone);

  /**
   * Punch collection deliberately reaches past local midnight.
   *
   * A shift starting 22:00 clocks out on the following calendar day. Clipping at
   * midnight would record every night worker as having never left.
   */
  const firstBlock = blocks[0];
  const lastBlock = blocks.at(-1);
  // `day` is a calendar date, so the fallback window has to be resolved back into
  // instants: local midnight to local midnight, not the UTC day.
  const localMidnight = timeOnDateOnly(day, '00:00', timeZone);
  const searchStart = firstBlock ? addMinutes(firstBlock.start, -firstBlock.graceBefore) : localMidnight;
  const searchEnd = lastBlock
    ? addMinutes(lastBlock.end, lastBlock.graceAfter)
    : timeOnDateOnly(addDateOnlyDays(day, 1), '00:00', timeZone);

  const punches = await prisma.punch.findMany({
    where: {
      staffId,
      suppressed: false,
      punchAt: { gte: searchStart, lte: searchEnd },
    },
    orderBy: { punchAt: 'asc' },
    select: { id: true, punchAt: true },
  });

  if (blocks.length === 0) {
    if (punches.length === 0) return { written: false, exceptions };

    const firstPunch = punches[0]!;
    const lastPunch = punches.at(-1)!;

    // Somebody scanned on a day with no schedule. Recorded rather than dropped:
    // it is usually a missing roster entry, not a phantom scan.
    await prisma.attendanceException.create({
      data: {
        kind: ExceptionKind.outsideRoster,
        staffId,
        occurredAt: firstPunch.punchAt,
        workDate: day,
        detail: 'Scan diterima tetapi tiada shift atau pola kerja untuk hari ini',
      },
    });
    exceptions += 1;

    await writeRecord(staffId, day, AttendanceStatus.incomplete, null, [
      {
        blockOrder: 1,
        scheduledStart: null,
        scheduledEnd: null,
        checkInAt: firstPunch.punchAt,
        checkOutAt: punches.length > 1 ? lastPunch.punchAt : null,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        overtimeMinutes: 0,
        workedMinutes:
          punches.length > 1 ? minutesBetween(firstPunch.punchAt, lastPunch.punchAt) : 0,
      },
    ]);
    return { written: true, exceptions };
  }

  if (isHoliday && punches.length === 0) {
    await writeRecord(staffId, day, AttendanceStatus.holiday, roster?.shiftId ?? null, []);
    return { written: true, exceptions };
  }

  const available = [...punches];
  const blockRows: BlockRow[] = [];
  let anyAttendance = false;
  let late = 0;
  let earlyLeave = 0;
  let overtime = 0;
  let worked = 0;

  for (const block of blocks) {
    const windowStart = addMinutes(block.start, -block.graceBefore);
    const windowEnd = addMinutes(block.end, block.graceAfter);

    const inIndex = available.findIndex(
      (punch) => punch.punchAt >= windowStart && punch.punchAt <= windowEnd,
    );
    const checkIn = inIndex === -1 ? null : available[inIndex]!.punchAt;
    if (inIndex !== -1) available.splice(0, inIndex + 1);

    // The last punch still inside the window becomes the exit, so a mid-shift
    // scan at another door does not end the block early.
    let checkOut: Date | null = null;
    if (checkIn) {
      let lastIndex = -1;
      for (let index = 0; index < available.length; index += 1) {
        const candidate = available[index]!;
        if (candidate.punchAt > windowEnd) break;
        if (candidate.punchAt > checkIn) lastIndex = index;
      }
      if (lastIndex !== -1) {
        checkOut = available[lastIndex]!.punchAt;
        available.splice(0, lastIndex + 1);
      }
    }

    if (checkIn) anyAttendance = true;

    const blockLate = checkIn && checkIn > block.start ? minutesBetween(block.start, checkIn) : 0;
    const blockEarly = checkOut && checkOut < block.end ? minutesBetween(checkOut, block.end) : 0;
    const blockOvertime = checkOut && checkOut > block.end ? minutesBetween(block.end, checkOut) : 0;
    const blockWorked =
      checkIn && checkOut ? Math.max(0, minutesBetween(checkIn, checkOut) - block.breakMinutes) : 0;

    late += blockLate;
    earlyLeave += blockEarly;
    overtime += blockOvertime;
    worked += blockWorked;

    blockRows.push({
      blockOrder: block.order,
      scheduledStart: block.start,
      scheduledEnd: block.end,
      checkInAt: checkIn,
      checkOutAt: checkOut,
      lateMinutes: blockLate,
      earlyLeaveMinutes: blockEarly,
      overtimeMinutes: blockOvertime,
      workedMinutes: blockWorked,
    });

    if (checkIn && !checkOut) {
      await prisma.attendanceException.create({
        data: {
          kind: ExceptionKind.missingCheckOut,
          staffId,
          occurredAt: checkIn,
          workDate: day,
          detail: `Blok ${block.order}: scan masuk ${formatZonedTime(checkIn, timeZone)} tanpa scan keluar`,
        },
      });
      exceptions += 1;
    }
  }

  let status: string;
  if (!anyAttendance) {
    status = isHoliday ? AttendanceStatus.holiday : AttendanceStatus.absent;
  } else if (blockRows.some((row) => row.checkInAt && !row.checkOutAt)) {
    status = AttendanceStatus.incomplete;
  } else if (late > 0) {
    status = AttendanceStatus.late;
  } else if (earlyLeave > 0) {
    status = AttendanceStatus.earlyLeave;
  } else {
    status = AttendanceStatus.onTime;
  }

  await writeRecord(staffId, day, status, roster?.shiftId ?? null, blockRows, {
    lateMinutes: late,
    earlyLeaveMinutes: earlyLeave,
    overtimeMinutes: overtime,
    workedMinutes: worked,
  });

  return { written: true, exceptions };
}

interface BlockRow {
  blockOrder: number;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  workedMinutes: number;
}

async function writeRecord(
  staffId: number,
  workDate: Date,
  status: string,
  shiftId: number | null,
  blocks: BlockRow[],
  totals?: {
    lateMinutes: number;
    earlyLeaveMinutes: number;
    overtimeMinutes: number;
    workedMinutes: number;
  },
): Promise<void> {
  const prisma = db();
  const first = blocks[0];
  const last = blocks.at(-1);

  const data = {
    shiftId,
    status,
    scheduledStart: first?.scheduledStart ?? null,
    scheduledEnd: last?.scheduledEnd ?? null,
    checkInAt: blocks.find((block) => block.checkInAt)?.checkInAt ?? null,
    checkOutAt: [...blocks].reverse().find((block) => block.checkOutAt)?.checkOutAt ?? null,
    lateMinutes: totals?.lateMinutes ?? 0,
    earlyLeaveMinutes: totals?.earlyLeaveMinutes ?? 0,
    overtimeMinutes: totals?.overtimeMinutes ?? 0,
    workedMinutes: totals?.workedMinutes ?? 0,
    origin: 'auto',
    calculatedAt: new Date(),
  };

  const record = await prisma.attendanceRecord.upsert({
    where: { staffId_workDate: { staffId, workDate } },
    create: { staffId, workDate, ...data },
    update: data,
    select: { id: true },
  });

  // Blocks are replaced wholesale. Merging them would leave rows behind when a
  // pattern loses a block, which then shows up as phantom worked hours.
  await prisma.attendanceBlock.deleteMany({ where: { recordId: record.id } });
  if (blocks.length > 0) {
    await prisma.attendanceBlock.createMany({
      data: blocks.map((block) => ({
        recordId: record.id,
        blockOrder: block.blockOrder,
        scheduledStart: block.scheduledStart,
        scheduledEnd: block.scheduledEnd,
        checkInAt: block.checkInAt,
        checkOutAt: block.checkOutAt,
        lateMinutes: block.lateMinutes,
        earlyLeaveMinutes: block.earlyLeaveMinutes,
        overtimeMinutes: block.overtimeMinutes,
        workedMinutes: block.workedMinutes,
      })),
    });
  }
}

/**
 * Turns `HH:mm` definitions into absolute instants for one local work date.
 *
 * Wall-clock times are resolved in the organisation timezone, so 08:00 means
 * 08:00 where the staff actually are regardless of where the server runs. `day` is a
 * calendar date; this is where the calendar domain turns back into instants.
 */
function buildBlocks(
  day: Date,
  timeBlocks: Array<{
    blockOrder: number;
    startTime: string;
    endTime: string;
    endsNextDay: boolean;
    breakMinutes: number;
    graceBeforeMinutes: number;
    graceAfterMinutes: number;
  }>,
  timeZone: string,
): ScheduledBlock[] {
  return [...timeBlocks]
    .sort((a, b) => a.blockOrder - b.blockOrder)
    .map((block) => {
      const start = timeOnDateOnly(day, block.startTime, timeZone);
      let end = timeOnDateOnly(day, block.endTime, timeZone);

      // `endsNextDay` is authoritative, but an end that is not after its start can
      // only cross midnight, so this also repairs bad configuration.
      if (block.endsNextDay || end <= start) {
        // Resolved against the next calendar day rather than by adding 24 hours, so
        // a DST transition does not shift the shift end by an hour.
        end = timeOnDateOnly(addDateOnlyDays(day, 1), block.endTime, timeZone);
      }

      return {
        order: block.blockOrder,
        start,
        end,
        breakMinutes: block.breakMinutes,
        graceBefore: block.graceBeforeMinutes,
        graceAfter: block.graceAfterMinutes,
      };
    });
}
