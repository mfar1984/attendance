/**
 * Overtime rules, rates and the Employment Act 1955 minimums.
 *
 * Import-free on purpose, so every rule here runs without a database.
 *
 * Statutory references — Employment Act 1955 as amended by the Employment (Amendment)
 * Act 2022, and the Employment (Limitation of Overtime Work) Regulations 1980:
 *
 *   s.60A(3)(a)  overtime on a normal working day: not less than 1.5 × the hourly rate
 *   s.60(3)(b)   overtime on a rest day: not less than 2.0 ×
 *   s.60D(3)(aa) overtime on a paid public holiday: not less than 3.0 ×
 *   s.60I(1)     the ordinary rate of pay is the monthly wage ÷ 26, and the hourly
 *                rate is that ÷ the normal hours of work
 *   Reg. 2       overtime may not exceed 104 hours in one month
 *
 * A compliance aid, not legal advice.
 */

export const OVERTIME_DAY_TYPES = ['weekday', 'restDay', 'holiday', 'holidayRestDay'] as const;

export type OvertimeDayType = (typeof OVERTIME_DAY_TYPES)[number];

export const OVERTIME_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

export type OvertimeStatus = (typeof OVERTIME_STATUSES)[number];

/**
 * The published minimum multiplier for each day type.
 *
 * `holidayRestDay` is not a category the Act names: a paid public holiday that falls on
 * a rest day is still a public holiday, so 3.0 is its floor.
 */
export const STATUTORY_MULTIPLIER: Record<OvertimeDayType, number> = {
  weekday: 1.5,
  restDay: 2,
  holiday: 3,
  holidayRestDay: 3,
};

/** Employment (Limitation of Overtime Work) Regulations 1980, regulation 2. */
export const MONTHLY_OVERTIME_CAP_MINUTES = 104 * 60;

/** Days per month and hours per day the hourly rate is derived from (s.60I). */
export const DAYS_PER_MONTH = 26;
export const HOURS_PER_DAY = 8;

/**
 * Longest single claim accepted.
 *
 * A shift plus a full working day. Beyond that it is a data-entry slip, and the engine
 * would not have measured it anyway.
 */
export const MAX_CLAIM_MINUTES = 16 * 60;

/*
 * Money rounding moved to `hr/money.ts` when claims needed the same half-up rule.
 * Re-exported so callers and the test suite keep pointing at one implementation.
 */
export { toSen } from './money.js';

import { toSen } from './money.js';

/**
 * The hourly rate of pay from a monthly wage (s.60I).
 *
 * Monthly ÷ 26 is the ordinary rate for a day; ÷ 8 again is the hourly rate.
 */
export function hourlyRateFrom(monthlyWage: number): number {
  if (!Number.isFinite(monthlyWage) || monthlyWage <= 0) return Number.NaN;
  return toSen(monthlyWage / (DAYS_PER_MONTH * HOURS_PER_DAY));
}

/**
 * What is owed for an approved claim.
 *
 * Rounded once, at the end. Rounding the hourly rate and then the product again is how
 * a figure on screen stops matching the figure in the export.
 */
export function overtimeAmount(hourlyRate: number, multiplier: number, minutes: number): number {
  if (![hourlyRate, multiplier, minutes].every(Number.isFinite)) return Number.NaN;
  return toSen(hourlyRate * multiplier * (minutes / 60));
}

/** Does this multiplier meet the statutory floor for its day type? */
export function rateShortfall(
  dayType: OvertimeDayType,
  multiplier: number,
): { floor: number; actual: number } | null {
  const floor = STATUTORY_MULTIPLIER[dayType];
  if (!Number.isFinite(multiplier) || multiplier >= floor) return null;
  return { floor, actual: multiplier };
}

export interface OvertimeClaimInput {
  /** What the engine measured for the day, in minutes. */
  measuredMinutes: number;
  /** What is being claimed, in minutes. */
  requestedMinutes: number;
  /** Already recorded for the same calendar month, excluding this claim. */
  monthMinutes: number;
}

/**
 * Why this claim cannot stand, or null.
 *
 * Returns a key and its variables rather than prose: these refusals are read on a
 * screen, and the server has no reader whose language it can consult.
 */
export type OvertimeRefusal = { key: string; vars?: Record<string, string | number> };

export function checkOvertimeClaim(input: OvertimeClaimInput): OvertimeRefusal | null {
  const { measuredMinutes, requestedMinutes, monthMinutes } = input;

  if (!Number.isInteger(requestedMinutes) || requestedMinutes <= 0) {
    return { key: 'overtime.refuse.noMinutes' };
  }

  /*
   * The whole reason the hours are not typed.
   *
   * The engine derived `measuredMinutes` from the raw log, which is the record of what
   * the terminals reported and the one thing nobody can edit. A claim above it is a
   * claim with no evidence, and paying it would be paying a number somebody typed.
   */
  if (measuredMinutes <= 0) {
    return { key: 'overtime.refuse.noneMeasured' };
  }
  if (requestedMinutes > measuredMinutes) {
    return {
      key: 'overtime.refuse.aboveMeasured',
      vars: { requested: formatMinutes(requestedMinutes), measured: formatMinutes(measuredMinutes) },
    };
  }

  if (requestedMinutes > MAX_CLAIM_MINUTES) {
    return { key: 'overtime.refuse.tooLong', vars: { max: formatMinutes(MAX_CLAIM_MINUTES) } };
  }

  const already = Number.isFinite(monthMinutes) ? Math.max(monthMinutes, 0) : 0;
  if (already + requestedMinutes > MONTHLY_OVERTIME_CAP_MINUTES) {
    return {
      key: 'overtime.refuse.monthlyCap',
      vars: {
        cap: formatMinutes(MONTHLY_OVERTIME_CAP_MINUTES),
        already: formatMinutes(already),
        left: formatMinutes(Math.max(MONTHLY_OVERTIME_CAP_MINUTES - already, 0)),
      },
    };
  }

  return null;
}

/**
 * Minutes as hours to two decimals, trailing zeros trimmed.
 *
 * Used inside refusal variables, so it carries no unit word — the label supplies that
 * and a hard-coded "jam" here would survive translation.
 */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes)) return '0';
  const hours = Math.round((minutes / 60) * 100) / 100;
  return String(hours);
}

/*
 * Request numbering moved to `hr/request-number.ts` when the claim and expense modules
 * needed the same arithmetic. Re-exported so existing callers and the test suite keep
 * working against one implementation rather than two that can drift.
 */
export { nextRequestNo, sequenceOf } from './request-number.js';
