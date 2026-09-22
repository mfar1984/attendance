import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requirePermission } from '../auth/plugin.js';
import { db, jsonSafe } from '../db.js';
import { loadEnv } from '../env.js';
import {
  JUSTIFIABLE_STATUSES,
  JUSTIFICATION_DECISIONS,
  JUSTIFICATION_STATUSES,
  checkDecision,
  type JustificationDecision,
  type JustificationStatus,
  type Refusal,
} from '../hr/justification.js';
import { conflict, notFound, parseBody, unauthorized } from '../http.js';
import { recordActivity } from '../logging/activity.js';
import { notify } from '../notify/dispatch.js';
import { parsePeriod } from '../reports/aggregate.js';
import { dateOnlyKey, zonedDateOnly } from '../time.js';

/**
 * Deciding the explanations staff have filed for their own attendance.
 *
 * ## Its own screen, separate from Pengecualian
 *
 * `attendance.exceptions` is the eight technical conditions the engine could not resolve — an
 * unmatched face, a terminal whose clock drifted, a punch for an unmapped identifier. Resolving one
 * corrects data.
 *
 * This screen is the four states the engine resolved with confidence and that somebody wants to
 * account for. The record is right; deciding here changes no attendance figure anywhere.
 *
 * They were nearly one screen. The problem with that is not the table — it is that a person sitting
 * at it would be asked to decide "this terminal's clock drifted by 8 minutes" and "Siti was late
 * because her child was ill" through the same form, with nothing on screen saying which kind of
 * thing they were looking at. The reference system has no clock-drift detection to show, so it never
 * had to make this distinction; we do.
 *
 * ## Nothing here writes to attendance
 *
 * A decision sets a status and a note. If approving could move a figure, the figure would stop being
 * derivable from the raw log — which is the one property the whole system rests on. What an approval
 * changes is what the summary counts as accounted for, and the summary reads this table.
 */

function idParam(params: unknown): number {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
  if (!parsed.success) throw notFound('Rekod tidak dijumpai');
  return parsed.data.id;
}

function refusalMessage(refusal: Refusal): string {
  const v = refusal.vars ?? {};
  switch (refusal.key) {
    case 'justify.refuse.badDecision':
      return 'Keputusan tidak dikenali.';
    case 'justify.refuse.alreadyDecided':
      return (
        `Justifikasi ini sudah "${String(v.status ?? '?')}". Keputusan yang sudah dibuat dan ` +
        'ditandatangani tidak ditulis semula.'
      );
    case 'justify.refuse.noteRequired':
      return (
        'Menolak dan menghantar semula memerlukan catatan. Keputusan tanpa perkataan ialah ' +
        'keputusan yang orang itu tidak boleh terima atau perbaiki.'
      );
    default:
      return 'Tindakan ini tidak sah.';
  }
}

export async function justificationRoutes(app: FastifyInstance): Promise<void> {
  const env = loadEnv();

  /**
   * The queue, filtered the way the reference system filters it: period, department, person.
   *
   * Those three because they match how the work arrives — a supervisor handles their own department
   * for the month that just closed, and looks one person up when that person asks.
   */
  app.get(
    '/api/justifications',
    { preHandler: requirePermission('attendance.justifications', 'view') },
    async (request) => {
      const query = z
        .object({
          dari: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          hingga: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          departmentId: z.coerce.number().int().positive().optional(),
          staffId: z.coerce.number().int().positive().optional(),
          status: z.enum(JUSTIFICATION_STATUSES).optional(),
          jenis: z.enum(JUSTIFIABLE_STATUSES).optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(200).default(25),
        })
        .parse(request.query);

      const todayKey = dateOnlyKey(zonedDateOnly(new Date(), env.ORG_TIMEZONE));
      const period = parsePeriod(
        query.dari ?? `${todayKey.slice(0, 7)}-01`,
        query.hingga ?? todayKey,
        env.ORG_TIMEZONE,
      );

      const where = {
        // Calendar bounds against a calendar column. Instant bounds would miss eight hours at each
        // end of the range that belong to the local day.
        workDate: { gte: period.from, lte: period.to },
        ...(query.staffId === undefined ? {} : { staffId: query.staffId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.jenis === undefined ? {} : { statusKind: query.jenis }),
        ...(query.departmentId === undefined
          ? {}
          : { staff: { departmentId: query.departmentId } }),
      };

      const [rows, total, grouped] = await Promise.all([
        db().attendanceJustification.findMany({
          where,
          // Pending first, then oldest day: the queue reads as work to do, not as a log.
          orderBy: [{ status: 'asc' }, { workDate: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            staff: {
              select: {
                id: true,
                employeeNo: true,
                fullName: true,
                department: { select: { name: true } },
              },
            },
          },
        }),
        db().attendanceJustification.count({ where }),
        /*
         * Chip counts ignore the status filter, so choosing one does not zero the others.
         *
         * Otherwise the remaining chips read as "there are none of those" when what happened is
         * that the list is filtered.
         */
        db().attendanceJustification.groupBy({
          by: ['status'],
          where: { ...where, status: undefined },
          _count: { _all: true },
        }),
      ]);

      /*
       * The attendance record behind each row, fetched alongside.
       *
       * The queue is unreadable without it: a reason for a late day means nothing without the times
       * it is explaining. Fetched in one query keyed on the pairs actually on this page rather than
       * joined, because the justification points at `(staffId, workDate)` and not at a record id —
       * records are rebuilt from the raw log and a foreign key to one would cascade these away.
       */
      const records =
        rows.length === 0
          ? []
          : await db().attendanceRecord.findMany({
              where: {
                OR: rows.map((row) => ({ staffId: row.staffId, workDate: row.workDate })),
              },
              include: { shift: { select: { name: true } } },
            });
      const byKey = new Map(
        records.map((row) => [`${String(row.staffId)}|${dateOnlyKey(row.workDate)}`, row]),
      );

      return jsonSafe({
        from: dateOnlyKey(period.from),
        to: dateOnlyKey(period.to),
        rows: rows.map((row) => {
          const key = `${String(row.staffId)}|${dateOnlyKey(row.workDate)}`;
          const record = byKey.get(key);
          return {
            id: row.id,
            staffId: row.staffId,
            employeeNo: row.staff.employeeNo,
            staffName: row.staff.fullName,
            departmentName: row.staff.department?.name ?? null,
            workDate: dateOnlyKey(row.workDate),
            statusKind: row.statusKind,
            reason: row.reason,
            status: row.status,
            decisionNote: row.decisionNote,
            submittedAt: row.submittedAt.toISOString(),
            decidedAt: row.decidedAt?.toISOString() ?? null,
            /*
             * Null when the day has been recomputed into a different shape since — a shift rule
             * changed, or a corrected terminal clock moved the punch. The row still stands as a
             * record of what was asked and answered, and the screen shows the gap rather than
             * hiding it.
             */
            record:
              record === undefined
                ? null
                : {
                    status: record.status,
                    shiftName: record.shift?.name ?? null,
                    scheduledStart: record.scheduledStart?.toISOString() ?? null,
                    scheduledEnd: record.scheduledEnd?.toISOString() ?? null,
                    checkInAt: record.checkInAt?.toISOString() ?? null,
                    checkOutAt: record.checkOutAt?.toISOString() ?? null,
                    lateMinutes: record.lateMinutes,
                    earlyLeaveMinutes: record.earlyLeaveMinutes,
                    workedMinutes: record.workedMinutes,
                  },
          };
        }),
        total,
        counts: Object.fromEntries(grouped.map((row) => [row.status, row._count._all])),
        generatedAt: new Date().toISOString(),
      });
    },
  );

  /**
   * Approve, reject, or send back.
   *
   * Three outcomes, not two. `reverted` sends the day back for a better explanation — "your reason
   * was not accepted" and "I cannot act on what you wrote" are different messages, and only one of
   * them means the person should try again. The reference system calls the third button *Revert* and
   * it is the one that keeps a thin submission from becoming a permanent rejection.
   */
  app.post(
    '/api/justifications/:id/decision',
    { preHandler: requirePermission('attendance.justifications', 'approve') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const id = idParam(request.params);

      const body = parseBody(
        z.strictObject({
          decision: z.enum(JUSTIFICATION_DECISIONS),
          note: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
        }),
        request.body,
      );

      const existing = await db().attendanceJustification.findUnique({
        where: { id },
        include: {
          staff: { select: { fullName: true, employeeNo: true, email: true, phone: true } },
        },
      });
      if (!existing) throw notFound('Justifikasi tidak dijumpai');

      const refusal = checkDecision({
        current: existing.status as JustificationStatus,
        decision: body.decision as JustificationDecision,
        note: body.note ?? null,
      });
      if (refusal) throw conflict(refusalMessage(refusal));

      const note = body.note?.trim() ?? '';

      await db().attendanceJustification.update({
        where: { id },
        data: {
          status: body.decision,
          /*
           * `reverted` gets no `decidedAt`.
           *
           * It is not a decision — it is the row going back to the employee, and stamping it as
           * decided would make an open item look closed in every list that sorts on that column.
           */
          ...(body.decision === 'reverted'
            ? { decidedAt: null }
            : { decidedAt: new Date() }),
          decidedBy: request.user.accountId,
          decisionNote: note === '' ? null : note,
        },
      });

      /*
       * The person is told. This is the one notification the module raises.
       *
       * Not gated behind a module setting like the request modules are: those settings exist because
       * an approval chain can announce a decision several times over as it climbs, and this has no
       * chain. One submission, one outcome, one message.
       */
      notify({
        trigger: 'justification.decided',
        mobile: existing.staff.phone,
        summary:
          `Justifikasi ${dateOnlyKey(existing.workDate)} (${existing.statusKind}): ` +
          `${body.decision}.`,
        lines: [...(note === '' ? [] : [`Catatan: ${note}`])],
        email: {
          module: 'justification',
          /*
           * The decision maps straight onto an event name, and everted is its own template.
           *
           * Reusing ejected for it would send somebody a message saying their reason was refused
           * when what happened is that they were asked to rewrite it.
           */
          event: body.decision === 'approved' ? 'approved' : body.decision === 'rejected' ? 'rejected' : 'reverted',
          to: existing.staff.email,
          vars: {
            staffName: existing.staff.fullName,
            employeeNo: existing.staff.employeeNo,
            requestNo: dateOnlyKey(existing.workDate),
            status: body.decision,
            decidedBy: request.user.fullName,
            note: note === '' ? null : note,
            workDate: dateOnlyKey(existing.workDate),
            statusKind: existing.statusKind,
          },
        },
      });

      await recordActivity({
        request,
        action: `justification.${body.decision}`,
        category: 'attendance',
        level: body.decision === 'approved' ? 'info' : 'warn',
        detail:
          `${existing.staff.fullName} ${dateOnlyKey(existing.workDate)} ` +
          `(${existing.statusKind})${note === '' ? '' : `: ${note}`}`,
      });

      return { ok: true };
    },
  );
}
