export { HikvisionClient, type HikvisionClientOptions } from './client.js';
export { IsapiCore, newSearchId, type MultipartPart } from './core.js';
export { DigestHttpClient, type DigestHttpOptions, type RawResponse } from './digest.js';

export {
  AuthChallengeMissingError,
  AuthenticationError,
  DeviceLockedError,
  DeviceUnreachableError,
  IsapiError,
  IsapiStatusError,
  ResponseParseError,
} from './errors.js';

export {
  assertOk,
  decodeBody,
  isAlreadyExists,
  isNotSupported,
  isUnavailable,
  readStatus,
} from './parse.js';

export { AccessModule, CAPABILITY_DOCUMENTS } from './modules/access.js';
export { SystemModule, type ClockDrift } from './modules/system.js';
export { PersonsModule, type PersonDraft, type PersonFilter } from './modules/persons.js';
export {
  EventsModule,
  isIdentifiedPunch,
  isSyntheticCardNo,
  normalisePictureUrl,
} from './modules/events.js';
export { FacesModule, assertUsableJpeg, readJpegDimensions } from './modules/faces.js';
export { NotificationModule, type IngestTarget } from './modules/notification.js';

export {
  AuthMinor,
  DEVICE_LIMITS,
  EventMajor,
  IDENTIFIED_MINORS,
  type AcsEvent,
  type AcsEventPage,
  type AcsEventQuery,
  type AttendanceMode,
  type CardReaderConfig,
  type DeviceInfo,
  type DeviceTime,
  type DoorParam,
  type FaceLibrary,
  type FaceRect,
  type HttpHostNotification,
  type NtpServer,
  type Person,
  type PersonCounts,
  type PersonRightPlan,
  type PersonSearchPage,
  type PersonValidity,
  type TerminalOptions,
} from './types.js';
