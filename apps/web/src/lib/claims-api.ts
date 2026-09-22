import type { LabelKey } from '@attendance/shared';

import { api } from './api';
import type { ApprovalTrailEntry } from './hr-api';

/**
 * Claims.
 *
 * The amount is not always a field somebody types. A rated category — mileage at a rate per
 * kilometre — takes a quantity and the server derives the ringgit, because accepting the
 * figure would make the rate decorative.
 */

export type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, LabelKey> = {
  pending: 'claim.status.pending',
  approved: 'claim.status.approved',
  rejected: 'claim.status.rejected',
  cancelled: 'claim.status.cancelled',
};

export interface ClaimType {
  id: number;
  code: string;
  name: string;
  description: string | null;
  /** Set for a rated category; null makes it flat. */
  ratePerUnit: number | null;
  /** What a unit is, for the form to label the quantity box. */
  unitLabel: string | null;
  /** Ceiling per claim, null for none. */
  maxAmount: number | null;
  requiresReceipt: boolean;
  /**
   * Off for a category recorded as approved the moment it is filed.
   *
   * Still not paid either way — payment is a separate step, so this is "allowed without a
   * signature", not "settled".
   */
  requiresApproval: boolean;
  active: boolean;
  requestCount: number;
}

export interface ClaimRow {
  id: number;
  requestNo: string;
  staffId: number;
  employeeNo: string;
  staffName: string;
  departmentName: string | null;
  claimTypeId: number;
  claimTypeCode: string;
  claimTypeName: string;
  unitLabel: string | null;
  /** Calendar date, `YYYY-MM-DD`. */
  incurredOn: string;
  quantity: number | null;
  ratePerUnit: number | null;
  amount: number;
  /** What was allowed. Zero until the chain finishes. */
  approvedAmount: number;
  description: string;
  /**
   * Whether a file is attached.
   *
   * The path itself is never sent: it is a filename on the server's disk and the screen has no
   * use for it. The file is fetched from its own endpoint.
   */
  /** True when any line has one. The per-line state is on `items`. */
  hasReceipt: boolean;
  itemCount: number;
  /**
   * Lines still without a receipt.
   *
   * Summarised by the server rather than counted here, because it is what decides whether the claim
   * can be approved at all — and a screen that derived it would be a second place for the rule.
   */
  receiptsMissing: number;
  items: ClaimItem[];
  status: ClaimStatus;
  currentLevel: number;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

/** One line of a claim: one cost, on one date, with its own receipt. */
export interface ClaimItem {
  id: number;
  incurredOn: string;
  description: string;
  /** Free text the applicant chose — "Tol", "Parkir". Null where none was given. */
  category: string | null;
  /** Set for a rated category: this line's distance or nights. */
  quantity: number | null;
  amount: number;
  hasReceipt: boolean;
}

export interface ClaimPage {
  rows: ClaimRow[];
  total: number;
  counts: Partial<Record<ClaimStatus, number>>;
  chainLength: number;
  generatedAt: string;
}

export const claimsApi = {
  types: () => api.get<ClaimType[]>('/api/claim-types'),

  createType: (body: {
    code: string;
    name: string;
    description?: string;
    ratePerUnit?: number | null;
    unitLabel?: string;
    maxAmount?: number | null;
    requiresReceipt: boolean;
    active?: boolean;
  }) => api.post<{ id: number }>('/api/claim-types', body),

  updateType: (id: number, body: Partial<Omit<ClaimType, 'id' | 'requestCount'>>) =>
    api.patch<{ ok: true }>(`/api/claim-types/${id}`, body),

  deleteType: (id: number) => api.delete<{ ok: true }>(`/api/claim-types/${id}`),

  list: (query: {
    staffId?: number;
    status?: ClaimStatus;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    return api.get<ClaimPage>(`/api/claim-requests?${params.toString()}`);
  },

  detail: (id: number) =>
    api.get<ClaimRow & { trail: ApprovalTrailEntry[] }>(`/api/claim-requests/${id}`),

  /**
   * One claim, one or more lines, one submit.
   *
   * `quantity` and `amount` moved onto the lines: a week of travel is several journeys of different
   * lengths, and one quantity on the claim could only be their sum — which tells nobody which trip
   * was which. The rate stays on the claim, frozen at filing.
   *
   * The total is not sent. It is summed on the server from the lines, because a figure the client
   * computes is a figure the client can get wrong.
   */
  create: (body: {
    staffId: number;
    claimTypeId: number;
    /** The date on the claim. Each line carries the date its own cost was incurred. */
    incurredOn: string;
    description: string;
    remarks?: string;
    items: Array<{
      incurredOn: string;
      description: string;
      category?: string;
      /** For a rated category. */
      quantity?: number;
      /** For a flat category. */
      amount?: number;
    }>;
  }) =>
    api.post<{
      id: number;
      requestNo: string;
      amount: number;
      receiptRequired: boolean;
      /**
       * The created line ids, in the order the lines were sent.
       *
       * The form collects a file per line, and a receipt has to be attached to a row that exists —
       * so the upload follows this call, positionally: the file on line 3 of the form goes to
       * `itemIds[2]`.
       */
      itemIds: number[];
    }>('/api/claim-requests', body),

  decide: (
    id: number,
    body: { decision: 'approved' | 'rejected'; approvedAmount?: number; note?: string },
  ) =>
    api.post<{
      ok: true;
      status: 'pending' | 'approved' | 'rejected';
      level: number;
      totalLevels: number;
      finalized: boolean;
      awaitingLevel: number | null;
      awaitingLabel: string | null;
      approvedAmount: number;
      paid: boolean;
    }>(`/api/claim-requests/${id}/decide`, body),

  cancel: (id: number) => api.post<{ ok: true }>(`/api/claim-requests/${id}/cancel`),

  /**
   * Uploads the receipt for one line.
   *
   * Sent as `multipart/form-data` rather than through the JSON client, so it bypasses `api`
   * entirely — the shared helper serialises a body, and a file is not a body it can serialise.
   *
   * `id` is a `ClaimItem`, like `receiptUrl` and `removeReceipt`. This posted to
   * `/api/claim-requests/:id/receipt` for a while after the receipt moved onto lines — an endpoint
   * that no longer exists — so every upload from the screen answered 404 while the two sibling
   * functions beside it were already pointing at the right place.
   */
  uploadReceipt: async (id: number, file: File): Promise<void> => {
    const form = new FormData();
    form.append('file', file);

    const response = await fetch(`/api/claim-items/${id}/receipt`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(payload?.message ?? 'Resit tidak dapat dimuat naik.');
    }
  },

  /** `id` is a line, not a claim — receipts hang off lines now. */
  receiptUrl: (id: number) => `/api/claim-items/${id}/receipt`,

  /** Filtered server-side: five thousand staff is not a dropdown. */
  searchStaff: (query: string) =>
    api.get<Array<{ id: number; employeeNo: string; fullName: string; department: { name: string } | null }>>(
      `/api/claim-requests/staff-search?q=${encodeURIComponent(query)}`,
    ),

  removeReceipt: (id: number) => api.delete<{ ok: true }>(`/api/claim-items/${id}/receipt`),
};

/** Ringgit with thousands separators. A missing value reads as a dash, not RM 0.00. */
export function formatRinggit(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `RM ${value.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
