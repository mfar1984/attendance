/**
 * Building the payslips for a period.
 *
 * The arithmetic lives in `payroll.ts`, which is import-free and tested on its own. This file is
 * the part that needs a database: gathering what feeds a payslip, writing the rows, and moving
 * the loan and advance balances in the same transaction as the deduction that moved them.
 *
 * ## The hours are not computed here
 *
 * `reports/aggregate.ts` produces them, and it is the same code path the payroll export uses. A
 * payroll run that counted its own hours would be a second attendance engine, and nobody
 * reconciles the second against the first — the failure mode is a payslip and an export
 * disagreeing about the same month with no way to say which is right.
 *
 * ## A draft is rebuilt, an approved period is not
 *
 * Processing a draft discards its payslips and builds them again. That is what makes a corrected
 * terminal clock or a repaired identity mapping reachable: fix the cause, run again. Once the
 * period is approved the payslips are the record, and the way to change one is an adjustment in
 * a later period.
 */

import type { Prisma } from '@prisma/client';

import { db } from '../db.js';
import { approvedOvertime, summarise } from '../reports/aggregate.js';
import type { Period, StaffSummary } from '../reports/aggregate.js';
import { asDateOnly } from '../time.js';
import { toSen } from './money.js';
import {
  allowanceValue,
  computePayslip,
  instalmentDue,
  parseStatutory,
  type PayrollSettings,
  type StatutoryRates,
} from './payroll.js';

/** A line as it will be written, before it has a payslip id. */
interface DraftLine {
  kind: 'earning' | 'deduction';
  source: string;
  sourceId: number | null;
  label: string;
  amount: number;
  sortOrder: number;
}

export interface RunResult {
  staffCount: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalEmployerCost: number;
  /** People skipped because no basic salary is recorded. Reported, never guessed at. */
  withoutSalary: number;
}

/** Settings rows for the payroll module, defaults applied by the caller's parse. */
export async function payrollSettings(): Promise<Partial<PayrollSettings>> {
  const rows = await db().hrModuleSetting.findMany({ where: { module: 'payroll' } });
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value;
  return result as Partial<PayrollSettings>;
}

/**
 * `PS-YYYYMM-NNN` for one payslip.
 *
 * Scoped to the period rather than the calendar month, because a period is what the run is
 * numbering. The unique index on the column is the backstop against a race.
 */
function payslipNo(periodYear: number, periodMonth: number, sequence: number): string {
  const yearMonth = `${String(periodYear)}${String(periodMonth).padStart(2, '0')}`;
  return `PS-${yearMonth}-${String(sequence).padStart(3, '0')}`;
}

/**
 * Everything one person's payslip is built from, gathered per person.
 *
 * Read outside the transaction. None of it writes, and holding a transaction open across five
 * thousand people's worth of reads is how a connection pool stalls.
 *
 * With one exception, and it is deliberate: a loan or an advance arrives as an id and a reference,
 * NOT an amount. The instalment depends on the balance, and on a rebuild the balance is only
 * correct after `unwind` has put the previous run's instalment back — which happens inside the
 * transaction. Resolving the amount out here read a balance one instalment too low, so the final
 * instalment came out short and the loan ran a month past its schedule. Caught by
 * `verify-payroll-run.mts`, which is why that script exists.
 */
interface StaffInput {
  staffId: number;
  basicSalary: number;
  summary: StaffSummary;
  overtime: { minutes: number; amount: number };
  allowances: Array<{ id: number; label: string; amount: number; epfLiable: boolean }>;
  bonuses: Array<{ id: number; label: string; amount: number }>;
  commissions: Array<{ id: number; label: string; amount: number }>;
  /** Candidate only. The amount is resolved inside the transaction, after `unwind`. */
  loan: { id: number; label: string } | null;
  advance: { id: number; label: string } | null;
}

/**
 * Rebuilds every payslip in a draft period.
 *
 * Order matters and it is the same ordering the reference had to learn the hard way: everything
 * that can refuse happens before the transaction opens, and nothing inside it returns early.
 * Reads need no transaction; only the writes do.
 */
export async function runPeriod(period: {
  id: number;
  periodYear: number;
  periodMonth: number;
  range: Period;
}): Promise<RunResult> {
  const prisma = db();
  const rates = parseStatutory(await payrollSettings());

  const staff = await prisma.staff.findMany({
    where: { active: true },
    orderBy: [{ employeeNo: 'asc' }],
    select: { id: true, basicSalary: true },
  });

  const inputs = await gather(staff, period);

  const totals: RunResult = {
    staffCount: 0,
    totalGross: 0,
    totalDeductions: 0,
    totalNet: 0,
    totalEmployerCost: 0,
    withoutSalary: staff.length - inputs.length,
  };

  /*
   * One transaction for the whole rebuild.
   *
   * Half a rebuilt period is worse than none: the deleted payslips are gone and the loan
   * balances have moved for whoever was reached before it failed. The timeout is raised because
   * this is thousands of rows, and the default ten seconds would abandon a run mid-way through
   * exactly the work that must not be partial.
   */
  await prisma.$transaction(
    async (tx) => {
      // The previous run's rows, and the balance movements they caused, both unwound.
      await unwind(tx, period.id);

      let sequence = 0;
      for (const input of inputs) {
        sequence += 1;
        const written = await writePayslip(tx, period, input, rates, sequence);

        totals.staffCount += 1;
        totals.totalGross = toSen(totals.totalGross + written.gross);
        totals.totalDeductions = toSen(totals.totalDeductions + written.totalDeductions);
        totals.totalNet = toSen(totals.totalNet + written.netPay);
        totals.totalEmployerCost = toSen(totals.totalEmployerCost + written.employerCost);
      }

      await tx.payrollPeriod.update({
        where: { id: period.id },
        data: {
          status: 'processing',
          staffCount: totals.staffCount,
          totalGross: totals.totalGross,
          totalDeductions: totals.totalDeductions,
          totalNet: totals.totalNet,
          totalEmployerCost: totals.totalEmployerCost,
          processedAt: new Date(),
        },
      });
    },
    { timeout: 120_000, maxWait: 20_000 },
  );

  return totals;
}

/**
 * Undoes a previous run of the same period.
 *
 * The payslips cascade away with their lines, but the balances they moved do not come back on
 * their own — so the instalments this period recorded are added back to every loan and advance
 * before the rebuild deducts them again. Without this, processing a draft twice collects the
 * instalment twice and closes the loan early.
 */
async function unwind(tx: Prisma.TransactionClient, periodId: number): Promise<void> {
  const previous = await tx.payslip.findMany({
    where: { periodId },
    select: {
      id: true,
      lines: {
        where: { source: { in: ['loan', 'advance'] } },
        select: { source: true, sourceId: true, amount: true },
      },
    },
  });

  for (const payslip of previous) {
    for (const line of payslip.lines) {
      if (line.sourceId === null) continue;
      const amount = Number(line.amount);
      if (amount <= 0) continue;

      if (line.source === 'loan') {
        const loan = await tx.staffLoan.findUnique({
          where: { id: line.sourceId },
          select: { remainingBalance: true, paidInstalments: true },
        });
        if (!loan) continue;
        await tx.staffLoan.update({
          where: { id: line.sourceId },
          data: {
            remainingBalance: toSen(Number(loan.remainingBalance) + amount),
            paidInstalments: Math.max(0, loan.paidInstalments - 1),
            // Reopened: a loan whose balance is back above zero is not completed.
            status: 'active',
            closedOn: null,
          },
        });
      } else {
        const advance = await tx.staffAdvance.findUnique({
          where: { id: line.sourceId },
          select: { remainingBalance: true, paidMonths: true },
        });
        if (!advance) continue;
        await tx.staffAdvance.update({
          where: { id: line.sourceId },
          data: {
            remainingBalance: toSen(Number(advance.remainingBalance) + amount),
            paidMonths: Math.max(0, advance.paidMonths - 1),
            status: 'active',
            closedOn: null,
          },
        });
      }
    }
  }

  await tx.payslip.deleteMany({ where: { periodId } });
}

/** Gathers the inputs for every person with a recorded salary. */
async function gather(
  staff: Array<{ id: number; basicSalary: unknown }>,
  period: { id: number; range: Period },
): Promise<StaffInput[]> {
  const prisma = db();
  const withSalary = staff.filter((row) => row.basicSalary !== null && Number(row.basicSalary) > 0);
  const ids = withSalary.map((row) => row.id);
  if (ids.length === 0) return [];

  const [summaries, overtime, allowanceRows, bonusRows, commissionRows, loanRows, advanceRows] =
    await Promise.all([
      summarise(ids, period.range),
      approvedOvertime(ids, period.range),
      /*
       * Standing allowances whose window covers this period.
       *
       * `effectiveFrom <= toDate` is the filter the reference stored and never applied, so an
       * allowance dated next quarter started paying on the next run.
       */
      prisma.staffAllowance.findMany({
        where: {
          staffId: { in: ids },
          active: true,
          effectiveFrom: { lte: period.range.to },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.range.from } }],
        },
        select: {
          id: true,
          staffId: true,
          value: true,
          type: { select: { name: true, calcMode: true, epfLiable: true } },
        },
      }),
      prisma.staffBonus.findMany({
        where: { staffId: { in: ids }, periodId: period.id, status: 'approved' },
        select: { id: true, staffId: true, name: true, amount: true },
      }),
      prisma.staffCommission.findMany({
        where: { staffId: { in: ids }, periodId: period.id, status: 'approved' },
        select: { id: true, staffId: true, name: true, amount: true },
      }),
      /*
       * Loans and advances whose recovery has started by the end of this period. `startsOn` is
       * a calendar column filtered with the calendar bound, which is the whole reason `Period`
       * carries both forms.
       */
      prisma.staffLoan.findMany({
        where: {
          staffId: { in: ids },
          status: 'active',
          startsOn: { lte: period.range.to },
          remainingBalance: { gt: 0 },
        },
        orderBy: [{ startsOn: 'asc' }],
        select: {
          id: true,
          staffId: true,
          loanNo: true,
          monthlyInstalment: true,
          remainingBalance: true,
        },
      }),
      prisma.staffAdvance.findMany({
        where: {
          staffId: { in: ids },
          status: 'active',
          startsOn: { lte: period.range.to },
          remainingBalance: { gt: 0 },
        },
        orderBy: [{ startsOn: 'asc' }],
        select: {
          id: true,
          staffId: true,
          advanceNo: true,
          monthlyDeduction: true,
          remainingBalance: true,
        },
      }),
    ]);

  const summaryByStaff = new Map(summaries.map((row) => [row.staffId, row]));

  return withSalary.map((person) => {
    const basicSalary = toSen(Number(person.basicSalary));
    const summary = summaryByStaff.get(person.id);

    return {
      staffId: person.id,
      basicSalary,
      summary: summary ?? {
        staffId: person.id,
        scheduledDays: 0,
        presentDays: 0,
        lateDays: 0,
        absentDays: 0,
        leaveDays: 0,
        restDays: 0,
        holidayDays: 0,
        incompleteDays: 0,
        workedMinutes: 0,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        overtimeMinutes: 0,
        openExceptions: 0,
      },
      overtime: overtime.get(person.id) ?? { minutes: 0, amount: 0 },
      allowances: allowanceRows
        .filter((row) => row.staffId === person.id)
        .map((row) => ({
          id: row.id,
          label: row.type.name,
          amount: allowanceValue(row.type.calcMode, Number(row.value), basicSalary),
          epfLiable: row.type.epfLiable,
        }))
        .filter((row) => row.amount > 0),
      bonuses: bonusRows
        .filter((row) => row.staffId === person.id)
        .map((row) => ({ id: row.id, label: row.name, amount: toSen(Number(row.amount)) })),
      commissions: commissionRows
        .filter((row) => row.staffId === person.id)
        .map((row) => ({ id: row.id, label: row.name, amount: toSen(Number(row.amount)) })),
      /*
       * The first active one only, and the id only.
       *
       * One at a time because two concurrent loans deducted together can take more than somebody
       * earns, and which to defer is a decision a person makes rather than a run. The amount is
       * left to `writePayslip`, which reads the balance after `unwind` has corrected it.
       */
      loan: named(
        loanRows.find((row) => row.staffId === person.id),
        (row) => ({ id: row.id, label: row.loanNo }),
      ),
      advance: named(
        advanceRows.find((row) => row.staffId === person.id),
        (row) => ({ id: row.id, label: row.advanceNo }),
      ),
    };
  });
}

function named<T>(
  row: T | undefined,
  map: (row: T) => { id: number; label: string },
): { id: number; label: string } | null {
  return row === undefined ? null : map(row);
}

/** Writes one payslip, its lines, and the balance movements it caused. */
async function writePayslip(
  tx: Prisma.TransactionClient,
  period: { id: number; periodYear: number; periodMonth: number },
  input: StaffInput,
  rates: StatutoryRates,
  sequence: number,
): Promise<{
  gross: number;
  totalDeductions: number;
  netPay: number;
  employerCost: number;
}> {
  const epfLiableAllowance = input.allowances
    .filter((row) => row.epfLiable)
    .reduce((sum, row) => toSen(sum + row.amount), 0);
  const exemptAllowance = input.allowances
    .filter((row) => !row.epfLiable)
    .reduce((sum, row) => toSen(sum + row.amount), 0);

  const bonusAmount = input.bonuses.reduce((sum, row) => toSen(sum + row.amount), 0);
  const commissionAmount = input.commissions.reduce((sum, row) => toSen(sum + row.amount), 0);

  /*
   * The instalments, resolved here and not in `gather`.
   *
   * This read happens after `unwind` has restored the previous run's instalment, so the balance is
   * what is genuinely still owed. Reading it before that gave a balance one instalment too low, and
   * `instalmentDue` then capped the final instalment at that short figure — the employee was
   * under-deducted and the loan outlived its schedule by a month.
   */
  const loanState =
    input.loan === null
      ? null
      : await tx.staffLoan.findUniqueOrThrow({
          where: { id: input.loan.id },
          select: { monthlyInstalment: true, remainingBalance: true, paidInstalments: true },
        });
  const advanceState =
    input.advance === null
      ? null
      : await tx.staffAdvance.findUniqueOrThrow({
          where: { id: input.advance.id },
          select: { monthlyDeduction: true, remainingBalance: true, paidMonths: true },
        });

  const loanDeduction =
    loanState === null
      ? 0
      : instalmentDue(Number(loanState.monthlyInstalment), Number(loanState.remainingBalance));
  const advanceDeduction =
    advanceState === null
      ? 0
      : instalmentDue(Number(advanceState.monthlyDeduction), Number(advanceState.remainingBalance));

  const math = computePayslip(
    {
      basicSalary: input.basicSalary,
      allowanceEpfLiable: epfLiableAllowance,
      allowanceExempt: exemptAllowance,
      overtimeAmount: input.overtime.amount,
      bonusAmount,
      commissionAmount,
    },
    {
      // PCB is not computed. It depends on declared reliefs and dependants under the LHDN
      // schedule; a guess under-deducts and the employee gets the bill at assessment. Enterable
      // per payslip once the period exists, which is why it starts at zero rather than absent.
      taxDeduction: 0,
      loanDeduction,
      advanceDeduction,
      otherDeductions: 0,
    },
    rates,
  );

  const lines: DraftLine[] = [];
  let order = 0;
  const add = (
    kind: DraftLine['kind'],
    source: string,
    sourceId: number | null,
    label: string,
    amount: number,
  ): void => {
    if (amount === 0) return;
    order += 1;
    lines.push({ kind, source, sourceId, label, amount, sortOrder: order });
  };

  add('earning', 'basic', null, 'Gaji asas', input.basicSalary);
  for (const row of input.allowances) add('earning', 'allowance', row.id, row.label, row.amount);
  if (input.overtime.amount > 0) {
    add(
      'earning',
      'overtime',
      null,
      `Kerja lebih masa diluluskan (${(input.overtime.minutes / 60).toFixed(2)} jam)`,
      toSen(input.overtime.amount),
    );
  }
  for (const row of input.bonuses) add('earning', 'bonus', row.id, row.label, row.amount);
  for (const row of input.commissions) {
    add('earning', 'commission', row.id, row.label, row.amount);
  }

  add('deduction', 'epf', null, 'KWSP (pekerja)', math.epfEmployee);
  add('deduction', 'socso', null, 'PERKESO (pekerja)', math.socsoEmployee);
  add('deduction', 'eis', null, 'SIP (pekerja)', math.eisEmployee);
  if (input.loan !== null) {
    add('deduction', 'loan', input.loan.id, input.loan.label, loanDeduction);
  }
  if (input.advance !== null) {
    add('deduction', 'advance', input.advance.id, input.advance.label, advanceDeduction);
  }

  await tx.payslip.create({
    data: {
      payslipNo: payslipNo(period.periodYear, period.periodMonth, sequence),
      periodId: period.id,
      staffId: input.staffId,
      basicSalary: input.basicSalary,
      allowanceAmount: toSen(epfLiableAllowance + exemptAllowance),
      overtimeAmount: toSen(input.overtime.amount),
      bonusAmount,
      commissionAmount,
      gross: math.gross,
      epfWages: math.epfWages,
      contributoryWages: math.contributoryWages,
      epfEmployee: math.epfEmployee,
      socsoEmployee: math.socsoEmployee,
      eisEmployee: math.eisEmployee,
      taxDeduction: 0,
      loanDeduction,
      advanceDeduction,
      otherDeductions: 0,
      totalDeductions: math.totalDeductions,
      netPay: math.netPay,
      epfEmployer: math.epfEmployer,
      socsoEmployer: math.socsoEmployer,
      eisEmployer: math.eisEmployer,
      scheduledDays: input.summary.scheduledDays,
      presentDays: input.summary.presentDays,
      absentDays: input.summary.absentDays,
      leaveDays: input.summary.leaveDays,
      overtimeMinutes: input.overtime.minutes,
      status: 'draft',
      lines: { create: lines },
    },
  });

  /*
   * The balances move inside the same transaction as the payslip that deducted the money.
   *
   * Outside it, a failure between the two leaves the balance and the payslip disagreeing — and
   * the one somebody trusts is the balance.
   */
  if (input.loan !== null && loanState !== null && loanDeduction > 0) {
    const remaining = toSen(Number(loanState.remainingBalance) - loanDeduction);
    await tx.staffLoan.update({
      where: { id: input.loan.id },
      data: {
        remainingBalance: Math.max(0, remaining),
        paidInstalments: loanState.paidInstalments + 1,
        // A hundredth of a sen of slack: the balance is arrived at by subtraction, and demanding
        // exactly zero would leave a loan open on a rounding artefact nobody can pay off.
        ...(remaining <= 0.009 ? { status: 'completed', closedOn: asDateOnly(new Date()) } : {}),
      },
    });
  }

  if (input.advance !== null && advanceState !== null && advanceDeduction > 0) {
    const remaining = toSen(Number(advanceState.remainingBalance) - advanceDeduction);
    await tx.staffAdvance.update({
      where: { id: input.advance.id },
      data: {
        remainingBalance: Math.max(0, remaining),
        paidMonths: advanceState.paidMonths + 1,
        ...(remaining <= 0.009 ? { status: 'completed', closedOn: asDateOnly(new Date()) } : {}),
      },
    });
  }

  return {
    gross: math.gross,
    totalDeductions: math.totalDeductions,
    netPay: math.netPay,
    employerCost: math.employerCost,
  };
}
