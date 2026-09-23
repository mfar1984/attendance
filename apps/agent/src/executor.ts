import { DeviceLockedError } from '@attendance/hik-isapi';
import {
  agentFaceEnrolArgs,
  agentFaceRemoveArgs,
  agentPersonRemoveArgs,
  agentPersonUpsertArgs,
  type AgentCommandItem,
} from '@attendance/shared';
import { DriverOperation, supports, type TerminalDriver } from '@attendance/terminal-drivers';

import type { Cloud } from './cloud.js';
import { logger } from './logging.js';
import type { Roster } from './roster.js';

/**
 * Runs the work the cloud has queued for this site's terminals.
 *
 * The cloud cannot perform these itself — writing a face means opening a socket to a private
 * address — so it records the intent and the connector collects it. What runs here is the same
 * `TerminalDriver` a direct installation would have run, which is the whole reason the driver
 * layer was moved into a shared package rather than reimplemented.
 *
 * ## Acknowledging a failure is a decision, not a formality
 *
 * A command the connector reports on is finished: the queue marks it failed and never offers it
 * again. A command the connector stays silent about is re-offered by the cloud's stale sweep a few
 * minutes later. So the two have to be told apart, and getting it backwards is expensive in both
 * directions.
 *
 * - **Permanent** — arguments that will not parse, a kind this build does not know, a terminal not
 *   on this roster, an operation the driver does not support, a locked device account. Reported as
 *   failed. Retrying cannot help, and a command retried forever blocks everything behind it.
 * - **Transient** — the terminal did not answer, a timeout, a connection refused. Not reported.
 *   The unit is probably being restarted or the network blipped, and the sweep will offer it again.
 *
 * The locked account belongs in the first group even though it is temporary. Every attempt extends
 * the firmware's thirty-minute lockout, so four automatic retries would hold an operator out of
 * their own door controller for longer than the original lockout — while appearing to work hard at
 * fixing it.
 */

export interface ExecutorStats {
  executed: number;
  failed: number;
  deferred: number;
}

/** Outcome of running one command locally, before deciding what to tell the cloud. */
type Attempt =
  | { outcome: 'done'; detail: string }
  | { outcome: 'permanent'; detail: string }
  | { outcome: 'transient'; detail: string };

export class Executor {
  readonly stats: ExecutorStats = { executed: 0, failed: 0, deferred: 0 };

  constructor(
    private readonly cloud: Cloud,
    private readonly roster: Roster,
  ) {}

  /**
   * One poll: collect whatever is waiting and run it.
   *
   * Sequentially, not in parallel. These are small embedded boxes that cap concurrent sessions and
   * answer 401 without a challenge once that cap is reached, and a face upload is not a small
   * request. The driver serialises per unit anyway; doing it here as well keeps a roster-wide
   * enrolment from opening fifteen heavy requests at once on a Raspberry Pi.
   */
  async runOnce(): Promise<void> {
    const result = await this.cloud.commands();
    if (!result.ok) {
      if (result.failure.kind !== 'unreachable') {
        logger().warn({ failure: result.failure }, 'Could not collect queued commands');
      }
      return;
    }

    for (const command of result.value.commands) {
      await this.run(command);
    }
  }

  private async run(command: AgentCommandItem): Promise<void> {
    const attempt = await this.attempt(command);

    if (attempt.outcome === 'transient') {
      this.stats.deferred += 1;
      logger().warn(
        { commandId: command.commandId, deviceId: command.deviceId, detail: attempt.detail },
        'Deferring a command so the cloud offers it again',
      );
      return;
    }

    const ok = attempt.outcome === 'done';
    if (ok) this.stats.executed += 1;
    else this.stats.failed += 1;

    const reported = await this.cloud.reportCommand(command.commandId, {
      ok,
      result: attempt.detail,
    });

    /*
     * A lost acknowledgement is not a lost command. The queue re-offers anything it never heard
     * about, and every operation here is idempotent by content — an upsert, a delete, a face for
     * one identifier — so running it twice is safe. That is what makes staying quiet an acceptable
     * failure mode and reporting the wrong thing not.
     */
    if (!reported.ok) {
      logger().warn(
        { commandId: command.commandId, failure: reported.failure },
        'Ran a command but could not report the outcome; the cloud will offer it again',
      );
      return;
    }

    if (!ok) {
      logger().error(
        { commandId: command.commandId, deviceId: command.deviceId, detail: attempt.detail },
        'Command failed permanently',
      );
    }
  }

  private async attempt(command: AgentCommandItem): Promise<Attempt> {
    const entry = this.roster.get(command.deviceId);
    if (!entry) {
      return {
        outcome: 'permanent',
        detail:
          'Terminal ini tiada dalam senarai connector. Ia mungkin sudah dipindahkan ke connector ' +
          'lain atau dinyahaktifkan.',
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(command.payload);
    } catch {
      return { outcome: 'permanent', detail: 'Muatan arahan bukan JSON yang sah.' };
    }

    try {
      return await this.dispatch(entry.driver, command.kind, parsed);
    } catch (error) {
      if (error instanceof DeviceLockedError) {
        return {
          outcome: 'permanent',
          detail:
            'Terminal telah mengunci akaun ini. Tunggu sampai lockout firmware tamat, kemudian ' +
            'cuba semula - setiap cubaan memanjangkannya.',
        };
      }

      const message = error instanceof Error ? error.message : String(error);

      /*
       * Anything that is not plainly a network condition is treated as permanent.
       *
       * The safer-looking default would be the opposite — defer on anything unrecognised, on the
       * grounds that a retry is cheap. It is not: a command that can never succeed and is never
       * acknowledged is re-offered until it hits the attempt ceiling, and it sits at the head of
       * the queue while a genuinely new enrolment waits behind it.
       */
      return isTransient(message)
        ? { outcome: 'transient', detail: message }
        : { outcome: 'permanent', detail: message.slice(0, 500) };
    }
  }

  private async dispatch(
    driver: TerminalDriver,
    kind: string,
    payload: unknown,
  ): Promise<Attempt> {
    const refuseUnsupported = (operation: DriverOperation): Attempt | null =>
      supports(driver.capabilities, operation)
        ? null
        : {
            outcome: 'permanent',
            detail: `Pemandu terminal ini tidak menyokong "${operation}".`,
          };

    switch (kind) {
      case 'person.upsert': {
        const refusal = refuseUnsupported(DriverOperation.upsertPerson);
        if (refusal) return refusal;

        const args = agentPersonUpsertArgs.parse(payload);
        const ack = await driver.people.upsert({
          employeeNo: args.employeeNo,
          name: args.name,
          ...(args.validFrom === undefined ? {} : { validFrom: new Date(args.validFrom) }),
          ...(args.validTo === undefined ? {} : { validTo: new Date(args.validTo) }),
          ...(args.pin === undefined ? {} : { pin: args.pin }),
          ...(args.doorNo === undefined ? {} : { doorNo: args.doorNo }),
        });
        return { outcome: 'done', detail: describe(ack.confirmed, `Pengguna ${args.employeeNo}`) };
      }

      case 'person.remove': {
        const refusal = refuseUnsupported(DriverOperation.removePerson);
        if (refusal) return refusal;

        const args = agentPersonRemoveArgs.parse(payload);
        const ack = await driver.people.remove(args.employeeNos);
        return {
          outcome: 'done',
          detail: describe(ack.confirmed, `${String(args.employeeNos.length)} pengguna dibuang`),
        };
      }

      case 'face.enroll': {
        const refusal = refuseUnsupported(DriverOperation.enrolFace);
        if (refusal) return refusal;

        const args = agentFaceEnrolArgs.parse(payload);
        const jpeg = Buffer.from(args.jpegBase64, 'base64');
        if (jpeg.length === 0) {
          return { outcome: 'permanent', detail: 'Gambar wajah kosong selepas dinyahkod.' };
        }

        const ack = await driver.biometrics.enrolFace(args.employeeNo, jpeg);
        return {
          outcome: 'done',
          detail: describe(ack.confirmed, `Wajah ${args.employeeNo} (${String(jpeg.length)} bait)`),
        };
      }

      case 'face.remove': {
        const refusal = refuseUnsupported(DriverOperation.removeFace);
        if (refusal) return refusal;

        const args = agentFaceRemoveArgs.parse(payload);
        const ack = await driver.biometrics.removeFace(args.employeeNo);
        return { outcome: 'done', detail: describe(ack.confirmed, `Wajah ${args.employeeNo} dibuang`) };
      }

      case 'reboot': {
        const refusal = refuseUnsupported(DriverOperation.reboot);
        if (refusal) return refusal;

        const ack = await driver.lifecycle.reboot();
        return { outcome: 'done', detail: describe(ack.confirmed, 'Terminal dimulakan semula') };
      }

      default:
        /*
         * Named in the message, and reported as failed rather than deferred.
         *
         * This is a connector running older code than the cloud. Staying quiet would re-offer it
         * until the ceiling and leave the operator with a command that never resolves; failing it
         * with the kind in the message says exactly what to do, which is update the connector.
         */
        return {
          outcome: 'permanent',
          detail:
            `Connector ini tidak mengenali arahan "${kind}". Kemas kini connector pada tapak itu.`,
        };
    }
  }
}

function describe(confirmed: boolean, subject: string): string {
  return confirmed ? `${subject}: diterima terminal.` : `${subject}: dibariskan pada terminal.`;
}

/**
 * Whether a message describes the network rather than the request.
 *
 * Matched on message text, which is not elegant. The alternative was to thread a typed error
 * through the whole ISAPI transport, and the driver contract deliberately says failures throw
 * without specifying what — so this is the honest boundary rather than a pretend one. The list
 * covers what Node's networking actually produces; anything unrecognised is treated as permanent,
 * which is the direction that keeps the queue draining.
 */
function isTransient(message: string): boolean {
  const lower = message.toLowerCase();
  return [
    'etimedout',
    'econnrefused',
    'econnreset',
    'ehostunreach',
    'enetunreach',
    'enotfound',
    'eai_again',
    'socket hang up',
    'timeout',
    'aborted',
  ].some((needle) => lower.includes(needle));
}
