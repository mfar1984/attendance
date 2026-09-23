import { normalisePictureUrl, type AcsEvent } from '@attendance/hik-isapi';

/**
 * Decoding a Hikvision push body.
 *
 * Shared between the cloud and the connector because both receive these: a direct installation
 * listens for pushes itself, and an agent listens on the LAN. Two decoders would mean two
 * readings of the same firmware payload, and the one that is wrong is whichever is not being
 * looked at when a firmware update changes a field name.
 *
 * Two things in here were learned the hard way and are the reason this is not a few lines of
 * `JSON.parse`:
 *
 * - The multipart split works on **bytes** throughout. Scanning for the outermost braces in a
 *   string looks simpler and is wrong, because JPEG data regularly contains a `}` byte, so the
 *   slice runs past the end of the JSON. That is exactly how this endpoint started answering 400
 *   to every event the moment snapshots were switched on.
 * - A part's own headers are not trusted on this firmware. Each body is classified by the bytes
 *   it starts with instead: `{` for the JSON, the JPEG start-of-image marker for the picture.
 */

/**
 * Normalises a push payload into the same shape the search API returns.
 *
 * The two differ in ways that are easy to miss: push uses `majorEventType` and
 * `subEventType` where search uses `major` and `minor`, and the timestamp sits at
 * the top level as `dateTime` rather than beside the event as `time`. Mapping
 * here means the ingest store has exactly one shape to reason about.
 */
export function toAcsEvent(
  payload: Record<string, unknown>,
  alert: Record<string, unknown>,
): AcsEvent | null {
  const major = asNumber(alert['majorEventType']) ?? asNumber(alert['major']);
  const minor = asNumber(alert['subEventType']) ?? asNumber(alert['minor']);
  const serialNo = asNumber(alert['serialNo']);
  const time = asString(payload['dateTime']) ?? asString(alert['time']);

  if (major === undefined || minor === undefined || serialNo === undefined || !time) {
    return null;
  }

  const event: AcsEvent = { major, minor, time, serialNo };

  const assign = <K extends keyof AcsEvent>(key: K, value: AcsEvent[K] | undefined): void => {
    if (value !== undefined) event[key] = value;
  };

  assign('employeeNo', asString(alert['employeeNoString']) ?? asString(alert['employeeNo']));
  assign('name', asString(alert['name']));
  assign('cardNo', asString(alert['cardNo']));
  assign('cardType', asNumber(alert['cardType']));
  assign('doorNo', asNumber(alert['doorNo']));
  assign('cardReaderNo', asNumber(alert['cardReaderNo']));
  assign('userType', asString(alert['userType']));
  assign('currentVerifyMode', asString(alert['currentVerifyMode']));
  assign('mask', asString(alert['mask']) as AcsEvent['mask']);
  assign('remoteCheckResult', asString(alert['remoteCheckResult']));
  assign('attendanceStatus', asString(alert['attendanceStatus']) as AcsEvent['attendanceStatus']);
  assign('pictureURL', normalisePictureUrl(asString(alert['pictureURL'])));

  return event;
}

export interface DecodedPush {
  json: Record<string, unknown> | null;
  /** Snapshot bytes when the terminal attached one. */
  image: Buffer | null;
  /** Short, printable excerpt for diagnosing a shape we do not recognise. */
  preview: string;
}

/**
 * Extracts the JSON object, and any snapshot, from a push body.
 *
 * When a picture is attached the body is `multipart/form-data`, so the parts are
 * split on the declared boundary. Scanning the whole buffer for the outermost
 * braces looks simpler but is wrong: JPEG data regularly contains a `}` byte, so
 * the slice runs past the end of the JSON and parsing fails. That is exactly how
 * this endpoint started answering 400 to every event once snapshots were enabled.
 */
export function decodePush(body: unknown, contentType: string): DecodedPush {
  if (body === null || body === undefined) {
    return { json: null, image: null, preview: '(empty body)' };
  }

  if (typeof body === 'object' && !Buffer.isBuffer(body)) {
    return { json: body as Record<string, unknown>, image: null, preview: '(parsed object)' };
  }

  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);

  if (boundary) {
    const marker = `--${boundary[1] ?? boundary[2] ?? ''}`;
    const parts = splitMultipart(buffer, marker);

    let json: Record<string, unknown> | null = null;
    let image: Buffer | null = null;

    for (const part of parts) {
      // A part's own headers are unreliable on this firmware, so the body is
      // classified by what it actually starts with.
      if (json === null && part[0] === 0x7b /* { */) {
        json = tryParseJson(part.toString('utf8'));
        continue;
      }
      if (image === null && part[0] === 0xff && part[1] === 0xd8) {
        image = part;
      }
    }

    return { json, image, preview: preview(buffer) };
  }

  const text = buffer.toString('utf8').trim();
  return { json: tryParseJson(text), image: null, preview: preview(buffer) };
}

/**
 * Splits a multipart body into part bodies, working on bytes throughout.
 *
 * Converting to a string first would corrupt the JPEG payload, since binary data
 * is not valid UTF-8.
 */
function splitMultipart(buffer: Buffer, marker: string): Buffer[] {
  const markerBytes = Buffer.from(marker, 'utf8');
  const separator = Buffer.from('\r\n\r\n', 'utf8');
  const parts: Buffer[] = [];

  let cursor = buffer.indexOf(markerBytes);
  while (cursor !== -1) {
    const next = buffer.indexOf(markerBytes, cursor + markerBytes.length);
    const segment = buffer.subarray(
      cursor + markerBytes.length,
      next === -1 ? buffer.length : next,
    );

    const headerEnd = segment.indexOf(separator);
    if (headerEnd !== -1) {
      let content = segment.subarray(headerEnd + separator.length);
      // Trim the CRLF the sender places before the next boundary.
      while (content.length > 0 && (content.at(-1) === 0x0a || content.at(-1) === 0x0d)) {
        content = content.subarray(0, content.length - 1);
      }
      if (content.length > 0) parts.push(content);
    }

    if (next === -1) break;
    cursor = next;
  }

  return parts;
}

function tryParseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

/** Printable excerpt, with non-text bytes replaced so logs stay readable. */
function preview(buffer: Buffer): string {
  return buffer
    .subarray(0, 300)
    .toString('latin1')
    .replace(/[^\x20-\x7e\r\n]/g, '.')
    .slice(0, 300);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}