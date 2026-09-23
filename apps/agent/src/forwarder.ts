import type { Cloud } from './cloud.js';
import type { AgentConfig } from './config.js';
import { logger } from './logging.js';
import type { Spool, SpoolBatch } from './spool.js';

/**
 * Moves spooled events to the cloud, oldest first.
 *
 * ## The delete happens after the accept, never before
 *
 * That ordering decides which way this fails. Deleting first would lose events whenever a
 * response is lost in flight — and a lost response is indistinguishable from a lost request, so
 * the connector could not tell whether it had just discarded a morning's attendance. Deleting
 * after means the worst case is delivering a batch twice, which the cloud already handles by
 * deduplicating on `eventKey`.
 *
 * Duplicates are cheap and visible. Missing scans are neither.
 */
export class Forwarder {
  private unauthorisedSince: Date | null = null;

  constructor(
    private readonly config: AgentConfig,
    private readonly cloud: Cloud,
    private readonly spool: Spool,
  ) {}

  /**
   * Drains as much as the cloud will take, then stops on the first sign of trouble.
   *
   * Stopping rather than continuing is deliberate. If the cloud is unreachable, the next batch
   * will fail too, and a loop that kept trying would turn one outage into a tight retry loop
   * against a host that is already struggling. The spool is durable, so waiting costs nothing
   * but latency.
   */
  async drain(): Promise<void> {
    for (;;) {
      const batch = this.spool.next(this.config.BATCH_SIZE);
      if (!batch) return;

      const result = await this.cloud.postEvents(batch.deviceId, batch.arrivedVia, batch.events);

      if (result.ok) {
        this.spool.remove(batch.ids);
        this.unauthorisedSince = null;

        if (result.value.duplicates > 0) {
          logger().debug(
            { deviceId: batch.deviceId, ...result.value },
            'Cloud reported duplicates, which means an earlier response was lost rather than the batch',
          );
        }
        continue;
      }

      const failure = result.failure;

      if (failure.kind === 'unreachable') {
        logger().warn(
          { deviceId: batch.deviceId, held: this.spool.count(), detail: failure.detail },
          'Cloud is unreachable; events are held on disk',
        );
        return;
      }

      if (failure.kind === 'unauthorised') {
        /*
         * Reported once per episode, not once per attempt.
         *
         * A credential problem cannot be fixed by retrying, and a line per cycle would bury the
         * one that matters. The events are kept: a revoked connector that is later re-enrolled
         * should deliver what it collected in between, not have discarded it.
         */
        if (this.unauthorisedSince === null) {
          this.unauthorisedSince = new Date();
          logger().error(
            { detail: failure.detail, held: this.spool.count() },
            'Cloud refused this connector credential. Events are being kept, but nothing will be ' +
              'delivered until the connector is re-enrolled',
          );
        }
        return;
      }

      /*
       * A rejection is about the content, so it will be refused identically every time.
       *
       * But the batch is up to a hundred events and usually only one of them is the problem — a
       * field a firmware started spelling differently, most likely. Dropping the batch would
       * throw away the ninety-nine that were fine, so the batch is re-sent one event at a time
       * to find the one that is actually refused.
       *
       * The alternative of keeping it was worse than either: a permanently refused batch at the
       * head of the spool stops everything behind it draining, and the only visible symptom is a
       * disk filling while the site goes quiet.
       */
      logger().warn(
        { deviceId: batch.deviceId, status: failure.status, count: batch.events.length },
        'Cloud refused a batch; retrying one at a time to isolate the event it objects to',
      );
      await this.isolate(batch);
    }
  }

  /**
   * Sends a refused batch one event at a time, so only the unacceptable ones are lost.
   *
   * Stops on the first sign the cloud has gone away, leaving the rest spooled. Continuing through
   * a hundred single-event requests against an unreachable host would turn one outage into a
   * hundred timeouts, and the events are safe where they are.
   */
  private async isolate(batch: SpoolBatch): Promise<void> {
    for (const [index, id] of batch.ids.entries()) {
      const event = batch.events[index];
      if (!event) continue;

      const single = await this.cloud.postEvents(batch.deviceId, batch.arrivedVia, [event]);

      if (single.ok) {
        this.spool.remove([id]);
        continue;
      }

      if (single.failure.kind !== 'rejected') {
        // Unreachable or unauthorised now: leave this and everything after it on disk.
        logger().warn(
          { deviceId: batch.deviceId, failure: single.failure.kind },
          'Stopped isolating because the cloud is no longer answering',
        );
        return;
      }

      /*
       * Named individually in the log, which is what makes the loss recoverable: the terminal
       * still holds this event in its own log, so an operator with the key can go and look at
       * what the firmware actually sent.
       */
      logger().error(
        {
          deviceId: batch.deviceId,
          eventKey: event.eventKey,
          status: single.failure.status,
          detail: single.failure.detail,
        },
        'Cloud refused this event; dropping it so the spool can continue draining',
      );
      this.spool.discard([id]);
    }
  }
}
