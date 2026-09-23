import { DeviceLockedError } from '@attendance/hik-isapi';
import { DriverOperation, supports } from '@attendance/terminal-drivers';

import type { AgentConfig } from './config.js';
import { logger } from './logging.js';
import { toPayload } from './payload.js';
import type { Roster } from './roster.js';
import type { Spool } from './spool.js';
import type { SiteState } from './state.js';

/**
 * The reconcile pull, run on the LAN.
 *
 * This is the job that cannot be done from the cloud at all, and the reason a connector exists
 * rather than just a firewall rule. Push on this hardware is fire-and-forget: the firmware keeps
 * no queue and never retries, so anything emitted while the listener was down exists only in the
 * terminal's own log and only a pull recovers it.
 *
 * ## Why terminals are taken a few at a time, in rotation
 *
 * An ISAPI event search returns thirty records per request, so catching up on a busy unit is
 * dozens of round trips. Firing all fifteen at once produces a repeating spike on a small
 * machine, and one terminal that answers slowly holds the rest behind it. Worse, a device is
 * skipped entirely for a whole cycle if the cycle never finishes.
 *
 * So a small number run concurrently and the starting point rotates. Every terminal is reached
 * within a predictable number of cycles regardless of how busy its neighbours are.
 */

export interface PullStats {
  cycles: number;
  spooled: number;
  failures: Map<number, { at: Date; message: string }>;
}

export class Puller {
  private rotation = 0;
  readonly stats: PullStats = { cycles: 0, spooled: 0, failures: new Map() };

  constructor(
    private readonly config: AgentConfig,
    private readonly roster: Roster,
    private readonly spool: Spool,
    private readonly state: SiteState,
  ) {}

  /**
   * One pass over a slice of the roster.
   *
   * Never throws. A pass that propagated would kill the timer that calls it, and the symptom of
   * that is a connector that keeps answering pushes while the pull silently stops — the exact
   * failure this project has already had once on the server, where a stuck flag left the pull
   * dead for three weeks while push kept working and nothing reported it.
   */
  async runOnce(): Promise<void> {
    const entries = this.roster.all().filter((entry) => {
      // A driver that cannot pull is not a failure. A callback protocol buffers its own
      // transactions and re-sends what was never acknowledged, so there is no gap to close.
      return supports(entry.driver.capabilities, DriverOperation.pullEvents);
    });

    if (entries.length === 0) return;

    this.stats.cycles += 1;

    // Rotate the starting point so a slow terminal cannot monopolise the concurrency budget.
    const ordered = [
      ...entries.slice(this.rotation % entries.length),
      ...entries.slice(0, this.rotation % entries.length),
    ];
    this.rotation = (this.rotation + this.config.PULL_CONCURRENCY) % Math.max(entries.length, 1);

    const slice = ordered.slice(0, this.config.PULL_CONCURRENCY);
    await Promise.all(slice.map((entry) => this.pullOne(entry)));
  }

  private async pullOne(entry: ReturnType<Roster['all']>[number]): Promise<void> {
    const deviceId = entry.assignment.deviceId;

    /*
     * The connector's own cursor wins over the cloud's.
     *
     * The cloud's advances only when it has stored events, so it lags whatever is still in the
     * spool. Using it would re-fetch that gap on every cycle — deduplicated on arrival, but paid
     * for in ISAPI round trips every single minute.
     */
    const stored = this.spool.cursorFor(deviceId);
    const cursor = stored ?? entry.assignment.cursor;

    try {
      const result = await entry.driver.events.pull({
        sequence: cursor.sequence,
        since: cursor.since === null ? null : new Date(cursor.since),
      });

      for (const event of result.events) {
        this.spool.add(deviceId, 'pull', toPayload(event));
      }
      this.stats.spooled += result.events.length;

      /*
       * The cursor the driver handed back, not one derived from the batch.
       *
       * Only the driver knows which form advances, and it must move past events it discarded
       * itself — otherwise one unparseable record is re-fetched forever and the pull never
       * reaches anything newer.
       */
      this.spool.saveCursor(
        deviceId,
        result.cursor.sequence,
        result.cursor.since === null ? null : result.cursor.since.toISOString(),
      );

      this.stats.failures.delete(deviceId);
      this.state.notePullSuccess(deviceId);

      if (result.events.length > 0) {
        logger().info(
          { deviceId, spooled: result.events.length },
          'Reconcile pull found events push had not delivered',
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.stats.failures.set(deviceId, { at: new Date(), message });
      this.state.notePullFailure(deviceId, message);

      /*
       * A locked account is logged at error and never retried faster.
       *
       * Retrying is what keeps the firmware's thirty-minute lockout alive, so a connector that
       * treated this like any other failure would hold an operator out of their own door
       * controller indefinitely while appearing to work hard at fixing it.
       */
      if (error instanceof DeviceLockedError) {
        logger().error({ deviceId, err: message }, 'Terminal has locked this account');
        return;
      }

      logger().warn({ deviceId, err: message }, 'Reconcile pull failed for a terminal');
    }
  }
}
