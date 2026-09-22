/**
 * Human-readable request numbers, shared by every HR request module.
 *
 * `<PREFIX>-YYYYMM-NNN`. The prefix names the module, the month scopes the sequence, and the
 * sequence restarts each month so the numbers stay short enough to read aloud over a phone.
 *
 * Import-free, so the sequence arithmetic is testable without a database. It is worth
 * testing: the obvious implementation sorts on the whole string, which puts `-10` before
 * `-9` and reissues a number already in use.
 */

/** Prefix per module. Short, uppercase, and never reused. */
export const REQUEST_PREFIX = {
  overtime: 'OT',
  claim: 'TT',
  expenses: 'PB',
} as const;

export type RequestPrefix = (typeof REQUEST_PREFIX)[keyof typeof REQUEST_PREFIX];

/** `YYYYMM` from a calendar date, read in UTC because that is how date-only values are held. */
export function yearMonthOf(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return `${String(year)}${String(month).padStart(2, '0')}`;
}

/**
 * The next number for a month, from the highest sequence already issued.
 *
 * The caller reads that highest value inside the same transaction as the insert, and the
 * unique index on the column is the backstop: two people filing in the same second would
 * otherwise both read the same number.
 */
export function nextRequestNo(
  prefix: RequestPrefix,
  yearMonth: string,
  highestSequence: number,
): string {
  const next = Math.max(highestSequence, 0) + 1;
  return `${prefix}-${yearMonth}-${String(next).padStart(3, '0')}`;
}

/**
 * The sequence inside a request number, or 0 when it does not carry one.
 *
 * Matches the whole shape rather than the trailing digits. A pattern of `-(\d+)$` alone
 * reads `OT-202609` as sequence 202609, and the next number issued becomes
 * `OT-202609-202610`.
 */
export function sequenceOf(requestNo: string): number {
  const match = /^[A-Z]{2}-\d{6}-(\d+)$/.exec(requestNo);
  if (!match?.[1]) return 0;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

/** Highest sequence across a month's existing numbers. */
export function highestSequence(requestNos: string[]): number {
  return requestNos.reduce((max, item) => Math.max(max, sequenceOf(item)), 0);
}
