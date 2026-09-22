/**
 * Constraints imposed by the terminal hardware.
 *
 * These live in the shared package rather than in the device client because the
 * web client needs them to validate forms before submission. Duplicating them
 * in the UI is how a form ends up accepting a value the terminal will reject.
 *
 * Every number was read from a DS-K1T342MFX-E1 on firmware V4.38.0 via its own
 * `/capabilities` endpoints.
 */
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
  /** Door PIN. The terminal stores and returns this in cleartext. */
  passwordLength: { min: 4, max: 8 },
  /** Digest password the terminal uses when posting to our ingest endpoint. */
  ingestPasswordLength: { min: 8, max: 16 },
  /** `HttpHostNotificationCap.hostNumber` - only two notification slots exist. */
  notificationHostSlots: 2,
  /** `urlLen/@max` on the notification host config. */
  ingestPathMaxLength: 128,
  faceImage: { maxBytes: 200 * 1024, minPixels: 80 },
  /**
   * `AcsEventCond.beginSerialNo/@max`.
   *
   * This exceeds signed INT32 (2,147,483,647), so a serial number persisted in
   * a signed INT column overflows. Columns holding it must be BIGINT.
   */
  maxSerialNo: 3_000_000_000,
  /** Person validity window the firmware accepts. */
  validityRange: { start: '2000-01-01T00:00:00', end: '2037-12-31T23:59:59' },
} as const;

/**
 * How long two scans by the same person must be apart to count separately.
 *
 * Observed on the test terminal: one person produced serials 352, 353 and 354
 * within eleven seconds. Without a suppression window each of those becomes a
 * punch, and the resulting record is unusable.
 */
export const DEFAULT_DEDUP_WINDOW_SECONDS = 60;

/** Clock error beyond which attendance data should not be trusted. */
export const DEFAULT_CLOCK_DRIFT_WARN_SECONDS = 30;
