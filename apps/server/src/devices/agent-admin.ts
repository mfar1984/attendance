import { AgentStatus } from '@attendance/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requirePermission } from '../auth/plugin.js';
import { db, jsonSafe } from '../db.js';
import { loadEnv } from '../env.js';
import { conflict, notFound, parseBody } from '../http.js';
import {
  ENROL_TOKEN_TTL_MS,
  issueAgentKey,
  issueEnrolToken,
  reissueEnrolToken,
  revokeAgent,
} from './agents.js';

/**
 * Operator-facing routes for on-site connectors.
 *
 * Separate file from `devices/routes.ts` because the two answer different questions — one is about
 * terminals, the other about the machines that reach them — and `devices/routes.ts` is already the
 * length where a reader stops scrolling.
 *
 * ## Permission: `settings.devices`, not a new key
 *
 * Deliberately reused. A new permission key is absent from every role that already exists, so the
 * screen would answer 403 for everybody — including the super administrator — until somebody
 * edited each role. A feature that ships switched off for its own author is a feature nobody can
 * tell apart from a broken one.
 *
 * Connectors belong to the device screen anyway: whoever may add a terminal is whoever may add the
 * machine that reaches it.
 */

const agentInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export async function agentAdminRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Every connector, with the counts a screen needs to explain itself.
   *
   * `devices` is the assigned count and `pending` the queue depth, because those two together are
   * what say whether a connector is doing anything. A connector with terminals and a rising queue
   * is collecting nothing; one with no terminals is installed and idle, which looks identical on a
   * status badge alone.
   */
  app.get(
    '/api/agents',
    { preHandler: requirePermission('settings.devices', 'view') },
    async () => {
      const agents = await db().deviceAgent.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { devices: true } } },
      });

      const pending = await db().deviceCommand.groupBy({
        by: ['deviceId'],
        where: { status: 'pending' },
        _count: { _all: true },
      });

      const devices = await db().device.findMany({
        where: { agentId: { not: null } },
        select: { id: true, agentId: true },
      });

      const queueByAgent = new Map<number, number>();
      for (const row of pending) {
        const owner = devices.find((device) => device.id === row.deviceId)?.agentId;
        if (owner === null || owner === undefined) continue;
        queueByAgent.set(owner, (queueByAgent.get(owner) ?? 0) + row._count._all);
      }

      return jsonSafe(
        agents.map(
          ({
            secretHash: _secret,
            enrolTokenHash: _token,
            _count,
            ...agent
          }) => ({
            ...agent,
            devices: _count.devices,
            queued: queueByAgent.get(agent.id) ?? 0,
          }),
        ),
      );
    },
  );

  /**
   * Creates a connector and issues its enrolment token.
   *
   * The token is in this reply and in no other. There is no endpoint that returns it again, for the
   * same reason API tokens work that way: an endpoint that repeats a stored credential is the
   * easiest way to extract one. If it is lost, reissue.
   */
  app.post(
    '/api/agents',
    { preHandler: requirePermission('settings.devices', 'create') },
    async (request, reply) => {
      const body = parseBody(agentInputSchema, request.body);

      /**
       * A duplicate name is refused rather than accepted with a suffix.
       *
       * Two connectors whose names differ by one character is how a terminal ends up assigned to
       * the wrong site, and nothing on any screen afterwards would show that it had.
       */
      const clash = await db().deviceAgent.findFirst({ where: { name: body.name } });
      if (clash) {
        throw conflict(
          `Sudah ada connector bernama "${body.name}". Pilih nama lain, atau jana token ` +
            'pendaftaran baharu untuk connector itu kalau anda hendak memasangnya semula.',
        );
      }

      const token = issueEnrolToken();
      const agent = await db().deviceAgent.create({
        data: {
          name: body.name,
          agentKey: issueAgentKey(),
          enrolTokenHash: token.tokenHash,
          enrolExpiresAt: token.expiresAt,
        },
      });

      reply.header('cache-control', 'no-store');
      return jsonSafe({
        id: agent.id,
        name: agent.name,
        agentKey: agent.agentKey,
        token: token.token,
        expiresAt: token.expiresAt,
        ttlMinutes: Math.round(ENROL_TOKEN_TTL_MS / 60_000),
        cloudUrl: cloudOrigin(request),
      });
    },
  );

  /**
   * Issues a fresh enrolment token, for re-installing a connector.
   *
   * Does not touch the credential already deployed. The connector on site keeps working until the
   * new install enrols, so the site keeps reporting attendance while somebody drives there —
   * revoking first would take it down for however long that takes.
   */
  app.post(
    '/api/agents/:id/reissue',
    { preHandler: requirePermission('settings.devices', 'edit') },
    async (request, reply) => {
      const agent = await requireAgent(idParam(request.params));
      const token = await reissueEnrolToken(agent.id);

      reply.header('cache-control', 'no-store');
      return jsonSafe({
        id: agent.id,
        name: agent.name,
        agentKey: agent.agentKey,
        token: token.token,
        expiresAt: token.expiresAt,
        ttlMinutes: Math.round(ENROL_TOKEN_TTL_MS / 60_000),
        cloudUrl: cloudOrigin(request),
        /** True when this replaces a credential that is currently working. */
        replacesWorking: agent.secretHash !== null,
      });
    },
  );

  /**
   * Withdraws a connector's credential.
   *
   * Refused while terminals are still assigned to it. The devices would be left pointing at a
   * connector that can no longer deliver, and the cloud will not dial them itself — so they would
   * simply stop reporting, and the screen would show terminals that look broken rather than a
   * connector that was switched off. Move them to another connector or to direct first.
   */
  app.post(
    '/api/agents/:id/revoke',
    { preHandler: requirePermission('settings.devices', 'edit') },
    async (request) => {
      const agent = await requireAgent(idParam(request.params));

      const assigned = await db().device.count({ where: { agentId: agent.id } });
      if (assigned > 0) {
        throw conflict(
          `${String(assigned)} terminal masih ditugaskan kepada "${agent.name}". Pindahkan ` +
            'terminal itu ke connector lain atau ke mod LAN dahulu — kalau tidak ia berhenti ' +
            'melaporkan dan kelihatan rosak, sedangkan yang berlaku ialah connector dimatikan.',
        );
      }

      await revokeAgent(agent.id);
      return { ok: true };
    },
  );
}

/**
 * Addresses a connector can never dial, whatever they are configured as.
 *
 * Loopback, link-local, and the three private ranges. A connector runs on a different machine in
 * a different building, so any of these is a value that cannot be right rather than one that
 * might be.
 */
const UNROUTABLE_HOST =
  /^(?:localhost|127\.|0\.0\.0\.0$|10\.|192\.168\.|169\.254\.|::1$|172\.(?:1[6-9]|2\d|3[01])\.)/i;

/** The origin the caller reached this server on, honouring a proxy in front. */
function requestOrigin(request: FastifyRequest): string | undefined {
  const forwardedHost = request.headers['x-forwarded-host'];
  const host =
    (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0]?.trim() : undefined) ??
    request.headers.host;
  if (typeof host !== 'string' || host.length === 0) return undefined;

  const forwardedProto = request.headers['x-forwarded-proto'];
  const proto =
    (typeof forwardedProto === 'string' ? forwardedProto.split(',')[0]?.trim() : undefined) ??
    request.protocol;

  return `${proto}://${host}`;
}

/** Normalises to a bare origin, or refuses. Drops any path, so `.../hik/events` cannot leak in. */
function routableOrigin(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) return null;

  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    if (UNROUTABLE_HOST.test(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The address a connector should be pointed at.
 *
 * Taken from the request the operator is making, because that is the one value that cannot be
 * stale: they are reading this screen on the very address the connector has to reach.
 * `PUBLIC_URL` overrides it, for an install behind something that rewrites `Host`.
 *
 * ## Why `INGEST_PUBLIC_URL` is no longer the source
 *
 * It was, and it produced an installer command that could not work. That field has to be an
 * address the *terminal* can reach — and a terminal behind a connector reaches the connector,
 * never the cloud — so on a cloud install it holds something local, commonly a loopback address.
 * The screen then printed `curl -fsSL http://127.0.0.1:8080/install-agent.sh`, which looks
 * complete, runs, and fails on a machine in another building.
 *
 * ## Unroutable values are refused rather than passed through
 *
 * That is the whole lesson from the bug. The failure was never a missing value; it was a
 * plausible-looking wrong one. A placeholder that is obviously incomplete gets questioned, and a
 * private address does not.
 */
export function cloudOrigin(request?: FastifyRequest): string {
  const configured = routableOrigin(loadEnv().PUBLIC_URL);
  if (configured !== null) return configured;

  const observed = request === undefined ? null : routableOrigin(requestOrigin(request));
  if (observed !== null) return observed;

  return 'https://<alamat-cloud>';
}

async function requireAgent(id: number) {
  const agent = await db().deviceAgent.findUnique({ where: { id } });
  if (!agent) throw notFound('Connector tidak dijumpai');
  return agent;
}

function idParam(params: unknown): number {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
  if (!parsed.success) throw notFound('Connector tidak dijumpai');
  return parsed.data.id;
}

/** Re-exported so the device routes can describe an agent without importing the enum twice. */
export { AgentStatus };
