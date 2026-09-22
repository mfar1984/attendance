/**
 * Types mirroring the payloads this firmware actually returns.
 *
 * Every shape here was verified against a DS-K1T342MFX-E1 on V4.38.0 rather
 * than transcribed from the ISAPI reference, because the documentation and the
 * firmware disagree in a few places that matter. Those disagreements are called
 * out inline.
 */

/** Hard limits read from the device's own `/capabilities` endpoints. */
export const DEVICE_LIMITS = {
  /** `AcsEventCond.maxResults` and `UserInfoSearchCond.maxResults` both cap here. */
  searchPageSize: 30,
  /** `UserInfoBatchPutCond.maxUserNum` */
  userBatchSize: 16,
  /** `FDRecordDataMaxNum` on this model. Higher-tier models differ. */
  faceLibraryCapacity: 1500,
  /** `UserInfo.maxRecordNum` */
  personCapacity: 1500,
  employeeNoMaxLength: 32,
  nameMaxLength: 128,
  /** Door PIN, stored in cleartext on the device. */
  passwordLength: { min: 4, max: 8 },
  /** Digest password the device uses when posting to our ingest endpoint. */
  ingestPasswordLength: { min: 8, max: 16 },
  /** `HttpHostNotificationCap.hostNumber` - only two notification slots exist. */
  notificationHostSlots: 2,
  faceImage: { maxBytes: 200 * 1024, minPixels: 80 },
  /**
   * `AcsEventCond.beginSerialNo/@max`. Note this exceeds signed INT32
   * (2,147,483,647), so persisting a serial number in a signed INT column
   * overflows. Use BIGINT.
   */
  maxSerialNo: 3_000_000_000,
} as const;

/** Major event categories. Attendance only ever cares about `event`. */
export const EventMajor = {
  alarm: 1,
  exception: 2,
  operation: 3,
  event: 5,
} as const;

/** Minor codes under major 5 that represent a person authenticating. */
export const AuthMinor = {
  cardSuccess: 38,
  faceSuccess: 75,
  faceFailure: 76,
  fingerprintSuccess: 113,
  exitButton: 27,
} as const;

/**
 * Minor codes under major 5 that indicate a successful identification.
 *
 * Anything outside this set is a door or hardware event and must not become an
 * attendance punch, even though it shares major 5. Observed example: minor 22
 * arrives with a `doorNo` but no person fields at all.
 */
export const IDENTIFIED_MINORS: readonly number[] = [
  AuthMinor.cardSuccess,
  AuthMinor.faceSuccess,
  AuthMinor.fingerprintSuccess,
];

export interface DeviceInfo {
  deviceName: string;
  model: string;
  serialNumber: string;
  macAddress: string;
  firmwareVersion: string;
  firmwareReleasedDate: string | null;
  deviceType: string | null;
  subDeviceType: string | null;
}

export interface DeviceTime {
  /** `manual` means NTP is not driving the clock, so drift is unbounded. */
  timeMode: 'manual' | 'NTP' | string;
  /** ISO-8601 with offset, e.g. `2026-08-28T17:56:55+08:00`. */
  localTime: string;
  /**
   * POSIX-style and inverted from what most people expect: `CST-8:00:00`
   * denotes UTC+8, not UTC-8.
   */
  timeZone: string;
}

export interface NtpServer {
  id: string;
  addressingFormatType: 'ipaddress' | 'hostname' | string;
  ipAddress?: string;
  hostName?: string;
  portNo: number;
  /** Minutes between synchronisations. */
  synchronizeInterval: number;
}

export interface PersonValidity {
  enable: boolean;
  /** Local time without offset, e.g. `2026-01-28T00:00:00`. */
  beginTime: string;
  endTime: string;
  timeType?: 'local';
}

export interface PersonRightPlan {
  doorNo: number;
  planTemplateNo: string;
}

export interface Person {
  employeeNo: string;
  name: string;
  userType: 'normal' | 'visitor' | 'blackList' | string;
  Valid: PersonValidity;
  doorRight?: string;
  RightPlan?: PersonRightPlan[];
  gender?: 'male' | 'female' | 'unknown';
  localUIRight?: boolean;
  /** Door PIN. The device returns this in cleartext on search. */
  password?: string;
  /** Credential counts, present on search responses only. */
  numOfCard?: number;
  numOfFP?: number;
  numOfFace?: number;
  /** Enrolled face image, requires Digest auth to fetch. */
  faceURL?: string;
}

export interface PersonSearchPage {
  searchID: string;
  responseStatusStrg: 'OK' | 'MORE' | 'NO MATCHES' | 'NO_MATCHES' | string;
  numOfMatches: number;
  totalMatches: number;
  persons: Person[];
}

export interface FaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AcsEvent {
  major: number;
  minor: number;
  /** ISO-8601 with the device's offset. */
  time: string;
  /** Monotonic per-device counter. The only reliable sync cursor. */
  serialNo: number;
  doorNo?: number;
  cardReaderNo?: number;
  /**
   * Present as `employeeNoString` on the wire. The capability document calls it
   * `employeeNo`; reading that key yields undefined and silently drops the
   * person association.
   */
  employeeNo?: string;
  name?: string;
  /**
   * Meaningless on face authentication, where the firmware emits a 64-bit
   * overflow sentinel such as `18446744073609551873`. Kept as a string because
   * the value exceeds `Number.MAX_SAFE_INTEGER`.
   */
  cardNo?: string;
  cardType?: number;
  userType?: string;
  currentVerifyMode?: string;
  mask?: 'yes' | 'no' | 'unknown';
  pictureURL?: string;
  FaceRect?: FaceRect;
  remoteHostAddr?: string;
  /** `timeout` whenever remote verification is enabled but unreachable. */
  remoteCheckResult?: string;
  /**
   * Only populated when `AttendanceMode.mode` is not `disable`. With the mode
   * off, this field is absent and IN/OUT has to be derived downstream.
   */
  attendanceStatus?:
    | 'undefined'
    | 'checkIn'
    | 'checkOut'
    | 'breakIn'
    | 'breakOut'
    | 'overtimeIn'
    | 'overtimeOut';
}

export interface AcsEventPage {
  searchID: string;
  responseStatusStrg: 'OK' | 'MORE' | 'NO MATCHES' | 'NO_MATCHES' | string;
  numOfMatches: number;
  totalMatches: number;
  events: AcsEvent[];
}

export interface AcsEventQuery {
  /** Defaults to major 5; pass 0 to search every category. */
  major?: number;
  minor?: number;
  startTime: string;
  endTime: string;
  /** Inclusive lower bound of the serial cursor. */
  beginSerialNo?: number;
  endSerialNo?: number;
  employeeNo?: string;
  includePictures?: boolean;
  newestFirst?: boolean;
}

export interface AttendanceMode {
  mode: 'disable' | 'manual' | 'auto' | 'manualAndAuto';
  /** Seconds the status selection stays active on screen (5-20). */
  attendanceStatusTime: number;
  reqAttendanceStatus: boolean;
}

export interface HttpHostNotification {
  id: string;
  url: string;
  protocolType: 'HTTP' | 'HTTPS' | 'EHome';
  parameterFormatType: 'XML' | 'JSON';
  addressingFormatType: 'ipaddress' | 'hostname';
  ipAddress?: string;
  hostName?: string;
  portNo: number;
  /**
   * Defaults to `none`, which leaves the ingest endpoint open to anyone who can
   * reach it. Set to `MD5digest` so forged punches require credentials.
   */
  httpAuthenticationMethod: 'none' | 'basic' | 'MD5digest';
  userName?: string;
  password?: string;
  /** Seconds between keep-alive posts (1-30). */
  heartbeat?: number;
}

export interface PersonCounts {
  userNumber: number;
  bindFaceUserNumber: number;
  bindFingerprintUserNumber: number;
  bindCardUserNumber: number;
}

export interface FaceLibrary {
  FDID: string;
  faceLibType: 'blackFD' | 'infraredFD' | string;
  name: string;
}

/**
 * Door behaviour on one terminal.
 *
 * Every field is nullable because this firmware family disagrees about which of
 * them exist, and an absent field has to read as "this unit does not report it"
 * rather than as zero — a door open duration displayed as 0 seconds would be
 * changed by somebody trying to fix it.
 *
 * `raw` carries everything the unit answered. It is what makes the read-modify-write
 * in `setDoorParam` possible, and what the diagnostics tab shows.
 */
export interface DoorParam {
  doorNo: number;
  doorName: string | null;
  /** Seconds the lock stays released after a successful authentication. */
  openDuration: number | null;
  /** Seconds allowed for someone flagged as needing longer. */
  disabledOpenDuration: number | null;
  /**
   * Seconds a door may stand open before the terminal raises an alarm.
   *
   * `magneticAlarmTimeout` on this firmware, not `doorOpenTimeout` — the latter is what
   * the ISAPI reference calls it and it is absent here.
   */
  magneticAlarmTimeout: number | null;
  /** Resting state of the magnet sensor: `alwaysClose` or `alwaysOpen`. */
  magneticType: string | null;
  /** Resting state of the exit button, same vocabulary as the magnet. */
  openButtonType: string | null;
  doorNotClosedAlarmEnabled: boolean | null;
  raw: Record<string, unknown>;
}

/**
 * Reader configuration, which is where the authentication requirement lives.
 *
 * `verifyMode` is the setting behind "the door must require a scan": it decides
 * whether a face alone opens the door, or a face and a PIN, or a card. The valid
 * value set is firmware-specific, so the option list is read from the capability
 * document rather than written into this repository — a hardcoded list would offer
 * choices the unit rejects, and hide ones it accepts.
 */
export interface CardReaderConfig {
  readerNo: number;
  enabled: boolean | null;
  /**
   * `defaultVerifyMode`, e.g. `faceOrFpOrCardOrPw`.
   *
   * Named "default" by the firmware because a person's own verify mode overrides it, so
   * this is the fallback rather than an enforced terminal-wide rule. The capability
   * document does **not** enumerate the accepted values, so a control offering a list is
   * offering a guess and a rejected write is a real outcome.
   */
  defaultVerifyMode: string | null;
  /** Credential modules the reader has switched on: `face`, `fingerPrint`, `card`. */
  functions: string[];
  /** 1:N face match threshold, 0-100. Higher rejects more borderline faces. */
  faceMatchThresholdN: number | null;
  /** Anti-spoofing. False means a photograph is not being screened out. */
  livingBodyDetect: boolean | null;
  /** `general`, `enhancive` or `professional`. */
  liveDetLevel: string | null;
  /** Not a 1-5 scale: this firmware accepts 3, 5, 6, 12 and 13. */
  fingerprintLevel: number | null;
  raw: Record<string, unknown>;
}

/**
 * The values a terminal reports for one enumerated field.
 *
 * Read from a `/capabilities` document, where ISAPI encodes an enum as an `opt`
 * attribute holding a comma-separated list.
 */
export interface TerminalOptions {
  field: string;
  values: string[];
}
