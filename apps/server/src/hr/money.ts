/**
 * Money arithmetic, shared by every module that turns something into ringgit.
 *
 * Import-free. Lifted out of the overtime library once claims needed the same rounding —
 * two implementations of half-up rounding is two answers to what a payslip says.
 */

/**
 * Money to two decimal places, rounded half up.
 *
 * `Math.round(value * 100) / 100` is the obvious version and it is wrong at exactly the
 * boundary it exists to handle. IEEE-754 holds 15.015 as 15.014999999999999, so scaling
 * gives 1501.4999… and rounding lands on 15.01 — a sen short, silently, on a figure somebody
 * is paid. Reachable with ordinary inputs: an hourly rate of 10.01 at 1.5× for one hour is
 * exactly that number.
 *
 * Trimming the scaled value to twelve significant digits removes the representation error
 * without touching any digit that carries meaning.
 */
export function toSen(value: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  return Math.round(Number((value * 100).toPrecision(12))) / 100;
}

/**
 * Quantity times a rate, rounded once at the end.
 *
 * Rounding the product of a rounded intermediate is how the figure on screen stops matching
 * the figure in the export.
 */
export function ratedAmount(quantity: number, ratePerUnit: number): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(ratePerUnit)) return Number.NaN;
  return toSen(quantity * ratePerUnit);
}
