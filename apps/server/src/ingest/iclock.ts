import { DeviceProtocol } from '@attendance/shared';
import type { Device } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../db.js';
import { recordOutcome, takePending } from '../devices/driver/commands.js';
import { decodeAttlogLine } from '@attendance/terminal-drivers';
import { orgOffsetMinutes } from '../devices/drivers/zkteco/driver.js';
import { logger } from '../logger.js';
import { storeEvents } from './store.js';

/**
 * ZKTeco TA Push (ADMS) endpoint.
 *
 * The terminal drives everything here. It posts its attendance records, asks whether there is
 * work waiting, and reports what happened to the work it took. Nothing in this file calls a
 * device.
 *
 * ## Security, stated plainly
 *
 * **This protocol has no authentication.** A TA Push request identifies itself with `SN=` in the
 * query string, and that serial number is printed on a sticker on the device. There is no
 * credential to check, no signature, and no nonce — so the checks below are the only thing
 * standing between this endpoint and forged attendance:
 *
 *  - the serial must match a **registered and active** terminal whose protocol is TA Push
 *  - records dated implausibly far from now are refused
 *  - every rejection is logged with the source address
 *
 * That is adequate on a private network. It is **not** adequate on a public address, and this
 * is worth being blunt about because raw events are append-only by design — there is no delete
 * path anywhere in the application, including for administrators. An injected row is therefore
 * permanent evidence of something that never happened.
 *
 * Before any site is exposed publicly, this endpoint needs a reverse proxy in front doing mTLS
 * or per-site IP allowlisting, or a small outbound-only relay at each site. Whether the
 * SenseFace firmware can be given a path secret or post over HTTPS is unconfirmed — the
 * datasheet mentions HTTPS for reaching the unit's own backend, which is a different thing.
 */
export const ICLOCK_PATH = '/iclock';

/**
 * How far out of step a record may be before it is refused.
 *
 * Generous on purpose: a terminal buffers its transactions and re-sends after an outage, so a
 * record several days old is normal rather than suspect. The bound exists to catch a clock set
 * to the factory default and an obviously fabricated future date, not to police lateness.
 */
const MAX_RECORD_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_RECORD_FUTURE_MS = 24 * 60 * 60 * 1000;

/** Commands handed over per poll. One at a time is the documented shape; a few is kinder. */
const COMMANDS_PER_POLL = 5;

const stats = {
  handshakes: 0,
  records: 0,
  duplicates: 0,
  commandsSent: 0,
  commandResults: 0,
  /** Requests whose serial matched no registered terminal. */
  unregistered: 0,
  /** Rows that parsed but fell outside the plausible date window. */
  outOfRange: 0,
  /** Rows the decoder could not read at all. */
  undecodable: 0,
  lastContactAt: null as Date | null,
};

export function iclockStats(): Readonly<typeof stats> {
  return stats;
}

export async function iclockRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Bodies arrive as tab-separated text, and the firmware is inconsistent about the
   * content-type it declares. A raw parser covers every shape rather than depending on
   * negotiation the terminal does not reliably perform.
   *
   * Registered inside this plugin's scope, so it cannot collide with the Hikvision ingest
   * parser or with `@fastify/multipart` — two parsers claiming one content type is a boot
   * failure, and this application already has three places that want `text/plain`.
   */
  app.addContentTypeParser(
    ['text/plain', 'application/x-www-form-urlencoded', 'application/octet-stream'],
    { parseAs: 'string' },
    (_request, body, done) => {
      done(null, body);
    },
  );

  /**
   * Handshake and configuration.
   *
   * The terminal asks what it should do, and the reply sets its polling behaviour. The `GET` is
   * also the first thing a newly configured unit sends, which makes it where the serial number
   * gets attached to a device record — until that happens, scans from the unit are refused
   * because nothing can match them.
   */
  app.get(`${ICLOCK_PATH}/cdata`, async (request, reply) => {
    const device = await resolveBySerial(request, reply);
    if (!device) return reply;

    stats.handshakes += 1;
    await noteContact(device, request);

    /**
     * Options the terminal applies to itself.
     *
     * `Stamp` is the transaction cursor it keeps on its own side; sending `0` would ask it to
     * resend its entire log. It is echoed back from what the unit sent so the unit stays in
     * charge of its own position — which is what makes its buffer-and-resend behaviour work.
     */
    const stamp = asString(request.query, 'Stamp') ?? '0';

    return reply.type('text/plain').send(
      [
        `GET OPTION FROM: ${device.serialNumber ?? ''}`,
        `Stamp=${stamp}`,
        'OpStamp=0',
        'ErrorDelay=30',
        // Seconds between polls for queued work. Thirty seconds is the delay an operator waits
        // to see a face enrolment land, so it is deliberately short.
        'Delay=30',
        'TransTimes=00:00;14:05',
        'TransInterval=1',
        'TransFlag=1111000000',
        'TimeZone=' + String(Math.round(orgOffsetMinutes() / 60)),
        'Realtime=1',
        'Encrypt=0',
      ].join('\n'),
    );
  });

  /**
   * Attendance records, and any other table the terminal decides to upload.
   *
   * Answering `OK` is not optional: a terminal that does not see an acknowledgement keeps the
   * records in its buffer and sends them again. That retry behaviour is the reason this protocol
   * needs no reconcile pull, and answering anything else turns it into an infinite loop.
   */
  app.post(`${ICLOCK_PATH}/cdata`, async (request, reply) => {
    const device = await resolveBySerial(request, reply);
    if (!device) return reply;

    await noteContact(device, request);

    const table = (asString(request.query, 'table') ?? '').toUpperCase();
    const body = typeof request.body === 'string' ? request.body : '';

    if (table !== 'ATTLOG') {
      /**
       * Operator logs, fingerprint templates and other tables land here too.
       *
       * Acknowledged and logged rather than silently dropped. A table this application does not
       * consume is not an error, but a firmware that starts sending something new should be
       * visible in the log rather than discovered by accident.
       */
      logger().info(
        { deviceId: device.id, table, bytes: body.length },
        'Terminal uploaded a table this server does not consume',
      );
      return reply.type('text/plain').send('OK');
    }

    const offsetMinutes = orgOffsetMinutes();
    const now = Date.now();
    const events = [];

    for (const line of body.split('\n')) {
      if (line.trim() === '') continue;

      const event = decodeAttlogLine(device.serialNumber ?? '', line, offsetMinutes);
      if (event === null) {
        stats.undecodable += 1;
        // Logged with the line, because the column order in this protocol was assembled from
        // third-party transcriptions and this is the evidence that corrects it.
        logger().warn({ deviceId: device.id, line }, 'Could not decode an ATTLOG row');
        continue;
      }

      const age = now - event.at.getTime();
      if (age > MAX_RECORD_AGE_MS || age < -MAX_RECORD_FUTURE_MS) {
        stats.outOfRange += 1;
        /**
         * Refused rather than stored.
         *
         * A terminal whose clock reset to the factory date would otherwise file a morning's
         * attendance against the year 2000, and those rows cannot be deleted afterwards — the
         * raw log has no delete path anywhere in this application. Refusing keeps the evidence
         * table trustworthy at the cost of losing records that were already unusable.
         */
        logger().warn(
          { deviceId: device.id, at: event.at.toISOString(), line },
          'Refused an ATTLOG row dated outside the plausible window',
        );
        continue;
      }

      events.push(event);
    }

    const outcome = await storeEvents(device, events, 'push');
    stats.records += outcome.stored;
    stats.duplicates += outcome.duplicates;

    if (outcome.stored > 0 || outcome.duplicates > 0) {
      logger().info(
        { deviceId: device.id, ...outcome },
        'Stored attendance records from a TA Push terminal',
      );
    }

    return reply.type('text/plain').send(`OK: ${String(outcome.stored)}`);
  });

  /**
   * The terminal asking whether there is work.
   *
   * This is the outbound half of the protocol, and the reason a remote site needs no VPN: a
   * command reaches the unit because the unit came to collect it.
   */
  app.get(`${ICLOCK_PATH}/getrequest`, async (request, reply) => {
    const device = await resolveBySerial(request, reply);
    if (!device) return reply;

    await noteContact(device, request);

    const commands = await takePending(device.id, COMMANDS_PER_POLL);
    if (commands.length === 0) {
      // `OK` with no commands is how the protocol says "nothing for you". An empty body would
      // read as a failed request and the unit would retry immediately.
      return reply.type('text/plain').send('OK');
    }

    stats.commandsSent += commands.length;
    logger().info(
      { deviceId: device.id, count: commands.length },
      'Handed queued commands to a TA Push terminal',
    );

    /**
     * `C:<id>:<body>` — the id is ours, and the terminal quotes it back when reporting.
     *
     * Using the queue row id rather than a counter is what lets the acknowledgement land on the
     * exact command it belongs to, across restarts and out of order.
     */
    return reply
      .type('text/plain')
      .send(commands.map((row) => `C:${String(row.id)}:${row.payload}`).join('\n'));
  });

  /**
   * What happened to a command the terminal took.
   *
   * The half of the queue that makes a queued write eventually honest: until this arrives, the
   * application says the command is accepted rather than applied, and a screen that reported it
   * as done would be telling somebody a person can clock in when they cannot.
   */
  app.post(`${ICLOCK_PATH}/devicecmd`, async (request, reply) => {
    const device = await resolveBySerial(request, reply);
    if (!device) return reply;

    await noteContact(device, request);

    const body = typeof request.body === 'string' ? request.body : '';

    for (const line of body.split('\n')) {
      const fields = parseFields(line);
      const id = fields['ID'];
      if (id === undefined) continue;

      const commandId = toBigInt(id);
      if (commandId === null) continue;

      /**
       * `Return=0` is success on this protocol; anything else is the unit's own error number.
       *
       * Inverted from the usual convention, which is worth the comment: reading it the obvious
       * way would record every success as a failure and leave a queue that never appears to
       * drain.
       */
      const returned = fields['Return'] ?? '';
      const ok = returned.trim() === '0';

      stats.commandResults += 1;
      await recordOutcome(
        commandId,
        ok,
        ok ? 'OK' : `Terminal menjawab Return=${returned} CMD=${fields['CMD'] ?? '?'}`,
      );

      if (!ok) {
        logger().warn(
          { deviceId: device.id, commandId: id, returned, cmd: fields['CMD'] },
          'A TA Push terminal refused a queued command',
        );
      }
    }

    return reply.type('text/plain').send('OK');
  });
}

/**
 * Finds the terminal a request claims to be from.
 *
 * The serial number is the only identifier this protocol offers, which is why `Device.serialNumber`
 * carries a unique index. Matched against a registered, active, TA Push row — all three, because:
 *
 *  - unregistered means somebody pointed a terminal here, or is probing
 *  - inactive means a unit taken off the wall, whose records should not resume arriving
 *  - the protocol check stops a serial collision with a Hikvision row from routing scans into
 *    the wrong decoder
 *
 * Answers 404 on failure rather than 401. There is no credential to have got wrong, so a
 * challenge would be meaningless — and an endpoint that confirms it exists is one worth probing
 * again.
 */
async function resolveBySerial(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Device | null> {
  stats.lastContactAt = new Date();

  const serial = asString(request.query, 'SN');
  if (serial === null || serial.trim() === '') {
    stats.unregistered += 1;
    logger().warn({ ip: request.ip, url: request.url }, 'TA Push request carried no serial number');
    void reply.status(404).type('text/plain').send('');
    return null;
  }

  const device = await db().device.findFirst({
    where: { serialNumber: serial.trim(), active: true, protocol: DeviceProtocol.taPush },
  });

  if (!device) {
    stats.unregistered += 1;
    logger().warn(
      { ip: request.ip, serial: serial.trim() },
      'TA Push request from an unregistered terminal was discarded',
    );
    void reply.status(404).type('text/plain').send('');
    return null;
  }

  return device;
}

/**
 * Records that the terminal is alive, and what it says about itself.
 *
 * A request arriving is the only liveness signal this protocol gives, and it is a good one: the
 * unit polls on a timer whether or not anybody scans. `degraded` is preserved because it means
 * the unit answers but its data is suspect — usually clock drift, which contact does not address.
 */
async function noteContact(device: Device, request: FastifyRequest): Promise<void> {
  /**
   * The address is recorded, not trusted.
   *
   * Identity came from the serial number. This is stored so the device list can show where the
   * unit actually is, which for a remote site behind NAT is the only way anybody finds out.
   */
  const seenFrom = request.ip.replace(/^::ffff:/, '');

  await db().device.update({
    where: { id: device.id },
    data: {
      lastSeenAt: new Date(),
      lastError: null,
      ...(device.status === 'degraded' ? {} : { status: 'online' }),
      ...(seenFrom !== '' && seenFrom !== device.host ? { host: seenFrom } : {}),
    },
  });
}

function asString(query: unknown, key: string): string | null {
  if (typeof query !== 'object' || query === null) return null;
  const value = (query as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
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

function toBigInt(value: string): bigint | null {
  try {
    return BigInt(value.trim());
  } catch {
    return null;
  }
}
