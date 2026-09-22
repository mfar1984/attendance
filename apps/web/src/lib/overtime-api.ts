import type { LabelKey } from '@attendance/shared';

import { api } from './api';
import type { ApprovalTrailEntry } from './hr-api';

/**
 * Overtime claims and the rates they are paid at.
 *
 * The hours are not a field on this client. They come from `measuredMinutes`, which the
 * attendance engine derived from the raw log — the form claims against that figure rather
 * than asking somebody to type one.
 */

export type OvertimeDayType = 'weekday' | 'restDay' | 'holiday' | 'holidayRestDay';

export type OvertimeStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** Registry keys, so the wording is translated where it is rendered. */
export const OVERTIME_DAY_TYPE_LABELS: Record<OvertimeDayType, LabelKey> = {
  weekday: 'overtime.dayType.weekday',
  restDay: 'overtime.dayType.restDay',
  holiday: 'overtime.dayType.holiday',
  holidayRestDay: 'overtime.dayType.holidayRestDay',
};

export const OVERTIME_STATUS_LABELS: Record<OvertimeStatus, LabelKey> = {
  pending: 'overtime.status.pending',
  approved: 'overtime.status.approved',
  rejected: 'overtime.status.rejected',
  cancelled: 'overtime.status.cancelled',
};

export interface OvertimeRate {
  id: number;
  code: string;
  name: string;
  description: string | null;
  dayType: OvertimeDayType;
  multiplier: number;
  isDefault: boolean;
  active: boolean;
  requestCount: number;
  /** Set when the multiplier is below the Employment Act floor for its day type. */
  shortfall: { floor: number; actual: number } | null;
}

export interface OvertimeRequestRow {
  id: number;
  requestNo: string;
  /** Rungs already signed. Zero means nobody has. */
  currentLevel: number;
  staffId: number;
  employeeNo: string | null;
  staffName: string | null;
  departmentName: string | null;
  /** Calendar date, `YYYY-MM-DD`. Never an instant. */
  workDate: string;
  /** What the engine measured from scans that day. */
  measuredMinutes: number;
  /** What is claimed. Never above measured. */
  requestedMinutes: number;
  hourlyRate: number;
  dayType: OvertimeDayType;
  rateCode: string | null;
  rateName: string | null;
  multiplier: number | null;
  /** Zero until approved: the approver picks the rate, so nothing is owed before then. */
  amount: number;
  task: string;
  reason: string;
  status: OvertimeStatus;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface OvertimeRequestPage {
  rows: OvertimeRequestRow[];
  total: number;
  /** Per status, computed ignoring the status filter so choosing a chip cannot zero the rest. */
  counts: Partial<Record<OvertimeStatus, number>>;
  /**
   * Rungs in the configured approval chain. Zero means one decision settles a request.
   *
   * A property of the module rather than of a row, which is why it rides on the page.
   */
  chainLength: number;
  generatedAt: string;
}

/** What a day was and what it would pay, read before anything is filed. */
export interface OvertimeQuote {
  workDate: string;
  staffName: string;
  staffActive: boolean;
  hasSalary: boolean;
  hourlyRate: number | null;
  measuredMinutes: number;
  monthMinutes: number;
  monthCapMinutes: number;
  dayType: OvertimeDayType;
  holidayName: string | null;
  rateId: number | null;
  rateName: string | null;
  multiplier: number;
  /** True when no rate is configured for the day type and the statutory floor stands in. */
  usingStatutoryFloor: boolean;
  estimate: number | null;
}

export interface OvertimeDecision {
  ok: true;
  /** `pending` when the chain has further rungs to climb. */
  status: 'pending' | 'approved' | 'rejected';
  /** Rung just signed. */
  level: number;
  totalLevels: number;
  /** False while the chain has further rungs; no money is owed until it is true. */
  finalized: boolean;
  awaitingLevel: number | null;
  awaitingLabel: string | null;
  amount: number;
  multiplier: number | null;
  /** Rate/day mismatch or a shortfall against the statutory floor. Reported, never blocking. */
  warning: string | null;
  /** Always false for now: approving is not paying, and nothing here pays yet. */
  paid: boolean;
}

export const overtimeApi = {
  rates: () => api.get<OvertimeRate[]>('/api/overtime-rates'),

  createRate: (body: {
    code: string;
    name: string;
    description?: string;
    dayType: OvertimeDayType;
    multiplier: number;
    isDefault: boolean;
    active?: boolean;
  }) => api.post<OvertimeRate>('/api/overtime-rates', body),

  updateRate: (id: number, body: Partial<Omit<OvertimeRate, 'id' | 'requestCount' | 'shortfall'>>) =>
    api.patch<OvertimeRate>(`/api/overtime-rates/${id}`, body),

  deleteRate: (id: number) => api.delete<{ ok: true }>(`/api/overtime-rates/${id}`),

  list: (query: {
    staffId?: number;
    status?: OvertimeStatus;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    return api.get<OvertimeRequestPage>(`/api/overtime-requests?${params.toString()}`);
  },

  quote: (staffId: number, workDate: string) =>
    api.get<OvertimeQuote>(
      `/api/overtime-requests/quote?staffId=${staffId}&workDate=${encodeURIComponent(workDate)}`,
    ),

  create: (body: {
    staffId: number;
    workDate: string;
    requestedMinutes: number;
    task: string;
    reason: string;
  }) => api.post<OvertimeRequestRow>('/api/overtime-requests', body),

  decide: (
    id: number,
    body: { decision: 'approved' | 'rejected'; overtimeRateId?: number; note?: string },
  ) => api.post<OvertimeDecision>(`/api/overtime-requests/${id}/decide`, body),

  cancel: (id: number) => api.post<{ ok: true }>(`/api/overtime-requests/${id}/cancel`),

  /** One request with its decision history, loaded when a row is expanded. */
  detail: (id: number) =>
    api.get<OvertimeRequestRow & { trail: ApprovalTrailEntry[] }>(`/api/overtime-requests/${id}`),
};

/** Minutes as hours, to two decimals with trailing zeros trimmed. */
export function formatHours(minutes: number): string {
  if (!Number.isFinite(minutes)) return '—';
  return String(Math.round((minutes / 60) * 100) / 100);
}

/** Ringgit with thousands separators. A missing value reads as a dash, not RM 0.00. */
export function formatRinggit(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `RM ${value.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
