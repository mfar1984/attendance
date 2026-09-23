import type { AcsEvent } from '@attendance/hik-isapi';
import { normalisePictureUrl } from '@attendance/hik-isapi';
import type { Device } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { requireAuth } from '../auth/plugin.js';
import { db } from '../db.js';
import {
  asNumber,
  asRecord,
  asString,
  decodePush,
  digestChallenge,
  toAcsEvent,
  toTerminalEvent,
  verifyDigest,
} from '@attendance/terminal-drivers';
import { loadEnv } from '../env.js';
import { logger } from '../logger.js';
import { storeEvents } from './store.js';

export const INGEST_PATH = '/hik/events';

/**
 * In-memory counters for the ingest endpoint.
 *
 * Deliberately not persisted: these answer "is push working right now", and a
 * restart resetting them is correct behaviour rather than lost data. The durable
 * record of what arrived is in `raw_events.arrivedVia`.
 *
 * Worth surfacing because a terminal that cannot reach us reports nothing at all.
 * Without a counter, a silently broken push looks identical to a quiet morning.
 */
const stats = {
  heartbeats: 0,
  events: 0,
  rejected: 0,
  unregistered: 0,
  /** Bodies that authenticated but could not be parsed. */
  undecodable: 0,
  /**
   * Bodies that parsed but carried no usable event.
   *
   * Counted because the alternative was silence: this case answered 200 and dropped
   * the payload with nothing recorded anywhere, so a firmware that renamed a field
   * presented as an ordinary quiet period.
   */
  ignored: 0,
  lastContactAt: null as Date | null,
  lastRejectionReason: null as string | null,
};

/**
 * Endpoint the terminals push events to.
 *
 * Push is treated as an optimisation, never as the source of truth. The firmware
 * keeps no queue and never retries, so anything emitted while this endpoint was
 * unavailable is only recoverable through the reconcile pull. Both paths write
 * through the same idempotent store, keyed on (device, serialNo).
 */
export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  const env = loadEnv();

  /**
   * Bodies arrive as JSON, or as multipart/form-data when a snapshot is
   * attached. A raw parser handles both rather than depending on content-type
   * negotiation the firmware does not always get right.
   */
  app.addContentTypeParser(
    ['application/json', 'multipart/form-data', 'application/x-www-form-urlencoded', 'text/plain'],
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );

  app.post(INGEST_PATH, async (request, reply) => {
    const verdict = verifyDigest({
      header: request.headers.authorization,
      method: 'POST',
      uri: request.url,
      username: env.INGEST_USERNAME,
      password: env.INGEST_PASSWORD,
    });

    if (!verdict.ok) {
      // A challenge is issued for every rejection, including a wrong password.
      // The terminal has no way to report an auth failure to an operator, so its
      // only path back to working is to retry with a fresh nonce.
      //
      // `missing` is the normal first leg of the Digest handshake, and `stale`
      // is normal nonce rotation once a challenge ages out. Neither indicates a
      // problem, so counting them would leave this figure permanently non-zero
      // and useless as a signal.
      if (verdict.reason !== 'missing' && verdict.reason !== 'stale') {
        stats.rejected += 1;
        stats.lastRejectionReason = verdict.reason;
        logger().warn({ reason: verdict.reason, ip: request.ip }, 'Rejected ingest push');
      }
      return reply
        .header('WWW-Authenticate', digestChallenge())
        .status(401)
        .send({ error: 'Unauthorized' });
    }

    stats.lastContactAt = new Date();

    const contentType = request.headers['content-type'] ?? '';
    const decoded = decodePush(request.body, contentType);

    if (!decoded.json) {
      stats.undecodable += 1;
      // The preview is logged because a firmware that changes its payload shape
      // is otherwise invisible: the terminal reports nothing and simply keeps
      // posting bodies we discard.
      logger().warn(
        { contentType, preview: decoded.preview },
        'Could not decode an ingest push body',
      );
      return reply.status(400).send({ error: 'Unrecognised payload' });
    }

    const payload = decoded.json;

    const device = await resolveDevice(payload, request.ip);
    if (!device) {
      stats.unregistered += 1;
      logger().warn(
        { mac: asString(payload['macAddress']), ip: request.ip },
        'Push from an unregistered terminal was discarded',
      );
      return reply.status(404).send({ error: 'Device not registered' });
    }

    /**
     * Heartbeats share this endpoint and carry no event. They arrive every thirty
     * seconds, which makes them the most timely proof that a terminal is alive -
     * more useful for liveness than events, which only appear when someone scans.
     *
     * Answering 200 also keeps the terminal from treating the listener as dead.
     */
    const eventType = asString(payload['eventType']);
    const alert = asRecord(payload['AccessControllerEvent']);
    if (!alert || eventType === 'heartBeat') {
      stats.heartbeats += 1;
      await db().device.update({
        where: { id: device.id },
        data: {
          lastSeenAt: new Date(),
          ...(device.status === 'offline' ? { status: 'online', lastError: null } : {}),
        },
      });
      return { ok: true, heartbeat: true };
    }

    const acsEvent = toAcsEvent(payload, alert);
    /**
     * A body that authenticated and decoded but is missing the fields an event needs.
     *
     * Counted and logged, unlike before. This branch used to answer `{ ok: true,
     * ignored: true }` with no counter and no log line, which means a firmware whose
     * payload shape changed looked exactly like a quiet morning on every screen. That
     * is a day lost during a vendor bring-up, looking for something invisible.
     */
    if (!acsEvent) {
      stats.ignored += 1;
      logger().warn(
        { deviceId: device.id, eventType, keys: Object.keys(alert) },
        'Ingest payload decoded but carried no usable event',
      );
      return { ok: true, ignored: true };
    }

    const event = toTerminalEvent(acsEvent);
    if (!event) {
      stats.ignored += 1;
      logger().warn(
        { deviceId: device.id, serialNo: acsEvent.serialNo, time: acsEvent.time },
        'Ingest payload carried an unparseable timestamp',
      );
      return { ok: true, ignored: true };
    }

    stats.events += 1;
    const outcome = await storeEvents(device, [event], 'push');

    await db().deviceSyncState.upsert({
      where: { deviceId: device.id },
      create: { deviceId: device.id, lastPushAt: new Date() },
      update: { lastPushAt: new Date() },
    });

    /**
     * A push that authenticated is proof the terminal is alive.
     *
     * Reachability was previously judged only on our ability to call the device.
     * That left it marked offline while it was actively posting events to us,
     * which is both wrong and alarming to whoever is reading the dashboard.
     *
     * `degraded` is preserved: it means the device answers but its data is
     * suspect, usually clock drift, which a successful push does not address.
     */
    await db().device.update({
      where: { id: device.id },
      data: {
        lastSeenAt: new Date(),
        lastError: null,
        ...(device.status === 'degraded' ? {} : { status: 'online' }),
      },
    });

    return { ok: true, ...outcome };
  });

  /**
   * Whether push is actually reaching us.
   *
   * Reads both the live counters and the durable split in `raw_events`, since the
   * ratio of pushed to pulled rows is what reveals a push path that has quietly
   * stopped working.
   */
  app.get('/api/ingest/stats', { preHandler: requireAuth }, async () => {
    const prisma = db();
    const [pushedEvents, pulledEvents] = await Promise.all([
      prisma.rawEvent.count({ where: { arrivedVia: 'push' } }),
      prisma.rawEvent.count({ where: { arrivedVia: 'pull' } }),
    ]);

    return {
      ...stats,
      pushedEvents,
      pulledEvents,
      ingestPath: INGEST_PATH,
      authMethod: 'MD5digest',
    };
  });
}

/**
 * Identifies the sending terminal.
 *
 * MAC address is preferred over source IP because it survives a DHCP lease
 * change, which would otherwise silently orphan a device's events.
 */
async function resolveDevice(
  payload: Record<string, unknown>,
  sourceIp: string,
): Promise<Device | null> {
  const prisma = db();
  const mac = asString(payload['macAddress']);

  if (mac) {
    const byMac = await prisma.device.findFirst({ where: { macAddress: mac, active: true } });
    if (byMac) return byMac;
  }

  const reportedIp = asString(payload['ipAddress']);
  for (const host of [reportedIp, sourceIp, sourceIp.replace(/^::ffff:/, '')]) {
    if (!host) continue;
    const byHost = await prisma.device.findFirst({ where: { host, active: true } });
    if (byHost) return byHost;
  }

  return null;
}
