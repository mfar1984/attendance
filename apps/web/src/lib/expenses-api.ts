import { api } from './api';
import type { ClaimStatus } from './claims-api';
import type { ApprovalTrailEntry } from './hr-api';

/**
 * Out-of-pocket expenses.
 *
 * Shares `ClaimStatus` and its label map with claims: the two modules move through the same
 * four states, and a second copy of the same union would be a second place for them to drift.
 */

export interface ExpenseCategory {
  id: number;
  code: string;
  name: string;
  description: string | null;
  /** Ceiling per request, null for none. There is no rate: a category classifies, it does not price. */
  maxAmount: number | null;
  active: boolean;
  requestCount: number;
}

export interface ExpenseRow {
  id: number;
  requestNo: string;
  staffId: number;
  employeeNo: string;
  staffName: string;
  departmentName: string | null;
  categoryId: number;
  categoryCode: string;
  categoryName: string;
  /** Calendar date, `YYYY-MM-DD`. */
  incurredOn: string;
  amount: number;
  /** What was allowed. Zero until the chain finishes. */
  approvedAmount: number;
  /** Who was paid, so the figure can be reconciled against a bank statement. */
  payee: string;
  description: string;
  /** Never optional for an expense: the receipt is the entire basis of the amount. */
  hasReceipt: boolean;
  status: ClaimStatus;
  currentLevel: number;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface ExpensePage {
  rows: ExpenseRow[];
  total: number;
  counts: Partial<Record<ClaimStatus, number>>;
  chainLength: number;
  generatedAt: string;
}

export const expensesApi = {
  categories: () => api.get<ExpenseCategory[]>('/api/expense-categories'),

  createCategory: (body: {
    code: string;
    name: string;
    description?: string;
    maxAmount?: number | null;
    active?: boolean;
  }) => api.post<{ id: number }>('/api/expense-categories', body),

  updateCategory: (
    id: number,
    body: Partial<Omit<ExpenseCategory, 'id' | 'requestCount'>>,
  ) => api.patch<{ ok: true }>(`/api/expense-categories/${id}`, body),

  deleteCategory: (id: number) => api.delete<{ ok: true }>(`/api/expense-categories/${id}`),

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
    return api.get<ExpensePage>(`/api/expense-requests?${params.toString()}`);
  },

  detail: (id: number) =>
    api.get<ExpenseRow & { trail: ApprovalTrailEntry[] }>(`/api/expense-requests/${id}`),

  create: (body: {
    staffId: number;
    categoryId: number;
    incurredOn: string;
    amount: number;
    payee: string;
    description: string;
  }) =>
    api.post<{ id: number; requestNo: string; amount: number }>('/api/expense-requests', body),

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
    }>(`/api/expense-requests/${id}/decide`, body),

  cancel: (id: number) => api.post<{ ok: true }>(`/api/expense-requests/${id}/cancel`),

  /** Multipart, so it bypasses the JSON client — a file is not a body `api` can serialise. */
  uploadReceipt: async (id: number, file: File): Promise<void> => {
    const form = new FormData();
    form.append('file', file);

    const response = await fetch(`/api/expense-requests/${id}/receipt`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(payload?.message ?? 'Resit tidak dapat dimuat naik.');
    }
  },

  receiptUrl: (id: number) => `/api/expense-requests/${id}/receipt`,

  removeReceipt: (id: number) => api.delete<{ ok: true }>(`/api/expense-requests/${id}/receipt`),
};
