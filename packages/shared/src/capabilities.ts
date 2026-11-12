import type { LabelKey } from './labels.js';

/**
 * What a driver can actually do, declared rather than discovered by failure.
 *
 * Before this existed, an operation a vendor has no concept of and an operation whose unit
 * is not answering both produced the same thing: a null, rendered amber like a fault. So a
 * ZKTeco terminal would show its door controls greyed with a warning tone, and an operator
 * would spend the afternoon trying to fix hardware that was working correctly.
 *
 * ## Why this is in `shared` and not in `terminal-drivers`
 *
 * It began beside the drivers, which is where it is produced. But the **screen** is what has to
 * render honestly, and the browser cannot import `terminal-drivers` — that package pulls in the
 * ISAPI client and a socket transport, which have no business in a bundle.
 *
 * So the device editor grew its own copy of the shape: a second `DriverCapabilities` interface
 * typed against `string`, in `DeviceEditorPage.tsx`, free to drift from the drivers it described.
 * It did drift — it was never read, and the tabs rendered unconditionally for every protocol.
 *
 * One definition, three readers. `terminal-drivers` re-exports these so every existing driver
 * import path still resolves, and the server keeps importing them from there.
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

/**
 * Why one operation is unavailable on this unit, as a label key rather than as prose.
 *
 * Same shape as `DeviceWarning`, and for the same reason: the sentence is rendered on a
 * screen, and a driver is constructed by a timer, a probe or a cron run with no reader whose
 * language could be consulted. The reasons were written inline in Malay, so the control they
 * grey out explained itself in a language the reader may not have chosen — on a screen whose
 * whole purpose is to say plainly what this terminal can do.
 *
 * `vars` because one of them carries a firmware version, and a sentence split around the
 * number assumes every language puts it in the same place.
 */
export interface UnavailableReason {
  key: LabelKey;
  vars?: Record<string, string | number>;
}

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
  readonly unavailable?: Readonly<Partial<Record<DriverOperation, UnavailableReason>>>;
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
): UnavailableReason | null {
  return capabilities.unavailable?.[operation] ?? null;
}

/**
 * Whether the protocol has this operation at all, whether or not this unit can perform it.
 *
 * The third question, and the one a screen needs before it decides whether to draw anything.
 * `supports()` answers false for both absences, which is right for "may I call this" and
 * wrong for "is there anything here to explain":
 *
 * - declared and supported — draw the control, enabled.
 * - declared and unavailable — draw it disabled, with the driver's reason beside it. Hiding it
 *   would hide the explanation, and the explanation is the actionable part: enrol the face at
 *   the terminal, open the door at the keypad.
 * - not declared — draw nothing. There is no concept to explain, and a greyed control for an
 *   operation the vendor has never heard of reads as a fault or as a missing permission.
 *
 * That last line is what makes the device editor drop whole tabs rather than render four of
 * them full of controls a ZKTeco terminal has no answer for.
 */
export function declares(
  capabilities: DriverCapabilities,
  operation: DriverOperation,
): boolean {
  return capabilities.operations.includes(operation);
}
