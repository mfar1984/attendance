import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requirePermission } from '../auth/plugin.js';
import { db, jsonSafe } from '../db.js';
import { loadEnv } from '../env.js';
import { toSen } from '../hr/money.js';
import {
  PAYROLL_SETTING_DEFAULTS,
  PAYROLL_SETTING_KEYS,
  allowanceValue,
  checkStatutory,
  checkTransition,
  findOverlap,
  isRebuildable,
  isWritable,
  kpiBonusAmount,
  monthlyRecovery,
  parseStatutory,
  payslipBalances,
  type PayrollSettingKey,
} from '../hr/payroll.js';
import { runPeriod, payrollSettings } from '../hr/payroll-run.js';
import { moduleSettings, settingIsOn } from '../hr/approval.js';
import { conflict, notFound, parseBody } from '../http.js';
import { recordActivity } from '../logging/activity.js';
import { notify } from '../notify/dispatch.js';
import { parsePeriod } from '../reports/aggregate.js';
import { hours, sendCsv, toCsvRow } from '../reports/csv.js';
import { asDateOnly, dateOnlyKey } from '../time.js';

/**
 * Payroll: periods, payslips, and the five things that add to or subtract from one.
 *
 * The arithmetic is in `hr/payroll.ts`, the run is in `hr/payroll-run.ts`, and neither of them
 * counts an hour — `reports/aggregate.ts` does that, for the payroll export and for this run
 * alike. A payroll period that measured its own attendance would be a second engine, and the
 * failure mode is two answers about one month with nothing to say which is right.
 *
 * ## Statutory rates are unverified data
 *
 * They are seeded as editable rows flagged `ratesReviewed: '0'`, and every screen that shows a
 * figure derived from them says so until somebody clears the flag. SOCSO and EIS are modelled as
 * a percentage with a ceiling rather than the real wage-band table, and PCB is not computed at
 * all. Both are stated on the settings screen. Finance signs these off; this module does not.
 *
 * ## What each status permits
 *
 * `draft → processing → approved → paid → closed`, one way. A draft may be rebuilt as often as
 * needed, which is what makes a corrected terminal clock reachable. From `approved` the figures
 * are the record; a mistake found later is an adjustment in a following period, not a rewrite.
 * `closed` refuses every write, enforced here rather than in the interface — a lock that only
 * exists on screen is a lock against people using the screen.
 */
export async function payrollRoutes(app: FastifyInstance): Promise<void> {
  const timeZone = loadEnv().ORG_TIMEZONE;

  function idParam(params: unknown): number {
    const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
    if (!parsed.success) throw notFound('Rekod tidak dijumpai');
    return parsed.data.id;
  }

  const dateKey = z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarikh mesti dalam bentuk YYYY-MM-DD');

  /** The period row, or a 404. Loaded before every write so the status can be checked. */
  async function loadPeriod(id: number): Promise<{
    id: number;
    status: string;
    code: string;
    name: string;
    periodYear: number;
    periodMonth: number;
    fromDate: Date;
    toDate: Date;
    paymentDate: Date;
  }> {
    const row = await db().payrollPeriod.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        code: true,
        name: true,
        periodYear: true,
        periodMonth: true,
        fromDate: true,
        toDate: true,
        paymentDate: true,
      },
    });
    if (!row) throw notFound('Tempoh payroll tidak dijumpai');
    return row;
  }

  /**
   * Refuses a write against a period that has moved past editing.
   *
   * Called from the period routes and from every compensation route that names a period, because
   * a bonus added to an approved period would sit there unpaid and unexplained: the run that
   * would have collected it has already happened.
   */
  function assertWritable(period: { status: string; code: string }): void {
    if (!isWritable(period.status)) {
      throw conflict(
        `Tempoh ${period.code} sudah "${period.status}". Tempoh yang telah diluluskan tidak ` +
          'menerima perubahan — angkanya sudah ditandatangani. Buat pelarasan dalam tempoh ' +
          'berikutnya.',
      );
    }
  }

  function transitionOrThrow(from: string, to: 'processing' | 'approved' | 'paid' | 'closed'): void {
    const fault = checkTransition(from, to);
    if (fault === null) return;
    throw conflict(
      fault === 'pay.period.fault.status'
        ? `Status "${from}" tidak dikenali.`
        : `Tempoh berstatus "${from}" tidak boleh terus ke "${to}". Urutannya adalah draf → ` +
          'proses → lulus → bayar → tutup, tanpa jalan balik.',
    );
  }

  // -------------------------------------------------------------------------
  // Periods
  // -------------------------------------------------------------------------

  app.get(
    '/api/payroll/periods',
    { preHandler: requirePermission('hr.payrollPeriods', 'view') },
    async (request) => {
      const query = z
        .object({
          status: z.string().trim().max(16).optional(),
          year: z.coerce.number().int().min(2000).max(2100).optional(),
        })
        .parse(request.query);

      const rows = await db().payrollPeriod.findMany({
        where: {
          ...(query.status !== undefined && query.status !== ''
            ? { status: query.status }
            : {}),
          ...(query.year !== undefined ? { periodYear: query.year } : {}),
        },
        orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
        include: { _count: { select: { payslips: true } } },
      });

      const settings = await payrollSettings();

      return jsonSafe({
        rows: rows.map(({ _count, ...row }) => ({
          ...row,
          fromDate: dateOnlyKey(row.fromDate),
          toDate: dateOnlyKey(row.toDate),
          paymentDate: dateOnlyKey(row.paymentDate),
          payslipCount: _count.payslips,
        })),
        /**
         * Counts every status, ignoring the status filter.
         *
         * Otherwise picking a chip zeroes the others and the remaining rows look like they went
         * missing. A chip at zero is information; a button that goes nowhere is a trap.
         */
        counts: Object.fromEntries(
          (
            await db().payrollPeriod.groupBy({
              by: ['status'],
              where: query.year !== undefined ? { periodYear: query.year } : {},
              _count: { _all: true },
            })
          ).map((row) => [row.status, row._count._all]),
        ),
        /** So the list can carry the unverified-rates warning without a second request. */
        ratesReviewed:
          (settings.ratesReviewed ?? PAYROLL_SETTING_DEFAULTS.ratesReviewed) === '1',
        payDay: Number(settings.payDay ?? PAYROLL_SETTING_DEFAULTS.payDay),
        generatedAt: new Date().toISOString(),
      });
    },
  );

  const periodSchema = z.object({
    name: z.string().trim().min(1).max(120),
    periodYear: z.coerce.number().int().min(2000).max(2100),
    periodMonth: z.coerce.number().int().min(1).max(12),
    fromDate: dateKey,
    toDate: dateKey,
    paymentDate: dateKey,
    note: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
  });

  /**
   * Checks a proposed range against the ones already recorded.
   *
   * Overlap is the double-pay hazard, and it is invisible from either period alone: two cycles
   * covering one day each pick up that day's approved overtime, so it is paid twice, from two
   * payslips that both look correct on their own.
   */
  async function assertNoOverlap(
    range: { fromKey: string; toKey: string; id?: number },
  ): Promise<void> {
    const existing = await db().payrollPeriod.findMany({
      select: { id: true, code: true, fromDate: true, toDate: true },
    });
    const clash = findOverlap(
      range,
      existing.map((row) => ({
        id: row.id,
        fromKey: dateOnlyKey(row.fromDate),
        toKey: dateOnlyKey(row.toDate),
      })),
    );
    if (clash === null) return;
    const named = existing.find((row) => row.id === clash.id);
    throw conflict(
      `Tempoh ini bertindih dengan ${named?.code ?? 'tempoh lain'} ` +
        `(${clash.fromKey} – ${clash.toKey}). Hari yang berada dalam dua tempoh akan dibayar ` +
        'dua kali, daripada dua slip yang kedua-duanya kelihatan betul.',
    );
  }

  app.post(
    '/api/payroll/periods',
    { preHandler: requirePermission('hr.payrollPeriods', 'create') },
    async (request) => {
      const body = parseBody(periodSchema, request.body);

      // Validates the range and refuses a reversed or absurd one, with the same rules the
      // reporting period uses. One implementation of "what is a period".
      const range = parsePeriod(body.fromDate, body.toDate, timeZone);

      const code = `${String(body.periodYear)}-${String(body.periodMonth).padStart(2, '0')}`;
      const clash = await db().payrollPeriod.findUnique({ where: { code } });
      if (clash) throw conflict(`Tempoh ${code} sudah ada`);

      await assertNoOverlap({ fromKey: range.fromKey, toKey: range.toKey });

      const row = await db().payrollPeriod.create({
        data: {
          code,
          name: body.name,
          periodYear: body.periodYear,
          periodMonth: body.periodMonth,
          fromDate: range.from,
          toDate: range.to,
          paymentDate: asDateOnly(new Date(`${body.paymentDate}T00:00:00Z`)),
          note: body.note ? body.note : null,
        },
      });

      await recordActivity({
        request,
        action: 'payroll.period.created',
        category: 'settings',
        detail: `${code}: ${range.fromKey} – ${range.toKey}, bayar ${body.paymentDate}`,
      });

      return jsonSafe({ id: row.id, code: row.code });
    },
  );

  app.patch(
    '/api/payroll/periods/:id',
    { preHandler: requirePermission('hr.payrollPeriods', 'edit') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(periodSchema.partial(), request.body);
      const period = await loadPeriod(id);
      assertWritable(period);

      const fromKey = body.fromDate ?? dateOnlyKey(period.fromDate);
      const toKey = body.toDate ?? dateOnlyKey(period.toDate);
      const range = parsePeriod(fromKey, toKey, timeZone);
      await assertNoOverlap({ id, fromKey: range.fromKey, toKey: range.toKey });

      await db().payrollPeriod.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.fromDate !== undefined || body.toDate !== undefined
            ? { fromDate: range.from, toDate: range.to }
            : {}),
          ...(body.paymentDate !== undefined
            ? { paymentDate: asDateOnly(new Date(`${body.paymentDate}T00:00:00Z`)) }
            : {}),
          ...(body.note !== undefined ? { note: body.note ? body.note : null } : {}),
        },
      });

      await recordActivity({
        request,
        action: 'payroll.period.updated',
        category: 'settings',
        detail: `${period.code}: ${range.fromKey} – ${range.toKey}`,
      });

      return jsonSafe({ ok: true });
    },
  );

  app.delete(
    '/api/payroll/periods/:id',
    { preHandler: requirePermission('hr.payrollPeriods', 'delete') },
    async (request) => {
      const id = idParam(request.params);
      const period = await loadPeriod(id);

      /*
       * Only a draft can be removed, and a draft has no payslips worth keeping.
       *
       * Past `processing` the period has produced figures somebody may have read, and removing
       * it takes the payslips with it — cascade, silently. A period that has been approved is a
       * record of money leaving the building.
       */
      if (period.status !== 'draft') {
        throw conflict(
          `Tempoh ${period.code} berstatus "${period.status}" dan tidak boleh dibuang. ` +
            'Hanya draf boleh dibuang; selebihnya adalah rekod gaji yang sudah dikira.',
        );
      }

      await db().payrollPeriod.delete({ where: { id } });
      await recordActivity({
        request,
        action: 'payroll.period.removed',
        category: 'settings',
        detail: period.code,
      });
      return jsonSafe({ ok: true });
    },
  );

  /**
   * Builds every payslip in the period.
   *
   * Runnable as often as needed while the period is a draft, and each run discards the previous
   * payslips and the balance movements they caused. That is the point: fix the cause — a
   * terminal clock, an identity mapping, a missing salary — and run again.
   */
  app.post(
    '/api/payroll/periods/:id/process',
    { preHandler: requirePermission('hr.payrollPeriods', 'approve') },
    async (request) => {
      const id = idParam(request.params);
      const period = await loadPeriod(id);

      if (!isRebuildable(period.status)) {
        transitionOrThrow(period.status, 'processing');
      }

      const range = parsePeriod(
        dateOnlyKey(period.fromDate),
        dateOnlyKey(period.toDate),
        timeZone,
      );

      const result = await runPeriod({
        id: period.id,
        periodYear: period.periodYear,
        periodMonth: period.periodMonth,
        range,
      });

      await recordActivity({
        request,
        action: 'payroll.period.processed',
        category: 'settings',
        // A warning rather than routine information: this is the read that becomes money.
        level: result.withoutSalary > 0 ? 'warn' : 'info',
        detail:
          `${period.code}: ${String(result.staffCount)} slip, bersih RM` +
          `${result.totalNet.toFixed(2)}` +
          (result.withoutSalary > 0
            ? ` · ${String(result.withoutSalary)} staf tanpa gaji asas dilangkau`
            : ''),
      });

      return jsonSafe(result);
    },
  );

  const decisionSchema = z.object({
    note: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
  });

  app.post(
    '/api/payroll/periods/:id/approve',
    { preHandler: requirePermission('hr.payrollPeriods', 'approve') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(decisionSchema, request.body);
      const period = await loadPeriod(id);
      transitionOrThrow(period.status, 'approved');

      /*
       * Nothing is approved that does not add up.
       *
       * Prisma has no generated columns, so the only thing standing between a payslip whose
       * lines disagree with its total and somebody's bank account is this check. Refused here
       * rather than reported later: after approval the figures are the record.
       */
      const payslips = await db().payslip.findMany({
        where: { periodId: id },
        select: {
          id: true,
          payslipNo: true,
          basicSalary: true,
          allowanceAmount: true,
          overtimeAmount: true,
          bonusAmount: true,
          commissionAmount: true,
          gross: true,
          epfEmployee: true,
          socsoEmployee: true,
          eisEmployee: true,
          taxDeduction: true,
          loanDeduction: true,
          advanceDeduction: true,
          otherDeductions: true,
          totalDeductions: true,
          netPay: true,
        },
      });

      if (payslips.length === 0) {
        throw conflict(
          `Tempoh ${period.code} tiada slip gaji. Jalankan proses dahulu.`,
        );
      }

      const broken = payslips
        .map((row) => ({
          payslipNo: row.payslipNo,
          fault: payslipBalances({
            basicSalary: Number(row.basicSalary),
            allowanceAmount: Number(row.allowanceAmount),
            overtimeAmount: Number(row.overtimeAmount),
            bonusAmount: Number(row.bonusAmount),
            commissionAmount: Number(row.commissionAmount),
            gross: Number(row.gross),
            epfEmployee: Number(row.epfEmployee),
            socsoEmployee: Number(row.socsoEmployee),
            eisEmployee: Number(row.eisEmployee),
            taxDeduction: Number(row.taxDeduction),
            loanDeduction: Number(row.loanDeduction),
            advanceDeduction: Number(row.advanceDeduction),
            otherDeductions: Number(row.otherDeductions),
            totalDeductions: Number(row.totalDeductions),
            netPay: Number(row.netPay),
          }),
        }))
        .filter((row) => row.fault !== null);

      if (broken.length > 0) {
        throw conflict(
          `${String(broken.length)} slip gaji tidak seimbang (contohnya ` +
            `${broken[0]?.payslipNo ?? '?'}). Baris pada slip tidak berjumlah kepada angka ` +
            'bersihnya, jadi tiada satu pun boleh diluluskan. Jalankan proses semula.',
        );
      }

      await db().$transaction(async (tx) => {
        await tx.payrollPeriod.update({
          where: { id },
          data: {
            status: 'approved',
            approvedBy: request.user?.accountId ?? null,
            approvedAt: new Date(),
            ...(body.note ? { note: body.note } : {}),
          },
        });
        await tx.payslip.updateMany({
          where: { periodId: id, status: 'draft' },
          data: { status: 'approved' },
        });
      });

      await recordActivity({
        request,
        action: 'payroll.period.approved',
        category: 'settings',
        detail: `${period.code}: ${String(payslips.length)} slip`,
      });

      return jsonSafe({ ok: true, payslipCount: payslips.length });
    },
  );

  app.post(
    '/api/payroll/periods/:id/pay',
    { preHandler: requirePermission('hr.payrollPeriods', 'approve') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(
        z.object({
          paymentMethod: z.enum(['bank_transfer', 'cash', 'cheque']),
          paymentReference: z.string().trim().min(1).max(120),
          note: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
        }),
        request.body,
      );
      const period = await loadPeriod(id);
      transitionOrThrow(period.status, 'paid');

      await db().$transaction(async (tx) => {
        await tx.payrollPeriod.update({
          where: { id },
          data: {
            status: 'paid',
            paidBy: request.user?.accountId ?? null,
            paidAt: new Date(),
            paymentMethod: body.paymentMethod,
            /*
             * Its own column, not appended to the note.
             *
             * The reference kept the bank reference inside free text and then could not find it
             * again without parsing prose. A reference is what reconciles a bulk transfer against
             * the payslips it covered; it has to be queryable.
             */
            paymentReference: body.paymentReference,
            ...(body.note ? { note: body.note } : {}),
          },
        });
        await tx.payslip.updateMany({
          where: { periodId: id, status: 'approved' },
          data: { status: 'paid' },
        });
        // Bonuses and commissions the period paid follow it, so the compensation screens stop
        // offering them for a second period.
        await tx.staffBonus.updateMany({
          where: { periodId: id, status: 'approved' },
          data: { status: 'paid' },
        });
        await tx.staffCommission.updateMany({
          where: { periodId: id, status: 'approved' },
          data: { status: 'paid' },
        });
      });

      /*
       * Everybody paid is told, one message each.
       *
       * Fired here and not on approval: approval moves no money. The figure in the message is the
       * net, because that is what reached the bank — the twenty lines behind it are on the payslip,
       * and email is not where somebody reconciles them.
       *
       * `notify` is fire-and-forget and never throws. A gateway that cannot be reached must not
       * turn a period that has been paid into a request that appears to have failed.
       */
      const settings = await moduleSettings('payroll');
      if (settingIsOn(settings, 'notifyApplicant')) {
        const paid = await db().payslip.findMany({
          where: { periodId: id },
          select: {
            payslipNo: true,
            gross: true,
            totalDeductions: true,
            netPay: true,
            staff: { select: { fullName: true, employeeNo: true, email: true, phone: true } },
          },
        });

        for (const slip of paid) {
          notify({
            trigger: 'payroll.paid',
            mobile: slip.staff.phone,
            summary:
              `Gaji ${period.name} sudah dibayar. Bersih RM ${Number(slip.netPay).toFixed(2)}.`,
            lines: [`Slip: ${slip.payslipNo}`, `Tarikh bayar: ${dateOnlyKey(period.paymentDate)}`],
            email: {
              module: 'payroll',
              event: 'payslipReady',
              to: slip.staff.email,
              vars: {
                staffName: slip.staff.fullName,
                employeeNo: slip.staff.employeeNo,
                requestNo: slip.payslipNo,
                status: 'paid',
                decidedBy: request.user?.fullName ?? null,
                note: body.note ?? null,
                periodCode: period.code,
                periodName: period.name,
                paymentDate: dateOnlyKey(period.paymentDate),
                payslipNo: slip.payslipNo,
                gross: Number(slip.gross).toFixed(2),
                deductions: Number(slip.totalDeductions).toFixed(2),
                netPay: Number(slip.netPay).toFixed(2),
              },
            },
          });
        }
      }

      await recordActivity({
        request,
        action: 'payroll.period.paid',
        category: 'settings',
        detail: `${period.code} · ${body.paymentMethod} · ${body.paymentReference}`,
      });

      return jsonSafe({ ok: true });
    },
  );

  app.post(
    '/api/payroll/periods/:id/close',
    { preHandler: requirePermission('hr.payrollPeriods', 'approve') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(decisionSchema, request.body);
      const period = await loadPeriod(id);
      transitionOrThrow(period.status, 'closed');

      await db().payrollPeriod.update({
        where: { id },
        data: {
          status: 'closed',
          closedBy: request.user?.accountId ?? null,
          closedAt: new Date(),
          ...(body.note ? { note: body.note } : {}),
        },
      });

      await recordActivity({
        request,
        action: 'payroll.period.closed',
        category: 'settings',
        detail: `${period.code} dikunci untuk audit`,
      });

      return jsonSafe({ ok: true });
    },
  );

  // -------------------------------------------------------------------------
  // Payslips
  // -------------------------------------------------------------------------

  app.get(
    '/api/payroll/periods/:id/payslips',
    { preHandler: requirePermission('hr.payrollPeriods', 'view') },
    async (request) => {
      const id = idParam(request.params);
      const query = z
        .object({
          page: z.coerce.number().int().positive().default(1),
          pageSize: z.coerce.number().int().min(10).max(200).default(50),
          search: z.string().trim().max(128).optional(),
          departmentId: z.coerce.number().int().positive().optional(),
        })
        .parse(request.query);

      const period = await loadPeriod(id);

      const where = {
        periodId: id,
        ...(query.search || query.departmentId !== undefined
          ? {
              staff: {
                ...(query.departmentId !== undefined
                  ? { departmentId: query.departmentId }
                  : {}),
                ...(query.search
                  ? {
                      OR: [
                        { fullName: { contains: query.search } },
                        { employeeNo: { contains: query.search } },
                      ],
                    }
                  : {}),
              },
            }
          : {}),
      };

      const [total, rows] = await Promise.all([
        db().payslip.count({ where }),
        db().payslip.findMany({
          where,
          orderBy: [{ payslipNo: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            staff: {
              select: {
                employeeNo: true,
                fullName: true,
                department: { select: { name: true } },
              },
            },
          },
        }),
      ]);

      return jsonSafe({
        period: {
          ...period,
          fromDate: dateOnlyKey(period.fromDate),
          toDate: dateOnlyKey(period.toDate),
        },
        rows: rows.map((row) => ({
          id: row.id,
          payslipNo: row.payslipNo,
          employeeNo: row.staff.employeeNo,
          fullName: row.staff.fullName,
          department: row.staff.department?.name ?? null,
          basicSalary: Number(row.basicSalary),
          allowanceAmount: Number(row.allowanceAmount),
          overtimeAmount: Number(row.overtimeAmount),
          bonusAmount: Number(row.bonusAmount),
          commissionAmount: Number(row.commissionAmount),
          gross: Number(row.gross),
          totalDeductions: Number(row.totalDeductions),
          netPay: Number(row.netPay),
          status: row.status,
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
        generatedAt: new Date().toISOString(),
      });
    },
  );

  app.get(
    '/api/payroll/payslips/:id',
    { preHandler: requirePermission('hr.payrollPeriods', 'view') },
    async (request) => {
      const id = idParam(request.params);
      const row = await db().payslip.findUnique({
        where: { id },
        include: {
          lines: { orderBy: { sortOrder: 'asc' } },
          period: { select: { code: true, name: true, status: true, paymentDate: true } },
          staff: {
            select: {
              employeeNo: true,
              fullName: true,
              icNo: true,
              department: { select: { name: true } },
            },
          },
        },
      });
      if (!row) throw notFound('Slip gaji tidak dijumpai');

      return jsonSafe({
        ...row,
        period: { ...row.period, paymentDate: dateOnlyKey(row.period.paymentDate) },
        lines: row.lines.map((line) => ({ ...line, amount: Number(line.amount) })),
        /** Named here so the screen can show the check rather than assume it passed. */
        balanceFault: payslipBalances({
          basicSalary: Number(row.basicSalary),
          allowanceAmount: Number(row.allowanceAmount),
          overtimeAmount: Number(row.overtimeAmount),
          bonusAmount: Number(row.bonusAmount),
          commissionAmount: Number(row.commissionAmount),
          gross: Number(row.gross),
          epfEmployee: Number(row.epfEmployee),
          socsoEmployee: Number(row.socsoEmployee),
          eisEmployee: Number(row.eisEmployee),
          taxDeduction: Number(row.taxDeduction),
          loanDeduction: Number(row.loanDeduction),
          advanceDeduction: Number(row.advanceDeduction),
          otherDeductions: Number(row.otherDeductions),
          totalDeductions: Number(row.totalDeductions),
          netPay: Number(row.netPay),
        }),
      });
    },
  );

  /**
   * PCB and any other one-off deduction, entered per payslip.
   *
   * PCB is the reason this route exists. It depends on somebody's declared reliefs, marital
   * status and dependants under the LHDN schedule, so the run leaves it at zero rather than
   * guessing — a guess under-deducts and the employee gets the bill at assessment.
   *
   * Only while the period is still editable, and the totals are rewritten from the same
   * arithmetic the run used so the payslip stays balanced.
   */
  app.patch(
    '/api/payroll/payslips/:id',
    { preHandler: requirePermission('hr.payrollPeriods', 'edit') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(
        z.object({
          taxDeduction: z.coerce.number().min(0).max(1_000_000).optional(),
          otherDeductions: z.coerce.number().min(0).max(1_000_000).optional(),
          note: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
        }),
        request.body,
      );

      const row = await db().payslip.findUnique({
        where: { id },
        include: { period: { select: { id: true, code: true, status: true } } },
      });
      if (!row) throw notFound('Slip gaji tidak dijumpai');
      assertWritable(row.period);

      const taxDeduction = toSen(body.taxDeduction ?? Number(row.taxDeduction));
      const otherDeductions = toSen(body.otherDeductions ?? Number(row.otherDeductions));

      const totalDeductions = toSen(
        Number(row.epfEmployee) +
          Number(row.socsoEmployee) +
          Number(row.eisEmployee) +
          taxDeduction +
          Number(row.loanDeduction) +
          Number(row.advanceDeduction) +
          otherDeductions,
      );

      await db().$transaction(async (tx) => {
        await tx.payslip.update({
          where: { id },
          data: {
            taxDeduction,
            otherDeductions,
            totalDeductions,
            netPay: toSen(Number(row.gross) - totalDeductions),
            ...(body.note !== undefined ? { note: body.note ? body.note : null } : {}),
          },
        });

        // The lines follow the figures. A payslip whose lines do not name a deduction it
        // carries is a payslip nobody can answer a question about.
        await tx.payslipLine.deleteMany({
          where: { payslipId: id, source: { in: ['tax', 'other'] } },
        });
        const extra: Array<{ source: string; label: string; amount: number }> = [];
        if (taxDeduction > 0) extra.push({ source: 'tax', label: 'PCB', amount: taxDeduction });
        if (otherDeductions > 0) {
          extra.push({ source: 'other', label: 'Potongan lain', amount: otherDeductions });
        }
        for (const [index, line] of extra.entries()) {
          await tx.payslipLine.create({
            data: {
              payslipId: id,
              kind: 'deduction',
              source: line.source,
              sourceId: null,
              label: line.label,
              amount: line.amount,
              sortOrder: 900 + index,
            },
          });
        }

        // The period totals are the sum of its payslips, recomputed rather than nudged: a
        // running adjustment drifts, and the drift only shows up as a period that does not
        // match the file exported from it.
        const sums = await tx.payslip.aggregate({
          where: { periodId: row.period.id },
          _sum: { gross: true, totalDeductions: true, netPay: true },
        });
        await tx.payrollPeriod.update({
          where: { id: row.period.id },
          data: {
            totalGross: toSen(Number(sums._sum.gross ?? 0)),
            totalDeductions: toSen(Number(sums._sum.totalDeductions ?? 0)),
            totalNet: toSen(Number(sums._sum.netPay ?? 0)),
          },
        });
      });

      await recordActivity({
        request,
        action: 'payroll.payslip.updated',
        category: 'settings',
        detail: `${row.payslipNo}: PCB RM${taxDeduction.toFixed(2)}, lain RM${otherDeductions.toFixed(2)}`,
      });

      return jsonSafe({ ok: true });
    },
  );

  app.get(
    '/api/payroll/periods/:id/export',
    { preHandler: requirePermission('hr.payrollPeriods', 'export') },
    async (request, reply) => {
      const id = idParam(request.params);
      const period = await loadPeriod(id);

      const rows = await db().payslip.findMany({
        where: { periodId: id },
        orderBy: [{ payslipNo: 'asc' }],
        include: {
          staff: {
            select: {
              employeeNo: true,
              fullName: true,
              icNo: true,
              department: { select: { name: true } },
            },
          },
        },
      });

      const settings = await payrollSettings();
      const reviewed = (settings.ratesReviewed ?? PAYROLL_SETTING_DEFAULTS.ratesReviewed) === '1';

      const headers = [
        'No. Slip',
        'No. Staf',
        'Nama',
        'No. KP',
        'Jabatan',
        'Gaji asas',
        'Elaun',
        'Lebih masa',
        'Bonus',
        'Komisen',
        'Gaji kasar',
        'KWSP (pekerja)',
        'PERKESO (pekerja)',
        'SIP (pekerja)',
        'PCB',
        'Pinjaman',
        'Pendahuluan',
        'Potongan lain',
        'Jumlah potongan',
        'Gaji bersih',
        'KWSP (majikan)',
        'PERKESO (majikan)',
        'SIP (majikan)',
        'Hari dijadualkan',
        'Hari hadir',
        'Hari tidak hadir',
        'Jam lebih masa diluluskan',
        'Status',
      ];

      const body = rows.map((row) => [
        row.payslipNo,
        row.staff.employeeNo,
        row.staff.fullName,
        row.staff.icNo ?? '',
        row.staff.department?.name ?? '',
        Number(row.basicSalary).toFixed(2),
        Number(row.allowanceAmount).toFixed(2),
        Number(row.overtimeAmount).toFixed(2),
        Number(row.bonusAmount).toFixed(2),
        Number(row.commissionAmount).toFixed(2),
        Number(row.gross).toFixed(2),
        Number(row.epfEmployee).toFixed(2),
        Number(row.socsoEmployee).toFixed(2),
        Number(row.eisEmployee).toFixed(2),
        Number(row.taxDeduction).toFixed(2),
        Number(row.loanDeduction).toFixed(2),
        Number(row.advanceDeduction).toFixed(2),
        Number(row.otherDeductions).toFixed(2),
        Number(row.totalDeductions).toFixed(2),
        Number(row.netPay).toFixed(2),
        Number(row.epfEmployer).toFixed(2),
        Number(row.socsoEmployer).toFixed(2),
        Number(row.eisEmployer).toFixed(2),
        String(row.scheduledDays),
        String(row.presentDays),
        String(row.absentDays),
        hours(row.overtimeMinutes),
        row.status,
      ]);

      /**
       * The caveats travel inside the file, not only on the screen that produced it.
       *
       * A spreadsheet gets forwarded, and whoever opens it next did not see the banner. The
       * unverified-rates line is the one that matters most: a statutory figure nobody checked
       * looks identical to one finance signed off.
       */
      const preamble = [
        `# Payroll ${period.code} — ${period.name}`,
        `# ${dateOnlyKey(period.fromDate)} hingga ${dateOnlyKey(period.toDate)} · status ${period.status}`,
        `# Dijana ${new Date().toISOString()} · zon waktu ${timeZone} · ${String(rows.length)} slip`,
        reviewed
          ? '# Kadar statutori telah disemak dan disahkan.'
          : '# AMARAN: kadar statutori (KWSP/PERKESO/SIP) BELUM disahkan terhadap jadual ' +
            'semasa. Setiap potongan dalam fail ini dikira daripada nilai lalai yang perlu ' +
            'disemak oleh bahagian kewangan.',
        '# NOTA: PERKESO dan SIP dikira sebagai peratusan bersiling, bukan jadual jalur upah ' +
          'PERKESO yang sebenar. Angka ini tidak akan sepadan sen-ke-sen dengan penyata PERKESO.',
        '# NOTA: PCB tidak dikira oleh sistem. Ia dimasukkan sendiri pada setiap slip.',
        '#',
      ];

      await recordActivity({
        request,
        action: 'payroll.period.exported',
        category: 'settings',
        level: reviewed ? 'info' : 'warn',
        detail: `${period.code}: ${String(rows.length)} slip${reviewed ? '' : ' · kadar belum disemak'}`,
      });

      return sendCsv(
        reply,
        `payroll-${period.code}`,
        [...preamble, toCsvRow(headers), ...body.map(toCsvRow)].join('\r\n'),
      );
    },
  );

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  app.get(
    '/api/payroll/settings',
    { preHandler: requirePermission('hr.payrollSettings', 'view') },
    async () => {
      const stored = await payrollSettings();
      const settings: Record<string, string> = { ...PAYROLL_SETTING_DEFAULTS };
      for (const key of PAYROLL_SETTING_KEYS) {
        const value = stored[key];
        if (value !== undefined) settings[key] = value;
      }

      return jsonSafe({
        settings,
        /** Parsed the way a run will read them, so the screen shows what will be applied. */
        rates: parseStatutory(stored),
        /**
         * Every caveat, as label keys the screen resolves.
         *
         * Sent from here rather than written into the page so a caveat cannot be true of the
         * engine and absent from the interface. These are approximations somebody has to know
         * about before signing a period, not footnotes.
         */
        caveatKeys: [
          'pay.settings.caveat.unverified',
          'pay.settings.caveat.socsoBands',
          'pay.settings.caveat.pcb',
        ],
      });
    },
  );

  app.put(
    '/api/payroll/settings',
    { preHandler: requirePermission('hr.payrollSettings', 'edit') },
    async (request) => {
      const body = parseBody(
        z.object({
          settings: z.record(z.string().trim().max(48), z.string().trim().max(500)),
        }),
        request.body,
      );

      const updates: Array<{ key: PayrollSettingKey; value: string }> = [];
      for (const key of PAYROLL_SETTING_KEYS) {
        const value = body.settings[key];
        if (value !== undefined) updates.push({ key, value });
      }
      if (updates.length === 0) throw conflict('Tiada tetapan untuk disimpan');

      /*
       * Refusal, not silent clamping.
       *
       * A rate quietly corrected to a bound leaves the screen showing one number and the run
       * applying another, and nobody finds out until a payslip cannot be reproduced.
       */
      const faults = checkStatutory(Object.fromEntries(updates.map((row) => [row.key, row.value])));
      if (Object.keys(faults).length > 0) {
        throw conflict(faultMessage(faults));
      }

      for (const update of updates) {
        await db().hrModuleSetting.upsert({
          where: { module_key: { module: 'payroll', key: update.key } },
          create: {
            module: 'payroll',
            key: update.key,
            value: update.value,
            updatedBy: request.user?.accountId ?? null,
          },
          update: { value: update.value, updatedBy: request.user?.accountId ?? null },
        });
      }

      const reviewed = updates.find((row) => row.key === 'ratesReviewed');
      await recordActivity({
        request,
        action: 'payroll.settings.updated',
        category: 'settings',
        // Confirming the rates is the entry somebody will look for later, so it is a warning
        // level event: it is the moment the figures stopped being defaults.
        level: reviewed?.value === '1' ? 'warn' : 'info',
        detail:
          `${String(updates.length)} tetapan` +
          (reviewed?.value === '1' ? ' · kadar statutori ditanda sudah disemak' : ''),
      });

      return jsonSafe({ ok: true });
    },
  );

  function faultMessage(faults: Record<string, string>): string {
    const first = Object.entries(faults)[0];
    if (!first) return 'Tetapan tidak sah';
    const [field, key] = first;
    switch (key) {
      case 'pay.settings.fault.percent':
        return `${field}: kadar mesti antara 0 dan 100.`;
      case 'pay.settings.fault.amount':
        return `${field}: amaun mesti antara 0 dan 1,000,000.`;
      case 'pay.settings.fault.payDay':
        return 'Hari bayaran mesti hari dalam bulan, 1 hingga 31.';
      case 'pay.settings.fault.step':
        return (
          'Kadar majikan di atas ambang tidak boleh melebihi kadar di bawahnya. Langkah ' +
          'statutori pada ambang itu turun, bukan naik — dimasukkan terbalik ia menyumbang ' +
          'lebih bagi setiap pekerja senior, setiap bulan.'
        );
      default:
        return 'Tetapan tidak sah';
    }
  }

  await compensationRoutes(app, { idParam, dateKey, loadPeriod, assertWritable });
}

// ---------------------------------------------------------------------------
// Allowances, bonuses, commissions, loans and advances
//
// Five screens, five permission keys. Split rather than one `hr.payroll` grant because they are
// not degrees of the same secret: somebody preparing allowances has no reason to read what a
// colleague still owes on a loan, and one key would hand them both together.
// ---------------------------------------------------------------------------

interface Shared {
  idParam: (params: unknown) => number;
  dateKey: z.ZodString;
  loadPeriod: (id: number) => Promise<{ id: number; status: string; code: string }>;
  assertWritable: (period: { status: string; code: string }) => void;
}

async function compensationRoutes(app: FastifyInstance, shared: Shared): Promise<void> {
  const { idParam, dateKey, loadPeriod, assertWritable } = shared;

  const toDateOnly = (key: string): Date => asDateOnly(new Date(`${key}T00:00:00Z`));

  /** `<PREFIX>-YYYYMM-NNN`, sequence read inside the transaction that writes the row. */
  async function nextNumber(
    prefix: string,
    yearMonth: string,
    existing: string[],
  ): Promise<string> {
    const highest = existing.reduce((max, value) => {
      const match = new RegExp(`^${prefix}-\\d{6}-(\\d+)$`).exec(value);
      const sequence = match?.[1] === undefined ? 0 : Number(match[1]);
      return Number.isInteger(sequence) ? Math.max(max, sequence) : max;
    }, 0);
    return `${prefix}-${yearMonth}-${String(highest + 1).padStart(3, '0')}`;
  }

  function yearMonthOf(date: Date): string {
    return `${String(date.getUTCFullYear())}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  // ── Allowance types ──

  app.get(
    '/api/payroll/allowance-types',
    { preHandler: requirePermission('hr.allowances', 'view') },
    async () => {
      const rows = await db().allowanceType.findMany({
        orderBy: [{ active: 'desc' }, { code: 'asc' }],
        include: { _count: { select: { allowances: true } } },
      });
      return jsonSafe(
        rows.map(({ _count, ...row }) => ({
          ...row,
          defaultAmount: row.defaultAmount === null ? null : Number(row.defaultAmount),
          usageCount: _count.allowances,
        })),
      );
    },
  );

  const typeSchema = z.object({
    code: z.string().trim().min(1).max(24),
    name: z.string().trim().min(1).max(120),
    description: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
    calcMode: z.enum(['fixed', 'percentOfBasic']),
    defaultAmount: z.union([z.coerce.number().min(0).max(1_000_000), z.null()]).optional(),
    epfLiable: z.boolean().optional(),
    taxable: z.boolean().optional(),
    active: z.boolean().optional(),
  });

  app.post(
    '/api/payroll/allowance-types',
    { preHandler: requirePermission('hr.allowances', 'create') },
    async (request) => {
      const body = parseBody(typeSchema, request.body);
      const code = body.code.toUpperCase();

      const clash = await db().allowanceType.findUnique({ where: { code } });
      if (clash) throw conflict(`Kod elaun "${code}" sudah ada`);

      const row = await db().allowanceType.create({
        data: {
          code,
          name: body.name,
          description: body.description ? body.description : null,
          calcMode: body.calcMode,
          defaultAmount: body.defaultAmount ?? null,
          epfLiable: body.epfLiable ?? true,
          taxable: body.taxable ?? true,
          active: body.active ?? true,
        },
      });

      await recordActivity({
        request,
        action: 'payroll.allowanceType.created',
        category: 'settings',
        detail: `${code}: ${body.name} (${body.calcMode})`,
      });
      return jsonSafe({ id: row.id, code: row.code });
    },
  );

  app.patch(
    '/api/payroll/allowance-types/:id',
    { preHandler: requirePermission('hr.allowances', 'edit') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(typeSchema.partial(), request.body);

      const existing = await db().allowanceType.findUnique({
        where: { id },
        include: { _count: { select: { allowances: true } } },
      });
      if (!existing) throw notFound('Jenis elaun tidak dijumpai');

      /*
       * A type in use is frozen in the ways that would reprice what somebody is already paid.
       *
       * `calcMode` and `epfLiable` are exactly those: flipping fixed to percentage turns RM500
       * into 500% of basic, and flipping `epfLiable` changes the statutory base of every payslip
       * built from it. Renaming is fine; repricing is not.
       */
      const inUse = existing._count.allowances > 0;
      if (inUse && (body.calcMode !== undefined || body.epfLiable !== undefined)) {
        throw conflict(
          `${String(existing._count.allowances)} elaun staf menggunakan jenis ini. Cara kiraan ` +
            'dan status KWSP tidak boleh diubah — ia akan menukar amaun yang sudah dibayar. ' +
            'Nyahaktifkan jenis ini dan cipta yang baharu.',
        );
      }

      await db().allowanceType.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined
            ? { description: body.description ? body.description : null }
            : {}),
          ...(body.calcMode !== undefined ? { calcMode: body.calcMode } : {}),
          ...(body.defaultAmount !== undefined ? { defaultAmount: body.defaultAmount } : {}),
          ...(body.epfLiable !== undefined ? { epfLiable: body.epfLiable } : {}),
          ...(body.taxable !== undefined ? { taxable: body.taxable } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        },
      });

      await recordActivity({
        request,
        action: 'payroll.allowanceType.updated',
        category: 'settings',
        detail: existing.code,
      });
      return jsonSafe({ ok: true });
    },
  );

  app.delete(
    '/api/payroll/allowance-types/:id',
    { preHandler: requirePermission('hr.allowances', 'delete') },
    async (request) => {
      const id = idParam(request.params);
      const existing = await db().allowanceType.findUnique({
        where: { id },
        include: { _count: { select: { allowances: true } } },
      });
      if (!existing) throw notFound('Jenis elaun tidak dijumpai');

      // Deactivated, not deleted, once it has history: a payslip already paid names the
      // allowance it paid, and that name has to keep existing.
      if (existing._count.allowances > 0) {
        throw conflict(
          `${String(existing._count.allowances)} elaun staf menggunakan jenis ini. ` +
            'Nyahaktifkan ia — slip gaji yang sudah dibayar masih menamakan elaun ini.',
        );
      }

      await db().allowanceType.delete({ where: { id } });
      await recordActivity({
        request,
        action: 'payroll.allowanceType.removed',
        category: 'settings',
        detail: existing.code,
      });
      return jsonSafe({ ok: true });
    },
  );

  // ── Staff allowances ──

  app.get(
    '/api/payroll/allowances',
    { preHandler: requirePermission('hr.allowances', 'view') },
    async (request) => {
      const query = z
        .object({
          page: z.coerce.number().int().positive().default(1),
          pageSize: z.coerce.number().int().min(10).max(200).default(50),
          search: z.string().trim().max(128).optional(),
          typeId: z.coerce.number().int().positive().optional(),
          active: z.enum(['1', '0']).optional(),
        })
        .parse(request.query);

      const where = {
        ...(query.active !== undefined ? { active: query.active === '1' } : {}),
        ...(query.typeId !== undefined ? { typeId: query.typeId } : {}),
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

      const [total, rows, counts] = await Promise.all([
        db().staffAllowance.count({ where }),
        db().staffAllowance.findMany({
          where,
          orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            staff: { select: { employeeNo: true, fullName: true, basicSalary: true } },
            type: { select: { code: true, name: true, calcMode: true, epfLiable: true } },
          },
        }),
        db().staffAllowance.groupBy({ by: ['active'], _count: { _all: true } }),
      ]);

      return jsonSafe({
        rows: rows.map((row) => ({
          id: row.id,
          staffId: row.staffId,
          employeeNo: row.staff.employeeNo,
          fullName: row.staff.fullName,
          typeCode: row.type.code,
          typeName: row.type.name,
          calcMode: row.type.calcMode,
          epfLiable: row.type.epfLiable,
          value: Number(row.value),
          /** What the run will actually pay, so a percentage is not read as ringgit. */
          resolved: allowanceValue(
            row.type.calcMode,
            Number(row.value),
            row.staff.basicSalary === null ? 0 : Number(row.staff.basicSalary),
          ),
          effectiveFrom: dateOnlyKey(row.effectiveFrom),
          effectiveTo: row.effectiveTo === null ? null : dateOnlyKey(row.effectiveTo),
          active: row.active,
          note: row.note,
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
        counts: Object.fromEntries(
          counts.map((row) => [row.active ? 'active' : 'inactive', row._count._all]),
        ),
        generatedAt: new Date().toISOString(),
      });
    },
  );

  const allowanceSchema = z.object({
    staffId: z.coerce.number().int().positive(),
    typeId: z.coerce.number().int().positive(),
    value: z.coerce.number().positive().max(1_000_000),
    effectiveFrom: dateKey,
    effectiveTo: z.union([dateKey, z.null()]).optional(),
    active: z.boolean().optional(),
    note: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
  });

  app.post(
    '/api/payroll/allowances',
    { preHandler: requirePermission('hr.allowances', 'create') },
    async (request) => {
      const body = parseBody(allowanceSchema, request.body);

      const [staff, type] = await Promise.all([
        db().staff.findUnique({ where: { id: body.staffId }, select: { fullName: true } }),
        db().allowanceType.findUnique({
          where: { id: body.typeId },
          select: { code: true, active: true, calcMode: true },
        }),
      ]);
      if (!staff) throw notFound('Staf tidak dijumpai');
      if (!type) throw notFound('Jenis elaun tidak dijumpai');
      if (!type.active) throw conflict(`Jenis elaun ${type.code} tidak aktif`);

      // A percentage above 100 of basic salary is a typo, not a policy.
      if (type.calcMode === 'percentOfBasic' && body.value > 100) {
        throw conflict('Elaun berkadar tidak boleh melebihi 100% gaji asas.');
      }

      const from = toDateOnly(body.effectiveFrom);
      const to = body.effectiveTo == null ? null : toDateOnly(body.effectiveTo);
      if (to !== null && to < from) {
        throw conflict('Tarikh tamat tidak boleh sebelum tarikh mula.');
      }

      const row = await db().staffAllowance.create({
        data: {
          staffId: body.staffId,
          typeId: body.typeId,
          value: body.value,
          effectiveFrom: from,
          effectiveTo: to,
          active: body.active ?? true,
          note: body.note ? body.note : null,
          createdBy: request.user?.accountId ?? null,
        },
      });

      await recordActivity({
        request,
        action: 'payroll.allowance.created',
        category: 'settings',
        detail: `${staff.fullName}: ${type.code} ${String(body.value)} dari ${body.effectiveFrom}`,
      });
      return jsonSafe({ id: row.id });
    },
  );

  app.patch(
    '/api/payroll/allowances/:id',
    { preHandler: requirePermission('hr.allowances', 'edit') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(allowanceSchema.partial().omit({ staffId: true, typeId: true }), request.body);

      const existing = await db().staffAllowance.findUnique({
        where: { id },
        include: { staff: { select: { fullName: true } }, type: { select: { code: true } } },
      });
      if (!existing) throw notFound('Elaun tidak dijumpai');

      await db().staffAllowance.update({
        where: { id },
        data: {
          ...(body.value !== undefined ? { value: body.value } : {}),
          ...(body.effectiveFrom !== undefined
            ? { effectiveFrom: toDateOnly(body.effectiveFrom) }
            : {}),
          ...(body.effectiveTo !== undefined
            ? { effectiveTo: body.effectiveTo == null ? null : toDateOnly(body.effectiveTo) }
            : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
          ...(body.note !== undefined ? { note: body.note ? body.note : null } : {}),
        },
      });

      await recordActivity({
        request,
        action: 'payroll.allowance.updated',
        category: 'settings',
        detail: `${existing.staff.fullName}: ${existing.type.code}`,
      });
      return jsonSafe({ ok: true });
    },
  );

  app.delete(
    '/api/payroll/allowances/:id',
    { preHandler: requirePermission('hr.allowances', 'delete') },
    async (request) => {
      const id = idParam(request.params);
      const existing = await db().staffAllowance.findUnique({
        where: { id },
        include: { staff: { select: { fullName: true } }, type: { select: { code: true } } },
      });
      if (!existing) throw notFound('Elaun tidak dijumpai');

      await db().staffAllowance.delete({ where: { id } });
      await recordActivity({
        request,
        action: 'payroll.allowance.removed',
        category: 'settings',
        detail: `${existing.staff.fullName}: ${existing.type.code}`,
      });
      return jsonSafe({ ok: true });
    },
  );

  // ── Bonuses and commissions ──
  //
  // The same shape twice, deliberately not one endpoint with a `kind` parameter. They carry
  // separate permission keys, so a single route would have to choose which key to check and
  // whichever it chose would grant the other one for free.

  /**
   * Builds the list, create, edit, approve and delete routes for a one-off award.
   *
   * Shared because a bonus and a commission differ only in the words on them. What is not shared
   * is the permission: each set is registered under its own screen key.
   */
  function awardRoutes(config: {
    screen: 'hr.bonuses' | 'hr.commissions';
    path: string;
    prefix: string;
    kinds: readonly [string, ...string[]];
    /** `bonus` reads `staffBonus`, `commission` reads `staffCommission`. */
    entity: 'bonus' | 'commission';
  }): void {
    const isBonus = config.entity === 'bonus';
    const numberField = isBonus ? 'bonusNo' : 'commissionNo';
    const typeField = isBonus ? 'bonusType' : 'commissionType';
    const dateField = isBonus ? 'awardedOn' : 'earnedOn';

    app.get(
      `/api/payroll/${config.path}`,
      { preHandler: requirePermission(config.screen, 'view') },
      async (request) => {
        const query = z
          .object({
            page: z.coerce.number().int().positive().default(1),
            pageSize: z.coerce.number().int().min(10).max(200).default(50),
            search: z.string().trim().max(128).optional(),
            status: z.string().trim().max(16).optional(),
            periodId: z.coerce.number().int().positive().optional(),
          })
          .parse(request.query);

        const where = {
          ...(query.status !== undefined && query.status !== '' ? { status: query.status } : {}),
          ...(query.periodId !== undefined ? { periodId: query.periodId } : {}),
          ...(query.search
            ? {
                OR: [
                  { staff: { fullName: { contains: query.search } } },
                  { staff: { employeeNo: { contains: query.search } } },
                  { name: { contains: query.search } },
                ],
              }
            : {}),
        };

        const include = {
          staff: { select: { employeeNo: true, fullName: true } },
          period: { select: { code: true, status: true } },
        };
        const orderBy = [{ [dateField]: 'desc' as const }, { id: 'desc' as const }];
        const skip = (query.page - 1) * query.pageSize;

        const [total, rows, counts] = isBonus
          ? await Promise.all([
              db().staffBonus.count({ where }),
              db().staffBonus.findMany({ where, include, orderBy, skip, take: query.pageSize }),
              db().staffBonus.groupBy({ by: ['status'], _count: { _all: true } }),
            ])
          : await Promise.all([
              db().staffCommission.count({ where }),
              db().staffCommission.findMany({
                where,
                include,
                orderBy,
                skip,
                take: query.pageSize,
              }),
              db().staffCommission.groupBy({ by: ['status'], _count: { _all: true } }),
            ]);

        return jsonSafe({
          rows: rows.map((row) => ({
            id: row.id,
            reference: isBonus
              ? (row as { bonusNo: string }).bonusNo
              : (row as { commissionNo: string }).commissionNo,
            staffId: row.staffId,
            employeeNo: row.staff.employeeNo,
            fullName: row.staff.fullName,
            kind: isBonus
              ? (row as { bonusType: string }).bonusType
              : (row as { commissionType: string }).commissionType,
            name: row.name,
            amount: Number(row.amount),
            onDate: dateOnlyKey(
              isBonus
                ? (row as { awardedOn: Date }).awardedOn
                : (row as { earnedOn: Date }).earnedOn,
            ),
            periodId: row.periodId,
            periodCode: row.period?.code ?? null,
            periodStatus: row.period?.status ?? null,
            status: row.status,
            fromAppraisal: isBonus
              ? (row as { kpiAssignmentId: number | null }).kpiAssignmentId !== null
              : false,
            note: row.note,
          })),
          total,
          page: query.page,
          pageSize: query.pageSize,
          counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
          generatedAt: new Date().toISOString(),
        });
      },
    );

    const schema = z.object({
      staffId: z.coerce.number().int().positive(),
      periodId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
      kind: z.enum(config.kinds),
      name: z.string().trim().min(1).max(190),
      amount: z.coerce.number().positive().max(1_000_000),
      onDate: dateKey,
      note: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
    });

    app.post(
      `/api/payroll/${config.path}`,
      { preHandler: requirePermission(config.screen, 'create') },
      async (request) => {
        const body = parseBody(schema, request.body);

        const staff = await db().staff.findUnique({
          where: { id: body.staffId },
          select: { fullName: true },
        });
        if (!staff) throw notFound('Staf tidak dijumpai');

        /*
         * A period past editing cannot take a new award.
         *
         * The run that would have collected it has already happened, so the row would sit
         * against that period unpaid and unexplained — visible, apparently approved, and never
         * on anybody's payslip.
         */
        if (body.periodId != null) {
          assertWritable(await loadPeriod(body.periodId));
        }

        const on = toDateOnly(body.onDate);
        const yearMonth = yearMonthOf(on);

        const row = await db().$transaction(async (tx) => {
          const existing = isBonus
            ? (
                await tx.staffBonus.findMany({
                  where: { bonusNo: { startsWith: `${config.prefix}-${yearMonth}-` } },
                  select: { bonusNo: true },
                })
              ).map((item) => item.bonusNo)
            : (
                await tx.staffCommission.findMany({
                  where: { commissionNo: { startsWith: `${config.prefix}-${yearMonth}-` } },
                  select: { commissionNo: true },
                })
              ).map((item) => item.commissionNo);

          const reference = await nextNumber(config.prefix, yearMonth, existing);

          const data = {
            [numberField]: reference,
            staffId: body.staffId,
            periodId: body.periodId ?? null,
            [typeField]: body.kind,
            name: body.name,
            amount: body.amount,
            [dateField]: on,
            status: 'pending',
            note: body.note ? body.note : null,
            createdBy: request.user?.accountId ?? null,
          };

          return isBonus
            ? tx.staffBonus.create({ data: data as never })
            : tx.staffCommission.create({ data: data as never });
        });

        await recordActivity({
          request,
          action: `payroll.${config.entity}.created`,
          category: 'settings',
          detail: `${staff.fullName}: ${body.name} RM${body.amount.toFixed(2)}`,
        });
        return jsonSafe({ id: row.id });
      },
    );

    app.patch(
      `/api/payroll/${config.path}/:id`,
      { preHandler: requirePermission(config.screen, 'edit') },
      async (request) => {
        const id = idParam(request.params);
        const body = parseBody(schema.partial().omit({ staffId: true }), request.body);

        const existing = isBonus
          ? await db().staffBonus.findUnique({
              where: { id },
              include: { staff: { select: { fullName: true } } },
            })
          : await db().staffCommission.findUnique({
              where: { id },
              include: { staff: { select: { fullName: true } } },
            });
        if (!existing) throw notFound('Rekod tidak dijumpai');

        /*
         * Only a pending award may be edited.
         *
         * Once approved it is a figure somebody signed, and once paid it is on a payslip. An
         * amount that moves after approval makes the payslip and the record disagree, and the
         * payslip is the one the employee has.
         */
        if (existing.status !== 'pending') {
          throw conflict(
            `Rekod ini berstatus "${existing.status}" dan tidak boleh diubah. Hanya yang ` +
              'menunggu keputusan boleh disunting — amaun yang sudah diluluskan mungkin sudah ' +
              'berada pada slip gaji.',
          );
        }

        if (body.periodId != null) {
          assertWritable(await loadPeriod(body.periodId));
        }

        const data = {
          ...(body.periodId !== undefined ? { periodId: body.periodId ?? null } : {}),
          ...(body.kind !== undefined ? { [typeField]: body.kind } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.amount !== undefined ? { amount: body.amount } : {}),
          ...(body.onDate !== undefined ? { [dateField]: toDateOnly(body.onDate) } : {}),
          ...(body.note !== undefined ? { note: body.note ? body.note : null } : {}),
        };

        if (isBonus) await db().staffBonus.update({ where: { id }, data: data as never });
        else await db().staffCommission.update({ where: { id }, data: data as never });

        await recordActivity({
          request,
          action: `payroll.${config.entity}.updated`,
          category: 'settings',
          detail: existing.staff.fullName,
        });
        return jsonSafe({ ok: true });
      },
    );

    app.post(
      `/api/payroll/${config.path}/:id/decision`,
      { preHandler: requirePermission(config.screen, 'approve') },
      async (request) => {
        const id = idParam(request.params);
        const body = parseBody(
          z.object({
            action: z.enum(['approve', 'cancel']),
            note: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
          }),
          request.body,
        );

        const existing = isBonus
          ? await db().staffBonus.findUnique({
              where: { id },
              include: {
                staff: { select: { fullName: true } },
                period: { select: { id: true, code: true, status: true } },
              },
            })
          : await db().staffCommission.findUnique({
              where: { id },
              include: {
                staff: { select: { fullName: true } },
                period: { select: { id: true, code: true, status: true } },
              },
            });
        if (!existing) throw notFound('Rekod tidak dijumpai');

        if (body.action === 'approve') {
          if (existing.status !== 'pending') {
            throw conflict(`Rekod ini sudah "${existing.status}".`);
          }
          /*
           * Approval needs a period, and the period has to still be editable.
           *
           * An approved award with no period attached is money nobody will pay: the run reads
           * rows by period, so it would never be seen again.
           */
          if (existing.period === null) {
            throw conflict(
              'Pilih tempoh payroll sebelum meluluskan. Proses payroll membaca rekod ' +
                'mengikut tempoh, jadi yang tiada tempoh tidak akan dibayar.',
            );
          }
          assertWritable(existing.period);
        } else if (existing.status === 'paid') {
          // Cancelling something already paid would leave the payslip carrying it. Reversal is
          // an adjustment in a later period, which is a decision somebody makes on purpose.
          throw conflict(
            'Rekod ini sudah dibayar dan tidak boleh dibatalkan. Buat pelarasan dalam tempoh ' +
              'berikutnya.',
          );
        }

        const status = body.action === 'approve' ? 'approved' : 'cancelled';
        const data = {
          status,
          approvedBy: request.user?.accountId ?? null,
          approvedAt: new Date(),
          ...(body.note ? { note: body.note } : {}),
        };

        if (isBonus) await db().staffBonus.update({ where: { id }, data });
        else await db().staffCommission.update({ where: { id }, data });

        const settings = await moduleSettings('payroll');
        if (settingIsOn(settings, 'notifyApplicant')) {
          const staff = await db().staff.findUnique({
            where: { id: existing.staffId },
            select: { email: true, phone: true, employeeNo: true },
          });
          const amount = Number(existing.amount).toFixed(2);
          // The reference column differs between the two tables, which is the one place the
          // shared builder cannot stay blind to which entity it is handling.
          const reference = isBonus
            ? (existing as { bonusNo: string }).bonusNo
            : (existing as { commissionNo: string }).commissionNo;
          notify({
            trigger: 'payroll.awardDecided',
            mobile: staff?.phone ?? null,
            summary:
              status === 'approved'
                ? `${reference} RM ${amount} diluluskan.`
                : `${reference} RM ${amount} dibatalkan.`,
            lines: [
              `Staf: ${existing.staff.fullName}`,
              `Tempoh: ${existing.period?.code ?? '-'}`,
              ...(body.note ? [`Nota: ${body.note}`] : []),
            ],
            email: {
              module: 'payroll',
              event: status === 'approved' ? 'awardApproved' : 'awardCancelled',
              to: staff?.email ?? null,
              vars: {
                staffName: existing.staff.fullName,
                employeeNo: staff?.employeeNo ?? null,
                requestNo: reference,
                status,
                decidedBy: request.user?.fullName ?? null,
                note: body.note ?? null,
                periodCode: existing.period?.code ?? null,
                periodName: existing.period?.code ?? null,
                amount,
              },
            },
          });
        }

        await recordActivity({
          request,
          action: `payroll.${config.entity}.${status}`,
          category: 'settings',
          detail: `${existing.staff.fullName}: RM${Number(existing.amount).toFixed(2)}`,
        });
        return jsonSafe({ ok: true, status });
      },
    );

    app.delete(
      `/api/payroll/${config.path}/:id`,
      { preHandler: requirePermission(config.screen, 'delete') },
      async (request) => {
        const id = idParam(request.params);
        const existing = isBonus
          ? await db().staffBonus.findUnique({
              where: { id },
              include: { staff: { select: { fullName: true } } },
            })
          : await db().staffCommission.findUnique({
              where: { id },
              include: { staff: { select: { fullName: true } } },
            });
        if (!existing) throw notFound('Rekod tidak dijumpai');

        if (existing.status === 'paid' || existing.status === 'approved') {
          throw conflict(
            `Rekod berstatus "${existing.status}" tidak boleh dibuang. Batalkan ia dahulu — ` +
              'membuang barisnya menghilangkan rekod apa yang diluluskan.',
          );
        }

        if (isBonus) await db().staffBonus.delete({ where: { id } });
        else await db().staffCommission.delete({ where: { id } });

        await recordActivity({
          request,
          action: `payroll.${config.entity}.removed`,
          category: 'settings',
          detail: existing.staff.fullName,
        });
        return jsonSafe({ ok: true });
      },
    );
  }

  awardRoutes({
    screen: 'hr.bonuses',
    path: 'bonuses',
    prefix: 'BON',
    kinds: ['performance', 'annual', 'festival', 'project', 'attendance', 'other'],
    entity: 'bonus',
  });

  awardRoutes({
    screen: 'hr.commissions',
    path: 'commissions',
    prefix: 'KOM',
    kinds: ['sales', 'project', 'referral', 'other'],
    entity: 'commission',
  });

  /**
   * Turns finalised appraisals into bonus rows somebody still has to approve.
   *
   * The grade carries the months and the bonus row carries the amount. Nothing reaches a payslip
   * from an appraisal on its own: that would leave HR unable to withhold or reschedule one
   * person's bonus, and no trail of the decision anywhere.
   *
   * `kpiAssignmentId` is unique, so running this twice cannot pay the same appraisal twice.
   */
  app.post(
    '/api/payroll/bonuses/from-appraisals',
    { preHandler: requirePermission('hr.bonuses', 'create') },
    async (request) => {
      const body = parseBody(
        z.object({
          kpiPeriodId: z.coerce.number().int().positive(),
          periodId: z.coerce.number().int().positive(),
        }),
        request.body,
      );

      const period = await loadPeriod(body.periodId);
      assertWritable(period);

      const kpiPeriod = await db().kpiPeriod.findUnique({
        where: { id: body.kpiPeriodId },
        select: { id: true, name: true },
      });
      if (!kpiPeriod) throw notFound('Tempoh KPI tidak dijumpai');

      const assignments = await db().kpiAssignment.findMany({
        where: { periodId: body.kpiPeriodId, status: 'finalised' },
        select: {
          id: true,
          staffId: true,
          totalScore: true,
          /*
           * The grade the appraisal was signed with, read rather than re-derived.
           *
           * This used to search the bands for the one containing `totalScore`, which meant editing
           * a band after finalisation repriced a bonus for an appraisal nobody had reopened — and
           * it was a second implementation of the band lookup, so it could disagree with the KPI
           * screens about the same score. `gradeCode` is frozen at submission for exactly this.
           */
          gradeCode: true,
          staff: { select: { fullName: true, basicSalary: true } },
        },
      });

      const gradesByCode = new Map(
        (await db().kpiGrade.findMany()).map((grade) => [grade.code, grade]),
      );
      const already = new Set(
        (
          await db().staffBonus.findMany({
            where: { kpiAssignmentId: { in: assignments.map((row) => row.id) } },
            select: { kpiAssignmentId: true },
          })
        ).map((row) => row.kpiAssignmentId),
      );

      const yearMonth = yearMonthOf(asDateOnly(new Date()));
      let created = 0;
      let skippedNoGrade = 0;
      let skippedNoSalary = 0;
      let skippedExisting = 0;

      for (const assignment of assignments) {
        if (already.has(assignment.id)) {
          skippedExisting += 1;
          continue;
        }
        const score = assignment.totalScore === null ? null : Number(assignment.totalScore);
        if (score === null || assignment.gradeCode === null) {
          skippedNoGrade += 1;
          continue;
        }
        /*
         * A grade code naming a band that has since been deleted is skipped, not guessed at.
         *
         * The code on a finalised appraisal is a historical record and is deliberately not a foreign
         * key — it names the grade the person was given, even after the band is gone. What it cannot
         * do is tell us what that grade was worth, and inventing a figure to pay is worse than
         * reporting that this one needs a human.
         */
        const grade = gradesByCode.get(assignment.gradeCode);
        const months = grade?.bonusMonths == null ? null : Number(grade.bonusMonths);
        if (grade === undefined || months === null) {
          skippedNoGrade += 1;
          continue;
        }
        const basic =
          assignment.staff.basicSalary === null ? 0 : Number(assignment.staff.basicSalary);
        const amount = kpiBonusAmount(basic, months);
        if (amount <= 0) {
          skippedNoSalary += 1;
          continue;
        }

        await db().$transaction(async (tx) => {
          const existing = (
            await tx.staffBonus.findMany({
              where: { bonusNo: { startsWith: `BON-${yearMonth}-` } },
              select: { bonusNo: true },
            })
          ).map((row) => row.bonusNo);

          await tx.staffBonus.create({
            data: {
              bonusNo: await nextNumber('BON', yearMonth, existing),
              staffId: assignment.staffId,
              periodId: body.periodId,
              bonusType: 'performance',
              name: `Bonus prestasi ${kpiPeriod.name} — gred ${grade.code}`,
              amount,
              awardedOn: asDateOnly(new Date()),
              kpiAssignmentId: assignment.id,
              // Pending, like any other bonus. Generated is not approved.
              status: 'pending',
              createdBy: request.user?.accountId ?? null,
            },
          });
        });
        created += 1;
      }

      await recordActivity({
        request,
        action: 'payroll.bonus.generated',
        category: 'settings',
        detail:
          `${kpiPeriod.name} → ${period.code}: ${String(created)} bonus dijana, ` +
          `${String(skippedExisting)} sudah ada, ${String(skippedNoGrade)} tiada bonus pada gred, ` +
          `${String(skippedNoSalary)} tiada gaji asas`,
      });

      return jsonSafe({ created, skippedExisting, skippedNoGrade, skippedNoSalary });
    },
  );

  // ── Loans and advances ──
  //
  // Same treatment: one builder, two registrations, separate permission keys. The difference
  // between them is only where the instalment comes from — a loan carries an agreed instalment,
  // an advance divides the amount by the months chosen.

  function lendingRoutes(config: {
    screen: 'hr.loans' | 'hr.advances';
    path: string;
    prefix: string;
    entity: 'loan' | 'advance';
  }): void {
    const isLoan = config.entity === 'loan';
    const numberField = isLoan ? 'loanNo' : 'advanceNo';

    app.get(
      `/api/payroll/${config.path}`,
      { preHandler: requirePermission(config.screen, 'view') },
      async (request) => {
        const query = z
          .object({
            page: z.coerce.number().int().positive().default(1),
            pageSize: z.coerce.number().int().min(10).max(200).default(50),
            search: z.string().trim().max(128).optional(),
            status: z.string().trim().max(16).optional(),
          })
          .parse(request.query);

        const where = {
          ...(query.status !== undefined && query.status !== '' ? { status: query.status } : {}),
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

        const include = { staff: { select: { employeeNo: true, fullName: true } } };
        const orderBy = [{ startsOn: 'desc' as const }, { id: 'desc' as const }];
        const skip = (query.page - 1) * query.pageSize;

        const [total, rows, counts] = isLoan
          ? await Promise.all([
              db().staffLoan.count({ where }),
              db().staffLoan.findMany({ where, include, orderBy, skip, take: query.pageSize }),
              db().staffLoan.groupBy({ by: ['status'], _count: { _all: true } }),
            ])
          : await Promise.all([
              db().staffAdvance.count({ where }),
              db().staffAdvance.findMany({ where, include, orderBy, skip, take: query.pageSize }),
              db().staffAdvance.groupBy({ by: ['status'], _count: { _all: true } }),
            ]);

        return jsonSafe({
          rows: rows.map((row) => {
            const instalment = isLoan
              ? Number((row as { monthlyInstalment: unknown }).monthlyInstalment)
              : Number((row as { monthlyDeduction: unknown }).monthlyDeduction);
            const total_ = isLoan
              ? (row as { totalInstalments: number }).totalInstalments
              : (row as { repaymentMonths: number }).repaymentMonths;
            const paid = isLoan
              ? (row as { paidInstalments: number }).paidInstalments
              : (row as { paidMonths: number }).paidMonths;

            return {
              id: row.id,
              reference: isLoan
                ? (row as { loanNo: string }).loanNo
                : (row as { advanceNo: string }).advanceNo,
              staffId: row.staffId,
              employeeNo: row.staff.employeeNo,
              fullName: row.staff.fullName,
              principal: Number(row.principal),
              instalment,
              totalInstalments: total_,
              paidInstalments: paid,
              remainingBalance: Number(row.remainingBalance),
              issuedOn: dateOnlyKey(row.issuedOn),
              startsOn: dateOnlyKey(row.startsOn),
              closedOn: row.closedOn === null ? null : dateOnlyKey(row.closedOn),
              reason: isLoan
                ? (row as { purpose: string | null }).purpose
                : (row as { reason: string | null }).reason,
              status: row.status,
              note: row.note,
            };
          }),
          total,
          page: query.page,
          pageSize: query.pageSize,
          counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
          generatedAt: new Date().toISOString(),
        });
      },
    );

    const schema = z.object({
      staffId: z.coerce.number().int().positive(),
      principal: z.coerce.number().positive().max(1_000_000),
      /** Loans carry an agreed instalment; for an advance this is ignored and derived. */
      monthlyInstalment: z.coerce.number().positive().max(1_000_000).optional(),
      months: z.coerce.number().int().min(1).max(120),
      issuedOn: dateKey,
      startsOn: dateKey,
      reason: z.union([z.literal(''), z.string().trim().max(190)]).optional(),
      note: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
    });

    app.post(
      `/api/payroll/${config.path}`,
      { preHandler: requirePermission(config.screen, 'create') },
      async (request) => {
        const body = parseBody(schema, request.body);

        const staff = await db().staff.findUnique({
          where: { id: body.staffId },
          select: { fullName: true },
        });
        if (!staff) throw notFound('Staf tidak dijumpai');

        const issuedOn = toDateOnly(body.issuedOn);
        const startsOn = toDateOnly(body.startsOn);
        if (startsOn < issuedOn) {
          throw conflict('Potongan tidak boleh bermula sebelum wang dikeluarkan.');
        }

        /*
         * The instalment, and the reason the two entities differ at all.
         *
         * A loan's instalment is agreed and may not divide the principal evenly — the last one
         * is smaller, which `instalmentDue` handles at run time. An advance's is derived, so
         * entering both would allow a figure that never clears the balance.
         */
        const instalment = isLoan
          ? toSen(body.monthlyInstalment ?? monthlyRecovery(body.principal, body.months))
          : monthlyRecovery(body.principal, body.months);

        if (instalment <= 0) throw conflict('Ansuran bulanan mesti lebih daripada sifar.');

        // An instalment that cannot clear the principal within the term would leave a balance
        // running for ever, and nobody watching a balance notices it not moving.
        if (isLoan && toSen(instalment * body.months) < toSen(body.principal) - 0.01) {
          throw conflict(
            `${String(body.months)} ansuran RM${instalment.toFixed(2)} berjumlah ` +
              `RM${toSen(instalment * body.months).toFixed(2)}, kurang daripada pokok ` +
              `RM${body.principal.toFixed(2)}. Baki tidak akan habis.`,
          );
        }

        const yearMonth = yearMonthOf(issuedOn);

        const row = await db().$transaction(async (tx) => {
          const existing = isLoan
            ? (
                await tx.staffLoan.findMany({
                  where: { loanNo: { startsWith: `${config.prefix}-${yearMonth}-` } },
                  select: { loanNo: true },
                })
              ).map((item) => item.loanNo)
            : (
                await tx.staffAdvance.findMany({
                  where: { advanceNo: { startsWith: `${config.prefix}-${yearMonth}-` } },
                  select: { advanceNo: true },
                })
              ).map((item) => item.advanceNo);

          const reference = await nextNumber(config.prefix, yearMonth, existing);

          const common = {
            [numberField]: reference,
            staffId: body.staffId,
            principal: body.principal,
            remainingBalance: body.principal,
            issuedOn,
            startsOn,
            status: 'pending',
            note: body.note ? body.note : null,
            createdBy: request.user?.accountId ?? null,
          };

          return isLoan
            ? tx.staffLoan.create({
                data: {
                  ...common,
                  monthlyInstalment: instalment,
                  totalInstalments: body.months,
                  purpose: body.reason ? body.reason : null,
                } as never,
              })
            : tx.staffAdvance.create({
                data: {
                  ...common,
                  monthlyDeduction: instalment,
                  repaymentMonths: body.months,
                  reason: body.reason ? body.reason : null,
                } as never,
              });
        });

        await recordActivity({
          request,
          action: `payroll.${config.entity}.created`,
          category: 'settings',
          detail:
            `${staff.fullName}: RM${body.principal.toFixed(2)} × ${String(body.months)} bulan ` +
            `@ RM${instalment.toFixed(2)}`,
        });
        return jsonSafe({ id: row.id, instalment });
      },
    );

    app.post(
      `/api/payroll/${config.path}/:id/decision`,
      { preHandler: requirePermission(config.screen, 'approve') },
      async (request) => {
        const id = idParam(request.params);
        const body = parseBody(
          z.object({
            action: z.enum(['approve', 'cancel']),
            note: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
          }),
          request.body,
        );

        const existing = isLoan
          ? await db().staffLoan.findUnique({
              where: { id },
              include: { staff: { select: { fullName: true } } },
            })
          : await db().staffAdvance.findUnique({
              where: { id },
              include: { staff: { select: { fullName: true } } },
            });
        if (!existing) throw notFound('Rekod tidak dijumpai');

        if (body.action === 'approve' && existing.status !== 'pending') {
          throw conflict(`Rekod ini sudah "${existing.status}".`);
        }

        /*
         * Cancelling something already recovered from is refused.
         *
         * `paidInstalments > 0` means wages have been deducted against it. Cancelling would leave
         * money taken with nothing recording why, and refunding it is a payment somebody has to
         * decide on rather than a side effect of pressing cancel.
         */
        const paid = isLoan
          ? (existing as { paidInstalments: number }).paidInstalments
          : (existing as { paidMonths: number }).paidMonths;
        if (body.action === 'cancel' && paid > 0) {
          throw conflict(
            `${String(paid)} ansuran sudah dipotong daripada gaji. Rekod ini tidak boleh ` +
              'dibatalkan — buat bayaran balik sebagai pelarasan supaya ada jejaknya.',
          );
        }

        const status = body.action === 'approve' ? 'active' : 'cancelled';
        const data = {
          status,
          approvedBy: request.user?.accountId ?? null,
          approvedAt: new Date(),
          ...(body.note ? { note: body.note } : {}),
          ...(status === 'cancelled' ? { closedOn: asDateOnly(new Date()) } : {}),
        };

        if (isLoan) await db().staffLoan.update({ where: { id }, data });
        else await db().staffAdvance.update({ where: { id }, data });

        /*
         * Only on approval, and this is the message that matters most on these two screens.
         *
         * A deduction that appears on a payslip without warning reads as an error, and the person
         * it happened to has no way to tell the difference. The instalment and the first deduction
         * date are the two facts that prevent that phone call.
         */
        const settings = await moduleSettings('payroll');
        if (status === 'active' && settingIsOn(settings, 'notifyApplicant')) {
          const staff = await db().staff.findUnique({
            where: { id: existing.staffId },
            select: { email: true, phone: true, employeeNo: true },
          });
          const reference = isLoan
            ? (existing as { loanNo: string }).loanNo
            : (existing as { advanceNo: string }).advanceNo;
          const instalment = isLoan
            ? Number((existing as { monthlyInstalment: unknown }).monthlyInstalment)
            : Number((existing as { monthlyDeduction: unknown }).monthlyDeduction);

          notify({
            trigger: 'payroll.lendingApproved',
            mobile: staff?.phone ?? null,
            summary:
              `${reference} diluluskan. Potongan RM ${instalment.toFixed(2)} sebulan mulai ` +
              `${dateOnlyKey(existing.startsOn)}.`,
            lines: [
              `Staf: ${existing.staff.fullName}`,
              `Jumlah: RM ${Number(existing.principal).toFixed(2)}`,
              ...(body.note ? [`Nota: ${body.note}`] : []),
            ],
            email: {
              module: 'payroll',
              event: 'lendingApproved',
              to: staff?.email ?? null,
              vars: {
                staffName: existing.staff.fullName,
                employeeNo: staff?.employeeNo ?? null,
                requestNo: reference,
                status,
                decidedBy: request.user?.fullName ?? null,
                note: body.note ?? null,
                amount: Number(existing.principal).toFixed(2),
                instalment: instalment.toFixed(2),
                balance: Number(existing.remainingBalance).toFixed(2),
                startsOn: dateOnlyKey(existing.startsOn),
              },
            },
          });
        }

        await recordActivity({
          request,
          action: `payroll.${config.entity}.${status}`,
          category: 'settings',
          detail: `${existing.staff.fullName}: RM${Number(existing.principal).toFixed(2)}`,
        });
        return jsonSafe({ ok: true, status });
      },
    );

    app.delete(
      `/api/payroll/${config.path}/:id`,
      { preHandler: requirePermission(config.screen, 'delete') },
      async (request) => {
        const id = idParam(request.params);
        const existing = isLoan
          ? await db().staffLoan.findUnique({
              where: { id },
              include: { staff: { select: { fullName: true } } },
            })
          : await db().staffAdvance.findUnique({
              where: { id },
              include: { staff: { select: { fullName: true } } },
            });
        if (!existing) throw notFound('Rekod tidak dijumpai');

        const paid = isLoan
          ? (existing as { paidInstalments: number }).paidInstalments
          : (existing as { paidMonths: number }).paidMonths;

        // Anything with a repayment history stays. The payslips that deducted it point here,
        // and removing the row leaves those lines naming something that no longer exists.
        if (paid > 0 || existing.status === 'active' || existing.status === 'completed') {
          throw conflict(
            `Rekod berstatus "${existing.status}" dengan ${String(paid)} ansuran dipotong tidak ` +
              'boleh dibuang. Slip gaji yang memotongnya masih merujuk rekod ini.',
          );
        }

        if (isLoan) await db().staffLoan.delete({ where: { id } });
        else await db().staffAdvance.delete({ where: { id } });

        await recordActivity({
          request,
          action: `payroll.${config.entity}.removed`,
          category: 'settings',
          detail: existing.staff.fullName,
        });
        return jsonSafe({ ok: true });
      },
    );
  }

  lendingRoutes({ screen: 'hr.loans', path: 'loans', prefix: 'PJM', entity: 'loan' });
  lendingRoutes({ screen: 'hr.advances', path: 'advances', prefix: 'PDH', entity: 'advance' });
}
