import type { PunchDirection, RawEventKind, VerifyMethod } from '@attendance/shared';

/**
 * One terminal event, in terms this application understands.
 *
 * This is the boundary between a vendor's wire format and everything downstream.
 * `packages/hik-isapi` looks like that boundary but is not: its `AcsEvent` is
 * Hikvision's own payload with TypeScript applied, so a ZKTeco driver satisfying it
 * would have to invent a `major` of 5 and a `minor` of 75 to describe a face match
 * that its protocol reports as a verify type with no major at all. That is not a
 * driver, it is one vendor impersonating another.
 *
 * So the driver decides what an event *means* and hands over this shape. Derivation,
 * dedup, identity mapping, punch publishing and the live monitor all read it and
 * none of them know which vendor produced it.
 *
 * Every field that a protocol may genuinely lack is nullable, and null means
 * "this protocol has no such concept" rather than "we failed to read it". The two
 * would otherwise be indistinguishable, and a screen cannot tell an operator which
 * one they are looking at.
 */
export interface TerminalEvent {
  /**
   * Dedup identity for this event on this device. Required, always.
   *
   * Namespaced by protocol (`isapi:8231`, `ta-push:<sha256>`) so two drivers cannot
   * collide on the same device row, and so a key read back later still says which
   * decoder produced it.
   *
   * This exists because `serialNo` was doing three jobs at once — dedup key, pull
   * cursor and sort order — all of which assumed a monotonic per-device counter.
   * ZKTeco TA Push delivers an ATTLOG row with a PIN and a timestamp and no counter
   * of any kind, so a callback retry had no way to be recognised as a repeat.
   */
  eventKey: string;

  /**
   * What the driver decided this event means.
   *
   * Derivation branches on this instead of on vendor event codes. That is the whole
   * reason a second vendor does not require touching the attendance engine.
   */
  kind: RawEventKind;

  /** Credential the terminal matched, when it reports one. */
  verifyMethod: VerifyMethod | null;

  /** Instant as the terminal reported it, offset included. */
  at: Date;

  /**
   * The person identifier local to this terminal.
   *
   * Deliberately not resolved here. The same person carries a different number on
   * each unit, so the mapping is a database lookup the driver has no business doing.
   */
  employeeNo: string | null;

  /** Name as the terminal holds it. Used only to give the review queue a clue. */
  personName: string | null;

  /**
   * Monotonic sequence, where the protocol has one.
   *
   * Null for callback protocols. Kept because a protocol that *does* have one gets a
   * far cheaper pull cursor than a date-range scan, and discarding it to make every
   * driver look alike would throw that away.
   */
  sequence: number | null;

  /**
   * Direction, only when the terminal itself reports it.
   *
   * Null is the normal case: with attendance mode disabled the hardware says nothing,
   * and the engine derives direction from scan order and the roster. Guessing here
   * would make that derivation irreversible.
   */
  direction: PunchDirection | null;

  /**
   * Card number, when it is a real credential.
   *
   * The driver is responsible for discarding synthetic sentinels — Hikvision firmware
   * writes a 64-bit placeholder here on face authentication, and storing it fills the
   * log with cards nobody owns.
   */
  cardNo: string | null;

  doorNo: number | null;
  readerNo: number | null;

  /** Snapshot URL, normalised by the driver so it stays stable across reads. */
  pictureUrl: string | null;

  /**
   * Vendor-native detail, retained as evidence and for diagnosis.
   *
   * Nothing branches on these. They are here so that a firmware change can be
   * investigated from the log rather than from another site visit, and so the raw
   * event stays a faithful record of what the terminal actually said.
   */
  native: {
    /** Hikvision's two-level code. Null for protocols without one. */
    major: number | null;
    minor: number | null;
    /** The terminal's own spelling of the verify mode, unmapped. */
    verifyMode: string | null;
    maskWorn: string | null;
    /**
     * The terminal's own direction string, stored verbatim.
     *
     * Kept alongside the mapped `direction` rather than replaced by it because the
     * existing log already holds vendor spellings (`checkIn`, `overtimeIn`), and
     * rewriting an append-only evidence table so old and new rows agree would mean
     * editing the record instead of adding to it. Two rows meaning the same thing
     * while reading differently is the worse of the two problems.
     */
    direction: string | null;
  };

  /** Full original payload, exactly as received. */
  payload: unknown;
}
