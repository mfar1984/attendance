import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db, jsonSafe } from '../db.js';
import { conflict } from '../http.js';
import { dateOnlyFromKey, dateOnlyKey, dateOnlySpan } from '../time.js';
import { apiSettings, applyCors, requireApiAuth, requireApiScope } from './guard.js';

/**
 * The public API.
 *
 * Read-only, and small on purpose. Every endpoint here is a surface somebody outside this
 * application can reach, so the set is the minimum that makes an integration possible
 * rather than everything the internal API can do.
 *
 * There are no write endpoints. A token that could alter attendance would put a change in
 * the record with no person attached to it, and the audit trail is built on there always
 * being one. That is a gap to close deliberately, not to leave open by default.
 *
 * Responses are shaped for a consumer rather than for our own screens: flat, named in
 * English, and without internal row ids where a stable business key exists.
 */
export async function publicApiRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Preflight, answered without a token.
   *
   * A browser sends `OPTIONS` before the real request and will not attach credentials to
   * it, so requiring one here would make every browser caller fail before it started.
   */
  app.options('/api/public/*', async (request, reply) => {
    const settings = await apiSettings();
    if (!settings.enabled) return reply.status(404).send();
    applyCors(reply, request.headers.origin, settings);
    return reply.status(204).send();
  });

  /**
   * What this token is and what it may do.
   *
   * Needs no scope of its own: it reveals nothing the holder does not already have, and
   * it is the endpoint an integrator hits first to confirm the credential works.
   */
  app.get(
    '/api/public/whoami',
    { preHandler: requireApiAuth() },
    async (request) => {
      const token = request.apiToken;

      return jsonSafe({
        authenticated: token !== undefined,
        token:
          token === undefined
            ? null
            : {
                name: token.name,
                prefix: token.prefix,
                scopes: token.scopes,
                /** True while a rotated token is living out its grace window. */
                superseded: token.superseded,
                graceUntil: token.graceUntil,
              },
        serverTime: new Date().toISOString(),
      });
    },
  );

  app.get(
    '/api/public/staff',
    { preHandler: requireApiScope('staff.directory', 'view') },
    async (request) => {
      const query = z
        .object({
          department: z.string().trim().max(120).optional(),
          active: z.stringbool().optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(200).default(50),
        })
        .parse(request.query);

      const where = {
        ...(query.active === undefined ? { active: true } : { active: query.active }),
        ...(query.department === undefined
          ? {}
          : { department: { name: { contains: query.department } } }),
      };

      const [total, rows] = await Promise.all([
        db().staff.count({ where }),
        db().staff.findMany({
          where,
          orderBy: { employeeNo: 'asc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            employeeNo: true,
            fullName: true,
            active: true,
            department: { select: { name: true } },
            location: { select: { name: true } },
          },
        }),
      ]);

      return jsonSafe({
        total,
        page: query.page,
        pageSize: query.pageSize,
        // No `icNo`, no phone, no email. Identifying a person to an external system needs
        // the staff number, and the rest is personal data with no stated purpose here.
        data: rows.map((row) => ({
          employeeNo: row.employeeNo,
          fullName: row.fullName,
          active: row.active,
          department: row.department?.name ?? null,
          location: row.location?.name ?? null,
        })),
      });
    },
  );

  app.get(
    '/api/public/attendance',
    { preHandler: requireApiScope('attendance.records', 'view') },
    async (request) => {
      const query = z
        .object({
          from: z.string().trim().length(10),
          to: z.string().trim().length(10),
          employeeNo: z.string().trim().max(32).optional(),
          status: z.string().trim().max(20).optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(200).default(50),
        })
        .parse(request.query);

      const from = dateOnlyFromKey(query.from);
      const to = dateOnlyFromKey(query.to);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw conflict('Tarikh tidak sah');
      }
      if (to < from) throw conflict('Tarikh tamat sebelum tarikh mula');
      // Bounded so one call cannot ask for five years and turn into a timeout that looks
      // like the API is down.
      if (dateOnlySpan(from, to) > 92) {
        throw conflict('Tempoh melebihi 92 hari. Pecahkan kepada beberapa permintaan.');
      }

      const where = {
        workDate: { gte: from, lte: to },
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.employeeNo === undefined ? {} : { staff: { employeeNo: query.employeeNo } }),
      };

      const [total, rows] = await Promise.all([
        db().attendanceRecord.count({ where }),
        db().attendanceRecord.findMany({
          where,
          orderBy: [{ workDate: 'asc' }, { staffId: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            workDate: true,
            status: true,
            checkInAt: true,
            checkOutAt: true,
            lateMinutes: true,
            earlyLeaveMinutes: true,
            workedMinutes: true,
            overtimeMinutes: true,
            staff: { select: { employeeNo: true, fullName: true } },
          },
        }),
      ]);

      return jsonSafe({
        period: { from: dateOnlyKey(from), to: dateOnlyKey(to) },
        total,
        page: query.page,
        pageSize: query.pageSize,
        data: rows.map((row) => ({
          // A calendar date, serialised as one. Sending a timestamp would invite the
          // consumer to re-interpret it in their own zone and land a day out.
          workDate: dateOnlyKey(row.workDate),
          employeeNo: row.staff.employeeNo,
          fullName: row.staff.fullName,
          status: row.status,
          checkInAt: row.checkInAt,
          checkOutAt: row.checkOutAt,
          lateMinutes: row.lateMinutes,
          earlyLeaveMinutes: row.earlyLeaveMinutes,
          workedMinutes: row.workedMinutes,
          overtimeMinutes: row.overtimeMinutes,
        })),
      });
    },
  );

  app.get(
    '/api/public/leave',
    { preHandler: requireApiScope('schedule.leave', 'view') },
    async (request) => {
      const query = z
        .object({
          from: z.string().trim().length(10).optional(),
          to: z.string().trim().length(10).optional(),
          status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
          employeeNo: z.string().trim().max(32).optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(200).default(50),
        })
        .parse(request.query);

      // Overlap rather than containment: a request spanning a month boundary belongs to
      // both months.
      const where = {
        ...(query.to === undefined ? {} : { fromDate: { lte: dateOnlyFromKey(query.to) } }),
        ...(query.from === undefined ? {} : { toDate: { gte: dateOnlyFromKey(query.from) } }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.employeeNo === undefined ? {} : { staff: { employeeNo: query.employeeNo } }),
      };

      const [total, rows] = await Promise.all([
        db().leaveRequest.count({ where }),
        db().leaveRequest.findMany({
          where,
          orderBy: { fromDate: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            fromDate: true,
            toDate: true,
            days: true,
            status: true,
            leaveType: { select: { code: true, name: true, paid: true } },
            staff: { select: { employeeNo: true, fullName: true } },
          },
        }),
      ]);

      return jsonSafe({
        total,
        page: query.page,
        pageSize: query.pageSize,
        data: rows.map((row) => ({
          employeeNo: row.staff.employeeNo,
          fullName: row.staff.fullName,
          fromDate: dateOnlyKey(row.fromDate),
          toDate: dateOnlyKey(row.toDate),
          days: row.days,
          status: row.status,
          leaveType: row.leaveType.code,
          leaveTypeName: row.leaveType.name,
          paid: row.leaveType.paid,
          // No `reason`, no `decisionNote`. Both are free text about a person's health or
          // circumstances, and an integration asking "who is off" does not need them.
        })),
      });
    },
  );
}
