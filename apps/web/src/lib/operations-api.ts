import type { LabelKey } from '@attendance/shared';

import { api } from './api';

/** Shared shape for every server-paged list. */
export interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
  rows: T[];
}

export interface StaffRef {
  id: number;
  employeeNo: string;
  fullName: string;
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

export interface ExceptionRow {
  id: number;
  kind: string;
  detail: string | null;
  occurredAt: string;
  workDate: string | null;
  staff: StaffRef | null;
  deviceName: string | null;
  rawEventId: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface ExceptionPage extends Paged<ExceptionRow> {
  /** Open counts per kind, so filters reflect what is actually queued. */
  openByKind: Record<string, number>;
}

/**
 * Registry keys for the stored enum values, not the words themselves.
 *
 * The wording lives in `packages/shared/src/labels.ts`. Holding it here would put it outside
 * the registry, which means outside the translation screen — and the dashboard used to carry
 * its own second copy of exactly this map, which is the divergence a registry exists to stop.
 */
export const EXCEPTION_LABELS: Record<string, LabelKey> = {
  missing_check_out: 'exception.missing_check_out',
  missing_check_in: 'exception.missing_check_in',
  duplicate_scan: 'exception.duplicate_scan',
  unrecognised_face: 'exception.unrecognised_face',
  unknown_employee: 'exception.unknown_employee',
  outside_roster: 'exception.outside_roster',
  clock_drift: 'exception.clock_drift',
  outside_geofence: 'exception.outside_geofence',
};

export const exceptionsApi = {
  list: (query: {
    page: number;
    pageSize: number;
    kind?: string;
    resolved?: boolean;
    /** Also already accepted by the route, and also never sent until now. */
    staffId?: number;
    from?: string;
    to?: string;
  }) => api.get<ExceptionPage>(`/api/exceptions?${toParams(query)}`),
  resolve: (id: number, note: string) =>
    api.post<{ ok: boolean }>(`/api/exceptions/${id}/resolve`, { note }),
};

// ---------------------------------------------------------------------------
// Raw device log
// ---------------------------------------------------------------------------

export interface RawEventRow {
  /** Serialised as a string: the value exceeds INT32. */
  id: string;
  /** Dedup identity, namespaced by the protocol that decoded it. Always present. */
  eventKey: string;
  /** The terminal's own sequence. Null where the protocol has none. */
  serialNo: string | null;
  /**
   * What the driver decided this event means: identified, unrecognised or other.
   *
   * This is the authoritative classification. `major` and `minor` below are retained
   * evidence, and a protocol without two-level codes leaves both null.
   */
  eventKind: string;
  /** Credential the terminal matched, decided by the driver. */
  verifyMethod: string | null;
  major: number | null;
  minor: number | null;
  eventTime: string;
  receivedAt: string;
  employeeNo: string | null;
  personName: string | null;
  cardNo: string | null;
  verifyMode: string | null;
  doorNo: number | null;
  maskWorn: string | null;
  pictureUrl: string | null;
  arrivedVia: 'push' | 'pull';
  /** Terminal clock error recorded when this arrived. */
  deviceDriftS: number | null;
  device: { id: number; name: string };
  punch: { id: number; staffId: number; suppressed: boolean; direction: string } | null;
}

/**
 * Hikvision event codes, for the detail view.
 *
 * Major 5 carries both person authentications and door events, so the minor code is
 * what distinguishes a punch from a door opening. Only meaningful for ISAPI rows —
 * a protocol without two-level codes has no entry here and falls back to the neutral
 * classification below.
 */
export const EVENT_LABELS: Record<string, LabelKey> = {
  '5:38': 'event.5:38',
  '5:75': 'event.5:75',
  '5:76': 'event.5:76',
  '5:113': 'event.5:113',
  '5:27': 'event.5:27',
  '5:22': 'event.5:22',
};

export const MAJOR_LABELS: Record<number, LabelKey> = {
  1: 'event.major.1',
  2: 'event.major.2',
  3: 'event.major.3',
  5: 'event.major.5',
};

/**
 * The vendor-neutral classification, which every row has.
 *
 * Used when a row carries no vendor event code to render, so the log describes what
 * happened rather than showing a blank where a Hikvision row would show a label.
 */
export const EVENT_KIND_LABELS: Record<string, LabelKey> = {
  identified: 'event.kind.identified',
  unrecognised: 'event.kind.unrecognised',
  other: 'event.kind.other',
};



export const rawEventsApi = {
  list: (query: {
    page: number;
    pageSize: number;
    deviceId?: number;
    employeeNo?: string;
    major?: number;
    from?: string;
    to?: string;
    arrivedVia?: 'push' | 'pull';
    identifiedOnly?: boolean;
  }) => api.get<Paged<RawEventRow>>(`/api/raw-events?${toParams(query)}`),
  pictureUrl: (id: string) => `/api/raw-events/${id}/picture`,
};

// ---------------------------------------------------------------------------
// Computed attendance
// ---------------------------------------------------------------------------

export interface AttendanceBlockRow {
  id: number;
  blockOrder: number;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  workedMinutes: number;
}

export interface AttendanceRecordRow {
  id: number;
  workDate: string;
  status: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  workedMinutes: number;
  origin: string;
  calculatedAt: string;
  staff: StaffRef;
  shift: { code: string; name: string } | null;
  blocks: AttendanceBlockRow[];
}

export interface AttendancePage extends Paged<AttendanceRecordRow> {
  byStatus: Record<string, number>;
}

/**
 * Terminal manufacturer and transport, as registry keys.
 *
 * Exported rather than declared per screen. Both the device list and the device editor render
 * them, and a second copy would be the one somebody corrects the casing in while the other
 * keeps printing the raw enum.
 */
export const VENDOR_LABELS: Record<string, LabelKey> = {
  hikvision: 'device.vendor.hikvision',
  zkteco: 'device.vendor.zkteco',
  dahua: 'device.vendor.dahua',
};

export const PROTOCOL_LABELS: Record<string, LabelKey> = {
  isapi: 'device.protocol.isapi',
  'ta-push': 'device.protocol.ta-push',
  'dahua-cgi': 'device.protocol.dahua-cgi',
};

/** Which side opens the connection. Decides whether a remote site needs a VPN. */
export const REACHABILITY_LABELS: Record<string, LabelKey> = {
  inbound: 'device.reach.inbound',
  outbound: 'device.reach.outbound',
};

export const STATUS_LABELS: Record<string, LabelKey> = {
  on_time: 'status.on_time',
  late: 'status.late',
  early_leave: 'status.early_leave',
  absent: 'status.absent',
  incomplete: 'status.incomplete',
  on_leave: 'status.on_leave',
  rest_day: 'status.rest_day',
  holiday: 'status.holiday',
};

/**
 * Verification method and punch direction, as registry keys.
 *
 * Exported rather than declared per screen. `METHOD_LABELS` began as a module-local map in
 * the live monitor; the moment a second screen showed the same value, that copy would have
 * been the one somebody translated while the other printed the raw enum.
 */
export const METHOD_LABELS: Record<string, LabelKey> = {
  face: 'method.face',
  fingerprint: 'method.fingerprint',
  card: 'method.card',
  // Present in the shared `VerifyMethod` vocabulary but never emitted by the Hikvision
  // decoder, so these had no label and rendered as the raw enum. A ZKTeco terminal
  // authenticates by PIN, which makes `password` an ordinary value rather than a rare one.
  password: 'method.password',
  unknown: 'method.unknown',
};

export const DIRECTION_LABELS: Record<string, LabelKey> = {
  in: 'scan.in',
  out: 'scan.out',
  unknown: 'scan.undecided',
};

/** Where a punch came from. App and manual entries carry no device event at all. */
export const PUNCH_SOURCE_LABELS: Record<string, LabelKey> = {
  terminal: 'punchSource.terminal',
  app: 'punchSource.app',
  manual: 'punchSource.manual',
};

export const STATUS_TONES: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  on_time: 'success',
  late: 'warning',
  early_leave: 'warning',
  incomplete: 'warning',
  absent: 'danger',
  on_leave: 'neutral',
  rest_day: 'neutral',
  holiday: 'neutral',
};

export const attendanceApi = {
  records: (query: {
    page: number;
    pageSize: number;
    from?: string;
    to?: string;
    /**
     * One person's days.
     *
     * The route has accepted this since it was written; nothing sent it until the staff
     * detail screen existed, so the filter was reachable only by editing a URL by hand.
     */
    staffId?: number;
    status?: string;
    search?: string;
  }) => api.get<AttendancePage>(`/api/attendance/records?${toParams(query)}`),
  recompute: (from: string, to: string) =>
    api.post<{ staffProcessed: number; recordsWritten: number; exceptionsRaised: number }>(
      '/api/attendance/recompute',
      { from, to },
    ),
};

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export interface Lookups {
  devices: Array<{ id: number; name: string }>;
  departments: Array<{ id: number; name: string }>;
  locations: Array<{ id: number; name: string }>;
  shifts: Array<{ id: number; code: string; name: string }>;
  timeZone: string;
}

export const lookupsApi = {
  load: () => api.get<Lookups>('/api/lookups'),
};

function toParams(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  return params.toString();
}

/**
 * Whether clock times render as 24-hour or 12-hour.
 *
 * A module-level preference rather than a prop threaded through every table, because
 * these formatters are called from a hundred cells and none of them is the right place to
 * decide policy. Set once from the settings payload after login; defaults to 24-hour,
 * which is what a duty roster is written in.
 *
 * Deliberately does *not* touch `formatDateOnly` — that value has no time in it at all.
 */
let clock: '12' | '24' = '24';

export function setClockFormat(value: string | null | undefined): void {
  clock = value === '12' ? '12' : '24';
}

export function clockFormat(): '12' | '24' {
  return clock;
}

/** `HH:mm:ss`, or `h:mm:ss AM` where the organisation prefers it. */
export function formatTime(iso: string | null): string {
  if (iso === null) return '—';
  const when = new Date(iso);
  return Number.isNaN(when.getTime())
    ? '—'
    : when.toLocaleTimeString('ms-MY', { hour12: clock === '12' });
}

/**
 * `dd/mm/yyyy` for a timestamp, read in the browser's zone.
 *
 * For a *calendar* field — `workDate`, `fromDate`, a holiday date — use
 * `formatDateOnly` instead. Those carry no time, and passing them through a zone
 * shifts them by a day for any reader west of the server.
 */
export function formatDate(iso: string | null): string {
  if (iso === null) return '—';
  const when = new Date(iso);
  return Number.isNaN(when.getTime())
    ? '—'
    : when.toLocaleDateString('ms-MY', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * `dd/mm/yyyy` for a date-only field, with no timezone involved.
 *
 * The server stores these as `DATE` columns and serialises them as
 * `2026-08-29T00:00:00.000Z`; the date is the whole value and the `Z` is an artefact
 * of JSON having no date type. Reading the first ten characters is therefore exact,
 * where `new Date(...).toLocaleDateString()` would re-interpret midnight UTC in the
 * reader's zone and land on the 28th for anyone in the Americas.
 *
 * Accepts a plain `YYYY-MM-DD` too, which is what the date inputs produce.
 */
export function formatDateOnly(value: string | null): string {
  if (value === null || value.length < 10) return '—';
  const [year, month, day] = value.slice(0, 10).split('-');
  if (year === undefined || month === undefined || day === undefined) return '—';
  return `${day}/${month}/${year}`;
}

export function formatDateTime(iso: string | null): string {
  if (iso === null) return '—';
  const when = new Date(iso);
  return Number.isNaN(when.getTime())
    ? '—'
    : when.toLocaleString('ms-MY', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: clock === '12',
      });
}

export function formatMinutes(minutes: number): string {
  if (minutes === 0) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}j ${rest}m` : `${rest}m`;
}

/** Today as `YYYY-MM-DD` for date inputs. */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function daysAgoIso(days: number): string {
  const when = new Date(Date.now() - days * 86_400_000);
  return `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`;
}
