/**
 * What a driver can actually do, declared rather than discovered by failure.
 *
 * Before this existed, an operation a vendor has no concept of and an operation whose unit
 * is not answering both produced the same thing: a null, rendered amber like a fault. So a
 * ZKTeco terminal would show its door controls greyed with a warning tone, and an operator
 * would spend the afternoon trying to fix hardware that was working correctly.
 */

/**
 * Every operation the server performs against a terminal.
 *
 * Derived from the call sites, not from what any vendor's client library exports. The
 * Hikvision package exposes 41 methods; the server calls roughly 28 of them, and the rest
 * are ISAPI-only plumbing. Shaping the contract around the exports would have imported one
 * vendor's surface area as the definition of a terminal.
 */
export const DriverOperation = {
  // --- Identity and health ---
  readIdentity: 'readIdentity',
  readCounts: 'readCounts',
  readCapacity: 'readCapacity',
  readFaceStores: 'readFaceStores',

  // --- Clock ---
  readClock: 'readClock',
  setClockManually: 'setClockManually',
  configureNtp: 'configureNtp',

  // --- People ---
  upsertPerson: 'upsertPerson',
  removePerson: 'removePerson',
  findPerson: 'findPerson',
  listPeople: 'listPeople',

  // --- Biometrics ---
  enrolFace: 'enrolFace',
  removeFace: 'removeFace',
  readFace: 'readFace',

  // --- Events ---
  /** Fetch events the terminal is holding. Absent on protocols that only push. */
  pullEvents: 'pullEvents',
  readEventPicture: 'readEventPicture',

  // --- Door and reader ---
  readDoorSettings: 'readDoorSettings',
  writeDoorSettings: 'writeDoorSettings',
  readReaderSettings: 'readReaderSettings',
  writeReaderSettings: 'writeReaderSettings',
  openDoor: 'openDoor',

  // --- Attendance labelling ---
  readAttendanceMode: 'readAttendanceMode',
  writeAttendanceMode: 'writeAttendanceMode',

  // --- Lifecycle ---
  reboot: 'reboot',
  readCallbackTargets: 'readCallbackTargets',
  configureCallback: 'configureCallback',
  clearCallback: 'clearCallback',

  // --- Diagnostics ---
  readDiagnostics: 'readDiagnostics',
} as const;
export type DriverOperation = (typeof DriverOperation)[keyof typeof DriverOperation];

/**
 * How a driver's writes report their outcome.
 *
 * `inline` means the call returns only once the terminal has confirmed. `queued` means the
 * command was durably recorded and the terminal will collect it when it next polls — the
 * outcome arrives later, or never if the unit stays offline.
 *
 * This is the difference that cannot be hidden. A screen that reports a queued face
 * enrolment as done is a screen that tells an operator somebody can clock in tomorrow
 * morning when they cannot, which is precisely the failure this whole system exists to
 * prevent.
 */
export type WriteModel = 'inline' | 'queued';

/**
 * Which side opens the connection.
 *
 * `serverInitiated` protocols need inbound access to the unit for every operation — on
 * Hikvision, including the call that configures push in the first place. So a terminal at a
 * remote site needs a VPN or a forwarded port.
 *
 * `deviceInitiated` protocols need none: the unit dials out for both events and commands.
 * That makes them the cheaper option across sites, which inverts the usual assumption.
 */
export type Reachability = 'serverInitiated' | 'deviceInitiated';

export interface DriverCapabilities {
  /** Operations this protocol supports at all, regardless of whether the unit is up. */
  readonly operations: readonly DriverOperation[];
  readonly writeModel: WriteModel;
  readonly reachability: Reachability;
  /**
   * Operations the protocol has but this *model* or firmware lacks.
   *
   * Separate from omitting them entirely, because the reason differs and so does the advice.
   * ZKTeco face upload needs firmware V1.5 or newer: on an older unit the operation exists
   * in the protocol and the screen should say "this firmware cannot", not "this vendor
   * cannot".
   */
  readonly unavailable?: Readonly<Partial<Record<DriverOperation, string>>>;
}

export function supports(
  capabilities: DriverCapabilities,
  operation: DriverOperation,
): boolean {
  if (!capabilities.operations.includes(operation)) return false;
  return capabilities.unavailable?.[operation] === undefined;
}

/**
 * Why an operation is not available, or null when it is.
 *
 * Returns a reason for the firmware case and null for both "supported" and "the protocol
 * does not have it" — the caller distinguishes those two with `supports()`, because the
 * screen wording differs and a shared code path would have to guess which one to show.
 */
export function unavailableReason(
  capabilities: DriverCapabilities,
  operation: DriverOperation,
): string | null {
  return capabilities.unavailable?.[operation] ?? null;
}

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
