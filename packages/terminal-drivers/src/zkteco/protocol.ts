import { createHash } from 'node:crypto';

import { DeviceProtocol, PunchDirection, RawEventKind, VerifyMethod } from '@attendance/shared';

import type { TerminalEvent } from '../events.js';

/**
 * ZKTeco TA Push (ADMS) wire format.
 *
 * ## Confidence, stated up front
 *
 * The endpoint paths and the `ATTLOG` column order below were assembled from third-party
 * transcriptions of ZKTeco's push documentation and from open-source ADMS implementations, not
 * from a ZKTeco specification. They have **not** been verified against a SenseFace 3A.
 *
 * That is why every field is read by position with a fallback and nothing throws on an
 * unexpected column count: the realistic failure during bring-up is a shifted or extra column,
 * and a decoder that rejects the whole row would present as a terminal that connects and
 * reports nothing. Instead the row is stored with whatever could be read, and the raw line is
 * kept in `payload` so the actual format can be read off the log rather than guessed at again.
 *
 * Isolated in this file so correcting it is one edit with no reach into the rest of the system.
 */

/** Base path the terminal posts to. Its own paths hang off this. */
export const ICLOCK_PATH = '/iclock';

/**
 * Tab-separated `ATTLOG` columns, in the order the terminal sends them.
 *
 * `status` and `verify` are the two that matter and the two most likely to be wrong: different
 * firmware families have been reported using column 3 for either the attendance state or the
 * verification method.
 */
const ATTLOG_COLUMN = {
  pin: 0,
  time: 1,
  status: 2,
  verify: 3,
  workcode: 4,
} as const;

/**
 * Verification methods as TA Push numbers them.
 *
 * Face is the value this installation cares about and also the least certain: reported as 15 on
 * the platforms this was drawn from. A number that is not listed resolves to `unknown` rather
 * than being guessed at — an event labelled as the wrong credential is worse than one labelled
 * as an unknown credential, because only the second is visibly incomplete.
 */
const VERIFY_METHODS: Readonly<Record<number, VerifyMethod>> = {
  0: VerifyMethod.password,
  1: VerifyMethod.fingerprint,
  2: VerifyMethod.card,
  3: VerifyMethod.password,
  4: VerifyMethod.card,
  15: VerifyMethod.face,
};

/**
 * Attendance state, when the terminal is configured to report one.
 *
 * Left unmapped beyond check-in and check-out. The overtime and break states exist in the
 * protocol, but this application derives direction from scan order and the roster, so importing
 * a richer vocabulary here would create values nothing downstream reads.
 */
const ATTENDANCE_STATES: Readonly<Record<number, PunchDirection>> = {
  0: PunchDirection.in,
  1: PunchDirection.out,
  2: PunchDirection.breakOut,
  3: PunchDirection.breakIn,
};

/**
 * Dedup key for a TA Push event.
 *
 * `ATTLOG` carries no monotonic counter of any kind, so there is nothing to use as a sequence.
 * The key is a digest of the terminal serial plus the complete raw row — which makes a
 * re-delivered record produce the same key and collapse into the row already stored.
 *
 * Hashing the **whole line** rather than selected fields is deliberate. Two scans by the same
 * person in the same second with the same method are genuinely indistinguishable in this
 * protocol, and a key built from chosen fields would silently merge them. Including every
 * column means a row that differs in any respect is kept, and the suppression window in the
 * ingest store is what collapses true duplicates — which it does visibly, as a flagged punch.
 */
export function taPushEventKey(serialNumber: string, rawLine: string): string {
  const digest = createHash('sha256').update(`${serialNumber}\u0000${rawLine}`).digest('hex');
  // Truncated to fit the 96-character column alongside the protocol prefix. 128 bits of a
  // SHA-256 is far past any collision risk for one device's transaction log.
  return `${DeviceProtocol.taPush}:${digest.slice(0, 48)}`;
}

/**
 * Decodes one `ATTLOG` line.
 *
 * Returns null only when the row has no identifier or no readable timestamp, because neither
 * can be recovered later — everything else degrades to a null field on a stored row.
 */
export function decodeAttlogLine(
  serialNumber: string,
  rawLine: string,
  timeZoneOffsetMinutes: number,
): TerminalEvent | null {
  const line = rawLine.replace(/\r$/, '');
  if (line.trim() === '') return null;

  const columns = line.split('\t');
  const pin = (columns[ATTLOG_COLUMN.pin] ?? '').trim();
  const rawTime = (columns[ATTLOG_COLUMN.time] ?? '').trim();
  if (pin === '' || rawTime === '') return null;

  const at = parseLocalTimestamp(rawTime, timeZoneOffsetMinutes);
  if (at === null) return null;

  const status = toInt(columns[ATTLOG_COLUMN.status]);
  const verify = toInt(columns[ATTLOG_COLUMN.verify]);
  const verifyMethod = verify === null ? null : (VERIFY_METHODS[verify] ?? VerifyMethod.unknown);

  return {
    eventKey: taPushEventKey(serialNumber, line),
    /**
     * Always an identification.
     *
     * `ATTLOG` is the attendance transaction log: the terminal writes a row only once it has
     * matched somebody. A failed match does not appear here at all, which is why there is no
     * `unrecognised` case — and also why an unrecognised face on a ZKTeco unit produces no
     * exception, unlike Hikvision. Worth knowing before somebody reports it as a bug.
     */
    kind: RawEventKind.identified,
    verifyMethod,
    at,
    employeeNo: pin,
    /**
     * Null, because `ATTLOG` carries no name.
     *
     * The review queue therefore has no clue to offer beyond the PIN when an unmapped
     * identifier turns up. Importing the roster through `people.query` is what fills that in.
     */
    personName: null,
    sequence: null,
    direction: status === null ? null : (ATTENDANCE_STATES[status] ?? null),
    cardNo: null,
    doorNo: null,
    readerNo: null,
    pictureUrl: null,
    native: {
      major: null,
      minor: null,
      verifyMode: verify === null ? null : String(verify),
      maskWorn: null,
      direction: status === null ? null : String(status),
    },
    /**
     * The raw line, not a parsed object.
     *
     * This is what makes a column-order mistake recoverable: the events are already stored, so
     * a corrected decoder can be run over `payload` rather than needing the scans to happen
     * again.
     */
    payload: { raw: line, columns },
  };
}

/**
 * Parses the terminal's timestamp, which carries no zone.
 *
 * `ATTLOG` reports local wall-clock time as `YYYY-MM-DD HH:mm:ss` with nothing to say which
 * zone that is. So the offset has to come from configuration, and getting it wrong shifts every
 * punch by whole hours — which reads as staff arriving at dawn rather than as a settings
 * mistake.
 *
 * Built from parts rather than handed to `new Date()`, because that constructor would interpret
 * the string in the *server's* zone. A server in UTC and a terminal in Malaysia would then
 * disagree by eight hours, and the attendance engine works entirely in instants.
 */
export function parseLocalTimestamp(value: string, offsetMinutes: number): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;

  const [year, month, day, hour, minute] = [1, 2, 3, 4, 5].map((index) => Number(match[index]));
  const second = match[6] === undefined ? 0 : Number(match[6]);
  if ([year, month, day, hour, minute].some((part) => !Number.isFinite(part))) return null;

  const utcMillis = Date.UTC(year!, month! - 1, day!, hour!, minute!, second);
  const instant = new Date(utcMillis - offsetMinutes * 60_000);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** Formats an instant back into the terminal's own wall-clock notation. */
export function formatLocalTimestamp(at: Date, offsetMinutes: number): string {
  const shifted = new Date(at.getTime() + offsetMinutes * 60_000);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${String(shifted.getUTCFullYear())}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ` +
    `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
  );
}

/**
 * Builds the `DATA UPDATE USERINFO` body for a person.
 *
 * Field order follows the transcriptions this was drawn from. `Pri=0` is an ordinary user;
 * anything higher grants menu access on the unit itself, which is not something a roster push
 * should ever hand out.
 */
export function userInfoCommand(person: {
  employeeNo: string;
  name: string;
  pin?: string | undefined;
  validFrom?: Date | undefined;
  validTo?: Date | undefined;
  offsetMinutes: number;
}): string {
  const fields = [
    `PIN=${person.employeeNo}`,
    `Name=${sanitise(person.name)}`,
    'Pri=0',
    `Passwd=${person.pin ?? ''}`,
    'Card=',
    'Grp=1',
    'TZ=0000000000000000',
  ];

  /**
   * A validity window only when one is set.
   *
   * Sending an empty range has been reported as disabling the user outright on some firmware,
   * which would silently stop somebody from scanning — so an absent window means absent fields
   * rather than blank ones.
   */
  if (person.validFrom || person.validTo) {
    const from = person.validFrom ?? new Date();
    fields.push(`StartDatetime=${formatLocalTimestamp(from, person.offsetMinutes)}`);
    if (person.validTo) {
      fields.push(`EndDatetime=${formatLocalTimestamp(person.validTo, person.offsetMinutes)}`);
    }
  }

  return `DATA UPDATE USERINFO ${fields.join('\t')}`;
}

export function deleteUserCommand(employeeNo: string): string {
  return `DATA DELETE USERINFO PIN=${employeeNo}`;
}

/**
 * Builds the face upload command.
 *
 * `Type=9` is the visible-light face template on the platforms this was drawn from, which is
 * what a SenseFace 3A uses — it authenticates with ZKFace visible light rather than the older
 * infrared model, and those are different template types. Getting this wrong uploads a
 * photograph into a store the unit never matches against, so the enrolment reports success and
 * the person cannot scan.
 *
 * Reported as requiring firmware V1.5 or newer. On an older unit the command is expected to be
 * rejected, and the driver declares the operation unavailable rather than queueing work that
 * will never apply.
 */
export function faceCommand(employeeNo: string, jpeg: Buffer): string {
  return [
    'DATA UPDATE BIOPHOTO',
    `PIN=${employeeNo}`,
    'Type=9',
    'Size=' + String(jpeg.length),
    'Content=' + jpeg.toString('base64'),
  ].join('\t');
}

export function deleteFaceCommand(employeeNo: string): string {
  return `DATA DELETE BIOPHOTO PIN=${employeeNo}`;
}

export const REBOOT_COMMAND = 'REBOOT';
export const QUERY_USERINFO_COMMAND = 'DATA QUERY USERINFO';

/**
 * Strips tabs and newlines from a value going into a tab-separated command.
 *
 * A name containing a tab would shift every field after it, and the terminal would store the
 * remainder of the name as somebody's password. Names come from an import file, so this is
 * reachable without anybody doing anything unusual.
 */
function sanitise(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ').trim();
}

function toInt(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}
