/**
 * Terminal data in terms this application understands.
 *
 * Every shape here is a rewrite, not a re-export. `packages/hik-isapi` exposes Hikvision's
 * own payloads — `Valid`, `RightPlan`, `responseStatusStrg`, `FDID`, and a timezone written
 * `CST-8:00:00` to mean UTC+8 — and a driver for another vendor satisfying those would have
 * to fabricate fields its protocol has never heard of.
 *
 * The rule applied throughout: **null means this protocol has no such concept**, and an
 * unreachable terminal throws instead. Collapsing the two would leave a screen unable to
 * tell an operator whether a setting is missing or merely unread, and those need different
 * actions from them.
 */

import type { LabelKey } from '@attendance/shared';

/** What this box is. Written to the device record so hardware swaps are detectable. */
export interface TerminalIdentity {
  /** The unit's own name, as configured on it. */
  name: string | null;
  model: string | null;
  /**
   * The manufacturer's serial number.
   *
   * Not optional in practice for callback protocols: it is the *only* identifier a ZKTeco
   * TA Push request carries, so it is how the sending unit is recognised at all.
   */
  serialNumber: string | null;
  macAddress: string | null;
  firmware: string | null;
}

/**
 * How far out the terminal's clock is, and what is driving it.
 *
 * Measured rather than read, because the drift is the whole point: it is the only fault
 * that corrupts every record while leaving the unit fully functional. Scans keep arriving,
 * nothing errors, and the timestamps are simply wrong.
 */
export interface ClockReading {
  deviceTime: Date;
  serverTime: Date;
  /** Positive means the terminal is ahead of this server. */
  driftSeconds: number;
  /**
   * What is keeping the clock correct.
   *
   * `manual` is a dead end worth naming: a hand-set clock starts drifting again
   * immediately and nothing corrects it. `unknown` is for protocols that do not say.
   */
  source: 'ntp' | 'manual' | 'unknown';
  /**
   * Offset from UTC in minutes, normalised.
   *
   * Hikvision writes the zone POSIX-style and inverted — `CST-8:00:00` denotes UTC+8 — and
   * every consumer that read the raw string had to know that. Converting once in the driver
   * means nothing above this line can get the sign wrong.
   */
  utcOffsetMinutes: number | null;
  /** The terminal's own spelling, kept for the diagnostics view. */
  rawTimeZone: string | null;
}

/** How much the terminal is holding, and how much it can hold. */
export interface TerminalCounts {
  people: number;
  withFace: number | null;
  withFingerprint: number | null;
  withCard: number | null;
}

/**
 * Storage ceilings for one unit.
 *
 * Separate from the counts because they come from a different endpoint that is allowed to
 * fail on its own: a firmware that hides its capacity must not blank out the enrolment
 * figures beside it.
 *
 * These differ sharply by vendor, which is why they are read from the unit rather than
 * taken from a shared constant. A Hikvision DS-K1T342MFX-E1 holds 1500 faces; a ZKTeco
 * SenseFace 3A holds 3000 faces against 6000 users.
 */
export interface TerminalCapacity {
  people: number | null;
  faces: number | null;
  fingerprints: number | null;
}

/**
 * A person as one terminal holds them.
 *
 * `employeeNo` is the identifier *local to that unit*. The same person routinely carries a
 * different number on each terminal, so this is never assumed to match a staff number.
 */
export interface TerminalPerson {
  employeeNo: string;
  name: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  /** Whether a door PIN is set. The value itself is deliberately not carried. */
  hasPin: boolean;
  credentials: {
    faces: number | null;
    fingerprints: number | null;
    cards: number | null;
  };
  /**
   * Opaque handle for the enrolled face, or null when none is enrolled.
   *
   * Passed back to `biometrics.readFace()` unchanged. Opaque on purpose: on Hikvision it is
   * a URL behind Digest auth, and a caller that knew that would be a caller that breaks when
   * another protocol returns a record index instead.
   */
  facePointer: string | null;
}

/** A person to write onto a terminal. */
export interface PersonUpsert {
  employeeNo: string;
  name: string;
  validFrom?: Date;
  validTo?: Date;
  /** Door PIN in cleartext. Terminals store it that way; nothing here can change that. */
  pin?: string;
  /** Which door this person is permitted at, for units that scope permission per door. */
  doorNo?: number;
}

/** A face store on the terminal, for the identity view. */
export interface FaceStore {
  id: string;
  name: string | null;
}

/**
 * Door behaviour on one terminal.
 *
 * Every field nullable because firmware families disagree about which exist, and an absent
 * field has to read as "not reported" rather than as zero — a door open duration displayed
 * as 0 seconds is a value somebody will try to fix.
 *
 * `raw` carries everything the unit answered, which is what makes a read-modify-write
 * possible and what the diagnostics view shows.
 */
export interface DoorSettings {
  doorNo: number;
  name: string | null;
  /** Seconds the lock stays released after a successful authentication. */
  openSeconds: number | null;
  /** Seconds allowed for someone flagged as needing longer. */
  extendedOpenSeconds: number | null;
  /** Seconds a door may stand open before the terminal raises an alarm. */
  heldOpenAlarmSeconds: number | null;
  /** Resting state of the magnet sensor. */
  sensorRestState: string | null;
  /** Resting state of the exit button. */
  exitButtonRestState: string | null;
  heldOpenAlarmEnabled: boolean | null;
  raw: Record<string, unknown>;
}

/**
 * Reader configuration, which is where the authentication requirement lives.
 *
 * `verifyMode` decides whether a face alone opens the door, or a face and a PIN, or a card.
 * The accepted value set is firmware-specific, so `verifyModeOptions` is read from the unit
 * rather than written into this repository — a hardcoded list offers choices the unit
 * rejects and hides ones it accepts, and both read as bugs in this application.
 */
export interface ReaderSettings {
  readerNo: number;
  enabled: boolean | null;
  verifyMode: string | null;
  /** Credential modules switched on, as neutral names where the driver can map them. */
  functions: string[];
  /** 1:N face match threshold, 0-100. Higher rejects more borderline faces. */
  faceThreshold: number | null;
  /** Anti-spoofing. False means a photograph is not being screened out. */
  livenessEnabled: boolean | null;
  livenessLevel: string | null;
  /**
   * Fingerprint match strictness.
   *
   * Deliberately not typed as a 1-5 scale. The accepted set on the tested Hikvision firmware
   * is 3, 5, 6, 12 and 13, so a bounded range would accept values the unit refuses while
   * blocking ones it takes. The unit's own option list is the authority.
   */
  fingerprintLevel: number | null;
  raw: Record<string, unknown>;
}

/** Changes to apply to a door. Only the named fields are written. */
export interface DoorPatch {
  openSeconds?: number;
  extendedOpenSeconds?: number;
  heldOpenAlarmSeconds?: number;
  heldOpenAlarmEnabled?: boolean;
  /** Resting state of the magnet sensor: normally closed or normally open. */
  sensorRestState?: 'alwaysClose' | 'alwaysOpen';
}

/** Changes to apply to a reader. */
export interface ReaderPatch {
  verifyMode?: string;
  faceThreshold?: number;
  fingerprintLevel?: number;
  livenessEnabled?: boolean;
  livenessLevel?: string;
}

/**
 * How the terminal labels a scan as arrival or departure.
 *
 * `disable` is this installation's setting, which is why direction is derived from scan
 * order and the roster rather than taken from the hardware.
 */
export interface AttendanceModeSetting {
  mode: 'disable' | 'manual' | 'auto' | 'manualAndAuto';
  raw: Record<string, unknown>;
}

/**
 * Where a terminal should send events, as it currently holds it.
 *
 * Credentials are never carried back out. The route that reads this already stripped the
 * password before replying, and a type that can hold one invites the next reader to forget.
 */
export interface CallbackTarget {
  slot: number;
  /**
   * The complete address, assembled by the driver.
   *
   * Hikvision stores the scheme, host, port and path as four separate fields, so a caller
   * receiving those would have to know how to join them — and would join them differently
   * from the next caller. One string here means the screen shows exactly where the terminal
   * is pointed without reconstructing it.
   */
  url: string;
  /** `none` here means an open ingest endpoint for anyone who can reach it. */
  authMethod: string;
  /** The username, which is not a secret. The password is never carried. */
  authUser: string | null;
  /** Payload encoding the terminal will use, where it reports one. */
  format: string | null;
  heartbeatSeconds: number | null;
}

/** Where to point a terminal so its events reach us. */
export interface CallbackConfig {
  /** Address the *terminal* can reach us on, which is not necessarily our own address. */
  host: string;
  port: number;
  path: string;
  useHttps: boolean;
  slot?: number;
  heartbeatSeconds?: number;
  /** Shared secret for the ingest endpoint, where the protocol authenticates at all. */
  auth?: { username: string; password: string };
}

/** Free-form option lists a terminal publishes for its own settings. */
export type OptionSets = Record<string, string[]>;

/**
 * One reason a terminal's data should not be trusted as-is.
 *
 * A registry key and the measurements that go in it, rather than a finished sentence. The
 * probe runs on a timer with no reader attached, so it has no language to resolve to, and the
 * numbers sit in different places in different languages.
 *
 * Declared here rather than in the health module so a driver can produce one without the
 * driver layer depending on the caller that consumes it.
 */
export interface DeviceWarning {
  key: LabelKey;
  vars?: Record<string, string | number>;
}
