import type { LabelKey } from '@attendance/shared';

import { api } from './api';

/**
 * The supervisor's justification queue.
 *
 * Back-office only. The matching self-service client was deleted along with its screens: staff do
 * not log into this application — `UserAccount.accountType` is documented as "`admin` administers the
 * system; `staff` is the mobile check-in app" — so a person's own attendance, their own explanations
 * and their own applications belong to the Android client.
 *
 * `/api/saya/*` still exists and is the contract that client reads. It has no caller here on purpose:
 * typing its responses in this app would be dead code pretending to be documentation, and the route
 * file is the documentation.
 */

/** The four record states a person can be asked to account for. */
export type JustifiableKind = 'late' | 'early_leave' | 'incomplete' | 'absent';

export const KIND_LABELS: Record<JustifiableKind, LabelKey> = {
  late: 'justify.kind.late',
  early_leave: 'justify.kind.early_leave',
  incomplete: 'justify.kind.incomplete',
  absent: 'justify.kind.absent',
};

export const KIND_ORDER: JustifiableKind[] = ['late', 'early_leave', 'incomplete', 'absent'];

export type JustificationStatus = 'pending' | 'approved' | 'rejected' | 'reverted';

export const JUSTIFICATION_STATUS_LABELS: Record<JustificationStatus, LabelKey> = {
  pending: 'justify.status.pending',
  approved: 'justify.status.approved',
  rejected: 'justify.status.rejected',
  reverted: 'justify.status.reverted',
};

export const JUSTIFICATION_STATUS_ORDER: JustificationStatus[] = [
  'pending',
  'reverted',
  'approved',
  'rejected',
];

/** Tones chosen so `reverted` never reads as a rejection. It is amber, not red. */
export const JUSTIFICATION_TONES: Record<JustificationStatus, string> = {
  pending: 'bg-slate-100 text-slate-700',
  approved: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-rose-50 text-rose-700',
  reverted: 'bg-amber-50 text-amber-700',
};

export type JustificationDecision = 'approved' | 'rejected' | 'reverted';

export interface QueueRow {
  id: number;
  staffId: number;
  employeeNo: string;
  staffName: string;
  departmentName: string | null;
  /** Calendar date. Render with `formatDateOnly`, never `formatDate`. */
  workDate: string;
  statusKind: JustifiableKind;
  reason: string;
  status: JustificationStatus;
  decisionNote: string | null;
  submittedAt: string;
  decidedAt: string | null;
  /**
   * The attendance record behind the explanation, or null.
   *
   * Null when the day has been recomputed into a different shape since — a shift rule changed, or a
   * corrected terminal clock moved the punch. The row still stands as a record of what was asked and
   * answered, and the screen shows the gap rather than hiding it.
   */
  record: {
    status: string;
    shiftName: string | null;
    scheduledStart: string | null;
    scheduledEnd: string | null;
    checkInAt: string | null;
    checkOutAt: string | null;
    lateMinutes: number;
    earlyLeaveMinutes: number;
    workedMinutes: number;
  } | null;
}

export interface QueuePage {
  /**
   * The range the server actually read, echoed back.
   *
   * The screen seeds its date pickers from these rather than computing a default of its own. It used
   * to call `/api/saya/tetapan` for them, which meant a back-office screen depending on a
   * self-service endpoint — and computing them locally instead would let the picker show one range
   * while the server had answered a different one.
   */
  from: string;
  to: string;
  rows: QueueRow[];
  total: number;
  counts: Partial<Record<JustificationStatus, number>>;
  generatedAt: string;
}

function toQuery(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    const text = String(value);
    if (text !== '') params.set(key, text);
  }
  return params.toString();
}

export const justificationApi = {
  list: (query: {
    dari?: string;
    hingga?: string;
    departmentId?: number;
    staffId?: number;
    status?: JustificationStatus;
    jenis?: JustifiableKind;
    page?: number;
    pageSize?: number;
  }) => api.get<QueuePage>(`/api/justifications?${toQuery(query)}`),

  decide: (id: number, decision: JustificationDecision, note?: string) =>
    api.post<{ ok: true }>(`/api/justifications/${id}/decision`, {
      decision,
      ...(note === undefined || note === '' ? {} : { note }),
    }),
};

/** Minutes as `2j 15m`, or a dash. Hours are `j` for jam, matching the rest of the application. */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)}m`;
  if (rest === 0) return `${String(hours)}j`;
  return `${String(hours)}j ${String(rest)}m`;
}

/** `HH:mm` from an ISO instant, in the reader's zone. Timestamps, not calendar dates. */
export function clockTime(iso: string | null): string {
  if (iso === null) return '—';
  return new Date(iso).toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' });
}
