/**
 * The capability vocabulary, re-exported, plus the write acknowledgement that belongs here.
 *
 * `DriverOperation` and friends moved to `@attendance/shared` once the device editor had to read
 * them: the browser cannot import this package — it pulls in the ISAPI client and a socket
 * transport — so the screen had grown its own copy of the shape, and a second capability list is
 * one free to drift from the drivers it claims to describe. It did: it was never read, and the
 * editor rendered all seven tabs for every protocol.
 *
 * Re-exported rather than relocated silently, so every `from './capabilities.js'` and every
 * `from '@attendance/terminal-drivers'` in the server and the agent still resolves.
 *
 * `WriteAck` stays. It is how a driver reports an outcome, not what a driver can do, and nothing
 * outside the drivers and their callers constructs one.
 */
export {
  DriverOperation,
  declares,
  supports,
  unavailableReason,
  type DriverCapabilities,
  type Reachability,
  type UnavailableReason,
  type WriteModel,
} from '@attendance/shared';

/**
 * Acknowledgement from an operation that changes the terminal.
 *
 * Failures still throw, exactly as before, so every existing call site keeps working
 * untouched. What this adds is the distinction between a write the terminal confirmed and a
 * write that is merely accepted — and only the call sites that report an outcome to an
 * operator need to look at it.
 *
 * Returning a failure value instead of throwing was considered and rejected: it would mean
 * rewriting all 26 call sites to check a discriminant, and a caller that forgot would treat
 * a failure as success. A thrown error cannot be ignored by accident.
 */
export type WriteAck =
  | {
      confirmed: true;
    }
  | {
      confirmed: false;
      /**
       * The queued command, so the caller can record what it is waiting on and a screen can
       * later say whether it was ever collected.
       */
      commandId: string;
    };

/** The terminal confirmed this before the call returned. */
export const APPLIED: WriteAck = { confirmed: true };

export function queued(commandId: string): WriteAck {
  return { confirmed: false, commandId };
}
