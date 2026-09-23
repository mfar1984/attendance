import type { Device } from '@prisma/client';
import {
  PunchDirection,
  PunchSource,
  RawEventKind,
  VerifyMethod,
} from '@attendance/shared';

import { db } from '../db.js';
import type { TerminalPerson } from '@attendance/terminal-drivers';
import { driverFor } from '../devices/registry.js';
import { conflict, notFound } from '../http.js';
import { logger } from '../logger.js';

/**
 * Translates a terminal's local identifier into one of our staff records.
 *
 * The terminal performs biometric matching itself and reports only its own
 * `employeeNo`. We never receive a face, so this lookup is the entire link
 * between a scan and a person.
 *
 * Only explicit mappings are consulted. Deliberately absent:
 *
 *  - Matching on name. Two staff can share a name in an organisation this size,
 *    and the terminal's name field is editable at the keypad. A wrong match here
 *    credits one person's attendance to another and raises no error.
 *  - Falling back to a global `staff.employeeNo` match. A terminal's local id
 *    such as 680 can legitimately collide with a different person's staff
 *    number, and inventing a mapping mid-scan would make that collision
 *    permanent and invisible.
 *
 * An unmapped identifier is recorded and surfaced for review instead.
 */
export async function resolveStaffId(
  deviceId: number,
  deviceEmployeeNo: string,
): Promise<number | null> {
  const mapping = await db().deviceEnrolment.findUnique({
    where: { deviceId_deviceEmployeeNo: { deviceId, deviceEmployeeNo } },
    select: { staffId: true },
  });

  return mapping?.staffId ?? null;
}

/**
 * Notes an identifier that has no mapping, counting how often it is seen.
 *
 * A rising count is the signal that somebody is scanning daily while their
 * attendance goes nowhere, which is the failure this table is meant to make
 * obvious.
 */
export async function recordUnmapped(
  deviceId: number,
  deviceEmployeeNo: string,
  deviceName: string | null,
  seenAt: Date,
): Promise<void> {
  await db().unmappedDeviceUser.upsert({
    where: { deviceId_deviceEmployeeNo: { deviceId, deviceEmployeeNo } },
    create: {
      deviceId,
      deviceEmployeeNo,
      deviceName,
      scanCount: 1,
      lastSeenAt: seenAt,
    },
    update: {
      scanCount: { increment: 1 },
      lastSeenAt: seenAt,
      // Refreshed because the name may have been filled in at the terminal since
      // the identifier was first seen.
      ...(deviceName !== null ? { deviceName } : {}),
    },
  });
}

export interface ImportSummary {
  deviceId: number;
  deviceUsers: number;
  /** Identifiers that exactly equal an unmapped staff number. */
  autoMapped: number;
  alreadyMapped: number;
  /** Left for a human to pair up. */
  needsReview: number;
}

/**
 * Reads the roster off a terminal and builds mappings from it.
 *
 * Used when adopting a terminal that was already populated by another tool or by
 * hand. An identifier that exactly equals an unclaimed staff number is paired
 * automatically but left `confirmed: false`, because an exact numeric match is
 * strong evidence and not proof. Everything else is queued for review.
 */
export async function importDeviceUsers(device: Device): Promise<ImportSummary> {
  const prisma = db();
  const summary: ImportSummary = {
    deviceId: device.id,
    deviceUsers: 0,
    autoMapped: 0,
    alreadyMapped: 0,
    needsReview: 0,
  };

  for await (const person of driverFor(device).people.list()) {
    summary.deviceUsers += 1;

    const existing = await prisma.deviceEnrolment.findUnique({
      where: {
        deviceId_deviceEmployeeNo: {
          deviceId: device.id,
          deviceEmployeeNo: person.employeeNo,
        },
      },
      select: { id: true, staffId: true },
    });

    if (existing) {
      await prisma.deviceEnrolment.update({
        where: { id: existing.id },
        data: { syncedAt: new Date() },
      });
      // Credential counts are mirrored so the directory can show who is enrolled
      // on paper but unable to scan.
      await mirrorCredentialCounts(existing.staffId, person.credentials);
      summary.alreadyMapped += 1;
      continue;
    }

    const candidate = await prisma.staff.findUnique({
      where: { employeeNo: person.employeeNo },
      select: { id: true },
    });

    // Only pair when that staff member has no other identity on this terminal,
    // otherwise the same person would end up with two device identities and
    // their day would be split across both.
    const candidateFree =
      candidate !== null &&
      (await prisma.deviceEnrolment.count({
        where: { deviceId: device.id, staffId: candidate.id },
      })) === 0;

    if (candidate && candidateFree) {
      await prisma.deviceEnrolment.create({
        data: {
          deviceId: device.id,
          staffId: candidate.id,
          deviceEmployeeNo: person.employeeNo,
          confirmed: false,
          syncedAt: new Date(),
          faceEnrolledAt: (person.credentials.faces ?? 0) > 0 ? new Date() : null,
        },
      });
      await mirrorCredentialCounts(candidate.id, person.credentials);
      summary.autoMapped += 1;
      continue;
    }

    await prisma.unmappedDeviceUser.upsert({
      where: {
        deviceId_deviceEmployeeNo: {
          deviceId: device.id,
          deviceEmployeeNo: person.employeeNo,
        },
      },
      create: {
        deviceId: device.id,
        deviceEmployeeNo: person.employeeNo,
        deviceName: person.name,
        numOfFace: person.credentials.faces ?? 0,
        numOfFp: person.credentials.fingerprints ?? 0,
        numOfCard: person.credentials.cards ?? 0,
      },
      update: {
        deviceName: person.name,
        numOfFace: person.credentials.faces ?? 0,
        numOfFp: person.credentials.fingerprints ?? 0,
        numOfCard: person.credentials.cards ?? 0,
      },
    });
    summary.needsReview += 1;
  }

  logger().info(summary, 'Imported device roster');
  return summary;
}

/** Pairs a terminal identifier with a staff record, confirmed by a person. */
export async function mapDeviceUser(input: {
  deviceId: number;
  deviceEmployeeNo: string;
  staffId: number;
  confirmedBy: number;
}): Promise<{ enrolmentId: number; backfilled: number }> {
  const prisma = db();

  const staff = await prisma.staff.findUnique({
    where: { id: input.staffId },
    select: { id: true },
  });
  if (!staff) throw notFound('Staf tidak dijumpai');

  const clash = await prisma.deviceEnrolment.findUnique({
    where: { deviceId_staffId: { deviceId: input.deviceId, staffId: input.staffId } },
    select: { deviceEmployeeNo: true },
  });
  if (clash && clash.deviceEmployeeNo !== input.deviceEmployeeNo) {
    throw conflict(
      `Staf ini sudah dipetakan ke ID "${clash.deviceEmployeeNo}" pada terminal ini. ` +
        'Buang pemetaan lama dahulu supaya kehadiran tidak terbelah antara dua ID.',
    );
  }

  const enrolment = await prisma.deviceEnrolment.upsert({
    where: {
      deviceId_deviceEmployeeNo: {
        deviceId: input.deviceId,
        deviceEmployeeNo: input.deviceEmployeeNo,
      },
    },
    create: {
      deviceId: input.deviceId,
      staffId: input.staffId,
      deviceEmployeeNo: input.deviceEmployeeNo,
      confirmed: true,
      confirmedAt: new Date(),
      confirmedBy: input.confirmedBy,
    },
    update: {
      staffId: input.staffId,
      confirmed: true,
      confirmedAt: new Date(),
      confirmedBy: input.confirmedBy,
    },
    select: { id: true },
  });

  const backfilled = await backfillPunches(input.deviceId, input.deviceEmployeeNo, input.staffId);

  await prisma.unmappedDeviceUser.deleteMany({
    where: { deviceId: input.deviceId, deviceEmployeeNo: input.deviceEmployeeNo },
  });

  return { enrolmentId: enrolment.id, backfilled };
}

/**
 * Creates punches for scans that arrived before the mapping existed.
 *
 * Those scans were stored in the raw log and skipped for attendance, so the
 * history is recoverable. Without this, resolving a mapping would fix tomorrow
 * and leave the previous weeks permanently missing.
 *
 * Direction is left unresolved and dedup is not applied here; a recompute over
 * the affected range settles both.
 */
async function backfillPunches(
  deviceId: number,
  deviceEmployeeNo: string,
  staffId: number,
): Promise<number> {
  const prisma = db();

  const orphaned = await prisma.rawEvent.findMany({
    where: {
      deviceId,
      employeeNo: deviceEmployeeNo,
      punch: null,
      /**
       * Identified authentications only, read from the driver's verdict.
       *
       * This was `major: 5, minor: { in: [38, 75, 113] }` — Hikvision's own event codes,
       * written as bare literals with no constant name anywhere to grep for. On a ZKTeco
       * terminal it matched nothing, so confirming a mapping would silently recover no
       * punches at all and the operator would see the exceptions stay open.
       */
      eventKind: RawEventKind.identified,
    },
    select: { id: true, eventTime: true, verifyMethod: true },
    /**
     * Ordered by instant rather than by sequence number.
     *
     * A protocol without a sequence stores null there, and nulls sort first ascending —
     * which would have put every ZKTeco event before the whole Hikvision history
     * regardless of when it happened.
     */
    orderBy: [{ eventTime: 'asc' }, { id: 'asc' }],
  });

  if (orphaned.length === 0) return 0;

  await prisma.punch.createMany({
    data: orphaned.map((event) => ({
      staffId,
      deviceId,
      rawEventId: event.id,
      punchAt: event.eventTime,
      source: PunchSource.terminal,
      // Stored on the raw event by the driver that decoded it, so no event code is
      // reinterpreted here. The old expression fell through to `card` for anything it
      // did not recognise, which labelled unknown credentials as card reads.
      method: event.verifyMethod ?? VerifyMethod.unknown,
      direction: PunchDirection.unknown,
      note: 'Dijana semula selepas pemetaan ID terminal disahkan',
    })),
  });

  // The exceptions that were raised for these scans are now answered.
  await prisma.attendanceException.updateMany({
    where: {
      deviceId,
      kind: 'unknown_employee',
      resolvedAt: null,
      rawEventId: { in: orphaned.map((event) => event.id) },
    },
    data: {
      resolvedAt: new Date(),
      resolutionNote: `Dipetakan ke staf #${staffId}`,
    },
  });

  return orphaned.length;
}

async function mirrorCredentialCounts(
  staffId: number,
  credentials: TerminalPerson['credentials'],
): Promise<void> {
  await db().staff.update({
    where: { id: staffId },
    data: {
      numOfFace: credentials.faces ?? 0,
      numOfFp: credentials.fingerprints ?? 0,
      numOfCard: credentials.cards ?? 0,
    },
  });
}
