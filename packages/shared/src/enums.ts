/**
 * Domain vocabulary shared across the server, the connector and the UI.
 *
 * Values are stored in the database, so treat them as a wire format: rename
 * freely in the UI layer, never here.
 */

/**
 * Where an attendance punch came from.
 *
 * This is recorded on every punch rather than inferred, because the two sources
 * carry different weight as evidence. A terminal scan establishes that a person
 * was physically at a specific door. A mobile check-in establishes only that
 * someone held a valid token on a bound device. Collapsing them would make every
 * record as weak as the weakest source.
 */
export const PunchSource = {
  terminal: 'terminal',
  app: 'app',
  manual: 'manual',
} as const;
export type PunchSource = (typeof PunchSource)[keyof typeof PunchSource];

/** Credential the terminal used to identify the person. */
export const VerifyMethod = {
  face: 'face',
  fingerprint: 'fingerprint',
  card: 'card',
  password: 'password',
  unknown: 'unknown',
} as const;
export type VerifyMethod = (typeof VerifyMethod)[keyof typeof VerifyMethod];

/**
 * Direction of a punch.
 *
 * `unknown` is the honest default: with the terminal's attendance mode disabled
 * the hardware reports no direction, so it has to be derived from scan order and
 * the roster. Storing `unknown` keeps the derivation reversible.
 */
export const PunchDirection = {
  in: 'in',
  out: 'out',
  breakOut: 'break_out',
  breakIn: 'break_in',
  unknown: 'unknown',
} as const;
export type PunchDirection = (typeof PunchDirection)[keyof typeof PunchDirection];

export const AttendanceStatus = {
  onTime: 'on_time',
  late: 'late',
  earlyLeave: 'early_leave',
  absent: 'absent',
  incomplete: 'incomplete',
  onLeave: 'on_leave',
  restDay: 'rest_day',
  holiday: 'holiday',
} as const;
export type AttendanceStatus = (typeof AttendanceStatus)[keyof typeof AttendanceStatus];

/**
 * Conditions the engine cannot resolve on its own and that a human must review.
 *
 * These drive the Pengecualian screen. Each one corresponds to a situation
 * observed or provable on the hardware rather than a hypothetical.
 */
export const ExceptionKind = {
  /** Scanned in, never scanned out. */
  missingCheckOut: 'missing_check_out',
  missingCheckIn: 'missing_check_in',
  /** Repeated scans inside the dedup window; kept for transparency. */
  duplicateScan: 'duplicate_scan',
  /** Terminal reported minor 76: a face it could not match to anybody. */
  unrecognisedFace: 'unrecognised_face',
  /** Punch arrived for an employeeNo with no matching staff record. */
  unknownEmployee: 'unknown_employee',
  /** Punch fell outside every rostered window for that day. */
  outsideRoster: 'outside_roster',
  /** Terminal clock drift exceeded the threshold when the punch was taken. */
  clockDrift: 'clock_drift',
  /** App check-in whose reported position fell outside the geofence. */
  outsideGeofence: 'outside_geofence',
} as const;
export type ExceptionKind = (typeof ExceptionKind)[keyof typeof ExceptionKind];

/** How the system reaches the terminals. Chosen at install, not per request. */
export const ConnectorMode = {
  /** Server shares a LAN with the terminals and talks to them directly. */
  direct: 'direct',
  /** Server is remote; an on-site connector dials out to it. */
  agent: 'agent',
} as const;
export type ConnectorMode = (typeof ConnectorMode)[keyof typeof ConnectorMode];

/**
 * Manufacturer of a physical terminal.
 *
 * Stored per device, not per installation: one site routinely mixes an existing
 * Hikvision door with a newly fitted ZKTeco unit, and both must work at the same
 * time. Every loop over devices therefore has to tolerate a mixed list.
 */
export const DeviceVendor = {
  hikvision: 'hikvision',
  zkteco: 'zkteco',
  dahua: 'dahua',
} as const;
export type DeviceVendor = (typeof DeviceVendor)[keyof typeof DeviceVendor];

/**
 * Transport a driver speaks to one terminal with.
 *
 * Kept separate from the vendor because one manufacturer ships several, and they
 * are not interchangeable: ZKTeco alone has TA Push, AC Push, BEST and the legacy
 * binary protocol on port 4370, and a SenseFace 3A supports a different subset
 * than an older ZEM-platform unit.
 */
export const DeviceProtocol = {
  /** Hikvision ISAPI over HTTP(S). Request/response — the server calls the unit. */
  isapi: 'isapi',
  /**
   * ZKTeco TA Push (ADMS). Callback — the unit calls the server and polls for
   * work, so outbound operations are queued rather than answered inline.
   */
  taPush: 'ta-push',
  /** Dahua CGI over HTTP(S). Request/response, same shape as ISAPI. */
  dahuaCgi: 'dahua-cgi',
} as const;
export type DeviceProtocol = (typeof DeviceProtocol)[keyof typeof DeviceProtocol];

/**
 * Which protocols require the server to reach into the terminal.
 *
 * This is the distinction that decides whether a remote site needs a VPN. A
 * request/response protocol needs inbound access to the unit for every management
 * operation — including, on Hikvision, the call that configures push in the first
 * place. A callback protocol needs none: the unit dials out for both events and
 * commands.
 */
export const REQUEST_RESPONSE_PROTOCOLS: readonly DeviceProtocol[] = [
  DeviceProtocol.isapi,
  DeviceProtocol.dahuaCgi,
];

export function isCallbackProtocol(protocol: string): boolean {
  return !REQUEST_RESPONSE_PROTOCOLS.includes(protocol as DeviceProtocol);
}

/**
 * Which protocols each manufacturer can be spoken to with.
 *
 * Declared once and shared, because the server validates the pair and the web builds the
 * selector from it. Two copies would drift, and the drifting one would be whichever screen
 * offers a combination the server then refuses.
 *
 * One entry each today. The structure is a list rather than a single value because ZKTeco in
 * particular has several — AC Push, BEST and a legacy binary protocol on port 4370 — and a
 * site with older units will need a second entry rather than a second vendor.
 */
export const VENDOR_PROTOCOLS: Readonly<Record<DeviceVendor, readonly DeviceProtocol[]>> = {
  [DeviceVendor.hikvision]: [DeviceProtocol.isapi],
  [DeviceVendor.zkteco]: [DeviceProtocol.taPush],
  [DeviceVendor.dahua]: [DeviceProtocol.dahuaCgi],
};

/**
 * The protocol to assume when somebody picks a vendor and nothing else.
 *
 * Indexed rather than destructured because `noUncheckedIndexedAccess` widens a destructured
 * element to include `undefined`, and every list above is non-empty by construction.
 */
export function defaultProtocolFor(vendor: DeviceVendor): DeviceProtocol {
  return VENDOR_PROTOCOLS[vendor][0] as DeviceProtocol;
}

export function isProtocolFor(vendor: DeviceVendor, protocol: string): boolean {
  return VENDOR_PROTOCOLS[vendor].includes(protocol as DeviceProtocol);
}

/**
 * Whether a protocol authenticates with a stored username and password.
 *
 * The distinction matters at the point a terminal is added: a request/response protocol
 * cannot work without credentials, while a callback protocol has none to give — TA Push
 * identifies a unit by its serial number. Demanding a password for the second would mean
 * inventing one, and the screen would then claim a credential protects something it does not.
 */
export function usesStoredCredentials(protocol: string): boolean {
  return REQUEST_RESPONSE_PROTOCOLS.includes(protocol as DeviceProtocol);
}

/**
 * What a raw terminal event means, decided by the driver that decoded it.
 *
 * Derivation reads this instead of vendor event codes. Hikvision reports face
 * success as major 5 / minor 75 and ZKTeco TA Push reports an ATTLOG row with a
 * verify type and no major at all; both resolve to `identified` here, and nothing
 * downstream needs to know either number.
 */
export const RawEventKind = {
  /** A credential matched a person the terminal knows. Becomes a punch. */
  identified: 'identified',
  /**
   * The terminal saw somebody and could not match them. Not noise: it may be a
   * new joiner who was never enrolled, or somebody who should not be there.
   */
  unrecognised: 'unrecognised',
  /** Door, tamper, hardware and operator events. Kept as evidence, never a punch. */
  other: 'other',
} as const;
export type RawEventKind = (typeof RawEventKind)[keyof typeof RawEventKind];

export const DeviceStatus = {
  online: 'online',
  offline: 'offline',
  /** Reachable but reporting a condition that invalidates its data. */
  degraded: 'degraded',
  unknown: 'unknown',
} as const;
export type DeviceStatus = (typeof DeviceStatus)[keyof typeof DeviceStatus];

/** Distinguishes a login that administers the system from a staff app login. */
export const AccountType = {
  admin: 'admin',
  staff: 'staff',
} as const;
export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export const AccountStatus = {
  active: 'active',
  /** Provisioned in bulk, not yet claimed by the staff member. */
  pending: 'pending',
  suspended: 'suspended',
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

/**
 * Actions recorded in the audit trail.
 *
 * Reads are deliberately absent: the audit trail answers "what changed", and
 * mixing in reads buries the changes. Reads belong in the activity log.
 */
export const AuditAction = {
  create: 'create',
  update: 'update',
  delete: 'delete',
  approve: 'approve',
  recalculate: 'recalculate',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];
