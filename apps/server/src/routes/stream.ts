import { PunchDirection, RawEventKind, VerifyMethod } from '@attendance/shared';
import type { FastifyInstance } from 'fastify';

import { requirePermission } from '../auth/plugin.js';
import { db } from '../db.js';
import { loadEnv } from '../env.js';
import { liveBus, type LiveDeviceStatus, type LiveScan } from '../events/bus.js';
import { logger } from '../logger.js';
import { zonedStartOfDay } from '../time.js';

/** Idle gap after which a proxy may decide the connection is dead. */
const KEEPALIVE_MS = 20_000;

/** Matches the monitor's own cap, so the first screen it draws is a full one. */
const TODAY_MAX = 200;

/**
 * The live monitor, both halves of it.
 *
 * ## Gated on the monitor's own permission
 *
 * The stream was `requireAuth` only, so any signed-in account — a staff self-service login
 * included — could subscribe and receive every scan at every terminal, with names and staff
 * numbers, as it happened. The screen itself is gated on `attendance.monitor`; the feed behind
 * it now is too.
 */
export async function streamRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Server-sent events for the live monitor.
   *
   * SSE rather than WebSocket because the traffic is one-way and the browser
   * reconnects on its own. A WebSocket would mean writing reconnect and heartbeat
   * logic by hand for no additional capability.
   */
  app.get(
    '/api/stream/scans',
    { preHandler: requirePermission('attendance.monitor', 'view') },
    async (request, reply) => {
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // Disables response buffering in nginx, which otherwise holds events until
        // the buffer fills and makes a live feed arrive in bursts.
        'x-accel-buffering': 'no',
      });

      const send = (event: string, payload: unknown): void => {
        if (reply.raw.writableEnded) return;
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      };

      send('ready', { at: new Date().toISOString() });

      const onScan = (scan: LiveScan): void => send('scan', scan);
      const onDeviceStatus = (status: LiveDeviceStatus): void => send('device', status);

      liveBus.on('scan', onScan);
      liveBus.on('deviceStatus', onDeviceStatus);

      // A comment line keeps intermediaries from closing an idle connection, and
      // costs a few bytes a minute.
      const keepalive = setInterval(() => {
        if (!reply.raw.writableEnded) reply.raw.write(': keepalive\n\n');
      }, KEEPALIVE_MS);

      const cleanup = (): void => {
        clearInterval(keepalive);
        liveBus.off('scan', onScan);
        liveBus.off('deviceStatus', onDeviceStatus);
      };

      // Both are needed: `close` covers a browser navigating away, `error` covers a
      // dropped network. Leaking a listener per disconnect would eventually exhaust
      // the emitter.
      request.raw.on('close', cleanup);
      request.raw.on('error', cleanup);

      logger().debug('Live scan stream opened');

      // Never resolves; Fastify keeps the socket open until the client disconnects.
      return reply;
    },
  );

  /**
   * Today's scans so far, in the shape the stream sends.
   *
   * The stream only carries what happens while the page is open, so a screen called today's
   * monitor opened at noon showed nothing for the morning — and the first person to test it
   * scanned, opened the page, saw an empty table and reasonably concluded the scan had been
   * lost. The monitor calls this when the stream opens and again whenever it reconnects, which
   * also fills a gap the dropped connection left.
   *
   * Built from what is stored rather than replayed from memory, so it agrees with the raw log:
   * an identified event that became a punch is accepted or a duplicate, one that did not is an
   * unmapped ID, and an unrecognised face is that. Door and hardware events are left out here
   * exactly as the live feed leaves them out.
   */
  app.get(
    '/api/stream/scans/today',
    { preHandler: requirePermission('attendance.monitor', 'view') },
    async () => {
      // An instant: today's events are compared on `eventTime`, which is a timestamp.
      const since = zonedStartOfDay(new Date(), loadEnv().ORG_TIMEZONE);

      const rows = await db().rawEvent.findMany({
        where: {
          eventTime: { gte: since },
          eventKind: { in: [RawEventKind.identified, RawEventKind.unrecognised] },
        },
        orderBy: [{ eventTime: 'desc' }, { id: 'desc' }],
        // One past the cap, so the reply can say whether the morning goes back further than this.
        take: TODAY_MAX + 1,
        select: {
          id: true,
          eventKey: true,
          serialNo: true,
          eventKind: true,
          verifyMethod: true,
          eventTime: true,
          employeeNo: true,
          personName: true,
          device: { select: { id: true, name: true } },
          punch: {
            select: {
              id: true,
              staffId: true,
              suppressed: true,
              direction: true,
              staff: { select: { employeeNo: true, fullName: true } },
            },
          },
        },
      });

      const truncated = rows.length > TODAY_MAX;

      const scans: LiveScan[] = [];
      for (const row of rows.slice(0, TODAY_MAX)) {
        const unrecognised = row.eventKind === RawEventKind.unrecognised;
        // The live feed never published these either: an identified event with no identifier.
        if (!unrecognised && !row.employeeNo) continue;

        const punch = row.punch;
        scans.push({
          punchId: punch?.id ?? null,
          rawEventId: row.id.toString(),
          eventKey: row.eventKey,
          serialNo: row.serialNo === null ? null : row.serialNo.toString(),
          at: row.eventTime.toISOString(),
          deviceId: row.device.id,
          deviceName: row.device.name,
          staffId: punch?.staffId ?? null,
          // The same choices `publishScan` makes: the directory's number and name once mapped,
          // the terminal's own while not, and nothing for a face nobody matched.
          employeeNo: unrecognised ? null : (punch?.staff.employeeNo ?? row.employeeNo),
          name: unrecognised ? null : (punch?.staff.fullName ?? row.personName),
          method: row.verifyMethod ?? VerifyMethod.unknown,
          direction: punch?.direction ?? PunchDirection.unknown,
          suppressed: punch?.suppressed ?? false,
          problem: unrecognised ? 'unrecognisedFace' : punch === null ? 'unmappedId' : null,
        });
      }

      return { truncated, scans };
    },
  );
}
