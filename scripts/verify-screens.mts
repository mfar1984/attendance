/**
 * Verifies every screen's data dependencies against the running server.
 *
 * A typecheck proves the pages compile; it does not prove the endpoints they call
 * exist, return the shape the columns read, or carry the counts the chips render.
 * This walks the twenty screens and asserts the fields each one actually renders.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-screens.mts <password>
 */
import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-screens.mts <adminPassword>');
  process.exit(2);
}

let cookie = '';
let failures = 0;

await call('POST', '/api/auth/login', {
  email,
  password,
  ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
});
check('logged in', cookie.length > 0);

/** Asserts a response arrived and carries every field the screen reads. */
async function screen(
  label: string,
  path: string,
  fields: string[],
  pick: (body: Record<string, unknown>) => Record<string, unknown> | undefined = (body) => body,
): Promise<Record<string, unknown>> {
  const response = await call('GET', path);
  check(`${label} responds`, response.status === 200);
  if (response.status !== 200) {
    show('error', String(response.body['error'] ?? response.status));
    return {};
  }

  const target = pick(response.body);
  if (target === undefined) {
    // An empty table is a valid state; the columns simply cannot be checked from it.
    show(`${label} shape`, 'tiada baris untuk disemak');
    return response.body;
  }

  const missing = fields.filter((field) => !(field in target));
  check(`${label} carries every field its columns read`, missing.length === 0);
  if (missing.length > 0) show('missing', missing.join(', '));
  return response.body;
}

const firstRow = (body: Record<string, unknown>): Record<string, unknown> | undefined =>
  (body['rows'] as Array<Record<string, unknown>> | undefined)?.[0];

const firstItem = (body: Record<string, unknown>): Record<string, unknown> | undefined =>
  (body as unknown as Array<Record<string, unknown>>)[0];

// ---------------------------------------------------------------------------
console.log('\n=== Dashboard & Kehadiran ===');
// ---------------------------------------------------------------------------

const dashboard = await screen(
  'Dashboard',
  '/api/dashboard',
  ['today', 'recentScans', 'exceptions', 'devices', 'driftThresholdSeconds', 'connectorMode'],
);
const today = dashboard['today'] as Record<string, unknown> | undefined;
check(
  'the dashboard tiles have their figures',
  today !== undefined &&
    ['present', 'late', 'absent', 'onLeave', 'missingBiometrics', 'staffTotal'].every(
      (key) => key in today,
    ),
);

await screen(
  'Rekod Kehadiran',
  '/api/attendance/records?page=1&pageSize=5',
  [
    'workDate',
    'status',
    'checkInAt',
    'checkOutAt',
    'lateMinutes',
    'workedMinutes',
    'overtimeMinutes',
    'earlyLeaveMinutes',
    'origin',
    'calculatedAt',
    'staff',
    'shift',
    'blocks',
  ],
  firstRow,
);

const records = await call('GET', '/api/attendance/records?page=1&pageSize=1');
check('and the status chips have their counts', 'byStatus' in records.body);
show('byStatus', JSON.stringify(records.body['byStatus']));

await screen(
  'Log Scan Mentah',
  '/api/raw-events?page=1&pageSize=5',
  [
    'serialNo',
    'major',
    'minor',
    'eventTime',
    'receivedAt',
    'employeeNo',
    'personName',
    'verifyMode',
    'cardNo',
    'doorNo',
    'maskWorn',
    'pictureUrl',
    'arrivedVia',
    'deviceDriftS',
    'device',
    'punch',
  ],
  firstRow,
);

const exceptions = await screen(
  'Pengecualian',
  '/api/exceptions?page=1&pageSize=5',
  ['kind', 'detail', 'occurredAt', 'workDate', 'staff', 'deviceName', 'rawEventId', 'resolvedAt'],
  firstRow,
);
check('and the kind chips have their counts', 'openByKind' in exceptions);
show('openByKind', JSON.stringify(exceptions['openByKind']));

// ---------------------------------------------------------------------------
console.log('\n=== Staf ===');
// ---------------------------------------------------------------------------

await screen(
  'Direktori Staf',
  '/api/staff?page=1&pageSize=5',
  [
    'employeeNo',
    'fullName',
    'active',
    'numOfFace',
    'numOfFp',
    'numOfCard',
    'department',
    'location',
    'account',
  ],
  firstRow,
);

const missing = await call('GET', '/api/staff?page=1&pageSize=1&missingBiometrics=true');
check('the biometrics chip filter works', missing.status === 200);
show('tiada biometrik', String(missing.body['total']));

await screen('Pemetaan: belum dipetakan', '/api/identity/unmapped', [
  'deviceEmployeeNo',
  'deviceName',
  'numOfFace',
  'numOfFp',
  'numOfCard',
  'scanCount',
  'firstSeenAt',
  'lastSeenAt',
  'device',
], firstItem);

await screen('Pemetaan: belum disahkan', '/api/identity/unconfirmed', [
  'deviceEmployeeNo',
  'confirmed',
  'device',
  'staff',
], firstItem);

await screen('Jabatan', '/api/departments', [
  'name',
  'code',
  'parentId',
  'parent',
  'staffCount',
  'childCount',
], firstItem);

await screen('Lokasi', '/api/locations', [
  'name',
  'address',
  'latitude',
  'longitude',
  'geofenceRadiusM',
  'staffCount',
  'deviceCount',
], firstItem);

const template = await call('GET', '/api/staff/import/template');
check('Import Pukal template downloads', template.status === 200);

// ---------------------------------------------------------------------------
console.log('\n=== Jadual ===');
// ---------------------------------------------------------------------------

await screen('Pola Waktu Kerja', '/api/work-patterns', [
  'name',
  'kind',
  'active',
  'timeBlocks',
  'staffCount',
  'shiftCount',
  'dailyMinutes',
], firstItem);

await screen('Shift', '/api/shifts', [
  'code',
  'name',
  'colour',
  'active',
  'workPattern',
  'rosterCount',
], firstItem);

const now = new Date();
const pad = (value: number): string => String(value).padStart(2, '0');
const monthStart = `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-01`;
const monthEnd = `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(
  new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
)}`;

// The grid asks for an explicit day range rather than a year and month: the roster
// query is a date window, and a month number would have to be widened server-side.
const roster = await call(
  'GET',
  `/api/roster?from=${monthStart}&to=${monthEnd}&page=1&pageSize=5`,
);
check('Kalendar Kerja responds', roster.status === 200);
const rosterRow = (roster.body['rows'] as Array<Record<string, unknown>> | undefined)?.[0];
check(
  'and its grid rows carry rosters',
  rosterRow === undefined || ('rosters' in rosterRow && 'employeeNo' in rosterRow),
);

await screen(
  'Cuti Umum',
  `/api/holidays?year=${String(now.getFullYear())}`,
  ['name', 'date', 'stateCode', 'companyDeclared'],
  firstRow,
);

await screen(
  'Permohonan Cuti: jenis',
  '/api/leave-types',
  [
    'code',
    'name',
    'annualDays',
    'paid',
    'allowBackdated',
    'requiresApproval',
    'colour',
    'active',
    'requestCount',
  ],
  firstItem,
);

const leaveRequests = await screen(
  'Permohonan Cuti: permohonan',
  '/api/leave-requests?page=1&pageSize=5',
  [
    'fromDate',
    'toDate',
    'days',
    'reason',
    'status',
    'decidedBy',
    'decidedAt',
    'decisionNote',
    'replacedRoster',
    'createdAt',
    'leaveType',
    'staff',
  ],
  firstRow,
);
check('and the status chips have their counts', 'statuses' in leaveRequests);
check('and the leave-type filter has its facets', 'types' in leaveRequests);

// ---------------------------------------------------------------------------
console.log('\n=== Laporan ===');
// ---------------------------------------------------------------------------

const monthly = await screen(
  'Ringkasan Bulanan',
  `/api/reports/monthly?from=${monthStart}&to=${monthEnd}&page=1&pageSize=5`,
  [
    'staff',
    'scheduledDays',
    'presentDays',
    'lateDays',
    'absentDays',
    'leaveDays',
    'restDays',
    'holidayDays',
    'incompleteDays',
    'workedMinutes',
    'lateMinutes',
    'earlyLeaveMinutes',
    'overtimeMinutes',
    'openExceptions',
  ],
  firstRow,
);
check(
  'and the summary tiles have their organisation totals',
  'organisation' in monthly && 'byDepartment' in monthly && 'unresolvedExceptions' in monthly,
);
check('and the period is echoed back', 'period' in monthly);
show('organisation', JSON.stringify(monthly['organisation']));

const monthlyCsv = await call(
  'GET',
  `/api/reports/monthly/export?from=${monthStart}&to=${monthEnd}`,
);
check('Ringkasan Bulanan exports CSV', monthlyCsv.status === 200);

const payroll = await screen(
  'Export Payroll',
  `/api/reports/payroll/preview?from=${monthStart}&to=${monthEnd}`,
  [
    'period',
    'staffCount',
    'organisation',
    'unresolvedExceptions',
    'blockers',
    'safeToExport',
    'timeZone',
    'generatedAt',
  ],
);
check('and the blockers are a list, not a boolean', Array.isArray(payroll['blockers']));
show('safeToExport', String(payroll['safeToExport']));
show('blockers', JSON.stringify(payroll['blockers']));

const payrollCsv = await call('GET', `/api/reports/payroll/export?from=${monthStart}&to=${monthEnd}`);
check('Export Payroll downloads', payrollCsv.status === 200);

const fields = await screen('Penjana Laporan: medan', '/api/reports/fields', ['datasets']);
const datasets = fields['datasets'] as Array<Record<string, unknown>> | undefined;
check(
  'and every dataset carries its columns and grouping options',
  datasets !== undefined &&
    datasets.length === 3 &&
    datasets.every(
      (entry) =>
        Array.isArray(entry['fields']) &&
        Array.isArray(entry['groupBy']) &&
        typeof entry['labelKey'] === 'string' &&
        typeof entry['noteKey'] === 'string',
    ),
);

// Registry keys, not words. The catalogue describes a column picker somebody reads, so the
// wording resolves per reader — a route that answered with Malay prose here would fix the
// language of the report builder for everyone.
check(
  'and it describes them with registry keys rather than resolved wording',
  datasets !== undefined &&
    datasets.every(
      (entry) =>
        entry['label'] === undefined &&
        entry['note'] === undefined &&
        (entry['fields'] as Array<Record<string, unknown>>).every(
          (field) => typeof field['labelKey'] === 'string' && field['label'] === undefined,
        ),
    ),
);

const builder = await call('POST', '/api/reports/run', {
  dataset: 'attendance',
  from: monthStart,
  to: monthEnd,
  columns: ['workDate', 'employeeNo', 'fullName', 'status', 'workedMinutes'],
  groupBy: 'none',
  limit: 25,
});
check('Penjana Laporan runs', builder.status === 200);
check(
  'and its result carries the columns the table renders',
  'columns' in builder.body && 'rows' in builder.body && 'truncated' in builder.body,
);
show('baris', String((builder.body['rows'] as unknown[] | undefined)?.length ?? 0));

// ---------------------------------------------------------------------------
console.log('\n=== Tetapan ===');
// ---------------------------------------------------------------------------

await screen('Senarai Peranti', '/api/devices', [
  'name',
  'host',
  'port',
  'useHttps',
  // The edit form prefills from these. A `select` that stops returning them leaves the
  // dialog quietly blanking fields it then saves.
  'verifyTls',
  'username',
  'doorNo',
  'locationId',
  'model',
  'firmware',
  'serialNumber',
  'macAddress',
  'status',
  'clockDriftS',
  'clockMode',
  'faceCapacity',
  'enrolled',
  'lastSeenAt',
  'lastError',
  'location',
  'syncState',
], firstItem);

await screen('Kesihatan peranti', '/api/devices/health', [
  'deviceId',
  'status',
  'clockDriftSeconds',
  'clockMode',
  'warnings',
], firstItem);

await screen('Mod sambungan (ingest)', '/api/ingest/stats', [
  'heartbeats',
  'events',
  'rejected',
  'undecodable',
  'lastContactAt',
  'pushedEvents',
  'pulledEvents',
  'ingestPath',
  'authMethod',
]);

const config = await screen('Konfigurasi Umum', '/api/settings', [
  'values',
  'environment',
  'editableKeys',
  // Presence and a cache-busted URL for each slot. The path on disk stays server-side.
  'branding',
]);
const brandingSlots = config['branding'] as Record<string, Record<string, unknown>> | undefined;
check(
  'the branding slots carry presence, URL and size',
  brandingSlots !== undefined &&
    ['logo', 'favicon'].every((slot) =>
      ['set', 'url', 'bytes'].every((field) => field in (brandingSlots[slot] ?? {})),
    ),
);
const configEnv = config['environment'] as Record<string, unknown> | undefined;
check('and the environment states the upload ceiling', configEnv?.['maxUploadBytes'] !== undefined);

await screen('Backup', '/api/backup', [
  'directory',
  'files',
  'toolAvailable',
  'restoreHint',
  // Added with the scheduler: the screen edits these and shows the total on disk.
  'policy',
  'totalBytes',
]);

await screen('Maintenance (kesihatan sistem)', '/api/maintenance/health', [
  'database',
  'storage',
  'maintenanceMode',
  'backup',
  'email',
  'logs',
  'branding',
  'process',
]);

await screen('Maintenance (simpanan)', '/api/retention', [
  'policy',
  'minimumRawEventMonths',
  'rawCutoff',
  'rawEventsDue',
  'totalRawEvents',
  'punchesAffected',
]);

await screen('Pengurusan Peranan', '/api/roles', [
  'name',
  'description',
  'permissions',
  'systemRole',
  'status',
  'accountCount',
  'permissionCount',
  'permissionTotal',
  'createdAt',
], firstItem);

await screen('Matrix kebenaran', '/api/roles/matrix', [
  'sections',
  'standardActions',
  'actionLabels',
  'total',
]);

await screen('Pengurusan Pengguna: kiraan tab', '/api/users/counts', ['admin', 'staff', 'apps']);

const users = await screen(
  'Pengurusan Pengguna: Administrator',
  '/api/users?accountType=admin&page=1&pageSize=5',
  [
    'email',
    'accountType',
    'status',
    'allowAppCheckIn',
    'boundDeviceId',
    'boundDeviceAt',
    'lastLoginAt',
    'lockedUntil',
    'failedLoginCount',
    'createdAt',
    'twoFactorEnabled',
    'role',
    'staff',
  ],
  firstRow,
);
check('and the status chips have their counts', 'statuses' in users);
show('statuses', JSON.stringify(users['statuses']));

await screen('Pengurusan Pengguna: Apps', '/api/app-clients', [
  'name',
  'platform',
  'clientId',
  'minVersion',
  'status',
  'createdAt',
  'updatedAt',
], firstItem);

const activity = await screen(
  'Log Aktiviti',
  '/api/logs/activity?page=1&pageSize=5',
  ['level', 'category', 'source', 'action', 'detail', 'path', 'ipAddress', 'actorLabel', 'createdAt'],
  firstRow,
);
check('and the severity chips have their counts', 'levels' in activity);
check('and the category filter has its facets', 'categories' in activity);
check('and the user filter has its facets', 'actors' in activity);
show('levels', JSON.stringify(activity['levels']));

const audit = await screen(
  'Log Audit',
  '/api/logs/audit?page=1&pageSize=5',
  ['action', 'entityType', 'entityId', 'changes', 'reason', 'actorLabel', 'ipAddress', 'createdAt'],
  firstRow,
);
check('and the action chips have their counts', 'actions' in audit);
check('and the record-type filter has its facets', 'entityTypes' in audit);

await screen('Integrasi', '/api/settings', ['values', 'environment']);

await screen('Integrasi: API & Webhook', '/api/api-config', [
  'enabled',
  'requireToken',
  'logRequests',
  'allowAllOrigins',
  'allowedOrigins',
  'rateLimitEnabled',
  'maxPerMinute',
  'ipWhitelist',
  // Read-only, rendered as the endpoint list and the connector-mode note.
  'baseUrl',
  'endpoints',
  'connectorMode',
]);

/**
 * A row to check the shape against.
 *
 * Both lists are usually empty on a fresh install, and an empty list would let this file
 * report a passing shape check it never ran. Created here and removed at the end.
 */
const fixtures: { tokenId: number | null; webhookId: number | null } = {
  tokenId: null,
  webhookId: null,
};

if (((await call('GET', '/api/api-tokens')).body['tokens'] as unknown[] | undefined)?.length === 0) {
  const made = await call('POST', '/api/api-tokens', {
    name: 'Fikstur verify-screens',
    scopes: ['staff.directory:view'],
    expiresInDays: 1,
  });
  if (made.status === 200) fixtures.tokenId = Number(made.body['id']);
}

if (((await call('GET', '/api/webhooks')).body['webhooks'] as unknown[] | undefined)?.length === 0) {
  const made = await call('POST', '/api/webhooks', {
    name: 'Fikstur verify-screens',
    // Loopback discard port: private, so http is allowed, and nothing is delivered here.
    url: 'http://127.0.0.1:9/fikstur',
    events: ['leave.approved'],
    active: false,
  });
  if (made.status === 200) fixtures.webhookId = Number(made.body['id']);
}

const tokens = await screen(
  'Integrasi: Token API',
  '/api/api-tokens',
  [
    'name',
    'prefix',
    'scopes',
    'expiresAt',
    'revokedAt',
    'supersededAt',
    'graceUntil',
    'rotatedToPrefix',
    'lastUsedAt',
    'lastUsedIp',
    'requestCount',
    'createdAt',
    'status',
    'rateWindow',
  ],
  (body) => (body['tokens'] as Array<Record<string, unknown>> | undefined)?.[0],
);
check('and the scope picker has its options', Array.isArray(tokens['scopes']));

const webhooks = await screen(
  'Integrasi: Webhook',
  '/api/webhooks',
  [
    'name',
    'url',
    'events',
    'active',
    'secretSet',
    'failureCount',
    'disabledReason',
    'lastDeliveryAt',
    'lastStatus',
    'createdAt',
    'updatedAt',
  ],
  (body) => (body['webhooks'] as Array<Record<string, unknown>> | undefined)?.[0],
);
check('and the event picker has its triggers', Array.isArray(webhooks['triggers']));
check('and the signature panel has its scheme', typeof webhooks['signature'] === 'object');

const security = await screen('Integrasi: Keselamatan', '/api/security-config', [
  'policy',
  'defaults',
  'environment',
  'posture',
]);
const policy = security['policy'] as Record<string, unknown> | undefined;
check(
  'the policy knobs the screen edits are all present',
  policy !== undefined &&
    [
      'maxFailedLogins',
      'lockoutMinutes',
      'passwordMinLength',
      'tokenDefaultDays',
      'rotationGraceHours',
    ].every((key) => key in policy),
);
const posture = security['posture'] as Record<string, unknown> | undefined;
check(
  'and the posture tiles have their figures',
  posture !== undefined &&
    [
      'lockedAccounts',
      'failedLoginsLastDay',
      'activeTokens',
      'tokensExpiringSoon',
      'webhooksFailing',
    ].every((key) => key in posture),
);
show('posture', JSON.stringify(posture));

await screen('Lookups (penapis kongsi)', '/api/lookups', [
  'devices',
  'departments',
  'locations',
  'shifts',
  'timeZone',
]);

// ---------------------------------------------------------------------------
console.log('\n=== Secrets stay server-side ===');
// ---------------------------------------------------------------------------

// Every screen above reads through these endpoints, so one pass over their bodies
// catches a leak introduced by adding a field to a select.
for (const path of [
  '/api/devices',
  '/api/staff?page=1&pageSize=5',
  '/api/users?accountType=admin',
  '/api/app-clients',
  '/api/settings',
  '/api/roles',
  // The two newest surfaces. An API token and a webhook signing key are the credentials
  // most worth stealing here, because both grant access without a person attached.
  '/api/api-tokens',
  '/api/webhooks',
]) {
  const response = await call('GET', path);
  const body = JSON.stringify(response.body).toLowerCase();
  const leaks = [
    'passwordhash',
    'totpsecret',
    'secrethash',
    'doorpinencrypted',
    'passwordenc',
    'tokenhash',
    'secretencrypted',
  ].filter((needle) => body.includes(needle));
  check(`${path} exposes no credential field`, leaks.length === 0);
  if (leaks.length > 0) show('leaked', leaks.join(', '));
}

// A prefix is not a credential, and the screens need it to name a token. Asserted so the
// check above cannot be satisfied by removing the identifier along with the secret.
const identifiable = await call('GET', '/api/api-tokens');
check(
  'but a token can still be identified by its prefix',
  JSON.stringify(identifiable.body).includes('hka_') ||
    ((identifiable.body['tokens'] as unknown[] | undefined)?.length ?? 0) === 0,
);

if (fixtures.tokenId !== null) {
  await call('POST', `/api/api-tokens/${String(fixtures.tokenId)}/revoke`);
  const gone = await call('DELETE', `/api/api-tokens/${String(fixtures.tokenId)}`);
  check('the token fixture is removed', gone.status === 200);
}
if (fixtures.webhookId !== null) {
  const gone = await call('DELETE', `/api/webhooks/${String(fixtures.webhookId)}`);
  check('the webhook fixture is removed', gone.status === 200);
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  for (const entry of response.headers.getSetCookie()) {
    const pair = entry.split(';')[0];
    if (pair?.startsWith('attendance_session=')) cookie = pair;
  }

  const text = await response.text();
  try {
    return { status: response.status, body: (JSON.parse(text) ?? {}) as Record<string, unknown> };
  } catch {
    return { status: response.status, body: { raw: text.slice(0, 200) } };
  }
}

function show(label: string, value: string): void {
  console.log(`         ${label}: ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
