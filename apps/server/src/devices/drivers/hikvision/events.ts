import {
  AuthMinor,
  EventMajor,
  IDENTIFIED_MINORS,
  isSyntheticCardNo,
  type AcsEvent,
} from '@attendance/hik-isapi';
import {
  DeviceProtocol,
  PunchDirection,
  RawEventKind,
  VerifyMethod,
  type DeviceProtocol as DeviceProtocolType,
} from '@attendance/shared';

import type { TerminalEvent } from '../../driver/events.js';

/**
 * Turns a Hikvision ACS event into the neutral shape.
 *
 * This file is the only place in the application that knows major 5 means an event,
 * minor 75 a matched face, minor 76 a face it could not match, and that 38 and 113
 * are a card and a fingerprint. Those numbers used to be spread across four files,
 * including as bare literals in `identity/resolve.ts` with no constant name to grep
 * for — which is exactly the copy that gets missed when a second vendor arrives.
 *
 * Pure and synchronous on purpose: it takes no database and performs no I/O, so the
 * mapping can be reasoned about and tested without a terminal.
 */
export function toTerminalEvent(event: AcsEvent): TerminalEvent | null {
  const at = new Date(event.time);
  // A timestamp we cannot parse is not an event we can file against a day, and the
  // attendance engine works entirely in instants. Rejected here rather than stored
  // with a fabricated time.
  if (Number.isNaN(at.getTime())) return null;

  return {
    eventKey: hikvisionEventKey(event.serialNo),
    kind: kindFor(event),
    verifyMethod: verifyMethodFor(event),
    at,
    employeeNo: event.employeeNo ?? null,
    personName: event.name ?? null,
    sequence: event.serialNo,
    direction: directionFor(event.attendanceStatus),
    // The firmware writes a 64-bit sentinel into `cardNo` on face authentication.
    cardNo: isSyntheticCardNo(event.cardNo) ? null : (event.cardNo ?? null),
    doorNo: event.doorNo ?? null,
    readerNo: event.cardReaderNo ?? null,
    pictureUrl: event.pictureURL ?? null,
    native: {
      major: event.major,
      minor: event.minor,
      verifyMode: event.currentVerifyMode ?? null,
      maskWorn: event.mask ?? null,
      direction: event.attendanceStatus ?? null,
    },
    payload: event,
  };
}

/**
 * Dedup key for a Hikvision event.
 *
 * Exported because the backfill that populated the existing 893 rows used this exact
 * form, and the reconcile pull must produce byte-identical keys or every historical
 * event would be stored a second time under a new key. A second copy of the format
 * string somewhere else is how that silently stops being true.
 */
export function hikvisionEventKey(serialNo: number): string {
  return `${DeviceProtocol.isapi satisfies DeviceProtocolType}:${String(serialNo)}`;
}

/**
 * What the event means.
 *
 * Major 5 alone is not enough to treat something as attendance: it also carries door,
 * tamper and hardware events, which arrive with a door number and no person at all.
 * An observed minor 22 is a door event on this firmware, and minor 27 is the exit
 * button — neither is somebody clocking in.
 */
function kindFor(event: AcsEvent): RawEventKind {
  if (event.major !== EventMajor.event) return RawEventKind.other;
  if (event.minor === AuthMinor.faceFailure) return RawEventKind.unrecognised;
  if (!IDENTIFIED_MINORS.includes(event.minor)) return RawEventKind.other;
  // An identified minor with no person is not an identification. The firmware has
  // been seen to report one, and treating it as a punch would credit attendance to
  // nobody and then fail the mapping lookup with a confusing message.
  if (!event.employeeNo) return RawEventKind.other;
  return RawEventKind.identified;
}

function verifyMethodFor(event: AcsEvent): VerifyMethod | null {
  if (event.major !== EventMajor.event) return null;

  switch (event.minor) {
    case AuthMinor.faceSuccess:
    // A failed match is still a face: the credential that was presented is known
    // even though the person is not, and the live monitor says so.
    case AuthMinor.faceFailure:
      return VerifyMethod.face;
    case AuthMinor.fingerprintSuccess:
      return VerifyMethod.fingerprint;
    case AuthMinor.cardSuccess:
      return VerifyMethod.card;
    default:
      return null;
  }
}

/**
 * Direction, only when the terminal's attendance mode is enabled.
 *
 * On this installation it is disabled, so this is null in practice and the engine
 * derives direction itself. Mapped anyway because a site that enables it should not
 * need a code change for the value to start arriving.
 */
function directionFor(status: AcsEvent['attendanceStatus']): PunchDirection | null {
  switch (status) {
    case 'checkIn':
      return PunchDirection.in;
    case 'checkOut':
      return PunchDirection.out;
    case 'breakOut':
      return PunchDirection.breakOut;
    case 'breakIn':
      return PunchDirection.breakIn;
    default:
      return null;
  }
}
