import { DeviceLockedError } from '@attendance/hik-isapi';
import type { Device } from '@prisma/client';

import { db } from '../db.js';
import { requeueStale } from '../devices/driver/commands.js';
import { DriverOperation, supports } from '../devices/driver/index.js';
import { driverFor } from '../devices/registry.js';
import { loadEnv } from '../env.js';
import { storeEvents } from '../ingest/store.js';
import { logger } from '../logger.js';

export interface SyncResult {
  deviceId: number;
  deviceName: string;
  fromSerialNo: number;
  toSerialNo: number;
  stored: number;
  duplicates: number;
  punches: number;
  error?: string;
}

/**
 * How long a `syncing` flag is believed before it is treated as abandoned.
 *
 * Five minutes is far longer than any real pass — pulling a busy terminal's backlog takes
 * seconds — and short enough that a crashed process costs one interval rather than forever.
 *
 * The alternative, clearing every flag at boot, was rejected: it fixes the restart case and
 * leaves the one that matters more, which is a pass that hangs on a device that stopped
 * answering mid-read while the process stays up.
 */
const STALE_SYNC_FLAG_MS = 5 * 60_000;

/**
 * Reconcile pull for one terminal.
 *
 * This runs even when push notifications are configured and healthy, because
 * push on this hardware is fire-and-forget: the terminal keeps no queue and
 * never retries. Anything emitted while the listener was down is gone from push
 * and only recoverable here.
 *
 * The cursor is a serial number rather than a timestamp. Serials survive clock
 * corrections, and these clocks do get corrected - a time-windowed cursor would
 * skip or replay records the moment NTP moved the clock.
 */
export async function syncDevice(device: Device): Promise<SyncResult> {
  const prisma = db();

  const state = await prisma.deviceSyncState.upsert({
    where: { deviceId: device.id },
    create: { deviceId: device.id },
    update: {},
  });

  const base: SyncResult = {
    deviceId: device.id,
    deviceName: device.name,
    fromSerialNo: Number(state.lastSerialNo),
    toSerialNo: Number(state.lastSerialNo),
    stored: 0,
    duplicates: 0,
    punches: 0,
  };

  /**
   * A terminal behind an on-site connector is not ours to pull.
   *
   * The agent performs the reconcile pull on the LAN and posts what it finds, so reaching for
   * the unit from here is both wrong and guaranteed to fail: `device.host` is a private address
   * this host cannot route.
   *
   * Returned as a clean no-op, for the same reason a push-only protocol is. Letting it throw
   * would mark a healthy terminal `offline` with a network error, add it to the backoff map,
   * and settle into fifteen-minute retries — and nothing in that output would distinguish
   * "unreachable because it is behind an agent" from "unreachable because it is dead". A whole
   * agent site would read as fifteen failed terminals.
   *
   * The flag is deliberately not touched: setting and clearing `syncing` for a pass that was
   * never going to happen is churn on a row the devices screen reads.
   */
  if (device.agentId !== null) return base;

  /**
   * A second pass while one is already running would double-write and fight over the cursor.
   *
   * But the flag is only trustworthy while the process that set it is alive. It is cleared in
   * the catch block, which never runs if the process is killed mid-pass — and then the flag
   * stays set forever and this device is never reconciled again.
   *
   * That is not hypothetical: it was found set on the live database with a `lastSyncAt` three
   * weeks old, which means the reconcile pull had been silently dead for that whole period
   * while push kept working. Nothing reported it, because "a sync is already running" reads
   * like a transient condition rather than a permanent one.
   *
   * So a flag older than the stale window is taken over rather than obeyed. The window is long
   * enough that a genuinely running pass is never interrupted — a full pull of a busy terminal
   * is seconds, not minutes.
   */
  if (state.syncing) {
    /**
     * A flag with no start time is from before this column existed, which makes it a flag whose
     * age cannot be established — and the only ones that survive that long are abandoned.
     */
    const heldForMs =
      state.syncingSince === null ? Infinity : Date.now() - state.syncingSince.getTime();

    if (heldForMs < STALE_SYNC_FLAG_MS) {
      return { ...base, error: 'Sync sedang berjalan' };
    }

    logger().warn(
      {
        deviceId: device.id,
        heldForMinutes: Number.isFinite(heldForMs) ? Math.round(heldForMs / 60_000) : null,
      },
      'Taking over a sync flag left set by a pass that never finished',
    );
  }

  await prisma.deviceSyncState.update({
    where: { deviceId: device.id },
    data: { syncing: true, syncingSince: new Date() },
  });

  try {
    const driver = driverFor(device);

    /**
     * A protocol that only pushes has nothing to reconcile against.
     *
     * Reported as a clean no-op rather than an error. A callback terminal buffers its own
     * transactions and re-sends what we never acknowledged, so there is no gap for a pull to
     * close — and recording a failure here would put a healthy unit into the backoff map and
     * then mark it offline.
     */
    if (!supports(driver.capabilities, DriverOperation.pullEvents)) {
      await prisma.deviceSyncState.update({
        where: { deviceId: device.id },
        data: { syncing: false, syncingSince: null, lastSyncAt: new Date() },
      });
      return base;
    }

    const result = await driver.events.pull({
      sequence: Number(state.lastSerialNo),
      since: state.lastSyncAt,
    });

    const outcome = await storeEvents(device, result.events, 'pull');

    /**
     * The cursor the driver handed back, not one derived here.
     *
     * Only the driver knows which form advances for its protocol, and it is responsible for
     * moving past records it discarded itself — otherwise one unparseable event is re-fetched
     * forever and the pull never reaches anything newer. This function previously computed it
     * from the highest serial number in the batch, which silently stops working for a
     * protocol that has no serial number.
     */
    const highest = result.cursor.sequence ?? Number(state.lastSerialNo);

    await prisma.deviceSyncState.update({
      where: { deviceId: device.id },
      data: {
        lastSerialNo: BigInt(highest),
        lastSyncAt: new Date(),
        syncing: false, syncingSince: null,
        // Events found by pull that push never delivered. A climbing figure is
        // the symptom of push notifications being dropped.
        recoveredByPull: { increment: outcome.stored },
      },
    });

    /**
     * A successful pull is proof the terminal is reachable, so the status is
     * cleared here too. Without this a device that recovers stays marked offline
     * until someone happens to run a health check, and the dashboard keeps
     * reporting a fault that no longer exists.
     *
     * `degraded` is preserved: it means the device answers but its data is not
     * trustworthy, usually clock drift, which a successful pull does not fix.
     */
    if (device.status !== 'degraded') {
      await prisma.device.update({
        where: { id: device.id },
        data: { status: 'online', lastSeenAt: new Date(), lastError: null },
      });
    } else {
      await prisma.device.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date(), lastError: null },
      });
    }

    return {
      ...base,
      toSerialNo: highest,
      stored: outcome.stored,
      duplicates: outcome.duplicates,
      punches: outcome.punches,
    };
  } catch (error) {
    await prisma.deviceSyncState.update({
      where: { deviceId: device.id },
      data: { syncing: false, syncingSince: null },
    });

    const message = error instanceof Error ? error.message : String(error);

    // Never retried from here: retrying is what keeps the lockout alive.
    if (error instanceof DeviceLockedError) {
      logger().error({ deviceId: device.id }, `Device locked, skipping sync: ${message}`);
    } else {
      logger().warn({ deviceId: device.id, err: message }, 'Device sync failed');
    }

    await prisma.device.update({
      where: { id: device.id },
      data: { lastErrorAt: new Date(), lastError: message.slice(0, 500), status: 'offline' },
    });

    return { ...base, error: message };
  }
}

export async function syncAllDevices(): Promise<SyncResult[]> {
  const devices = await db().device.findMany({ where: { active: true } });
  const results: SyncResult[] = [];
  for (const device of devices) {
    results.push(await syncDevice(device));
  }
  return results;
}

let timer: NodeJS.Timeout | null = null;

/**
 * Per-device backoff state.
 *
 * A terminal that rejects us must not be retried on the normal cadence. This
 * firmware locks the account for thirty minutes after roughly five failures, so a
 * worker polling every sixty seconds can lock an operator out of their own door
 * controller while trying to be helpful.
 */
const backoff = new Map<number, { skipUntil: number; consecutiveFailures: number }>();

const MAX_BACKOFF_MS = 15 * 60_000;

/**
 * How long a collected command may go unacknowledged before it is offered again.
 *
 * Five minutes is well above any healthy round trip — an agent polls every few seconds and a
 * callback terminal every minute or so — and short enough that a connector restarted in the
 * middle of a roster push does not leave those people un-enrolled for the rest of the day.
 */
const STALE_COMMAND_MS = 5 * 60_000;

/**
 * Takes allowed before a command is abandoned as failed.
 *
 * A command collected four times without a single acknowledgement is not going to succeed on
 * the fifth, and leaving it pending means the queue never drains — so a genuinely new command
 * queues behind a dead one indefinitely.
 */
const MAX_COMMAND_ATTEMPTS = 4;

function shouldSkip(deviceId: number): boolean {
  const state = backoff.get(deviceId);
  return state !== undefined && Date.now() < state.skipUntil;
}

function recordFailure(deviceId: number, deviceName: string): void {
  const previous = backoff.get(deviceId)?.consecutiveFailures ?? 0;
  const failures = previous + 1;
  // 2m, 4m, 8m, then held at 15m.
  const delay = Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** failures);

  backoff.set(deviceId, { skipUntil: Date.now() + delay, consecutiveFailures: failures });
  logger().warn(
    { deviceId, failures, retryInSeconds: Math.round(delay / 1000) },
    `Backing off "${deviceName}" after repeated sync failures`,
  );
}

function recordSuccess(deviceId: number): void {
  backoff.delete(deviceId);
}

/** Starts the periodic reconcile loop. */
export function startSyncWorker(): void {
  const env = loadEnv();
  const intervalMs = env.SYNC_INTERVAL_SECONDS * 1000;

  const run = async (): Promise<void> => {
    try {
      /**
       * Re-offer commands that were collected and never reported on.
       *
       * This had no caller at all until the agent needed it, which meant a command a terminal
       * took and silently dropped stayed `sent` forever: never retried, never failed, and
       * blocking nothing — so a face enrolment simply never happened and the queue looked
       * healthy. The window and ceiling live here rather than in configuration because the
       * right values follow from the poll cadence, not from operator preference.
       */
      await requeueStale(STALE_COMMAND_MS, MAX_COMMAND_ATTEMPTS);

      const devices = await db().device.findMany({ where: { active: true } });
      let stored = 0;

      for (const device of devices) {
        if (shouldSkip(device.id)) continue;

        const result = await syncDevice(device);
        if (result.error) {
          recordFailure(device.id, device.name);
        } else {
          recordSuccess(device.id);
          stored += result.stored;
        }
      }

      if (stored > 0) {
        logger().info({ stored, devices: devices.length }, 'Reconcile pull stored new events');
      }
    } catch (error) {
      logger().error({ err: error }, 'Sync worker pass failed');
    }
  };

  // Deliberately not run immediately at boot: the first pass would compete with
  // startup work and, on a cold database, with migrations.
  timer = setInterval(() => void run(), intervalMs);
  logger().info({ intervalSeconds: env.SYNC_INTERVAL_SECONDS }, 'Sync worker started');
}

export function stopSyncWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
