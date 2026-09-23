import { assertUsableJpeg, readJpegDimensions } from '@attendance/hik-isapi';
import { DEVICE_LIMITS } from '@attendance/shared';
import type { Staff } from '@prisma/client';

import { db } from '../db.js';
import { DriverOperation, supports, unavailableReason } from '@attendance/terminal-drivers';
import { driverFor } from '../devices/registry.js';
import { badRequest, conflict } from '../http.js';
import { logger } from '../logger.js';

export interface FaceEnrolOutcome {
  deviceId: number;
  deviceName: string;
  ok: boolean;
  /**
   * Queued for the terminal, not yet confirmed by it.
   *
   * This is the field that matters most on this screen. A face is what a person scans with,
   * so a queued enrolment reported as done tells an operator somebody can clock in tomorrow
   * morning when they cannot — and nobody finds out until the person is standing at the door.
   */
  pending?: boolean;
  /** Set when the terminal cannot accept a pushed face at all and enrolment must happen on it. */
  mustEnrolAtTerminal?: boolean;
  error?: string;
}

/**
 * Enrols one face picture on every terminal a staff member is assigned to.
 *
 * The same picture goes to each unit because the terminals do not share a face
 * library; each one matches locally against its own copy. A person enrolled on
 * three doors therefore holds three independent face records.
 *
 * The person record must already exist on the device: the face is keyed by
 * `FPID`, which the firmware matches against `employeeNo`, and it rejects a face
 * for someone it does not know.
 */
export async function enrolFace(staff: Staff, jpeg: Buffer): Promise<FaceEnrolOutcome[]> {
  const prisma = db();

  // Validated once here rather than per device, so a bad image fails fast with a
  // message naming the actual constraint instead of an opaque device status.
  try {
    assertUsableJpeg(jpeg);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'Gambar tidak sah', 'face_image');
  }

  const enrolments = await prisma.deviceEnrolment.findMany({
    where: { staffId: staff.id },
    include: { device: true },
  });

  if (enrolments.length === 0) {
    throw conflict(
      'Staf ini belum diagihkan ke mana-mana terminal. Agihkan terminal dahulu sebelum ' +
        'mendaftarkan muka, kerana muka disimpan pada terminal itu sendiri.',
    );
  }

  const outcomes: FaceEnrolOutcome[] = [];

  for (const enrolment of enrolments) {
    const outcome: FaceEnrolOutcome = {
      deviceId: enrolment.deviceId,
      deviceName: enrolment.device.name,
      ok: false,
    };

    try {
      const driver = driverFor(enrolment.device);

      /**
       * A terminal that cannot be sent a face at all.
       *
       * Some units only enrol a face at the unit itself — the person has to stand in front of
       * it. That is a hardware property, not a missing feature here, and the screen has to say
       * so plainly. Silently succeeding would leave somebody unable to scan with nothing
       * anywhere explaining why.
       */
      if (!supports(driver.capabilities, DriverOperation.enrolFace)) {
        outcome.mustEnrolAtTerminal = true;
        outcome.error =
          unavailableReason(driver.capabilities, DriverOperation.enrolFace) ??
          `Terminal "${enrolment.device.name}" tidak menerima muka yang dihantar dari sistem. ` +
            'Muka mesti didaftarkan di terminal itu sendiri.';
        outcomes.push(outcome);
        continue;
      }

      const ack = await driver.biometrics.enrolFace(enrolment.deviceEmployeeNo, jpeg);

      await prisma.deviceEnrolment.update({
        where: { id: enrolment.id },
        data: {
          // Stamped only on confirmation, so a queued command does not leave a row asserting
          // the terminal holds a face it has not collected yet.
          ...(ack.confirmed ? { faceEnrolledAt: new Date() } : {}),
          lastError: null,
        },
      });

      outcome.ok = true;
      outcome.pending = !ack.confirmed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcome.error = message;
      logger().warn(
        { deviceId: enrolment.deviceId, employeeNo: enrolment.deviceEmployeeNo, err: message },
        'Face enrolment failed',
      );

      await prisma.deviceEnrolment
        .update({ where: { id: enrolment.id }, data: { lastError: message.slice(0, 500) } })
        .catch(() => undefined);
    }

    outcomes.push(outcome);
  }

  /**
   * Mirrored so the directory stops flagging this person as unable to scan.
   *
   * Requires a **confirmed** enrolment, not merely an accepted one. This flag is what the
   * directory reads to answer "can this person clock in", and a queued command that the
   * terminal never collects would leave the answer permanently wrong in the optimistic
   * direction. A later credential refresh moves it once the terminal really has the face.
   */
  if (outcomes.some((row) => row.ok && row.pending !== true)) {
    await prisma.staff.update({ where: { id: staff.id }, data: { numOfFace: 1 } });
  }

  return outcomes;
}

/** Removes the enrolled face from every terminal. */
export async function removeFace(staff: Staff): Promise<FaceEnrolOutcome[]> {
  const prisma = db();
  const enrolments = await prisma.deviceEnrolment.findMany({
    where: { staffId: staff.id },
    include: { device: true },
  });

  const outcomes: FaceEnrolOutcome[] = [];

  for (const enrolment of enrolments) {
    const outcome: FaceEnrolOutcome = {
      deviceId: enrolment.deviceId,
      deviceName: enrolment.device.name,
      ok: false,
    };

    try {
      const ack = await driverFor(enrolment.device).biometrics.removeFace(
        enrolment.deviceEmployeeNo,
      );
      await prisma.deviceEnrolment.update({
        where: { id: enrolment.id },
        data: { faceEnrolledAt: null },
      });
      outcome.ok = true;
      outcome.pending = !ack.confirmed;
    } catch (error) {
      outcome.error = error instanceof Error ? error.message : String(error);
    }

    outcomes.push(outcome);
  }

  await prisma.staff.update({ where: { id: staff.id }, data: { numOfFace: 0 } });
  return outcomes;
}

/** Fetches the enrolled face from the first terminal that has one. */
export async function readEnrolledFace(staffId: number): Promise<Buffer | null> {
  const enrolments = await db().deviceEnrolment.findMany({
    where: { staffId, faceEnrolledAt: { not: null } },
    include: { device: true },
  });

  for (const enrolment of enrolments) {
    try {
      const driver = driverFor(enrolment.device);
      const person = await driver.people.find(enrolment.deviceEmployeeNo);
      // An opaque handle: a URL on ISAPI, something else elsewhere. Handed straight back to
      // the driver that produced it rather than interpreted here.
      if (person?.facePointer) return await driver.biometrics.readFace(person.facePointer);
    } catch {
      // Try the next terminal rather than failing: any copy will do.
    }
  }

  return null;
}

/** Describes the image constraints for the UI, read from the device limits. */
export const FACE_IMAGE_RULES = {
  maxBytes: DEVICE_LIMITS.faceImage.maxBytes,
  minPixels: DEVICE_LIMITS.faceImage.minPixels,
  format: 'image/jpeg',
} as const;

export { readJpegDimensions };
