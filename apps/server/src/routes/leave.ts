import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { assertCan, requirePermission } from '../auth/plugin.js';
import { can } from '../auth/service.js';
import { recomputeRange } from '../attendance/engine.js';
import { db, jsonSafe } from '../db.js';
import {
  applyApprovalAction,
  checkApproverTurn,
  moduleSettings,
  shouldNotifyApplicant,
} from '../hr/approval.js';
import { loadEnv } from '../env.js';
import { conflict, forbidden, forUpdate, notFound, parseBody, unauthorized } from '../http.js';
import { recordActivity } from '../logging/activity.js';
import { notify } from '../notify/dispatch.js';
import { dateOnlyFromKey, dateOnlyKey, eachDateOnly, zonedDateOnly } from '../time.js';

/**
 * Leave applications.
 *
 * The point of this module is the side effect, not the status field. Approving a
 * request writes `leave` roster entries across the range and recomputes those days,
 * so the person stops being reported absent. A workflow that only flipped a status
 * would look complete on this screen and still dock somebody's pay.
 */
export async function leaveRoutes(app: FastifyInstance): Promise<void> {
  const timeZone = loadEnv().ORG_TIMEZONE;

  // -------------------------------------------------------------------------
  // Leave types
  // -------------------------------------------------------------------------

  app.get('/api/leave-types', { preHandler: requirePermission('schedule.leave', 'view') }, async () => {
    const rows = await db().leaveType.findMany({
      orderBy: [{ active: 'desc' }, { code: 'asc' }],
      include: { _count: { select: { requests: true } } },
    });

    return jsonSafe(
      rows.map(({ _count, ...row }) => ({ ...row, requestCount: _count.requests })),
    );
  });

  const typeSchema = z.object({
    code: z.string().trim().min(1).max(16),
    name: z.string().trim().min(1).max(120),
    /**
     * Empty string is accepted and stored as `null`, the same way `colour` is.
     *
     * Without that there is no way to clear a description once written: an absent key means
     * "leave as it was" on the update path, so the empty form field has to be able to say
     * "actually, none" rather than being indistinguishable from not touching it.
     */
    description: z.union([z.literal(''), z.string().trim().max(300)]).optional(),
    annualDays: z.coerce.number().int().min(0).max(365),
    /**
     * Enums rather than free strings, so a typo is a 400 here instead of a silent fallthrough.
     *
     * `workingDays()` treats anything other than `'calendar'` as working days, which is the safe
     * direction to fail — but only because nothing unrecognised can reach it.
     */
    countedIn: z.enum(['working', 'calendar']).optional(),
    eligibility: z.enum(['all', 'male', 'female']).optional(),
    requiresDocument: z.boolean().optional(),
    serviceTiers: z.boolean().optional(),
    /**
     * `null` clears a band, which is what unticking the grading has to be able to do.
     *
     * Not bounded below by the band before it. Most schemes step upward, but a type whose later
     * band is lower is a policy decision and not a typo the server should refuse — and refusing it
     * would mean the only way to express it is editing the database.
     */
    annualDaysTier2: z.union([z.null(), z.coerce.number().int().min(0).max(365)]).optional(),
    annualDaysTier3: z.union([z.null(), z.coerce.number().int().min(0).max(365)]).optional(),
    carryForward: z.boolean().optional(),
    carryForwardMaxDays: z.union([z.null(), z.coerce.number().int().min(0).max(365)]).optional(),
    paid: z.boolean(),
    allowBackdated: z.boolean(),
    requiresApproval: z.boolean(),
    colour: z.union([z.literal(''), z.string().trim().max(16)]).optional(),
    active: z.boolean().optional(),
  });

  app.post('/api/leave-types', { preHandler: requirePermission('schedule.leave', 'create') }, async (request) => {
    const body = parseBody(typeSchema, request.body);

    const clash = await db().leaveType.findUnique({ where: { code: body.code.toUpperCase() } });
    if (clash) throw conflict(`Kod cuti "${body.code.toUpperCase()}" sudah ada`);

    const row = await db().leaveType.create({
      data: {
        code: body.code.toUpperCase(),
        name: body.name,
        description:
          body.description !== undefined && body.description.length > 0 ? body.description : null,
        annualDays: body.annualDays,
        countedIn: body.countedIn ?? 'working',
        eligibility: body.eligibility ?? 'all',
        requiresDocument: body.requiresDocument ?? false,
        serviceTiers: body.serviceTiers ?? false,
        annualDaysTier2: body.annualDaysTier2 ?? null,
        annualDaysTier3: body.annualDaysTier3 ?? null,
        carryForward: body.carryForward ?? false,
        carryForwardMaxDays: body.carryForwardMaxDays ?? null,
        paid: body.paid,
        allowBackdated: body.allowBackdated,
        requiresApproval: body.requiresApproval,
        colour: body.colour && body.colour.length > 0 ? body.colour : null,
        active: body.active ?? true,
      },
    });

    await recordActivity({
      request,
      action: 'leave.type_create',
      category: 'schedule',
      detail: `${row.code} — ${row.name}`,
    });

    return jsonSafe({ id: row.id });
  });

  app.patch('/api/leave-types/:id', { preHandler: requirePermission('schedule.leave', 'edit') }, async (request) => {
    const id = idParam(request.params);
    const body = parseBody(forUpdate(typeSchema), request.body);

    const existing = await db().leaveType.findUnique({ where: { id } });
    if (!existing) throw notFound('Jenis cuti tidak dijumpai');

    await db().leaveType.update({
      where: { id },
      data: {
        ...(body.code !== undefined ? { code: body.code.toUpperCase() } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined
          ? { description: body.description.length > 0 ? body.description : null }
          : {}),
        ...(body.annualDays !== undefined ? { annualDays: body.annualDays } : {}),
        ...(body.countedIn !== undefined ? { countedIn: body.countedIn } : {}),
        ...(body.eligibility !== undefined ? { eligibility: body.eligibility } : {}),
        ...(body.requiresDocument !== undefined
          ? { requiresDocument: body.requiresDocument }
          : {}),
        ...(body.serviceTiers !== undefined ? { serviceTiers: body.serviceTiers } : {}),
        ...(body.annualDaysTier2 !== undefined ? { annualDaysTier2: body.annualDaysTier2 } : {}),
        ...(body.annualDaysTier3 !== undefined ? { annualDaysTier3: body.annualDaysTier3 } : {}),
        ...(body.carryForward !== undefined ? { carryForward: body.carryForward } : {}),
        ...(body.carryForwardMaxDays !== undefined
          ? { carryForwardMaxDays: body.carryForwardMaxDays }
          : {}),
        ...(body.paid !== undefined ? { paid: body.paid } : {}),
        ...(body.allowBackdated !== undefined ? { allowBackdated: body.allowBackdated } : {}),
        ...(body.requiresApproval !== undefined ? { requiresApproval: body.requiresApproval } : {}),
        ...(body.colour !== undefined
          ? { colour: body.colour.length > 0 ? body.colour : null }
          : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });

    return jsonSafe({ id });
  });

  app.delete('/api/leave-types/:id', { preHandler: requirePermission('schedule.leave', 'delete') }, async (request) => {
    const id = idParam(request.params);

    const row = await db().leaveType.findUnique({
      where: { id },
      include: { _count: { select: { requests: true } } },
    });
    if (!row) throw notFound('Jenis cuti tidak dijumpai');

    // Deactivated rather than removed once it has history: the requests that used it
    // still have to name what was taken.
    if (row._count.requests > 0) {
      throw conflict(
        `${String(row._count.requests)} permohonan menggunakan jenis ini. Nyahaktifkan ia ` +
          'daripada membuangnya — permohonan lampau masih perlu menamakan cuti yang diambil.',
      );
    }

    await db().leaveType.delete({ where: { id } });
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Requests
  // -------------------------------------------------------------------------

  app.get('/api/leave-requests', { preHandler: requirePermission('schedule.leave', 'view') }, async (request) => {
    const query = z
      .object({
        status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
        leaveTypeId: z.coerce.number().int().positive().optional(),
        staffId: z.coerce.number().int().positive().optional(),
        search: z.string().trim().max(128).optional(),
        from: z.string().trim().max(10).optional(),
        to: z.string().trim().max(10).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(30),
      })
      .parse(request.query);

    const search = query.search
      ? {
          OR: [
            { staff: { fullName: { contains: query.search } } },
            { staff: { employeeNo: { contains: query.search } } },
            { reason: { contains: query.search } },
          ],
        }
      : {};

    /**
     * Overlap, not containment.
     *
     * A request from the 28th to the 3rd belongs in both months. Filtering on
     * `fromDate` alone would drop it from the month it mostly falls in.
     */
    const range =
      query.from || query.to
        ? {
            ...(query.to ? { fromDate: { lte: dateOnlyFromKey(query.to) } } : {}),
            ...(query.from ? { toDate: { gte: dateOnlyFromKey(query.from) } } : {}),
          }
        : {};

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.leaveTypeId !== undefined ? { leaveTypeId: query.leaveTypeId } : {}),
      ...(query.staffId !== undefined ? { staffId: query.staffId } : {}),
      ...range,
      ...search,
    };

    const [total, rows, statusCounts, typeCounts] = await Promise.all([
      db().leaveRequest.count({ where }),
      db().leaveRequest.findMany({
        where,
        // Pending first: those are the rows somebody opened this screen to act on.
        orderBy: [{ status: 'asc' }, { fromDate: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          leaveType: { select: { id: true, code: true, name: true, paid: true, colour: true } },
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
      db().leaveRequest.groupBy({
        by: ['status'],
        where: { ...where, status: undefined },
        _count: { _all: true },
      }),
      db().leaveRequest.groupBy({
        by: ['leaveTypeId'],
        where: { ...where, leaveTypeId: undefined },
        _count: { _all: true },
      }),
    ]);

    const statuses: Record<string, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0,
    };
    for (const row of statusCounts) statuses[row.status] = row._count._all;

    const types = await db().leaveType.findMany({ select: { id: true, code: true, name: true } });
    const typeById = new Map(types.map((row) => [row.id, row]));

    return jsonSafe({
      total,
      page: query.page,
      pageSize: query.pageSize,
      rows,
      statuses,
      types: typeCounts
        .map((row) => ({
          id: row.leaveTypeId,
          code: typeById.get(row.leaveTypeId)?.code ?? String(row.leaveTypeId),
          name: typeById.get(row.leaveTypeId)?.name ?? '',
          count: row._count._all,
        }))
        .sort((left, right) => right.count - left.count),
      generatedAt: new Date().toISOString(),
    });
  });

  /**
   * Working days in a range, and what the balance would be after taking them.
   *
   * Offered as its own read so the form can show the cost before the request is
   * filed. A person applying for eight days who has three left should find out on
   * this screen, not from a rejection.
   */
  app.get('/api/leave-requests/quote', { preHandler: requirePermission('schedule.leave', 'view') }, async (request) => {
    const query = z
      .object({
        staffId: z.coerce.number().int().positive(),
        leaveTypeId: z.coerce.number().int().positive(),
        from: z.string().trim().min(10).max(10),
        to: z.string().trim().min(10).max(10),
      })
      .parse(request.query);

    const type = await db().leaveType.findUnique({ where: { id: query.leaveTypeId } });
    if (!type) throw notFound('Jenis cuti tidak dijumpai');

    const from = dateOnlyFromKey(query.from);
    const to = dateOnlyFromKey(query.to);
    if (to < from) throw conflict('Tarikh tamat sebelum tarikh mula');

    // `workDates` is dropped: the form needs the counts, not a list of every day.
    const { workDates: _dates, ...breakdown } = await workingDays(
      query.staffId,
      from,
      to,
      type.countedIn,
    );
    const year = from.getUTCFullYear();
    const balance = await leaveBalance(query.staffId, query.leaveTypeId, year);
    const clash = await overlapping(query.staffId, from, to, null);

    /*
     * The entitlement is resolved per person, not read off the type.
     *
     * A graded type gives a different figure to a new joiner than to somebody with six years in,
     * and a carry-forward type adds last year's unused remainder. `annualDays` is still returned so
     * the form can show the band it landed on, but `entitlement` is the number the checks use.
     */
    const staffRow = await db().staff.findUnique({
      where: { id: query.staffId },
      select: { id: true, hireDate: true },
    });
    if (!staffRow) throw notFound('Staf tidak dijumpai');
    const owed = await entitlementFor(type, staffRow, year);

    return jsonSafe({
      ...breakdown,
      type: { id: type.id, code: type.code, name: type.name, paid: type.paid },
      annualDays: owed.total,
      entitlementBase: owed.base,
      carriedIn: owed.carriedIn,
      taken: balance.taken,
      pending: balance.pending,
      remaining: owed.total === 0 ? null : owed.total - balance.taken - balance.pending,
      wouldExceed:
        owed.total > 0 && balance.taken + balance.pending + breakdown.days > owed.total,
      overlaps: clash.map((row) => ({
        id: row.id,
        fromDate: row.fromDate,
        toDate: row.toDate,
        status: row.status,
      })),
      backdated: from < zonedDateOnly(new Date(), timeZone),
      allowBackdated: type.allowBackdated,
    });
  });

  app.post('/api/leave-requests', { preHandler: requirePermission('schedule.leave', 'create') }, async (request) => {
    if (!request.user) throw unauthorized();

    const body = parseBody(
      z.object({
        staffId: z.number().int().positive(),
        leaveTypeId: z.number().int().positive(),
        fromDate: z.string().trim().min(10).max(10),
        toDate: z.string().trim().min(10).max(10),
        reason: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
        /**
         * Optional here as well as on the form.
         *
         * The apply screen marks `reason` required and refuses to submit without it, but the route
         * stays permissive on both: the mobile client and the public API post to this endpoint too,
         * and tightening a field server-side would reject every caller that has been working.
         */
        remarks: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
      }),
      request.body,
    );

    const [staff, type] = await Promise.all([
      db().staff.findUnique({ where: { id: body.staffId } }),
      db().leaveType.findUnique({ where: { id: body.leaveTypeId } }),
    ]);
    if (!staff) throw notFound('Staf tidak dijumpai');
    if (!type) throw notFound('Jenis cuti tidak dijumpai');
    if (!type.active) throw conflict(`Jenis cuti "${type.name}" sudah tidak aktif`);

    const from = dateOnlyFromKey(body.fromDate);
    const to = dateOnlyFromKey(body.toDate);
    if (to < from) throw conflict('Tarikh tamat tidak boleh sebelum tarikh mula');

    /*
     * Eligibility, refused here rather than only hidden on the form.
     *
     * Maternity leave is a female entitlement and paternity leave a male one. The form filters
     * the dropdown, but this endpoint is reachable without the form, so the restriction has to
     * hold at the point the row is written.
     *
     * An unrecorded gender is a refusal, not a pass. Waving through whatever cannot be verified
     * would mean maternity leave is open to everybody on a directory imported from the terminals
     * — which is most of this one. The message names the field to fill so the answer is to go and
     * record it, not to reach for another category.
     */
    if (type.eligibility !== 'all') {
      const required = type.eligibility === 'female' ? 'wanita' : 'lelaki';
      if (staff.gender === null) {
        throw conflict(
          `${type.name} hanya untuk pekerja ${required}, tetapi jantina ${staff.fullName} belum ` +
            'direkodkan. Lengkapkan medan Jantina pada rekod staf terlebih dahulu.',
        );
      }
      if (staff.gender !== type.eligibility) {
        throw conflict(`${type.name} hanya untuk pekerja ${required}.`);
      }
    }

    // Backdating is refused per type rather than globally: emergency leave is filed
    // after the fact by definition, annual leave is not.
    if (!type.allowBackdated && from < zonedDateOnly(new Date(), timeZone)) {
      throw conflict(
        `${type.name} tidak boleh dimohon untuk tarikh yang sudah lepas. ` +
          'Gunakan jenis cuti yang membenarkan permohonan ke belakang.',
      );
    }

    /**
     * Two live requests over the same day would each write the same roster row on
     * approval, and the second would silently overwrite the first.
     */
    const clash = await overlapping(body.staffId, from, to, null);
    if (clash.length > 0) {
      const first = clash[0]!;
      throw conflict(
        `${staff.fullName} sudah ada permohonan ${first.status} dari ` +
          `${dateOnlyKey(first.fromDate)} hingga ${dateOnlyKey(first.toDate)}.`,
      );
    }

    const breakdown = await workingDays(body.staffId, from, to, type.countedIn);
    if (breakdown.days === 0) {
      throw conflict(
        'Julat ini tiada hari bekerja — semuanya hari rehat atau cuti umum. ' +
          'Tiada apa yang perlu dimohon.',
      );
    }

    const row = await db().leaveRequest.create({
      data: {
        staffId: body.staffId,
        leaveTypeId: body.leaveTypeId,
        fromDate: from,
        toDate: to,
        days: breakdown.days,
        reason: body.reason && body.reason.length > 0 ? body.reason : null,
        remarks: body.remarks && body.remarks.length > 0 ? body.remarks : null,
        // A type that needs no approval is approved on creation, and the roster is
        // written immediately below.
        status: type.requiresApproval ? 'pending' : 'approved',
        ...(type.requiresApproval
          ? {}
          : {
              decidedBy: request.user.accountId,
              decidedAt: new Date(),
              decisionNote: 'Jenis cuti ini tidak memerlukan kelulusan',
            }),
      },
    });

    let applied: ApplyOutcome | null = null;
    if (!type.requiresApproval) {
      applied = await applyToRoster(row.id, body.staffId, from, to, type.countedIn);
    }

    await recordActivity({
      request,
      action: 'leave.request',
      category: 'schedule',
      detail:
        `${staff.fullName} · ${type.code} · ${body.fromDate}–${body.toDate} · ` +
        `${String(breakdown.days)} hari · ${row.status}`,
    });

    notify({
      trigger: 'leave.requested',
      mobile: staff.phone,
      summary:
        `Permohonan ${type.code} ${body.fromDate} hingga ${body.toDate} ` +
        `(${String(breakdown.days)} hari) direkodkan — ${row.status}.`,
      lines: [
        `Staf: ${staff.fullName} (${staff.employeeNo})`,
        `Jenis: ${type.name}`,
        `Hari bekerja dicaj: ${String(breakdown.days)}`,
        ...(body.reason ? [`Sebab: ${body.reason}`] : []),
      ],
    });

    return jsonSafe({
      id: row.id,
      days: breakdown.days,
      status: row.status,
      ...(applied ? { applied } : {}),
    });
  });

  /**
   * Approve or reject.
   *
   * Approval is the only path that touches attendance. It writes the roster and
   * recomputes the affected days in the same request, so the screen the approver
   * lands back on already reflects the change.
   */
  app.post('/api/leave-requests/:id/decide', { preHandler: requirePermission('schedule.leave', 'approve') }, async (request) => {
    if (!request.user) throw unauthorized();

    const id = idParam(request.params);
    const body = parseBody(
      z.object({
        decision: z.enum(['approved', 'rejected']),
        note: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
      }),
      request.body,
    );

    const existing = await db().leaveRequest.findUnique({
      where: { id },
      include: {
        // `email` and `employeeNo` are read for the notification template, not for the
        // decision itself.
        staff: { select: { fullName: true, phone: true, email: true, employeeNo: true } },
        leaveType: true,
      },
    });
    if (!existing) throw notFound('Permohonan tidak dijumpai');
    if (existing.status !== 'pending') {
      throw conflict(`Permohonan ini sudah ${existing.status}. Ia tidak boleh diputuskan lagi.`);
    }

    // A rejection with no reason leaves the person with nothing to act on, and
    // nothing for a later dispute to refer to.
    if (body.decision === 'rejected' && (body.note ?? '').trim().length < 3) {
      throw conflict('Penolakan memerlukan sebab bertulis.');
    }

    /*
     * A category that requires a document cannot be approved without one.
     *
     * Checked on approval rather than on filing, deliberately. Somebody files sick leave the
     * morning they see the doctor and the certificate arrives later that day; refusing at filing
     * time is how a medical absence gets recorded as annual leave instead, which is the outcome
     * the flag exists to prevent.
     *
     * A rejection is still allowed with no document — refusing an application for having no
     * evidence is exactly a decision somebody needs to be able to make.
     */
    if (
      body.decision === 'approved' &&
      existing.leaveType.requiresDocument &&
      existing.documentPath === null
    ) {
      throw conflict(
        `${existing.leaveType.name} memerlukan dokumen sokongan sebelum boleh diluluskan. ` +
          'Minta pemohon melampirkannya, atau tolak permohonan ini dengan sebab.',
      );
    }

    /*
     * Approval chain, if one is configured.
     *
     * With no chain this is a no-op and the behaviour is exactly what it was: one decision
     * settles the request. That is the whole reason the empty chain is a supported state
     * rather than something to migrate away from — every installation that never opens the
     * settings screen keeps working.
     */
    const outOfTurn = await checkApproverTurn({
      module: 'leave',
      currentLevel: existing.currentLevel,
      accountId: request.user.accountId,
      roleId: request.user.roleId,
      mayOverride: can(request.user, 'schedule.leave', 'configure'),
    });
    if (outOfTurn !== null) throw forbidden(outOfTurn);

    const outcome = await applyApprovalAction({
      module: 'leave',
      applicationId: id,
      action: body.decision === 'approved' ? 'approve' : 'reject',
      actor: { accountId: request.user.accountId, label: request.user.fullName },
      remarks: body.note ?? null,
      currentLevel: existing.currentLevel,
    });

    await db().leaveRequest.update({
      where: { id },
      data: {
        status: outcome.status,
        currentLevel: outcome.level,
        decidedBy: request.user.accountId,
        decidedAt: new Date(),
        decisionNote: body.note && body.note.length > 0 ? body.note : null,
      },
    });

    /*
     * The roster is written only when the chain finishes.
     *
     * This is the side effect that stops somebody being reported absent, and it must not
     * happen while the request could still be refused at a higher rung — a rejection at
     * rung 3 would leave leave days on the calendar for a request that was never granted.
     */
    let applied: ApplyOutcome | null = null;
    if (outcome.status === 'approved') {
      applied = await applyToRoster(
        id,
        existing.staffId,
        existing.fromDate,
        existing.toDate,
        existing.leaveType.countedIn,
      );
    }

    await db().auditLog.create({
      data: {
        accountId: request.user.accountId,
        actorLabel: request.user.fullName,
        action: 'update',
        entityType: 'LeaveRequest',
        entityId: String(id),
        changes: JSON.parse(
          JSON.stringify({
            status: { before: 'pending', after: outcome.status },
            level: { before: existing.currentLevel, after: outcome.level },
          }),
        ) as object,
        reason: body.note ?? null,
      },
    });

    await recordActivity({
      request,
      action: `leave.${outcome.status}`,
      category: 'schedule',
      level: outcome.status === 'approved' ? 'info' : 'warn',
      detail:
        `${existing.staff.fullName} · ${existing.leaveType.code} · ` +
        `${String(existing.days)} hari` +
        (outcome.totalLevels > 0 ? ` · aras ${outcome.level}/${outcome.totalLevels}` : '') +
        (applied ? ` · ${String(applied.rosterWritten)} hari roster ditulis` : ''),
    });

    /*
     * Fired after the roster and the recompute have already succeeded, and not awaited.
     * A gateway being unreachable must not fail an approval that is otherwise complete —
     * a missing SMS is recoverable, a leave request stuck in `pending` is not.
     */
    const period = `${dateOnlyKey(existing.fromDate)} hingga ${dateOnlyKey(existing.toDate)}`;

    /*
     * Silent at an intermediate rung unless the installation asked otherwise.
     *
     * Telling somebody "approved" at rung 1 of 3 tells them something untrue: the request is
     * still pending and can still be refused above. `notifyEveryLevel` exists for
     * organisations that would rather have the progress report anyway.
     */
    const settings = await moduleSettings('leave');
    if (shouldNotifyApplicant(settings, outcome)) {
      notify({
        trigger: outcome.status === 'approved' ? 'leave.approved' : 'leave.rejected',
        mobile: existing.staff.phone,
        /*
         * The email half. Which event it is depends on whether the chain finished — an
         * intermediate approval is `levelApproved`, and its template says the request is
         * still waiting rather than announcing an approval that has not happened.
         */
        email: {
          module: 'leave',
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
            requestNo: `#${String(id)}`,
            status: outcome.status,
            decidedBy: request.user.fullName,
            note: body.note ?? null,
            level: outcome.level,
            totalLevels: outcome.totalLevels,
            awaitingLevel: outcome.awaitingLevel,
            awaitingApprover: outcome.awaitingLabel,
            leaveType: existing.leaveType.name,
            fromDate: dateOnlyKey(existing.fromDate),
            toDate: dateOnlyKey(existing.toDate),
            days: existing.days,
          },
        },
        summary: outcome.finalized
          ? outcome.status === 'approved'
            ? `Cuti ${existing.leaveType.code} anda ${period} (${String(existing.days)} hari) DILULUSKAN.`
            : `Cuti ${existing.leaveType.code} anda ${period} DITOLAK. Sebab: ${body.note ?? '-'}`
          : `Cuti ${existing.leaveType.code} anda ${period} diluluskan pada aras ` +
            `${outcome.level} daripada ${outcome.totalLevels}. Masih menunggu kelulusan penuh.`,
        lines: [
          `Staf: ${existing.staff.fullName}`,
          `Jenis: ${existing.leaveType.name}`,
          `Diputuskan oleh: ${request.user.fullName}`,
          ...(outcome.awaitingLabel !== null
            ? [`Menunggu: aras ${String(outcome.awaitingLevel)} (${outcome.awaitingLabel})`]
            : []),
          ...(body.note ? [`Nota: ${body.note}`] : []),
          ...(applied ? [`Hari roster ditulis: ${String(applied.rosterWritten)}`] : []),
        ],
      });
    }

    return jsonSafe({
      id,
      status: outcome.status,
      level: outcome.level,
      totalLevels: outcome.totalLevels,
      finalized: outcome.finalized,
      awaitingLevel: outcome.awaitingLevel,
      awaitingLabel: outcome.awaitingLabel,
      ...(applied ? { applied } : {}),
    });
  });

  /**
   * Withdraws an approved or pending request.
   *
   * Roster rows written by the approval are removed, and the days recomputed. The
   * shifts that were there before are not restored: the roster does not keep a
   * history of what it replaced, so pretending otherwise would put people back on
   * shifts nobody re-checked.
   */
  app.post('/api/leave-requests/:id/cancel', { preHandler: requirePermission('schedule.leave', 'edit') }, async (request) => {
    if (!request.user) throw unauthorized();

    const id = idParam(request.params);
    const body = parseBody(
      z.object({ note: z.union([z.literal(''), z.string().trim().max(500)]).optional() }),
      request.body,
    );

    const existing = await db().leaveRequest.findUnique({
      where: { id },
      include: { staff: { select: { fullName: true, phone: true } }, leaveType: true },
    });
    if (!existing) throw notFound('Permohonan tidak dijumpai');
    if (existing.status === 'cancelled' || existing.status === 'rejected') {
      throw conflict(`Permohonan ini sudah ${existing.status}.`);
    }

    const wasApproved = existing.status === 'approved';

    await db().leaveRequest.update({
      where: { id },
      data: {
        status: 'cancelled',
        decidedBy: request.user.accountId,
        decidedAt: new Date(),
        decisionNote: body.note && body.note.length > 0 ? body.note : null,
      },
    });

    let removed = 0;
    if (wasApproved) {
      const result = await db().rosterEntry.deleteMany({
        where: {
          staffId: existing.staffId,
          entryType: 'leave',
          workDate: { gte: existing.fromDate, lte: existing.toDate },
        },
      });
      removed = result.count;
      await recomputeRange(existing.fromDate, existing.toDate, [existing.staffId]);
    }

    await recordActivity({
      request,
      action: 'leave.cancel',
      category: 'schedule',
      level: 'warn',
      detail:
        `${existing.staff.fullName} · ${existing.leaveType.code} · ` +
        `${String(removed)} hari roster dibuang`,
    });

    notify({
      trigger: 'leave.cancelled',
      mobile: existing.staff.phone,
      summary:
        `Cuti ${existing.leaveType.code} ${dateOnlyKey(existing.fromDate)} hingga ` +
        `${dateOnlyKey(existing.toDate)} DIBATALKAN.`,
      lines: [
        `Staf: ${existing.staff.fullName}`,
        `Dibatalkan oleh: ${request.user.fullName}`,
        ...(body.note ? [`Nota: ${body.note}`] : []),
        // Said here too: the roster keeps no history of what the leave replaced, so
        // nobody should assume the original shift came back.
        ...(wasApproved
          ? [`${String(removed)} hari roster dibuang. Shift asal TIDAK dipulihkan.`]
          : []),
      ],
    });

    return jsonSafe({
      id,
      rosterRemoved: removed,
      note: wasApproved
        ? 'Hari roster cuti dibuang dan kehadiran dikira semula. Shift yang ada sebelum ' +
          'kelulusan tidak dipulihkan — tetapkan semula secara manual jika perlu.'
        : undefined,
    });
  });

  /** Per-type balance for one person in one year. */
  app.get('/api/leave-balance/:staffId', { preHandler: requirePermission('schedule.leave', 'view') }, async (request) => {
    const params = z.object({ staffId: z.coerce.number().int().positive() }).parse(request.params);
    const query = z
      .object({ year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()) })
      .parse(request.query);

    const staff = await db().staff.findUnique({
      where: { id: params.staffId },
      // `hireDate` is read for the entitlement band, not for display.
      select: { id: true, employeeNo: true, fullName: true, hireDate: true },
    });
    if (!staff) throw notFound('Staf tidak dijumpai');

    const types = await db().leaveType.findMany({ where: { active: true }, orderBy: { code: 'asc' } });

    const balances = await Promise.all(
      types.map(async (type) => {
        const balance = await leaveBalance(params.staffId, type.id, query.year);
        const owed = await entitlementFor(type, staff, query.year);
        return {
          type: { id: type.id, code: type.code, name: type.name, paid: type.paid },
          annualDays: owed.total,
          /*
           * Split out so the screen can say where the figure came from. A person who sees 18 days
           * against a type labelled "14 hari" has to be able to tell that four were carried in,
           * or the balance reads as a bug.
           */
          entitlementBase: owed.base,
          carriedIn: owed.carriedIn,
          taken: balance.taken,
          pending: balance.pending,
          remaining: owed.total === 0 ? null : owed.total - balance.taken - balance.pending,
        };
      }),
    );

    return jsonSafe({ staff, year: query.year, balances });
  });

  /** Staff picker for the request form, scoped to the leave permission. */
  app.get('/api/leave-requests/staff-search', { preHandler: requirePermission('schedule.leave', 'create') }, async (request) => {
    const query = z
      .object({ q: z.string().trim().max(128).default(''), limit: z.coerce.number().int().min(1).max(50).default(20) })
      .parse(request.query);

    const rows = await db().staff.findMany({
      where: {
        active: true,
        ...(query.q.length > 0
          ? {
              OR: [
                { fullName: { contains: query.q } },
                { employeeNo: { contains: query.q } },
              ],
            }
          : {}),
      },
      orderBy: { fullName: 'asc' },
      take: query.limit,
      select: {
        id: true,
        employeeNo: true,
        fullName: true,
        department: { select: { name: true } },
      },
    });

    return jsonSafe(rows);
  });

  /** Approving a request the caller filed themselves is a separate grant. */
  app.get('/api/leave-requests/:id', { preHandler: requirePermission('schedule.leave', 'view') }, async (request) => {
    if (!request.user) throw unauthorized();
    assertCan(request.user, 'schedule.leave', 'view');

    const id = idParam(request.params);
    const row = await db().leaveRequest.findUnique({
      where: { id },
      include: {
        leaveType: true,
        staff: {
          select: {
            id: true,
            employeeNo: true,
            fullName: true,
            department: { select: { name: true } },
          },
        },
      },
    });
    if (!row) throw notFound('Permohonan tidak dijumpai');

    // `getUTCFullYear`, not `getFullYear`: a date-only value is stored in UTC, so a
    // 1 January request would otherwise bucket into the previous year's balance.
    const balance = await leaveBalance(row.staffId, row.leaveTypeId, row.fromDate.getUTCFullYear());

    return jsonSafe({ ...row, balance });
  });
}

// ---------------------------------------------------------------------------

interface ApplyOutcome {
  rosterWritten: number;
  rosterReplaced: number;
  /**
   * Rest days and public holidays inside the range that were left as they were.
   *
   * Always zero for a calendar-counted type: those days are charged, so they are written too.
   * The field stays rather than becoming optional, because "nothing was skipped" and "skipping
   * does not apply here" both answer the approver's question the same way.
   */
  rosterSkipped: number;
  recordsWritten: number;
}

/**
 * Writes `leave` roster entries for the range and recomputes those days.
 *
 * Only the days the request was charged for are written. A Sunday inside a leave
 * range is not leave: the balance was never charged for it, and writing `leave` over
 * it would make the monthly report count more leave days than the entitlement was
 * debited — two numbers that have to reconcile at payroll.
 *
 * `upsert` per day rather than a bulk insert, because `(staffId, workDate)` is
 * unique and a day may already carry a shift. Replacing it is the intended effect —
 * the person is not working that day — but the count is reported so the approver
 * can see how many shifts were taken off the roster.
 */
async function applyToRoster(
  requestId: number,
  staffId: number,
  from: Date,
  to: Date,
  countedIn: string,
): Promise<ApplyOutcome> {
  const prisma = db();
  const breakdown = await workingDays(staffId, from, to, countedIn);

  let written = 0;
  let replaced = 0;

  for (const day of breakdown.workDates) {
    const existing = await prisma.rosterEntry.findUnique({
      where: { staffId_workDate: { staffId, workDate: day } },
    });
    if (existing && existing.entryType !== 'leave') replaced += 1;

    await prisma.rosterEntry.upsert({
      where: { staffId_workDate: { staffId, workDate: day } },
      create: {
        staffId,
        workDate: day,
        entryType: 'leave',
        shiftId: null,
        notes: `Cuti #${String(requestId)}`,
      },
      update: { entryType: 'leave', shiftId: null, notes: `Cuti #${String(requestId)}` },
    });
    written += 1;
  }

  if (replaced > 0) {
    await prisma.leaveRequest.update({
      where: { id: requestId },
      data: { replacedRoster: true },
    });
  }

  // Recomputed over the whole range, not only the written days: a rest day that used
  // to hold a shift still needs its record rebuilt.
  const summary = await recomputeRange(from, to, [staffId]);

  return {
    rosterWritten: written,
    rosterReplaced: replaced,
    rosterSkipped: breakdown.restDays + breakdown.holidays,
    recordsWritten: summary.recordsWritten,
  };
}

/**
 * Counts the chargeable days in a range for one person.
 *
 * In `working` mode rest days and public holidays are excluded: charging somebody annual
 * leave for a Sunday is the kind of error that surfaces as a grievance rather than as a
 * bug. Days with no roster entry count as working, because the default pattern applies.
 *
 * In `calendar` mode every day in the range is charged. Rest days and holidays are still
 * counted and returned, so the form can say what the range contains, but they are charged
 * too — maternity leave is 98 consecutive days by statute, and excluding weekends from it
 * would stretch fourteen weeks into twenty.
 *
 * `workDates` is the charged set in both modes, and it is the same list the roster is
 * written from. That is deliberate: the entitlement debited and the `leave` days written
 * have to be the same number or the monthly report and payroll disagree.
 */
async function workingDays(
  staffId: number,
  from: Date,
  to: Date,
  countedIn: string,
): Promise<{
  days: number;
  restDays: number;
  holidays: number;
  totalDays: number;
  /** The days that are actually charged, so the roster writes exactly these. */
  workDates: Date[];
}> {
  const prisma = db();
  const all = [...eachDateOnly(from, to)];

  const [rosters, holidays] = await Promise.all([
    prisma.rosterEntry.findMany({
      where: { staffId, workDate: { gte: from, lte: to } },
      select: { workDate: true, entryType: true },
    }),
    prisma.holiday.findMany({
      where: { date: { gte: from, lte: to } },
      select: { date: true },
    }),
  ]);

  const restByKey = new Set(
    rosters.filter((row) => row.entryType === 'rest').map((row) => dateOnlyKey(row.workDate)),
  );
  const holidayByKey = new Set(holidays.map((row) => dateOnlyKey(row.date)));

  const everyDay = countedIn === 'calendar';

  const workDates: Date[] = [];
  let restDays = 0;
  let holidayCount = 0;

  for (const day of all) {
    const key = dateOnlyKey(day);
    const isHoliday = holidayByKey.has(key);
    const isRest = !isHoliday && restByKey.has(key);

    if (isHoliday) holidayCount += 1;
    if (isRest) restDays += 1;

    /*
      Counted either way, charged only in calendar mode. The counts are what the form uses to
      say "this range contains two rest days", and that sentence is worth showing whether or
      not those days come off the balance.
    */
    if (everyDay || (!isHoliday && !isRest)) workDates.push(day);
  }

  return {
    days: workDates.length,
    restDays,
    holidays: holidayCount,
    totalDays: all.length,
    workDates,
  };
}

/**
 * Days taken and days awaiting a decision, for one type in one year.
 *
 * Pending days are counted against the balance. Otherwise somebody can file five
 * separate requests that each pass the check and together exceed the entitlement.
 */
async function leaveBalance(
  staffId: number,
  leaveTypeId: number,
  year: number,
): Promise<{ taken: number; pending: number }> {
  const start = dateOnlyFromKey(`${String(year)}-01-01`);
  const end = dateOnlyFromKey(`${String(year)}-12-31`);

  const rows = await db().leaveRequest.groupBy({
    by: ['status'],
    where: {
      staffId,
      leaveTypeId,
      status: { in: ['approved', 'pending'] },
      fromDate: { gte: start, lte: end },
    },
    _sum: { days: true },
  });

  return {
    taken: rows.find((row) => row.status === 'approved')?._sum.days ?? 0,
    pending: rows.find((row) => row.status === 'pending')?._sum.days ?? 0,
  };
}

/** The bands of a type, first to last. One entry when the type is not graded by service. */
export function entitlementBands(type: {
  annualDays: number;
  serviceTiers: boolean;
  annualDaysTier2: number | null;
  annualDaysTier3: number | null;
}): number[] {
  if (!type.serviceTiers) return [type.annualDays];
  return [
    type.annualDays,
    type.annualDaysTier2 ?? type.annualDays,
    type.annualDaysTier3 ?? type.annualDaysTier2 ?? type.annualDays,
  ];
}

/**
 * Completed years of service at the start of a leave year.
 *
 * Measured at the start of the year rather than today, so somebody's entitlement does not step up
 * in the middle of a year and leave the days they already took counted against a smaller figure.
 *
 * `getUTCFullYear` and friends, not the local getters: `hireDate` is a `@db.Date` column, which is
 * midnight UTC of the day meant. Read locally, a 1 January hire date lands in the previous year.
 */
function serviceYearsAt(hireDate: Date | null, year: number): number {
  if (hireDate === null) return 0;

  const startOfYear = Date.UTC(year, 0, 1);
  const hired = Date.UTC(hireDate.getUTCFullYear(), hireDate.getUTCMonth(), hireDate.getUTCDate());
  if (hired >= startOfYear) return 0;

  let years = year - hireDate.getUTCFullYear();
  // Not yet reached the anniversary by 1 January, so the last year is not complete.
  const anniversaryPassed =
    hireDate.getUTCMonth() === 0 && hireDate.getUTCDate() === 1;
  if (!anniversaryPassed) years -= 1;
  return Math.max(0, years);
}

/**
 * The entitlement one person has for one type in one year, bands and carry-in applied.
 *
 * Zero stays zero and means unlimited, the same as it does on the column. A graded type with a
 * zero first band would be a contradiction, so the bands are only consulted above zero.
 *
 * Carry-in is computed from the previous year rather than stored. See the note on
 * `LeaveType.carryForward` for why there is no year-end job.
 */
export async function entitlementFor(
  type: {
    id: number;
    annualDays: number;
    serviceTiers: boolean;
    annualDaysTier2: number | null;
    annualDaysTier3: number | null;
    carryForward: boolean;
    carryForwardMaxDays: number | null;
  },
  staff: { id: number; hireDate: Date | null },
  year: number,
): Promise<{ base: number; carriedIn: number; total: number; bandIndex: number }> {
  if (type.annualDays === 0) return { base: 0, carriedIn: 0, total: 0, bandIndex: 0 };

  const bands = entitlementBands(type);
  const years = serviceYearsAt(staff.hireDate, year);
  // Employment Act steps: under two years, two to five, and over five.
  const bandIndex = bands.length === 1 ? 0 : years >= 5 ? 2 : years >= 2 ? 1 : 0;
  const base = bands[Math.min(bandIndex, bands.length - 1)] ?? type.annualDays;

  if (!type.carryForward) return { base, carriedIn: 0, total: base, bandIndex };

  /*
   * Last year's own entitlement, not this year's. Somebody who crossed a service band on 1 January
   * carries what they were actually owed last year, not what the new band would have given them.
   *
   * Recursion is bounded to one step because the previous year is read with carry-forward off —
   * that is the "chains one year back" rule on the column, made structural rather than hoped for.
   */
  const previousBands = bands;
  const previousYears = serviceYearsAt(staff.hireDate, year - 1);
  const previousIndex =
    previousBands.length === 1 ? 0 : previousYears >= 5 ? 2 : previousYears >= 2 ? 1 : 0;
  const previousBase =
    previousBands[Math.min(previousIndex, previousBands.length - 1)] ?? type.annualDays;

  const previous = await leaveBalance(staff.id, type.id, year - 1);
  const unused = previousBase - previous.taken - previous.pending;
  const capped =
    type.carryForwardMaxDays === null ? unused : Math.min(unused, type.carryForwardMaxDays);
  const carriedIn = Math.max(0, capped);

  return { base, carriedIn, total: base + carriedIn, bandIndex };
}

/** Live requests that share any day with the range. */
async function overlapping(
  staffId: number,
  from: Date,
  to: Date,
  excludeId: number | null,
): Promise<Array<{ id: number; fromDate: Date; toDate: Date; status: string }>> {
  return db().leaveRequest.findMany({
    where: {
      staffId,
      status: { in: ['pending', 'approved'] },
      fromDate: { lte: to },
      toDate: { gte: from },
      ...(excludeId !== null ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, fromDate: true, toDate: true, status: true },
  });
}

function idParam(params: unknown): number {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
  if (!parsed.success) throw notFound('Rekod tidak dijumpai');
  return parsed.data.id;
}
