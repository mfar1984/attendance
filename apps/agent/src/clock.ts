/**
 * The cloud's clock, and the refusal to substitute our own.
 *
 * ## Why this exists
 *
 * A Raspberry Pi has no battery-backed clock. Booted without a network it starts from whatever
 * the filesystem last recorded, which can be months out. If a connector in that state wrote its
 * own time to fifteen terminals, every scan at that site would be filed against the wrong
 * instant — and the records would look entirely authoritative. Nothing downstream could detect
 * it: the attendance engine trusts the terminal's reported time because the terminal is the
 * thing that was there.
 *
 * So the connector never sources time. It relays the cloud's, and until it has seen one it
 * refuses to set a terminal clock at all. A terminal left drifting is a visible problem with a
 * warning on the devices screen. A terminal confidently set to the wrong day is not.
 *
 * ## Why an offset rather than a stored timestamp
 *
 * `performance.now()` is monotonic and unaffected by the system clock being corrected, which is
 * exactly what happens on this hardware a few seconds after the network comes up. Holding the
 * cloud's instant plus a monotonic reading means a correction to the local clock cannot move the
 * derived value — whereas anchoring on `Date.now()` would make the time jump by however far NTP
 * moved it, a minute after the offset was taken.
 */

interface Anchor {
  /** Cloud instant, in epoch milliseconds. */
  cloudMs: number;
  /** Monotonic reading taken as close to it as possible. */
  monotonic: number;
}

let anchor: Anchor | null = null;

/**
 * Records the cloud's clock, as reported in a heartbeat reply.
 *
 * An unparseable value is ignored rather than accepted as `Invalid Date`, because the whole
 * purpose here is refusing to act on a time we cannot vouch for.
 */
export function noteCloudTime(iso: string): boolean {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return false;

  anchor = { cloudMs: parsed, monotonic: performance.now() };
  return true;
}

/** Whether a terminal clock may be written. */
export function clockIsTrusted(): boolean {
  return anchor !== null;
}

/**
 * The current instant according to the cloud, or null if it has never been reported.
 *
 * Null is a refusal, not a fallback. Every caller must treat it as "do not write a clock", and
 * returning `new Date()` here instead would defeat the only protection this module provides.
 */
export function cloudNow(): Date | null {
  if (!anchor) return null;
  return new Date(anchor.cloudMs + (performance.now() - anchor.monotonic));
}

/**
 * How far this machine's own clock is from the cloud's, in seconds.
 *
 * Reported rather than acted on. A connector whose own clock is wrong is worth seeing on a
 * screen, but correcting it is the operating system's job and doing it from here would fight
 * whatever NTP is also trying to do.
 */
export function localDriftSeconds(): number | null {
  const cloud = cloudNow();
  if (!cloud) return null;
  return Math.round((Date.now() - cloud.getTime()) / 1000);
}

/** Test seam. Never called in normal operation. */
export function resetClockForTests(): void {
  anchor = null;
}
