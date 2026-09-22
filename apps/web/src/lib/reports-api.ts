import type { LabelKey } from '@attendance/shared';

import { api } from './api';
import type { Paged, StaffRef } from './operations-api';

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

export interface LeaveType {
  id: number;
  code: string;
  name: string;
  /** What the category is for, in the words the applicant reads. Null where none was written. */
  description: string | null;
  /** Zero means the balance is not the control, as with unpaid leave. */
  annualDays: number;
  /**
   * `working` or `calendar` — the unit `annualDays` is in, and the unit a request is charged in.
   *
   * `calendar` charges rest days and public holidays too, because some entitlements are defined
   * that way by statute: maternity leave is 98 consecutive days, not 98 working days.
   */
  countedIn: 'working' | 'calendar';
  /** `all`, `male` or `female`. Refused at apply time, not merely hidden on the form. */
  eligibility: 'all' | 'male' | 'female';
  /** A category that cannot be approved without a document attached. */
  requiresDocument: boolean;
  /**
   * Graded by length of service, with `annualDays` as the first band.
   *
   * Employment Act s.60E grades annual leave 8/12/16 and s.60F grades sick leave 14/18/22, at two
   * and five years of service. So the display is three numbers, not one.
   */
  serviceTiers: boolean;
  annualDaysTier2: number | null;
  annualDaysTier3: number | null;
  /** Unused days roll into the next year, derived from last year rather than stored. */
  carryForward: boolean;
  /** Ceiling on carried days. Null means the whole remainder carries. */
  carryForwardMaxDays: number | null;
  paid: boolean;
  allowBackdated: boolean;
  requiresApproval: boolean;
  colour: string | null;
  active: boolean;
  requestCount: number;
}

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRequestRow {
  id: number;
  staffId: number;
  leaveTypeId: number;
  fromDate: string;
  toDate: string;
  /** Working days, excluding rest days and public holidays. */
  days: number;
  reason: string | null;
  /** Practical detail around the request, where `reason` is the ground for it. */
  remarks: string | null;
  status: LeaveStatus;
  decidedBy: number | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** True when approval replaced shifts that were already on the roster. */
  replacedRoster: boolean;
  createdAt: string;
  leaveType: { id: number; code: string; name: string; paid: boolean; colour: string | null };
  staff: StaffRef & { department: { name: string } | null };
}

export interface LeaveRequestPage extends Paged<LeaveRequestRow> {
  statuses: Record<LeaveStatus, number>;
  types: Array<{ id: number; code: string; name: string; count: number }>;
  generatedAt: string;
}

/** What a range would cost, read before the request is filed. */
export interface LeaveQuote {
  days: number;
  restDays: number;
  holidays: number;
  totalDays: number;
  type: { id: number; code: string; name: string; paid: boolean };
  annualDays: number;
  taken: number;
  pending: number;
  remaining: number | null;
  wouldExceed: boolean;
  /**
   * Live requests already covering part of this range.
   *
   * `status` is a `LeaveStatus`, not a bare string: it comes from the same column as every
   * other request status, and typing it loosely meant the screen could not look up its wording
   * without a cast.
   */
  overlaps: Array<{ id: number; fromDate: string; toDate: string; status: LeaveStatus }>;
  backdated: boolean;
  allowBackdated: boolean;
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export interface RosterEntry {
  workDate: string;
  shiftId: number | null;
  entryType: 'work' | 'rest' | 'leave';
  notes: string | null;
}

export interface RosterStaffRow {
  id: number;
  employeeNo: string;
  fullName: string;
  /** What a day with no entry falls back to. */
  workPattern: { id: number; name: string } | null;
  rosters: RosterEntry[];
}

export interface RosterPage {
  total: number;
  page: number;
  pageSize: number;
  from: string;
  to: string;
  rows: RosterStaffRow[];
}

/**
 * Entry types, as registry keys reusing the calendar's own wording.
 *
 * The month grid already had these three words; a second set for the staff screen would be
 * translated separately and could disagree about what a rest day is called.
 */
export const ROSTER_ENTRY_LABELS: Record<string, LabelKey> = {
  work: 'roster.cell.work',
  rest: 'roster.apply.rest',
  leave: 'roster.apply.leave',
};

export const rosterApi = {
  /**
   * One month of roster.
   *
   * `staffId` narrows to exactly one person and drops the server's `active` filter, so a
   * deactivated record still shows what it was rostered for. `search` cannot substitute: it
   * matches with `contains`, so "100" also returns 1001.
   */
  list: (query: {
    from: string;
    to: string;
    staffId?: number;
    departmentId?: number;
    search?: string;
    page?: number;
    pageSize?: number;
  }) => api.get<RosterPage>(`/api/roster?${toParams(query)}`),
};

export interface LeaveBalance {
  staff: StaffRef;
  year: number;
  balances: Array<{
    type: { id: number; code: string; name: string; paid: boolean };
    /**
     * The entitlement this person has this year — bands and carry-in already applied.
     *
     * Not the type's `annualDays`. A graded type gives a new joiner fewer days than somebody with
     * six years in, so the figure only means anything once a person is named. That is why the apply
     * form loads this the moment an employee is chosen rather than labelling the type list from the
     * type table.
     */
    annualDays: number;
    /** The band before carry-in, so the screen can say where the figure came from. */
    entitlementBase: number;
    carriedIn: number;
    taken: number;
    pending: number;
    remaining: number | null;
  }>;
}

export interface LeaveApplyOutcome {
  rosterWritten: number;
  rosterReplaced: number;
  /** Rest days and public holidays inside the range, left untouched. */
  rosterSkipped: number;
  recordsWritten: number;
}

/** Registry keys, not words — see `EXCEPTION_LABELS` for why. */
export const LEAVE_STATUS_LABELS: Record<LeaveStatus, LabelKey> = {
  pending: 'leaveStatus.pending',
  approved: 'leaveStatus.approved',
  rejected: 'leaveStatus.rejected',
  cancelled: 'leaveStatus.cancelled',
};

export const LEAVE_STATUS_DOT: Record<LeaveStatus, string> = {
  pending: 'bg-amber-500',
  approved: 'bg-emerald-500',
  rejected: 'bg-rose-500',
  cancelled: 'bg-slate-400',
};

export const LEAVE_STATUS_BADGE: Record<LeaveStatus, string> = {
  pending: 'bg-amber-50 text-amber-800',
  approved: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-rose-50 text-rose-700',
  cancelled: 'bg-slate-100 text-slate-600',
};

export const leaveApi = {
  types: () => api.get<LeaveType[]>('/api/leave-types'),
  createType: (input: {
    code: string;
    name: string;
    annualDays: number;
    paid: boolean;
    allowBackdated: boolean;
    requiresApproval: boolean;
    colour?: string;
  }) => api.post<{ id: number }>('/api/leave-types', input),
  updateType: (id: number, input: Partial<LeaveType>) =>
    api.patch<{ id: number }>(`/api/leave-types/${id}`, input),
  removeType: (id: number) => api.delete<{ ok: boolean }>(`/api/leave-types/${id}`),

  list: (query: {
    status?: LeaveStatus;
    leaveTypeId?: number;
    /** One person's applications, for the staff detail screen. */
    staffId?: number;
    search?: string;
    from?: string;
    to?: string;
    page: number;
    pageSize: number;
  }) => api.get<LeaveRequestPage>(`/api/leave-requests?${toParams(query)}`),

  quote: (query: { staffId: number; leaveTypeId: number; from: string; to: string }) =>
    api.get<LeaveQuote>(`/api/leave-requests/quote?${toParams(query)}`),

  create: (input: {
    staffId: number;
    leaveTypeId: number;
    fromDate: string;
    toDate: string;
    reason?: string;
    remarks?: string;
  }) =>
    api.post<{ id: number; days: number; status: string; applied?: LeaveApplyOutcome }>(
      '/api/leave-requests',
      input,
    ),

  decide: (id: number, decision: 'approved' | 'rejected', note?: string) =>
    api.post<{ id: number; status: string; applied?: LeaveApplyOutcome }>(
      `/api/leave-requests/${id}/decide`,
      { decision, note },
    ),

  cancel: (id: number, note?: string) =>
    api.post<{ id: number; rosterRemoved: number; note?: string }>(
      `/api/leave-requests/${id}/cancel`,
      { note },
    ),

  balance: (staffId: number, year: number) =>
    api.get<LeaveBalance>(`/api/leave-balance/${staffId}?year=${year}`),

  searchStaff: (query: string) =>
    api.get<Array<StaffRef & { department: { name: string } | null }>>(
      `/api/leave-requests/staff-search?q=${encodeURIComponent(query)}`,
    ),
};

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface StaffSummary {
  staffId: number;
  /** Days the person was expected to work: excludes rest days and holidays. */
  scheduledDays: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  leaveDays: number;
  restDays: number;
  holidayDays: number;
  incompleteDays: number;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  openExceptions: number;
}

export interface MonthlyRow extends StaffSummary {
  staff: {
    id: number;
    employeeNo: string;
    fullName: string;
    department: { id: number; name: string } | null;
    location: { id: number; name: string } | null;
  };
}

export interface DepartmentTotal {
  departmentId: number | null;
  name: string;
  staffCount: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  leaveDays: number;
  incompleteDays: number;
  workedMinutes: number;
  overtimeMinutes: number;
  openExceptions: number;
}

export interface MonthlyReport extends Paged<MonthlyRow> {
  period: { from: string; to: string; workingDays: number };
  organisation: StaffSummary & { staffCount: number };
  byDepartment: DepartmentTotal[];
  unresolvedExceptions: { total: number; byKind: Record<string, number> };
  timeZone: string;
  generatedAt: string;
}

export interface PayrollPreview {
  period: { from: string; to: string; workingDays: number };
  staffCount: number;
  organisation: StaffSummary & { staffCount: number };
  unresolvedExceptions: { total: number; byKind: Record<string, number> };
  /** Things that make the export untrustworthy. Stated, never enforced. */
  blockers: Array<{ kind: string; count: number; detail: string }>;
  safeToExport: boolean;
  timeZone: string;
  generatedAt: string;
}

export interface ReportField {
  key: string;
  labelKey: LabelKey;
  kind: 'text' | 'number' | 'date' | 'time' | 'datetime';
}

/**
 * The column picker, described by the server in registry keys.
 *
 * Keys rather than words because this is interface text: it has to resolve through the
 * translation registry like anything else, and carry its label number when those are on.
 */
export interface ReportDataset {
  key: 'attendance' | 'exceptions' | 'leave';
  labelKey: LabelKey;
  noteKey: LabelKey;
  fields: ReportField[];
  groupBy: Array<{ key: string; labelKey: LabelKey }>;
}

export interface BuilderRequest {
  dataset: 'attendance' | 'exceptions' | 'leave';
  from: string;
  to: string;
  columns: string[];
  groupBy: string;
  departmentId?: number;
  status?: string;
  search?: string;
  limit?: number;
}

export interface BuilderResult {
  /** `label` is the resolved source wording the CSV header uses; the table renders `labelKey`. */
  columns: Array<{ key: string; labelKey: LabelKey; label: string }>;
  rows: Array<Record<string, string>>;
  /** True when the row cap was hit, so a subtotal is not read as a total. */
  truncated: boolean;
  limit: number;
  generatedAt: string;
}

export interface PeriodFilters {
  from: string;
  to: string;
  departmentId?: number;
  locationId?: number;
  search?: string;
}

export const reportsApi = {
  monthly: (query: PeriodFilters & { page: number; pageSize: number }) =>
    api.get<MonthlyReport>(`/api/reports/monthly?${toParams(query)}`),
  monthlyExportUrl: (query: PeriodFilters) =>
    `/api/reports/monthly/export?${toParams(query)}`,

  payrollPreview: (query: PeriodFilters) =>
    api.get<PayrollPreview>(`/api/reports/payroll/preview?${toParams(query)}`),
  payrollExportUrl: (query: PeriodFilters) =>
    `/api/reports/payroll/export?${toParams(query)}`,

  fields: () => api.get<{ datasets: ReportDataset[] }>('/api/reports/fields'),
  run: (input: BuilderRequest) => api.post<BuilderResult>('/api/reports/run', input),
};

/** Posts the builder query and lets the browser handle the download. */
export async function downloadBuilderCsv(input: BuilderRequest): Promise<void> {
  const response = await fetch('/api/reports/run/export', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text.slice(0, 200));
  }

  // The export is a POST because the query is a body, so the anchor trick a GET would
  // allow is not available and the blob has to be built here.
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `laporan-${input.dataset}-${input.from}-${input.to}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Minutes as `123j 45m`, the form the tables show. */
export function formatHours(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)}m`;
  return `${String(hours)}j ${String(rest)}m`;
}

/** First and last day of a month as `YYYY-MM-DD`, for the period pickers. */
export function monthRange(year: number, month: number): { from: string; to: string } {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const last = new Date(year, month + 1, 0).getDate();
  return {
    from: `${String(year)}-${pad(month + 1)}-01`,
    to: `${String(year)}-${pad(month + 1)}-${pad(last)}`,
  };
}

/**
 * Query string from an options object, dropping anything unset.
 *
 * Takes `object` rather than `Record<string, unknown>` so a declared interface can be
 * passed without an index signature, which is what every caller here has.
 */
function toParams(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  return params.toString();
}
