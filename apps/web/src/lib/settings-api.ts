import type { LabelKey } from '@attendance/shared';

import { api } from './api';
import type { Paged } from './operations-api';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * A stored setting value.
 *
 * Secrets come back as `{ configured: true }` rather than the value, so the shape
 * is a union by design and the UI has to decide what to render for each case.
 */
export type SettingValue = string | number | boolean | null | { configured: true };

/** Presence and a cache-busted URL. The path on disk never leaves the server. */
export interface BrandingSlot {
  set: boolean;
  url: string | null;
  bytes: number | null;
}

export interface SettingsPayload {
  values: Record<string, SettingValue>;
  branding: { logo: BrandingSlot; favicon: BrandingSlot };
  /** Fixed at deploy time; shown read-only. */
  environment: {
    connectorMode: 'direct' | 'agent';
    timezone: string;
    driftWarnSeconds: number;
    syncIntervalSeconds: number;
    requireAdmin2fa: boolean;
    ingestPath: string;
    maxUploadBytes: number;
  };
  editableKeys: string[];
}

export const settingsApi = {
  load: () => api.get<SettingsPayload>('/api/settings'),
  save: (values: Record<string, string | number | boolean | null>) =>
    api.put<{ ok: boolean }>('/api/settings', { values }),

  /**
   * Uploads a branding asset.
   *
   * Sent as multipart rather than a base64 string in JSON: the body limit is enforced on
   * the wire, and base64 inflates a file by a third before it gets there.
   */
  uploadBranding: async (slot: 'logo' | 'favicon', file: File) => {
    const form = new FormData();
    form.append('file', file);

    const response = await fetch(`/api/branding/${slot}`, {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      throw new Error(typeof detail['error'] === 'string' ? detail['error'] : 'Muat naik gagal');
    }
    return payload as { slot: string; url: string; bytes: number; format: string };
  },

  removeBranding: (slot: 'logo' | 'favicon') =>
    api.delete<{ ok: boolean }>(`/api/branding/${slot}`),
};

/**
 * One day as the holiday list returns it, grouped across the states that observe it.
 *
 * The table stores a row per observing state, which is what makes the office filter and the yearly
 * replace work. The endpoint groups them, because the screen reads one line per day — ungrouped, a
 * day observed in four states would be four identical-looking lines.
 */
export interface HolidayRow {
  id: number;
  name: string;
  /** Calendar date, not an instant. Render with `formatDateOnly`. */
  date: string;
  /** The states that gazette it. Empty for a day the organisation declared for every office. */
  states: string[];
  /**
   * True when every office state observes it.
   *
   * Computed by the server from the saved office list rather than stored, because it stops being
   * true the moment somebody adds a state — a flag on the row would go stale silently.
   */
  allOffices: boolean;
  /** Declared here rather than gazetted. Never touched by a sync, and never published. */
  companyDeclared: boolean;
}

export interface HolidayListPayload {
  year: number;
  mode: 'offices' | 'all';
  /** The saved office states the list was filtered against. */
  offices: string[];
  rows: HolidayRow[];
  /**
   * Rows held back because they belong to states with no office here.
   *
   * Reported rather than dropped silently, so a list that looks short has a reason on screen —
   * otherwise a narrowed office selection reads as a sync that lost rows.
   */
  hidden: number;
}

export const holidayApi = {
  list: (year: number, mode: 'offices' | 'all') =>
    api.get<HolidayListPayload>(`/api/holidays?year=${String(year)}&mode=${mode}`),

  /**
   * Pulls the gazetted list for a year.
   *
   * The states are not sent: the server reads the saved office list. Syncing against ticks that
   * have not been saved would write holidays for a selection the settings screen does not show.
   */
  sync: (year: number) =>
    api.post<{ year: number; written: number; offices: string[]; lastSync: string }>(
      '/api/holidays/sync',
      { year },
    ),
};

/** True when a secret is stored, without revealing it. */
export function isConfigured(value: SettingValue | undefined): boolean {
  return typeof value === 'object' && value !== null && value.configured === true;
}

/** Renders a setting into a text input, treating a stored secret as blank. */
export function asText(value: SettingValue | undefined, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'object') return '';
  return String(value);
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export interface RoleRow {
  id: number;
  name: string;
  description: string | null;
  /** Keyed by screen, as `{ "attendance.records": ["view","edit"] }`. */
  permissions: Record<string, string[]>;
  systemRole: boolean;
  status: 'active' | 'inactive';
  accountCount: number;
  /** Counted server-side against the registry, so a stale key is not counted. */
  permissionCount: number;
  permissionTotal: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The permission matrix, described by the server in registry keys.
 *
 * Keys rather than words for the same reason as the report field catalogue: the matrix is a
 * screen somebody reads, so its wording resolves through the translation registry and carries
 * a label number when those are on.
 */
export interface CustomAction {
  id: string;
  labelKey: LabelKey;
  noteKey?: LabelKey;
}

export interface ScreenPermission {
  key: string;
  labelKey: LabelKey;
  path?: string;
  actions: string[];
  custom?: CustomAction[];
  noteKey?: LabelKey;
  /** Endpoints not built yet; the grant is stored ready for when they are. */
  planned?: boolean;
}

export interface PermissionSection {
  key: string;
  labelKey: LabelKey;
  screens: ScreenPermission[];
}

export interface PermissionMatrix {
  sections: PermissionSection[];
  /** Fixed column order, so a checkbox stays in the same place on every row. */
  standardActions: string[];
  actionLabels: Record<string, LabelKey>;
  total: number;
}

/**
 * Action wording is not held here.
 *
 * The roles matrix arrives with `actionLabels` from the server, which is the only place that
 * knows which actions each screen supports. A second copy on the client would be a map
 * nobody reads until it disagrees with the matrix.
 */

/** Every action a screen supports, standard and custom together. */
export function screenActions(screen: ScreenPermission): string[] {
  return [...screen.actions, ...(screen.custom ?? []).map((action) => action.id)];
}

/** Checkboxes ticked for one section, against the number available. */
export function sectionProgress(
  section: PermissionSection,
  permissions: Record<string, string[]>,
): { granted: number; total: number } {
  let granted = 0;
  let total = 0;
  for (const screen of section.screens) {
    const available = screenActions(screen);
    total += available.length;
    const held = new Set(permissions[screen.key] ?? []);
    granted += available.filter((action) => held.has(action)).length;
  }
  return { granted, total };
}

export const rolesApi = {
  list: () => api.get<RoleRow[]>('/api/roles'),
  get: (id: number) => api.get<RoleRow[]>('/api/roles').then((rows) => rows.find((row) => row.id === id)),
  matrix: () => api.get<PermissionMatrix>('/api/roles/matrix'),
  create: (input: {
    name: string;
    description?: string;
    status?: 'active' | 'inactive';
    permissions: Record<string, string[]>;
  }) => api.post<{ id: number; permissionCount: number }>('/api/roles', input),
  update: (
    id: number,
    input: {
      name?: string;
      description?: string;
      status?: 'active' | 'inactive';
      permissions?: Record<string, string[]>;
    },
  ) => api.patch<{ id: number }>(`/api/roles/${id}`, input),
  remove: (id: number) => api.delete<{ ok: boolean }>(`/api/roles/${id}`),
};

// ---------------------------------------------------------------------------
// User accounts
// ---------------------------------------------------------------------------

export type UserStatus = 'active' | 'pending' | 'suspended';

export interface UserRow {
  id: number;
  email: string;
  accountType: 'admin' | 'staff';
  status: UserStatus;
  allowAppCheckIn: boolean;
  /** Set once a handset has claimed the account. */
  boundDeviceId: string | null;
  boundDeviceAt: string | null;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  failedLoginCount: number;
  createdAt: string;
  twoFactorEnabled: boolean;
  role: { id: number; name: string };
  staff: {
    id: number;
    employeeNo: string;
    fullName: string;
    active: boolean;
    department: { name: string } | null;
  } | null;
}

export interface UserPage extends Paged<UserRow> {
  /** Counted ignoring the status filter, so selecting one does not zero the rest. */
  statuses: Record<UserStatus, number>;
  generatedAt: string;
}

export interface UserCounts {
  admin: number;
  staff: number;
  apps: number;
}

export const USER_STATUS_LABELS: Record<string, LabelKey> = {
  active: 'app.status.active',
  pending: 'userStatus.pending',
  suspended: 'userStatus.suspended',
};

export const USER_STATUS_TONES: Record<string, 'success' | 'warning' | 'danger'> = {
  active: 'success',
  pending: 'warning',
  suspended: 'danger',
};

export interface AccountCandidate {
  id: number;
  employeeNo: string;
  fullName: string;
  email: string | null;
  department: { name: string } | null;
  /** Set when this person already has a login, which blocks a second one. */
  existingAccountEmail: string | null;
}

export const usersApi = {
  counts: () => api.get<UserCounts>('/api/users/counts'),
  searchStaff: (query: string) =>
    api.get<AccountCandidate[]>(
      `/api/users/staff-search?q=${encodeURIComponent(query)}`,
    ),
  list: (query: {
    accountType: 'admin' | 'staff';
    status?: UserStatus;
    search?: string;
    page: number;
    pageSize: number;
  }) => {
    const params = new URLSearchParams({
      accountType: query.accountType,
      page: String(query.page),
      pageSize: String(query.pageSize),
    });
    if (query.status) params.set('status', query.status);
    if (query.search) params.set('search', query.search);
    return api.get<UserPage>(`/api/users?${params.toString()}`);
  },
  remove: (id: number) => api.delete<{ ok: boolean }>(`/api/users/${id}`),
  create: (input: {
    staffId: number;
    email: string;
    accountType: 'admin' | 'staff';
    roleId: number;
    password: string;
    allowAppCheckIn: boolean;
  }) => api.post<{ id: number; note?: string }>('/api/users', input),
  update: (
    id: number,
    input: {
      roleId?: number;
      status?: 'active' | 'pending' | 'suspended';
      allowAppCheckIn?: boolean;
      password?: string;
      resetDeviceBinding?: boolean;
    },
  ) => api.patch<{ id: number; staffName?: string }>(`/api/users/${id}`, input),
};

// ---------------------------------------------------------------------------
// App clients
// ---------------------------------------------------------------------------

export interface AppClientRow {
  id: number;
  name: string;
  platform: 'android' | 'ios' | 'web';
  clientId: string;
  minVersion: string | null;
  status: 'active' | 'suspended';
  createdAt: string;
  updatedAt: string;
}

export const appClientsApi = {
  list: () => api.get<AppClientRow[]>('/api/app-clients'),
  create: (input: { name: string; platform: 'android' | 'ios' | 'web'; minVersion?: string }) =>
    api.post<{ id: number; clientId: string; secret: string; note: string }>(
      '/api/app-clients',
      input,
    ),
  update: (
    id: number,
    input: { status?: 'active' | 'suspended'; minVersion?: string; rotateSecret?: boolean },
  ) => api.patch<{ id: number; secret?: string; note?: string }>(`/api/app-clients/${id}`, input),
  remove: (id: number) => api.delete<{ ok: boolean }>(`/api/app-clients/${id}`),
};

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface ActivityLogRow {
  /** Serialised as a string: the value exceeds INT32. */
  id: string;
  accountId: number | null;
  actorLabel: string;
  level: LogLevel;
  category: string;
  source: 'web' | 'terminal' | 'app' | 'system';
  action: string;
  detail: string | null;
  path: string | null;
  ipAddress: string | null;
  createdAt: string;
}

/** A value the filter can offer, with how many rows carry it. */
export interface Facet {
  key: string;
  count: number;
}

export interface ActorFacet {
  accountId: number;
  label: string;
  count: number;
}

export interface ActivityLogPage extends Paged<ActivityLogRow> {
  /** Drives the severity chips. Counted ignoring the level filter itself. */
  levels: Record<LogLevel, number>;
  categories: Facet[];
  actors: ActorFacet[];
  generatedAt: string;
}

export const LEVEL_LABELS: Record<LogLevel, LabelKey> = {
  info: 'logLevel.info',
  warn: 'logLevel.warn',
  error: 'logLevel.error',
  debug: 'logLevel.debug',
};

/** Registry keys for the stored category keys. */
export const CATEGORY_LABELS: Record<string, LabelKey> = {
  auth: 'logCategory.auth',
  attendance: 'logCategory.attendance',
  staff: 'logCategory.staff',
  schedule: 'logCategory.schedule',
  reports: 'logCategory.reports',
  devices: 'logCategory.devices',
  users: 'logCategory.users',
  roles: 'logCategory.roles',
  settings: 'logCategory.settings',
  backup: 'logCategory.backup',
  retention: 'logCategory.retention',
  system: 'logCategory.system',
};

export const SOURCE_LABELS: Record<string, LabelKey> = {
  web: 'logSource.web',
  terminal: 'logSource.terminal',
  app: 'logSource.app',
  system: 'logSource.system',
};

export interface ActivityFilters {
  page: number;
  pageSize: number;
  level?: LogLevel;
  category?: string;
  source?: string;
  accountId?: number;
  search?: string;
  from?: string;
  to?: string;
}

export interface AuditFilters {
  page: number;
  pageSize: number;
  entityType?: string;
  entityId?: string;
  action?: string;
  accountId?: number;
  search?: string;
  from?: string;
  to?: string;
}

export interface AuditLogRow {
  id: string;
  accountId: number | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string;
  /** Only the fields that moved, as `{ field: { before, after } }`. */
  changes: Record<string, { before: unknown; after: unknown }> | null;
  reason: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export const ENTITY_LABELS: Record<string, LabelKey> = {
  Setting: 'entity.Setting',
  Role: 'entity.Role',
  UserAccount: 'entity.UserAccount',
  AppClient: 'entity.AppClient',
  Staff: 'entity.Staff',
  StaffFace: 'entity.StaffFace',
  AttendanceRecord: 'entity.AttendanceRecord',
  Exception: 'entity.Exception',
  Device: 'entity.Device',
};

/**
 * Audit action wording, as registry keys.
 *
 * Exported and shared rather than declared per screen. It began as a module-local map in
 * the log screen, and the moment a second screen showed the same trail that copy would have
 * been the one somebody translated while the other printed the raw enum value.
 */
export const AUDIT_ACTION_LABELS: Record<string, LabelKey> = {
  create: 'auditAction.create',
  update: 'auditAction.update',
  delete: 'auditAction.delete',
};

export const ACTION_TONES: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  create: 'success',
  update: 'warning',
  delete: 'danger',
  login: 'neutral',
  export: 'neutral',
};

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export interface RetentionPreview {
  policy: {
    enabled: boolean;
    rawEventMonths: number;
    pictureMonths: number;
    purgeHour: number;
    lastPurgeAt: string | null;
  };
  minimumRawEventMonths: number;
  rawCutoff: string;
  pictureCutoff: string;
  /** Rows that would go on the next pass. */
  rawEventsDue: number;
  picturesDue: number;
  oldestEventAt: string | null;
  newestEventAt: string | null;
  totalRawEvents: number;
  /** Punches whose evidence link would be cleared. The punches survive. */
  punchesAffected: number;
}

export interface PurgeOutcome {
  rawEventsDeleted: number;
  picturesCleared: number;
  pictureFilesDeleted: number;
  exceptionLinksCleared: number;
  rawCutoff: string;
  batches: number;
  durationMs: number;
  incomplete: boolean;
  noteKey?: LabelKey;
}

export const retentionApi = {
  preview: () => api.get<RetentionPreview>('/api/retention'),
  run: () => api.post<PurgeOutcome>('/api/retention/run'),
};

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

export interface BackupFile {
  name: string;
  bytes: number;
  createdAt: string;
}

export interface BackupPolicy {
  enabled: boolean;
  hour: number;
  keepCount: number;
  lastRunAt: string | null;
}

export interface BackupPayload {
  directory: string;
  files: BackupFile[];
  policy: BackupPolicy;
  totalBytes: number;
  toolAvailable: boolean;
  /** Built from the live connection details, so it is a value and not a label. */
  restoreHint: string;
  restoreWarningKey: LabelKey;
}

export interface BackupRunOutcome {
  name: string;
  bytes: number;
  durationMs: number;
  /** Files the retention count removed after this dump succeeded. */
  pruned: string[];
  noteKey: LabelKey;
}

export const backupApi = {
  load: () => api.get<BackupPayload>('/api/backup'),
  run: () => api.post<BackupRunOutcome>('/api/backup/run'),
  remove: (name: string) => api.delete<{ ok: boolean }>(`/api/backup/${name}`),
  /**
   * A plain navigation, not a fetch.
   *
   * The browser handles the download and the `content-disposition` filename, which a
   * fetch would have to reimplement with a blob and a synthetic anchor — for a file that
   * can be hundreds of megabytes and should never be held in a tab's memory.
   */
  downloadUrl: (name: string) => `/api/backup/${name}`,
};

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

export interface SystemHealth {
  database: { ok: boolean; latencyMs: number | null; detail: string };
  storage: { ok: boolean; path: string; detail: string };
  maintenanceMode: { active: boolean; allowList: boolean };
  backup: {
    count: number;
    lastAt: string | null;
    lastBytes: number | null;
    scheduled: boolean;
    /** Days since the newest dump. A schedule switched on is not evidence it ran. */
    staleDays: number | null;
  };
  email: { activeProfiles: number };
  logs: {
    activityRows: number;
    auditRows: number;
    oldestActivityAt: string | null;
    retentionDays: number;
  };
  branding: { orphanedFiles: number };
  process: {
    heapUsedBytes: number;
    heapTotalBytes: number;
    rssBytes: number;
    uptimeSeconds: number;
    nodeVersion: string;
  };
}

export const maintenanceApi = {
  health: () => api.get<SystemHealth>('/api/maintenance/health'),
  clearCache: (scope: 'config' | 'devices' | 'all') =>
    // What was released arrives as registry keys, not as words: the list is rendered.
    api.post<{ cleared: LabelKey[]; noteKey: LabelKey }>('/api/maintenance/cache', { scope }),
  trimLogs: () =>
    api.post<{ deleted: number; cutoff: string; retentionDays: number; noteKey: LabelKey }>(
      '/api/maintenance/trim-logs',
    ),
};

export interface AuditLogPage extends Paged<AuditLogRow> {
  actions: Record<string, number>;
  entityTypes: Facet[];
  actors: ActorFacet[];
  generatedAt: string;
}

export const logsApi = {
  activity: (filters: ActivityFilters) =>
    api.get<ActivityLogPage>(`/api/logs/activity?${logParams(filters)}`),
  audit: (filters: AuditFilters) =>
    api.get<AuditLogPage>(`/api/logs/audit?${logParams(filters)}`),
  /**
   * Export is a plain navigation rather than a fetch.
   *
   * The browser handles the download and the `content-disposition` filename, which
   * a fetch would have to reimplement with a blob and a synthetic anchor.
   */
  activityExportUrl: (filters: ActivityFilters) =>
    `/api/logs/activity/export?${logParams({ ...filters, page: 1, pageSize: 1 })}`,
  auditExportUrl: (filters: AuditFilters) =>
    `/api/logs/audit/export?${logParams({ ...filters, page: 1, pageSize: 1 })}`,
};

function logParams(filters: ActivityFilters | AuditFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  return params.toString();
}

// ---------------------------------------------------------------------------
// Email profiles
// ---------------------------------------------------------------------------

export type EmailEncryption = 'none' | 'tls' | 'ssl';

export interface EmailProfile {
  id: number;
  /** Selected by code, so it is fixed once created. */
  key: string;
  name: string;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  active: boolean;
  provider: string;
  host: string;
  port: number;
  encryption: EmailEncryption;
  timeoutSeconds: number;
  maxRetries: number;
  authenticate: boolean;
  username: string | null;
  /** Presence only. The stored password never leaves the server. */
  passwordSet: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestDetail: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A preset fills the host, port and encryption; the stored values stay authoritative. */
export interface EmailProvider {
  key: string;
  label: string;
  host: string;
  port: number;
  encryption: EmailEncryption;
}

export interface EmailProfilePage {
  providers: EmailProvider[];
  profiles: EmailProfile[];
}

export interface EmailProfileInput {
  key?: string;
  name: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  active: boolean;
  provider: string;
  host: string;
  port: number;
  encryption: EmailEncryption;
  timeoutSeconds: number;
  maxRetries: number;
  authenticate: boolean;
  username?: string;
  /** Omitted or blank on an edit means "keep the stored one". */
  password?: string;
}

export interface EmailTestResult {
  ok: boolean;
  recipient: string;
  elapsedMs: number;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestDetail: string | null;
}

export const emailProfilesApi = {
  list: () => api.get<EmailProfilePage>('/api/email-profiles'),
  create: (input: EmailProfileInput) => api.post<EmailProfile>('/api/email-profiles', input),
  update: (id: number, input: Partial<EmailProfileInput>) =>
    api.patch<EmailProfile>(`/api/email-profiles/${String(id)}`, input),
  remove: (id: number) => api.delete<{ ok: boolean }>(`/api/email-profiles/${String(id)}`),
  /**
   * Sends a real message.
   *
   * Answers 200 whether the relay accepted it or not — a refusal is a successful read
   * of a real answer, and the screen needs the message rather than an error status.
   */
  test: (id: number, recipient?: string) =>
    api.post<EmailTestResult>(`/api/email-profiles/${String(id)}/test`, { recipient }),
};

export const ENCRYPTION_LABELS: Record<EmailEncryption, LabelKey> = {
  none: 'encryption.none',
  tls: 'encryption.tls',
  ssl: 'encryption.ssl',
};

// ---------------------------------------------------------------------------
// Notification channels
// ---------------------------------------------------------------------------

export interface NotificationTrigger {
  key: string;
  labelKey: LabelKey;
  detailKey: LabelKey;
  /** False until the dispatch call exists at the source; the screen says so. */
  wired: boolean;
}

export interface ChannelTestResult {
  ok: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestDetail: string | null;
}

export interface SmsConfig {
  enabled: boolean;
  baseUrl: string;
  senderId: string;
  /** Presence only. The key never leaves the server. */
  apiKeySet: boolean;
  triggers: string[];
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestDetail: string | null;
}

export interface SmsSegments {
  unicode: boolean;
  length: number;
  segments: number;
}

export interface TelegramConfig {
  enabled: boolean;
  /** Read back from Telegram rather than typed, so it cannot disagree with the token. */
  botUsername: string | null;
  chatId: string;
  ownerUserId: string;
  ownerUsername: string;
  botTokenSet: boolean;
  triggers: string[];
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestDetail: string | null;
}

export interface TelegramBot {
  id: number;
  username: string | null;
  firstName: string;
}

export const channelsApi = {
  triggers: () => api.get<{ triggers: NotificationTrigger[] }>('/api/notify/triggers'),

  sms: () => api.get<SmsConfig>('/api/sms'),
  saveSms: (input: {
    enabled: boolean;
    baseUrl: string;
    senderId: string;
    /** Blank keeps the stored key. */
    apiKey?: string;
    /** Explicit, because blank has to mean "keep". */
    clearApiKey?: boolean;
    triggers: string[];
  }) => api.put<{ ok: boolean }>('/api/sms', input),
  testSms: (to: string, text: string) =>
    api.post<ChannelTestResult & { segments: SmsSegments }>('/api/sms/test', { to, text }),

  telegram: () => api.get<TelegramConfig>('/api/telegram'),
  saveTelegram: (input: {
    enabled: boolean;
    botToken?: string;
    /** Explicit, because blank has to mean "keep". */
    clearBotToken?: boolean;
    chatId: string;
    ownerUserId?: string;
    ownerUsername?: string;
    triggers: string[];
  }) => api.put<{ ok: boolean; botUsername: string | null }>('/api/telegram', input),
  /** Proves the token without posting anything. */
  verifyTelegram: () =>
    api.post<{ ok: boolean; bot?: TelegramBot; detail?: string }>('/api/telegram/verify', {}),
  /** The server composes the message unless one is supplied. */
  testTelegram: (text?: string) => api.post<ChannelTestResult>('/api/telegram/test', { text }),
};

/**
 * Billable SMS segments, computed in the browser for the live counter.
 *
 * Mirrors the server so the count does not jump on submit. A single accented character
 * drops the limit from 160 to 70 and turns one message into three, which is worth seeing
 * while typing rather than on the invoice.
 */
export function countSmsSegments(text: string): SmsSegments {
  const basic =
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
  const extended = '^{}\\[~]|€';

  let length = 0;
  for (const character of text) {
    if (extended.includes(character)) {
      length += 2;
    } else if (basic.includes(character)) {
      length += 1;
    } else {
      const count = [...text].length;
      return { unicode: true, length: count, segments: count <= 70 ? 1 : Math.ceil(count / 67) };
    }
  }

  return { unicode: false, length, segments: length <= 160 ? 1 : Math.ceil(length / 153) };
}

// ---------------------------------------------------------------------------
// Public API, webhooks and the security policy
// ---------------------------------------------------------------------------

export interface ApiEndpoint {
  method: string;
  path: string;
  /**
   * Which scope a token needs to call it.
   *
   * A literal scope name where one applies — that is a stored value, not wording. The one
   * endpoint whose requirement is a sentence carries `scopeKey` instead.
   */
  scope?: string;
  scopeKey?: LabelKey;
}

export interface ApiConfig {
  enabled: boolean;
  requireToken: boolean;
  logRequests: boolean;
  allowAllOrigins: boolean;
  allowedOrigins: string[];
  rateLimitEnabled: boolean;
  maxPerMinute: number;
  ipWhitelist: string[];
  /** Read-only, so the screen can show what a caller should point at. */
  baseUrl: string;
  endpoints: ApiEndpoint[];
  connectorMode: string;
}

export type ApiTokenStatus = 'active' | 'revoked' | 'expired' | 'grace' | 'superseded';

export interface ApiTokenRow {
  id: number;
  name: string;
  /**
   * Enough to recognise which token a log line refers to, far too little to use. There is
   * no field for the value: it exists once, in the response that created it.
   */
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  supersededAt: string | null;
  graceUntil: string | null;
  rotatedToPrefix: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  requestCount: number;
  createdAt: string;
  status: ApiTokenStatus;
  /** What this token has spent of the current minute, or null if it has been idle. */
  rateWindow: { count: number; resetAt: number } | null;
}

export interface ApiScope {
  scope: string;
  /** The screen's registry key and the bare action; the screen composes the two. */
  labelKey: LabelKey;
  action: string;
}

/** The response to creating or rotating a token. The only time the value exists here. */
export interface IssuedApiToken {
  id: number;
  prefix: string;
  expiresAt: string | null;
  graceUntil?: string;
  token: string;
}

export interface WebhookRow {
  id: number;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  /** Presence only. The signing key is shown once, at creation. */
  secretSet: boolean;
  failureCount: number;
  disabledReason: string | null;
  lastDeliveryAt: string | null;
  lastStatus: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookSignatureDoc {
  header: string;
  format: string;
  signedPayload: string;
  toleranceSeconds: number;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  attempt: number;
  ok: boolean;
  httpStatus: number | null;
  durationMs: number | null;
  error: string | null;
  responseBody: string | null;
  createdAt: string;
}

export interface WebhookTestResult {
  ok: boolean;
  attempt: number;
  httpStatus: number | null;
  error: string | null;
  durationMs: number;
}

export interface SecurityPolicy {
  maxFailedLogins: number;
  lockoutMinutes: number;
  passwordMinLength: number;
  tokenDefaultDays: number;
  rotationGraceHours: number;
}

export interface SecurityConfig {
  policy: SecurityPolicy;
  defaults: SecurityPolicy;
  /**
   * Fixed at deploy time, shown read-only. Presenting these as editable would be
   * presenting a control that silently does nothing.
   */
  environment: {
    requireAdmin2fa: boolean;
    sessionTtlHours: number;
    connectorMode: string;
    nodeEnv: string;
  };
  /** Live figures, so the screen is worth opening when nothing is being changed. */
  posture: {
    lockedAccounts: number;
    failedLoginsLastDay: number;
    activeTokens: number;
    tokensExpiringSoon: number;
    webhooksFailing: number;
  };
}

export const apiAdminApi = {
  config: () => api.get<ApiConfig>('/api/api-config'),
  saveConfig: (input: {
    enabled: boolean;
    requireToken: boolean;
    logRequests: boolean;
    allowAllOrigins: boolean;
    allowedOrigins: string[];
    rateLimitEnabled: boolean;
    maxPerMinute: number;
    ipWhitelist: string[];
  }) => api.put<{ ok: boolean }>('/api/api-config', input),

  tokens: () => api.get<{ scopes: ApiScope[]; tokens: ApiTokenRow[] }>('/api/api-tokens'),
  createToken: (input: { name: string; scopes: string[]; expiresInDays: number | null }) =>
    api.post<IssuedApiToken>('/api/api-tokens', input),
  revokeToken: (id: number) => api.post<{ ok: boolean }>(`/api/api-tokens/${String(id)}/revoke`, {}),
  /** Issues a replacement and lets the old one run out, rather than breaking every caller. */
  rotateToken: (id: number) => api.post<IssuedApiToken>(`/api/api-tokens/${String(id)}/rotate`, {}),
  deleteToken: (id: number) => api.delete<{ ok: boolean }>(`/api/api-tokens/${String(id)}`),

  webhooks: () =>
    api.get<{
      triggers: NotificationTrigger[];
      signature: WebhookSignatureDoc;
      webhooks: WebhookRow[];
    }>('/api/webhooks'),
  createWebhook: (input: { name: string; url: string; events: string[]; active: boolean }) =>
    api.post<{ id: number; secret: string }>('/api/webhooks', input),
  updateWebhook: (
    id: number,
    input: { name?: string; url?: string; events?: string[]; active?: boolean },
  ) => api.patch<{ ok: boolean }>(`/api/webhooks/${String(id)}`, input),
  /** The old key stops working immediately, which is stated on the screen. */
  regenerateWebhookSecret: (id: number) =>
    api.post<{ secret: string }>(`/api/webhooks/${String(id)}/regenerate-secret`, {}),
  deleteWebhook: (id: number) => api.delete<{ ok: boolean }>(`/api/webhooks/${String(id)}`),
  /** Sends a real signed request, so the receiver can be checked end to end. */
  testWebhook: (id: number) =>
    api.post<WebhookTestResult>(`/api/webhooks/${String(id)}/test`, {}),
  deliveries: (id: number, limit = 25) =>
    api.get<{ deliveries: WebhookDelivery[] }>(
      `/api/webhooks/${String(id)}/deliveries?limit=${String(limit)}`,
    ),

  security: () => api.get<SecurityConfig>('/api/security-config'),
  saveSecurity: (input: SecurityPolicy) => api.put<{ ok: boolean }>('/api/security-config', input),
};

// ---------------------------------------------------------------------------
// Own profile
// ---------------------------------------------------------------------------

/** The fields a person owns. Nothing downstream computes against these. */
export interface ProfileEditable {
  phone: string;
  position: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  /** Personal contact address, separate from the login. */
  contactEmail: string;
}

/**
 * The fields the organisation owns.
 *
 * Shown so a person can check them and report a mistake, not edited here. The employee
 * number is the join key to every terminal and every attendance row; the department drives
 * payroll subtotals.
 */
export interface ProfileManaged {
  employeeNo: string;
  fullName: string;
  icNo: string | null;
  department: string | null;
  location: string | null;
  hireDate: string | null;
  /** Own monthly wage. Readable without the `salary` grant because the subject is the caller. */
  basicSalary: number | null;
  loginEmail: string;
  accountType: string;
  roleName: string;
  lastLoginAt: string | null;
  twoFactorEnabled: boolean;
  /** Terminal credential counts. Not the avatar. */
  biometrics: { face: number; fingerprint: number; card: number };
}

/**
 * The interface language this person reads, and what they may choose from.
 *
 * Separate from `editable` because it is stored on the account rather than the staff row,
 * and because the options have to travel with it — the language list endpoint is gated on
 * the translation permission, which almost nobody holds.
 */
export interface ProfileLanguage {
  /** The stored code, or `''` for "follow the deployment default". */
  chosen: string;
  /** What the default currently resolves to, so the fallback option can name it. */
  fallback: { code: string; name: string } | null;
  /** Active languages only. An unfinished one would render half a screen in Malay. */
  options: { code: string; name: string; isSource: boolean }[];
}

export interface ProfilePayload {
  editable: ProfileEditable;
  managed: ProfileManaged;
  photo: { set: boolean; url: string | null; bytes: number | null };
  language: ProfileLanguage;
  limits: { maxPhotoBytes: number; passwordMinLength: number };
}

export const profileApi = {
  load: () => api.get<ProfilePayload>('/api/profile'),
  /**
   * `locale` rides along with the owned fields.
   *
   * One save for the whole screen, so picking a language cannot discard an address edit
   * that has not been saved yet — which is what an apply-immediately control would do,
   * because it has to re-read the payload to pick up the new wording.
   */
  save: (input: ProfileEditable & { locale: string }) =>
    api.put<{ ok: boolean }>('/api/profile', input),

  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    api.post<{ ok: boolean; note: string }>('/api/profile/password', input),

  uploadPhoto: async (file: File) => {
    const form = new FormData();
    form.append('file', file);

    const response = await fetch('/api/profile/photo', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail =
        payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      throw new Error(typeof detail['error'] === 'string' ? detail['error'] : 'Muat naik gagal');
    }
    return payload as { url: string; bytes: number; format: string };
  },

  removePhoto: () => api.delete<{ ok: boolean }>('/api/profile/photo'),
};

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export interface Alert {
  id: string;
  tone: 'danger' | 'warn' | 'info';
  title: string;
  detail: string;
  count: number;
  to: string;
}

export interface AlertsPayload {
  alerts: Alert[];
  /** Conditions, not rows: five offline terminals is one thing to go and deal with. */
  total: number;
  worst: 'danger' | 'warn' | 'info' | null;
  generatedAt: string;
}

export const alertsApi = {
  load: () => api.get<AlertsPayload>('/api/alerts'),
};

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

export interface TranslationLocale {
  code: string;
  name: string;
  /** The language the interface is written in. Cannot be edited, disabled or removed. */
  isSource: boolean;
  active: boolean;
  /** The language the interface opens in. Exactly one at a time. */
  isDefault: boolean;
  translated: number;
  createdAt: string;
}

export interface TranslationLocalesPayload {
  /** Total labels a language has to cover. */
  labelCount: number;
  locales: TranslationLocale[];
}

export interface TranslationLabel {
  /** The number an operator can write down and quote. Assigned once, never reused. */
  id: number;
  key: string;
  groupKey: string;
  /** The Malay wording from the source, shown on the left of every row. */
  sourceText: string;
  context: string | null;
  /** Empty means not translated; the source is used. */
  text: string;
}

export interface TranslationLabelsPayload {
  locale: { code: string; name: string; isSource: boolean; active: boolean; isDefault: boolean };
  groups: Record<string, string>;
  labels: TranslationLabel[];
}

export const translationApi = {
  locales: () => api.get<TranslationLocalesPayload>('/api/translations'),
  addLocale: (input: { code: string; name: string }) =>
    api.post<{ code: string; name: string }>('/api/translations/locales', input),
  /** `isDefault` is only ever `true`: clearing it would leave no default at all. */
  updateLocale: (code: string, input: { name?: string; active?: boolean; isDefault?: true }) =>
    api.patch<{ ok: boolean }>(`/api/translations/locales/${code}`, input),
  removeLocale: (code: string) =>
    api.delete<{ ok: boolean; removed: number }>(`/api/translations/locales/${code}`),

  labels: (code: string) => api.get<TranslationLabelsPayload>(`/api/translations/${code}/labels`),
  saveLabels: (code: string, values: Array<{ id: number; text: string }>) =>
    api.put<{ ok: boolean; written: number; cleared: number }>(
      `/api/translations/${code}/labels`,
      { values },
    ),
};
