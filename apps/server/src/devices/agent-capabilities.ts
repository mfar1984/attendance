/**
 * What each connector's build says it can drive.
 *
 * ## Why a connector has no type
 *
 * The obvious design is to pick one when the connector is created — ZKTeco or Hikvision — and it
 * was considered and rejected. Three reasons, in order of how much they cost:
 *
 * A typed connector cannot serve a mixed site. One build answers both delivery paths at once and
 * the roster picks a driver per assignment, so a Hikvision unit in the lobby and a SenseFace in
 * the clinic are already one connector. Typing it would split that into two Raspberry Pis for no
 * reason but a form field.
 *
 * It would be a second source of truth beside `Device.protocol`, free to disagree with the
 * terminal assigned to it — and the disagreement does not announce itself. It presents as a site
 * reading healthy while recording nothing, which is the failure this module exists to make
 * visible instead.
 *
 * And it would not help versioning, which was the original motivation. `AGENT_VERSION` is one
 * constant for one build; there is no per-vendor release to track.
 *
 * So the connector reports what its code can do, and the cloud compares that against what has
 * been assigned to it.
 *
 * ## Why this is not a column
 *
 * It is derived from the running build, so the only honest value is the one from the last
 * heartbeat. Stored, it would survive a connector being downgraded — and the row would then claim
 * a capability the site no longer has, which is the same class of lie as the type field above.
 * Memory loses it on restart, and the next heartbeat is a minute away; a connector that has not
 * reported yet reads as "not known", which is a state the screen can say out loud.
 *
 * It also means no migration, which matters for a change whose whole point is that the cloud can
 * be deployed before any site is touched.
 */

/** Keyed by `device_agents.id`. Replaced wholesale on each heartbeat that carries the field. */
const reported = new Map<number, { protocols: string[]; at: Date }>();

/**
 * Records what a connector just said it can drive.
 *
 * An absent field is not an empty list. A connector built before 0.3.0 sends nothing, and
 * treating that as "drives nothing" would flag every terminal at every existing site as
 * unsupported — a screen full of warnings about something that is working. So absent leaves the
 * previous answer alone, and "never reported" stays distinguishable from "reported none".
 */
export function noteAgentProtocols(agentId: number, protocols: string[] | undefined): void {
  if (protocols === undefined) return;
  reported.set(agentId, { protocols: [...new Set(protocols)], at: new Date() });
}

/** What a connector reported, or null when it has not reported since this process started. */
export function agentProtocols(agentId: number): { protocols: string[]; at: Date } | null {
  return reported.get(agentId) ?? null;
}

/** Drops a connector that no longer exists, so a reused id cannot inherit its answer. */
export function forgetAgentProtocols(agentId: number): void {
  reported.delete(agentId);
}

/**
 * Whether a connector's build can drive a terminal's protocol.
 *
 * Three answers, not two. `unknown` is the connector that has not reported — older code, or simply
 * not heard from yet — and it must not render as a problem: the site may be working perfectly, and
 * a warning there sends somebody to fix what is not broken.
 */
export type ProtocolSupport = 'supported' | 'unsupported' | 'unknown';

export function supportsProtocol(agentId: number, protocol: string): ProtocolSupport {
  const entry = reported.get(agentId);
  if (entry === undefined) return 'unknown';
  return entry.protocols.includes(protocol) ? 'supported' : 'unsupported';
}
