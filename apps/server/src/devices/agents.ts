import { createHash, randomBytes } from 'node:crypto';

import { AgentStatus } from '@attendance/shared';
import type { Device, DeviceAgent, Prisma } from '@prisma/client';

import { db } from '../db.js';
import { logger } from '../logger.js';

/**
 * Credentials for on-site connectors.
 *
 * Only hashes are stored, so a database dump does not hand over the ability to post
 * attendance for a site. The value is shown once, when it is issued, and if it is lost the
 * answer is to re-enrol rather than to reveal.
 *
 * Modelled on `api/tokens.ts` deliberately — same hash, same prefix idea, same refusal to
 * tell the caller why it was refused. Two credentials that behave differently for no reason
 * are two credentials somebody has to remember the difference between.
 *
 * ## Why two prefixes rather than one
 *
 * An enrolment token and a working credential look identical on the wire and are worth
 * wildly different amounts. Distinct prefixes mean a value pasted into the wrong field is
 * refused on a string comparison instead of after a database lookup, a leaked value's
 * *purpose* is greppable and not just its existence, and a log line can say which kind of
 * credential was rejected without holding either.
 */

/** A working agent credential. Long-lived, held in a root-only file on the connector. */
const AGENT_PREFIX = 'hkag_';

/** A single-use enrolment token. Exchanged once, then worthless. */
const ENROL_PREFIX = 'hken_';

/** 24 bytes is 192 bits. Guessing is not a threat model at that width. */
const SECRET_BYTES = 24;

/**
 * How long an enrolment token stays usable.
 *
 * Short because it travels badly by nature: it is typed into an installer command, which puts
 * it in shell history on a machine that may sit in a corridor, and in the installer's own log.
 * An hour is enough to walk to the Raspberry Pi and run one command, and short enough that a
 * token found in `~/.bash_history` next week is already useless.
 */
export const ENROL_TOKEN_TTL_MS = 60 * 60_000;

/**
 * Hashes a credential with SHA-256.
 *
 * Fast on purpose, and for the same reason API tokens are: a slow KDF exists to make guessing
 * a low-entropy human choice expensive, and these are 192 bits of randomness. A KDF here would
 * add latency to a request that arrives every few seconds from every site and buy nothing.
 * Storing the hash also keeps verification a single indexed lookup.
 */
function hashCredential(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export interface IssuedAgentSecret {
  /** The only moment the full value exists outside the caller's hands. */
  secret: string;
  prefix: string;
  secretHash: string;
}

export function issueAgentSecret(): IssuedAgentSecret {
  // base64url so the value survives a header, a systemd unit file and a shell argument
  // without escaping.
  const raw = randomBytes(SECRET_BYTES).toString('base64url');
  const secret = `${AGENT_PREFIX}${raw}`;

  return {
    secret,
    // Enough to recognise which credential a log line is about, far too little to use.
    prefix: `${AGENT_PREFIX}${raw.slice(0, 8)}`,
    secretHash: hashCredential(secret),
  };
}

export interface IssuedEnrolToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export function issueEnrolToken(): IssuedEnrolToken {
  const token = `${ENROL_PREFIX}${randomBytes(SECRET_BYTES).toString('base64url')}`;

  return {
    token,
    tokenHash: hashCredential(token),
    expiresAt: new Date(Date.now() + ENROL_TOKEN_TTL_MS),
  };
}

/** A stable, non-guessable public name for an agent, used in logs and on the wire. */
export function issueAgentKey(): string {
  return `agent_${randomBytes(12).toString('base64url')}`;
}

export interface AgentIdentity {
  id: number;
  agentKey: string;
  name: string;
  /**
   * What the cloud currently believes about this connector's build and LAN address.
   *
   * Carried on the identity because the row has already been read to verify the credential, so a
   * route that only wants to know whether a reported value *changed* can find out for free. The
   * alternative was a second `findUnique` on the hot path of every heartbeat.
   */
  version: string | null;
  lanHost: string | null;
  lanPort: number | null;
}

export type AgentRejection =
  | 'missing'
  | 'malformed'
  | 'unknown'
  /** Row exists but enrolment was never completed, so there is no credential to match. */
  | 'pending'
  | 'revoked';

export type AgentResult =
  | { ok: true; identity: AgentIdentity }
  | { ok: false; reason: AgentRejection };

/**
 * Reads the credential out of a request.
 *
 * `Authorization: Bearer <secret>` only. `api/tokens.ts` also accepts `X-Api-Key` because
 * third-party integration tools exist that cannot set an Authorization header, and refusing
 * them only produced tokens pasted into query strings where access logs keep them. No such
 * pressure applies here: the only client is our own agent, so the narrower rule costs nothing.
 */
export function readAgentCredential(headers: Record<string, unknown>): string | null {
  const authorization = headers['authorization'];
  if (typeof authorization !== 'string') return null;

  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

/**
 * Verifies an agent credential and records the contact.
 *
 * Every rejection is distinguished internally so a log line can say why, but the caller is
 * told only that the credential was refused. Telling an unauthenticated client the difference
 * between "unknown" and "revoked" confirms which of its guesses named a real site.
 *
 * ## The status checks below are defence, not the main path
 *
 * `revokeAgent()` clears `secretHash`, so a credential withdrawn through this application never
 * reaches them — the lookup simply finds nothing and answers `unknown`. They exist for a row
 * whose status was changed by some other means: a future administrative route, a support fix
 * applied in SQL, a restored backup. Without them, such a row would keep authenticating because
 * its hash still matched, and the status column would be decoration.
 */
export async function verifyAgentSecret(
  raw: string | null,
  address?: string,
): Promise<AgentResult> {
  if (raw === null || raw.length === 0) return { ok: false, reason: 'missing' };
  if (!raw.startsWith(AGENT_PREFIX)) return { ok: false, reason: 'malformed' };

  const agent = await db().deviceAgent.findFirst({
    where: { secretHash: hashCredential(raw) },
  });
  if (!agent) return { ok: false, reason: 'unknown' };

  if (agent.status === AgentStatus.revoked) return { ok: false, reason: 'revoked' };
  if (agent.status === AgentStatus.pending) return { ok: false, reason: 'pending' };

  /**
   * `lastSeenAt` means the last authenticated contact of any kind, not only a heartbeat.
   *
   * An agent that is posting events every few seconds is plainly alive even if its heartbeat
   * is failing for its own reasons, and a screen that called that agent dead would send
   * somebody to a site where everything is working.
   *
   * Awaited, but unable to fail the request.
   *
   * It was `void` with a swallowed rejection, which read as the cautious choice and was the
   * opposite. The request goes on to do database work regardless, so detaching this bought no
   * latency — it only meant an unordered write racing whatever the route did next to the same
   * `device_agents` row, and on a heartbeat the route wrote this very column. Awaiting makes the
   * ordering deterministic and the two statements sequential; the `catch` keeps the original
   * intent, which is that a site waiting on an answer must not be refused because a visibility
   * stamp could not be stored.
   */
  await db()
    .deviceAgent.update({
      where: { id: agent.id },
      data: {
        lastSeenAt: new Date(),
        ...(address === undefined ? {} : { lastAddress: address.slice(0, 45) }),
      },
    })
    .catch(() => undefined);

  return {
    ok: true,
    identity: {
      id: agent.id,
      agentKey: agent.agentKey,
      name: agent.name,
      version: agent.version,
      lanHost: agent.lanHost,
      lanPort: agent.lanPort,
    },
  };
}

export interface EnrolReport {
  /** Build the connector is running, so a site on old code is visible before it is debugged. */
  version?: string | undefined;
  /** LAN address the terminals at this site should be pointed at. */
  lanHost?: string | undefined;
  lanPort?: number | undefined;
  address?: string | undefined;
}

export type EnrolResult =
  | { ok: true; agent: DeviceAgent; secret: string }
  | { ok: false; reason: 'malformed' | 'unknown' | 'expired' | 'used' };

/**
 * Exchanges a single-use enrolment token for a working credential.
 *
 * ## Why this is a compare-and-swap and not read-then-write
 *
 * The token must be usable exactly once. Reading the row, checking it, then writing the new
 * secret leaves a window where two installers running the same token both pass the check and
 * the second overwrites the first — leaving one Raspberry Pi holding a credential that no
 * longer verifies, and an operator with no reason to suspect why.
 *
 * So the token hash stays in the `WHERE` clause of the write itself, and the token is cleared
 * in the same statement. `count === 1` is then proof this call is the one that claimed it;
 * `count === 0` means somebody else already did.
 *
 * An expired token is reported as expired rather than unknown, because unlike a guessed
 * credential this one was genuinely issued by us — the person holding it needs to be told to
 * ask for another, not left wondering whether they mistyped it.
 *
 * ## A token already consumed is indistinguishable from one never issued
 *
 * Both answer `unknown`, and that is a knowing trade rather than an oversight. Telling them
 * apart would mean keeping the hash after consuming it, which leaves a second credential for
 * the site that nothing tracks and nothing expires — the exact risk clearing it removes.
 *
 * `used` is therefore narrower than it looks: it is the race-loser's answer, returned when two
 * installers run the same token closely enough that both pass the lookup and only one wins the
 * write. Expiry is the case worth naming precisely, because there the row is still there to
 * name it with.
 */
export async function exchangeEnrolToken(
  raw: string | null,
  report: EnrolReport = {},
): Promise<EnrolResult> {
  if (raw === null || !raw.startsWith(ENROL_PREFIX)) return { ok: false, reason: 'malformed' };

  const prisma = db();
  const tokenHash = hashCredential(raw);

  const existing = await prisma.deviceAgent.findFirst({
    where: { enrolTokenHash: tokenHash },
    select: { id: true, enrolExpiresAt: true },
  });
  if (!existing) return { ok: false, reason: 'unknown' };

  const now = new Date();
  if (existing.enrolExpiresAt !== null && existing.enrolExpiresAt <= now) {
    return { ok: false, reason: 'expired' };
  }

  const issued = issueAgentSecret();

  const claimed = await prisma.deviceAgent.updateMany({
    // The token hash is part of the write, so only one caller can win.
    where: { id: existing.id, enrolTokenHash: tokenHash },
    data: {
      secretHash: issued.secretHash,
      secretPrefix: issued.prefix,
      // Cleared in the same statement that consumes it. A token left behind is a second
      // credential for the same site that nobody is tracking.
      enrolTokenHash: null,
      enrolExpiresAt: null,
      enrolledAt: now,
      status: AgentStatus.active,
      revokedAt: null,
      ...(report.version === undefined ? {} : { version: report.version.slice(0, 32) }),
      ...(report.lanHost === undefined ? {} : { lanHost: report.lanHost.slice(0, 190) }),
      ...(report.lanPort === undefined ? {} : { lanPort: report.lanPort }),
      ...(report.address === undefined ? {} : { lastAddress: report.address.slice(0, 45) }),
      lastSeenAt: now,
    },
  });

  if (claimed.count !== 1) return { ok: false, reason: 'used' };

  const agent = await prisma.deviceAgent.findUniqueOrThrow({ where: { id: existing.id } });

  logger().info(
    { agentId: agent.id, agentKey: agent.agentKey, prefix: issued.prefix },
    'Connector completed enrolment',
  );

  return { ok: true, agent, secret: issued.secret };
}

/**
 * Issues a fresh enrolment token for an existing agent, so it can be re-installed.
 *
 * Does **not** clear `secretHash`. The connector already deployed keeps working until the new
 * one enrols, because revoking first would stop a site collecting attendance during however
 * long it takes somebody to reach the Raspberry Pi.
 */
export async function reissueEnrolToken(agentId: number): Promise<IssuedEnrolToken> {
  const issued = issueEnrolToken();

  await db().deviceAgent.update({
    where: { id: agentId },
    data: { enrolTokenHash: issued.tokenHash, enrolExpiresAt: issued.expiresAt },
  });

  return issued;
}

/**
 * Withdraws an agent's credential.
 *
 * The devices stay attached. Detaching them would silently convert them to direct and the
 * server would start dialling addresses it cannot route, so a revoked agent leaves its
 * terminals plainly stranded instead of apparently broken.
 */
export async function revokeAgent(agentId: number): Promise<void> {
  await db().deviceAgent.update({
    where: { id: agentId },
    data: {
      status: AgentStatus.revoked,
      revokedAt: new Date(),
      secretHash: null,
      enrolTokenHash: null,
      enrolExpiresAt: null,
    },
  });
}

/**
 * The only scope an agent has: the devices assigned to it.
 *
 * Expressed as a `where` fragment rather than a stored list of permissions, and that is the
 * point. A scope list is a second copy of the truth that has to be kept in step with
 * `Device.agentId` — and the copy that drifts is the one deciding whether a site may write
 * attendance for a terminal in another building. Here the assignment *is* the scope, so they
 * cannot disagree.
 *
 * Every agent route composes this. None of them takes a device id on trust.
 */
export function agentDeviceWhere(agentId: number): Prisma.DeviceWhereInput {
  return { agentId, active: true };
}

/**
 * Resolves one device, but only if this agent owns it.
 *
 * Returns null for a device that exists and belongs to another site, exactly as for one that
 * does not exist at all. An agent must not be able to learn that a terminal id is real by
 * being refused differently.
 */
export async function agentDevice(agentId: number, deviceId: number): Promise<Device | null> {
  return db().device.findFirst({ where: { ...agentDeviceWhere(agentId), id: deviceId } });
}

/** Devices this agent is responsible for. */
export async function agentDevices(agentId: number): Promise<Device[]> {
  return db().device.findMany({ where: agentDeviceWhere(agentId), orderBy: { id: 'asc' } });
}
