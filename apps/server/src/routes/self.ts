import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { db, jsonSafe } from '../db.js';
import { loadEnv } from '../env.js';
import {
  BACKDATE_WINDOW_DAYS,
  JUSTIFIABLE_STATUSES,
  JUSTIFICATION_STATUSES,
  MAX_REASON,
  MIN_REASON,
  checkSubmit,
  isJustifiable,
  summariseApproved,
  type JustificationStatus,
  type Refusal,
} from '../hr/justification.js';
import { conflict, forbidden, parseBody, unauthorized } from '../http.js';
import { recordActivity } from '../logging/activity.js';
import { parsePeriod, summarise } from '../reports/aggregate.js';
import {
  addDateOnlyDays,
  asDateOnly,
  dateOnlyFromKey,
  dateOnlyKey,
  zonedDateOnly,
} from '../time.js';

/**
 * A person's own attendance, their own explanations, their own applications.
 *
 * ## Reached with a session and no screen permission
 *
 * Same rule as `routes/profile.ts`, and for the same reason: the subject is the caller. Every query
 * here is scoped to the one staff row the session is bound to, and **the staff id is never taken
 * from the request** — not from the body, not from the query, not from the path. There is no shape
 * of request that would let somebody read a colleague's attendance by changing a number, because
 * there is no number in the request to change.
 *
 * Putting these behind a screen permission was considered and rejected. A permission is something an
 * administrator grants, and it would then be something an administrator could forget to grant — at
 * which point a nurse cannot see her own clock-in times, which is not a thing anybody should have to
 * be given access to.
 *
 * ## This is the mobile surface
 *
 * The Android client is these routes plus the profile ones. Nothing here assumes a browser, nothing
 * here needs a screen permission table, and every response is scoped to one person, which is what
 * makes it safe to expose to a device somebody carries around.
 */

/** Malay prose for a refusal. The steering exception: an error message needs words. */
function refusalMessage(refusal: Refusal): string {
  const v = refusal.vars ?? {};
  switch (refusal.key) {
    case 'justify.refuse.badDate':
      return 'Masukkan tarikh yang sah.';
    case 'justify.refuse.future':
      return (
        'Hari yang belum berlaku tidak boleh dijustifikasikan. Enjin tidak mengira hari yang ' +
        'belum berlaku, jadi tiada rekod untuk dilampirkan.'
      );
    case 'justify.refuse.tooOld':
      return (
        `Hanya ${String(v.days ?? BACKDATE_WINDOW_DAYS)} hari ke belakang boleh dijustifikasikan. ` +
        'Sebab yang sampai lebih lewat meminta seseorang memutuskan perkara yang kedua-dua pihak ' +
        'sudah tidak ingat, dan laporan yang ia sepatutnya ubah sudah dibaca.'
      );
    case 'justify.refuse.badKind':
      return 'Jenis justifikasi tidak dikenali.';
    case 'justify.refuse.noRecord':
      return (
        'Tiada rekod kehadiran untuk hari itu. Mungkin ia hari cuti, hari rehat, atau hari yang ' +
        'belum dikira.'
      );
    case 'justify.refuse.statusMismatch':
      return (
        `Hari itu direkodkan sebagai "${String(v.actual ?? '?')}", bukan ` +
        `"${String(v.claimed ?? '?')}". Rekod itu yang menentukan apa yang berlaku; borang ini ` +
        'hanya menerangkan sebabnya.'
      );
    case 'justify.refuse.alreadyPending':
      return 'Sudah ada sebab yang menunggu keputusan untuk hari itu.';
    case 'justify.refuse.alreadyApproved':
      return 'Sebab untuk hari itu sudah diluluskan.';
    case 'justify.refuse.alreadyRejected':
      return (
        'Sebab untuk hari itu sudah ditolak. Kalau ia patut dipertimbangkan semula, minta penyelia ' +
        'menghantarnya balik.'
      );
    case 'justify.refuse.reasonEmpty':
      return 'Tulis sebabnya.';
    case 'justify.refuse.reasonShort':
      return (
        `Sebab terlalu pendek — sekurang-kurangnya ${String(v.min ?? MIN_REASON)} aksara. ` +
        'Sebab satu atau dua perkataan menghasilkan baris yang penyelia kena buka untuk mendapati ' +
        'tiada apa di dalamnya.'
      );
    case 'justify.refuse.reasonLong':
      return `Sebab terlalu panjang — maksimum ${String(v.max ?? MAX_REASON)} aksara.`;
    default:
      return 'Tindakan ini tidak sah.';
  }
}

/**
 * The staff row this session belongs to.
 *
 * The only place a staff id enters these routes. Every account has exactly one staff row — the
 * schema makes `UserAccount.staff` required — so a missing one is a broken account rather than a
 * caller problem, and it is refused as such.
 */
async function ownStaffId(accountId: number): Promise<number> {
  const account = await db().userAccount.findUnique({
    where: { id: accountId },
    select: { staffId: true, status: true },
  });
  if (!account) throw unauthorized();
  if (account.status !== 'active') {
    throw forbidden('Akaun ini tidak aktif.');
  }
  return account.staffId;
}

export async function selfRoutes(app: FastifyInstance): Promise<void> {
  const env = loadEnv();

  const rangeQuery = z.object({
    dari: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    hingga: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  });

  /** How far back the screen looks when nobody has chosen a range. */
  const DEFAULT_SPAN_DAYS = 30;

  /**
   * The default range: the last thirty days, ending today.
   *
   * Month-to-date was the first choice and it is wrong on the first of every month, when it shows
   * one day and reads as an empty screen. It was also wrong the moment this went in: the seeded data
   * ends in August, today is September, and the screen came up blank for the only account able to
   * open it.
   *
   * A rolling window answers the question somebody actually opens this for — "what happened
   * recently" — and never lands on a range with nothing in it while the person has been working. The
   * picker is still there for a specific month.
   */
  function defaultRange(): { dari: string; hingga: string } {
    const today = asDateOnly(zonedDateOnly(new Date(), env.ORG_TIMEZONE));
    return {
      dari: dateOnlyKey(addDateOnlyDays(today, -(DEFAULT_SPAN_DAYS - 1))),
      hingga: dateOnlyKey(today),
    };
  }

  // -------------------------------------------------------------------------
  // Own attendance
  // -------------------------------------------------------------------------

  /**
   * The person's own days, with any explanation attached to each.
   *
   * One row per day carrying every justification kind beside it, rather than two lists the client
   * has to join. The reference system shows this as grouped columns — Default, then Late In, Early
   * Out, Incomplete — and that shape only works if a day arrives as one object.
   */
  app.get('/api/saya/kehadiran', { preHandler: requireAuth }, async (request) => {
    if (!request.user) throw unauthorized();
    const staffId = await ownStaffId(request.user.accountId);

    const query = rangeQuery.parse(request.query);
    const fallback = defaultRange();
    const period = parsePeriod(
      query.dari ?? fallback.dari,
      query.hingga ?? fallback.hingga,
      env.ORG_TIMEZONE,
    );

    const [records, justifications] = await Promise.all([
      db().attendanceRecord.findMany({
        where: { staffId, workDate: { gte: period.from, lte: period.to } },
        orderBy: { workDate: 'desc' },
        /*
         * `name` only. `Shift` has no start or end time — those live on `TimeBlock`, because a
         * shift can hold several intervals and a night shift crosses midnight.
         *
         * The scheduled times come off the record itself, where the engine wrote them when it
         * resolved the day. That is also the right source: the shift's pattern is what was
         * configured, and `scheduledStart` is what this person was actually held to.
         */
        include: { shift: { select: { name: true } } },
      }),
      db().attendanceJustification.findMany({
        where: { staffId, workDate: { gte: period.from, lte: period.to } },
      }),
    ]);

    /*
     * Keyed with `dateOnlyKey`, not `zonedDateKey`.
     *
     * Both sides of this join come from `@db.Date` columns, which are already UTC midnight.
     * Converting them again moves the day, and both sides have to use the same function or the
     * join silently produces no matches for some days and not others.
     */
    const byDay = new Map<string, Map<string, (typeof justifications)[number]>>();
    for (const row of justifications) {
      const key = dateOnlyKey(row.workDate);
      const kinds = byDay.get(key) ?? new Map();
      kinds.set(row.statusKind, row);
      byDay.set(key, kinds);
    }

    return jsonSafe({
      from: dateOnlyKey(period.from),
      to: dateOnlyKey(period.to),
      /** So the client does not have to know the rule to disable its own buttons. */
      justifiableStatuses: JUSTIFIABLE_STATUSES,
      backdateWindowDays: BACKDATE_WINDOW_DAYS,
      rows: records.map((row) => {
        const key = dateOnlyKey(row.workDate);
        const kinds = byDay.get(key);
        return {
          workDate: key,
          status: row.status,
          shiftName: row.shift?.name ?? null,
          scheduledStart: row.scheduledStart?.toISOString() ?? null,
          scheduledEnd: row.scheduledEnd?.toISOString() ?? null,
          checkInAt: row.checkInAt?.toISOString() ?? null,
          checkOutAt: row.checkOutAt?.toISOString() ?? null,
          workedMinutes: row.workedMinutes,
          lateMinutes: row.lateMinutes,
          earlyLeaveMinutes: row.earlyLeaveMinutes,
          overtimeMinutes: row.overtimeMinutes,
          /** True when this day's status is one the person may account for. */
          justifiable: isJustifiable(row.status),
          justifications: Object.fromEntries(
            [...(kinds?.entries() ?? [])].map(([kind, entry]) => [
              kind,
              {
                id: entry.id,
                reason: entry.reason,
                status: entry.status,
                decisionNote: entry.decisionNote,
                submittedAt: entry.submittedAt.toISOString(),
                decidedAt: entry.decidedAt?.toISOString() ?? null,
              },
            ]),
          ),
        };
      }),
      generatedAt: new Date().toISOString(),
    });
  });

  /**
   * The person's own totals for a period.
   *
   * Reuses `summarise` from `reports/aggregate.ts` — the same function the monthly report and the
   * payroll export run through. A second implementation would eventually disagree with the report
   * somebody's supervisor is reading, and the person would be told two different numbers about
   * their own attendance.
   */
  app.get('/api/saya/kehadiran/ringkasan', { preHandler: requireAuth }, async (request) => {
    if (!request.user) throw unauthorized();
    const staffId = await ownStaffId(request.user.accountId);

    const query = rangeQuery.parse(request.query);
    const fallback = defaultRange();
    const period = parsePeriod(
      query.dari ?? fallback.dari,
      query.hingga ?? fallback.hingga,
      env.ORG_TIMEZONE,
    );

    const [summaries, justifications, earlyLeaveDays] = await Promise.all([
      summarise([staffId], period),
      db().attendanceJustification.findMany({
        where: { staffId, workDate: { gte: period.from, lte: period.to } },
        select: { statusKind: true, status: true },
      }),
      /*
       * Counted here rather than taken from `summarise`, which has no such figure.
       *
       * `StaffSummary` folds an `early_leave` day into `presentDays` and keeps only
       * `earlyLeaveMinutes`. That is right for a payroll export — what payroll needs is the minutes —
       * but this screen shows four cards side by side and three of them are day counts. A card
       * reporting minutes beside three reporting days is a card that gets misread.
       *
       * Deliberately not added to `summarise`: that function feeds the monthly report and the
       * payroll export, and widening a shared shape to serve one screen is how the shared shape
       * stops meaning one thing.
       */
      db().attendanceRecord.count({
        where: { staffId, workDate: { gte: period.from, lte: period.to }, status: 'early_leave' },
      }),
    ]);

    return jsonSafe({
      from: dateOnlyKey(period.from),
      to: dateOnlyKey(period.to),
      summary: summaries[0] ?? null,
      earlyLeaveDays,
      /*
       * Approved explanations only, and the screen says so.
       *
       * A pending explanation has not been accepted by anybody. Counting it would let somebody
       * clear their own late record by writing a sentence about it.
       */
      justified: summariseApproved(justifications),
      pending: justifications.filter((row) => row.status === 'pending').length,
      generatedAt: new Date().toISOString(),
    });
  });

  // -------------------------------------------------------------------------
  // Own justifications
  // -------------------------------------------------------------------------

  app.get('/api/saya/justifikasi', { preHandler: requireAuth }, async (request) => {
    if (!request.user) throw unauthorized();
    const staffId = await ownStaffId(request.user.accountId);

    const query = z
      .object({
        status: z.enum(JUSTIFICATION_STATUSES).optional(),
        jenis: z.enum(JUSTIFIABLE_STATUSES).optional(),
      })
      .parse(request.query);

    const rows = await db().attendanceJustification.findMany({
      where: {
        staffId,
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.jenis === undefined ? {} : { statusKind: query.jenis }),
      },
      orderBy: [{ workDate: 'desc' }],
    });

    const counts = await db().attendanceJustification.groupBy({
      by: ['status'],
      where: { staffId },
      _count: { _all: true },
    });

    return jsonSafe({
      rows: rows.map((row) => ({
        id: row.id,
        workDate: dateOnlyKey(row.workDate),
        statusKind: row.statusKind,
        reason: row.reason,
        status: row.status,
        decisionNote: row.decisionNote,
        submittedAt: row.submittedAt.toISOString(),
        decidedAt: row.decidedAt?.toISOString() ?? null,
      })),
      counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
      generatedAt: new Date().toISOString(),
    });
  });

  /**
   * Files an explanation, or replaces one that was sent back.
   *
   * The claimed kind is checked against what the attendance record actually says. Without that,
   * somebody could file an absence explanation for a day they were on time and the queue would fill
   * with rows a supervisor has to cross-check by hand.
   */
  app.post('/api/saya/justifikasi', { preHandler: requireAuth }, async (request) => {
    if (!request.user) throw unauthorized();
    const staffId = await ownStaffId(request.user.accountId);

    const body = parseBody(
      z.strictObject({
        workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        statusKind: z.enum(JUSTIFIABLE_STATUSES),
        reason: z.string().min(1).max(MAX_REASON),
      }),
      request.body,
    );

    const workDate = dateOnlyFromKey(body.workDate);
    const today = dateOnlyKey(zonedDateOnly(new Date(), env.ORG_TIMEZONE));

    const [record, existing] = await Promise.all([
      db().attendanceRecord.findUnique({
        where: { staffId_workDate: { staffId, workDate } },
        select: { status: true },
      }),
      db().attendanceJustification.findUnique({
        where: {
          staffId_workDate_statusKind: { staffId, workDate, statusKind: body.statusKind },
        },
      }),
    ]);

    const refusal = checkSubmit({
      workDate: body.workDate,
      today,
      recordStatus: record?.status ?? null,
      existingStatus: (existing?.status as JustificationStatus | undefined) ?? null,
      statusKind: body.statusKind,
      reason: body.reason,
    });
    if (refusal) throw conflict(refusalMessage(refusal));

    const reason = body.reason.trim();

    /*
     * Upsert rather than create.
     *
     * A `reverted` row is being rewritten in place, and the unique key across
     * `(staffId, workDate, statusKind)` is the thing that guarantees one explanation per morning.
     * Creating a second row and hiding the first would leave two, with the older one still
     * addressable.
     */
    const row = await db().attendanceJustification.upsert({
      where: {
        staffId_workDate_statusKind: { staffId, workDate, statusKind: body.statusKind },
      },
      create: { staffId, workDate, statusKind: body.statusKind, reason, status: 'pending' },
      update: {
        reason,
        status: 'pending',
        submittedAt: new Date(),
        // Cleared, so a resubmission does not carry the note that sent it back.
        decidedAt: null,
        decidedBy: null,
        decisionNote: null,
      },
    });

    await recordActivity({
      request,
      action: existing === null ? 'justification.submitted' : 'justification.resubmitted',
      category: 'attendance',
      detail: `${body.workDate} (${body.statusKind})`,
    });

    return jsonSafe({ id: row.id, status: row.status });
  });

  // -------------------------------------------------------------------------
  // Own applications
  // -------------------------------------------------------------------------

  /**
   * Everything the person has applied for, across the four request modules.
   *
   * One endpoint rather than four, because "what have I asked for and where has it got to" is one
   * question. Filtered on the session's own staff id in every branch.
   *
   * Read-only. Submitting a leave request from here would mean a second implementation of the leave
   * rules — entitlement, overlap, roster writes — and `routes/leave.ts` already holds them.
   */
  app.get('/api/saya/permohonan', { preHandler: requireAuth }, async (request) => {
    if (!request.user) throw unauthorized();
    const staffId = await ownStaffId(request.user.accountId);

    const [leave, overtime, claims, expenses] = await Promise.all([
      db().leaveRequest.findMany({
        where: { staffId },
        orderBy: { id: 'desc' },
        take: 50,
        include: { leaveType: { select: { name: true } } },
      }),
      db().overtimeRequest.findMany({ where: { staffId }, orderBy: { id: 'desc' }, take: 50 }),
      db().claimRequest.findMany({
        where: { staffId },
        orderBy: { id: 'desc' },
        take: 50,
        include: {
          claimType: { select: { name: true, requiresReceipt: true } },
          /*
           * Read for the counts below, not to be listed.
           *
           * A claim holds several costs now, and the only fact a person needs from the lines here is
           * how many of them still have no receipt — because that is the reason their own claim is
           * sitting unapproved, and it is the one reason they can do something about. Returning the
           * lines themselves would make this payload the claim screen, which it is not.
           */
          items: { select: { receiptPath: true } },
        },
      }),
      db().expenseRequest.findMany({
        where: { staffId },
        orderBy: { id: 'desc' },
        take: 50,
        include: { category: { select: { name: true } } },
      }),
    ]);

    return jsonSafe({
      leave: leave.map((row) => ({
        id: row.id,
        /*
         * Leave has no `requestNo`. It predates the HR section, and its rows are identified by the
         * date range rather than by a reference — which is also how somebody refers to their own
         * leave out loud. The client renders the range; nothing here invents a number that would
         * not match anything on the leave screen.
         */
        typeName: row.leaveType.name,
        fromDate: dateOnlyKey(row.fromDate),
        toDate: dateOnlyKey(row.toDate),
        days: Number(row.days),
        status: row.status,
        reason: row.reason,
        decisionNote: row.decisionNote,
      })),
      overtime: overtime.map((row) => ({
        id: row.id,
        requestNo: row.requestNo,
        workDate: dateOnlyKey(row.workDate),
        requestedMinutes: row.requestedMinutes,
        dayType: row.dayType,
        amount: row.amount === null ? null : Number(row.amount),
        status: row.status,
        decisionNote: row.decisionNote,
      })),
      claims: claims.map((row) => ({
        id: row.id,
        requestNo: row.requestNo,
        typeName: row.claimType.name,
        incurredOn: dateOnlyKey(row.incurredOn),
        /** The sum of the lines. Never a single cost, even when there happens to be one line. */
        amount: Number(row.amount),
        approvedAmount: row.approvedAmount === null ? null : Number(row.approvedAmount),
        itemCount: row.items.length,
        /*
         * Together these say "waiting on you" rather than "waiting".
         *
         * `receiptsMissing` alone is not enough: on a category that asks for no paper it is the line
         * count and means nothing, so the client needs the flag to know whether the number is a
         * problem or a detail.
         */
        receiptRequired: row.claimType.requiresReceipt,
        receiptsMissing: row.items.filter((item) => item.receiptPath === null).length,
        status: row.status,
        decisionNote: row.decisionNote,
      })),
      expenses: expenses.map((row) => ({
        id: row.id,
        requestNo: row.requestNo,
        categoryName: row.category.name,
        incurredOn: dateOnlyKey(row.incurredOn),
        amount: Number(row.amount),
        approvedAmount: row.approvedAmount === null ? null : Number(row.approvedAmount),
        status: row.status,
        decisionNote: row.decisionNote,
      })),
      generatedAt: new Date().toISOString(),
    });
  });

  /**
   * The limits and the default range, so no client hard-codes either.
   *
   * `defaultFrom`/`defaultTo` matter more than they look. The screens seed their date pickers from
   * these, and the routes above fall back to the same function — so the range the picker shows is the
   * range the data came from. Computing it on both sides meant the picker could say one thing while
   * the server had answered a different question, and the first version did exactly that.
   *
   * `today` comes from `ORG_TIMEZONE`, not from the reader's browser. A nurse opening this at 00:30
   * in a different zone must still see the work date the organisation is on.
   */
  app.get('/api/saya/tetapan', { preHandler: requireAuth }, async () => {
    const range = defaultRange();
    return jsonSafe({
      backdateWindowDays: BACKDATE_WINDOW_DAYS,
      minReason: MIN_REASON,
      maxReason: MAX_REASON,
      justifiableStatuses: JUSTIFIABLE_STATUSES,
      today: dateOnlyKey(asDateOnly(zonedDateOnly(new Date(), env.ORG_TIMEZONE))),
      defaultFrom: range.dari,
      defaultTo: range.hingga,
    });
  });
}
