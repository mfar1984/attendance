/**
 * Rules for claims and expenses.
 *
 * Import-free apart from the shared money helpers, so every rule here runs without a
 * database. These are the checks that decide what somebody is paid back, which is why they
 * live apart from the routes that call them.
 *
 * Claims and expenses share this file because they share the rules. What differs is where
 * the amount comes from: a claim can be priced by a rate the organisation set, an expense is
 * priced by what the receipt says.
 */
import { ratedAmount, toSen } from './money.js';

export const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Largest single claim accepted, before any category cap. */
export const MAX_CLAIM_AMOUNT = 100_000;

/** How far back a cost may be claimed. Beyond this it is a data-entry slip. */
export const MAX_BACKDATE_DAYS = 365;

export type Refusal = { key: string; vars?: Record<string, string | number> };

/**
 * The amount a rated category produces, or null when the category is flat.
 *
 * Derived rather than accepted. A flat category takes the figure from the receipt, but a
 * rated one must not: letting somebody type the amount for a mileage claim makes the rate
 * decorative, and the rate is the whole control.
 */
export function claimAmountFor(input: {
  ratePerUnit: number | null;
  quantity: number | null;
}): number | null {
  if (input.ratePerUnit === null) return null;
  if (input.quantity === null || !Number.isFinite(input.quantity)) return Number.NaN;
  return ratedAmount(input.quantity, input.ratePerUnit);
}

export interface ClaimCheckInput {
  /** Calendar date the cost was incurred, as `YYYY-MM-DD`. */
  incurredOn: string;
  /** Today, as `YYYY-MM-DD`. Passed in so this function has no clock of its own. */
  today: string;
  /** What is being claimed, after any rate has been applied. */
  amount: number;
  /** Category ceiling, or null. */
  maxAmount: number | null;
  /** True when the category demands a receipt. */
  requiresReceipt: boolean;
  /** True when one was supplied. */
  hasReceipt: boolean;
  /** Set for a rated category. */
  ratePerUnit: number | null;
  quantity: number | null;
}

/** Why this claim cannot stand, or null. */
export function checkClaim(input: ClaimCheckInput): Refusal | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.incurredOn)) {
    return { key: 'claim.refuse.badDate' };
  }

  /*
   * Compared as strings, not as `Date` objects.
   *
   * `YYYY-MM-DD` sorts lexicographically in date order, and parsing to a `Date` here would
   * reintroduce the timezone question that date-only values exist to avoid — a claim filed
   * this morning must not read as tomorrow's because the server sits east of the reader.
   */
  if (input.incurredOn > input.today) {
    return { key: 'claim.refuse.future' };
  }
  if (daysBetween(input.incurredOn, input.today) > MAX_BACKDATE_DAYS) {
    return { key: 'claim.refuse.tooOld', vars: { days: MAX_BACKDATE_DAYS } };
  }

  // A rated category has to carry the quantity the rate applies to.
  if (input.ratePerUnit !== null) {
    if (input.quantity === null || !Number.isFinite(input.quantity) || input.quantity <= 0) {
      return { key: 'claim.refuse.noQuantity' };
    }
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { key: 'claim.refuse.noAmount' };
  }
  if (input.amount > MAX_CLAIM_AMOUNT) {
    return { key: 'claim.refuse.tooLarge', vars: { max: MAX_CLAIM_AMOUNT.toLocaleString('en-MY') } };
  }
  if (input.maxAmount !== null && input.amount > input.maxAmount) {
    return {
      key: 'claim.refuse.overCap',
      vars: { amount: input.amount.toFixed(2), cap: input.maxAmount.toFixed(2) },
    };
  }

  /*
   * Refused at filing rather than left for the approver.
   *
   * A category that demands a receipt demands it because the figure is unverifiable without
   * one. Accepting the claim and expecting somebody downstream to notice is how unevidenced
   * amounts get approved by a person clearing a queue.
   */
  if (input.requiresReceipt && !input.hasReceipt) {
    return { key: 'claim.refuse.noReceipt' };
  }

  return null;
}

/**
 * One line of a multi-line claim.
 *
 * Split out from `checkClaim` because the two halves of that function have different scopes once a
 * claim has lines: the date, the quantity and the receipt belong to a line, while the category cap
 * is a ceiling on the claim — `ClaimType.maxAmount` is documented as a ceiling *per claim*, so
 * checking it per line would let four lines of RM900 through a RM1,000 cap.
 *
 * `checkClaim` is left as it is. Expenses are single-line and still use it.
 */
export function checkClaimLine(input: {
  incurredOn: string;
  today: string;
  amount: number;
  requiresReceipt: boolean;
  hasReceipt: boolean;
  ratePerUnit: number | null;
  quantity: number | null;
}): Refusal | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.incurredOn)) {
    return { key: 'claim.refuse.badDate' };
  }
  // String comparison, for the reason given in `checkClaim`.
  if (input.incurredOn > input.today) {
    return { key: 'claim.refuse.future' };
  }
  if (daysBetween(input.incurredOn, input.today) > MAX_BACKDATE_DAYS) {
    return { key: 'claim.refuse.tooOld', vars: { days: MAX_BACKDATE_DAYS } };
  }

  /*
   * Quantity per line, not per claim.
   *
   * A week of travel is several journeys of different lengths, so one quantity on the claim could
   * only ever be their sum — and a sum tells nobody which trip was which. The rate stays on the
   * claim, frozen at filing; the distance it multiplies belongs to the line.
   */
  if (input.ratePerUnit !== null) {
    if (input.quantity === null || !Number.isFinite(input.quantity) || input.quantity <= 0) {
      return { key: 'claim.refuse.noQuantity' };
    }
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { key: 'claim.refuse.noAmount' };
  }

  /*
   * The receipt rule bites per line, which is what `requiresReceipt` now means.
   *
   * One journey's hotel bill and its toll slips are different documents. A claim that satisfied the
   * rule with a single receipt would let three unevidenced lines ride along with one that had paper
   * behind it.
   */
  if (input.requiresReceipt && !input.hasReceipt) {
    return { key: 'claim.refuse.noReceipt' };
  }

  return null;
}

/** The claim as a whole: at least one line, and the total inside both ceilings. */
export function checkClaimTotal(input: {
  lineCount: number;
  amount: number;
  maxAmount: number | null;
}): Refusal | null {
  if (input.lineCount === 0) return { key: 'claim.refuse.noLines' };

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { key: 'claim.refuse.noAmount' };
  }
  if (input.amount > MAX_CLAIM_AMOUNT) {
    return {
      key: 'claim.refuse.tooLarge',
      vars: { max: MAX_CLAIM_AMOUNT.toLocaleString('en-MY') },
    };
  }
  if (input.maxAmount !== null && input.amount > input.maxAmount) {
    return {
      key: 'claim.refuse.overCap',
      vars: { amount: input.amount.toFixed(2), cap: input.maxAmount.toFixed(2) },
    };
  }
  return null;
}

/**
 * What an approver may allow, or a refusal.
 *
 * Less than claimed is legitimate — a receipt above the cap is approved at the cap, and an
 * approver may disallow part of a claim with a note. More than claimed never is: that is no
 * longer the request anybody filed.
 */
export function checkApprovedAmount(input: {
  claimed: number;
  approved: number;
}): Refusal | null {
  if (!Number.isFinite(input.approved) || input.approved <= 0) {
    return { key: 'claim.refuse.noApprovedAmount' };
  }
  if (toSen(input.approved) > toSen(input.claimed)) {
    return {
      key: 'claim.refuse.aboveClaimed',
      vars: { approved: input.approved.toFixed(2), claimed: input.claimed.toFixed(2) },
    };
  }
  return null;
}

/**
 * Whole days between two `YYYY-MM-DD` dates.
 *
 * Both are parsed as UTC midnight, which is how date-only values are held throughout this
 * application. UTC also has no daylight saving, so a 24-hour step is exact.
 */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return Number.NaN;
  return Math.round((end - start) / 86_400_000);
}
