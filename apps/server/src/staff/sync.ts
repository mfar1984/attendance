import { DEVICE_LIMITS } from '@attendance/shared';
import type { Device, Staff } from '@prisma/client';

import { decryptSecret } from '../crypto.js';
import { db } from '../db.js';
import { driverFor } from '../devices/registry.js';
import { conflict } from '../http.js';
import { logger } from '../logger.js';

export interface DeviceSyncOutcome {
  deviceId: number;
  deviceName: string;
  deviceEmployeeNo: string;
  ok: boolean;
  /**
   * Accepted by the driver, but not yet confirmed by the terminal.
   *
   * A third state, and the screen has to show it. On a callback protocol the command is
   * durably queued and the unit collects it when it next polls — so `ok` means "recorded",
   * not "the terminal has it". Reporting that as plainly done is how an operator is told
   * somebody can clock in tomorrow morning when they cannot.
   */
  pending?: boolean;
  error?: string;
}

/**
 * Writes a staff member onto the terminals they are assigned to.
 *
 * The identifier pushed to the device is `staff.employeeNo`, and the resulting
 * mapping is recorded as confirmed. That is the whole reason enrolments we perform
 * ourselves need no review: we chose the number on both sides, so there is nothing
 * to guess. Terminals populated by someone else still go through the review queue.
 *
 * Failures are collected rather than thrown. One unreachable terminal must not
 * prevent a staff member from being created, or from being pushed to the other
 * doors that are working.
 */
export async function pushStaffToDevices(
  staff: Staff,
  deviceIds: number[],
): Promise<DeviceSyncOutcome[]> {
  const prisma = db();
  const outcomes: DeviceSyncOutcome[] = [];

  if (deviceIds.length === 0) return outcomes;

  const devices = await prisma.device.findMany({
    where: { id: { in: deviceIds }, active: true },
  });

  for (const device of devices) {
    /**
     * The identifier this person already carries on this terminal, if any.
     *
     * This lookup is the whole correctness of the function. `staff.employeeNo` is only the
     * right number on terminals we populated ourselves; on a unit adopted from another tool
     * or filled in at the keypad the person carries something else, and that mapping is
     * already recorded. Writing the canonical number instead created a *second* device user
     * for one person and then failed on `@@unique([deviceId, staffId])` — after the device
     * write had already landed, so the terminal kept a credential-less ghost.
     */
    const existing = await prisma.deviceEnrolment.findUnique({
      where: { deviceId_staffId: { deviceId: device.id, staffId: staff.id } },
      select: { deviceEmployeeNo: true },
    });
    const deviceEmployeeNo = existing?.deviceEmployeeNo ?? staff.employeeNo;

    const outcome: DeviceSyncOutcome = {
      deviceId: device.id,
      deviceName: device.name,
      deviceEmployeeNo,
      ok: false,
    };

    try {
      await assertCapacity(device, staff.id);
      // Only for a first enrolment. An existing mapping is this person's own number by
      // definition, so there is nothing to collide with.
      if (existing === null) await assertIdentifierFree(device, staff, deviceEmployeeNo);

      const ack = await driverFor(device).people.upsert({
        employeeNo: deviceEmployeeNo,
        name: staff.fullName,
        ...(staff.validFrom ? { validFrom: staff.validFrom } : {}),
        ...(staff.validTo ? { validTo: staff.validTo } : {}),
        ...(staff.doorPinEncrypted ? { pin: decryptSecret(staff.doorPinEncrypted) } : {}),
        doorNo: device.doorNo,
      });

      await prisma.deviceEnrolment.upsert({
        where: {
          deviceId_deviceEmployeeNo: { deviceId: device.id, deviceEmployeeNo },
        },
        create: {
          deviceId: device.id,
          staffId: staff.id,
          deviceEmployeeNo,
          // Confirmed because we chose this identifier on both sides.
          confirmed: true,
          confirmedAt: new Date(),
          /**
           * Only stamped once the terminal has the person.
           *
           * Left null for a queued write, which is what makes "not on the device yet"
           * distinguishable from "on the device". Before this, the existence of the enrolment
           * row *was* the record of a successful push, so a queued command would have left a
           * row asserting something that had not happened.
           */
          ...(ack.confirmed ? { syncedAt: new Date() } : {}),
        },
        // `staffId` is written, not just the timestamps. Without it a row could stay
        // pointing at whoever held this identifier before, while the terminal now carries
        // somebody else's name — which credits one person's attendance to another.
        update: {
          staffId: staff.id,
          ...(ack.confirmed ? { syncedAt: new Date() } : {}),
          lastError: null,
        },
      });

      outcome.ok = true;
      outcome.pending = !ack.confirmed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcome.error = message;
      logger().warn(
        { deviceId: device.id, employeeNo: deviceEmployeeNo, err: message },
        'Failed to push staff to terminal',
      );

      // Recorded on the enrolment so a retry can target exactly what failed
      // instead of re-pushing the whole roster.
      await prisma.deviceEnrolment
        .update({
          where: {
            deviceId_deviceEmployeeNo: { deviceId: device.id, deviceEmployeeNo },
          },
          data: { lastError: message.slice(0, 500) },
        })
        .catch(() => undefined);
    }

    outcomes.push(outcome);
  }

  return outcomes;
}

/**
 * Refuses to write an identifier that already belongs to somebody else on this terminal.
 *
 * Checked **before** any ISAPI call, because the device write is what cannot be undone: the
 * firmware answers `deviceUserAlreadyExist` and the client falls back to a modify, which
 * renames the existing record. The face template stays attached to it, so the terminal ends
 * up matching one person's face and reporting another person's name.
 *
 * An unmapped identifier counts as taken. It belongs to somebody the review queue has not
 * paired yet, and overwriting it destroys the only clue about who that is.
 */
async function assertIdentifierFree(
  device: Device,
  staff: Staff,
  deviceEmployeeNo: string,
): Promise<void> {
  const prisma = db();

  // Compared on `staffId`, not `employeeNo`. The row identity is what matters here, and
  // leaning on the global uniqueness of the staff number to infer it is a longer way round
  // that breaks the day that uniqueness is relaxed.
  const heldBy = await prisma.deviceEnrolment.findUnique({
    where: { deviceId_deviceEmployeeNo: { deviceId: device.id, deviceEmployeeNo } },
    select: { staffId: true, staff: { select: { employeeNo: true, fullName: true } } },
  });
  if (heldBy && heldBy.staffId !== staff.id) {
    throw conflict(
      `ID "${deviceEmployeeNo}" pada terminal "${device.name}" sudah dipetakan kepada ` +
        `${heldBy.staff.fullName} (${heldBy.staff.employeeNo}). Selesaikan pemetaan itu ` +
        'dahulu di Staf › Pemetaan ID Terminal.',
    );
  }

  const unmapped = await prisma.unmappedDeviceUser.findUnique({
    where: { deviceId_deviceEmployeeNo: { deviceId: device.id, deviceEmployeeNo } },
    select: { deviceName: true },
  });
  if (unmapped) {
    throw conflict(
      `ID "${deviceEmployeeNo}" sudah wujud pada terminal "${device.name}"` +
        (unmapped.deviceName === null ? '' : ` sebagai "${unmapped.deviceName}"`) +
        ' dan belum dipetakan. Petakan atau tolak ID itu dahulu di Staf › Pemetaan ID Terminal.',
    );
  }
}

/**
 * Refuses an enrolment that the terminal cannot hold.
 *
 * Each unit stores a fixed number of faces. Without this check the ceiling is
 * discovered when a push fails with an opaque device error, by which point the
 * staff record already exists and looks enrolled.
 */
async function assertCapacity(device: Device, staffId: number): Promise<void> {
  const prisma = db();

  const alreadyOnDevice = await prisma.deviceEnrolment.findFirst({
    where: { deviceId: device.id, staffId },
    select: { id: true },
  });
  if (alreadyOnDevice) return;

  const enrolled = await prisma.deviceEnrolment.count({ where: { deviceId: device.id } });
  const capacity = device.faceCapacity > 0 ? device.faceCapacity : DEVICE_LIMITS.personCapacity;

  if (enrolled >= capacity) {
    throw conflict(
      `Terminal "${device.name}" sudah penuh (${enrolled}/${capacity}). ` +
        'Agihkan staf ini ke terminal lain.',
    );
  }
}

/**
 * Removes a staff member from the terminals they were on.
 *
 * The mapping rows go too, so a future scan from that identifier lands in the
 * review queue rather than resolving to somebody who no longer works here.
 * Punches already recorded are untouched: they happened.
 */
export async function removeStaffFromDevices(
  staff: Staff,
  deviceIds?: number[],
): Promise<DeviceSyncOutcome[]> {
  const prisma = db();

  /**
   * An empty list means "remove from nothing", not "remove from everything".
   *
   * Collapsing the two is how a narrowing filter turns into a full un-enrolment.
   * Only `undefined` means every terminal.
   */
  if (deviceIds !== undefined && deviceIds.length === 0) return [];

  const enrolments = await prisma.deviceEnrolment.findMany({
    where: {
      staffId: staff.id,
      ...(deviceIds === undefined ? {} : { deviceId: { in: deviceIds } }),
    },
    include: { device: true },
  });

  const outcomes: DeviceSyncOutcome[] = [];

  for (const enrolment of enrolments) {
    const outcome: DeviceSyncOutcome = {
      deviceId: enrolment.deviceId,
      deviceName: enrolment.device.name,
      deviceEmployeeNo: enrolment.deviceEmployeeNo,
      ok: false,
    };

    try {
      const ack = await driverFor(enrolment.device).people.remove([enrolment.deviceEmployeeNo]);
      outcome.ok = true;
      outcome.pending = !ack.confirmed;
    } catch (error) {
      // The mapping is still dropped. Leaving it while the person is gone from
      // our side is worse: a scan would resolve to a departed employee.
      outcome.error = error instanceof Error ? error.message : String(error);
    }

    await prisma.deviceEnrolment.delete({ where: { id: enrolment.id } });
    outcomes.push(outcome);
  }

  return outcomes;
}

/** Mirrors credential counts from every terminal a person is enrolled on. */
export async function refreshCredentialCounts(staffId: number): Promise<{
  numOfFace: number;
  numOfFp: number;
  numOfCard: number;
}> {
  const prisma = db();
  const enrolments = await prisma.deviceEnrolment.findMany({
    where: { staffId },
    include: { device: true },
  });

  let numOfFace = 0;
  let numOfFp = 0;
  let numOfCard = 0;

  for (const enrolment of enrolments) {
    try {
      const person = await driverFor(enrolment.device).people.find(enrolment.deviceEmployeeNo);
      if (!person) continue;
      // Highest across terminals: a person enrolled on three doors with a face on
      // one of them can still scan, so the maximum is the honest answer to "can
      // this person clock in".
      numOfFace = Math.max(numOfFace, person.credentials.faces ?? 0);
      numOfFp = Math.max(numOfFp, person.credentials.fingerprints ?? 0);
      numOfCard = Math.max(numOfCard, person.credentials.cards ?? 0);
    } catch {
      // An unreachable terminal leaves the previous counts in place rather than
      // reporting zero, which would falsely flag the person as unable to scan.
      return prisma.staff
        .findUniqueOrThrow({
          where: { id: staffId },
          select: { numOfFace: true, numOfFp: true, numOfCard: true },
        })
        .then((existing) => existing);
    }
  }

  await prisma.staff.update({
    where: { id: staffId },
    data: { numOfFace, numOfFp, numOfCard },
  });

  return { numOfFace, numOfFp, numOfCard };
}
