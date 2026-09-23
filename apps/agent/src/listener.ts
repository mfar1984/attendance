import {
  asRecord,
  asString,
  decodePush,
  digestChallenge,
  toAcsEvent,
  toTerminalEvent,
  verifyDigest,
} from '@attendance/terminal-drivers';
import Fastify, { type FastifyInstance } from 'fastify';

import type { AgentConfig } from './config.js';
import { logger } from './logging.js';
import { toPayload } from './payload.js';
import type { Roster } from './roster.js';
import type { Spool } from './spool.js';
import type { SiteState } from './state.js';

/**
 * The endpoint the terminals on this LAN push to.
 *
 * Deliberately the same path, the same Digest realm and the same decoder the cloud uses, so a
 * terminal can be repointed between a direct installation and a connector without touching
 * anything on the unit but the address.
 *
 * ## Answering 200 is not a formality
 *
 * Hikvision firmware re-sends an event it did not see acknowledged, and it does so in a loop.
 * An endpoint that answers 500 while something downstream is wrong therefore turns one failing
 * event into continuous traffic, and the unit stops making progress through its own log. So
 * every branch below ends in a 2xx once the body has authenticated — the spool write is the
 * thing that must succeed, and it happens before the response.
 */

export const INGEST_PATH = '/hik/events';

export interface ListenerStats {
  heartbeats: number;
  events: number;
  rejected: number;
  unknownDevice: number;
  undecodable: number;
  ignored: number;
  lastContactAt: Date | null;
}

export function createListener(
  config: AgentConfig,
  roster: Roster,
  spool: Spool,
  state: SiteState,
): { app: FastifyInstance; stats: ListenerStats } {
  const stats: ListenerStats = {
    heartbeats: 0,
    events: 0,
    rejected: 0,
    unknownDevice: 0,
    undecodable: 0,
    ignored: 0,
    lastContactAt: null,
  };

  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 * 1024 });

  /*
   * Bodies arrive as JSON, or as multipart when a snapshot is attached. A raw parser handles
   * both rather than depending on a content-type this firmware does not always set correctly.
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
      username: config.INGEST_USERNAME,
      password: config.INGEST_PASSWORD,
    });

    if (!verdict.ok) {
      stats.rejected += 1;
      /*
       * A challenge is re-issued on every rejection, including a wrong password. The terminal
       * has no way to report an authentication failure to a human, so the alternative is a unit
       * that silently stops delivering with nothing anywhere saying why.
       */
      logger().warn({ reason: verdict.reason, ip: request.ip }, 'Refused a terminal push');
      return reply
        .status(401)
        .header('www-authenticate', digestChallenge())
        .send({ error: 'Unauthorised' });
    }

    stats.lastContactAt = new Date();

    const decoded = decodePush(request.body, request.headers['content-type'] ?? '');
    if (!decoded.json) {
      stats.undecodable += 1;
      // The preview is logged because a firmware that changed its payload shape is otherwise
      // invisible: the terminal reports nothing and simply keeps posting bodies we discard.
      logger().warn(
        { contentType: request.headers['content-type'], preview: decoded.preview },
        'Could not decode a terminal push body',
      );
      return reply.status(400).send({ error: 'Unrecognised payload' });
    }

    const payload = decoded.json;

    const entry = roster.findByAddress(asString(payload['ipAddress']), request.ip);
    if (!entry) {
      stats.unknownDevice += 1;
      logger().warn(
        { ip: request.ip, reported: asString(payload['ipAddress']) },
        'Push from a terminal this connector does not serve was discarded',
      );
      return reply.status(404).send({ error: 'Device not served here' });
    }

    /*
     * Heartbeats share this endpoint and carry no event. They arrive every thirty seconds, which
     * makes them the most timely proof a terminal is alive — more useful for liveness than
     * events, which only appear when somebody scans.
     */
    const alert = asRecord(payload['AccessControllerEvent']);
    if (!alert || asString(payload['eventType']) === 'heartBeat') {
      stats.heartbeats += 1;
      // A heartbeat is the most timely proof of life there is, so it counts as contact even
      // though it carries no event.
      state.notePush(entry.assignment.deviceId);
      return { ok: true, heartbeat: true };
    }

    const acsEvent = toAcsEvent(payload, alert);
    if (!acsEvent) {
      stats.ignored += 1;
      logger().warn(
        { deviceId: entry.assignment.deviceId, keys: Object.keys(alert) },
        'Push decoded but carried no usable event',
      );
      return { ok: true, ignored: true };
    }

    const event = toTerminalEvent(acsEvent);
    if (!event) {
      stats.ignored += 1;
      logger().warn(
        { deviceId: entry.assignment.deviceId, serialNo: acsEvent.serialNo, time: acsEvent.time },
        'Push carried an unparseable timestamp',
      );
      return { ok: true, ignored: true };
    }

    /*
     * Written before the terminal is answered, and that ordering is the whole contract. The
     * firmware keeps no queue, so between acknowledging this event and delivering it to the
     * cloud, the spool is the only place it exists.
     *
     * `at` is serialised here rather than left as a Date. The spool holds JSON, so a Date would
     * come back as a string under a type that claimed otherwise — and the first thing to touch
     * it would throw, in a process nobody is watching.
     */
    spool.add(entry.assignment.deviceId, 'push', toPayload(event));
    stats.events += 1;
    state.notePush(entry.assignment.deviceId);

    return { ok: true, spooled: true };
  });

  /** Liveness for whoever is standing in front of the machine. Carries nothing sensitive. */
  app.get('/healthz', async () => ({
    ok: true,
    devices: roster.all().length,
    spooled: spool.count(),
  }));

  return { app, stats };
}
