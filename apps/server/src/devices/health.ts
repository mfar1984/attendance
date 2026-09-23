import { DeviceLockedError, DeviceUnreachableError } from '@attendance/hik-isapi';
import type { Device } from '@prisma/client';

import { db } from '../db.js';
import { loadEnv } from '../env.js';
import { logger } from '../logger.js';
import { DriverOperation, supports } from '@attendance/terminal-drivers';
import type { DeviceWarning } from '@attendance/terminal-drivers';
import { driverFor } from './registry.js';

export type { DeviceWarning } from '@attendance/terminal-drivers';

export interface DeviceHealth {
  deviceId: number;
  status: 'online' | 'offline' | 'degraded';
  clockDriftSeconds: number | null;
  clockMode: string | null;
  faceCapacity: number | null;
  enrolled: number | null;
  warnings: DeviceWarning[];
  error?: string;
}

/**
 * Probes one terminal and records what it finds.
 *
 * Clock accuracy is checked on every pass because it is the only fault that corrupts every
 * record while leaving the device fully functional: scans keep arriving, nothing errors, and
 * the timestamps are simply wrong. Nothing in the terminal's own interface reports it.
 *
 * Runs against whatever driver the device is configured for, so a site mixing vendors is
 * probed by one sweep. Operations a protocol does not have are skipped rather than attempted
 * — a callback terminal has no clock we can read on demand, and treating that as a failure
 * would mark a perfectly healthy unit offline on every pass.
 */
export async function checkDevice(device: Device): Promise<DeviceHealth> {
  const env = loadEnv();
  const prisma = db();
  const warnings: DeviceWarning[] = [];

  try {
    const driver = driverFor(device);
    const can = (operation: DriverOperation): boolean =>
      supports(driver.capabilities, operation);

    const identity = can(DriverOperation.readIdentity) ? await driver.identity.read() : null;

    let clockDriftSeconds: number | null = null;
    let clockMode: string | null = null;
    if (can(DriverOperation.readClock)) {
      const clock = await driver.clock.read();
      clockDriftSeconds = clock.driftSeconds;
      clockMode = clock.source;

      if (Math.abs(clock.driftSeconds) > env.CLOCK_DRIFT_WARN_SECONDS) {
        warnings.push({
          key: 'device.warning.drift',
          vars: { seconds: clock.driftSeconds },
        });
      }
      if (clock.source === 'manual') {
        warnings.push({ key: 'device.warning.manualClock' });
      }
    }

    const counts = can(DriverOperation.readCounts) ? await driver.identity.counts() : null;

    let faceCapacity: number | null = null;
    if (can(DriverOperation.readCapacity)) {
      try {
        faceCapacity = (await driver.identity.capacity()).faces;
        if (faceCapacity !== null && counts !== null && counts.people / faceCapacity > 0.9) {
          warnings.push({
            key: 'device.warning.capacity',
            vars: { enrolled: counts.people, capacity: faceCapacity },
          });
        }
      } catch {
        // Capacity is advisory; a firmware that hides it should not fail the check.
      }
    }

    /**
     * Faults only the driver can recognise.
     *
     * Kept out of this function because which conditions matter is vendor-shaped: the
     * Hikvision remote-verification timeout has no equivalent anywhere else, and a neutral
     * check could not have looked for it.
     */
    warnings.push(...(await driver.vendorWarnings()));

    const status = warnings.length > 0 ? 'degraded' : 'online';

    await prisma.device.update({
      where: { id: device.id },
      data: {
        status,
        lastSeenAt: new Date(),
        clockDriftS: clockDriftSeconds,
        clockMode,
        // Only written when the unit actually reported it. A protocol that cannot read its
        // identity must not blank out what a previous probe learned.
        ...(identity === null
          ? {}
          : {
              model: identity.model,
              firmware: identity.firmware,
              macAddress: identity.macAddress,
              serialNumber: identity.serialNumber,
            }),
        ...(faceCapacity !== null ? { faceCapacity } : {}),
        /**
         * The capability list, recorded so the editor can render honestly while the unit is
         * offline. A callback terminal is frequently unreachable at the moment somebody opens
         * its settings, and a screen that cannot tell "this vendor has no door control" from
         * "not answering right now" tones both amber like a fault.
         */
        capabilities: {
          operations: driver.capabilities.operations,
          writeModel: driver.capabilities.writeModel,
          reachability: driver.capabilities.reachability,
          ...(driver.capabilities.unavailable === undefined
            ? {}
            : { unavailable: driver.capabilities.unavailable }),
        },
        lastError: null,
      },
    });

    return {
      deviceId: device.id,
      status,
      clockDriftSeconds,
      clockMode,
      faceCapacity,
      enrolled: counts?.people ?? null,
      warnings,
    };
  } catch (error) {
    const message = describe(error);

    // A locked account is recorded but never retried here. Retrying is what
    // extends the lockout, and the terminal locks for thirty minutes.
    if (error instanceof DeviceLockedError) {
      logger().error({ deviceId: device.id, message }, 'Device account is locked');
    }

    await prisma.device.update({
      where: { id: device.id },
      data: {
        status: 'offline',
        lastErrorAt: new Date(),
        lastError: message.slice(0, 500),
      },
    });

    return {
      deviceId: device.id,
      status: 'offline',
      clockDriftSeconds: null,
      clockMode: null,
      faceCapacity: null,
      enrolled: null,
      warnings: [],
      error: message,
    };
  }
}

export async function checkAllDevices(): Promise<DeviceHealth[]> {
  const devices = await db().device.findMany({ where: { active: true } });
  const results: DeviceHealth[] = [];
  // Sequential on purpose: terminals are modest hardware, and a burst of
  // parallel Digest handshakes across a site is a good way to make several look
  // unreachable at once.
  for (const device of devices) {
    results.push(await checkDevice(device));
  }
  return results;
}

function describe(error: unknown): string {
  if (error instanceof DeviceUnreachableError || error instanceof DeviceLockedError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
