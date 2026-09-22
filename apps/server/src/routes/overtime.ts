import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requirePermission } from '../auth/plugin.js';
import { can } from '../auth/service.js';
import { db, jsonSafe } from '../db.js';
import {
  applyApprovalAction,
  checkApproverTurn,
  deleteTrail,
  getChain,
  getTrail,
  moduleSettings,
  shouldNotifyApplicant,
} from '../hr/approval.js';
import {
  claimedMinutesInMonth,
  measuredOvertimeMinutes,
  resolveOvertimeDay,
  yearMonthOf,
} from '../hr/overtime-day.js';
import {
  MONTHLY_OVERTIME_CAP_MINUTES,
  OVERTIME_DAY_TYPES,
  checkOvertimeClaim,
  formatMinutes,
  hourlyRateFrom,
  overtimeAmount,
  rateShortfall,
  toSen,
  type OvertimeDayType,
} from '../hr/overtime.js';
import { REQUEST_PREFIX, highestSequence, nextRequestNo } from '../hr/request-number.js';
import { conflict, forbidden, forUpdate, notFound, parseBody, unauthorized } from '../http.js';
import { recordActivity } from '../logging/activity.js';
import { notify } from '../notify/dispatch.js';
import { asDateOnly, dateOnlyKey } from '../time.js';

/**
 * Overtime claims.
 *
 * The figure that matters is derived, not typed. `overtimeMinutes` on the attendance
 * record was computed from the raw log, and a claim is checked against it — so the
 * question an approver answers is "was this authorised", not "did this happen".
 *
 * The amount is written at approval and not at submission, because the approver is who
 * picks the rate. A pending claim owes nobody money, so a rejection has nothing to
 * unpick.
 */
export async function overtimeRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // Rates
  // -------------------------------------------------------------------------

  app.get(
    '/api/overtime-rates',
    { preHandler: requirePermission('hr.overtime', 'view') },
    async () => {
      const rows = await db().overtimeRate.findMany({
        orderBy: [{ active: 'desc' }, { dayType: 'asc' }, { isDefault: 'desc' }, { code: 'asc' }],
        include: { _count: { select: { requests: true } } },
      });

      return jsonSafe(
        rows.map(({ _count, multiplier, ...row }) => ({
          ...row,
          multiplier: Number(multiplier),
          requestCount: _count.requests,
          /*
           * Reported, not blocked. A rate below the floor is usually a typo, but an
           * organisation with a genuine reason to hold one should not be unable to
           * record what it actually pays — and a screen that says nothing is how the
           * shortfall reaches a payslip.
           */
          shortfall: rateShortfall(row.dayType as OvertimeDayType, Number(multiplier)),
        })),
      );
    },
  );

  const rateSchema = z.object({
    code: z.string().trim().min(1).max(16),
    name: z.string().trim().min(1).max(120),
    description: z.union([z.literal(''), z.string().trim().max(255)]).optional(),
    dayType: z.enum(OVERTIME_DAY_TYPES),
    // The column is DECIMAL(4,2), and a multiplier above 10 is a typo, not a policy.
    multiplier: z.coerce.number().gt(0).max(10),
    isDefault: z.boolean(),
    active: z.boolean().optional(),
  });

  app.post(
    '/api/overtime-rates',
    { preHandler: requirePermission('hr.overtime', 'configure') },
    async (request) => {
      const body = parseBody(rateSchema, request.body);
      const code = body.code.toUpperCase();

      const clash = await db().overtimeRate.findUnique({ where: { code } });
      if (clash) throw conflict(`Kod kadar "${code}" sudah ada`);

      // A fallback rate that cannot be used is not a fallback.
      if (body.isDefault && body.active === false) {
        throw conflict('Kadar tidak aktif tidak boleh menjadi kadar lalai');
      }

      const row = await db().$transaction(async (tx) => {
        if (body.isDefault) {
          await tx.overtimeRate.updateMany({
            where: { dayType: body.dayType, isDefault: true },
            data: { isDefault: false },
          });
        }
        return tx.overtimeRate.create({
          data: {
            code,
            name: body.name,
            description: body.description ? body.description : null,
            dayType: body.dayType,
            multiplier: toSen(body.multiplier),
            isDefault: body.isDefault,
            active: body.active ?? true,
          },
        });
      });

      await recordActivity({
        request,
        action: 'overtime.rate.created',
        category: 'settings',
        level: 'info',
        detail: `Kadar lebih masa ${code} (${body.multiplier}×) ditambah`,
      });

      return jsonSafe({ ...row, multiplier: Number(row.multiplier) });
    },
  );

  app.patch(
    '/api/overtime-rates/:id',
    { preHandler: requirePermission('hr.overtime', 'configure') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(forUpdate(rateSchema), request.body);

      const existing = await db().overtimeRate.findUnique({ where: { id } });
      if (!existing) throw notFound('Kadar tidak dijumpai');

      const dayType = body.dayType ?? (existing.dayType as OvertimeDayType);
      const isDefault = body.isDefault ?? existing.isDefault;
      const active = body.active ?? existing.active;
      if (isDefault && !active) {
        throw conflict('Kadar tidak aktif tidak boleh menjadi kadar lalai');
      }

      const row = await db().$transaction(async (tx) => {
        if (isDefault) {
          await tx.overtimeRate.updateMany({
            where: { dayType, isDefault: true, id: { not: id } },
            data: { isDefault: false },
          });
        }
        return tx.overtimeRate.update({
          where: { id },
          data: {
            ...(body.code === undefined ? {} : { code: body.code.toUpperCase() }),
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.description === undefined
              ? {}
              : { description: body.description ? body.description : null }),
            ...(body.dayType === undefined ? {} : { dayType: body.dayType }),
            ...(body.multiplier === undefined ? {} : { multiplier: toSen(body.multiplier) }),
            isDefault,
            active,
          },
        });
      });

      await recordActivity({
        request,
        action: 'overtime.rate.updated',
        category: 'settings',
        level: 'info',
        detail: `Kadar lebih masa ${row.code} dikemas kini`,
      });

      return jsonSafe({ ...row, multiplier: Number(row.multiplier) });
    },
  );

  app.delete(
    '/api/overtime-rates/:id',
    { preHandler: requirePermission('hr.overtime', 'configure') },
    async (request) => {
      const id = idParam(request.params);

      const used = await db().overtimeRequest.count({ where: { overtimeRateId: id } });
      // A decided claim still has to be able to name the rate it was paid at.
      if (used > 0) {
        throw conflict(
          `${used} permohonan masih merujuk kadar ini. Nyahaktifkan kadar itu sebagai ganti.`,
        );
      }

      await db().overtimeRate.delete({ where: { id } });
      await recordActivity({
        request,
        action: 'overtime.rate.deleted',
        category: 'settings',
        level: 'warn',
        detail: `Kadar lebih masa #${id} dibuang`,
      });

      return { ok: true };
    },
  );

  // -------------------------------------------------------------------------
  // Claims
  // -------------------------------------------------------------------------

  app.get(
    '/api/overtime-requests',
    { preHandler: requirePermission('hr.overtime', 'view') },
    async (request) => {
      const query = z
        .object({
          staffId: z.coerce.number().int().positive().optional(),
          status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(200).default(25),
        })
        .parse(request.query);

      const where = {
        ...(query.staffId === undefined ? {} : { staffId: query.staffId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.from === undefined && query.to === undefined
          ? {}
          : {
              workDate: {
                ...(query.from === undefined ? {} : { gte: asDateOnly(query.from) }),
                ...(query.to === undefined ? {} : { lte: asDateOnly(query.to) }),
              },
            }),
      };

      const [rows, total] = await Promise.all([
        db().overtimeRequest.findMany({
          where,
          orderBy: [{ workDate: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            staff: {
              select: { id: true, employeeNo: true, fullName: true, department: { select: { name: true } } },
            },
            rate: { select: { code: true, name: true, multiplier: true } },
          },
        }),
        db().overtimeRequest.count({ where }),
      ]);

      /*
       * Counts ignore the status filter on purpose. Computed inside it, choosing one chip
       * would zero the others and the remaining rows would look as if they had vanished.
       */
      const grouped = await db().overtimeRequest.groupBy({
        by: ['status'],
        where: { ...where, status: undefined },
        _count: { _all: true },
      });

      return jsonSafe({
        rows: rows.map(serialiseRequest),
        total,
        counts: Object.fromEntries(grouped.map((row) => [row.status, row._count._all])),
        /*
         * Sent once for the page rather than per row: it is a property of the module's
         * configuration, not of any one request, and the list needs it to turn a bare
         * `currentLevel` into "rung 2 of 3".
         */
        chainLength: (await getChain('overtime')).length,
        generatedAt: new Date().toISOString(),
      });
    },
  );

  /**
   * What this day was, and what it would pay — before anybody files anything.
   *
   * The form needs it to show the measured hours it is allowed to claim against. Without
   * it, somebody types a figure, submits, and is told it exceeds a number they were never
   * shown.
   */
  app.get(
    '/api/overtime-requests/quote',
    { preHandler: requirePermission('hr.overtime', 'view') },
    async (request) => {
      const query = z
        .object({ staffId: z.coerce.number().int().positive(), workDate: z.coerce.date() })
        .parse(request.query);

      const workDate = asDateOnly(query.workDate);

      const staff = await db().staff.findUnique({
        where: { id: query.staffId },
        select: { fullName: true, basicSalary: true, active: true },
      });
      if (!staff) throw notFound('Staf tidak dijumpai');

      const [day, measured, monthMinutes] = await Promise.all([
        resolveOvertimeDay(query.staffId, workDate),
        measuredOvertimeMinutes(query.staffId, workDate),
        claimedMinutesInMonth(query.staffId, workDate),
      ]);

      const hourlyRate =
        staff.basicSalary === null ? null : hourlyRateFrom(Number(staff.basicSalary));

      return jsonSafe({
        workDate: dateOnlyKey(workDate),
        staffName: staff.fullName,
        staffActive: staff.active,
        hasSalary: staff.basicSalary !== null,
        hourlyRate,
        measuredMinutes: measured,
        monthMinutes,
        monthCapMinutes: MONTHLY_OVERTIME_CAP_MINUTES,
        dayType: day.dayType,
        holidayName: day.holidayName,
        rateId: day.rateId,
        rateName: day.rateName,
        multiplier: day.multiplier,
        usingStatutoryFloor: day.usingStatutoryFloor,
        // An estimate, stated as one. The approver confirms the rate.
        estimate:
          hourlyRate === null ? null : overtimeAmount(hourlyRate, day.multiplier, measured),
      });
    },
  );

  app.post(
    '/api/overtime-requests',
    { preHandler: requirePermission('hr.overtime', 'create') },
    async (request) => {
      if (!request.user) throw unauthorized();

      const body = parseBody(
        z.object({
          staffId: z.number().int().positive(),
          workDate: z.coerce.date(),
          requestedMinutes: z.number().int().positive(),
          task: z.string().trim().min(1).max(190),
          reason: z.string().trim().min(1).max(500),
        }),
        request.body,
      );

      const workDate = asDateOnly(body.workDate);

      // Overtime is claimed for work already done, and the engine clamps its own range
      // at today, so a future date has nothing measured behind it either way.
      if (workDate.getTime() > asDateOnly(new Date()).getTime()) {
        throw conflict('Tarikh lebih masa tidak boleh pada masa hadapan');
      }

      const staff = await db().staff.findUnique({
        where: { id: body.staffId },
        select: { fullName: true, basicSalary: true, active: true },
      });
      if (!staff) throw notFound('Staf tidak dijumpai');
      if (!staff.active) throw conflict(`${staff.fullName} tidak aktif`);
      if (staff.basicSalary === null) {
        throw conflict(
          `${staff.fullName} tiada gaji bulanan direkodkan. Kadar sejam dikira daripadanya.`,
        );
      }

      // Two live claims on one day would each be priced against the same measured
      // minutes, so together they would claim the day twice.
      const existing = await db().overtimeRequest.findFirst({
        where: { staffId: body.staffId, workDate, status: { in: ['pending', 'approved'] } },
        select: { requestNo: true, status: true },
      });
      if (existing) {
        throw conflict(
          `Permohonan ${existing.requestNo} sudah ada untuk tarikh itu (${existing.status}).`,
        );
      }

      const [day, measured, monthMinutes] = await Promise.all([
        resolveOvertimeDay(body.staffId, workDate),
        measuredOvertimeMinutes(body.staffId, workDate),
        claimedMinutesInMonth(body.staffId, workDate),
      ]);

      const refusal = checkOvertimeClaim({
        measuredMinutes: measured,
        requestedMinutes: body.requestedMinutes,
        monthMinutes,
      });
      if (refusal) throw conflict(refusalMessage(refusal));

      const hourlyRate = hourlyRateFrom(Number(staff.basicSalary));

      /*
       * The sequence is read and the row written inside one transaction, and the unique
       * index on `requestNo` is the backstop. Two people filing in the same second would
       * otherwise read the same highest number.
       */
      const yearMonth = yearMonthOf(workDate);
      const row = await db().$transaction(async (tx) => {
        const latest = await tx.overtimeRequest.findMany({
          where: { requestNo: { startsWith: `${REQUEST_PREFIX.overtime}-${yearMonth}-` } },
          select: { requestNo: true },
        });
        const highest = highestSequence(latest.map((item) => item.requestNo));

        return tx.overtimeRequest.create({
          data: {
            requestNo: nextRequestNo(REQUEST_PREFIX.overtime, yearMonth, highest),
            staffId: body.staffId,
            workDate,
            measuredMinutes: measured,
            requestedMinutes: body.requestedMinutes,
            hourlyRate,
            dayType: day.dayType,
            task: body.task,
            reason: body.reason,
            status: 'pending',
          },
        });
      });

      await recordActivity({
        request,
        action: 'overtime.created',
        category: 'schedule',
        level: 'info',
        detail:
          `${row.requestNo}: ${staff.fullName}, ${dateOnlyKey(workDate)}, ` +
          `${body.requestedMinutes} minit daripada ${measured} minit diukur`,
      });

      return jsonSafe({
        ...serialiseRequest({ ...row, staff: null, rate: null }),
        estimate: overtimeAmount(hourlyRate, day.multiplier, body.requestedMinutes),
        multiplier: day.multiplier,
        rateConfirmedOnApproval: true,
      });
    },
  );

  /**
   * Approving decides how much is owed, because approving is when the rate is chosen.
   *
   * That is what makes this different from a leave decision: the amount is computed and
   * written here, from the rate picked now and the hourly rate frozen at submission.
   */
  app.post(
    '/api/overtime-requests/:id/decide',
    { preHandler: requirePermission('hr.overtime', 'approve') },
    async (request) => {
      if (!request.user) throw unauthorized();

      const id = idParam(request.params);
      const body = parseBody(
        z.object({
          decision: z.enum(['approved', 'rejected']),
          overtimeRateId: z.number().int().positive().optional(),
          note: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
        }),
        request.body,
      );

      const existing = await db().overtimeRequest.findUnique({
        where: { id },
        // `phone`, `email` and `employeeNo` are read for the notification, not the decision.
        include: {
          staff: { select: { fullName: true, phone: true, email: true, employeeNo: true } },
        },
      });
      if (!existing) throw notFound('Permohonan tidak dijumpai');
      if (existing.status !== 'pending') {
        throw conflict(`Permohonan ini sudah ${existing.status}. Ia tidak boleh diputuskan lagi.`);
      }

      if (body.decision === 'rejected' && (body.note ?? '').trim().length < 3) {
        throw conflict('Penolakan memerlukan sebab bertulis.');
      }

      /*
       * The chain decides whether this signature settles anything.
       *
       * Checked before the rate is validated, so somebody signing out of turn is told that
       * rather than being walked through picking a rate they were never going to apply.
       */
      const outOfTurn = await checkApproverTurn({
        module: 'overtime',
        currentLevel: existing.currentLevel,
        accountId: request.user.accountId,
        roleId: request.user.roleId,
        mayOverride: can(request.user, 'hr.overtime', 'configure'),
      });
      if (outOfTurn !== null) throw forbidden(outOfTurn);

      let amount = 0;
      let multiplier: number | null = null;
      let warning: string | null = null;

      if (body.decision === 'approved') {
        if (body.overtimeRateId === undefined) {
          throw conflict('Pilih kadar lebih masa sebelum meluluskan. Jumlah bergantung padanya.');
        }

        const rate = await db().overtimeRate.findUnique({ where: { id: body.overtimeRateId } });
        if (!rate) throw notFound('Kadar lebih masa tidak dijumpai');
        if (!rate.active) throw conflict(`${rate.name} tidak aktif. Pilih kadar yang aktif.`);

        multiplier = Number(rate.multiplier);
        amount = overtimeAmount(
          Number(existing.hourlyRate),
          multiplier,
          existing.requestedMinutes,
        );
        if (!Number.isFinite(amount)) {
          throw conflict('Jumlah tidak dapat dikira. Semak kadar sejam dan minit pada permohonan.');
        }

        /*
         * Two things the approver is the last person who can catch: a rate for the wrong
         * kind of day, and a rate below the statutory floor. Both are reported and
         * neither blocks — the decision is theirs, but it should not be uninformed.
         */
        if (rate.dayType !== existing.dayType) {
          warning =
            `Kadar dipilih untuk hari jenis "${rate.dayType}", ` +
            `tetapi tarikh itu jenis "${existing.dayType}".`;
        }
        const shortfall = rateShortfall(rate.dayType as OvertimeDayType, multiplier);
        if (shortfall) {
          const note =
            `Kadar ${shortfall.actual}× di bawah minimum ${shortfall.floor}× ` +
            'yang Akta Kerja 1955 tetapkan untuk hari jenis itu.';
          warning = warning === null ? note : `${warning} ${note}`;
        }
      }

      /*
       * Records the signature and says where it leaves the request. The rung it wrote to the
       * trail is the rung stored below — two records of one decision must not disagree.
       */
      const outcome = await applyApprovalAction({
        module: 'overtime',
        applicationId: id,
        action: body.decision === 'approved' ? 'approve' : 'reject',
        actor: { accountId: request.user.accountId, label: request.user.fullName },
        remarks: body.note ?? null,
        currentLevel: existing.currentLevel,
      });

      await db().overtimeRequest.update({
        where: { id },
        data: {
          status: outcome.status,
          currentLevel: outcome.level,
          /*
           * The rate is recorded on the way through, but the amount only once the answer is
           * final: a request sitting at rung 2 of 3 owes nobody money yet, and a rejection
           * at rung 3 would have to unpick it.
           */
          ...(body.decision === 'approved'
            ? {
                overtimeRateId: body.overtimeRateId ?? null,
                amount: outcome.finalized ? amount : 0,
              }
            : {}),
          decidedBy: request.user.accountId,
          decidedAt: new Date(),
          decisionNote: body.note && body.note.length > 0 ? body.note : null,
        },
      });

      await db().auditLog.create({
        data: {
          accountId: request.user.accountId,
          actorLabel: request.user.fullName,
          action: 'update',
          entityType: 'OvertimeRequest',
          entityId: String(id),
          changes: JSON.parse(
            JSON.stringify({
              status: { before: 'pending', after: outcome.status },
              level: { before: existing.currentLevel, after: outcome.level },
              ...(outcome.finalized && body.decision === 'approved'
                ? { amount: { before: 0, after: amount }, multiplier }
                : {}),
            }),
          ) as object,
          reason: body.note ?? null,
        },
      });

      /*
       * Overtime had no notification at all before this. Added alongside the email plumbing
       * rather than after it, because a decision nobody is told about is a decision the
       * applicant discovers on payday.
       */
      const settings = await moduleSettings('overtime');
      if (shouldNotifyApplicant(settings, outcome)) {
        notify({
          trigger: outcome.status === 'approved' ? 'overtime.approved' : 'overtime.rejected',
          mobile: existing.staff.phone,
          summary: outcome.finalized
            ? outcome.status === 'approved'
              ? `Lebih masa ${existing.requestNo} DILULUSKAN — RM ${amount.toFixed(2)}.`
              : `Lebih masa ${existing.requestNo} DITOLAK. Sebab: ${body.note ?? '-'}`
            : `Lebih masa ${existing.requestNo} diluluskan pada aras ${outcome.level} ` +
              `daripada ${outcome.totalLevels}. Masih menunggu kelulusan penuh.`,
          lines: [
            `Staf: ${existing.staff.fullName}`,
            `Tarikh kerja: ${dateOnlyKey(existing.workDate)}`,
            `Jam: ${formatMinutes(existing.requestedMinutes)}`,
            ...(body.note ? [`Nota: ${body.note}`] : []),
          ],
          email: {
            module: 'overtime',
            event:
              outcome.status === 'rejected'
                ? 'rejected'
                : outcome.finalized
                  ? 'approved'
                  : 'levelApproved',
            to: existing.staff.email,
            vars: {
              staffName: existing.staff.fullName,
              employeeNo: existing.staff.employeeNo,
              requestNo: existing.requestNo,
              status: outcome.status,
              decidedBy: request.user.fullName,
              note: body.note ?? null,
              level: outcome.level,
              totalLevels: outcome.totalLevels,
              awaitingLevel: outcome.awaitingLevel,
              awaitingApprover: outcome.awaitingLabel,
              workDate: dateOnlyKey(existing.workDate),
              hours: formatMinutes(existing.requestedMinutes),
              measuredHours: formatMinutes(existing.measuredMinutes),
              multiplier: multiplier === null ? null : `${multiplier}×`,
              // Zero while the chain is climbing, so the template never states money owed
              // on a request two more people have yet to see.
              amount: outcome.finalized ? `RM ${amount.toFixed(2)}` : null,
              dayType: existing.dayType,
            },
          },
        });
      }

      await recordActivity({
        request,
        action: `overtime.${outcome.status}`,
        category: 'schedule',
        level: outcome.status === 'approved' ? 'info' : 'warn',
        detail:
          `${existing.requestNo}: ${existing.staff.fullName}, aras ${outcome.level}` +
          (outcome.totalLevels > 0 ? ` daripada ${outcome.totalLevels}` : '') +
          (outcome.finalized && body.decision === 'approved'
            ? `, ${multiplier ?? 0}×, RM ${amount.toFixed(2)}`
            : ''),
      });

      return jsonSafe({
        ok: true,
        status: outcome.status,
        level: outcome.level,
        totalLevels: outcome.totalLevels,
        finalized: outcome.finalized,
        awaitingLevel: outcome.awaitingLevel,
        awaitingLabel: outcome.awaitingLabel,
        /** Zero until the chain finishes, so a part-way request never reports money owed. */
        amount: outcome.finalized ? amount : 0,
        multiplier,
        warning,
        /*
         * Approved is not paid. Nothing in this system pays yet, and a screen that read
         * "approved" as settled would leave somebody waiting on money that was never
         * scheduled.
         */
        paid: false,
      });
    },
  );

  /** Withdrawing a claim that has not been decided. Unlike the reference, this is wired. */
  app.post(
    '/api/overtime-requests/:id/cancel',
    { preHandler: requirePermission('hr.overtime', 'edit') },
    async (request) => {
      if (!request.user) throw unauthorized();

      const id = idParam(request.params);
      const existing = await db().overtimeRequest.findUnique({ where: { id } });
      if (!existing) throw notFound('Permohonan tidak dijumpai');
      if (existing.status !== 'pending') {
        throw conflict(
          `Hanya permohonan yang belum diputuskan boleh ditarik. Ini sudah ${existing.status}.`,
        );
      }

      await db().overtimeRequest.update({ where: { id }, data: { status: 'cancelled' } });
      /*
       * The trail is left in place on purpose.
       *
       * Withdrawing does not undo the signatures already given — somebody approved this at
       * rung 1, and erasing that would make the history read as though they never did.
       * `deleteTrail` exists for a request that is actually deleted, where the id becomes
       * reusable and an orphan trail would attach itself to the next one.
       */
      await recordActivity({
        request,
        action: 'overtime.cancelled',
        category: 'schedule',
        level: 'warn',
        detail: `${existing.requestNo} ditarik`,
      });

      return { ok: true };
    },
  );

  app.get(
    '/api/overtime-requests/:id',
    { preHandler: requirePermission('hr.overtime', 'view') },
    async (request) => {
      const id = idParam(request.params);
      const row = await db().overtimeRequest.findUnique({
        where: { id },
        include: {
          staff: {
            select: { id: true, employeeNo: true, fullName: true, department: { select: { name: true } } },
          },
          rate: { select: { code: true, name: true, multiplier: true } },
        },
      });
      if (!row) throw notFound('Permohonan tidak dijumpai');

      /*
       * The trail rides along with the record.
       *
       * A request at rung 2 of 3 looks identical to one nobody has touched unless the screen
       * can say who has already signed and who is next.
       */
      return jsonSafe({ ...serialiseRequest(row), trail: await getTrail('overtime', id) });
    },
  );
}

/**
 * Exported for whatever deletes an overtime request.
 *
 * Nothing does yet — there is no delete endpoint. Re-exported here rather than left as a
 * loose end so the next person to add one finds the call they have to make: the trail has no
 * foreign key and will otherwise outlive the request and attach to the next id.
 */
export { deleteTrail as deleteOvertimeTrail };

type RequestRow = {
  id: number;
  requestNo: string;
  currentLevel: number;
  staffId: number;
  workDate: Date;
  measuredMinutes: number;
  requestedMinutes: number;
  hourlyRate: unknown;
  dayType: string;
  overtimeRateId: number | null;
  amount: unknown;
  task: string;
  reason: string;
  status: string;
  decidedBy: number | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
  staff: {
    id: number;
    employeeNo: string;
    fullName: string;
    department: { name: string } | null;
  } | null;
  rate: { code: string; name: string; multiplier: unknown } | null;
};

/**
 * Decimals out as numbers, and the calendar date as its key.
 *
 * `workDate` is a `@db.Date`, so it goes out as `YYYY-MM-DD` rather than an instant.
 * Serialising it as an ISO timestamp would put it on the previous day for any reader
 * west of the server.
 */
function serialiseRequest(row: RequestRow): Record<string, unknown> {
  return {
    id: row.id,
    requestNo: row.requestNo,
    /** How far up the chain this has climbed, so the list can say who is still waiting. */
    currentLevel: row.currentLevel,
    staffId: row.staffId,
    employeeNo: row.staff?.employeeNo ?? null,
    staffName: row.staff?.fullName ?? null,
    departmentName: row.staff?.department?.name ?? null,
    workDate: dateOnlyKey(row.workDate),
    measuredMinutes: row.measuredMinutes,
    requestedMinutes: row.requestedMinutes,
    hourlyRate: Number(row.hourlyRate),
    dayType: row.dayType,
    rateCode: row.rate?.code ?? null,
    rateName: row.rate?.name ?? null,
    multiplier: row.rate === null ? null : Number(row.rate.multiplier),
    amount: Number(row.amount),
    task: row.task,
    reason: row.reason,
    status: row.status,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Turns a rule refusal into the sentence the caller reads. */
function refusalMessage(refusal: { key: string; vars?: Record<string, string | number> }): string {
  const vars = refusal.vars ?? {};
  switch (refusal.key) {
    case 'overtime.refuse.noMinutes':
      return 'Masukkan bilangan minit lebih masa yang dituntut.';
    case 'overtime.refuse.noneMeasured':
      return (
        'Tiada lebih masa diukur pada tarikh itu. Enjin kehadiran mengira jam dari scan ' +
        'sebenar, jadi tiada bukti untuk dituntut.'
      );
    case 'overtime.refuse.aboveMeasured':
      return (
        `Dituntut ${vars.requested ?? '?'} jam tetapi hanya ${vars.measured ?? '?'} jam ` +
        'diukur dari scan pada hari itu.'
      );
    case 'overtime.refuse.tooLong':
      return `Lebih daripada ${vars.max ?? '?'} jam dalam satu tuntutan. Pecahkan ikut hari.`;
    case 'overtime.refuse.monthlyCap':
      return (
        `Lebih masa dihadkan ${vars.cap ?? '?'} jam sebulan di bawah Peraturan Kerja ` +
        `(Pembatasan Kerja Lebih Masa) 1980. ${vars.already ?? '?'} jam sudah direkodkan ` +
        `untuk bulan itu, jadi paling banyak ${vars.left ?? '?'} jam boleh ditambah.`
      );
    default:
      return 'Permohonan lebih masa ini tidak sah.';
  }
}

function idParam(params: unknown): number {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
  if (!parsed.success) throw notFound('Rekod tidak dijumpai');
  return parsed.data.id;
}
