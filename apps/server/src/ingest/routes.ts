import type { AcsEvent } from '@attendance/hik-isapi';
import { normalisePictureUrl } from '@attendance/hik-isapi';
import type { Device } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { requireAuth } from '../auth/plugin.js';
import { db } from '../db.js';
import { toTerminalEvent } from '../devices/drivers/hikvision/events.js';
import { loadEnv } from '../env.js';
import { logger } from '../logger.js';
import { digestChallenge, verifyDigest } from './digest-server.js';
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

/**
 * Normalises a push payload into the same shape the search API returns.
 *
 * The two differ in ways that are easy to miss: push uses `majorEventType` and
 * `subEventType` where search uses `major` and `minor`, and the timestamp sits at
 * the top level as `dateTime` rather than beside the event as `time`. Mapping
 * here means the ingest store has exactly one shape to reason about.
 */
function toAcsEvent(
  payload: Record<string, unknown>,
  alert: Record<string, unknown>,
): AcsEvent | null {
  const major = asNumber(alert['majorEventType']) ?? asNumber(alert['major']);
  const minor = asNumber(alert['subEventType']) ?? asNumber(alert['minor']);
  const serialNo = asNumber(alert['serialNo']);
  const time = asString(payload['dateTime']) ?? asString(alert['time']);

  if (major === undefined || minor === undefined || serialNo === undefined || !time) {
    return null;
  }

  const event: AcsEvent = { major, minor, time, serialNo };

  const assign = <K extends keyof AcsEvent>(key: K, value: AcsEvent[K] | undefined): void => {
    if (value !== undefined) event[key] = value;
  };

  assign('employeeNo', asString(alert['employeeNoString']) ?? asString(alert['employeeNo']));
  assign('name', asString(alert['name']));
  assign('cardNo', asString(alert['cardNo']));
  assign('cardType', asNumber(alert['cardType']));
  assign('doorNo', asNumber(alert['doorNo']));
  assign('cardReaderNo', asNumber(alert['cardReaderNo']));
  assign('userType', asString(alert['userType']));
  assign('currentVerifyMode', asString(alert['currentVerifyMode']));
  assign('mask', asString(alert['mask']) as AcsEvent['mask']);
  assign('remoteCheckResult', asString(alert['remoteCheckResult']));
  assign('attendanceStatus', asString(alert['attendanceStatus']) as AcsEvent['attendanceStatus']);
  assign('pictureURL', normalisePictureUrl(asString(alert['pictureURL'])));

  return event;
}

interface DecodedPush {
  json: Record<string, unknown> | null;
  /** Snapshot bytes when the terminal attached one. */
  image: Buffer | null;
  /** Short, printable excerpt for diagnosing a shape we do not recognise. */
  preview: string;
}

/**
 * Extracts the JSON object, and any snapshot, from a push body.
 *
 * When a picture is attached the body is `multipart/form-data`, so the parts are
 * split on the declared boundary. Scanning the whole buffer for the outermost
 * braces looks simpler but is wrong: JPEG data regularly contains a `}` byte, so
 * the slice runs past the end of the JSON and parsing fails. That is exactly how
 * this endpoint started answering 400 to every event once snapshots were enabled.
 */
function decodePush(body: unknown, contentType: string): DecodedPush {
  if (body === null || body === undefined) {
    return { json: null, image: null, preview: '(empty body)' };
  }

  if (typeof body === 'object' && !Buffer.isBuffer(body)) {
    return { json: body as Record<string, unknown>, image: null, preview: '(parsed object)' };
  }

  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);

  if (boundary) {
    const marker = `--${boundary[1] ?? boundary[2] ?? ''}`;
    const parts = splitMultipart(buffer, marker);

    let json: Record<string, unknown> | null = null;
    let image: Buffer | null = null;

    for (const part of parts) {
      // A part's own headers are unreliable on this firmware, so the body is
      // classified by what it actually starts with.
      if (json === null && part[0] === 0x7b /* { */) {
        json = tryParseJson(part.toString('utf8'));
        continue;
      }
      if (image === null && part[0] === 0xff && part[1] === 0xd8) {
        image = part;
      }
    }

    return { json, image, preview: preview(buffer) };
  }

  const text = buffer.toString('utf8').trim();
  return { json: tryParseJson(text), image: null, preview: preview(buffer) };
}

/**
 * Splits a multipart body into part bodies, working on bytes throughout.
 *
 * Converting to a string first would corrupt the JPEG payload, since binary data
 * is not valid UTF-8.
 */
function splitMultipart(buffer: Buffer, marker: string): Buffer[] {
  const markerBytes = Buffer.from(marker, 'utf8');
  const separator = Buffer.from('\r\n\r\n', 'utf8');
  const parts: Buffer[] = [];

  let cursor = buffer.indexOf(markerBytes);
  while (cursor !== -1) {
    const next = buffer.indexOf(markerBytes, cursor + markerBytes.length);
    const segment = buffer.subarray(
      cursor + markerBytes.length,
      next === -1 ? buffer.length : next,
    );

    const headerEnd = segment.indexOf(separator);
    if (headerEnd !== -1) {
      let content = segment.subarray(headerEnd + separator.length);
      // Trim the CRLF the sender places before the next boundary.
      while (content.length > 0 && (content.at(-1) === 0x0a || content.at(-1) === 0x0d)) {
        content = content.subarray(0, content.length - 1);
      }
      if (content.length > 0) parts.push(content);
    }

    if (next === -1) break;
    cursor = next;
  }

  return parts;
}

function tryParseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

/** Printable excerpt, with non-text bytes replaced so logs stay readable. */
function preview(buffer: Buffer): string {
  return buffer
    .subarray(0, 300)
    .toString('latin1')
    .replace(/[^\x20-\x7e\r\n]/g, '.')
    .slice(0, 300);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
