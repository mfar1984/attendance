import {
  AgentStatus,
  DeviceStatus,
  isCallbackProtocol,
  type AgentDeviceReport,
} from '@attendance/shared';
import { TA_PUSH_POLL_SECONDS } from '@attendance/terminal-drivers';

import { db } from '../db.js';
import { logger } from '../logger.js';

/**
 * Terminals whose connector has gone quiet.
 *
 * ## The hole this closes
 *
 * A connector-served terminal's status is written by exactly one thing: the agent's heartbeat.
 * The health probe skips those devices on purpose — `health.ts` explains why, and it is right —
 * and `syncDevice` returns a clean no-op for them, also right, because the agent performs their
 * pull on the LAN.
 *
 * So when a connector stops heartbeating, nothing writes anything, and the status simply freezes
 * at whatever was last reported. A site that has recorded nothing for three weeks keeps reading
 * **ONLINE** on the dashboard, and the alert bell stays silent because it counts terminals whose
 * status is offline.
 *
 * That is not a hypothetical. Hospital Sibu's connector went quiet on 21 October and was found on
 * 12 November, still green on screen, with twenty-two days of attendance that never existed. The
 * comment in `health.ts` calls a unit reporting healthy while recording nothing "the failure this
 * whole system exists to prevent" — and this was that failure, arriving through the one door
 * nobody had put a writer behind.
 *
 * ## Why a sweep rather than a smarter heartbeat
 *
 * Absence cannot be detected by the thing that is absent. Only something running on a timer here
 * can notice that a message did not arrive, which is why this belongs beside the reconcile pull
 * rather than in the agent routes.
 */

/**
 * How long a connector may be silent before its terminals are called offline.
 *
 * Has to exceed the slowest heartbeat any site can be configured for. `HEARTBEAT_SECONDS` caps at
 * 900, so thirty minutes is two missed beats at the maximum and thirty at the default — late
 * enough to never fire on a single dropped request over a bad link, and early enough that a dead
 * site is amber the same hour instead of the same month.
 *
 * A connector could instead report its own interval and have this derived per site. That is a
 * better answer and a heartbeat schema change, which means a cloud-first deployment and a version
 * bump; this constant is the version that ships today and stops the bleeding. The number is
 * deliberately generous because the cost of being late is a delayed alert, while the cost of being
 * early is an operator who learns to ignore the badge.
 */
export const AGENT_SILENCE_MS = 30 * 60_000;

/**
 * Whether a connector counts as not reporting.
 *
 * Pure, so the rule can be tested without a database — and the rule is the part worth testing,
 * because getting it wrong in one direction cries wolf and in the other hides a dead hospital.
 *
 * A connector that is not `active` is silent regardless of the clock: a revoked credential cannot
 * heartbeat, and `revokeAgent` leaves its devices attached on purpose so they read as stranded
 * rather than as reassigned. This is what makes them read that way.
 */
export function agentIsSilent(
  agent: { status: string; lastSeenAt: Date | null },
  now: Date = new Date(),
  windowMs: number = AGENT_SILENCE_MS,
): boolean {
  if (agent.status !== AgentStatus.active) return true;
  // Enrolment stamps `lastSeenAt`, so null on an active row means a credential that has never
  // been used. Treated as silent: there is nothing behind it.
  if (agent.lastSeenAt === null) return true;

  return now.getTime() - agent.lastSeenAt.getTime() > windowMs;
}

/** What is written onto a stranded terminal, in words an operator can act on. */
export function silenceReason(agentName: string, lastSeenAt: Date | null): string {
  const when =
    lastSeenAt === null
      ? 'belum pernah melaporkan'
      : `tidak melaporkan sejak ${lastSeenAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

  return (
    `Connector "${agentName}" ${when}. Terminal ini dicapai melaluinya, jadi status dan ` +
    'kehadirannya tidak diketahui — ini bukan terminal rosak. Periksa connector itu.'
  ).slice(0, 500);
}

export interface StrandedSweep {
  /** Connectors found silent. */
  agents: number;
  /** Terminals whose status this pass changed. */
  devices: number;
}

/**
 * Marks the terminals of every silent connector offline.
 *
 * ## What it deliberately does not touch
 *
 * `lastSeenAt` on the device is left alone. It is the record of when that terminal last actually
 * reported, and it is the evidence somebody uses to work out how long attendance has been
 * missing — overwriting it with "now" would destroy the one number that answers that.
 *
 * Nor is the agent row touched. `AgentStatus` is credential lifecycle — pending, active, revoked —
 * not liveness, and collapsing the two would mean a network outage looked like a withdrawn
 * credential.
 *
 * ## Recovery needs no code
 *
 * When the connector heartbeats again it reports a status for each terminal it serves, and the
 * heartbeat route writes that along with a null `lastError`. So the prose below is cleared by the
 * thing whose absence caused it, which is the only writer that can honestly say the condition is
 * over.
 */
export async function strandSilentAgentDevices(now: Date = new Date()): Promise<StrandedSweep> {
  const prisma = db();

  /*
   * Only connectors that actually have terminals. A silent connector serving nothing is a fact
   * for the Connector tab — which shows `lastSeenAt` — and not a terminal fault, so there is
   * nothing here to mark and no alert to raise.
   */
  const agents = await prisma.deviceAgent.findMany({
    select: { id: true, name: true, status: true, lastSeenAt: true },
  });

  const sweep: StrandedSweep = { agents: 0, devices: 0 };

  for (const agent of agents) {
    if (!agentIsSilent(agent, now)) continue;

    /*
     * Only rows this pass would change. Without the status filter every sweep would rewrite
     * `lastErrorAt` on an already-stranded terminal, which moves the timestamp forward and
     * destroys when the silence began — the same mistake `withholdUnreadable` avoids by checking
     * the stored message first.
     */
    const stranded = await prisma.device.updateMany({
      where: {
        agentId: agent.id,
        active: true,
        status: { not: DeviceStatus.offline },
      },
      data: {
        status: DeviceStatus.offline,
        lastError: silenceReason(agent.name, agent.lastSeenAt),
        lastErrorAt: now,
      },
    });

    if (stranded.count === 0) continue;

    sweep.agents += 1;
    sweep.devices += stranded.count;

    logger().warn(
      {
        agentId: agent.id,
        agent: agent.name,
        agentStatus: agent.status,
        lastSeenAt: agent.lastSeenAt,
        devices: stranded.count,
      },
      'Connector has stopped reporting; its terminals are now marked offline',
    );
  }

  return sweep;
}

// ---------------------------------------------------------------------------
// One terminal, behind a connector that is still reporting
// ---------------------------------------------------------------------------

/**
 * The same failure as above, one layer deeper: the connector is alive and one terminal is mute.
 *
 * ## The hole this closes
 *
 * `SiteState.report()` on the connector has no staleness bound. Once a terminal has been observed
 * even once, every subsequent heartbeat claims `online` however long ago that observation was. For
 * a request-response protocol that is partly masked — the connector dials the unit, so a failed
 * pull raises its error counter and the report flips to `offline`. For a callback protocol nothing
 * dials anything, by design, so the only evidence is the terminal dialling in and the absence of
 * it is invisible.
 *
 * Device 6 `Pejabat Faeez` sat green for eighteen hours on the strength of one hand-run handshake.
 * One curl bought an eighteen-hour green badge, which is the Sibu failure in miniature: a unit
 * reading healthy while recording nothing.
 *
 * ## Why the cloud, and why on arrival rather than on a timer
 *
 * The heartbeat carries both the claim (`status`) and the evidence for it (`lastSeenAt`), so the
 * cloud can refuse a claim its own evidence does not support — no connector change, no version
 * bump, no coordinated deploy at two sites.
 *
 * It has to be applied where the report is written, not in a second sweep beside
 * `strandSilentAgentDevices`. A sweep would write `offline` and the next heartbeat, at most sixty
 * seconds later, would write the connector's unbounded `online` straight back over it. The badge
 * would flap every minute, which is worse than no rule at all. The heartbeat route is the only
 * writer of these columns for an agent terminal — the health probe returns early for them and
 * `syncDevice` no-ops them, both deliberately — so the bound belongs inside that one writer.
 *
 * The two layers then divide cleanly: a connector that goes silent is the sweep's job, a connector
 * that is talking while one of its terminals is not is this one's.
 */

/**
 * Polls a callback terminal may miss before its silence counts as evidence.
 *
 * Justified the way `AGENT_SILENCE_MS` justifies thirty minutes. The report is judged the moment
 * it arrives, against a timestamp the connector composed seconds earlier — it makes one `fetch`
 * and retries by recomposing on the next tick, so no stale body is ever replayed. The heartbeat
 * interval therefore does **not** have to fit inside this bound, which is why it can be narrower
 * than `AGENT_SILENCE_MS` instead of wider.
 *
 * Thirty polls then buys three things that are each real rather than hypothetical: a dropped poll
 * on the terminal-to-connector hop, a unit polling late because it is busy applying an enrolment
 * (`Delay` is a floor, not a guarantee), and clock skew between the connector and the cloud — the
 * Pi has no battery-backed clock and `lastSeenAt` is stamped on its side. It also survives
 * somebody raising `Delay` to two minutes without crying wolf.
 *
 * Being late costs a delayed alert; being early costs an operator who learns to ignore the badge.
 * Device 6 was green for eighteen hours, so the asymmetry here is not close.
 */
export const TERMINAL_SILENCE_POLLS = 30;

/** Fifteen minutes, derived from the interval the terminal was actually told to use. */
export const TERMINAL_SILENCE_MS = TA_PUSH_POLL_SECONDS * TERMINAL_SILENCE_POLLS * 1000;

/**
 * Whether a terminal's last contact is too old to support a claim that it is online.
 *
 * Pure, and null is **not** silent: a connector that has just started has observed nothing, so a
 * null timestamp is indistinguishable from a restart and calling it dead would put a false alarm
 * on the dashboard on every service restart. The caller handles that case by never reaching here
 * for a report that is not claiming `online`.
 *
 * A timestamp in the future is not silent either. A connector whose clock runs ahead of the
 * cloud's would otherwise produce a negative age, and arithmetic that treats that as stale would
 * mark a perfectly healthy site offline for being early.
 */
export function terminalIsSilent(
  report: { lastSeenAt: Date | null },
  now: Date = new Date(),
  windowMs: number = TERMINAL_SILENCE_MS,
): boolean {
  if (report.lastSeenAt === null) return false;

  return now.getTime() - report.lastSeenAt.getTime() > windowMs;
}

/**
 * What the operator reads on a terminal whose connector is fine and which has stopped reporting.
 *
 * Quotes the absolute instant and never an elapsed duration. A message that said "47 minutes ago"
 * would differ on every beat, and the route only rewrites `lastErrorAt` when the message changes —
 * so a ticking message would move the timestamp every sixty seconds and destroy the record of when
 * the silence began.
 */
export function terminalSilenceReason(lastSeenAt: Date, windowMs: number): string {
  const minutes = Math.round(windowMs / 60_000);

  return (
    `Terminal ini tidak melaporkan apa-apa sejak ${lastSeenAt
      .toISOString()
      .slice(0, 16)
      .replace('T', ' ')} UTC, melebihi had ${String(minutes)} minit. Connectornya masih ` +
    'melaporkan, jadi ini terminal itu sendiri — periksa kuasa, rangkaian LAN, dan tetapan ' +
    'pelayan awan pada unit itu.'
  ).slice(0, 500);
}

/**
 * The status and message to store for one reported terminal.
 *
 * Returns both fields the heartbeat route writes, so the pass-through branches hand the connector's
 * own values straight back and only the stale branch substitutes anything. That keeps the route
 * byte-identical to its previous behaviour everywhere this rule does not fire.
 *
 * The five branches, in order:
 *
 *  - a request-response protocol is **exempt**. The connector dials those units, so a failure is
 *    observable and already flips the report to `offline`; and its pull interval is configurable
 *    up to an hour, so silence there is not evidence of anything. A fifteen-minute bound would
 *    mark a terminal being successfully pulled every half hour as dead.
 *  - a report that is not claiming `online` passes through. `offline` with the connector's own
 *    message is better information than a timestamp, and `unknown` is the fresh-start case below.
 *  - `online` with no timestamp becomes `unknown`. There is no evidence for the claim, and from
 *    the report alone this is indistinguishable from a connector that restarted a second ago —
 *    which must never be called dead. Grey, not green.
 *  - `online` inside the window stays `online`.
 *  - `online` outside it becomes `offline`, with prose naming the instant. On a callback protocol
 *    silence past the advertised interval is positive evidence, not absent evidence.
 */
export function reportedDeviceStatus(
  report: Pick<AgentDeviceReport, 'status' | 'lastSeenAt' | 'lastError'>,
  protocol: string,
  now: Date = new Date(),
  windowMs: number = TERMINAL_SILENCE_MS,
): { status: DeviceStatus; lastError: string | null } {
  const claimed = { status: report.status, lastError: report.lastError };

  if (!isCallbackProtocol(protocol)) return claimed;
  if (report.status !== DeviceStatus.online) return claimed;
  if (report.lastSeenAt === null) {
    return { status: DeviceStatus.unknown, lastError: claimed.lastError };
  }
  if (!terminalIsSilent(report, now, windowMs)) return claimed;

  return {
    status: DeviceStatus.offline,
    lastError: terminalSilenceReason(report.lastSeenAt, windowMs),
  };
}
