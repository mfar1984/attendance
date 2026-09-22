/**
 * Attendance justification rules: which days can be explained, and what happens to an explanation.
 *
 * Import-free, so `scripts/test-justification.mts` executes this exact source rather than a
 * paraphrase of it.
 *
 * ## The distinction this module exists to hold
 *
 * There are two kinds of attendance problem and they need different handling.
 *
 * An **exception** is something the engine could not resolve — an unmatched face, a punch for an
 * employee number nothing maps to, a terminal whose clock had drifted. `ExceptionKind` has eight of
 * them. Resolving one corrects data, and only an operator can do it.
 *
 * A **justification** is about one of the four states the engine resolved with confidence: late,
 * left early, incomplete, absent. The record is right. The employee is accounting for it, and
 * deciding one changes no attendance figure anywhere — which is why it is safe to let the employee
 * start it.
 *
 * Nothing here writes to attendance. If a decision here could move a figure, the figure would no
 * longer be derivable from the raw log, and that is the one property the whole system rests on.
 */

/**
 * The four record states a person can be asked to account for.
 *
 * Taken from `AttendanceStatus`, not redefined. The engine already derives these; what was missing
 * was somewhere to put the explanation. `on_time`, `on_leave`, `rest_day` and `holiday` are not
 * here because there is nothing to explain about them.
 */
export const JUSTIFIABLE_STATUSES = ['late', 'early_leave', 'incomplete', 'absent'] as const;

export type JustifiableStatus = (typeof JUSTIFIABLE_STATUSES)[number];

/**
 * `reverted` is a third outcome, not a soft rejection.
 *
 * It sends the day back for a better explanation. "Your reason was not accepted" and "I cannot act
 * on what you wrote" are different messages, and only one of them means the person should try
 * again. Collapsing them into `rejected` leaves somebody staring at a decision they cannot respond
 * to.
 */
export const JUSTIFICATION_STATUSES = ['pending', 'approved', 'rejected', 'reverted'] as const;

export type JustificationStatus = (typeof JUSTIFICATION_STATUSES)[number];

/** The three a supervisor can choose. `pending` is where a submission starts, not a decision. */
export const JUSTIFICATION_DECISIONS = ['approved', 'rejected', 'reverted'] as const;

export type JustificationDecision = (typeof JUSTIFICATION_DECISIONS)[number];

/**
 * Shortest reason worth storing.
 *
 * "ok" and "-" are not explanations, and a field that accepts them produces a queue of rows a
 * supervisor has to open to discover there is nothing in them.
 */
export const MIN_REASON = 10;
export const MAX_REASON = 1000;

/**
 * How far back a day can still be explained, in days.
 *
 * Not unlimited. A justification arriving eleven months after the fact asks somebody to decide on
 * something neither party remembers, and it arrives after the monthly report it would have changed
 * has been read. Ninety days covers a quarter, which is the longest anybody has to wait for the
 * cycle that surfaces the problem.
 *
 * A window rather than a hard rule about periods, because attendance has no period to close
 * against — payroll does, and payroll does not read this.
 */
export const BACKDATE_WINDOW_DAYS = 90;

export type Refusal = { key: string; vars?: Record<string, string | number> };

/** Whether a record's status is one somebody can be asked to account for. */
export function isJustifiable(status: string): status is JustifiableStatus {
  return (JUSTIFIABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * Whether a reason can stand.
 *
 * Length is checked on the trimmed value, so twenty spaces is not an explanation.
 */
export function checkReason(reason: string): Refusal | null {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return { key: 'justify.refuse.reasonEmpty' };
  if (trimmed.length < MIN_REASON) {
    return { key: 'justify.refuse.reasonShort', vars: { min: MIN_REASON } };
  }
  if (trimmed.length > MAX_REASON) {
    return { key: 'justify.refuse.reasonLong', vars: { max: MAX_REASON } };
  }
  return null;
}

export interface SubmitInput {
  /** `YYYY-MM-DD`. Compared as strings: that format sorts in date order and involves no timezone. */
  workDate: string;
  today: string;
  /** The status the attendance record actually carries for that day, or null when no record exists. */
  recordStatus: string | null;
  /** The status of an existing justification for the same day and kind, or null when there is none. */
  existingStatus: JustificationStatus | null;
  statusKind: string;
  reason: string;
}

/**
 * Why this justification cannot be submitted, or null.
 *
 * The order is deliberate: the cheapest and most obvious refusals first, so somebody submitting a
 * blank reason for tomorrow is told about tomorrow rather than about the reason.
 */
export function checkSubmit(input: SubmitInput): Refusal | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.workDate)) return { key: 'justify.refuse.badDate' };

  /*
   * A future day cannot be explained.
   *
   * The engine never computes a day that has not happened, so there is no record to attach to — and
   * a justification for next Tuesday is somebody pre-authorising their own absence.
   */
  if (input.workDate > input.today) return { key: 'justify.refuse.future' };

  if (daysBetween(input.workDate, input.today) > BACKDATE_WINDOW_DAYS) {
    return { key: 'justify.refuse.tooOld', vars: { days: BACKDATE_WINDOW_DAYS } };
  }

  if (!isJustifiable(input.statusKind)) return { key: 'justify.refuse.badKind' };

  /*
   * The claimed status has to be what the day actually holds.
   *
   * Without this, somebody could file an absence explanation for a day they were on time, and the
   * queue would fill with rows a supervisor has to cross-check by hand. The record is the authority
   * on what happened; this form is only the authority on why.
   */
  if (input.recordStatus === null) return { key: 'justify.refuse.noRecord' };
  if (input.recordStatus !== input.statusKind) {
    return {
      key: 'justify.refuse.statusMismatch',
      vars: { claimed: input.statusKind, actual: input.recordStatus },
    };
  }

  /*
   * A decided day is not re-explained, except when it was sent back.
   *
   * `reverted` exists precisely to reopen one, so it is the one existing status that accepts a new
   * reason. Approved and rejected are decisions somebody made and signed.
   */
  if (input.existingStatus === 'pending') return { key: 'justify.refuse.alreadyPending' };
  if (input.existingStatus === 'approved') return { key: 'justify.refuse.alreadyApproved' };
  if (input.existingStatus === 'rejected') return { key: 'justify.refuse.alreadyRejected' };

  return checkReason(input.reason);
}

/**
 * Whether a decision may be recorded against a justification in this state.
 *
 * Only `pending` and `reverted` can be decided. A `reverted` row is still open — it is waiting on
 * the employee, and a supervisor who changes their mind before the employee gets to it should not
 * have to wait for a resubmission they no longer want.
 */
export function checkDecision(input: {
  current: JustificationStatus;
  decision: JustificationDecision;
  note: string | null;
}): Refusal | null {
  if (!(JUSTIFICATION_DECISIONS as readonly string[]).includes(input.decision)) {
    return { key: 'justify.refuse.badDecision' };
  }
  if (input.current === 'approved' || input.current === 'rejected') {
    return { key: 'justify.refuse.alreadyDecided', vars: { status: input.current } };
  }

  /*
   * Rejecting and reverting both require a note; approving does not.
   *
   * Approval is agreement with what the person already wrote, so there is nothing to add. The other
   * two ask the person to accept an outcome or to try again, and an outcome with no words attached
   * is one they cannot act on or appeal.
   */
  if (input.decision !== 'approved') {
    const note = input.note?.trim() ?? '';
    if (note.length < 3) return { key: 'justify.refuse.noteRequired' };
  }

  return null;
}

/** True once nothing further happens to a justification. */
export function justificationSettled(status: JustificationStatus): boolean {
  return status === 'approved' || status === 'rejected';
}

/**
 * Whole days between two `YYYY-MM-DD` keys, later minus earlier.
 *
 * Parsed as UTC midnight — the representation calendar dates are stored in — so a 24-hour step is
 * exact and no daylight-saving boundary can shorten one. Negative when `to` is before `from`.
 */
export function daysBetween(from: string, to: string): number {
  const left = Date.parse(`${from}T00:00:00Z`);
  const right = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.NaN;
  return Math.round((right - left) / 86_400_000);
}

/**
 * Counts per kind, for the four cards on the summary.
 *
 * `approved` only, and the screen says so. A pending explanation has not been accepted by anybody,
 * and counting it would let somebody clear their own late record by writing a sentence about it.
 */
export function summariseApproved(
  rows: Array<{ statusKind: string; status: string }>,
): Record<JustifiableStatus, number> {
  const counts: Record<JustifiableStatus, number> = {
    late: 0,
    early_leave: 0,
    incomplete: 0,
    absent: 0,
  };
  for (const row of rows) {
    if (row.status !== 'approved') continue;
    if (!isJustifiable(row.statusKind)) continue;
    counts[row.statusKind] += 1;
  }
  return counts;
}
