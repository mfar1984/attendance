import type { TerminalEventPayload } from '@attendance/shared';
import type { TerminalEvent } from '@attendance/terminal-drivers';

/**
 * A driver's event, ready to be written to the spool or sent.
 *
 * One line of real work — serialising the instant — and it lives in its own file so both the
 * listener and the puller call the same one. Two call sites each doing it inline is how one of
 * them ends up sending a `Date` that `JSON.stringify` renders correctly today and a future
 * refactor renders as `{}`.
 *
 * Only this direction is needed here. The cloud converts the other way through the Zod schema,
 * which is also what proves the two shapes still match.
 */
export function toPayload(event: TerminalEvent): TerminalEventPayload {
  return { ...event, at: event.at.toISOString() };
}
