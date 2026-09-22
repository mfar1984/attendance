import { RawEventKind } from '@attendance/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth, requirePermission } from '../auth/plugin.js';
import { db, jsonSafe } from '../db.js';
import { loadEnv } from '../env.js';
import { notFound, parseBody, unauthorized } from '../http.js';
import { asDateOnly, zonedDateOnly } from '../time.js';

const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Day-to-day operational reads: the exception queue, the raw device log and the
 * computed attendance records.
 *
 * These three are deliberately separate endpoints rather than one flexible query.
 * They answer different questions and carry different guarantees - in particular
 * the raw log is immutable and the records are not.
 */
export async function operationsRoutes(app: FastifyInstance): Promise<void> {
  const env = loadEnv();

  // -------------------------------------------------------------------------
  // Exceptions
  // -------------------------------------------------------------------------

  app.get(
    '/api/exceptions',
    { preHandler: requirePermission('attendance.exceptions', 'view') },
    async (request) => {
      const query = pagingSchema
        .extend({
          kind: z.string().trim().max(32).optional(),
          resolved: z.stringbool().optional(),
          staffId: z.coerce.number().int().positive().optional(),
          deviceId: z.coerce.number().int().positive().optional(),
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
        })
        .parse(request.query);

      const where = {
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.resolved === undefined
          ? {}
          : query.resolved
            ? { resolvedAt: { not: null } }
            : { resolvedAt: null }),
        ...(query.staffId ? { staffId: query.staffId } : {}),
        ...(query.deviceId ? { deviceId: query.deviceId } : {}),
        ...(query.from || query.to
          ? {
              occurredAt: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: endOfDay(query.to) } : {}),
              },
            }
          : {}),
      };

      const [total, rows, byKind] = await Promise.all([
        db().attendanceException.count({ where }),
        db().attendanceException.findMany({
          where,
          orderBy: [{ resolvedAt: 'asc' }, { occurredAt: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            staff: { select: { id: true, employeeNo: true, fullName: true } },
          },
        }),
        // Counts per kind so the UI can offer filters that reflect what is
        // actually queued rather than a fixed list of every possible kind.
        db().attendanceException.groupBy({
          by: ['kind'],
          where: { resolvedAt: null },
          _count: { _all: true },
        }),
      ]);

      const devices = await db().device.findMany({ select: { id: true, name: true } });
      const deviceNames = new Map(devices.map((device) => [device.id, device.name]));

      return jsonSafe({
        total,
        page: query.page,
        pageSize: query.pageSize,
        openByKind: Object.fromEntries(byKind.map((row) => [row.kind, row._count._all])),
        rows: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          detail: row.detail,
          occurredAt: row.occurredAt,
          workDate: row.workDate,
          staff: row.staff,
          deviceName: row.deviceId === null ? null : (deviceNames.get(row.deviceId) ?? null),
          rawEventId: row.rawEventId,
          resolvedAt: row.resolvedAt,
          resolutionNote: row.resolutionNote,
        })),
      });
    },
  );

  /**
   * Marks an exception as handled.
   *
   * A note is required rather than optional. An exception closed without a reason
   * tells whoever reads it later nothing, and these rows are what answer a
   * dispute over someone's pay.
   */
  app.post(
    '/api/exceptions/:id/resolve',
    { preHandler: requirePermission('attendance.exceptions', 'approve') },
    async (request) => {
      if (!request.user) throw unauthorized();

      const id = idParam(request.params);
      const body = parseBody(
        z.object({ note: z.string().trim().min(3, 'Sebab diperlukan').max(500) }),
        request.body,
      );

      const existing = await db().attendanceException.findUnique({ where: { id } });
      if (!existing) throw notFound('Pengecualian tidak dijumpai');

      const updated = await db().attendanceException.update({
        where: { id },
        data: {
          resolvedAt: new Date(),
          resolvedBy: request.user.accountId,
          resolutionNote: body.note,
        },
      });

      await db().auditLog.create({
        data: {
          accountId: request.user.accountId,
          actorLabel: request.user.fullName,
          action: 'update',
          entityType: 'AttendanceException',
          entityId: String(id),
          changes: { resolvedAt: { before: null, after: updated.resolvedAt } },
          reason: body.note,
        },
      });

      return jsonSafe({ ok: true, id });
    },
  );

  // -------------------------------------------------------------------------
  // Raw device log
  // -------------------------------------------------------------------------

  /**
   * The untouched device log.
   *
   * Read-only by design, with no update or delete route anywhere in the
   * application, including for administrators. That is precisely what makes it
   * usable as evidence when a computed record is challenged.
   */
  app.get(
    '/api/raw-events',
    { preHandler: requirePermission('attendance.rawLog', 'view') },
    async (request) => {
      const query = pagingSchema
        .extend({
          deviceId: z.coerce.number().int().positive().optional(),
          employeeNo: z.string().trim().max(32).optional(),
          major: z.coerce.number().int().optional(),
          minor: z.coerce.number().int().optional(),
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
          arrivedVia: z.enum(['push', 'pull']).optional(),
          /** Only events that identified a person. */
          identifiedOnly: z.stringbool().optional(),
        })
        .parse(request.query);

      const where = {
        ...(query.deviceId ? { deviceId: query.deviceId } : {}),
        ...(query.employeeNo ? { employeeNo: query.employeeNo } : {}),
        ...(query.major !== undefined ? { major: query.major } : {}),
        ...(query.minor !== undefined ? { minor: query.minor } : {}),
        ...(query.arrivedVia ? { arrivedVia: query.arrivedVia } : {}),
        /**
         * Filtered on the driver's verdict, not on Hikvision event codes.
         *
         * This was `major: 5, minor: { in: [38, 75, 113] }`. Those numbers describe one
         * vendor's wire format, so on a ZKTeco terminal the filter would match nothing
         * and the screen would report that no scan had ever identified anybody there.
         */
        ...(query.identifiedOnly ? { eventKind: RawEventKind.identified } : {}),
        ...(query.from || query.to
          ? {
              eventTime: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: endOfDay(query.to) } : {}),
              },
            }
          : {}),
      };

      const [total, rows] = await Promise.all([
        db().rawEvent.count({ where }),
        db().rawEvent.findMany({
          where,
          /**
           * Newest first by the instant the scan happened, not by sequence number.
           *
           * Sorting on `serialNo` put every event from a protocol without one at the
           * very bottom of the list — MySQL orders nulls last on a descending sort — so
           * a ZKTeco terminal's scans would sit permanently below years of Hikvision
           * history and read as though they never arrived. `id` breaks ties so paging
           * stays stable when several events share a timestamp.
           */
          orderBy: [{ eventTime: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            eventKey: true,
            serialNo: true,
            eventKind: true,
            verifyMethod: true,
            major: true,
            minor: true,
            eventTime: true,
            receivedAt: true,
            employeeNo: true,
            personName: true,
            cardNo: true,
            verifyMode: true,
            doorNo: true,
            maskWorn: true,
            pictureUrl: true,
            arrivedVia: true,
            deviceDriftS: true,
            device: { select: { id: true, name: true } },
            punch: {
              select: { id: true, staffId: true, suppressed: true, direction: true },
            },
          },
        }),
      ]);

      return jsonSafe({ total, page: query.page, pageSize: query.pageSize, rows });
    },
  );

  // -------------------------------------------------------------------------
  // Computed attendance
  // -------------------------------------------------------------------------

  app.get(
    '/api/attendance/records',
    { preHandler: requirePermission('attendance.records', 'view') },
    async (request) => {
      const query = pagingSchema
        .extend({
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
          staffId: z.coerce.number().int().positive().optional(),
          status: z.string().trim().max(20).optional(),
          search: z.string().trim().max(128).optional(),
        })
        .parse(request.query);

      const today = zonedDateOnly(new Date(), env.ORG_TIMEZONE);

      const where = {
        workDate: {
          gte: query.from ? asDateOnly(query.from) : today,
          lte: query.to ? asDateOnly(query.to) : today,
        },
        ...(query.staffId ? { staffId: query.staffId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
              staff: {
                OR: [
                  { fullName: { contains: query.search } },
                  { employeeNo: { contains: query.search } },
                ],
              },
            }
          : {}),
      };

      const [total, rows, byStatus] = await Promise.all([
        db().attendanceRecord.count({ where }),
        db().attendanceRecord.findMany({
          where,
          orderBy: [{ workDate: 'desc' }, { staffId: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            staff: { select: { id: true, employeeNo: true, fullName: true } },
            shift: { select: { code: true, name: true } },
            // Included because a day can hold several worked intervals: split
            // shifts, and night shifts that cross midnight.
            blocks: { orderBy: { blockOrder: 'asc' } },
          },
        }),
        db().attendanceRecord.groupBy({
          by: ['status'],
          where,
          _count: { _all: true },
        }),
      ]);

      return jsonSafe({
        total,
        page: query.page,
        pageSize: query.pageSize,
        byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
        rows,
      });
    },
  );

  /**
   * Proxies an event snapshot from the terminal.
   *
   * Fetched through the server because the picture lives on the device behind
   * Digest auth, which a browser cannot satisfy. Streaming it here also keeps the
   * device credentials from ever reaching the client.
   */
  app.get(
    '/api/raw-events/:id/picture',
    { preHandler: requirePermission('attendance.rawLog', 'view') },
    async (request, reply) => {
      const id = idParam(request.params);

      const event = await db().rawEvent.findUnique({
        where: { id: BigInt(id) },
        select: { pictureUrl: true, device: true },
      });
      if (!event?.pictureUrl) throw notFound('Tiada gambar untuk event ini');

      const { driverFor } = await import('../devices/registry.js');
      // The pointer the event carried, handed back to the driver that produced it.
      const image = await driverFor(event.device).events.picture(event.pictureUrl);

      return reply
        .header('content-type', 'image/jpeg')
        .header('cache-control', 'private, max-age=3600')
        .send(image);
    },
  );

  /** Reference data the operational filters need. */
  app.get('/api/lookups', { preHandler: requireAuth }, async () => {
    const [devices, departments, locations, shifts] = await Promise.all([
      db().device.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      db().department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      db().location.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      db().shift.findMany({
        select: { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      }),
    ]);

    return jsonSafe({ devices, departments, locations, shifts, timeZone: env.ORG_TIMEZONE });
  });
}

function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function idParam(params: unknown): number {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
  if (!parsed.success) throw notFound('Rekod tidak dijumpai');
  return parsed.data.id;
}
