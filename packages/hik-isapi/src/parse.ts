import { XMLParser } from 'fast-xml-parser';

import { IsapiStatusError, ResponseParseError } from './errors.js';
import type { RawResponse } from './digest.js';

/**
 * Entity processing is switched off deliberately. ISAPI payloads never rely on
 * XML entities, and leaving expansion enabled is the root of the entire
 * fast-xml-parser DoS advisory family.
 */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: false,
  trimValues: true,
  // ISAPI wraps repeated elements without a container, so arrays must be
  // forced per-path rather than inferred from a single occurrence.
  isArray: (name) =>
    [
      'HttpHostNotification',
      'NTPServer',
      'UserInfo',
      'InfoList',
      'CardInfo',
      'FDLib',
      'RightPlan',
      'PersonInfoExtends',
      'EmployeeNoList',
    ].includes(name),
});

export interface IsapiResponseStatus {
  statusCode: number;
  statusString: string;
  subStatusCode: string | null;
  errorMsg: string | null;
}

/**
 * Decodes an ISAPI response body.
 *
 * The device is inconsistent: `?format=json` is honoured by AccessControl and
 * Intelligent endpoints, but `/ISAPI/System/deviceInfo`, `/ISAPI/System/time`
 * and `/ISAPI/Event/notification/httpHosts` answer in XML regardless. Sniffing
 * the payload is more reliable than trusting either the query flag or the
 * Content-Type header.
 */
export function decodeBody(response: RawResponse, requestPath: string, host: string): unknown {
  const text = response.body.toString('utf8').trim();
  if (text.length === 0) return {};

  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return JSON.parse(text);
    } catch {
      throw new ResponseParseError(host, requestPath, preview(text));
    }
  }

  if (text.startsWith('<')) {
    try {
      return xmlParser.parse(text);
    } catch {
      throw new ResponseParseError(host, requestPath, preview(text));
    }
  }

  throw new ResponseParseError(host, requestPath, preview(text));
}

/**
 * Pulls the ISAPI status envelope out of a decoded body, if present.
 *
 * A successful mutation answers `{ statusCode: 1, statusString: "OK" }`, while
 * a read usually answers with domain data and no envelope at all. XML replies
 * nest the same fields under `<ResponseStatus>`.
 */
export function readStatus(body: unknown): IsapiResponseStatus | null {
  if (typeof body !== 'object' || body === null) return null;

  const record = body as Record<string, unknown>;
  const envelope =
    'statusCode' in record
      ? record
      : isRecord(record['ResponseStatus'])
        ? record['ResponseStatus']
        : null;
  if (!envelope) return null;

  const statusCode = Number(envelope['statusCode']);
  if (!Number.isFinite(statusCode)) return null;

  return {
    statusCode,
    statusString: asString(envelope['statusString']) ?? 'Unknown',
    subStatusCode: asString(envelope['subStatusCode']),
    errorMsg: asString(envelope['errorMsg']),
  };
}

/**
 * Throws unless the device reported success.
 *
 * `statusCode` 1 is the only success value. Note that HTTP 200 is not enough on
 * its own: the device answers 200 with `statusCode: 4/6` for rejected
 * operations, so callers that only check the HTTP status silently swallow
 * failures.
 */
export function assertOk(
  body: unknown,
  requestPath: string,
  host: string,
  httpStatus: number,
): void {
  const status = readStatus(body);

  if (status === null) {
    if (httpStatus >= 400) {
      throw new IsapiStatusError(host, requestPath, httpStatus, `HTTP ${httpStatus}`, null, null);
    }
    return;
  }

  if (status.statusCode !== 1) {
    throw new IsapiStatusError(
      host,
      requestPath,
      status.statusCode,
      status.statusString,
      status.subStatusCode,
      status.errorMsg,
    );
  }
}

/** True when a failure is the device telling us the record already exists. */
export function isAlreadyExists(error: unknown): boolean {
  return (
    error instanceof IsapiStatusError &&
    (error.subStatusCode === 'deviceUserAlreadyExist' ||
      error.subStatusCode === 'employeeNoAlreadyExist' ||
      error.subStatusCode === 'cardNoAlreadyExist')
  );
}

/** True when the device does not implement the endpoint on this firmware. */
export function isNotSupported(error: unknown): boolean {
  return error instanceof IsapiStatusError && error.subStatusCode === 'notSupport';
}

/**
 * True when the terminal has nothing to return at this address.
 *
 * Wider than `isNotSupported` because the firmware uses two codes for one situation, and
 * which one it picks is not predictable: `/Door/param/capabilities` answers `invalidID`
 * while other absent endpoints answer `notSupport`. A caller that only tolerates
 * `notSupport` throws on the first document that chose the other word — which is exactly
 * how a diagnostics screen meant to reveal what a firmware lacks ends up failing to load.
 *
 * `invalidID` also covers a door or reader number this unit does not have, and that too
 * should read as "absent" rather than as an error.
 */
export function isUnavailable(error: unknown): boolean {
  return (
    error instanceof IsapiStatusError &&
    (error.subStatusCode === 'notSupport' || error.subStatusCode === 'invalidID')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

function preview(text: string): string {
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
