import {
  asRecord,
  asString,
  decodeAttlogLine,
  decodePush,
  digestChallenge,
  ICLOCK_PATH,
  toAcsEvent,
  toTerminalEvent,
  verifyDigest,
} from '@attendance/terminal-drivers';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import { orgOffsetMinutes } from './clock.js';
import type { Cloud } from './cloud.js';
import type { AgentConfig } from './config.js';
import { logger } from './logging.js';
import { toPayload } from './payload.js';
import type { Relay } from './relay.js';
import type { Attribution, Roster } from './roster.js';
import type { Spool } from './spool.js';
import type { SiteState } from './state.js';

/**
 * The endpoints the terminals on this LAN deliver to.
 *
 * Two protocols, one listener, deliberately the same paths and the same decoders the cloud uses
 * — so a terminal can be repointed between a direct installation and a connector without
 * touching anything on the unit but the address.
 *
 *   `/hik/events`  Hikvision push. Digest-authenticated, one event per request.
 *   `/iclock/*`    ZKTeco TA Push. The terminal posts its records, asks for work, and reports
 *                  what it did with the work it took.
 *
 * One build answering both is what keeps a connector from needing a type. A site with a
 * Hikvision unit in the lobby and a SenseFace in the clinic is one connector, and the roster
 * picks a driver per assignment.
 *
 * ## Answering 200 is not a formality
 *
 * Hikvision firmware re-sends an event it did not see acknowledged, and it does so in a loop.
 * An endpoint that answers 500 while something downstream is wrong therefore turns one failing
 * event into continuous traffic, and the unit stops making progress through its own log. So
 * every branch on that path ends in a 2xx once the body has authenticated — the spool write is
 * the thing that must succeed, and it happens before the response.
 *
 * TA Push works the other way round and that is useful: a reply that is not `OK` makes the
 * terminal keep its records and offer them again after `ErrorDelay`. So the one branch that
 * genuinely cannot proceed — no timezone from the cloud yet — refuses, and nothing is lost.
 *
 * ## `/iclock/*` has no credential, and cannot have one
 *
 * The protocol offers none: a request identifies itself with `SN=` in the query string, and the
 * serial is printed on a sticker on the unit. This is the same exposure the cloud's own
 * `/iclock` route carries, with two differences that matter and are the reason this path exists:
 *
 *  - the listener binds a LAN interface on the site's own network, not a public address
 *  - a serial only resolves against **this connector's roster**, which is the terminals assigned
 *    to this site — not the whole device table
 *
 * That is the point of moving ZKTeco behind a connector: the terminal needs no route to the
 * internet, and the cloud's public `/iclock` can stay closed. It is not a reason to put this
 * listener on a public address. Keep the terminals and the Pi on their own VLAN — traffic on
 * this port is plain HTTP either way.
 */

export const INGEST_PATH = '/hik/events';

/** Commands handed over per poll. One at a time is the documented shape; a few is kinder. */
const COMMANDS_PER_POLL = 5;

/**
 * How far out of step a record may be before it is refused.
 *
 * The same bounds the cloud's own callback route applies, and for the same reason: a terminal
 * whose clock reset to the factory date would file a morning's attendance against the year 2000,
 * and raw events have no delete path anywhere in this application. Generous, because a unit
 * buffers and re-sends after an outage — this is for a broken clock, not for lateness.
 */
const MAX_RECORD_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_RECORD_FUTURE_MS = 24 * 60 * 60 * 1000;

/** What the Hikvision push path has seen. */
export interface ListenerStats {
  heartbeats: number;
  events: number;
  rejected: number;
  unknownDevice: number;
  undecodable: number;
  ignored: number;
  lastContactAt: Date | null;
  /** The callback path, counted apart because the two have different failure modes. */
  callback: CallbackStats;

  /**
   * Requests to a path this build has no route for.
   *
   * Its own counter because it is the signature of a protocol mismatch rather than of a fault: the
   * unit is working and delivering, to a shape nothing here answers. Without it the condition is
   * invisible — a connector that is running, a terminal that says online, and no attendance.
   */
  unmatched: number;
  lastUnmatchedPath: string | null;

  /**
   * Events accepted on remembered identity rather than a live roster.
   *
   * Counted because it is the measure of how much this connector has carried through an upstream
   * outage — which before the cache was the measure of how much had been refused and lost.
   */
  attributedFromCache: number;
}

/**
 * What the callback path has seen.
 *
 * `unknownSerial` and `noTimezone` are separated on purpose: the first means a terminal is
 * missing its serial on the devices screen, the second means this connector has not had a
 * heartbeat answered yet. Opposite actions, and a single counter would hide which.
 */
export interface CallbackStats {
  handshakes: number;
  records: number;
  unknownSerial: number;
  undecodable: number;
  outOfRange: number;
  noTimezone: number;
  commandsHandedOver: number;
  commandResults: number;
  lastContactAt: Date | null;
}

export function createListener(
  config: AgentConfig,
  roster: Roster,
  spool: Spool,
  state: SiteState,
  relay: Relay,
  cloud: Cloud,
): { app: FastifyInstance; stats: ListenerStats } {
  const stats: ListenerStats = {
    heartbeats: 0,
    events: 0,
    rejected: 0,
    unknownDevice: 0,
    undecodable: 0,
    ignored: 0,
    lastContactAt: null,
    unmatched: 0,
    lastUnmatchedPath: null,
    attributedFromCache: 0,
    callback: {
      handshakes: 0,
      records: 0,
      unknownSerial: 0,
      undecodable: 0,
      outOfRange: 0,
      noTimezone: 0,
      commandsHandedOver: 0,
      commandResults: 0,
      lastContactAt: null,
    },
  };

  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 * 1024 });

  /*
   * Bodies arrive as JSON, or as multipart when a snapshot is attached, or as tab-separated text
   * from a callback terminal. A raw parser handles every shape rather than depending on a
   * content-type this firmware does not always set correctly.
   */
  app.addContentTypeParser(
    [
      'application/json',
      'multipart/form-data',
      'application/x-www-form-urlencoded',
      'text/plain',
      'application/octet-stream',
    ],
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );

  /*
   * And a catch-all, because a terminal that declares a content-type nobody listed would
   * otherwise be answered 415 — which it cannot report to anybody, so the unit simply appears to
   * have stopped delivering. Every handler below decides for itself what the bytes are.
   */
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  app.post(INGEST_PATH, async (request, reply) => {
    const verdict = verifyDigest({
      header: request.headers.authorization,
      method: 'POST',
      uri: request.url,
      username: config.INGEST_USERNAME,
      password: config.INGEST_PASSWORD,
    });

    if (!verdict.ok) {
      /*
       * A challenge is re-issued on every rejection, including a wrong password. The terminal
       * has no way to report an authentication failure to a human, so the alternative is a unit
       * that silently stops delivering with nothing anywhere saying why.
       *
       * Except `stale`, which is this listener rotating its nonce every five minutes: the
       * terminal's next push still carries the old one, is refused, and is resent at once against
       * the fresh challenge. Logged as a refusal, rotation alone wrote two "Refused a terminal
       * push" warnings every five and a half minutes on a site that was working, and the first
       * person to read them asked what was broken. Nothing is lost by quieting it: a wrong password
       * fails the retry as `mismatch`, and a terminal sending no credentials stays `missing`.
       * The cloud's own ingest route has never counted it either.
       */
      if (verdict.reason === 'stale') {
        logger().debug({ ip: request.ip }, 'Terminal push carried an expired nonce; challenged again');
      } else {
        stats.rejected += 1;
        logger().warn({ reason: verdict.reason, ip: request.ip }, 'Refused a terminal push');
      }
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

    /*
     * Attribution, which may come from the cached roster.
     *
     * Deliberately not `findByAddress`: that returns a served entry, and a served entry needs a
     * heartbeat to have succeeded. A connector that restarted while the cloud was unreachable has
     * no live roster and used to answer 404 here — and this firmware keeps no queue and never
     * retries, so the scan was gone rather than late. The cached identity is enough to spool it.
     */
    const who = roster.identify({
      addresses: [asString(payload['ipAddress']), request.ip],
    });
    if (!who) {
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
      state.notePush(who.deviceId);
      return { ok: true, heartbeat: true };
    }

    const acsEvent = toAcsEvent(payload, alert);
    if (!acsEvent) {
      stats.ignored += 1;
      logger().warn(
        { deviceId: who.deviceId, keys: Object.keys(alert) },
        'Push decoded but carried no usable event',
      );
      return { ok: true, ignored: true };
    }

    const event = toTerminalEvent(acsEvent);
    if (!event) {
      stats.ignored += 1;
      logger().warn(
        { deviceId: who.deviceId, serialNo: acsEvent.serialNo, time: acsEvent.time },
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
    spool.add(who.deviceId, 'push', toPayload(event));
    stats.events += 1;
    state.notePush(who.deviceId);

    if (who.cached) {
      stats.attributedFromCache += 1;
      /*
       * Logged, because it means this connector is holding events for a terminal the cloud has not
       * confirmed since the process started. They will be delivered once a heartbeat lands; until
       * then the site is working on remembered information, and that is worth seeing on the way
       * past rather than inferring from a spool that is growing.
       */
      logger().info(
        { deviceId: who.deviceId },
        'Spooled a push using the cached roster; the cloud has not been reached yet',
      );
    }

    return { ok: true, spooled: true };
  });

  // -------------------------------------------------------------------------
  // ZKTeco TA Push
  // -------------------------------------------------------------------------

  /**
   * Finds the terminal a callback request claims to be from.
   *
   * The serial is the only identifier the protocol offers, and it is matched against this
   * connector's roster — which the cloud filled in from `Device.agentId`. So a unit pointed here
   * by mistake, or probing, resolves to nothing.
   *
   * Answers 404 rather than 401, like the cloud's route does: there is no credential to have got
   * wrong, so a challenge would be meaningless, and an endpoint that admits it exists is one
   * worth probing again.
   */
  function resolveCallback(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Attribution | undefined {
    stats.callback.lastContactAt = new Date();

    const serial = queryValue(request.query, 'SN');
    if (serial === null || serial.trim() === '') {
      stats.callback.unknownSerial += 1;
      logger().warn({ ip: request.ip, url: request.url }, 'Callback request carried no serial');
      void reply.status(404).type('text/plain').send('');
      return undefined;
    }

    // Falls back to the cached roster, like the push path, so a restart during an upstream
    // outage does not turn into refused attendance.
    const who = roster.identify({ serial });
    if (!who) {
      stats.callback.unknownSerial += 1;
      logger().warn(
        { ip: request.ip, serial: serial.trim() },
        'Callback request from a terminal this connector does not serve was discarded',
      );
      void reply.status(404).type('text/plain').send('');
      return undefined;
    }

    return who;
  }

  /**
   * Handshake and configuration.
   *
   * The terminal asks what it should do and applies the reply to itself. Also the first thing a
   * newly pointed unit sends, which makes a 404 here the symptom an operator sees when the serial
   * is not on the device record yet.
   */
  app.get(`${ICLOCK_PATH}/cdata`, async (request, reply) => {
    const who = resolveCallback(request, reply);
    if (!who) return reply;

    stats.callback.handshakes += 1;
    state.notePush(who.deviceId);

    /*
     * `Stamp` is the transaction cursor the unit keeps on its own side, echoed back so it stays
     * in charge of its own position — which is what makes its buffer-and-resend behaviour work.
     * Sending `0` would ask it to resend its entire log.
     */
    const stamp = queryValue(request.query, 'Stamp') ?? '0';
    const offset = orgOffsetMinutes();

    return reply.type('text/plain').send(
      [
        `GET OPTION FROM: ${who.serialNumber ?? ''}`,
        `Stamp=${stamp}`,
        'OpStamp=0',
        // Seconds the unit waits before retrying a request we did not answer `OK`.
        'ErrorDelay=30',
        // Seconds between polls for queued work. This is how long an enrolment feels.
        'Delay=30',
        'TransTimes=00:00;14:05',
        'TransInterval=1',
        'TransFlag=1111000000',
        /*
         * Omitted rather than guessed when the cloud has not reported a zone yet. A `TimeZone`
         * line carrying a default would configure the terminal to a zone nobody chose, and the
         * unit would then report wall-clock times in it — making the mistake look like correct
         * data.
         */
        ...(offset === null ? [] : [`TimeZone=${String(Math.round(offset / 60))}`]),
        'Realtime=1',
        'Encrypt=0',
      ].join('\n'),
    );
  });

  /**
   * Attendance records, and any other table the terminal decides to upload.
   *
   * Written to the spool before the terminal is answered, which is the same contract the push
   * path keeps and for the same reason: between acknowledging a record and the cloud accepting
   * it, the spool is the only place it exists.
   */
  app.post(`${ICLOCK_PATH}/cdata`, async (request, reply) => {
    const who = resolveCallback(request, reply);
    if (!who) return reply;

    const deviceId = who.deviceId;
    state.notePush(deviceId);

    const table = (queryValue(request.query, 'table') ?? '').toUpperCase();
    const body = bodyText(request.body);

    if (table !== 'ATTLOG') {
      /*
       * Operator logs, fingerprint templates and other tables land here too. Acknowledged and
       * logged rather than silently dropped: a table this application does not consume is not an
       * error, but a firmware that starts sending something new should be visible in the log
       * rather than discovered by accident.
       */
      logger().info(
        { deviceId, table, bytes: body.length },
        'Callback terminal uploaded a table this connector does not consume',
      );
      return reply.type('text/plain').send('OK');
    }

    /**
     * No zone, no decoding.
     *
     * `ATTLOG` timestamps are local wall-clock with nothing to say which zone, so the offset has
     * to come from the cloud — and this connector does not substitute its own. Refusing is safe
     * here in a way it is not on the push path: the terminal keeps the records and offers them
     * again after `ErrorDelay`, so nothing is lost while the first heartbeat lands.
     *
     * In practice this is unreachable after boot, because the first heartbeat runs before the
     * listener opens. It is the branch that matters when the cloud is older than this build and
     * never sends the field at all — the alternative being a site that silently files every punch
     * eight hours out.
     */
    const offsetMinutes = orgOffsetMinutes();
    if (offsetMinutes === null) {
      stats.callback.noTimezone += 1;
      logger().error(
        { deviceId, bytes: body.length },
        'Refusing attendance: the cloud has not reported a timezone, so these timestamps cannot ' +
          'be read. The terminal will offer them again.',
      );
      return reply.status(503).type('text/plain').send('');
    }

    const now = Date.now();
    let accepted = 0;

    for (const line of body.split('\n')) {
      if (line.trim() === '') continue;

      const event = decodeAttlogLine(who.serialNumber ?? '', line, offsetMinutes);
      if (event === null) {
        stats.callback.undecodable += 1;
        // Logged with the line, because the column order in this protocol was assembled from
        // third-party transcriptions and this is the evidence that corrects it.
        logger().warn({ deviceId, line }, 'Could not decode an ATTLOG row');
        continue;
      }

      const age = now - event.at.getTime();
      if (age > MAX_RECORD_AGE_MS || age < -MAX_RECORD_FUTURE_MS) {
        stats.callback.outOfRange += 1;
        logger().warn(
          { deviceId, at: event.at.toISOString(), line },
          'Refused an ATTLOG row dated outside the plausible window',
        );
        continue;
      }

      spool.add(deviceId, 'push', toPayload(event));
      accepted += 1;
      if (who.cached) stats.attributedFromCache += 1;
    }

    stats.callback.records += accepted;
    if (accepted > 0) {
      logger().info({ deviceId, accepted }, 'Spooled attendance from a callback terminal');
    }

    /*
     * `OK: <count>` acknowledges what was taken. Answered after the spool writes, so a record
     * this connector has acknowledged is one it holds.
     */
    return reply.type('text/plain').send(`OK: ${String(accepted)}`);
  });

  /**
   * The terminal asking whether there is work.
   *
   * This is the outbound half of the protocol and the reason a remote site needs no VPN: a
   * command reaches the unit because the unit came to collect it. The connector is a relay here
   * rather than an executor — it hands over the string the cloud's driver built and has nothing
   * to run itself.
   */
  app.get(`${ICLOCK_PATH}/getrequest`, async (request, reply) => {
    const who = resolveCallback(request, reply);
    if (!who) return reply;

    const deviceId = who.deviceId;
    state.notePush(deviceId);

    const held = relay.peek(deviceId, COMMANDS_PER_POLL);
    if (held.length === 0) {
      // `OK` with no commands is how the protocol says "nothing for you". An empty body reads as
      // a failed request and the unit retries immediately.
      return reply.type('text/plain').send('OK');
    }

    stats.callback.commandsHandedOver += held.length;
    logger().info(
      { deviceId, count: held.length },
      'Handed relayed commands to a callback terminal',
    );

    /*
     * `C:<id>:<body>` — the id is the cloud's queue row, carried through unchanged so the
     * acknowledgement lands on the exact command it belongs to. They stay held until that
     * acknowledgement arrives, because this protocol reports the result on a separate request.
     */
    return reply
      .type('text/plain')
      .send(held.map((command) => `C:${command.commandId}:${command.payload}`).join('\n'));
  });

  /**
   * What happened to a command the terminal took.
   *
   * The half that makes a queued write eventually honest: until this arrives, the application
   * says a command is accepted rather than applied. Reported to the cloud first and released from
   * the relay only once the cloud has it — a release before the report would drop the outcome if
   * the cloud were briefly unreachable, and the command would then sit `sent` forever with
   * nothing left to report it.
   */
  app.post(`${ICLOCK_PATH}/devicecmd`, async (request, reply) => {
    const who = resolveCallback(request, reply);
    if (!who) return reply;

    const deviceId = who.deviceId;
    state.notePush(deviceId);

    for (const line of bodyText(request.body).split('\n')) {
      const fields = parseFields(line);
      const commandId = fields['ID'];
      if (commandId === undefined || !/^\d+$/.test(commandId)) continue;

      /*
       * `Return=0` is success on this protocol; anything else is the unit's own error number.
       * Inverted from the usual convention, which is worth the comment: reading it the obvious
       * way records every success as a failure and leaves a queue that never appears to drain.
       */
      const returned = fields['Return'] ?? '';
      const ok = returned.trim() === '0';

      stats.callback.commandResults += 1;

      const reported = await cloud.reportCommand(commandId, {
        ok,
        result: ok ? 'OK' : `Terminal menjawab Return=${returned} CMD=${fields['CMD'] ?? '?'}`,
      });

      if (reported.ok) {
        relay.release(deviceId, commandId);
      } else {
        /*
         * Kept, so the next report can carry it. The cloud's row is still `sent`, so its stale
         * sweep will offer the command again — and `hold` recognises one it is already carrying,
         * so the re-offer does not duplicate what is here.
         */
        logger().warn(
          { deviceId, commandId, failure: reported.failure },
          'Terminal reported a command outcome but the cloud could not be told; keeping it',
        );
      }

      if (!ok) {
        logger().warn(
          { deviceId, commandId, returned, cmd: fields['CMD'] },
          'A callback terminal refused a relayed command',
        );
      }
    }

    return reply.type('text/plain').send('OK');
  });

  /**
   * A request this listener has no route for, logged rather than answered silently.
   *
   * Fastify is built here with its own logger off, so an unmatched path produced a bare 404 and
   * nothing anywhere. That is the worst possible shape for the one question somebody actually has
   * during bring-up: the terminal says it is online, the connector says it is running, and no
   * attendance arrives.
   *
   * ZKTeco ships several push protocols — ADMS over `/iclock/*` is one, and a unit may be
   * configured for another with a different path entirely. This line is what turns that from a
   * silent mismatch into evidence: the method, the path, the query and the user agent are exactly
   * what identifies which protocol the firmware is speaking, and they can be read off the journal
   * instead of guessed at from a datasheet.
   *
   * The query string is included deliberately. A callback protocol identifies the unit in it —
   * `SN=` on ADMS — so an unmatched request still says which terminal is asking.
   */
  app.setNotFoundHandler(async (request, reply) => {
    stats.unmatched += 1;
    stats.lastUnmatchedPath = `${request.method} ${request.url}`;

    logger().warn(
      {
        method: request.method,
        url: request.url,
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        contentType: request.headers['content-type'] ?? null,
        /*
         * A short preview, not the body. It is enough to recognise a wire format — tab-separated
         * rows, XML, JSON — and short enough that a unit posting continuously to a path we do not
         * serve cannot fill the journal.
         */
        preview: bodyText(request.body).slice(0, 200),
      },
      'A terminal asked for a path this connector does not serve. If attendance is missing, this ' +
        'is the protocol mismatch: the unit is not speaking a protocol this build answers.',
    );

    return reply.status(404).type('text/plain').send('');
  });

  /** Liveness for whoever is standing in front of the machine. Carries nothing sensitive. */
  app.get('/healthz', async () => ({
    ok: true,
    devices: roster.all().length,
    /*
     * Reported beside the served count, because the two differing is the state worth noticing:
     * identities remembered but nothing served means the cloud has not been reached since this
     * process started, and the connector is spooling on remembered information.
     */
    known: roster.cachedCount(),
    spooled: spool.count(),
    relayed: relay.count(),
  }));

  return { app, stats };
}

/** One query parameter, when Fastify has parsed the query into an object. */
function queryValue(query: unknown, key: string): string | null {
  if (typeof query !== 'object' || query === null) return null;
  const value = (query as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

/**
 * The request body as text.
 *
 * Every parser registered above produces a Buffer, including the catch-all, so this is where the
 * bytes become the tab-separated text this protocol speaks. A `string` case is kept because a
 * body that arrived already decoded must not silently read as empty.
 */
function bodyText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  return '';
}

/** Parses `Key=value&Key=value` and the tab-separated variant the same firmware also sends. */
function parseFields(line: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const pair of line.split(/[&\t]/)) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    fields[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  return fields;
}
