import type { Prisma } from '@prisma/client';

import { db } from '../../db.js';
import { logger } from '../../logger.js';
import { queued, type WriteAck } from './capabilities.js';

/**
 * Durable queue for terminals that collect their own work.
 *
 * Hikvision is request/response: the server calls the unit and has an answer before the HTTP
 * request ends. ZKTeco TA Push reverses that — the terminal polls us, takes one command, and
 * reports the result later. This table is the bridge between those two moments.
 *
 * Durable rather than in-memory, and that is the whole point. An in-memory queue loses a face
 * enrolment on every server restart, and the person it belonged to would be unable to scan
 * with nothing on any screen explaining why. The row survives, so the operation is either
 * eventually collected or still visibly waiting.
 *
 * Also the mechanism that makes remote sites work without a VPN: a queued command needs no
 * inbound access at all, because the terminal comes to fetch it.
 */

/** Neutral intent. The payload is protocol-shaped; this is what the application reasons about. */
export const CommandKind = {
  personUpsert: 'person.upsert',
  personRemove: 'person.remove',
  faceEnrol: 'face.enroll',
  faceRemove: 'face.remove',
  reboot: 'reboot',
  peopleQuery: 'people.query',
  setOption: 'option.set',
} as const;
export type CommandKind = (typeof CommandKind)[keyof typeof CommandKind];

export const CommandStatus = {
  pending: 'pending',
  sent: 'sent',
  succeeded: 'succeeded',
  failed: 'failed',
} as const;
export type CommandStatus = (typeof CommandStatus)[keyof typeof CommandStatus];

/**
 * Records one command for a terminal to collect, and acknowledges it as not yet confirmed.
 *
 * Returns the `WriteAck` directly so a driver method is a single line: the queue write and the
 * acknowledgement are the same event, and splitting them invites a driver that records the
 * command and then reports it as applied.
 */
export async function enqueue(
  deviceId: number,
  kind: CommandKind,
  payload: string,
): Promise<WriteAck> {
  const row = await db().deviceCommand.create({
    data: { deviceId, kind, payload },
    select: { id: true },
  });

  logger().info({ deviceId, kind, commandId: String(row.id) }, 'Queued a terminal command');
  return queued(String(row.id));
}

/**
 * Replaces any pending command of the same kind for the same subject.
 *
 * Without this, saving a staff record three times leaves three identical upserts waiting, and
 * the terminal applies all three. Harmless for an idempotent upsert, but it also means a
 * face enrolment superseded by a newer photograph would still be collected — and whichever
 * arrived last would win, which is not necessarily the one somebody just uploaded.
 *
 * Only `pending` rows are replaced. A command already handed to the terminal cannot be
 * recalled, so cancelling it here would leave the queue disagreeing with the unit.
 */
export async function enqueueReplacing(
  deviceId: number,
  kind: CommandKind,
  subject: string,
  payload: string,
): Promise<WriteAck> {
  const prisma = db();

  const superseded = await prisma.deviceCommand.updateMany({
    where: { deviceId, kind, status: CommandStatus.pending, subject },
    data: { status: CommandStatus.failed, result: 'Digantikan oleh arahan lebih baharu' },
  });

  if (superseded.count > 0) {
    logger().info(
      { deviceId, kind, subject, superseded: superseded.count },
      'Superseded pending terminal commands',
    );
  }

  const row = await prisma.deviceCommand.create({
    data: { deviceId, kind, subject, payload },
    select: { id: true },
  });

  return queued(String(row.id));
}

/**
 * Hands the next batch of work to a terminal that is asking for it.
 *
 * Marked `sent` rather than removed, because the terminal reports the outcome separately and a
 * removed row leaves nothing for that report to land on. A sent command that is never
 * acknowledged stays visible, which is what makes a unit that collects work and silently drops
 * it distinguishable from one that is simply idle.
 */
export async function takePending(
  deviceId: number,
  limit: number,
): Promise<Array<{ id: bigint; kind: string; payload: string }>> {
  const prisma = db();

  const rows = await prisma.deviceCommand.findMany({
    where: { deviceId, status: CommandStatus.pending },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, kind: true, payload: true },
  });

  if (rows.length === 0) return [];

  await prisma.deviceCommand.updateMany({
    where: { id: { in: rows.map((row) => row.id) } },
    data: {
      status: CommandStatus.sent,
      lastSentAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  return rows;
}

/**
 * Hands the next batch of work to an on-site connector asking on behalf of its terminals.
 *
 * One query across the agent's devices rather than `takePending` fifteen times. An agent polls
 * on a timer whether or not anybody scanned, so the per-poll cost is paid continuously by every
 * site — and fifteen round trips to answer "nothing waiting" is the shape that makes somebody
 * lengthen the poll interval and then wonder why enrolments feel slow.
 *
 * `sent` here means handed to the *agent*, not to the terminal. That is the correct boundary:
 * the agent is what must now report an outcome, and it is the thing that knows whether the unit
 * accepted the command.
 */
export async function takePendingForDevices(
  deviceIds: number[],
  limit: number,
): Promise<Array<{ id: bigint; deviceId: number; kind: string; payload: string }>> {
  if (deviceIds.length === 0) return [];

  const prisma = db();

  const rows = await prisma.deviceCommand.findMany({
    where: { deviceId: { in: deviceIds }, status: CommandStatus.pending },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, deviceId: true, kind: true, payload: true },
  });

  if (rows.length === 0) return [];

  await prisma.deviceCommand.updateMany({
    where: { id: { in: rows.map((row) => row.id) } },
    data: {
      status: CommandStatus.sent,
      lastSentAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  return rows;
}

/** Records what the terminal said about a command it collected. */
export async function recordOutcome(
  commandId: bigint,
  ok: boolean,
  result: string,
): Promise<void> {
  await db()
    .deviceCommand.update({
      where: { id: commandId },
      data: {
        status: ok ? CommandStatus.succeeded : CommandStatus.failed,
        completedAt: new Date(),
        result: result.slice(0, 500),
      },
    })
    /**
     * Swallowed, because an unknown command id is a terminal reporting on something this
     * server has no record of — after a database restore, or from a unit that was pointed
     * here by mistake. Neither is worth failing the request the terminal is waiting on.
     */
    .catch((error: unknown) => {
      logger().warn(
        { commandId: String(commandId), err: error },
        'Terminal reported on a command that is not in the queue',
      );
    });
}

/**
 * Re-offers commands a terminal took but never reported on.
 *
 * TA Push commands are idempotent by content — an upsert or a delete — so repeating one is
 * safer than losing it between the HTTP response and the acknowledgement that never came.
 *
 * The window matters: too short and a unit that is simply slow gets duplicate work, too long
 * and a restart during a roster push leaves people un-enrolled for that whole period.
 */
export async function requeueStale(staleAfterMs: number, maxAttempts: number): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs);

  const revived = await db().deviceCommand.updateMany({
    where: {
      status: CommandStatus.sent,
      lastSentAt: { lt: cutoff },
      attempts: { lt: maxAttempts },
    },
    data: { status: CommandStatus.pending },
  });

  /**
   * Commands past the attempt ceiling are failed rather than retried forever.
   *
   * A command that a terminal has taken four times without ever acknowledging is not going to
   * succeed on the fifth, and leaving it pending means the queue never drains — so a genuinely
   * new command sits behind it.
   */
  const abandoned = await db().deviceCommand.updateMany({
    where: {
      status: CommandStatus.sent,
      lastSentAt: { lt: cutoff },
      attempts: { gte: maxAttempts },
    },
    data: {
      status: CommandStatus.failed,
      completedAt: new Date(),
      result: `Terminal mengambil arahan ini ${String(maxAttempts)} kali tanpa melaporkan hasil`,
    },
  });

  if (revived.count > 0 || abandoned.count > 0) {
    logger().warn(
      { revived: revived.count, abandoned: abandoned.count },
      'Re-queued terminal commands that were never acknowledged',
    );
  }

  return revived.count;
}

/** Queue depth per status, for the device editor to show what a terminal owes. */
export async function queueSummary(deviceId: number): Promise<Record<string, number>> {
  const rows = await db().deviceCommand.groupBy({
    by: ['status'],
    where: { deviceId },
    _count: { _all: true },
  });

  const summary: Record<string, number> = {
    [CommandStatus.pending]: 0,
    [CommandStatus.sent]: 0,
    [CommandStatus.succeeded]: 0,
    [CommandStatus.failed]: 0,
  };
  for (const row of rows) summary[row.status] = row._count._all;
  return summary;
}

export type DeviceCommandRow = Prisma.DeviceCommandGetPayload<{
  select: { id: true; kind: true; payload: true };
}>;
