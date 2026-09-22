import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requirePermission } from '../auth/plugin.js';
import { can } from '../auth/service.js';
import { db, jsonSafe } from '../db.js';
import {
  applyApprovalAction,
  checkApproverTurn,
  getChain,
  getTrail,
  moduleSettings,
  shouldNotifyApplicant,
} from '../hr/approval.js';
import {
  checkApprovedAmount,
  checkClaim,
  checkClaimLine,
  checkClaimTotal,
  claimAmountFor,
  type Refusal,
} from '../hr/claim.js';
import { toSen } from '../hr/money.js';
import { REQUEST_PREFIX, highestSequence, nextRequestNo, yearMonthOf } from '../hr/request-number.js';
import { conflict, forbidden, notFound, parseBody, unauthorized } from '../http.js';
import { recordActivity } from '../logging/activity.js';
import { notify } from '../notify/dispatch.js';
import { asDateOnly, dateOnlyKey } from '../time.js';

/**
 * Claims and expenses.
 *
 * Two modules in one file because they are the same workflow over a different way of arriving
 * at the amount. A claim can be priced by a rule the organisation set — mileage at a rate per
 * kilometre — so the applicant supplies a quantity and the server derives the ringgit. An
 * expense is priced by what the receipt says.
 *
 * Both hang off the shared approval engine, so who signs is configured rather than coded, and
 * both write the approved figure only when the chain finishes.
 */

/** Today as a calendar key, for the rule library which has no clock of its own. */
function todayKey(): string {
  return dateOnlyKey(asDateOnly(new Date()));
}

/** Turns a rule refusal into the sentence the caller reads. */
function refusalMessage(refusal: Refusal): string {
  const v = refusal.vars ?? {};
  switch (refusal.key) {
    case 'claim.refuse.badDate':
      return 'Masukkan tarikh yang sah.';
    case 'claim.refuse.future':
      return 'Tarikh tidak boleh pada masa hadapan — tuntutan dibuat untuk kos yang sudah berlaku.';
    case 'claim.refuse.tooOld':
      return `Tarikh itu lebih daripada ${String(v.days ?? '?')} hari lalu.`;
    case 'claim.refuse.noQuantity':
      return 'Kategori ini dikira mengikut kadar, jadi kuantiti diperlukan.';
    case 'claim.refuse.noAmount':
      return 'Jumlah mesti lebih daripada sifar.';
    case 'claim.refuse.tooLarge':
      return `Jumlah melebihi had ${String(v.max ?? '?')}.`;
    case 'claim.refuse.overCap':
      return `RM ${String(v.amount ?? '?')} melebihi had kategori RM ${String(v.cap ?? '?')}.`;
    case 'claim.refuse.noReceipt':
      return 'Kategori ini memerlukan resit. Muat naik resit dahulu, kemudian hantar.';
    case 'claim.refuse.noApprovedAmount':
      return 'Jumlah yang diluluskan mesti lebih daripada sifar.';
    case 'claim.refuse.aboveClaimed':
      return (
        `Tidak boleh meluluskan RM ${String(v.approved ?? '?')} untuk tuntutan RM ` +
        `${String(v.claimed ?? '?')} — itu bukan lagi permohonan yang difailkan.`
      );
    default:
      return 'Permohonan ini tidak sah.';
  }
}

const listQuery = z.object({
  staffId: z.coerce.number().int().positive().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

function idParam(params: unknown): number {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
  if (!parsed.success) throw notFound('Rekod tidak dijumpai');
  return parsed.data.id;
}

const decideSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  /**
   * What is allowed, when it differs from what was claimed.
   *
   * Omitted means the full amount. Present and lower is a partial approval, which is a real
   * decision: a receipt above the category cap is approved at the cap.
   */
  approvedAmount: z.number().positive().optional(),
  note: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
});

export async function claimRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // Claim types
  // -------------------------------------------------------------------------

  /**
   * Staff picker for the claim form, scoped to the claim permission.
   *
   * A near-copy of the leave one rather than a shared endpoint, because the gate differs: whoever
   * files claims is not necessarily whoever files leave, and pointing this form at
   * `/api/leave-requests/staff-search` would make the claims screen depend on a leave grant.
   *
   * Filtered rather than returned whole: this directory holds five thousand staff, so a select of
   * every one of them would be a quarter of a megabyte of options with no way to search it.
   */
  app.get(
    '/api/claim-requests/staff-search',
    { preHandler: requirePermission('hr.claims', 'create') },
    async (request) => {
      const query = z
        .object({
          q: z.string().trim().max(128).default(''),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        })
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
    },
  );

  app.get(
    '/api/claim-types',
    { preHandler: requirePermission('hr.claims', 'view') },
    async () => {
      const rows = await db().claimType.findMany({
        orderBy: [{ active: 'desc' }, { code: 'asc' }],
        include: { _count: { select: { requests: true } } },
      });

      return jsonSafe(
        rows.map(({ _count, ratePerUnit, maxAmount, ...row }) => ({
          ...row,
          ratePerUnit: ratePerUnit === null ? null : Number(ratePerUnit),
          maxAmount: maxAmount === null ? null : Number(maxAmount),
          requestCount: _count.requests,
        })),
      );
    },
  );

  const typeSchema = z.object({
    code: z.string().trim().min(1).max(16),
    name: z.string().trim().min(1).max(120),
    description: z.union([z.literal(''), z.string().trim().max(255)]).optional(),
    /** Null makes the category flat: the applicant supplies the amount. */
    ratePerUnit: z.union([z.null(), z.coerce.number().positive().max(100_000)]).optional(),
    unitLabel: z.union([z.literal(''), z.string().trim().max(24)]).optional(),
    maxAmount: z.union([z.null(), z.coerce.number().positive().max(1_000_000)]).optional(),
    requiresReceipt: z.boolean(),
    /** Optional so an older client that never sends it keeps the stored value. */
    requiresApproval: z.boolean().optional(),
    active: z.boolean().optional(),
  });

  app.post(
    '/api/claim-types',
    { preHandler: requirePermission('hr.claims', 'configure') },
    async (request) => {
      const body = parseBody(typeSchema, request.body);
      const code = body.code.toUpperCase();

      const clash = await db().claimType.findUnique({ where: { code } });
      if (clash) throw conflict(`Kod tuntutan "${code}" sudah ada`);

      // A rate without a unit gives the form nothing to label the quantity box with, and the
      // applicant has to guess whether they are entering kilometres or nights.
      if (body.ratePerUnit != null && !body.unitLabel) {
        throw conflict('Kategori berkadar mesti menamakan unitnya — contohnya km, hari, malam.');
      }

      const row = await db().claimType.create({
        data: {
          code,
          name: body.name,
          description: body.description ? body.description : null,
          ratePerUnit: body.ratePerUnit ?? null,
          unitLabel: body.unitLabel ? body.unitLabel : null,
          maxAmount: body.maxAmount ?? null,
          requiresReceipt: body.requiresReceipt,
          requiresApproval: body.requiresApproval ?? true,
          active: body.active ?? true,
        },
      });

      await recordActivity({
        request,
        action: 'claim.type.created',
        category: 'settings',
        detail: `Jenis tuntutan ${code} ditambah`,
      });

      return jsonSafe({ id: row.id });
    },
  );

  app.patch(
    '/api/claim-types/:id',
    { preHandler: requirePermission('hr.claims', 'configure') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(typeSchema.partial(), request.body);

      const existing = await db().claimType.findUnique({ where: { id } });
      if (!existing) throw notFound('Jenis tuntutan tidak dijumpai');

      await db().claimType.update({
        where: { id },
        data: {
          ...(body.code === undefined ? {} : { code: body.code.toUpperCase() }),
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.description === undefined
            ? {}
            : { description: body.description ? body.description : null }),
          ...(body.ratePerUnit === undefined ? {} : { ratePerUnit: body.ratePerUnit }),
          ...(body.unitLabel === undefined
            ? {}
            : { unitLabel: body.unitLabel ? body.unitLabel : null }),
          ...(body.maxAmount === undefined ? {} : { maxAmount: body.maxAmount }),
          ...(body.requiresReceipt === undefined
            ? {}
            : { requiresReceipt: body.requiresReceipt }),
          ...(body.requiresApproval === undefined
            ? {}
            : { requiresApproval: body.requiresApproval }),
          ...(body.active === undefined ? {} : { active: body.active }),
        },
      });

      await recordActivity({
        request,
        action: 'claim.type.updated',
        category: 'settings',
        detail: `Jenis tuntutan ${existing.code} dikemas kini`,
      });

      return { ok: true };
    },
  );

  app.delete(
    '/api/claim-types/:id',
    { preHandler: requirePermission('hr.claims', 'configure') },
    async (request) => {
      const id = idParam(request.params);
      const used = await db().claimRequest.count({ where: { claimTypeId: id } });
      // A decided claim still has to be able to name the category it was filed under.
      if (used > 0) {
        throw conflict(
          `${String(used)} tuntutan masih merujuk jenis ini. Nyahaktifkan ia sebagai ganti.`,
        );
      }

      await db().claimType.delete({ where: { id } });
      await recordActivity({
        request,
        action: 'claim.type.deleted',
        category: 'settings',
        level: 'warn',
        detail: `Jenis tuntutan #${String(id)} dibuang`,
      });
      return { ok: true };
    },
  );

  // -------------------------------------------------------------------------
  // Claims
  // -------------------------------------------------------------------------

  app.get(
    '/api/claim-requests',
    { preHandler: requirePermission('hr.claims', 'view') },
    async (request) => {
      const query = listQuery.parse(request.query);

      const where = {
        ...(query.staffId === undefined ? {} : { staffId: query.staffId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.from === undefined && query.to === undefined
          ? {}
          : {
              incurredOn: {
                ...(query.from === undefined ? {} : { gte: asDateOnly(query.from) }),
                ...(query.to === undefined ? {} : { lte: asDateOnly(query.to) }),
              },
            }),
      };

      const [rows, total, grouped, chain] = await Promise.all([
        db().claimRequest.findMany({
          where,
          orderBy: [{ incurredOn: 'desc' }, { id: 'desc' }],
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
            claimType: { select: { code: true, name: true, unitLabel: true } },
            /*
             * Lines come with the list, not on a second request per row.
             *
             * The screen shows an item count and a missing-receipt count on every row, and both are
             * derived from these. Fetching them per row on expand would mean the count only appeared
             * after somebody opened the row — which is the wrong way round, because the count is what
             * tells them whether opening it is worth doing.
             */
            items: {
              orderBy: { incurredOn: 'asc' },
              select: {
                id: true,
                incurredOn: true,
                description: true,
                category: true,
                quantity: true,
                amount: true,
                receiptPath: true,
              },
            },
          },
        }),
        db().claimRequest.count({ where }),
        // Counts ignore the status filter: computed inside it, choosing one chip would zero
        // the others and the remaining rows would look as if they had vanished.
        db().claimRequest.groupBy({
          by: ['status'],
          where: { ...where, status: undefined },
          _count: { _all: true },
        }),
        getChain('claim'),
      ]);

      return jsonSafe({
        rows: rows.map(serialiseClaim),
        total,
        counts: Object.fromEntries(grouped.map((row) => [row.status, row._count._all])),
        chainLength: chain.length,
        generatedAt: new Date().toISOString(),
      });
    },
  );

  app.post(
    '/api/claim-requests',
    { preHandler: requirePermission('hr.claims', 'create') },
    async (request) => {
      if (!request.user) throw unauthorized();

      const body = parseBody(
        z.object({
          staffId: z.number().int().positive(),
          claimTypeId: z.number().int().positive(),
          /** The date on the claim. Each line carries the date its own cost was incurred. */
          incurredOn: z.coerce.date(),
          description: z.string().trim().min(1).max(500),
          remarks: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
          /**
           * One or more lines, which is what a claim now is.
           *
           * Capped at fifty. A claim with more lines than that is a spreadsheet, and the cap is what
           * stops one request holding a month of somebody's spending in a single approval decision.
           */
          items: z
            .array(
              z.object({
                incurredOn: z.coerce.date(),
                description: z.string().trim().min(1).max(255),
                category: z.union([z.literal(''), z.string().trim().max(120)]).optional(),
                /** Required for a rated category, ignored for a flat one. */
                quantity: z.number().positive().optional(),
                /** Required for a flat category, ignored for a rated one. */
                amount: z.number().positive().optional(),
              }),
            )
            .min(1)
            .max(50),
        }),
        request.body,
      );

      const incurredOn = asDateOnly(body.incurredOn);

      const [staff, type] = await Promise.all([
        db().staff.findUnique({
          where: { id: body.staffId },
          select: { fullName: true, active: true },
        }),
        db().claimType.findUnique({ where: { id: body.claimTypeId } }),
      ]);

      if (!staff) throw notFound('Staf tidak dijumpai');
      if (!staff.active) throw conflict(`${staff.fullName} tidak aktif`);
      if (!type) throw notFound('Jenis tuntutan tidak dijumpai');
      if (!type.active) throw conflict(`${type.name} tidak aktif. Pilih jenis yang aktif.`);

      const ratePerUnit = type.ratePerUnit === null ? null : Number(type.ratePerUnit);
      const today = todayKey();

      /*
       * Each line is priced on the server, and a rated category refuses a typed figure.
       *
       * Accepting the figure would make the rate decorative, and the rate is the whole control: it
       * is the difference between a mileage claim somebody can check and a number somebody wrote
       * down. The rate is the claim's, frozen at filing; the quantity it multiplies is the line's.
       */
      const lines = body.items.map((item, index) => {
        const derived = claimAmountFor({ ratePerUnit, quantity: item.quantity ?? null });
        const amount = derived === null ? toSen(item.amount ?? Number.NaN) : derived;
        const lineDate = asDateOnly(item.incurredOn);

        const refusal = checkClaimLine({
          incurredOn: dateOnlyKey(lineDate),
          today,
          amount,
          /*
           * The receipt rule is switched OFF here, not satisfied with a lie.
           *
           * The receipt is attached after the row exists, because an upload needs something to attach
           * to. Filing first is also the kinder order: an upload that fails must not discard
           * everything already typed. So the rule cannot bite at filing — it bites at the decide
           * endpoint, which refuses to approve a claim with any line still missing the paper its
           * category demands, and that is the last point before money is owed.
           *
           * This previously read `requiresReceipt: type.requiresReceipt` with
           * `hasReceipt: !type.requiresReceipt`, which is the same rule *enabled* and then failed:
           * every category demanding a receipt refused every claim at the moment of filing. It is why
           * the claims table was empty — the feature had never been usable.
           */
          requiresReceipt: false,
          hasReceipt: true,
          ratePerUnit,
          quantity: item.quantity ?? null,
        });
        // Numbered from one, because the message is read against a form where line 1 is the first.
        if (refusal) throw conflict(`Baris ${String(index + 1)}: ${refusalMessage(refusal)}`);

        return {
          incurredOn: lineDate,
          description: item.description,
          category: item.category && item.category.length > 0 ? item.category : null,
          quantity: item.quantity ?? null,
          amount,
        };
      });

      /**
       * Summed as integer cents, then back to ringgit.
       *
       * Each line's amount is already rounded to two places, so `× 100` is exact and the sum cannot
       * drift. Adding the ringgit figures directly would: three lines of 48.50, 12.00 and 95.30 is a
       * float sum, and the total that reaches the database has to be the total the screen showed.
       *
       * Note `toSen` returns RINGGIT rounded to two places despite its name — it does not scale to
       * cents. An earlier version of this line divided its result by 100 and stored RM 1.44 for a
       * RM 144.00 mileage claim: a hundredfold error, on money, in the direction nobody queries.
       */
      const amount =
        lines.reduce((total, line) => total + Math.round(line.amount * 100), 0) / 100;
      const quantity = ratePerUnit === null
        ? null
        : lines.reduce((total, line) => total + (line.quantity ?? 0), 0);

      const totalRefusal = checkClaimTotal({
        lineCount: lines.length,
        amount,
        // A ceiling per claim, so it is checked against the sum. Per line, four RM900 lines would
        // pass a RM1,000 cap.
        maxAmount: type.maxAmount === null ? null : Number(type.maxAmount),
      });
      if (totalRefusal) throw conflict(refusalMessage(totalRefusal));

      const yearMonth = yearMonthOf(incurredOn);
      const row = await db().$transaction(async (tx) => {
        const latest = await tx.claimRequest.findMany({
          where: { requestNo: { startsWith: `${REQUEST_PREFIX.claim}-${yearMonth}-` } },
          select: { requestNo: true },
        });

        return tx.claimRequest.create({
          data: {
            requestNo: nextRequestNo(
              REQUEST_PREFIX.claim,
              yearMonth,
              highestSequence(latest.map((item) => item.requestNo)),
            ),
            staffId: body.staffId,
            claimTypeId: body.claimTypeId,
            incurredOn,
            // Derived sums, never typed. See the notes on the columns.
            quantity,
            // Frozen at filing, so a later rate change cannot move a decided claim.
            ratePerUnit,
            amount,
            description: body.description,
            /*
              Lines written in the same transaction as the claim, so there is never a moment where a
              claim exists with a total but no lines to account for it.
            */
            items: { create: lines },
            /*
             * A category that needs no approval is recorded as approved on submit, matching
             * `LeaveType.requiresApproval`.
             *
             * `approvedAmount` stays zero and `decidedAt` stays null, because nothing has been paid
             * and nobody signed. The claim is allowed, not settled — payment is a separate step
             * whichever way this flag is set, and conflating the two would make an auto-approved
             * category look like money already out the door.
             */
            status: type.requiresApproval ? 'pending' : 'approved',
          },
          /*
           * The line ids come back with the claim.
           *
           * The form collects a receipt per line while somebody is typing, but a receipt has to be
           * attached to a row that exists — so the upload happens immediately after this call, and
           * without the ids it would need a second round trip to discover what the lines are called.
           *
           * Ordered explicitly. The mapping back is positional: the file held against line 3 of the
           * form belongs to `items[2]`. Ids are autoincrement within the one `create` so insertion
           * order and id order already agree, but the ordering says so rather than assuming it.
           */
          include: { items: { orderBy: { id: 'asc' }, select: { id: true } } },
        });
      });

      await recordActivity({
        request,
        action: 'claim.created',
        category: 'schedule',
        detail: `${row.requestNo}: ${staff.fullName}, ${type.code}, RM ${amount.toFixed(2)}`,
      });

      return jsonSafe({
        id: row.id,
        requestNo: row.requestNo,
        amount,
        /** Tells the form whether it still has to collect a file before this can be decided. */
        receiptRequired: type.requiresReceipt,
        /** In the order the lines were sent, so the form can post each line's file against its row. */
        itemIds: row.items.map((item) => item.id),
      });
    },
  );

  app.post(
    '/api/claim-requests/:id/decide',
    { preHandler: requirePermission('hr.claims', 'approve') },
    async (request) => {
      if (!request.user) throw unauthorized();

      const id = idParam(request.params);
      const body = parseBody(decideSchema, request.body);

      const existing = await db().claimRequest.findUnique({
        where: { id },
        include: {
          staff: { select: { fullName: true, phone: true, email: true, employeeNo: true } },
          claimType: true,
          /*
           * Read for the per-line receipt check below, and for the `{{items}}` placeholder the
           * decision notice fills — a template carrying only the total tells somebody RM 155.80 was
           * approved for three costs it does not name.
           */
          items: {
            orderBy: { incurredOn: 'asc' },
            select: {
              id: true,
              incurredOn: true,
              description: true,
              quantity: true,
              amount: true,
              receiptPath: true,
            },
          },
        },
      });
      if (!existing) throw notFound('Tuntutan tidak dijumpai');
      if (existing.status !== 'pending') {
        throw conflict(`Tuntutan ini sudah ${existing.status}. Ia tidak boleh diputuskan lagi.`);
      }
      if (body.decision === 'rejected' && (body.note ?? '').trim().length < 3) {
        throw conflict('Penolakan memerlukan sebab bertulis.');
      }

      /*
       * Every line needs its paper, not just one of them.
       *
       * `requiresReceipt` means "a receipt on every line" now that a claim has lines — one hotel bill
       * standing in for three unevidenced toll charges is exactly what this check exists to stop. The
       * message names how many are missing so the applicant knows what to send rather than having to
       * compare the list against itself.
       */
      if (body.decision === 'approved' && existing.claimType.requiresReceipt) {
        const missing = existing.items.filter((item) => item.receiptPath === null).length;
        if (missing > 0) {
          throw conflict(
            `${String(missing)} daripada ${String(existing.items.length)} baris tuntutan ini masih ` +
              'tiada resit. Setiap baris memerlukan resitnya sendiri sebelum boleh diluluskan.',
          );
        }
      }

      const outOfTurn = await checkApproverTurn({
        module: 'claim',
        currentLevel: existing.currentLevel,
        accountId: request.user.accountId,
        roleId: request.user.roleId,
        mayOverride: can(request.user, 'hr.claims', 'configure'),
      });
      if (outOfTurn !== null) throw forbidden(outOfTurn);

      const claimed = Number(existing.amount);
      const allowed = body.approvedAmount ?? claimed;

      if (body.decision === 'approved') {
        const refusal = checkApprovedAmount({ claimed, approved: allowed });
        if (refusal) throw conflict(refusalMessage(refusal));
      }

      const outcome = await applyApprovalAction({
        module: 'claim',
        applicationId: id,
        action: body.decision === 'approved' ? 'approve' : 'reject',
        actor: { accountId: request.user.accountId, label: request.user.fullName },
        remarks: body.note ?? null,
        currentLevel: existing.currentLevel,
      });

      await db().claimRequest.update({
        where: { id },
        data: {
          status: outcome.status,
          currentLevel: outcome.level,
          // Written only once the answer is final: a claim at rung 2 of 3 owes nothing yet.
          ...(body.decision === 'approved'
            ? { approvedAmount: outcome.finalized ? toSen(allowed) : 0 }
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
          entityType: 'ClaimRequest',
          entityId: String(id),
          changes: JSON.parse(
            JSON.stringify({
              status: { before: 'pending', after: outcome.status },
              level: { before: existing.currentLevel, after: outcome.level },
              ...(outcome.finalized && body.decision === 'approved'
                ? { approvedAmount: { before: 0, after: toSen(allowed) } }
                : {}),
            }),
          ) as object,
          reason: body.note ?? null,
        },
      });

      const settings = await moduleSettings('claim');
      if (shouldNotifyApplicant(settings, outcome)) {
        notify({
          trigger: outcome.status === 'approved' ? 'claim.approved' : 'claim.rejected',
          mobile: existing.staff.phone,
          summary: outcome.finalized
            ? outcome.status === 'approved'
              ? `Tuntutan ${existing.requestNo} DILULUSKAN — RM ${toSen(allowed).toFixed(2)}.`
              : `Tuntutan ${existing.requestNo} DITOLAK. Sebab: ${body.note ?? '-'}`
            : `Tuntutan ${existing.requestNo} diluluskan pada aras ${String(outcome.level)} ` +
              `daripada ${String(outcome.totalLevels)}. Masih menunggu kelulusan penuh.`,
          email: {
            module: 'claim',
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
              claimType: existing.claimType.name,
              incurredOn: dateOnlyKey(existing.incurredOn),
              amount: `RM ${claimed.toFixed(2)}`,
              approvedAmount: outcome.finalized ? `RM ${toSen(allowed).toFixed(2)}` : null,
              quantity: existing.quantity === null ? null : String(Number(existing.quantity)),
              itemCount: existing.items.length,
              /*
               * One line per cost, newline separated.
               *
               * The template body is plain text and `textToHtml` turns a single newline into `<br>`,
               * so this renders as a list in both parts without the placeholder having to carry
               * markup — which it must not, because values are HTML-escaped on the way in.
               */
              items: existing.items
                .map(
                  (item) =>
                    `${dateOnlyKey(item.incurredOn)} · ${item.description} · ` +
                    `RM ${Number(item.amount).toFixed(2)}` +
                    (item.quantity === null
                      ? ''
                      : ` (${String(Number(item.quantity))} ${existing.claimType.unitLabel ?? 'unit'})`),
                )
                .join('\n'),
            },
          },
        });
      }

      await recordActivity({
        request,
        action: `claim.${outcome.status}`,
        category: 'schedule',
        level: outcome.status === 'approved' ? 'info' : 'warn',
        detail:
          `${existing.requestNo}: ${existing.staff.fullName}, aras ${String(outcome.level)}` +
          (outcome.finalized && body.decision === 'approved'
            ? `, RM ${toSen(allowed).toFixed(2)}`
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
        approvedAmount: outcome.finalized ? toSen(allowed) : 0,
        /** Approved is not paid. Nothing here pays yet. */
        paid: false,
      });
    },
  );

  app.post(
    '/api/claim-requests/:id/cancel',
    { preHandler: requirePermission('hr.claims', 'edit') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const id = idParam(request.params);

      const existing = await db().claimRequest.findUnique({ where: { id } });
      if (!existing) throw notFound('Tuntutan tidak dijumpai');
      if (existing.status !== 'pending') {
        throw conflict(
          `Hanya tuntutan yang belum diputuskan boleh ditarik. Ini sudah ${existing.status}.`,
        );
      }

      await db().claimRequest.update({ where: { id }, data: { status: 'cancelled' } });
      await recordActivity({
        request,
        action: 'claim.cancelled',
        category: 'schedule',
        level: 'warn',
        detail: `${existing.requestNo} ditarik`,
      });
      return { ok: true };
    },
  );

  app.get(
    '/api/claim-requests/:id',
    { preHandler: requirePermission('hr.claims', 'view') },
    async (request) => {
      const id = idParam(request.params);
      const row = await db().claimRequest.findUnique({
        where: { id },
        include: {
          staff: {
            select: {
              id: true,
              employeeNo: true,
              fullName: true,
              department: { select: { name: true } },
            },
          },
          claimType: { select: { code: true, name: true, unitLabel: true } },
          /*
           * The same lines the list carries, in the same order.
           *
           * Omitted once, and the detail payload answered `itemCount: 0` and `receiptsMissing: 0`
           * for a claim holding three unevidenced costs — an approver opening one row was told it
           * had nothing to evidence, which is the opposite of true. `ClaimRow.items` is required for
           * that reason: a query that forgets them no longer compiles.
           */
          items: {
            orderBy: { incurredOn: 'asc' },
            select: {
              id: true,
              incurredOn: true,
              description: true,
              category: true,
              quantity: true,
              amount: true,
              receiptPath: true,
            },
          },
        },
      });
      if (!row) throw notFound('Tuntutan tidak dijumpai');

      return jsonSafe({ ...serialiseClaim(row), trail: await getTrail('claim', id) });
    },
  );
}

type ClaimRow = {
  id: number;
  requestNo: string;
  staffId: number;
  claimTypeId: number;
  incurredOn: Date;
  quantity: unknown;
  ratePerUnit: unknown;
  amount: unknown;
  approvedAmount: unknown;
  description: string;
  status: string;
  currentLevel: number;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
  staff: {
    id: number;
    employeeNo: string;
    fullName: string;
    department: { name: string } | null;
  };
  claimType: { code: string; name: string; unitLabel: string | null };
  /**
   * Required, not optional.
   *
   * It was optional, and the detail query duly left it out — every derived figure in the payload
   * (`itemCount`, `receiptsMissing`, `hasReceipt`) then read as if the claim had no lines, on the one
   * screen where somebody decides whether to approve it. `tsc` was satisfied throughout. Making the
   * field required is what turns that back into a compile error.
   */
  items: Array<{
    id: number;
    incurredOn: Date;
    description: string;
    category: string | null;
    quantity: unknown;
    amount: unknown;
    receiptPath: string | null;
  }>;
};

/**
 * Decimals out as numbers, and the calendar date as its key.
 *
 * `receiptPath` is deliberately not returned, on the lines either. It is a filename on the server's
 * disk, and the screen has no use for it beyond knowing whether one exists — `hasReceipt` answers
 * that, and the file itself is served by its own endpoint.
 *
 * `itemCount` and `receiptsMissing` are summarised here rather than left for the screen to count.
 * The second is what tells an approver the claim cannot be approved yet, and a screen that had to
 * derive it would be a second place for the rule to be implemented differently.
 */
function serialiseClaim(row: ClaimRow): Record<string, unknown> {
  return {
    id: row.id,
    requestNo: row.requestNo,
    staffId: row.staffId,
    employeeNo: row.staff.employeeNo,
    staffName: row.staff.fullName,
    departmentName: row.staff.department?.name ?? null,
    claimTypeId: row.claimTypeId,
    claimTypeCode: row.claimType.code,
    claimTypeName: row.claimType.name,
    unitLabel: row.claimType.unitLabel,
    incurredOn: dateOnlyKey(row.incurredOn),
    quantity: row.quantity === null ? null : Number(row.quantity),
    ratePerUnit: row.ratePerUnit === null ? null : Number(row.ratePerUnit),
    amount: Number(row.amount),
    approvedAmount: Number(row.approvedAmount),
    description: row.description,
    itemCount: row.items.length,
    /** What tells an approver the claim cannot be approved yet. */
    receiptsMissing: row.items.filter((item) => item.receiptPath === null).length,
    hasReceipt: row.items.some((item) => item.receiptPath !== null),
    items: row.items.map((item) => ({
      id: item.id,
      incurredOn: dateOnlyKey(item.incurredOn),
      description: item.description,
      category: item.category,
      quantity: item.quantity === null ? null : Number(item.quantity),
      amount: Number(item.amount),
      hasReceipt: item.receiptPath !== null,
    })),
    status: row.status,
    currentLevel: row.currentLevel,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

/**
 * Out-of-pocket expenses, claimed back.
 *
 * The same workflow as a claim with two differences, and both come from the same fact: an
 * expense has no rate to derive an amount from.
 *
 *   the receipt is never optional — it is the entire basis of the figure
 *   a payee is recorded — a receipt without one is hard to reconcile against a statement
 *
 * Registered separately from `claimRoutes` so each is a plugin of its own, but they share this
 * file because they share the rules: `checkClaim` and `checkApprovedAmount` serve both.
 */
export async function expenseRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  app.get(
    '/api/expense-categories',
    { preHandler: requirePermission('hr.expenses', 'view') },
    async () => {
      const rows = await db().expenseCategory.findMany({
        orderBy: [{ active: 'desc' }, { code: 'asc' }],
        include: { _count: { select: { requests: true } } },
      });

      return jsonSafe(
        rows.map(({ _count, maxAmount, ...row }) => ({
          ...row,
          maxAmount: maxAmount === null ? null : Number(maxAmount),
          requestCount: _count.requests,
        })),
      );
    },
  );

  const categorySchema = z.object({
    code: z.string().trim().min(1).max(16),
    name: z.string().trim().min(1).max(120),
    description: z.union([z.literal(''), z.string().trim().max(255)]).optional(),
    maxAmount: z.union([z.null(), z.coerce.number().positive().max(1_000_000)]).optional(),
    active: z.boolean().optional(),
  });

  app.post(
    '/api/expense-categories',
    { preHandler: requirePermission('hr.expenses', 'configure') },
    async (request) => {
      const body = parseBody(categorySchema, request.body);
      const code = body.code.toUpperCase();

      const clash = await db().expenseCategory.findUnique({ where: { code } });
      if (clash) throw conflict(`Kod kategori "${code}" sudah ada`);

      const row = await db().expenseCategory.create({
        data: {
          code,
          name: body.name,
          description: body.description ? body.description : null,
          maxAmount: body.maxAmount ?? null,
          active: body.active ?? true,
        },
      });

      await recordActivity({
        request,
        action: 'expense.category.created',
        category: 'settings',
        detail: `Kategori perbelanjaan ${code} ditambah`,
      });

      return jsonSafe({ id: row.id });
    },
  );

  app.patch(
    '/api/expense-categories/:id',
    { preHandler: requirePermission('hr.expenses', 'configure') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(categorySchema.partial(), request.body);

      const existing = await db().expenseCategory.findUnique({ where: { id } });
      if (!existing) throw notFound('Kategori tidak dijumpai');

      await db().expenseCategory.update({
        where: { id },
        data: {
          ...(body.code === undefined ? {} : { code: body.code.toUpperCase() }),
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.description === undefined
            ? {}
            : { description: body.description ? body.description : null }),
          ...(body.maxAmount === undefined ? {} : { maxAmount: body.maxAmount }),
          ...(body.active === undefined ? {} : { active: body.active }),
        },
      });

      await recordActivity({
        request,
        action: 'expense.category.updated',
        category: 'settings',
        detail: `Kategori perbelanjaan ${existing.code} dikemas kini`,
      });

      return { ok: true };
    },
  );

  app.delete(
    '/api/expense-categories/:id',
    { preHandler: requirePermission('hr.expenses', 'configure') },
    async (request) => {
      const id = idParam(request.params);
      const used = await db().expenseRequest.count({ where: { categoryId: id } });
      // A decided expense still has to be able to name the category it was filed under.
      if (used > 0) {
        throw conflict(
          `${String(used)} permohonan masih merujuk kategori ini. Nyahaktifkan ia sebagai ganti.`,
        );
      }

      await db().expenseCategory.delete({ where: { id } });
      await recordActivity({
        request,
        action: 'expense.category.deleted',
        category: 'settings',
        level: 'warn',
        detail: `Kategori perbelanjaan #${String(id)} dibuang`,
      });
      return { ok: true };
    },
  );

  // -------------------------------------------------------------------------
  // Expense requests
  // -------------------------------------------------------------------------

  app.get(
    '/api/expense-requests',
    { preHandler: requirePermission('hr.expenses', 'view') },
    async (request) => {
      const query = listQuery.parse(request.query);

      const where = {
        ...(query.staffId === undefined ? {} : { staffId: query.staffId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.from === undefined && query.to === undefined
          ? {}
          : {
              incurredOn: {
                ...(query.from === undefined ? {} : { gte: asDateOnly(query.from) }),
                ...(query.to === undefined ? {} : { lte: asDateOnly(query.to) }),
              },
            }),
      };

      const [rows, total, grouped, chain] = await Promise.all([
        db().expenseRequest.findMany({
          where,
          orderBy: [{ incurredOn: 'desc' }, { id: 'desc' }],
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
            category: { select: { code: true, name: true } },
          },
        }),
        db().expenseRequest.count({ where }),
        db().expenseRequest.groupBy({
          by: ['status'],
          where: { ...where, status: undefined },
          _count: { _all: true },
        }),
        getChain('expenses'),
      ]);

      return jsonSafe({
        rows: rows.map(serialiseExpense),
        total,
        counts: Object.fromEntries(grouped.map((row) => [row.status, row._count._all])),
        chainLength: chain.length,
        generatedAt: new Date().toISOString(),
      });
    },
  );

  app.post(
    '/api/expense-requests',
    { preHandler: requirePermission('hr.expenses', 'create') },
    async (request) => {
      if (!request.user) throw unauthorized();

      const body = parseBody(
        z.object({
          staffId: z.number().int().positive(),
          categoryId: z.number().int().positive(),
          incurredOn: z.coerce.date(),
          amount: z.number().positive(),
          payee: z.string().trim().min(1).max(190),
          description: z.string().trim().min(1).max(500),
        }),
        request.body,
      );

      const incurredOn = asDateOnly(body.incurredOn);

      const [staff, category] = await Promise.all([
        db().staff.findUnique({
          where: { id: body.staffId },
          select: { fullName: true, active: true },
        }),
        db().expenseCategory.findUnique({ where: { id: body.categoryId } }),
      ]);

      if (!staff) throw notFound('Staf tidak dijumpai');
      if (!staff.active) throw conflict(`${staff.fullName} tidak aktif`);
      if (!category) throw notFound('Kategori tidak dijumpai');
      if (!category.active) {
        throw conflict(`${category.name} tidak aktif. Pilih kategori yang aktif.`);
      }

      const amount = toSen(body.amount);

      const refusal = checkClaim({
        incurredOn: dateOnlyKey(incurredOn),
        today: todayKey(),
        amount,
        maxAmount: category.maxAmount === null ? null : Number(category.maxAmount),
        /*
         * An expense always needs a receipt, but it is attached after the row exists — the
         * upload needs something to attach to. So the check passes here and the decide
         * endpoint enforces it, which is the last point before money is owed.
         */
        requiresReceipt: false,
        hasReceipt: false,
        ratePerUnit: null,
        quantity: null,
      });
      if (refusal) throw conflict(refusalMessage(refusal));

      const yearMonth = yearMonthOf(incurredOn);
      const row = await db().$transaction(async (tx) => {
        const latest = await tx.expenseRequest.findMany({
          where: { requestNo: { startsWith: `${REQUEST_PREFIX.expenses}-${yearMonth}-` } },
          select: { requestNo: true },
        });

        return tx.expenseRequest.create({
          data: {
            requestNo: nextRequestNo(
              REQUEST_PREFIX.expenses,
              yearMonth,
              highestSequence(latest.map((item) => item.requestNo)),
            ),
            staffId: body.staffId,
            categoryId: body.categoryId,
            incurredOn,
            amount,
            payee: body.payee,
            description: body.description,
            status: 'pending',
          },
        });
      });

      await recordActivity({
        request,
        action: 'expense.created',
        category: 'schedule',
        detail: `${row.requestNo}: ${staff.fullName}, ${category.code}, RM ${amount.toFixed(2)}`,
      });

      return jsonSafe({ id: row.id, requestNo: row.requestNo, amount });
    },
  );

  app.post(
    '/api/expense-requests/:id/decide',
    { preHandler: requirePermission('hr.expenses', 'approve') },
    async (request) => {
      if (!request.user) throw unauthorized();

      const id = idParam(request.params);
      const body = parseBody(decideSchema, request.body);

      const existing = await db().expenseRequest.findUnique({
        where: { id },
        include: {
          staff: { select: { fullName: true, phone: true, email: true, employeeNo: true } },
          category: true,
        },
      });
      if (!existing) throw notFound('Permohonan perbelanjaan tidak dijumpai');
      if (existing.status !== 'pending') {
        throw conflict(`Permohonan ini sudah ${existing.status}. Ia tidak boleh diputuskan lagi.`);
      }
      if (body.decision === 'rejected' && (body.note ?? '').trim().length < 3) {
        throw conflict('Penolakan memerlukan sebab bertulis.');
      }

      /*
       * Always enforced, unlike a claim where the category decides.
       *
       * An expense is priced by what the receipt says. Approving one without a receipt is
       * approving a figure with nothing behind it.
       */
      if (body.decision === 'approved' && existing.receiptPath === null) {
        throw conflict(
          'Perbelanjaan tidak boleh diluluskan tanpa resit — resit itulah asas jumlahnya.',
        );
      }

      const outOfTurn = await checkApproverTurn({
        module: 'expenses',
        currentLevel: existing.currentLevel,
        accountId: request.user.accountId,
        roleId: request.user.roleId,
        mayOverride: can(request.user, 'hr.expenses', 'configure'),
      });
      if (outOfTurn !== null) throw forbidden(outOfTurn);

      const claimed = Number(existing.amount);
      const allowed = body.approvedAmount ?? claimed;

      if (body.decision === 'approved') {
        const refusal = checkApprovedAmount({ claimed, approved: allowed });
        if (refusal) throw conflict(refusalMessage(refusal));
      }

      const outcome = await applyApprovalAction({
        module: 'expenses',
        applicationId: id,
        action: body.decision === 'approved' ? 'approve' : 'reject',
        actor: { accountId: request.user.accountId, label: request.user.fullName },
        remarks: body.note ?? null,
        currentLevel: existing.currentLevel,
      });

      await db().expenseRequest.update({
        where: { id },
        data: {
          status: outcome.status,
          currentLevel: outcome.level,
          ...(body.decision === 'approved'
            ? { approvedAmount: outcome.finalized ? toSen(allowed) : 0 }
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
          entityType: 'ExpenseRequest',
          entityId: String(id),
          changes: JSON.parse(
            JSON.stringify({
              status: { before: 'pending', after: outcome.status },
              level: { before: existing.currentLevel, after: outcome.level },
              ...(outcome.finalized && body.decision === 'approved'
                ? { approvedAmount: { before: 0, after: toSen(allowed) } }
                : {}),
            }),
          ) as object,
          reason: body.note ?? null,
        },
      });

      const settings = await moduleSettings('expenses');
      if (shouldNotifyApplicant(settings, outcome)) {
        notify({
          trigger: outcome.status === 'approved' ? 'expense.approved' : 'expense.rejected',
          mobile: existing.staff.phone,
          summary: outcome.finalized
            ? outcome.status === 'approved'
              ? `Perbelanjaan ${existing.requestNo} DILULUSKAN — RM ${toSen(allowed).toFixed(2)}.`
              : `Perbelanjaan ${existing.requestNo} DITOLAK. Sebab: ${body.note ?? '-'}`
            : `Perbelanjaan ${existing.requestNo} diluluskan pada aras ${String(outcome.level)} ` +
              `daripada ${String(outcome.totalLevels)}. Masih menunggu kelulusan penuh.`,
          email: {
            module: 'expenses',
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
              category: existing.category.name,
              incurredOn: dateOnlyKey(existing.incurredOn),
              payee: existing.payee,
              amount: `RM ${claimed.toFixed(2)}`,
              approvedAmount: outcome.finalized ? `RM ${toSen(allowed).toFixed(2)}` : null,
            },
          },
        });
      }

      await recordActivity({
        request,
        action: `expense.${outcome.status}`,
        category: 'schedule',
        level: outcome.status === 'approved' ? 'info' : 'warn',
        detail:
          `${existing.requestNo}: ${existing.staff.fullName}, aras ${String(outcome.level)}` +
          (outcome.finalized && body.decision === 'approved'
            ? `, RM ${toSen(allowed).toFixed(2)}`
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
        approvedAmount: outcome.finalized ? toSen(allowed) : 0,
        paid: false,
      });
    },
  );

  app.post(
    '/api/expense-requests/:id/cancel',
    { preHandler: requirePermission('hr.expenses', 'edit') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const id = idParam(request.params);

      const existing = await db().expenseRequest.findUnique({ where: { id } });
      if (!existing) throw notFound('Permohonan perbelanjaan tidak dijumpai');
      if (existing.status !== 'pending') {
        throw conflict(
          `Hanya permohonan yang belum diputuskan boleh ditarik. Ini sudah ${existing.status}.`,
        );
      }

      await db().expenseRequest.update({ where: { id }, data: { status: 'cancelled' } });
      await recordActivity({
        request,
        action: 'expense.cancelled',
        category: 'schedule',
        level: 'warn',
        detail: `${existing.requestNo} ditarik`,
      });
      return { ok: true };
    },
  );

  app.get(
    '/api/expense-requests/:id',
    { preHandler: requirePermission('hr.expenses', 'view') },
    async (request) => {
      const id = idParam(request.params);
      const row = await db().expenseRequest.findUnique({
        where: { id },
        include: {
          staff: {
            select: {
              id: true,
              employeeNo: true,
              fullName: true,
              department: { select: { name: true } },
            },
          },
          category: { select: { code: true, name: true } },
        },
      });
      if (!row) throw notFound('Permohonan perbelanjaan tidak dijumpai');

      return jsonSafe({ ...serialiseExpense(row), trail: await getTrail('expenses', id) });
    },
  );
}

type ExpenseRow = {
  id: number;
  requestNo: string;
  staffId: number;
  categoryId: number;
  incurredOn: Date;
  amount: unknown;
  approvedAmount: unknown;
  payee: string;
  description: string;
  receiptPath: string | null;
  status: string;
  currentLevel: number;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
  staff: {
    id: number;
    employeeNo: string;
    fullName: string;
    department: { name: string } | null;
  };
  category: { code: string; name: string };
};

/** As with claims, `receiptPath` stays on the server; `hasReceipt` is what the screen needs. */
function serialiseExpense(row: ExpenseRow): Record<string, unknown> {
  return {
    id: row.id,
    requestNo: row.requestNo,
    staffId: row.staffId,
    employeeNo: row.staff.employeeNo,
    staffName: row.staff.fullName,
    departmentName: row.staff.department?.name ?? null,
    categoryId: row.categoryId,
    categoryCode: row.category.code,
    categoryName: row.category.name,
    incurredOn: dateOnlyKey(row.incurredOn),
    amount: Number(row.amount),
    approvedAmount: Number(row.approvedAmount),
    payee: row.payee,
    description: row.description,
    hasReceipt: row.receiptPath !== null,
    status: row.status,
    currentLevel: row.currentLevel,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
  };
}
