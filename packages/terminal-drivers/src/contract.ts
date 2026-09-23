import type { TerminalEvent } from './events.js';
import type { DriverCapabilities, WriteAck } from './capabilities.js';
import type {
  AttendanceModeSetting,
  CallbackConfig,
  CallbackTarget,
  ClockReading,
  DeviceWarning,
  DoorPatch,
  DoorSettings,
  FaceStore,
  OptionSets,
  PersonUpsert,
  ReaderPatch,
  ReaderSettings,
  TerminalCapacity,
  TerminalCounts,
  TerminalIdentity,
  TerminalPerson,
} from './types.js';

export type { TerminalEvent } from './events.js';
export {
  APPLIED,
  DriverOperation,
  queued,
  supports,
  unavailableReason,
  type DriverCapabilities,
  type Reachability,
  type WriteAck,
  type WriteModel,
} from './capabilities.js';
export type * from './types.js';

/**
 * Everything this application does to a physical terminal.
 *
 * One implementation per protocol. Hikvision ISAPI, ZKTeco TA Push and a future Dahua CGI
 * driver all satisfy this, and they run **at the same time** in one installation — mixing
 * vendors within a single site is the normal case, not the migration case, so every loop
 * over devices resolves its driver per row.
 *
 * ## Contracts a driver must honour
 *
 * These are not visible from the method signatures, which is exactly why they are written
 * here. All three currently live in the Hikvision transport rather than in the server, and a
 * driver that ignores them breaks in ways that look like hardware faults.
 *
 * **One request in flight per unit.** These are small embedded boxes that cap concurrent
 * sessions and answer 401 without a challenge once that cap is reached. Digest state is a
 * single shared counter, so overlapping requests hand the device out-of-order `nc` values
 * which it rejects. The driver serialises internally — callers are free to use
 * `Promise.all`, and it must not produce parallel traffic.
 *
 * **Never retry a rejected credential.** Repeating one is what triggers the firmware's
 * thirty-minute lockout, and a caller looping over 5000 staff can lock an operator out of
 * their own door controller while trying to be helpful. A transient session limit is a
 * different condition and may be retried briefly; a refused password may not.
 *
 * **Hold a local lockout gate.** Once the unit reports it is locked, further attempts are
 * refused here rather than sent, because sending them extends the window.
 *
 * ## Why reads and writes have different shapes
 *
 * Reads return a value, or `null` where the protocol has no such concept, and throw when the
 * unit cannot be reached. Writes return a `WriteAck` on success and throw on failure.
 *
 * A read cannot be queued: there is nothing to hand back. So on a callback protocol an
 * unsupported read is declared absent in `capabilities` and the screen says so, rather than
 * the driver inventing a value or blocking until the unit next dials in.
 */
export interface TerminalDriver {
  readonly protocol: string;
  readonly capabilities: DriverCapabilities;

  /** Releases sockets and cached auth state. Called when a device is edited or removed. */
  close(): Promise<void>;

  identity: {
    read(): Promise<TerminalIdentity>;
    counts(): Promise<TerminalCounts>;
    capacity(): Promise<TerminalCapacity>;
    /** Face stores the unit keeps. Empty rather than null when it keeps exactly one. */
    faceStores(): Promise<FaceStore[]>;
  };

  clock: {
    read(): Promise<ClockReading>;
    /**
     * Writes an absolute time, for a site with no reachable NTP host.
     *
     * A dead end worth naming in the UI: the clock starts drifting again immediately and
     * nothing corrects it.
     */
    setManually(when: Date, timeZone: string): Promise<WriteAck>;
    configureNtp(config: {
      host: string;
      timeZone: string;
      port?: number;
      intervalMinutes?: number;
    }): Promise<WriteAck>;
  };

  people: {
    /**
     * Creates or updates one person.
     *
     * Deliberately not split into create and update. Every caller wants the person to exist
     * with these details afterwards, and the two-call version raced: the firmware answers
     * "already exists" and the fallback to modify renames the existing record, leaving the
     * previous holder's face attached to a new name.
     */
    upsert(person: PersonUpsert): Promise<WriteAck>;
    remove(employeeNos: string[]): Promise<WriteAck>;
    find(employeeNo: string): Promise<TerminalPerson | null>;
    /**
     * Streams every person the terminal holds.
     *
     * A generator rather than an array because a full unit holds thousands and the caller
     * writes each one as it arrives. Materialising the list first would hold the whole
     * roster in memory to no benefit.
     */
    list(): AsyncIterable<TerminalPerson>;
  };

  biometrics: {
    /**
     * Enrols one face picture.
     *
     * The person record must already exist: terminals key the face to the identifier and
     * reject a face for somebody they do not know.
     *
     * On a queued protocol the acknowledgement is `confirmed: false`, and the screen has to
     * say so. A terminal that never collects the command leaves somebody unable to scan, and
     * reporting that as done is the failure mode this whole system exists to prevent.
     */
    enrolFace(employeeNo: string, jpeg: Buffer): Promise<WriteAck>;
    removeFace(employeeNo: string): Promise<WriteAck>;
    /** Fetches an enrolled face using the opaque pointer from `people.find`. */
    readFace(pointer: string): Promise<Buffer>;
  };

  events: {
    /**
     * Events the terminal is holding beyond the given cursor.
     *
     * The cursor is whatever the driver's own strategy needs: a monotonic sequence where the
     * protocol has one, and otherwise a time window the driver derives itself. Push-only
     * protocols declare this unsupported instead of emulating it.
     */
    pull(cursor: PullCursor): Promise<PullResult>;
    /** Snapshot bytes for an event, using the pointer the event carried. */
    picture(pointer: string): Promise<Buffer>;
  };

  access: {
    door(doorNo: number): Promise<DoorSettings | null>;
    setDoor(doorNo: number, patch: DoorPatch): Promise<WriteAck>;
    reader(readerNo: number): Promise<ReaderSettings | null>;
    setReader(readerNo: number, patch: ReaderPatch): Promise<WriteAck>;
    /**
     * Releases the lock once.
     *
     * The only operation that physically opens a door with nobody presenting a credential,
     * which is why its caller writes an audit row: the terminal logs a door event but not
     * who asked for it from a browser.
     */
    open(doorNo: number): Promise<WriteAck>;
    /** Option lists the unit publishes for its own settings, for building real controls. */
    options(): Promise<OptionSets>;
  };

  attendance: {
    mode(): Promise<AttendanceModeSetting | null>;
    setMode(mode: AttendanceModeSetting['mode']): Promise<WriteAck>;
  };

  lifecycle: {
    /**
     * Restarts the terminal.
     *
     * Implementations must treat a dropped connection as success, not failure: the firmware
     * stops answering mid-reply. The caller probes reachability first so that "rebooting now"
     * and "was never there" stay distinguishable.
     */
    reboot(): Promise<WriteAck>;
    callbackTargets(): Promise<CallbackTarget[]>;
    configureCallback(config: CallbackConfig): Promise<WriteAck>;
    clearCallback(slot: number): Promise<WriteAck>;
  };

  /**
   * Conditions only this driver knows to look for.
   *
   * The neutral checks — clock drift, capacity headroom — belong to the health module, which
   * owns the thresholds and reads them from configuration. This is for faults that are real
   * but vendor-shaped, and therefore invisible from above.
   *
   * The example that motivated it: a Hikvision remote-verification channel that always times
   * out adds its timeout to every single scan, which is felt as a queue at the door each
   * morning and reported by nothing. No other vendor has that setting, so no neutral check
   * could look for it.
   *
   * Must not throw for an optional diagnostic that is merely unavailable — an empty list is
   * the correct answer when a firmware hides the endpoint this reads.
   */
  vendorWarnings(): Promise<DeviceWarning[]>;

  /**
   * Whatever the unit says about itself, unfiltered.
   *
   * Shape is deliberately unconstrained. This is what makes a firmware change diagnosable
   * from a browser instead of a site visit, and constraining it would filter out exactly the
   * field that turns out to have changed.
   */
  diagnostics(): Promise<Record<string, unknown>>;
}

/**
 * Where a pull should resume from.
 *
 * Carries both forms because protocols differ and neither can be derived from the other. A
 * sequence cursor survives clock corrections, which matters because these clocks do get
 * corrected — a time-windowed cursor skips or replays records the moment NTP moves the
 * clock. But a protocol without a sequence has only the time window available.
 */
export interface PullCursor {
  sequence: number | null;
  since: Date | null;
}

export interface PullResult {
  events: TerminalEvent[];
  /**
   * Cursor to store for the next pull.
   *
   * Returned by the driver rather than computed by the caller, because only the driver knows
   * which form advances. The caller previously derived it from the highest serial number in
   * the batch, which silently stops working for a protocol that has none.
   *
   * Must advance past events the driver itself discarded — otherwise a single unparseable
   * record is re-fetched forever and the pull never reaches anything newer.
   */
  cursor: PullCursor;
}
