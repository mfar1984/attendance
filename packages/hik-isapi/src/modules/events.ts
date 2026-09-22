import { asArray, asNumber, asString, dig, requireNumber, requireString } from '../coerce.js';
import { newSearchId, type IsapiCore } from '../core.js';
import {
  DEVICE_LIMITS,
  EventMajor,
  IDENTIFIED_MINORS,
  type AcsEvent,
  type AcsEventPage,
  type AcsEventQuery,
} from '../types.js';

const EVENT_PATH = '/ISAPI/AccessControl/AcsEvent?format=json';

/**
 * Widest range the firmware accepts, matching the validity bounds it reports
 * for person records.
 */
const OPEN_RANGE = {
  start: '2000-01-01T00:00:00',
  end: '2037-12-31T23:59:59',
} as const;

/**
 * The 64-bit sentinel this firmware writes into `cardNo` when a person is
 * identified by face rather than by card. It is not a real credential.
 */
const SYNTHETIC_CARD_PREFIX = '1844674407';

export class EventsModule {
  constructor(private readonly core: IsapiCore) {}

  /**
   * Reads one page of access control events.
   *
   * `searchId` must stay identical for every page of a logical search, and
   * `position` must advance by the `numOfMatches` actually returned rather than
   * by the requested page size, otherwise short pages cause skipped records.
   */
  async page(query: AcsEventQuery, searchId: string, position: number): Promise<AcsEventPage> {
    const condition: Record<string, unknown> = {
      searchID: searchId,
      searchResultPosition: position,
      maxResults: DEVICE_LIMITS.searchPageSize,
      major: query.major ?? EventMajor.event,
      minor: query.minor ?? 0,
      // Always sent: several models in this family reject the search with
      // `badParameters` when the time range is omitted, despite the reference
      // describing it as optional.
      startTime: query.startTime,
      endTime: query.endTime,
    };

    if (query.beginSerialNo !== undefined) {
      condition['beginSerialNo'] = query.beginSerialNo;
      // The firmware rejects the search with `badJsonContent` when a lower
      // serial bound arrives without an upper one, so an open-ended cursor is
      // expressed using the maximum the device advertises.
      condition['endSerialNo'] = query.endSerialNo ?? DEVICE_LIMITS.maxSerialNo;
    } else if (query.endSerialNo !== undefined) {
      condition['endSerialNo'] = query.endSerialNo;
    }
    if (query.employeeNo !== undefined) condition['employeeNoString'] = query.employeeNo;
    if (query.includePictures !== undefined) condition['picEnable'] = query.includePictures;
    if (query.newestFirst) condition['timeReverseOrder'] = true;

    const body = await this.core.post(EVENT_PATH, { AcsEventCond: condition });
    const result = dig(body, 'AcsEvent');

    return {
      searchID: asString(dig(result, 'searchID')) ?? searchId,
      responseStatusStrg: asString(dig(result, 'responseStatusStrg')) ?? 'OK',
      numOfMatches: asNumber(dig(result, 'numOfMatches')) ?? 0,
      totalMatches: asNumber(dig(result, 'totalMatches')) ?? 0,
      events: asArray(dig(result, 'InfoList') as unknown[]).map(mapEvent),
    };
  }

  /** Walks every page of a search, yielding events in device order. */
  async *iterate(query: AcsEventQuery): AsyncGenerator<AcsEvent> {
    const searchId = newSearchId('sync');
    let position = 0;

    for (;;) {
      const page = await this.page(query, searchId, position);
      for (const event of page.events) {
        yield event;
      }

      // Guard against a device that keeps reporting MORE without advancing.
      if (page.numOfMatches === 0) return;
      position += page.numOfMatches;

      const status = page.responseStatusStrg.toUpperCase();
      if (status !== 'MORE') return;
      if (position >= DEVICE_LIMITS.maxSerialNo) return;
    }
  }

  /**
   * Incremental pull anchored on the serial cursor.
   *
   * Serial numbers are preferred over timestamps because they survive clock
   * corrections. Re-pointing a terminal at NTP shifts every future timestamp,
   * which would make a time-windowed cursor either skip or replay records.
   */
  async since(lastSerialNo: number, options?: { includePictures?: boolean }): Promise<AcsEvent[]> {
    const collected: AcsEvent[] = [];
    const query: AcsEventQuery = {
      /**
       * Every category, not just access events.
       *
       * Push notifications are configured with `eventMode: all`, so the terminal
       * delivers alarms, exceptions and operations too. Filtering the pull to
       * major 5 would make the two paths deliver different data, and anything
       * outside major 5 that arrived while the listener was down could never be
       * recovered. Attendance still derives punches from major 5 alone.
       */
      major: 0,
      startTime: OPEN_RANGE.start,
      endTime: OPEN_RANGE.end,
      beginSerialNo: lastSerialNo + 1,
      includePictures: options?.includePictures ?? true,
    };

    for await (const event of this.iterate(query)) {
      collected.push(event);
    }
    collected.sort((a, b) => a.serialNo - b.serialNo);
    return collected;
  }

  /** Highest serial number currently on the device, or 0 when the log is empty. */
  async latestSerialNo(): Promise<number> {
    const page = await this.page(
      {
        major: 0,
        startTime: OPEN_RANGE.start,
        endTime: OPEN_RANGE.end,
        newestFirst: true,
        includePictures: false,
      },
      newSearchId('tip'),
      0,
    );
    return page.events.reduce((highest, event) => Math.max(highest, event.serialNo), 0);
  }

  /** Downloads an event snapshot. `pictureURL` requires Digest auth. */
  async picture(pictureUrl: string): Promise<Buffer> {
    return this.core.getBinary(toDevicePath(pictureUrl));
  }
}

/**
 * True when the event identifies a specific person.
 *
 * Major 5 also carries door and hardware events - minor 22 arrives with a
 * `doorNo` and no person fields - so the major alone is not enough to treat an
 * event as an attendance punch.
 */
export function isIdentifiedPunch(event: AcsEvent): boolean {
  return (
    event.major === EventMajor.event &&
    IDENTIFIED_MINORS.includes(event.minor) &&
    event.employeeNo !== undefined
  );
}

/** True when `cardNo` holds the face-authentication sentinel, not a card. */
export function isSyntheticCardNo(cardNo: string | undefined): boolean {
  return cardNo !== undefined && cardNo.length >= 19 && cardNo.startsWith(SYNTHETIC_CARD_PREFIX);
}

/**
 * Strips the `@WEB…` suffix the device appends to snapshot URLs.
 *
 * The suffix is a per-request counter, not part of the resource identity: the
 * same picture is served under a different suffix on every search, and equally
 * well with an old suffix or none at all. Persisting it verbatim would make one
 * image look like many distinct URLs.
 */
export function normalisePictureUrl(pictureUrl: string | undefined): string | undefined {
  if (pictureUrl === undefined) return undefined;
  const suffixIndex = pictureUrl.lastIndexOf('@WEB');
  return suffixIndex === -1 ? pictureUrl : pictureUrl.slice(0, suffixIndex);
}

function mapEvent(raw: unknown): AcsEvent {
  const event: AcsEvent = {
    major: requireNumber(dig(raw, 'major'), 'major'),
    minor: requireNumber(dig(raw, 'minor'), 'minor'),
    time: requireString(dig(raw, 'time'), 'time'),
    serialNo: requireNumber(dig(raw, 'serialNo'), 'serialNo'),
  };

  const assign = <K extends keyof AcsEvent>(key: K, value: AcsEvent[K] | undefined): void => {
    if (value !== undefined) event[key] = value;
  };

  assign('doorNo', asNumber(dig(raw, 'doorNo')));
  assign('cardReaderNo', asNumber(dig(raw, 'cardReaderNo')));
  // The wire format uses `employeeNoString`; `employeeNo` appears only in the
  // capability document. Both are read so a firmware change cannot silently
  // drop the person association.
  assign(
    'employeeNo',
    asString(dig(raw, 'employeeNoString')) ?? asString(dig(raw, 'employeeNo')),
  );
  assign('name', asString(dig(raw, 'name')));
  assign('cardNo', asString(dig(raw, 'cardNo')));
  assign('cardType', asNumber(dig(raw, 'cardType')));
  assign('userType', asString(dig(raw, 'userType')));
  assign('currentVerifyMode', asString(dig(raw, 'currentVerifyMode')));
  assign('mask', asString(dig(raw, 'mask')) as AcsEvent['mask']);
  assign('pictureURL', normalisePictureUrl(asString(dig(raw, 'pictureURL'))));
  assign('remoteHostAddr', asString(dig(raw, 'remoteHostAddr')));
  assign('remoteCheckResult', asString(dig(raw, 'remoteCheckResult')));
  assign('attendanceStatus', asString(dig(raw, 'attendanceStatus')) as AcsEvent['attendanceStatus']);

  const rect = dig(raw, 'FaceRect');
  if (rect !== undefined) {
    const x = asNumber(dig(rect, 'x'));
    const y = asNumber(dig(rect, 'y'));
    const width = asNumber(dig(rect, 'width'));
    const height = asNumber(dig(rect, 'height'));
    if (x !== undefined && y !== undefined && width !== undefined && height !== undefined) {
      event.FaceRect = { x, y, width, height };
    }
  }

  return event;
}

/**
 * Converts a device-reported absolute URL into a request path.
 *
 * Snapshot URLs arrive as `https://<ip>/LOCALS/pic/...jpeg@WEB000000000002`.
 * The `@WEB...` suffix is part of the path and must be preserved.
 */
function toDevicePath(pictureUrl: string): string {
  if (!/^https?:\/\//i.test(pictureUrl)) {
    return pictureUrl.startsWith('/') ? pictureUrl : `/${pictureUrl}`;
  }
  const withoutScheme = pictureUrl.replace(/^https?:\/\//i, '');
  const slashIndex = withoutScheme.indexOf('/');
  return slashIndex === -1 ? '/' : withoutScheme.slice(slashIndex);
}
