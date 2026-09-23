import { z } from 'zod';

import { AgentStatus, DeviceStatus, PunchDirection, RawEventKind, VerifyMethod } from '../enums.js';

/**
 * Wire contract between an on-site connector and the cloud.
 *
 * Lives in `shared` because both sides read it, and a second copy is the failure this whole
 * file exists to prevent: an agent posting a field the cloud silently drops looks exactly like
 * a site where nobody scanned. One definition, parsed on arrival, and a mismatch becomes a 400
 * naming the field instead of a quiet gap in the attendance record.
 *
 * ## Direction of travel
 *
 * Everything is agent-initiated. The cloud never opens a connection to a site, which is what
 * lets a hospital publish one outbound firewall rule and no inbound one at all. So "pull
 * commands" here is an HTTP request *from* the agent, and the cloud's replies are ordinary
 * response bodies.
 */

/**
 * One terminal event as JSON.
 *
 * Mirrors `TerminalEvent` in the server's driver layer, with `at` as an ISO string because JSON
 * has no date. The parsed result is deliberately assigned to `TerminalEvent[]` at the route, so
 * if this schema and that interface ever drift the build fails — rather than the extra field
 * being dropped and the event stored incomplete.
 *
 * Every nullable field here is nullable there for the same reason: null means "this protocol
 * has no such concept", not "reading it failed". Collapsing those two would leave a screen
 * unable to tell an operator which one they are looking at.
 */
export const terminalEventWireSchema = z.strictObject({
  /** Dedup identity. This is what makes a retried batch harmless. */
  eventKey: z.string().min(1).max(96),
  kind: z.enum(RawEventKind),
  verifyMethod: z.enum(VerifyMethod).nullable(),
  /** ISO 8601 with offset. Coerced to a Date so the route hands `storeEvents` what it expects. */
  at: z.coerce.date(),
  employeeNo: z.string().max(32).nullable(),
  personName: z.string().max(128).nullable(),
  /**
   * Monotonic sequence where the protocol has one, null for callback protocols.
   *
   * Hikvision's serial exceeds signed INT32, which is why the column behind it is BIGINT. It
   * stays a JSON number here because it is still well inside the range JavaScript integers
   * represent exactly.
   */
  sequence: z.number().int().nonnegative().nullable(),
  direction: z.enum(PunchDirection).nullable(),
  cardNo: z.string().max(32).nullable(),
  doorNo: z.number().int().nullable(),
  readerNo: z.number().int().nullable(),
  pictureUrl: z.string().max(255).nullable(),
  native: z.strictObject({
    major: z.number().int().nullable(),
    minor: z.number().int().nullable(),
    verifyMode: z.string().max(48).nullable(),
    maskWorn: z.string().max(8).nullable(),
    direction: z.string().max(16).nullable(),
  }),
  /** Original vendor payload, kept verbatim as evidence. Shape is deliberately unconstrained. */
  payload: z.unknown(),
});

export type TerminalEventWire = z.infer<typeof terminalEventWireSchema>;

/**
 * Upper bound on one batch.
 *
 * `storeEvents` runs a lookup, an insert and a punch derivation per event, serially and
 * without a transaction, so cost scales linearly and a large batch becomes a long-held
 * request. Two hundred keeps a worst case around a few seconds while being far above the
 * normal case, which is nought to thirty.
 *
 * The agent chunks anything larger. It has to anyway: a site catching up after a day offline
 * has thousands spooled, and one request carrying all of them would fail on the body limit
 * before it ever reached this check.
 */
export const AGENT_EVENT_BATCH_MAX = 200;

export const agentEventBatchSchema = z.strictObject({
  deviceId: z.number().int().positive(),
  /**
   * Whether the agent received these or went and fetched them.
   *
   * Passed straight through to `RawEvent.arrivedVia`, which already means exactly this and is
   * how the devices screen shows whether push delivery is keeping up. Deliberately not a third
   * value like `agent`: that would answer "which connector" in a column that answers "did push
   * work", and the existing counters read exactly two values.
   */
  arrivedVia: z.enum(['push', 'pull']),
  events: z.array(terminalEventWireSchema).min(1).max(AGENT_EVENT_BATCH_MAX),
});

export type AgentEventBatch = z.infer<typeof agentEventBatchSchema>;

/**
 * What the agent reports about one terminal on each heartbeat.
 *
 * The cloud cannot probe these itself — that is the entire reason an agent exists — so this is
 * the only source for them. It is a snapshot from the agent's last contact with the unit, not
 * a live reading, and the screen has to say so.
 */
export const agentDeviceReportSchema = z.strictObject({
  deviceId: z.number().int().positive(),
  status: z.enum(DeviceStatus),
  /** Seconds the terminal's clock is away from the agent's. Null when not measured. */
  clockDriftS: z.number().int().nullable(),
  lastSeenAt: z.coerce.date().nullable(),
  lastError: z.string().max(500).nullable(),
  serialNumber: z.string().max(96).nullable(),
  firmware: z.string().max(32).nullable(),
  model: z.string().max(64).nullable(),
});

export type AgentDeviceReport = z.infer<typeof agentDeviceReportSchema>;

export const agentHeartbeatSchema = z.strictObject({
  version: z.string().max(32),
  /**
   * LAN address the terminals at this site are pointed at.
   *
   * Reported rather than configured centrally because only the agent knows which interface it
   * is reachable on, and a DHCP lease can move it. The devices screen shows this instead of the
   * cloud address for any terminal behind this agent.
   */
  lanHost: z.string().max(190).nullable(),
  lanPort: z.number().int().min(1).max(65535).nullable(),
  /** Events held on disk that have not been accepted yet. A rising number means trouble. */
  spooled: z.number().int().nonnegative(),
  devices: z.array(agentDeviceReportSchema).max(200),
});

export type AgentHeartbeat = z.infer<typeof agentHeartbeatSchema>;

export const agentEnrolSchema = z.strictObject({
  token: z.string().min(1).max(128),
  version: z.string().max(32),
  lanHost: z.string().max(190).nullable(),
  lanPort: z.number().int().min(1).max(65535).nullable(),
});

export type AgentEnrol = z.infer<typeof agentEnrolSchema>;

/**
 * Outcome of one command the agent collected and ran.
 *
 * `ok` is a boolean and not a vendor return code on purpose. ZKTeco's TA Push reports success
 * as `Return=0`, which is inverted from the usual convention and has already been read the
 * obvious way once — recording every success as a failure and leaving a queue that never
 * appeared to drain. The driver resolves that; the wire carries the decision.
 */
export const agentCommandOutcomeSchema = z.strictObject({
  ok: z.boolean(),
  result: z.string().max(500),
});

export type AgentCommandOutcome = z.infer<typeof agentCommandOutcomeSchema>;

// ---------------------------------------------------------------------------
// Responses. Produced by the cloud, so these are types rather than schemas.
// ---------------------------------------------------------------------------

/**
 * Connection details for one terminal the agent is responsible for.
 *
 * ## This carries the terminal credential, and that is a deliberate trade
 *
 * The agent has to authenticate to the unit — there is no way to perform a reconcile pull or
 * push a face without it. So the password is decrypted by the cloud and sent here over TLS,
 * and the agent holds it for as long as it runs.
 *
 * What that costs: a compromised connector yields the door credentials for its own site. What
 * bounds it: the roster only ever contains devices assigned to this agent, so one site cannot
 * obtain another's. That per-site scoping is the reason `Device.agentId` is the scope rather
 * than a stored permission list.
 *
 * The alternative — keeping credentials only on the Pi and never in the cloud — was not
 * available, because the same credentials are needed by a direct installation and by every
 * device-editing screen.
 */
export interface AgentDeviceAssignment {
  deviceId: number;
  name: string;
  vendor: string;
  protocol: string;
  host: string;
  port: number;
  useHttps: boolean;
  verifyTls: boolean;
  username: string | null;
  /** Plaintext, for this site's own terminals only. Never logged, never persisted by the agent. */
  password: string | null;
  serialNumber: string | null;
  firmware: string | null;
  doorNo: number;
  /** Where the reconcile pull should resume from, so the agent does not refetch history. */
  cursor: { sequence: number | null; since: string | null };
}

export interface AgentHeartbeatReply {
  /**
   * The cloud's own time, ISO 8601.
   *
   * The agent sets terminal clocks from this and never from its own. A Raspberry Pi has no
   * battery-backed clock: booted without a network it starts at an arbitrary time, and an agent
   * that wrote that to fifteen terminals would corrupt every attendance timestamp at the site
   * while looking authoritative. Until this value has been seen, the agent refuses to set a
   * clock at all.
   */
  now: string;
  /** Terminals this agent serves, with what it needs to reach them. */
  devices: AgentDeviceAssignment[];
}

export interface AgentCommandItem {
  commandId: string;
  deviceId: number;
  /** Neutral intent: `person.upsert`, `face.enroll`, `reboot`, and so on. */
  kind: string;
  /** Protocol-shaped body. The agent hands it to the driver without interpreting it. */
  payload: string;
}

export interface AgentEnrolReply {
  agentKey: string;
  name: string;
  /** Shown once. There is no endpoint that returns it again; losing it means re-enrolling. */
  secret: string;
  status: typeof AgentStatus.active;
}
