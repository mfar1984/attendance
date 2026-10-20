import type { AgentCommandItem } from '@attendance/shared';

import { logger } from './logging.js';

/**
 * Commands waiting for a callback terminal to come and collect them.
 *
 * ## Why the connector holds these rather than running them
 *
 * Every other protocol here is request/response: the connector opens a socket to the unit and has
 * an answer before the call returns. TA Push inverts that completely — the terminal polls, takes
 * one command string, executes it itself, and reports the result on a later request. There is
 * nothing for the connector to call, so it cannot be an executor. It is a relay.
 *
 * What travels is therefore the protocol string the cloud's ZKTeco driver built, handed over
 * verbatim. That is why `driverFor` on the cloud keeps the real TA Push driver for these units
 * even when they are assigned to a connector: the write model is identical either way, and only
 * the delivery changes. `AgentCommandItem.payload` is documented for exactly this — one column,
 * two readers, with the kind and the device's protocol saying which.
 *
 * ## In memory, and that is safe here
 *
 * The durability lives in the cloud. `takePendingForDevices` marks a row `sent`, and a sweep
 * revives anything that sat in `sent` without an outcome being reported — so a connector that
 * restarts while holding commands loses nothing permanent: the cloud offers them again. Keeping a
 * second durable queue on the Pi would be a second place for the same fact to live, and the one
 * that drifted would be the one claiming a face was enrolled.
 *
 * The depth cap exists for the opposite failure. A terminal that is unplugged still has its
 * commands revived and re-offered, so without a ceiling an afternoon of enrolments against a dead
 * unit would grow here without bound. Oldest first, because an enrolment from an hour ago matters
 * more than the one that superseded nothing.
 */

/**
 * Per device.
 *
 * Fifty is a roster-wide enrolment's worth for one terminal — far more than a working unit ever
 * has outstanding, since it collects a handful every thirty seconds. The ceiling is for the unit
 * that is not collecting at all.
 */
const MAX_PER_DEVICE = 50;

export interface RelayedCommand {
  /** The cloud's id, carried so the outcome can be attributed when the terminal reports it. */
  commandId: string;
  kind: string;
  /** The protocol string, handed to the terminal exactly as the cloud built it. */
  payload: string;
  heldAt: Date;
}

export class Relay {
  private queues = new Map<number, RelayedCommand[]>();

  /**
   * Takes a command for a terminal to collect later.
   *
   * Returns false when the queue for that device is full, so the caller can leave the command
   * with the cloud rather than silently dropping it — a dropped enrolment is somebody who cannot
   * scan tomorrow with nothing on any screen saying why.
   */
  hold(command: AgentCommandItem): boolean {
    const queue = this.queues.get(command.deviceId) ?? [];

    if (queue.length >= MAX_PER_DEVICE) {
      logger().warn(
        { deviceId: command.deviceId, commandId: command.commandId, held: queue.length },
        'Relay queue for this terminal is full; leaving the command with the cloud',
      );
      return false;
    }

    // Already held, because the cloud re-offers anything it has not heard an outcome for.
    if (queue.some((entry) => entry.commandId === command.commandId)) return true;

    queue.push({
      commandId: command.commandId,
      kind: command.kind,
      payload: command.payload,
      heldAt: new Date(),
    });
    this.queues.set(command.deviceId, queue);
    return true;
  }

  /**
   * Hands over the next commands for a terminal that is asking.
   *
   * They stay held until an outcome arrives, because this protocol reports the result on a
   * separate request. Removing them here would leave nothing to attribute that report to.
   */
  peek(deviceId: number, limit: number): RelayedCommand[] {
    return (this.queues.get(deviceId) ?? []).slice(0, limit);
  }

  /** Finds which device holds a command id, since the terminal reports the id without the device. */
  deviceFor(commandId: string): number | null {
    for (const [deviceId, queue] of this.queues) {
      if (queue.some((entry) => entry.commandId === commandId)) return deviceId;
    }
    return null;
  }

  /** Drops a command once its outcome has been accepted by the cloud. */
  release(deviceId: number, commandId: string): void {
    const queue = this.queues.get(deviceId);
    if (!queue) return;

    const remaining = queue.filter((entry) => entry.commandId !== commandId);
    if (remaining.length === 0) this.queues.delete(deviceId);
    else this.queues.set(deviceId, remaining);
  }

  /** Forgets a terminal this connector no longer serves, so its queue cannot leak. */
  forget(deviceId: number): void {
    this.queues.delete(deviceId);
  }

  /**
   * Drops the queues of terminals no longer on the roster.
   *
   * Called after every heartbeat applies one, like `SiteState.retain`. A terminal moved to another
   * connector otherwise leaves its commands here forever — and worse, they are commands the other
   * connector is now also holding, so the first outcome to arrive would be reported twice.
   */
  retain(deviceIds: number[]): void {
    const keep = new Set(deviceIds);
    for (const deviceId of [...this.queues.keys()]) {
      if (!keep.has(deviceId)) this.queues.delete(deviceId);
    }
  }

  /** Depth per device, for the health endpoint and the log. */
  depth(): Record<number, number> {
    const result: Record<number, number> = {};
    for (const [deviceId, queue] of this.queues) result[deviceId] = queue.length;
    return result;
  }

  count(): number {
    let total = 0;
    for (const queue of this.queues.values()) total += queue.length;
    return total;
  }
}
