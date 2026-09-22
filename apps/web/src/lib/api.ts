/**
 * API client.
 *
 * Requests are same-origin and rely on the http-only session cookie, so no token
 * is ever held in JavaScript. In development Vite proxies /api to the server,
 * which keeps the cookie behaving exactly as it will in production where the
 * server also serves this bundle.
 */

import type { LabelKey } from '@attendance/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const payload: unknown = text.length > 0 ? safeParse(text) : null;

  if (!response.ok) {
    const detail = isRecord(payload) ? payload : {};
    throw new ApiError(
      response.status,
      typeof detail['error'] === 'string' ? detail['error'] : `Permintaan gagal (${response.status})`,
      typeof detail['code'] === 'string' ? detail['code'] : undefined,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  /**
   * DELETE carrying a body.
   *
   * Used where the thing being removed is a set rather than a single resource, such
   * as clearing a block of roster cells. Expressing that set in a query string
   * would exceed practical URL limits for a month of a full ward.
   */
  deleteWithBody: <T>(path: string, body: unknown) => request<T>('DELETE', path, body),
};

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface SessionUser {
  accountId: number;
  staffId: number;
  employeeNo: string;
  fullName: string;
  email: string;
  accountType: string;
  roleName: string;
  permissions: Record<string, string[]>;
}

/**
 * How this deployment writes dates and times.
 *
 * Carried on the session rather than read from `/api/settings`, because every screen
 * formats a time and only a few roles may view the settings bundle.
 */
export interface DisplayPreferences {
  dateFormat: string;
  timeFormat: '12' | '24';
  weekStart: '0' | '1';
  organisationName: string | null;
  /** Absent rather than broken when nothing has been uploaded. */
  logoUrl: string | null;
  /**
   * The language this session reads the interface in.
   *
   * Already resolved by the server: the account's own choice where there is one, the
   * deployment default otherwise. `TranslationProvider` fetches the dictionary for this
   * code, so it is the single answer to which words render — the client never picks.
   */
  locale: string;
}

export interface DashboardDevice {
  id: number;
  name: string;
  host: string;
  model: string | null;
  status: string;
  /** Positive when the terminal runs ahead of the server. */
  clockDriftSeconds: number | null;
  clockMode: string | null;
  enrolled: number;
  capacity: number;
  /** Serialised as a string because the value exceeds INT32. */
  lastSerialNo: string | number;
  lastSyncAt: string | null;
  lastPushAt: string | null;
  lastSeenAt: string | null;
}

export interface DashboardScan {
  id: number;
  time: string;
  employeeNo: string;
  name: string;
  device: string | null;
  method: string;
  direction: string;
  suppressed: boolean;
}

export interface DashboardException {
  id: number;
  kind: string;
  detail: string | null;
  occurredAt: string;
  employeeNo: string | null;
  name: string | null;
}

export interface DashboardPayload {
  today: {
    date: string;
    staffTotal: number;
    missingBiometrics: number;
    present: number;
    late: number;
    absent: number;
    onLeave: number;
  };
  recentScans: DashboardScan[];
  exceptions: DashboardException[];
  devices: DashboardDevice[];
  driftThresholdSeconds: number;
  connectorMode: 'direct' | 'agent';
}

export const authApi = {
  login: (input: { email: string; password: string; totp?: string }) =>
    api.post<{ user: SessionUser; expiresAt: string; display: DisplayPreferences }>(
      '/api/auth/login',
      input,
    ),
  me: () => api.get<{ user: SessionUser; display: DisplayPreferences }>('/api/auth/me'),
  logout: () => api.post<{ ok: boolean }>('/api/auth/logout'),
};

export const dashboardApi = {
  load: () => api.get<DashboardPayload>('/api/dashboard'),
};

// ---------------------------------------------------------------------------
// Terminal identity mapping
// ---------------------------------------------------------------------------

/**
 * A terminal identifier nobody has claimed.
 *
 * The terminal matches faces locally and reports only its own id, so an
 * unclaimed identifier means somebody is scanning and their attendance is going
 * nowhere. `scanCount` is how loud that problem is.
 */
export interface UnmappedUser {
  id: number;
  deviceId: number;
  deviceEmployeeNo: string;
  deviceName: string | null;
  numOfFace: number;
  numOfFp: number;
  numOfCard: number;
  scanCount: number;
  firstSeenAt: string;
  lastSeenAt: string | null;
  device: { id: number; name: string };
}

/** An auto-paired mapping still waiting for a human to agree. */
export interface UnconfirmedMapping {
  id: number;
  deviceId: number;
  deviceEmployeeNo: string;
  confirmed: boolean;
  createdAt: string;
  device: { id: number; name: string };
  staff: { id: number; employeeNo: string; fullName: string };
}

export interface StaffCandidate {
  id: number;
  employeeNo: string;
  fullName: string;
  department: { name: string } | null;
  /** Set when this person already holds an id on the terminal being mapped. */
  existingDeviceEmployeeNo: string | null;
}

export interface StaffRow {
  id: number;
  employeeNo: string;
  fullName: string;
  active: boolean;
  /** Mirrored from the terminal. All three at zero means this person cannot scan. */
  numOfFace: number;
  numOfFp: number;
  numOfCard: number;
  /**
   * Whether a door PIN is stored here.
   *
   * From our own record, not mirrored from the terminal. It is the one credential this
   * system writes rather than reads, so this is authoritative for what we set — but a PIN
   * typed straight into the terminal's own menu would not show up.
   */
  hasDoorPin: boolean;
  department: { name: string } | null;
  location: { name: string } | null;
  account: { email: string; status: string; allowAppCheckIn: boolean } | null;
}

export interface StaffPage {
  total: number;
  page: number;
  pageSize: number;
  rows: StaffRow[];
  /**
   * Chip counts, each computed ignoring its own filter.
   *
   * From the server because the client holds one page. Counting the rows in hand and showing
   * the result as a total is how the directory reported 28 staff without biometrics when the
   * real figure was 5000 — it was counting page one.
   */
  counts: {
    /** Active and holding none of the three credentials, so genuinely unable to scan. */
    missingBiometrics: number;
    withBiometrics: number;
    inactive: number;
  };
}

/** Result of pushing one staff member to one terminal. */
export interface DeviceSyncOutcome {
  deviceId: number;
  deviceName: string;
  deviceEmployeeNo: string;
  ok: boolean;
  error?: string;
}

/**
 * One staff record in full.
 *
 * Every field here is already in the route's reply — it spreads the row and drops only the
 * door PIN — so the address and job title were being sent and thrown away by this type for
 * as long as the detail screen was a table row that had nowhere to put them.
 */
export interface StaffDetail extends StaffRow {
  icNo: string | null;
  /**
   * `male`, `female`, or null where it has not been recorded.
   *
   * Read for one reason: a leave type restricted to one gender refuses an application from
   * somebody with no value here, so this is what makes Maternity and Paternity usable.
   */
  gender: 'male' | 'female' | null;
  phone: string | null;
  email: string | null;
  position: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  /** Avatar filename. Deliberately not the biometric face; see `numOfFace`. */
  photoPath: string | null;
  hireDate: string | null;
  /**
   * Monthly wage, and what the overtime hourly rate is derived from (s.60I).
   *
   * Absent — not null — for a caller without the `salary` action on `staff.directory`.
   * The server drops the key rather than sending it for the screen to hide, because a
   * value the client is trusted to conceal is readable from the network tab.
   */
  basicSalary?: number | null;
  /** Whether the wage above was withheld, so the screen can say so rather than show a blank. */
  canReadSalary: boolean;
  validFrom: string | null;
  validTo: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  workPattern: { id: number; name: string } | null;
  enrolments: Array<{
    deviceId: number;
    deviceEmployeeNo: string;
    confirmed: boolean;
    lastError: string | null;
    device: { id: number; name: string; status: string };
  }>;
}

/**
 * Which identifier one person carries on each terminal.
 *
 * The answer to "which id is this person on each door", which is otherwise impossible to
 * see once the numbers differ per unit — and they do, on any terminal populated before this
 * system arrived.
 */
export interface StaffIdentities {
  staffId: number;
  canonicalEmployeeNo: string;
  fullName: string;
  credentials: { face: number; fingerprint: number; card: number };
  identities: Array<{
    deviceId: number;
    deviceName: string;
    deviceStatus: string;
    deviceEmployeeNo: string;
    confirmed: boolean;
    faceEnrolledAt: string | null;
  }>;
}

/**
 * One entry in a person's scan timeline.
 *
 * Both halves in one row: what the terminal reported, and what became of it. A row with a
 * `punchId` was accepted; one without is a scan that produced no attendance, which is what
 * somebody is looking for when a day is missing.
 */
export interface StaffScanRow {
  at: string;
  /** `terminal`, `app` or `manual`. App and manual entries carry no device event. */
  source: string;
  punchId: number | null;
  method: string | null;
  direction: string | null;
  /** Kept rather than dropped, so this view and the raw log cannot disagree. */
  suppressed: boolean;
  note: string | null;
  deviceName: string | null;
  rawEventId: string | null;
  serialNo: string | null;
  /** The identifier this person carries on that terminal, which is not their staff number. */
  deviceEmployeeNo: string | null;
  major: number | null;
  minor: number | null;
  verifyMode: string | null;
  driftSeconds: number | null;
  arrivedVia: 'push' | 'pull' | null;
  hasPicture: boolean;
}

export interface StaffScanPage {
  canonicalEmployeeNo: string;
  /** The per-terminal identifiers the raw side was matched on. */
  deviceEmployeeNos: string[];
  limit: number;
  truncated: boolean;
  rows: StaffScanRow[];
}

export interface StaffFormValues {
  employeeNo: string;
  fullName: string;
  icNo?: string;
  /**
   * `null` clears it, and that is why it is nullable rather than merely optional.
   *
   * The control's first option is "not recorded", so choosing it has to be able to unset a value
   * already saved. The free-text fields around it drop their key when blank, because for those an
   * empty box and an untouched box mean the same thing.
   */
  gender?: 'male' | 'female' | null;
  phone?: string;
  email?: string;
  departmentId?: number;
  locationId?: number;
  doorPin?: string;
  /**
   * Omitted leaves the stored wage alone; `null` clears it.
   *
   * Only sent by a caller holding the `salary` action — the server answers 403 rather
   * than discarding it, so sending it without the grant is a visible failure.
   */
  basicSalary?: number | null;
  active: boolean;
  notes?: string;
  deviceIds: number[];
}

export const staffApi = {
  list: (query: {
    page: number;
    pageSize: number;
    search?: string;
    biometrics?: 'missing' | 'enrolled';
    /**
     * Sent by the directory's inactive chip.
     *
     * That chip used to send nothing, so selecting it listed every staff member while the
     * label said inactive — the same non-filtering filter as the enrolled chip.
     */
    active?: boolean;
    departmentId?: number;
    locationId?: number;
  }) => {
    const params = new URLSearchParams({
      page: String(query.page),
      pageSize: String(query.pageSize),
    });
    if (query.search) params.set('search', query.search);
    if (query.biometrics) params.set('biometrics', query.biometrics);
    if (query.active !== undefined) params.set('active', String(query.active));
    if (query.departmentId) params.set('departmentId', String(query.departmentId));
    if (query.locationId) params.set('locationId', String(query.locationId));
    return api.get<StaffPage>(`/api/staff?${params.toString()}`);
  },
  get: (id: number) => api.get<StaffDetail>(`/api/staff/${id}`),
  identities: (id: number) => api.get<StaffIdentities>(`/api/staff/${id}/identities`),
  scans: (id: number, query: { from?: string; to?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (query.from !== undefined) params.set('from', query.from);
    if (query.to !== undefined) params.set('to', query.to);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    return api.get<StaffScanPage>(`/api/staff/${id}/scans?${params.toString()}`);
  },
  create: (values: StaffFormValues) =>
    api.post<{ id: number; sync: DeviceSyncOutcome[] }>('/api/staff', values),
  update: (id: number, values: Partial<StaffFormValues>) =>
    api.patch<{ id: number; sync: DeviceSyncOutcome[]; removal: DeviceSyncOutcome[] }>(
      `/api/staff/${id}`,
      values,
    ),
  deactivate: (id: number) =>
    api.delete<{ id: number; removal: DeviceSyncOutcome[] }>(`/api/staff/${id}`),
  resync: (id: number) =>
    api.post<{ sync: DeviceSyncOutcome[] }>(`/api/staff/${id}/resync`),
  refreshCredentials: (id: number) =>
    api.post<{ numOfFace: number; numOfFp: number; numOfCard: number }>(
      `/api/staff/${id}/refresh-credentials`,
    ),
};

export const identityApi = {
  unmapped: () => api.get<UnmappedUser[]>('/api/identity/unmapped'),
  unconfirmed: () => api.get<UnconfirmedMapping[]>('/api/identity/unconfirmed'),
  searchStaff: (query: string, deviceId?: number) => {
    const params = new URLSearchParams({ q: query });
    if (deviceId !== undefined) params.set('deviceId', String(deviceId));
    return api.get<StaffCandidate[]>(`/api/identity/staff-search?${params.toString()}`);
  },
  map: (input: { deviceId: number; deviceEmployeeNo: string; staffId: number }) =>
    api.post<{ enrolmentId: number; backfilled: number; noteKey: LabelKey }>(
      '/api/identity/map',
      input,
    ),
  dismiss: (id: number) => api.post<{ ok: boolean }>(`/api/identity/unmapped/${id}/dismiss`),
  importUsers: (deviceId: number) =>
    api.post<{
      deviceUsers: number;
      autoMapped: number;
      alreadyMapped: number;
      needsReview: number;
    }>(`/api/devices/${deviceId}/import-users`),
};

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 200) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
