/**
 * Payroll arithmetic: the statutory three, the payslip totals, and the period guards.
 *
 * Import-free apart from `money.ts`, so `scripts/test-payroll.mts` executes this exact source
 * rather than a paraphrase of it. Nothing here touches a database and nothing here reads a
 * clock — the rates arrive as an argument and the attendance figures arrive as an argument.
 *
 * ## The rates are DATA, and they are not verified
 *
 * Every figure in `STATUTORY_DEFAULTS` is seeded as an editable setting flagged for review, not
 * as a constant, and that is not a style preference. EPF's employer rate steps down at a wage
 * threshold; SOCSO and EIS have wage ceilings that have moved twice by government announcement.
 * A rate in a source file means a deployment to obey the law.
 *
 * **These defaults have not been checked against the current PERKESO or KWSP schedules.** They
 * are a starting point so the screens are usable, and the settings screen says so in as many
 * words. Finance must confirm them before a period is paid.
 *
 * Two known approximations, both stated on the settings screen rather than hidden here:
 *
 *   - **SOCSO and EIS are a percentage with a ceiling.** The real contribution is a wage-band
 *     table of fixed sen amounts, roughly thirty rows. The percentage is close and it is not
 *     exact, so a statement produced from this will not reconcile to PERKESO to the sen.
 *   - **PCB is zero.** It depends on declared reliefs, marital status and dependants under the
 *     LHDN schedule. A guessed figure under-deducts and leaves the employee holding the bill at
 *     assessment, so the field is enterable per payslip and computed by nothing.
 */

import { MAX_BONUS_MONTHS } from './kpi.js';
import { toSen } from './money.js';

// ---------------------------------------------------------------------------
// Statutory rates
// ---------------------------------------------------------------------------

/**
 * The rates and thresholds a run needs. Percentages, not fractions.
 *
 * Held as a flat record of strings in `hr_module_settings` under module `payroll`, and parsed
 * by `parseStatutory` below.
 */
export interface StatutoryRates {
  epfEmployeeRate: number;
  /** Employer rate while EPF wages are at or below `epfWageThreshold`. */
  epfEmployerRate: number;
  /** Employer rate above that threshold. Statutorily the lower of the two. */
  epfEmployerRateHigh: number;
  epfWageThreshold: number;
  /** Whether bonus and commission count as EPF wages. They do; a company may differ. */
  epfIncludeBonus: boolean;
  socsoEmployeeRate: number;
  socsoEmployerRate: number;
  /** Wages above this attract no more SOCSO. 0 disables the ceiling. */
  socsoWageCeiling: number;
  eisEmployeeRate: number;
  eisEmployerRate: number;
  eisWageCeiling: number;
}

/**
 * Starting values, at the figures that were current when this was written.
 *
 * Seeded as rows so they can be corrected without a deployment. See the file header: these are
 * NOT verified against a current statutory schedule.
 */
export const STATUTORY_DEFAULTS: StatutoryRates = {
  epfEmployeeRate: 11,
  epfEmployerRate: 13,
  epfEmployerRateHigh: 12,
  epfWageThreshold: 5000,
  epfIncludeBonus: true,
  socsoEmployeeRate: 0.5,
  socsoEmployerRate: 1.75,
  socsoWageCeiling: 6000,
  eisEmployeeRate: 0.2,
  eisEmployerRate: 0.2,
  eisWageCeiling: 6000,
};

/** Non-rate settings the module carries. Kept separate: these are not money. */
export const PAYROLL_SETTING_DEFAULTS = {
  epfEmployeeRate: '11',
  epfEmployerRate: '13',
  epfEmployerRateHigh: '12',
  epfWageThreshold: '5000',
  epfIncludeBonus: '1',
  socsoEmployeeRate: '0.5',
  socsoEmployerRate: '1.75',
  socsoWageCeiling: '6000',
  eisEmployeeRate: '0.2',
  eisEmployerRate: '0.2',
  eisWageCeiling: '6000',
  /** Day of the month wages are transferred. Offered as the default on a new period. */
  payDay: '25',
  /**
   * Whether an operator has confirmed the rates against a current statutory schedule.
   *
   * `'0'` until somebody says otherwise, and the screen carries a warning while it is. This is
   * the one setting that exists to be answered rather than tuned: seeded rates that nobody has
   * checked look identical to rates that finance signed off.
   */
  ratesReviewed: '0',
} as const;

export type PayrollSettingKey = keyof typeof PAYROLL_SETTING_DEFAULTS;

export const PAYROLL_SETTING_KEYS = Object.keys(
  PAYROLL_SETTING_DEFAULTS,
) as PayrollSettingKey[];

export type PayrollSettings = Record<PayrollSettingKey, string>;

/** The rates out of a settings record, falling back to the default per key. */
export function parseStatutory(settings: Partial<PayrollSettings>): StatutoryRates {
  const number = (key: PayrollSettingKey, fallback: number): number => {
    const raw = settings[key];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };

  return {
    epfEmployeeRate: number('epfEmployeeRate', STATUTORY_DEFAULTS.epfEmployeeRate),
    epfEmployerRate: number('epfEmployerRate', STATUTORY_DEFAULTS.epfEmployerRate),
    epfEmployerRateHigh: number('epfEmployerRateHigh', STATUTORY_DEFAULTS.epfEmployerRateHigh),
    epfWageThreshold: number('epfWageThreshold', STATUTORY_DEFAULTS.epfWageThreshold),
    epfIncludeBonus: (settings.epfIncludeBonus ?? PAYROLL_SETTING_DEFAULTS.epfIncludeBonus) === '1',
    socsoEmployeeRate: number('socsoEmployeeRate', STATUTORY_DEFAULTS.socsoEmployeeRate),
    socsoEmployerRate: number('socsoEmployerRate', STATUTORY_DEFAULTS.socsoEmployerRate),
    socsoWageCeiling: number('socsoWageCeiling', STATUTORY_DEFAULTS.socsoWageCeiling),
    eisEmployeeRate: number('eisEmployeeRate', STATUTORY_DEFAULTS.eisEmployeeRate),
    eisEmployerRate: number('eisEmployerRate', STATUTORY_DEFAULTS.eisEmployerRate),
    eisWageCeiling: number('eisWageCeiling', STATUTORY_DEFAULTS.eisWageCeiling),
  };
}

/**
 * Field-level faults in a rates form, as label keys. Empty means it is acceptable.
 *
 * Refusal, not silent clamping. A rate quietly raised to a floor leaves the screen showing one
 * number and the run using another, and the difference only surfaces as a payslip nobody can
 * reproduce.
 */
export function checkStatutory(input: Partial<Record<PayrollSettingKey, string>>): Record<string, string> {
  const faults: Record<string, string> = {};

  const percent = (key: PayrollSettingKey): void => {
    const raw = input[key];
    if (raw === undefined) return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      faults[key] = 'pay.settings.fault.percent';
    }
  };

  const amount = (key: PayrollSettingKey): void => {
    const raw = input[key];
    if (raw === undefined) return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) {
      faults[key] = 'pay.settings.fault.amount';
    }
  };

  percent('epfEmployeeRate');
  percent('epfEmployerRate');
  percent('epfEmployerRateHigh');
  percent('socsoEmployeeRate');
  percent('socsoEmployerRate');
  percent('eisEmployeeRate');
  percent('eisEmployerRate');
  amount('epfWageThreshold');
  amount('socsoWageCeiling');
  amount('eisWageCeiling');

  const payDay = input.payDay;
  if (payDay !== undefined) {
    const value = Number(payDay);
    if (!Number.isInteger(value) || value < 1 || value > 31) {
      faults.payDay = 'pay.settings.fault.payDay';
    }
  }

  /*
   * The employer rate above the threshold cannot exceed the one below it.
   *
   * The statutory step at the threshold goes down, never up. Entered backwards it
   * over-contributes for every senior employee, every month, and the employer pays that —
   * quietly, because both figures look plausible on their own.
   */
  const low = input.epfEmployerRate;
  const high = input.epfEmployerRateHigh;
  if (low !== undefined && high !== undefined && Number(high) > Number(low)) {
    faults.epfEmployerRateHigh = 'pay.settings.fault.step';
  }

  return faults;
}

// ---------------------------------------------------------------------------
// The payslip
// ---------------------------------------------------------------------------

/** A wage figure clipped to a ceiling. A ceiling of 0 or below means no ceiling. */
export function capped(wages: number, ceiling: number): number {
  const value = Number.isFinite(wages) && wages > 0 ? wages : 0;
  if (!Number.isFinite(ceiling) || ceiling <= 0) return value;
  return Math.min(value, ceiling);
}

/** What somebody earns this period, before anything is taken off. */
export interface Earnings {
  basicSalary: number;
  /** Allowances that count toward the EPF wage base. */
  allowanceEpfLiable: number;
  /** Allowances that do not — a travel reimbursement is not wages. */
  allowanceExempt: number;
  overtimeAmount: number;
  bonusAmount: number;
  commissionAmount: number;
}

/**
 * Deductions the run is told about rather than works out.
 *
 * A loan instalment is a contract and PCB depends on somebody's declared reliefs. Neither is
 * arithmetic this function is entitled to invent.
 */
export interface KnownDeductions {
  taxDeduction: number;
  loanDeduction: number;
  advanceDeduction: number;
  otherDeductions: number;
}

export interface PayslipMath {
  gross: number;
  /** Wages attracting EPF: no overtime; bonus and commission only if the setting says so. */
  epfWages: number;
  /** Ordinary monthly wages, which is what SOCSO and EIS are charged on, before the ceiling. */
  contributoryWages: number;
  epfEmployee: number;
  epfEmployer: number;
  socsoEmployee: number;
  socsoEmployer: number;
  eisEmployee: number;
  eisEmployer: number;
  totalDeductions: number;
  netPay: number;
  /** Employer EPF + SOCSO + EIS. Deducted from nobody; it is what the person costs. */
  employerCost: number;
}

const finite = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/**
 * Everything one payslip needs, from the earnings and the rates.
 *
 * Rounded to the sen at every figure that reaches a `Decimal(12,2)` column, using `toSen` and
 * not `Math.round(v * 100) / 100` — the latter is a sen short at exactly the boundary it exists
 * to handle, and an hourly rate of 10.01 at 1.5× for one hour is exactly that number.
 *
 * Overtime sits outside every statutory base. Overtime pay is not EPF wages, and SOCSO and EIS
 * are charged on ordinary monthly wages.
 */
export function computePayslip(
  earnings: Partial<Earnings>,
  known: Partial<KnownDeductions>,
  rates: StatutoryRates = STATUTORY_DEFAULTS,
): PayslipMath {
  const basic = finite(earnings.basicSalary);
  const epfAllowance = finite(earnings.allowanceEpfLiable);
  const exemptAllowance = finite(earnings.allowanceExempt);
  const overtime = finite(earnings.overtimeAmount);
  const bonus = finite(earnings.bonusAmount);
  const commission = finite(earnings.commissionAmount);

  const gross = toSen(
    basic + epfAllowance + exemptAllowance + overtime + bonus + commission,
  );

  const epfWages = toSen(
    basic + epfAllowance + (rates.epfIncludeBonus ? bonus + commission : 0),
  );
  const contributoryWages = toSen(basic + epfAllowance);

  /*
   * Strictly above the threshold takes the lower rate.
   *
   * At exactly the threshold the higher rate applies — the step is "above RM5,000", so
   * RM5,000.00 itself is on the lower side of it. `>=` here would move every employee sitting
   * exactly on the threshold to the wrong rate, which is a common salary figure.
   */
  const employerRate =
    epfWages > rates.epfWageThreshold ? rates.epfEmployerRateHigh : rates.epfEmployerRate;

  const socsoBase = capped(contributoryWages, rates.socsoWageCeiling);
  const eisBase = capped(contributoryWages, rates.eisWageCeiling);

  const epfEmployee = toSen((epfWages * rates.epfEmployeeRate) / 100);
  const epfEmployer = toSen((epfWages * employerRate) / 100);
  const socsoEmployee = toSen((socsoBase * rates.socsoEmployeeRate) / 100);
  const socsoEmployer = toSen((socsoBase * rates.socsoEmployerRate) / 100);
  const eisEmployee = toSen((eisBase * rates.eisEmployeeRate) / 100);
  const eisEmployer = toSen((eisBase * rates.eisEmployerRate) / 100);

  const totalDeductions = toSen(
    epfEmployee +
      socsoEmployee +
      eisEmployee +
      finite(known.taxDeduction) +
      finite(known.loanDeduction) +
      finite(known.advanceDeduction) +
      finite(known.otherDeductions),
  );

  return {
    gross,
    epfWages,
    contributoryWages,
    epfEmployee,
    epfEmployer,
    socsoEmployee,
    socsoEmployer,
    eisEmployee,
    eisEmployer,
    totalDeductions,
    netPay: toSen(gross - totalDeductions),
    employerCost: toSen(epfEmployer + socsoEmployer + eisEmployer),
  };
}

/**
 * One allowance row resolved to ringgit for this period.
 *
 * `percentOfBasic` is a share of basic salary and nothing else. Compounding it over other
 * allowances would make the order the rows are read in change what somebody is paid.
 */
export function allowanceValue(
  calcMode: string,
  value: number,
  basicSalary: number,
): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (calcMode === 'percentOfBasic') {
    const basic = Number.isFinite(basicSalary) && basicSalary > 0 ? basicSalary : 0;
    return toSen((basic * value) / 100);
  }
  return toSen(value);
}

/**
 * The instalment to take this period, never more than what is still owed.
 *
 * The last instalment is the remaining balance rather than the contracted figure. Taking the
 * full instalment on a balance of RM40 collects RM250 and leaves the balance at minus RM210,
 * which is money owed back to somebody who has no way of noticing.
 */
export function instalmentDue(monthly: number, remainingBalance: number): number {
  const owed = Number.isFinite(remainingBalance) && remainingBalance > 0 ? remainingBalance : 0;
  const instalment = Number.isFinite(monthly) && monthly > 0 ? monthly : 0;
  return toSen(Math.min(instalment, owed));
}

/** An advance's monthly recovery, from the amount and the months chosen. */
export function monthlyRecovery(principal: number, months: number): number {
  if (!Number.isFinite(principal) || principal <= 0) return 0;
  if (!Number.isInteger(months) || months < 1) return 0;
  return toSen(principal / months);
}

// ---------------------------------------------------------------------------
// Period guards
// ---------------------------------------------------------------------------

export const PERIOD_STATUSES = ['draft', 'processing', 'approved', 'paid', 'closed'] as const;

export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

/**
 * What each status permits, as a label key naming the refusal.
 *
 * One way, no reverse. There is no route back from `approved` because the numbers have been
 * signed by then, and a reversal that leaves no trace is indistinguishable from the figures
 * having always been what they now are. A mistake found after approval is corrected by an
 * adjustment in a later period, which is what an auditor can follow.
 */
export const PERIOD_TRANSITIONS: Record<PeriodStatus, PeriodStatus | null> = {
  draft: 'processing',
  processing: 'approved',
  approved: 'paid',
  paid: 'closed',
  closed: null,
};

/** Null when the move is allowed, otherwise the label key saying why it is not. */
export function checkTransition(from: string, to: PeriodStatus): string | null {
  if (!(PERIOD_STATUSES as readonly string[]).includes(from)) {
    return 'pay.period.fault.status';
  }
  if (PERIOD_TRANSITIONS[from as PeriodStatus] !== to) {
    return 'pay.period.fault.transition';
  }
  return null;
}

/**
 * Statuses that accept a write to the period or anything under it.
 *
 * `closed` refuses everything, enforced in the route and not left to the interface. The
 * reference locked a closed period by convention and nothing stopped an update reaching its
 * payslips — a lock that only exists in the screen is a lock against people using the screen.
 */
export function isWritable(status: string): boolean {
  return status === 'draft' || status === 'processing';
}

/** Only a draft may be rebuilt. Approved figures are the record, not a cache of one. */
export function isRebuildable(status: string): boolean {
  return status === 'draft';
}

export interface PeriodRange {
  id?: number;
  fromKey: string;
  toKey: string;
}

/**
 * The existing period a proposed range collides with, or null.
 *
 * Overlap is the double-pay hazard and it is not detectable from either period alone. Two
 * cycles covering one day each pick up that day's approved overtime, so it is paid twice, from
 * two payslips that both look correct. A database cannot express this across sibling rows.
 */
export function findOverlap(
  proposed: PeriodRange,
  existing: PeriodRange[],
): PeriodRange | null {
  for (const row of existing) {
    if (proposed.id !== undefined && row.id === proposed.id) continue;
    if (proposed.fromKey <= row.toKey && row.fromKey <= proposed.toKey) return row;
  }
  return null;
}

/**
 * A payslip's own arithmetic, checked against itself.
 *
 * Prisma has no generated columns, so nothing in the database enforces that the lines add up to
 * the total. This does, and `scripts/test-payroll.mts` runs it over every generated row: a
 * payslip whose parts do not sum to its net is a payslip somebody will recompute by hand and
 * disagree with.
 */
export function payslipBalances(row: {
  basicSalary: number;
  allowanceAmount: number;
  overtimeAmount: number;
  bonusAmount: number;
  commissionAmount: number;
  gross: number;
  epfEmployee: number;
  socsoEmployee: number;
  eisEmployee: number;
  taxDeduction: number;
  loanDeduction: number;
  advanceDeduction: number;
  otherDeductions: number;
  totalDeductions: number;
  netPay: number;
}): string | null {
  const earnings = toSen(
    row.basicSalary +
      row.allowanceAmount +
      row.overtimeAmount +
      row.bonusAmount +
      row.commissionAmount,
  );
  if (earnings !== toSen(row.gross)) return 'pay.payslip.fault.gross';

  const deductions = toSen(
    row.epfEmployee +
      row.socsoEmployee +
      row.eisEmployee +
      row.taxDeduction +
      row.loanDeduction +
      row.advanceDeduction +
      row.otherDeductions,
  );
  if (deductions !== toSen(row.totalDeductions)) return 'pay.payslip.fault.deductions';

  if (toSen(row.gross - row.totalDeductions) !== toSen(row.netPay)) {
    return 'pay.payslip.fault.net';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bonus from a KPI grade
// ---------------------------------------------------------------------------

/**
 * A performance bonus from an appraisal's grade.
 *
 * `bonusMonths` is months of basic salary, so grade A at 1.50 pays one and a half months. It was
 * called `bonusFactor` and the screen showed `1.5`, a number with no unit attached — a multiplier
 * of what, over what period. Every bonus policy anybody writes is written in months, so the column
 * says months and the screen says so too.
 *
 * The months live on the grade and the amount lives on the bonus row, because months are policy and
 * an amount is a payment — repricing the policy must not reprice a bonus already approved.
 *
 * Clamped at `MAX_BONUS_MONTHS`, not refused. `checkBonusMonths` refuses on the way in, which is
 * where a typo can still be corrected; by the time a payroll run reads a stored grade the only
 * choices left are to pay a wrong figure or to pay a capped one, and a capped one is visible in
 * the payslip line.
 *
 * Returns 0 when the grade carries no bonus, which is the honest answer for a grade not meant to
 * pay.
 */
export function kpiBonusAmount(basicSalary: number, bonusMonths: number | null): number {
  if (bonusMonths === null || !Number.isFinite(bonusMonths) || bonusMonths <= 0) return 0;
  if (!Number.isFinite(basicSalary) || basicSalary <= 0) return 0;
  return toSen(basicSalary * Math.min(bonusMonths, MAX_BONUS_MONTHS));
}
