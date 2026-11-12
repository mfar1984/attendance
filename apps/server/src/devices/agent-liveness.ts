import { AgentStatus, DeviceStatus } from '@attendance/shared';

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
