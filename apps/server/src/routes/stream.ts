import type { FastifyInstance } from 'fastify';

import { requireAuth } from '../auth/plugin.js';
import { liveBus, type LiveDeviceStatus, type LiveScan } from '../events/bus.js';
import { logger } from '../logger.js';

/** Idle gap after which a proxy may decide the connection is dead. */
const KEEPALIVE_MS = 20_000;

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Server-sent events for the live monitor.
   *
   * SSE rather than WebSocket because the traffic is one-way and the browser
   * reconnects on its own. A WebSocket would mean writing reconnect and heartbeat
   * logic by hand for no additional capability.
   */
  app.get('/api/stream/scans', { preHandler: requireAuth }, async (request, reply) => {
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
  });
}
