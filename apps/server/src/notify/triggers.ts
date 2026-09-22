import { LABELS, type LabelKey } from '@attendance/shared';

/**
 * Events a notification channel can be subscribed to.
 *
 * Deliberately only events this system actually raises. It is tempting to list every
 * event an HR suite might have — claims approved, payslips ready, job applications — but
 * a toggle for something that never fires is worse than no toggle: it reads as a feature
 * that is broken rather than one that does not exist.
 *
 * Each key below corresponds to a place in the code that already runs. `wired` says
 * whether the dispatch call is in place yet, and the screen shows that, so a switch that
 * cannot fire yet says so on its own face instead of being discovered by silence.
 */

/**
 * Registry keys rather than words.
 *
 * The list is a column of switches somebody reads, so its wording resolves per reader like
 * any other label. `triggerLabel()` below resolves the source wording for the one place
 * that needs actual words: the message body a dispatch writes.
 */
export interface NotificationTrigger {
  key: string;
  labelKey: LabelKey;
  /** What the message says, so the operator can judge whether it is worth a text. */
  detailKey: LabelKey;
  /** False until the dispatch call exists at the source. Shown in the UI. */
  wired: boolean;
}

export const NOTIFICATION_TRIGGERS: NotificationTrigger[] = [
  {
    key: 'leave.requested',
    labelKey: 'trigger.leave.requested',
    detailKey: 'trigger.leave.requested.detail',
    wired: true,
  },
  {
    key: 'leave.approved',
    labelKey: 'trigger.leave.approved',
    detailKey: 'trigger.leave.approved.detail',
    wired: true,
  },
  {
    key: 'leave.rejected',
    labelKey: 'trigger.leave.rejected',
    detailKey: 'trigger.leave.rejected.detail',
    wired: true,
  },
  {
    key: 'leave.cancelled',
    labelKey: 'trigger.leave.cancelled',
    detailKey: 'trigger.leave.cancelled.detail',
    wired: true,
  },
  {
    key: 'overtime.approved',
    labelKey: 'trigger.overtime.approved',
    detailKey: 'trigger.overtime.approved.detail',
    wired: true,
  },
  {
    key: 'overtime.rejected',
    labelKey: 'trigger.overtime.rejected',
    detailKey: 'trigger.overtime.rejected.detail',
    wired: true,
  },
  {
    key: 'claim.approved',
    labelKey: 'trigger.claim.approved',
    detailKey: 'trigger.claim.approved.detail',
    wired: true,
  },
  {
    key: 'claim.rejected',
    labelKey: 'trigger.claim.rejected',
    detailKey: 'trigger.claim.rejected.detail',
    wired: true,
  },
  {
    key: 'expense.approved',
    labelKey: 'trigger.expense.approved',
    detailKey: 'trigger.expense.approved.detail',
    wired: true,
  },
  {
    key: 'expense.rejected',
    labelKey: 'trigger.expense.rejected',
    detailKey: 'trigger.expense.rejected.detail',
    wired: true,
  },
  {
    key: 'applicant.offered',
    labelKey: 'trigger.applicant.offered',
    detailKey: 'trigger.applicant.offered.detail',
    wired: true,
  },
  {
    key: 'applicant.rejected',
    labelKey: 'trigger.applicant.rejected',
    detailKey: 'trigger.applicant.rejected.detail',
    wired: true,
  },
  {
    key: 'attendance.exception',
    labelKey: 'trigger.attendance.exception',
    detailKey: 'trigger.attendance.exception.detail',
    wired: false,
  },
  {
    key: 'device.offline',
    labelKey: 'trigger.device.offline',
    detailKey: 'trigger.device.offline.detail',
    wired: false,
  },
  {
    key: 'device.clockDrift',
    labelKey: 'trigger.device.clockDrift',
    detailKey: 'trigger.device.clockDrift.detail',
    wired: false,
  },
  {
    key: 'payroll.exported',
    labelKey: 'trigger.payroll.exported',
    detailKey: 'trigger.payroll.exported.detail',
    wired: false,
  },
  /*
   * Payroll and appraisal outcomes.
   *
   * `payroll.paid` fires when a period is marked paid, not when it is approved. Approval moves no
   * money, and telling somebody their pay is ready before it has left the building generates a
   * phone call rather than answering one.
   */
  {
    key: 'payroll.paid',
    labelKey: 'trigger.payroll.paid',
    detailKey: 'trigger.payroll.paid.detail',
    wired: true,
  },
  {
    key: 'payroll.awardDecided',
    labelKey: 'trigger.payroll.awardDecided',
    detailKey: 'trigger.payroll.awardDecided.detail',
    wired: true,
  },
  {
    key: 'payroll.lendingApproved',
    labelKey: 'trigger.payroll.lendingApproved',
    detailKey: 'trigger.payroll.lendingApproved.detail',
    wired: true,
  },
  {
    key: 'kpi.reviewAssigned',
    labelKey: 'trigger.kpi.reviewAssigned',
    detailKey: 'trigger.kpi.reviewAssigned.detail',
    wired: true,
  },
  {
    key: 'kpi.finalised',
    labelKey: 'trigger.kpi.finalised',
    detailKey: 'trigger.kpi.finalised.detail',
    wired: true,
  },
  /*
   * The employee is told what happened to their explanation, and nothing else is announced.
   *
   * There is no trigger for filing one. A supervisor learns about new submissions from the count on
   * the menu entry, which is a live number that goes down as they work through it — a message per
   * submission would arrive dozens at a time on the first of the month and be filtered away by the
   * second.
   */
  {
    key: 'justification.decided',
    labelKey: 'trigger.justification.decided',
    detailKey: 'trigger.justification.decided.detail',
    wired: true,
  },
];

const BY_KEY = new Map(NOTIFICATION_TRIGGERS.map((trigger) => [trigger.key, trigger]));

export type TriggerKey = string;

/** Drops anything not in the registry, so a stale stored key cannot resurrect itself. */
export function sanitiseTriggers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry === 'string' && BY_KEY.has(entry)) seen.add(entry);
  }
  return [...seen];
}

/**
 * The source wording, for the message body a dispatch writes.
 *
 * An SMS or a Telegram message is prose going out over a wire, not a screen, so it needs
 * actual words. It goes out in the source language — the recipient's language is not
 * something a notification knows.
 */
export function triggerLabel(key: string): string {
  const labelKey = BY_KEY.get(key)?.labelKey;
  return labelKey === undefined ? key : LABELS[labelKey];
}

/**
 * The default set for a channel that has never been configured.
 *
 * Nothing. A gateway that starts sending the moment credentials are saved will send its
 * first message to whoever happens to be on call, before anybody has agreed what it says.
 */
export function defaultTriggers(): string[] {
  return [];
}
