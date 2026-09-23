import {
  agentCommandOutcomeSchema,
  agentEnrolSchema,
  agentEventBatchSchema,
  agentHeartbeatSchema,
  type AgentCommandItem,
  type AgentDeviceAssignment,
  type AgentEnrolReply,
  type AgentHeartbeatReply,
} from '@attendance/shared';
import type { Device, Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../db.js';
import { decryptSecret } from '../crypto.js';
import {
  agentDevice,
  agentDevices,
  exchangeEnrolToken,
  readAgentCredential,
  verifyAgentSecret,
  type AgentIdentity,
} from '../devices/agents.js';
import {
  recordOutcome,
  takePendingForDevices,
} from '../devices/driver/commands.js';
import type { TerminalEvent } from '@attendance/terminal-drivers';
import { badRequest, notFound, parseBody, unauthorized } from '../http.js';
import { storeEvents } from '../ingest/store.js';
import { logger } from '../logger.js';

/**
 * Endpoints an on-site connector talks to.
 *
 * Every request here is agent-initiated, including the ones that look like the cloud giving
 * instructions. That is the property the whole topology rests on: a hospital publishes one
 * outbound firewall rule and no inbound one, and the terminals need no route to the internet
 * at all. Commands are therefore *collected*, never delivered.
 *
 * ## What an agent is trusted to do, and what it is not
 *
 * It may post raw events for its own terminals and report on commands it collected. It may not
 * derive punches, resolve identity, or write anything the attendance engine reads directly.
 * Those stay in the cloud on the one engine, reading the same `storeEvents` path a direct
 * installation uses — because two engines produce two answers for the same day, and nobody
 * checks the second one.
 *
 * Scope is `Device.agentId` and nothing else. No route takes a device id on trust.
 */

export const AGENT_PATH = '/agent';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set once an agent request has been authenticated. */
    agent?: AgentIdentity;
  }
}

/** Commands handed over in one poll. Matches the callback-terminal batch size. */
const COMMANDS_PER_POLL = 20;

/**
 * Bodies carry a full vendor payload per event, and a face command carries a photograph.
 *
 * Raised from Fastify's 1 MB default because the default is a limit on *our* protocol rather
 * than on anything an attacker gains from: the credential is checked before the body is read,
 * and an authenticated site posting two hundred events with snapshots legitimately exceeds it.
 */
const AGENT_BODY_LIMIT = 8 * 1024 * 1024;

function clientAddress(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return (forwarded.split(',')[0] ?? request.ip).trim();
  }
  return request.ip;
}

/**
 * Authenticates an agent.
 *
 * Rejections are logged with their internal reason and answered with one message, for the same
 * reason the public API does it: telling an unauthenticated caller the difference between
 * "unknown" and "revoked" confirms which of its guesses named a real site.
 */
async function requireAgent(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const address = clientAddress(request);
  const result = await verifyAgentSecret(readAgentCredential(request.headers), address);

  if (!result.ok) {
    logger().warn(
      { reason: result.reason, address, url: request.url },
      'Rejected a connector request',
    );
    throw unauthorized('Kredensial connector tidak sah atau tiada');
  }

  request.agent = result.identity;
}

/** The authenticated agent, or a refusal. Never returns undefined to a route body. */
function agentOf(request: FastifyRequest): AgentIdentity {
  if (!request.agent) throw unauthorized('Kredensial connector tidak sah atau tiada');
  return request.agent;
}

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Exchanges a single-use enrolment token for a working credential.
   *
   * The only unauthenticated route here, because the whole point is that the agent has no
   * credential yet. The token is its own authentication: single use, expiring within the hour,
   * and worthless afterwards.
   */
  app.post(`${AGENT_PATH}/enrol`, async (request, reply) => {
    const body = parseBody(agentEnrolSchema, request.body);
    const address = clientAddress(request);

    const result = await exchangeEnrolToken(body.token, {
      version: body.version,
      lanHost: body.lanHost ?? undefined,
      lanPort: body.lanPort ?? undefined,
      address,
    });

    if (!result.ok) {
      logger().warn({ reason: result.reason, address }, 'Rejected a connector enrolment');

      /**
       * An expired token is named as expired; everything else is one message.
       *
       * The distinction is worth making here and nowhere else in this file: an expired token
       * was genuinely issued by us, so the person holding it needs to be told to ask for
       * another rather than left wondering whether they mistyped it. A token nobody issued
       * gets no such help.
       */
      if (result.reason === 'expired') {
        throw badRequest(
          'Token pendaftaran ini sudah luput. Jana token baharu pada skrin Senarai Peranti ' +
            'dan jalankan pemasang semula.',
        );
      }
      throw unauthorized('Token pendaftaran tidak sah');
    }

    const payload: AgentEnrolReply = {
      agentKey: result.agent.agentKey,
      name: result.agent.name,
      secret: result.secret,
      status: 'active',
    };

    // The credential appears in this response and in no other. A store here would put it in a
    // shared cache on the way back through any proxy.
    reply.header('cache-control', 'no-store');
    return payload;
  });

  /**
   * Liveness, the device snapshot, and the roster going back.
   *
   * Carries state in both directions on purpose. An agent that had to call three endpoints to
   * learn what it serves would have three chances to be half-configured, and the cheapest way
   * to keep a site's picture consistent is to send the whole picture at once.
   */
  app.post(
    `${AGENT_PATH}/heartbeat`,
    { preHandler: requireAgent },
    async (request, reply): Promise<AgentHeartbeatReply> => {
      const agent = agentOf(request);
      const body = parseBody(agentHeartbeatSchema, request.body);
      const prisma = db();

      /**
       * Only what actually changed, and nothing at all on a normal beat.
       *
       * `lastSeenAt` and `lastAddress` are deliberately absent: `verifyAgentSecret` stamped them
       * moments ago in this same request, for every authenticated agent call rather than only this
       * one. Writing them again here meant two UPDATEs racing for the same `device_agents` row on
       * every heartbeat, with the fire-and-forget stamp free to land *after* this statement and
       * overwrite it — a genuine lost update, and two row locks for one request.
       *
       * What remains — build and LAN address — changes when a connector is upgraded or its DHCP
       * lease moves, and not otherwise. So the steady state is now zero writes from this route,
       * and the one write left is the liveness stamp that every other agent route also performs.
       */
      const changed: Prisma.DeviceAgentUpdateInput = {
        ...(body.version === agent.version ? {} : { version: body.version }),
        ...(body.lanHost === agent.lanHost ? {} : { lanHost: body.lanHost }),
        ...(body.lanPort === agent.lanPort ? {} : { lanPort: body.lanPort }),
      };

      if (Object.keys(changed).length > 0) {
        await prisma.deviceAgent.update({ where: { id: agent.id }, data: changed });
      }

      /**
       * Device status comes from the agent because the cloud cannot measure it.
       *
       * Applied one device at a time through the ownership check rather than in a single
       * `updateMany`, so a report naming a terminal at another site changes nothing instead of
       * being filtered by a clause somebody could later edit.
       */
      for (const report of body.devices) {
        const owned = await agentDevice(agent.id, report.deviceId);
        if (!owned) {
          logger().warn(
            { agentId: agent.id, deviceId: report.deviceId },
            'Connector reported on a device it does not serve',
          );
          continue;
        }

        await prisma.device.update({
          where: { id: owned.id },
          data: {
            status: report.status,
            clockDriftS: report.clockDriftS,
            lastSeenAt: report.lastSeenAt,
            lastError: report.lastError,
            lastErrorAt: report.lastError === null ? null : new Date(),
            ...(report.serialNumber === null ? {} : { serialNumber: report.serialNumber }),
            ...(report.firmware === null ? {} : { firmware: report.firmware }),
            ...(report.model === null ? {} : { model: report.model }),
          },
        });
      }

      if (body.spooled > 0) {
        logger().info(
          { agentId: agent.id, spooled: body.spooled },
          'Connector is holding undelivered events',
        );
      }

      reply.header('cache-control', 'no-store');
      return { now: new Date().toISOString(), devices: await rosterFor(agent.id) };
    },
  );

  /**
   * Raw events from one terminal.
   *
   * Idempotent, and that is what makes the agent's spool safe: a batch may be posted twice
   * because the acknowledgement was lost, and `storeEvents` dedups on `(deviceId, eventKey)`.
   * The agent deletes from its spool only after a 200, so the failure mode is a duplicate
   * delivery rather than a missing scan.
   */
  app.post(
    `${AGENT_PATH}/events`,
    { preHandler: requireAgent, bodyLimit: AGENT_BODY_LIMIT },
    async (request) => {
      const agent = agentOf(request);
      const body = parseBody(agentEventBatchSchema, request.body);

      const device = await agentDevice(agent.id, body.deviceId);
      // 404 rather than 403: a terminal at another site must be indistinguishable from one that
      // does not exist, or an agent can enumerate device ids by how it is refused.
      if (!device) throw notFound('Terminal tidak dijumpai');

      /**
       * Assigned to the driver-layer type on purpose.
       *
       * This is the line that keeps the wire schema and `TerminalEvent` in step: if either
       * grows a field the other lacks, the build fails here rather than the field being
       * silently dropped on arrival and the event stored incomplete.
       */
      const events: TerminalEvent[] = body.events;

      const outcome = await storeEvents(device, events, body.arrivedVia);

      /**
       * `lastPushAt` tracks the freshest delivery for this device regardless of which side
       * fetched it, so the devices screen keeps meaning what it meant for a direct install.
       */
      await db().deviceSyncState.upsert({
        where: { deviceId: device.id },
        create: { deviceId: device.id, lastPushAt: new Date() },
        update: { lastPushAt: new Date() },
      });

      return { accepted: events.length, ...outcome };
    },
  );

  /**
   * Commands waiting for this agent's terminals.
   *
   * Collected, not pushed. Rows move to `sent` here, which means handed to the *agent* — it is
   * now the thing that owes an outcome. Anything it takes and never reports on is re-offered
   * by the stale sweep in the sync worker.
   */
  app.get(`${AGENT_PATH}/commands`, { preHandler: requireAgent }, async (request, reply) => {
    const agent = agentOf(request);
    const devices = await agentDevices(agent.id);

    const rows = await takePendingForDevices(
      devices.map((device) => device.id),
      COMMANDS_PER_POLL,
    );

    const items: AgentCommandItem[] = rows.map((row) => ({
      commandId: String(row.id),
      deviceId: row.deviceId,
      kind: row.kind,
      payload: row.payload,
    }));

    reply.header('cache-control', 'no-store');
    return { commands: items };
  });

  /**
   * What the agent made of a command it collected.
   *
   * The command id is checked against this agent's devices before anything is written. Without
   * that, one site could close another site's commands as succeeded, and the enrolment nobody
   * performed would look done.
   */
  app.post(
    `${AGENT_PATH}/commands/:commandId`,
    { preHandler: requireAgent },
    async (request) => {
      const agent = agentOf(request);
      const body = parseBody(agentCommandOutcomeSchema, request.body);

      const { commandId } = request.params as { commandId: string };
      if (!/^\d+$/.test(commandId)) throw badRequest('Id arahan tidak sah');

      const row = await db().deviceCommand.findFirst({
        where: { id: BigInt(commandId), device: { agentId: agent.id } },
        select: { id: true },
      });
      if (!row) throw notFound('Arahan tidak dijumpai');

      await recordOutcome(row.id, body.ok, body.result);
      return { ok: true };
    },
  );
}

/**
 * What the operator has to do, written where they will actually see it.
 *
 * Stored on the device row rather than only logged, because the log is on the cloud host and
 * the person who can fix this is looking at the devices screen. The remedy is named: the
 * ciphertext is unrecoverable, so the password has to be entered again.
 */
const UNREADABLE_CREDENTIAL =
  'Kata laluan tersimpan untuk terminal ini tidak dapat dinyahsulit dengan ENCRYPTION_KEY ' +
  'pemasangan ini. Buka peranti ini dan masukkan semula kata laluannya.';

/**
 * Withholds one terminal from the roster and records why.
 *
 * `decryptSecret` throws when the stored ciphertext was written under a different
 * `ENCRYPTION_KEY` — a database copied between installations, or a key regenerated after the
 * device was saved. The value cannot be recovered, so this terminal is unserviceable until
 * somebody re-enters its password, and there is nothing to be gained by offering it.
 *
 * Handing the agent `null` instead was rejected: for a direct protocol that reads as "no
 * password", so the connector would authenticate with nothing, fail, and retry — walking the
 * unit into the firmware's 30-minute lockout on a credential that was never going to work.
 */
async function withholdUnreadable(device: Device, error: unknown): Promise<void> {
  logger().error(
    { deviceId: device.id, device: device.name, err: error },
    'Device password could not be decrypted; withheld from the connector roster',
  );

  // Written once, not on every beat. This repeats every sixty seconds until the password is
  // re-entered, and rewriting the row each time would keep moving `lastErrorAt` forward and
  // bury when it actually started.
  if (device.lastError === UNREADABLE_CREDENTIAL) return;

  await db()
    .device.update({
      where: { id: device.id },
      data: { status: 'offline', lastError: UNREADABLE_CREDENTIAL, lastErrorAt: new Date() },
    })
    // A diagnostic that could not be stored must not fail the heartbeat the site depends on.
    .catch(() => undefined);
}

/**
 * Terminals an agent serves, with what it needs to reach each one.
 *
 * Includes the decrypted device password. That is unavoidable — an agent cannot perform a
 * reconcile pull or push a face without authenticating to the unit — and it is bounded by the
 * roster only ever holding devices assigned to this agent, so one site cannot obtain another's
 * door credentials.
 *
 * ## One bad row must not take the site down
 *
 * Decryption is per device and failures are contained, because this function's result is
 * carried by the heartbeat: an exception escaping here answered 500 to the whole request, so a
 * single unreadable password cost the site its liveness stamp, its roster for every *other*
 * terminal, and the cloud clock the connector refuses to set terminal time without. One
 * misconfigured device read as a completely dead site, and the response said nothing about
 * which device or why.
 */
async function rosterFor(agentId: number): Promise<AgentDeviceAssignment[]> {
  const devices = await agentDevices(agentId);
  if (devices.length === 0) return [];

  const cursors = await db().deviceSyncState.findMany({
    where: { deviceId: { in: devices.map((device) => device.id) } },
  });
  const cursorFor = new Map(cursors.map((row) => [row.deviceId, row]));

  const roster: AgentDeviceAssignment[] = [];

  for (const device of devices) {
    /**
     * Null stays null rather than becoming an empty string.
     *
     * A callback protocol genuinely has no stored password, and an empty one would reach the
     * wire, fail authentication, and count towards the firmware's lockout threshold.
     */
    let password: string | null;
    try {
      password = device.passwordEncrypted === null ? null : decryptSecret(device.passwordEncrypted);
    } catch (error) {
      await withholdUnreadable(device, error);
      continue;
    }

    const cursor = cursorFor.get(device.id);

    roster.push({
      deviceId: device.id,
      name: device.name,
      vendor: device.vendor,
      protocol: device.protocol,
      host: device.host,
      port: device.port,
      useHttps: device.useHttps,
      verifyTls: device.verifyTls,
      username: device.username,
      password,
      serialNumber: device.serialNumber,
      firmware: device.firmware,
      doorNo: device.doorNo,
      cursor: {
        sequence: cursor ? Number(cursor.lastSerialNo) : null,
        since: cursor?.lastSyncAt?.toISOString() ?? null,
      },
    });
  }

  return roster;
}
