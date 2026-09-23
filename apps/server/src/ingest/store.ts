import {
  DEFAULT_DEDUP_WINDOW_SECONDS,
  ExceptionKind,
  PunchDirection,
  PunchSource,
  RawEventKind,
  VerifyMethod,
} from '@attendance/shared';
import type { Device } from '@prisma/client';

import { db } from '../db.js';
import type { TerminalEvent } from '@attendance/terminal-drivers';
import { loadEnv } from '../env.js';
import { liveBus } from '../events/bus.js';
import { recordUnmapped, resolveStaffId } from '../identity/resolve.js';
import { logger } from '../logger.js';
import { zonedDateOnly } from '../time.js';

export interface IngestOutcome {
  stored: number;
  /** Already present, so push and pull delivered the same event. */
  duplicates: number;
  punches: number;
  suppressed: number;
  exceptions: number;
}

const EMPTY: IngestOutcome = {
  stored: 0,
  duplicates: 0,
  punches: 0,
  suppressed: 0,
  exceptions: 0,
};

/**
 * Persists a batch of terminal events.
 *
 * The one meeting point for every vendor. Push and pull already had separate decoders
 * that converged here; multi-vendor support extends that to one decoder per protocol,
 * all producing `TerminalEvent`. Anything that can produce that shape inherits dedup,
 * punch derivation, identity mapping, exceptions and the live monitor without a line
 * changing below.
 *
 * Ordering matters: the raw event is written first and unconditionally, then a punch
 * is derived from it. If derivation logic is later found to be wrong, the raw rows are
 * still intact and attendance can be rebuilt from them.
 */
export async function storeEvents(
  device: Device,
  events: TerminalEvent[],
  arrivedVia: 'push' | 'pull',
): Promise<IngestOutcome> {
  if (events.length === 0) return { ...EMPTY };

  const outcome: IngestOutcome = { ...EMPTY };
  const prisma = db();

  /**
   * Ascending by instant, so the suppression window sees earlier scans before later
   * ones regardless of the order the device or the listener handed them over in.
   *
   * Ordered on time rather than on the sequence number, because a callback protocol
   * has no sequence at all. The sequence is only a tie-break, which keeps the
   * ordering identical to the previous behaviour for Hikvision batches where several
   * events can share a timestamp.
   */
  const ordered = [...events].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || (a.sequence ?? 0) - (b.sequence ?? 0),
  );

  for (const event of ordered) {
    const existing = await prisma.rawEvent.findUnique({
      where: { deviceId_eventKey: { deviceId: device.id, eventKey: event.eventKey } },
      select: { id: true },
    });

    if (existing) {
      outcome.duplicates += 1;
      continue;
    }

    const raw = await prisma.rawEvent.create({
      data: {
        deviceId: device.id,
        eventKey: event.eventKey,
        eventKind: event.kind,
        verifyMethod: event.verifyMethod,
        serialNo: event.sequence === null ? null : BigInt(event.sequence),
        major: event.native.major,
        minor: event.native.minor,
        eventTime: event.at,
        deviceDriftS: device.clockDriftS,
        employeeNo: event.employeeNo,
        personName: event.personName,
        cardNo: event.cardNo,
        verifyMode: event.native.verifyMode,
        doorNo: event.doorNo,
        cardReaderNo: event.readerNo,
        maskWorn: event.native.maskWorn,
        deviceDirection: event.native.direction,
        pictureUrl: event.pictureUrl,
        arrivedVia,
        payload: event.payload as object,
      },
      select: { id: true },
    });
    outcome.stored += 1;

    await derivePunch(device, event, raw.id, outcome);
  }

  return outcome;
}

/**
 * Turns a stored event into a punch, or into an exception when it cannot be.
 *
 * Branches on `event.kind`, which the driver decided. Nothing here knows that
 * Hikvision reports a matched face as major 5 / minor 75, or that ZKTeco reports a
 * verify type with no major at all — which is what makes a third vendor a new
 * directory rather than a change to this function.
 */
async function derivePunch(
  device: Device,
  event: TerminalEvent,
  rawEventId: bigint,
  outcome: IngestOutcome,
): Promise<void> {
  const prisma = db();

  // Door, tamper, hardware and operator events. Kept as evidence, never a punch.
  if (event.kind === RawEventKind.other) return;

  // An unrecognised face is a real signal, not noise: it may be a new joiner
  // whose face was never enrolled, or somebody who should not be there.
  if (event.kind === RawEventKind.unrecognised) {
    await prisma.attendanceException.create({
      data: {
        kind: ExceptionKind.unrecognisedFace,
        deviceId: device.id,
        rawEventId,
        occurredAt: event.at,
        workDate: startOfDay(event.at),
        detail: `Terminal "${device.name}" gagal mengenali muka`,
      },
    });
    outcome.exceptions += 1;

    // Surfaced on the live monitor too. An unrecognised face at the door is
    // something an operator may want to act on while the person is still there.
    publishScan({
      punchId: null,
      rawEventId,
      event,
      device,
      staffId: null,
      employeeNo: null,
      name: null,
      direction: PunchDirection.unknown,
      suppressed: false,
      problem: 'Muka tidak dikenali',
    });
    return;
  }

  /**
   * An identified event without an identifier cannot be mapped to anybody.
   *
   * The driver is expected to classify that as `other`, so this is a second line of
   * defence rather than the primary one. Left in because the alternative is a punch
   * credited to nobody, and a mapping lookup that fails with a message naming an
   * empty identifier.
   */
  if (!event.employeeNo) {
    logger().warn(
      { deviceId: device.id, eventKey: event.eventKey },
      'Driver reported an identified event with no employeeNo',
    );
    return;
  }

  /**
   * The identifier is local to this terminal, so it is resolved through the
   * per-device mapping rather than looked up globally. The same person routinely
   * carries a different `employeeNo` on each unit.
   */
  const staffId = await resolveStaffId(device.id, event.employeeNo);

  if (staffId === null) {
    // Queued for review instead of guessed at. The raw event is already stored,
    // so the scan is recoverable once somebody pairs the identifier.
    await recordUnmapped(device.id, event.employeeNo, event.personName, event.at);

    await prisma.attendanceException.create({
      data: {
        kind: ExceptionKind.unknownEmployee,
        deviceId: device.id,
        rawEventId,
        occurredAt: event.at,
        workDate: startOfDay(event.at),
        detail:
          `ID "${event.employeeNo}" pada terminal "${device.name}" belum dipetakan ke Direktori Staf` +
          (event.personName ? ` (nama di terminal: ${event.personName})` : ''),
      },
    });
    outcome.exceptions += 1;

    publishScan({
      punchId: null,
      rawEventId,
      event,
      device,
      staffId: null,
      employeeNo: event.employeeNo,
      name: event.personName,
      direction: PunchDirection.unknown,
      suppressed: false,
      problem: 'ID terminal belum dipetakan',
    });
    return;
  }

  /**
   * Suppression window.
   *
   * The terminal happily emits several scans for one person seconds apart - the
   * test unit produced three inside eleven seconds. Each would otherwise become a
   * punch and wreck the pairing. The extra scans are kept and flagged rather than
   * discarded, so this view and the raw log always agree.
   */
  const windowStart = new Date(event.at.getTime() - DEFAULT_DEDUP_WINDOW_SECONDS * 1000);
  const recent = await prisma.punch.findFirst({
    where: {
      staffId,
      suppressed: false,
      punchAt: { gte: windowStart, lte: event.at },
    },
    select: { id: true },
  });

  const suppressed = recent !== null;

  const punch = await prisma.punch.create({
    data: {
      staffId,
      deviceId: device.id,
      rawEventId,
      punchAt: event.at,
      source: PunchSource.terminal,
      method: event.verifyMethod ?? VerifyMethod.unknown,
      // Left unresolved unless the terminal itself reported it. Direction otherwise
      // depends on the roster and on the other punches in the day, which the engine
      // decides when it builds the record.
      direction: event.direction ?? PunchDirection.unknown,
      suppressed,
    },
  });

  if (suppressed) {
    outcome.suppressed += 1;
  } else {
    outcome.punches += 1;
  }

  const person = await prisma.staff.findUnique({
    where: { id: staffId },
    select: { employeeNo: true, fullName: true },
  });

  publishScan({
    punchId: punch.id,
    rawEventId,
    event,
    device,
    staffId,
    employeeNo: person?.employeeNo ?? event.employeeNo,
    name: person?.fullName ?? null,
    direction: punch.direction,
    suppressed,
    problem: null,
  });
}

/**
 * Announces a scan to any connected monitor.
 *
 * Broadcast after the write, never before, so the live view cannot show something
 * the database does not hold. Failures are swallowed: live monitoring is a
 * convenience, and an emitter problem must not roll back a stored punch.
 */
function publishScan(input: {
  punchId: number | null;
  rawEventId: bigint;
  event: TerminalEvent;
  device: Device;
  staffId: number | null;
  employeeNo: string | null | undefined;
  name: string | null;
  direction: string;
  suppressed: boolean;
  problem: string | null;
}): void {
  try {
    liveBus.emit('scan', {
      punchId: input.punchId,
      rawEventId: input.rawEventId.toString(),
      /**
       * The dedup key, not the sequence number.
       *
       * This is what the monitor keys its rows on, and a callback protocol has no
       * sequence — so keying on that would collapse every ZKTeco scan on one device
       * into a single row that keeps overwriting itself.
       */
      eventKey: input.event.eventKey,
      serialNo: input.event.sequence === null ? null : String(input.event.sequence),
      at: input.event.at.toISOString(),
      deviceId: input.device.id,
      deviceName: input.device.name,
      staffId: input.staffId,
      employeeNo: input.employeeNo ?? null,
      name: input.name,
      method: input.event.verifyMethod ?? VerifyMethod.unknown,
      direction: input.direction,
      suppressed: input.suppressed,
      problem: input.problem,
    });
  } catch (error) {
    logger().warn({ err: error }, 'Failed to broadcast a live scan');
  }
}

/**
 * Local work date for an instant.
 *
 * Resolved in the organisation timezone rather than the server's, so a scan just
 * after local midnight is filed against the right day even when the server runs
 * in UTC.
 */
function startOfDay(when: Date): Date {
  // A calendar date, because it is stored in a `@db.Date` column.
  return zonedDateOnly(when, loadEnv().ORG_TIMEZONE);
}
