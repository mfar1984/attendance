/**
 * Terminal drivers: the contract, and one adapter per protocol.
 *
 * Extracted from `apps/server` so the connector agent can run the same code. It had to be
 * shared rather than reimplemented: `biometrics.enrolFace` validates the JPEG the firmware will
 * accept, the ISAPI transport holds a lockout gate that stops a loop over five thousand staff
 * from locking an operator out of their own door, and an event key is the dedup identity the
 * cloud stores. A second implementation of any of those drifts, and the one that drifts is
 * whichever is talking to the terminals.
 *
 * ## What is deliberately NOT here
 *
 * The durable command queue (`DeviceCommand`) and the driver registry stay in the server,
 * because both need a database. The agent does not have one: it receives its terminals as a
 * roster and constructs drivers directly.
 *
 * `ZktecoTaPushDriver` also stays, for now, for the same reason — every write it performs is a
 * queue insert. Moving it means injecting the queue, and that is worth doing when a SenseFace
 * behind an agent is something we can test against hardware rather than infer from
 * transcriptions.
 */

/**
 * `driverLogger` is exported alongside the setter so the wiring can be asserted.
 *
 * Without a way to read it back, a host that forgot to inject a logger loses two diagnostics
 * and nothing fails — which is the failure mode worth a test rather than the one worth trusting.
 */
export { driverLogger, setDriverLogger, type DriverLogger } from './logging.js';

export {
  APPLIED,
  DriverOperation,
  queued,
  supports,
  unavailableReason,
  type DriverCapabilities,
  type PullCursor,
  type PullResult,
  type Reachability,
  type TerminalDriver,
  type TerminalEvent,
  type WriteAck,
  type WriteModel,
} from './contract.js';

export type * from './types.js';

export { HikvisionDriver } from './hikvision/driver.js';
export { hikvisionEventKey, toTerminalEvent } from './hikvision/events.js';

/**
 * Push body decoding, shared for the same reason the digest check is: both the cloud and the
 * connector receive these bodies, and a second decoder is a second reading of the same firmware
 * payload — with no way to tell which one is wrong until a site reports nothing.
 */
export {
  asNumber,
  asRecord,
  asString,
  decodePush,
  toAcsEvent,
  type DecodedPush,
} from './hikvision/push.js';

/**
 * Digest authentication for the terminal push endpoint.
 *
 * Here rather than in the server because both the cloud and the connector run this endpoint: a
 * direct installation listens for pushes itself, and an agent listens on the LAN. The nonce
 * counter is what makes a captured Authorization header unusable a second time, and two
 * implementations of a replay check is one implementation of a replay check.
 */
export {
  digestChallenge,
  verifyDigest,
  type DigestVerdict,
} from './ingest-digest.js';

export {
  deleteFaceCommand,
  deleteUserCommand,
  decodeAttlogLine,
  faceCommand,
  formatLocalTimestamp,
  ICLOCK_PATH,
  parseLocalTimestamp,
  QUERY_USERINFO_COMMAND,
  REBOOT_COMMAND,
  taPushEventKey,
  userInfoCommand,
} from './zkteco/protocol.js';
