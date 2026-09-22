import type { LabelKey } from '@attendance/shared';

import { api } from './api';

/**
 * Payroll: periods, payslips, and the five things that add to or subtract from one.
 *
 * The status maps below hold `LabelKey` rather than words, like every other enum map in this
 * folder. Printing `MAP[value] ?? value` puts the key on screen, which `tsc` cannot catch
 * because both sides are strings — every call site wraps them in `<TEnum>` or `tEnum()`.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** A period's progression. One way; there is no route back from `approved`. */
export type PeriodStatus = 'draft' | 'processing' | 'approved' | 'paid' | 'closed';

export const PERIOD_STATUS_LABELS: Record<PeriodStatus, LabelKey> = {
  draft: 'pay.status.draft',
  processing: 'pay.status.processing',
  approved: 'pay.status.approved',
  paid: 'pay.status.paid',
  closed: 'pay.status.closed',
};

/**
 * What a payslip, an award or a lending arrangement is.
 *
 * Separate from `PERIOD_STATUS_LABELS` even where the words coincide: a period is approved as a
 * batch, a loan is active as a standing arrangement, and one map would force whoever translates
 * this to use the same word for both.
 */
export type RecordState =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'active'
  | 'completed'
  | 'paid'
  | 'cancelled';

export const RECORD_STATE_LABELS: Record<RecordState, LabelKey> = {
  draft: 'pay.state.draft',
  pending: 'pay.state.pending',
  approved: 'pay.state.approved',
  active: 'pay.state.active',
  completed: 'pay.state.completed',
  paid: 'pay.state.paid',
  cancelled: 'pay.state.cancelled',
};

export type BonusType =
  | 'performance'
  | 'annual'
  | 'festival'
  | 'project'
  | 'attendance'
  | 'other';

export const BONUS_TYPE_LABELS: Record<BonusType, LabelKey> = {
  performance: 'pay.bonusType.performance',
  annual: 'pay.bonusType.annual',
  festival: 'pay.bonusType.festival',
  project: 'pay.bonusType.project',
  attendance: 'pay.bonusType.attendance',
  other: 'pay.bonusType.other',
};

export type CommissionType = 'sales' | 'project' | 'referral' | 'other';

export const COMMISSION_TYPE_LABELS: Record<CommissionType, LabelKey> = {
  sales: 'pay.commissionType.sales',
  project: 'pay.commissionType.project',
  referral: 'pay.commissionType.referral',
  other: 'pay.commissionType.other',
};

export type PaymentMethod = 'bank_transfer' | 'cash' | 'cheque';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, LabelKey> = {
  bank_transfer: 'pay.method.bank_transfer',
  cash: 'pay.method.cash',
  cheque: 'pay.method.cheque',
};

/** How an allowance is worked out. Two words that change what the stored number means. */
export type CalcMode = 'fixed' | 'percentOfBasic';

export const CALC_MODE_LABELS: Record<CalcMode, LabelKey> = {
  fixed: 'pay.calcMode.fixed',
  percentOfBasic: 'pay.calcMode.percentOfBasic',
};

/** Refusals the server names as keys, so the wording lives in the registry. */
export const BALANCE_FAULT_LABELS: Record<string, LabelKey> = {
  'pay.payslip.fault.gross': 'pay.payslip.fault.gross',
  'pay.payslip.fault.deductions': 'pay.payslip.fault.deductions',
  'pay.payslip.fault.net': 'pay.payslip.fault.net',
};

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export interface PayrollPeriod {
  id: number;
  code: string;
  name: string;
  periodYear: number;
  periodMonth: number;
  /** Calendar dates, so `formatDateOnly` and never `new Date(...).toLocaleDateString()`. */
  fromDate: string;
  toDate: string;
  paymentDate: string;
  status: PeriodStatus;
  staffCount: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  /** Employer EPF, SOCSO and EIS. Deducted from nobody; it is what the cycle costs. */
  totalEmployerCost: number;
  payslipCount: number;
  paymentMethod: PaymentMethod | null;
  paymentReference: string | null;
  processedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  closedAt: string | null;
  note: string | null;
}

export interface PeriodPage {
  rows: PayrollPeriod[];
  /** Every status, ignoring the status filter, so picking a chip does not zero the others. */
  counts: Record<string, number>;
  /** False until finance has confirmed the statutory rates. Every screen says so while it is. */
  ratesReviewed: boolean;
  payDay: number;
  generatedAt: string;
}

export interface PeriodInput {
  name: string;
  periodYear: number;
  periodMonth: number;
  fromDate: string;
  toDate: string;
  paymentDate: string;
  note?: string;
}

export interface RunResult {
  staffCount: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalEmployerCost: number;
  /** Active staff with no basic salary recorded. Reported, never guessed at. */
  withoutSalary: number;
}

// ---------------------------------------------------------------------------
// Payslips
// ---------------------------------------------------------------------------

export interface PayslipRow {
  id: number;
  payslipNo: string;
  employeeNo: string;
  fullName: string;
  department: string | null;
  basicSalary: number;
  allowanceAmount: number;
  overtimeAmount: number;
  bonusAmount: number;
  commissionAmount: number;
  gross: number;
  totalDeductions: number;
  netPay: number;
  status: RecordState;
}

export interface PayslipPage {
  period: { id: number; code: string; name: string; status: PeriodStatus; fromDate: string; toDate: string };
  rows: PayslipRow[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
}

export interface PayslipLine {
  id: number;
  kind: 'earning' | 'deduction';
  source: string;
  sourceId: number | null;
  /** Written in source words at the time. Never translated afterwards: it is a record. */
  label: string;
  amount: number;
  sortOrder: number;
}

export interface PayslipDetail {
  id: number;
  payslipNo: string;
  periodId: number;
  staffId: number;
  basicSalary: number;
  allowanceAmount: number;
  overtimeAmount: number;
  bonusAmount: number;
  commissionAmount: number;
  gross: number;
  epfWages: number;
  contributoryWages: number;
  epfEmployee: number;
  socsoEmployee: number;
  eisEmployee: number;
  taxDeduction: number;
  loanDeduction: number;
  advanceDeduction: number;
  otherDeductions: number;
  totalDeductions: number;
  netPay: number;
  epfEmployer: number;
  socsoEmployer: number;
  eisEmployer: number;
  scheduledDays: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  overtimeMinutes: number;
  status: RecordState;
  note: string | null;
  lines: PayslipLine[];
  period: { code: string; name: string; status: PeriodStatus; paymentDate: string };
  staff: { employeeNo: string; fullName: string; icNo: string | null; department: { name: string } | null };
  /**
   * Null when the payslip adds up.
   *
   * Shown rather than assumed away: nothing in the database enforces that the lines sum to the
   * net, so the check has to be visible where somebody is about to approve it.
   */
  balanceFault: string | null;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface StatutoryRates {
  epfEmployeeRate: number;
  epfEmployerRate: number;
  epfEmployerRateHigh: number;
  epfWageThreshold: number;
  epfIncludeBonus: boolean;
  socsoEmployeeRate: number;
  socsoEmployerRate: number;
  socsoWageCeiling: number;
  eisEmployeeRate: number;
  eisEmployerRate: number;
  eisWageCeiling: number;
}

export interface PayrollSettingsPayload {
  settings: Record<string, string>;
  /** Parsed the way a run reads them, so the screen shows what will actually be applied. */
  rates: StatutoryRates;
  /** Approximations somebody has to know about before signing a period off. */
  caveatKeys: string[];
}

// ---------------------------------------------------------------------------
// Allowances
// ---------------------------------------------------------------------------

export interface AllowanceType {
  id: number;
  code: string;
  name: string;
  description: string | null;
  calcMode: CalcMode;
  defaultAmount: number | null;
  epfLiable: boolean;
  taxable: boolean;
  active: boolean;
  /** Non-zero freezes `calcMode` and `epfLiable`: changing either reprices what was paid. */
  usageCount: number;
}

export interface AllowanceTypeInput {
  code: string;
  name: string;
  description?: string;
  calcMode: CalcMode;
  defaultAmount?: number | null;
  epfLiable?: boolean;
  taxable?: boolean;
  active?: boolean;
}

export interface StaffAllowanceRow {
  id: number;
  staffId: number;
  employeeNo: string;
  fullName: string;
  typeCode: string;
  typeName: string;
  calcMode: CalcMode;
  epfLiable: boolean;
  /** A ringgit amount or a percentage, according to `calcMode`. */
  value: number;
  /** What the run will actually pay, so a percentage is not read as ringgit. */
  resolved: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
  note: string | null;
}

export interface AllowancePage {
  rows: StaffAllowanceRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  generatedAt: string;
}

export interface StaffAllowanceInput {
  staffId: number;
  typeId: number;
  value: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  active?: boolean;
  note?: string;
}

// ---------------------------------------------------------------------------
// Awards, and lending
// ---------------------------------------------------------------------------

export interface AwardRow {
  id: number;
  reference: string;
  staffId: number;
  employeeNo: string;
  fullName: string;
  kind: string;
  name: string;
  amount: number;
  onDate: string;
  periodId: number | null;
  periodCode: string | null;
  periodStatus: PeriodStatus | null;
  status: RecordState;
  /** True when this came from a finalised appraisal. One appraisal pays at most once. */
  fromAppraisal: boolean;
  note: string | null;
}

export interface AwardPage {
  rows: AwardRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  generatedAt: string;
}

export interface AwardInput {
  staffId: number;
  periodId?: number | null;
  kind: string;
  name: string;
  amount: number;
  onDate: string;
  note?: string;
}

export interface LendingRow {
  id: number;
  reference: string;
  staffId: number;
  employeeNo: string;
  fullName: string;
  principal: number;
  instalment: number;
  totalInstalments: number;
  paidInstalments: number;
  remainingBalance: number;
  issuedOn: string;
  /** Compared against the period. A future start does not deduct from this run. */
  startsOn: string;
  closedOn: string | null;
  reason: string | null;
  status: RecordState;
  note: string | null;
}

export interface LendingPage {
  rows: LendingRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  generatedAt: string;
}

export interface LendingInput {
  staffId: number;
  principal: number;
  /** Loans carry an agreed instalment. For an advance it is derived from the months. */
  monthlyInstalment?: number;
  months: number;
  issuedOn: string;
  startsOn: string;
  reason?: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

export const payrollApi = {
  periods: (filters: { status?: string; year?: number } = {}) =>
    api.get<PeriodPage>(`/api/payroll/periods${query(filters)}`),
  createPeriod: (input: PeriodInput) =>
    api.post<{ id: number; code: string }>('/api/payroll/periods', input),
  updatePeriod: (id: number, input: Partial<PeriodInput>) =>
    api.patch<{ ok: true }>(`/api/payroll/periods/${String(id)}`, input),
  removePeriod: (id: number) => api.delete<{ ok: true }>(`/api/payroll/periods/${String(id)}`),

  process: (id: number) =>
    api.post<RunResult>(`/api/payroll/periods/${String(id)}/process`, {}),
  approvePeriod: (id: number, note?: string) =>
    api.post<{ ok: true; payslipCount: number }>(`/api/payroll/periods/${String(id)}/approve`, {
      note,
    }),
  payPeriod: (
    id: number,
    input: { paymentMethod: PaymentMethod; paymentReference: string; note?: string },
  ) => api.post<{ ok: true }>(`/api/payroll/periods/${String(id)}/pay`, input),
  closePeriod: (id: number, note?: string) =>
    api.post<{ ok: true }>(`/api/payroll/periods/${String(id)}/close`, { note }),

  payslips: (
    periodId: number,
    filters: { page?: number; pageSize?: number; search?: string; departmentId?: number } = {},
  ) => api.get<PayslipPage>(`/api/payroll/periods/${String(periodId)}/payslips${query(filters)}`),
  payslip: (id: number) => api.get<PayslipDetail>(`/api/payroll/payslips/${String(id)}`),
  updatePayslip: (
    id: number,
    input: { taxDeduction?: number; otherDeductions?: number; note?: string },
  ) => api.patch<{ ok: true }>(`/api/payroll/payslips/${String(id)}`, input),

  /** A URL rather than a fetch: the browser downloads it, carrying the session cookie. */
  exportUrl: (periodId: number) => `/api/payroll/periods/${String(periodId)}/export`,

  settings: () => api.get<PayrollSettingsPayload>('/api/payroll/settings'),
  saveSettings: (settings: Record<string, string>) =>
    api.put<{ ok: true }>('/api/payroll/settings', { settings }),

  allowanceTypes: () => api.get<AllowanceType[]>('/api/payroll/allowance-types'),
  createAllowanceType: (input: AllowanceTypeInput) =>
    api.post<{ id: number; code: string }>('/api/payroll/allowance-types', input),
  updateAllowanceType: (id: number, input: Partial<AllowanceTypeInput>) =>
    api.patch<{ ok: true }>(`/api/payroll/allowance-types/${String(id)}`, input),
  removeAllowanceType: (id: number) =>
    api.delete<{ ok: true }>(`/api/payroll/allowance-types/${String(id)}`),

  allowances: (
    filters: {
      page?: number;
      pageSize?: number;
      search?: string;
      typeId?: number;
      active?: string;
    } = {},
  ) => api.get<AllowancePage>(`/api/payroll/allowances${query(filters)}`),
  createAllowance: (input: StaffAllowanceInput) =>
    api.post<{ id: number }>('/api/payroll/allowances', input),
  updateAllowance: (
    id: number,
    input: Partial<Omit<StaffAllowanceInput, 'staffId' | 'typeId'>>,
  ) => api.patch<{ ok: true }>(`/api/payroll/allowances/${String(id)}`, input),
  removeAllowance: (id: number) =>
    api.delete<{ ok: true }>(`/api/payroll/allowances/${String(id)}`),

  /**
   * Bonuses and commissions share a shape and not an endpoint.
   *
   * `kind` here is the path segment, and each path is gated by its own permission key. One
   * endpoint taking a discriminator would have to pick a key to check, and whichever it picked
   * would grant the other for free.
   */
  awards: (
    kind: 'bonuses' | 'commissions',
    filters: {
      page?: number;
      pageSize?: number;
      search?: string;
      status?: string;
      periodId?: number;
    } = {},
  ) => api.get<AwardPage>(`/api/payroll/${kind}${query(filters)}`),
  createAward: (kind: 'bonuses' | 'commissions', input: AwardInput) =>
    api.post<{ id: number }>(`/api/payroll/${kind}`, input),
  updateAward: (
    kind: 'bonuses' | 'commissions',
    id: number,
    input: Partial<Omit<AwardInput, 'staffId'>>,
  ) => api.patch<{ ok: true }>(`/api/payroll/${kind}/${String(id)}`, input),
  decideAward: (
    kind: 'bonuses' | 'commissions',
    id: number,
    input: { action: 'approve' | 'cancel'; note?: string },
  ) => api.post<{ ok: true; status: RecordState }>(
    `/api/payroll/${kind}/${String(id)}/decision`,
    input,
  ),
  removeAward: (kind: 'bonuses' | 'commissions', id: number) =>
    api.delete<{ ok: true }>(`/api/payroll/${kind}/${String(id)}`),

  generateFromAppraisals: (input: { kpiPeriodId: number; periodId: number }) =>
    api.post<{
      created: number;
      skippedExisting: number;
      skippedNoGrade: number;
      skippedNoSalary: number;
    }>('/api/payroll/bonuses/from-appraisals', input),

  lending: (
    kind: 'loans' | 'advances',
    filters: { page?: number; pageSize?: number; search?: string; status?: string } = {},
  ) => api.get<LendingPage>(`/api/payroll/${kind}${query(filters)}`),
  createLending: (kind: 'loans' | 'advances', input: LendingInput) =>
    api.post<{ id: number; instalment: number }>(`/api/payroll/${kind}`, input),
  decideLending: (
    kind: 'loans' | 'advances',
    id: number,
    input: { action: 'approve' | 'cancel'; note?: string },
  ) => api.post<{ ok: true; status: RecordState }>(
    `/api/payroll/${kind}/${String(id)}/decision`,
    input,
  ),
  removeLending: (kind: 'loans' | 'advances', id: number) =>
    api.delete<{ ok: true }>(`/api/payroll/${kind}/${String(id)}`),
};
