import { api } from './api';

/**
 * Approval chains and per-module preferences.
 *
 * One client over a `module` argument, matching the server: the shape is identical for
 * every request module, and four copies would be four places for the next field to be
 * forgotten in.
 */

export const APPROVAL_MODULES = ['leave', 'overtime', 'claim', 'expenses', 'applicants'] as const;

export type ApprovalModule = (typeof APPROVAL_MODULES)[number];

/**
 * Modules that send mail. Wider than the ones with an approval chain.
 *
 * Payroll and KPI belong here and not above: a chain is `pending → approved | rejected` with a rung
 * somebody is on, and neither of those two has one. They still have people to notify and wording
 * somebody wants to own, so they get the notification and template tabs and not the chain tab. The
 * server enforces the same split — the chain endpoints answer 404 for them.
 */
export const NOTIFY_MODULES = [...APPROVAL_MODULES, 'payroll', 'kpi'] as const;

export type NotifyModule = (typeof NOTIFY_MODULES)[number];

export interface ApprovalLevel {
  id: number;
  /** 1-based and contiguous. The server renumbers after every insert, delete and reorder. */
  level: number;
  approverAccountId: number | null;
  approverRoleId: number | null;
  /** Name of whichever the rung names. */
  approverLabel: string;
  byRole: boolean;
  active: boolean;
  note: string | null;
}

export interface ApprovalChain {
  module: ApprovalModule;
  levels: ApprovalLevel[];
  /**
   * Accounts and roles that actually hold this module's `approve` action.
   *
   * Filtered on the server. Offering somebody who would be refused the moment they tried to
   * sign is how a chain gets built that stalls, with nothing on screen saying why.
   */
  candidateAccounts: Array<{ id: number; label: string; email: string; roleName: string }>;
  candidateRoles: Array<{ id: number; name: string }>;
  /** Requests already part-way up the chain. Non-zero blocks structural edits. */
  partway: number;
}

export interface ModuleSettings {
  /**
   * `EmailProfile.key` this module sends through. Blank means it sends no email.
   *
   * The key rather than the row id, matching how the server selects a profile — that is what
   * lets a profile be repointed at a different relay without touching what names it.
   */
  emailProfileKey: string;
  notifyApplicant: string;
  notifyApprover: string;
  notifyEveryLevel: string;
  ccEmail: string;
}

/**
 * Every event any module raises. Which of them a given module raises comes from the server, in the
 * `templates` array — the editor renders what it is sent rather than filtering this list, so a
 * module that stops raising an event stops showing it without a web change.
 */
export const TEMPLATE_EVENTS = [
  'submitted',
  'levelApproved',
  'approved',
  'rejected',
  'cancelled',
  'awaitingApprover',
  'payslipReady',
  'awardApproved',
  'awardCancelled',
  'lendingApproved',
  'reviewAssigned',
  'appraisalFinalised',
] as const;

export type TemplateEvent = (typeof TEMPLATE_EVENTS)[number];

export interface EmailTemplate {
  event: TemplateEvent;
  /** Who the mail is addressed to, which decides how the wording should read. */
  audience: 'applicant' | 'approver';
  subject: string;
  body: string;
  enabled: boolean;
  /** False means what is shown is the seeded default, not something somebody saved. */
  customised: boolean;
  /** So a revert needs no second copy of the text on the client. */
  defaultSubject: string;
  defaultBody: string;
}

export interface TemplatePayload {
  module: NotifyModule;
  templates: EmailTemplate[];
  /** Every `{{name}}` this module's templates may use. */
  placeholders: string[];
  profiles: Array<{
    key: string;
    name: string;
    fromName: string;
    fromEmail: string;
    active: boolean;
  }>;
}

export interface ModuleSettingsPayload {
  module: NotifyModule;
  settings: ModuleSettings;
  /** Zero means no chain, which is what makes `notifyEveryLevel` inapplicable. */
  chainLength: number;
}

/** Stored as text so the column is one type; `'1'` is on. */
export function isOn(value: string): boolean {
  return value === '1';
}

export const hrApi = {
  chain: (module: ApprovalModule) => api.get<ApprovalChain>(`/api/hr/${module}/approval`),

  addLevel: (
    module: ApprovalModule,
    body: {
      approverAccountId?: number | null;
      approverRoleId?: number | null;
      note?: string;
      active?: boolean;
    },
  ) => api.post<{ id: number; level: number }>(`/api/hr/${module}/approval`, body),

  updateLevel: (
    module: ApprovalModule,
    id: number,
    body: {
      approverAccountId?: number | null;
      approverRoleId?: number | null;
      note?: string;
      active?: boolean;
    },
  ) => api.patch<{ ok: true }>(`/api/hr/${module}/approval/${id}`, body),

  removeLevel: (module: ApprovalModule, id: number) =>
    api.delete<{ ok: true }>(`/api/hr/${module}/approval/${id}`),

  /**
   * Sends the whole intended order.
   *
   * Not a move-up call: two rungs swapping places is a pair of writes that the unique index
   * rejects halfway through, so the server renumbers the lot inside one transaction.
   */
  reorder: (module: ApprovalModule, ids: number[]) =>
    api.post<{ ok: true }>(`/api/hr/${module}/approval/reorder`, { ids }),

  settings: (module: NotifyModule) =>
    api.get<ModuleSettingsPayload>(`/api/hr/${module}/settings`),

  saveSettings: (
    module: NotifyModule,
    body: {
      emailProfileKey?: string;
      notifyApplicant?: boolean;
      notifyApprover?: boolean;
      notifyEveryLevel?: boolean;
      ccEmail?: string;
    },
  ) => api.put<{ settings: ModuleSettings }>(`/api/hr/${module}/settings`, body),

  templates: (module: NotifyModule) =>
    api.get<TemplatePayload>(`/api/hr/${module}/templates`),

  saveTemplate: (
    module: NotifyModule,
    event: TemplateEvent,
    body: { subject: string; body: string; enabled?: boolean },
  ) => api.put<{ ok: true }>(`/api/hr/${module}/templates/${event}`, body),

  /** Drops the stored row so the seeded default applies again. */
  revertTemplate: (module: NotifyModule, event: TemplateEvent) =>
    api.delete<{ ok: true }>(`/api/hr/${module}/templates/${event}`),

  /**
   * Renders against sample values without sending.
   *
   * Goes through the server so the preview uses the same substitution the dispatcher does —
   * a preview built on the client could disagree with the mail actually sent.
   */
  previewTemplate: (
    module: NotifyModule,
    event: TemplateEvent,
    body: { subject: string; body: string },
  ) =>
    api.post<{ subject: string; body: string; unknown: string[] }>(
      `/api/hr/${module}/templates/${event}/preview`,
      body,
    ),
};

/** One decision in a request's history. */
export interface ApprovalTrailEntry {
  id: number;
  level: number;
  action: string;
  actorLabel: string;
  remarks: string | null;
  createdAt: string;
}
