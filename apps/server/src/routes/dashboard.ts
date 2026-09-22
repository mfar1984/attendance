import { staffQuerySchema } from '@attendance/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth, requirePermission } from '../auth/plugin.js';
import { recomputeRange } from '../attendance/engine.js';
import { db, jsonSafe } from '../db.js';
import { loadEnv } from '../env.js';
import { parseBody } from '../http.js';
import { asDateOnly, timeOnDateOnly, zonedDateOnly } from '../time.js';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Everything the dashboard needs in one round trip.
   *
   * Assembled server-side rather than as several client calls so the figures on
   * screen all describe the same instant. Separate requests would let the totals
   * and the scan list disagree while people are actively clocking in.
   */
  app.get('/api/dashboard', { preHandler: requireAuth }, async () => {
    const prisma = db();
    const env = loadEnv();
    // "Today" is the organisation's day, not the server's. Two forms of it: the
    // calendar date that `workDate` is keyed by, and the instants that bound the day
    // for punches, which are real timestamps.
    const today = zonedDateOnly(new Date(), env.ORG_TIMEZONE);
    const dayStart = timeOnDateOnly(today, '00:00', env.ORG_TIMEZONE);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);

    const [
      staffTotal,
      missingBiometrics,
      records,
      recentPunches,
      openExceptions,
      devices,
    ] = await Promise.all([
      prisma.staff.count({ where: { active: true } }),
      // Enrolled on a terminal yet unable to scan at all. The test unit already
      // holds one such record, and at this headcount the condition spreads
      // without ever raising an error.
      prisma.staff.count({
        where: { active: true, numOfFace: 0, numOfFp: 0, numOfCard: 0 },
      }),
      prisma.attendanceRecord.groupBy({
        by: ['status'],
        where: { workDate: today },
        _count: { _all: true },
      }),
      prisma.punch.findMany({
        where: { punchAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { punchAt: 'desc' },
        take: 15,
        include: {
          staff: { select: { employeeNo: true, fullName: true } },
          device: { select: { name: true } },
        },
      }),
      prisma.attendanceException.findMany({
        where: { resolvedAt: null },
        orderBy: { occurredAt: 'desc' },
        take: 10,
        include: { staff: { select: { employeeNo: true, fullName: true } } },
      }),
      prisma.device.findMany({
        where: { active: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          host: true,
          model: true,
          status: true,
          clockDriftS: true,
          clockMode: true,
          faceCapacity: true,
          lastSeenAt: true,
          syncState: { select: { lastSerialNo: true, lastSyncAt: true, lastPushAt: true } },
          _count: { select: { enrolments: true } },
        },
      }),
    ]);

    const byStatus = Object.fromEntries(
      records.map((row) => [row.status, row._count._all]),
    ) as Record<string, number>;

    return jsonSafe({
      today: {
        date: today,
        staffTotal,
        missingBiometrics,
        present:
          (byStatus['on_time'] ?? 0) +
          (byStatus['late'] ?? 0) +
          (byStatus['early_leave'] ?? 0) +
          (byStatus['incomplete'] ?? 0),
        late: byStatus['late'] ?? 0,
        absent: byStatus['absent'] ?? 0,
        onLeave: byStatus['on_leave'] ?? 0,
      },
      recentScans: recentPunches.map((punch) => ({
        id: punch.id,
        time: punch.punchAt,
        employeeNo: punch.staff.employeeNo,
        name: punch.staff.fullName,
        device: punch.device?.name ?? null,
        method: punch.method,
        direction: punch.direction,
        suppressed: punch.suppressed,
      })),
      exceptions: openExceptions.map((exception) => ({
        id: exception.id,
        kind: exception.kind,
        detail: exception.detail,
        occurredAt: exception.occurredAt,
        employeeNo: exception.staff?.employeeNo ?? null,
        name: exception.staff?.fullName ?? null,
      })),
      devices: devices.map((device) => ({
        id: device.id,
        name: device.name,
        host: device.host,
        model: device.model,
        status: device.status,
        clockDriftSeconds: device.clockDriftS,
        clockMode: device.clockMode,
        enrolled: device._count.enrolments,
        capacity: device.faceCapacity,
        lastSerialNo: device.syncState?.lastSerialNo ?? 0,
        lastSyncAt: device.syncState?.lastSyncAt ?? null,
        lastPushAt: device.syncState?.lastPushAt ?? null,
        lastSeenAt: device.lastSeenAt,
      })),
      driftThresholdSeconds: env.CLOCK_DRIFT_WARN_SECONDS,
      connectorMode: env.CONNECTOR_MODE,
    });
  });

  app.get('/api/staff', { preHandler: requirePermission('staff.directory', 'view') }, async (request) => {
    const query = staffQuerySchema.parse(request.query);
    const prisma = db();

    /**
     * The filters that are not chips: search and the two facets.
     *
     * Kept separate because the chip counts have to be computed *ignoring the chip's own
     * filter*. Folded into one `where`, selecting a chip zeroes the others and the rows they
     * would have shown look like they vanished.
     */
    const facets = {
      ...(query.departmentId !== undefined ? { departmentId: query.departmentId } : {}),
      ...(query.locationId !== undefined ? { locationId: query.locationId } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search } },
              { employeeNo: { contains: query.search } },
            ],
          }
        : {}),
    };

    /**
     * Unable to scan: active, and holding none of the three credentials.
     *
     * `active` is part of the definition, matching the dashboard tile. Without it the
     * biometrics screen counted deactivated staff as a problem to fix, which is a figure
     * nobody can act on.
     *
     * The inverse is expressed as `NOT` rather than an `OR` of three `gt: 0` clauses,
     * because search already occupies `OR` on this object and a second one would silently
     * overwrite the first.
     */
    const CANNOT_SCAN = { active: true, numOfFace: 0, numOfFp: 0, numOfCard: 0 };
    /**
     * Also scoped to active, so both chips describe people who currently work here.
     *
     * Without it a deactivated record with a stale credential mirror counts as enrolled, and
     * the two chips describe different populations — which reads as arithmetic that does not
     * add up. Deactivated staff are the directory's own chip, not this screen's business.
     */
    const CAN_SCAN = { active: true, NOT: { numOfFace: 0, numOfFp: 0, numOfCard: 0 } };

    const scope =
      query.biometrics === 'missing'
        ? CANNOT_SCAN
        : query.biometrics === 'enrolled'
          ? CAN_SCAN
          : {};

    const where = {
      ...facets,
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...scope,
    };

    const [total, rows, missingBiometrics, withBiometrics, inactive] = await Promise.all([
      prisma.staff.count({ where }),
      prisma.staff.findMany({
        where,
        orderBy: { employeeNo: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          employeeNo: true,
          fullName: true,
          active: true,
          numOfFace: true,
          numOfFp: true,
          numOfCard: true,
          /**
           * Selected to derive a boolean, and dropped before the reply is built.
           *
           * The door PIN is a fourth credential somebody can open a door with, so the
           * directory has to be able to show whether one is set — it was the only one of the
           * four with no indicator, which read as "no PIN" rather than "not shown". The
           * value itself never leaves this function.
           */
          doorPinEncrypted: true,
          department: { select: { name: true } },
          location: { select: { name: true } },
          account: { select: { email: true, status: true, allowAppCheckIn: true } },
        },
      }),
      // Each count answers "how many would this chip show if I clicked it", given the
      // current search and facets. Computed on the server because the client only ever
      // holds one page, and a page count presented as a total is simply a wrong number.
      prisma.staff.count({ where: { ...facets, ...CANNOT_SCAN } }),
      prisma.staff.count({ where: { ...facets, ...CAN_SCAN } }),
      prisma.staff.count({ where: { ...facets, active: false } }),
    ]);

    return jsonSafe({
      total,
      page: query.page,
      pageSize: query.pageSize,
      rows: rows.map(({ doorPinEncrypted, ...row }) => ({
        ...row,
        hasDoorPin: doorPinEncrypted !== null,
      })),
      counts: { missingBiometrics, withBiometrics, inactive },
    });
  });

  /**
   * Rebuilds attendance for a date range.
   *
   * Exposed as an explicit action because it is the intended remedy after a
   * clock correction or a shift rule change. Records are recomputed from the
   * immutable raw log, so running it twice is harmless.
   */
  app.post(
    '/api/attendance/recompute',
    { preHandler: requirePermission('settings.maintenance', 'recompute') },
    async (request) => {
      const body = parseBody(
        z
          .object({
            from: z.coerce.date(),
            to: z.coerce.date(),
            staffIds: z.array(z.number().int().positive()).optional(),
          })
          .refine((value) => value.from <= value.to, {
            message: 'Tarikh mula mesti sebelum atau sama dengan tarikh tamat',
            path: ['to'],
          }),
        request.body,
      );

      return recomputeRange(asDateOnly(body.from), asDateOnly(body.to), body.staffIds);
    },
  );
}


