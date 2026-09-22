/**
 * Verifies settings, roles, accounts, app clients, logs and backup.
 *
 * The checks are written around the guards rather than the happy path: what this
 * has to prove is that the device log cannot be made writable, that an
 * administrator cannot lock everybody out, that one person cannot hold two logins,
 * and that a stored secret never comes back over the wire.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-settings.mts <password>
 */
import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-settings.mts <adminPassword>');
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

const session = await call('GET', '/api/auth/me');
const selfAccountId = Number(
  (session.body['user'] as Record<string, unknown> | undefined)?.['accountId'],
);
show('own accountId', String(selfAccountId));

// ---------------------------------------------------------------------------
console.log('\n=== Settings ===');
// ---------------------------------------------------------------------------

const settings = await call('GET', '/api/settings');
check('settings load', settings.status === 200);
const environment = settings.body['environment'] as Record<string, unknown>;
show('connectorMode', String(environment['connectorMode']));
show('timezone', String(environment['timezone']));
show('requireAdmin2fa', String(environment['requireAdmin2fa']));
show('editable keys', String((settings.body['editableKeys'] as unknown[]).length));

const saved = await call('PUT', '/api/settings', {
  values: { 'organisation.name': 'Hospital Sibu', 'attendance.dedupWindowSeconds': 60 },
});
check('a known key can be saved', saved.status === 200);

const unknownKey = await call('PUT', '/api/settings', {
  values: { 'organisation.somethingElse': 'x' },
});
check('an unknown key is refused', unknownKey.status === 409);
show('message', String(unknownKey.body['error']));

// A secret written here must not be readable back. If it is, an admin session is
// all that stands between an attacker and the hospital's SMTP credentials.
await call('PUT', '/api/settings', {
  values: { 'integration.emailPassword': 'sekret-smtp-ujian-123' },
});
const afterSecret = await call('GET', '/api/settings');
const values = afterSecret.body['values'] as Record<string, unknown>;
const secretValue = values['integration.emailPassword'];
check(
  'a stored secret is never returned',
  typeof secretValue === 'object' &&
    secretValue !== null &&
    (secretValue as Record<string, unknown>)['configured'] === true,
);
show('as reported', JSON.stringify(secretValue));
check(
  'the plaintext does not appear anywhere in the response',
  !JSON.stringify(afterSecret.body).includes('sekret-smtp-ujian-123'),
);

// Saving the form without retyping the password must not wipe it.
await call('PUT', '/api/settings', { values: { 'integration.emailPassword': '' } });
const stillSet = await call('GET', '/api/settings');
const kept = (stillSet.body['values'] as Record<string, unknown>)['integration.emailPassword'];
check(
  'an empty secret leaves the stored value alone',
  typeof kept === 'object' && kept !== null,
);

const decryptable = await call('GET', '/api/settings/secret/integration.emailPassword');
check('the stored secret decrypts', decryptable.body['decryptable'] === true);
check(
  'even the diagnostic route withholds the value',
  !JSON.stringify(decryptable.body).includes('sekret-smtp-ujian-123'),
);

const notSecret = await call('GET', '/api/settings/secret/organisation.name');
check('a non-secret key is refused by the secret route', notSecret.status === 404);

// ---------------------------------------------------------------------------
console.log('\n=== Permission matrix ===');
// ---------------------------------------------------------------------------

const matrix = await call('GET', '/api/roles/matrix');
check('matrix loads', matrix.status === 200);

const sections = matrix.body['sections'] as Array<Record<string, unknown>>;
const screens = sections.flatMap(
  (section) => section['screens'] as Array<Record<string, unknown>>,
);
show('sections', String(sections.length));
show('screens', String(screens.length));
show('total checkboxes', String(matrix.body['total']));
show('standard columns', (matrix.body['standardActions'] as string[]).join(', '));

for (const section of sections) {
  const rows = section['screens'] as Array<Record<string, unknown>>;
  show(`  ${String(section['label'])}`, `${rows.length} skrin`);
}

// The count in the header has to equal the number of boxes actually rendered,
// otherwise "319 of 514" is describing a denominator nobody can reach.
const counted = screens.reduce((running, screen) => {
  const standard = (screen['actions'] as string[]).length;
  const custom = ((screen['custom'] as unknown[] | undefined) ?? []).length;
  return running + standard + custom;
}, 0);
check('the reported total equals the sum of every row', counted === Number(matrix.body['total']));

const rawLog = screens.find((screen) => screen['key'] === 'attendance.rawLog');
check('the raw device log is a screen in the matrix', rawLog !== undefined);
check(
  'the raw device log offers view only as a standard action',
  JSON.stringify(rawLog?.['actions']) === JSON.stringify(['view']),
);
check(
  'its only custom action is export, which is a read',
  JSON.stringify(((rawLog?.['custom'] as Array<Record<string, unknown>>) ?? []).map((a) => a['id'])) ===
    JSON.stringify(['export']),
);
show('note', String(rawLog?.['note']));

const auditScreen = screens.find((screen) => screen['key'] === 'settings.logs.audit');
check(
  'the audit log is also view and export only',
  JSON.stringify(auditScreen?.['actions']) === JSON.stringify(['view']),
);

// Every screen that supports anything at all must support view, or the grant is
// unusable by design.
const viewless = screens.filter(
  (screen) => !(screen['actions'] as string[]).includes('view'),
);
check('every screen supports view', viewless.length === 0);
if (viewless.length > 0) show('offenders', viewless.map((s) => String(s['key'])).join(', '));

// ---------------------------------------------------------------------------
console.log('\n=== Roles ===');
// ---------------------------------------------------------------------------

const roles = await call('GET', '/api/roles');
check('roles load', roles.status === 200);
const roleList = roles.body as unknown as Array<Record<string, unknown>>;
for (const role of roleList) {
  show(
    `  ${String(role['name'])}`,
    `sistem=${String(role['systemRole'])} status=${String(role['status'])} ` +
      `akaun=${String(role['accountCount'])} kebenaran=${String(role['permissionCount'])}/${String(role['permissionTotal'])}`,
  );
}

const superAdmin = roleList.find((role) => role['name'] === 'Super Admin');
check('Super Admin exists', superAdmin !== undefined);
check(
  'Super Admin holds every permission in the registry',
  Number(superAdmin?.['permissionCount']) === Number(matrix.body['total']),
);

const kerani = roleList.find((role) => role['name'] === 'Kerani');
check(
  'a read-only role holds meaningfully fewer',
  Number(kerani?.['permissionCount']) < Number(matrix.body['total']) / 2,
);

const stamp = Date.now().toString().slice(-6);
const roleName = `Ujian Kerani ${stamp}`;
const newRole = await call('POST', '/api/roles', {
  name: roleName,
  description: 'Peranan ujian',
  permissions: {
    dashboard: ['view'],
    'attendance.records': ['view', 'export'],
    'attendance.rawLog': ['view'],
    'staff.directory': ['view'],
  },
});
check('a role can be created with per-screen keys', newRole.status === 200);
const roleId = Number(newRole.body['id']);
show('granted', String(newRole.body['permissionCount']));

const duplicateRole = await call('POST', '/api/roles', {
  name: roleName,
  permissions: { dashboard: ['view'] },
});
check('a duplicate role name is refused', duplicateRole.status === 409);

// The central guard: no role, by any route, may be granted write access to the
// device log or the audit trail.
for (const screen of ['attendance.rawLog', 'settings.logs.audit']) {
  for (const action of ['create', 'edit', 'delete']) {
    const attempt = await call('PATCH', `/api/roles/${roleId}`, {
      permissions: { [screen]: ['view', action] },
    });
    check(`${screen}:${action} is refused`, attempt.status === 409);
  }
}
const onCreate = await call('POST', '/api/roles', {
  name: `Ujian Tulis ${stamp}`,
  permissions: { 'attendance.rawLog': ['view', 'edit'] },
});
check('a write to the device log is refused at creation too', onCreate.status === 409);
show('message', String(onCreate.body['error']));

const readsOk = await call('PATCH', `/api/roles/${roleId}`, {
  permissions: { 'attendance.rawLog': ['view', 'export'] },
});
check('view and export on the device log are accepted', readsOk.status === 200);

// Registry validation. A grant the matrix never renders must not be storable.
const unknownScreen = await call('PATCH', `/api/roles/${roleId}`, {
  permissions: { 'staff.rekaan': ['view'] },
});
check('an unknown screen key is refused', unknownScreen.status === 409);
show('message', String(unknownScreen.body['error']));

const unsupportedAction = await call('PATCH', `/api/roles/${roleId}`, {
  permissions: { dashboard: ['view', 'delete'] },
});
check('an action the screen does not support is refused', unsupportedAction.status === 409);
show('message', String(unsupportedAction.body['error']));

const writeWithoutView = await call('PATCH', `/api/roles/${roleId}`, {
  permissions: { 'staff.directory': ['edit'] },
});
check('a write grant without view is refused', writeWithoutView.status === 409);
show('message', String(writeWithoutView.body['error']));

// Empty rows must not be stored, or the granted count starts describing screens
// the role cannot touch.
await call('PATCH', `/api/roles/${roleId}`, {
  permissions: { dashboard: ['view'], 'staff.directory': [], 'staff.locations': [] },
});
const pruned = (await call('GET', '/api/roles')).body as unknown as Array<
  Record<string, unknown>
>;
const prunedRole = pruned.find((row) => Number(row['id']) === roleId);
check(
  'empty rows are dropped rather than stored',
  Object.keys((prunedRole?.['permissions'] ?? {}) as Record<string, unknown>).length === 1,
);
check('the granted count follows', Number(prunedRole?.['permissionCount']) === 1);

const statusChange = await call('PATCH', `/api/roles/${roleId}`, { status: 'inactive' });
check('a custom role can be deactivated', statusChange.status === 200);
await call('PATCH', `/api/roles/${roleId}`, { status: 'active' });

// ---------------------------------------------------------------------------
console.log('\n=== Super Admin self-protection ===');
// ---------------------------------------------------------------------------

if (superAdmin) {
  const superId = Number(superAdmin['id']);
  const current = superAdmin['permissions'] as Record<string, string[]>;

  // This is the role the caller is signed in with, so removing its ability to edit
  // roles would leave nobody able to put it back.
  const stripRoleEdit = await call('PATCH', `/api/roles/${superId}`, {
    permissions: { ...current, 'settings.roles': ['view'] },
  });
  check('the role in use cannot drop its own settings.roles:edit', stripRoleEdit.status === 409);
  show('message', String(stripRoleEdit.body['error']));

  const stripRoleView = await call('PATCH', `/api/roles/${superId}`, {
    permissions: { ...current, 'settings.roles': ['create', 'edit', 'delete'] },
  });
  check('and cannot drop view either', stripRoleView.status === 409);

  const rename = await call('PATCH', `/api/roles/${superId}`, { name: 'Bukan Super Admin' });
  check('a system role cannot be renamed', rename.status === 409);

  const deactivate = await call('PATCH', `/api/roles/${superId}`, { status: 'inactive' });
  check('a system role cannot be deactivated', deactivate.status === 409);
  show('message', String(deactivate.body['error']));

  const removeSystem = await call('DELETE', `/api/roles/${superId}`);
  check('a system role cannot be deleted', removeSystem.status === 409);
  show('message', String(removeSystem.body['error']));

  const stillIntact = await call('GET', '/api/roles');
  const after = (stillIntact.body as unknown as Array<Record<string, unknown>>).find(
    (role) => Number(role['id']) === superId,
  );
  check(
    'Super Admin still holds every permission after every attempt',
    Number(after?.['permissionCount']) === Number(matrix.body['total']),
  );
  check('and is still active', String(after?.['status']) === 'active');
}

// ---------------------------------------------------------------------------
console.log('\n=== Accounts ===');
// ---------------------------------------------------------------------------

const admins = await call('GET', '/api/users?accountType=admin');
check('admin accounts load', admins.status === 200);
show('admin count', String(admins.body['total']));
const adminRows = admins.body['rows'] as Array<Record<string, unknown>>;
for (const row of adminRows.slice(0, 5)) {
  const staff = row['staff'] as Record<string, unknown> | null;
  show(
    `  ${String(row['email'])}`,
    `staf=${String(staff?.['employeeNo'])} peranan=${String((row['role'] as Record<string, unknown>)['name'])} 2fa=${String(row['twoFactorEnabled'])}`,
  );
}

check(
  'no account row carries a password hash or TOTP secret',
  !JSON.stringify(admins.body).toLowerCase().includes('passwordhash') &&
    !JSON.stringify(admins.body).toLowerCase().includes('totpsecret'),
);

check(
  'every admin account resolves to a staff record',
  adminRows.every((row) => row['staff'] !== null),
);

const staffAccounts = await call('GET', '/api/users?accountType=staff&pageSize=5');
check('staff accounts load', staffAccounts.status === 200);
show('staff account count', String(staffAccounts.body['total']));

const candidates = await call('GET', '/api/users/staff-search?q=');
check('the staff picker responds', candidates.status === 200);
const candidateList = candidates.body as unknown as Array<Record<string, unknown>>;
const taken = candidateList.filter((row) => row['existingAccountEmail'] !== null);
show('candidates returned', String(candidateList.length));
show('already holding an account', String(taken.length));

// One person, one login. Two accounts for one individual splits their own audit
// trail, and the trail is the point.
const claimed = adminRows[0]?.['staff'] as Record<string, unknown> | undefined;
if (claimed) {
  const second = await call('POST', '/api/users', {
    staffId: Number(claimed['id']),
    email: `duplikat.${stamp}@hospital.local`,
    accountType: 'admin',
    roleId,
    password: 'KataLaluanUjian123',
  });
  check('a second account for the same staff is refused', second.status === 409);
  show('message', String(second.body['error']));
}

const shortPassword = await call('POST', '/api/users', {
  staffId: 999_999,
  email: `pendek.${stamp}@hospital.local`,
  accountType: 'admin',
  roleId,
  password: 'pendek',
});
check('a password under 12 characters is refused', shortPassword.status === 400);

const missingStaff = await call('POST', '/api/users', {
  staffId: 999_999,
  email: `hantu.${stamp}@hospital.local`,
  accountType: 'admin',
  roleId,
  password: 'KataLaluanUjian123',
});
check('an account without a real staff record is refused', missingStaff.status === 404);

// ---------------------------------------------------------------------------
console.log('\n=== Lockout guards ===');
// ---------------------------------------------------------------------------

const suspendSelf = await call('PATCH', `/api/users/${selfAccountId}`, { status: 'suspended' });
check('an admin cannot suspend their own account', suspendSelf.status === 409);
show('message', String(suspendSelf.body['error']));

// With only one capable administrator, moving that account to a role without role
// management would leave this screen unreachable for everyone.
const capableAdmins = adminRows.filter((row) => row['status'] === 'active');
if (capableAdmins.length === 1) {
  const demote = await call('PATCH', `/api/users/${selfAccountId}`, { roleId });
  check('the last capable admin cannot be demoted', demote.status === 409);
  show('message', String(demote.body['error']));
} else {
  show('note', `${capableAdmins.length} active admins, demotion guard not exercised`);
}

// ---------------------------------------------------------------------------
console.log('\n=== Per-screen enforcement ===');
// ---------------------------------------------------------------------------

// Administrator and staff accounts are separate grants. The Kerani role holds
// neither, so both listings must be refused for it while Super Admin sees both.
const adminList = await call('GET', '/api/users?accountType=admin');
const staffList = await call('GET', '/api/users?accountType=staff');
check('Super Admin can read both account types', adminList.status === 200 && staffList.status === 200);

// A screen key that no longer exists must not silently grant anything. The old flat
// keys are the realistic case: they sat in the database until the migration.
const legacyRole = await call('POST', '/api/roles', {
  name: `Ujian Lama ${stamp}`,
  permissions: { staff: ['view', 'create'] },
});
check('an old flat key is refused outright', legacyRole.status === 409);
show('message', String(legacyRole.body['error']));

// The settings bundle is shared by four screens, so its payload must be narrowed
// rather than returned whole.
const bundle = await call('GET', '/api/settings');
const bundleKeys = Object.keys(bundle.body['values'] as Record<string, unknown>);
check('the settings bundle returns values', bundleKeys.length > 0);
show('keys visible to Super Admin', String(bundleKeys.length));
const editable = bundle.body['editableKeys'] as string[];
check('editable keys are reported', editable.length > 0);
show('editable keys', String(editable.length));

// ---------------------------------------------------------------------------
console.log('\n=== App clients ===');
// ---------------------------------------------------------------------------

const clients = await call('GET', '/api/app-clients');
check('app clients load', clients.status === 200);
check(
  'no client row carries its secret hash',
  !JSON.stringify(clients.body).toLowerCase().includes('secrethash'),
);

const newClient = await call('POST', '/api/app-clients', {
  name: `Ujian Klien ${stamp}`,
  platform: 'android',
  minVersion: '1.0.0',
});
check('a client can be created', newClient.status === 200);
const clientSecret = String(newClient.body['secret']);
const clientRowId = Number(newClient.body['id']);
check('the secret is returned exactly once, at creation', clientSecret.length > 20);
show('clientId', String(newClient.body['clientId']));

const listedAgain = await call('GET', '/api/app-clients');
check(
  'the secret never appears in a later read',
  !JSON.stringify(listedAgain.body).includes(clientSecret),
);

const suspended = await call('PATCH', `/api/app-clients/${clientRowId}`, { status: 'suspended' });
check('a leaked client can be suspended', suspended.status === 200);

const rotated = await call('PATCH', `/api/app-clients/${clientRowId}`, { rotateSecret: true });
check('the secret can be rotated', typeof rotated.body['secret'] === 'string');
check('rotation returns a different secret', String(rotated.body['secret']) !== clientSecret);

// ---------------------------------------------------------------------------
console.log('\n=== Logs ===');
// ---------------------------------------------------------------------------

const activity = await call('GET', '/api/logs/activity?pageSize=5');
check('activity log loads', activity.status === 200);
show('activity entries', String(activity.body['total']));
for (const row of (activity.body['rows'] as Array<Record<string, unknown>>).slice(0, 3)) {
  show(`  ${String(row['action'])}`, `${String(row['actorLabel'])} · ${String(row['createdAt'])}`);
}

const audit = await call('GET', '/api/logs/audit?pageSize=5');
check('audit log loads', audit.status === 200);
show('audit entries', String(audit.body['total']));

const auditRows = audit.body['rows'] as Array<Record<string, unknown>>;
for (const row of auditRows.slice(0, 3)) {
  show(
    `  ${String(row['action'])} ${String(row['entityType'])}#${String(row['entityId'])}`,
    JSON.stringify(row['changes']).slice(0, 90),
  );
}

// The settings write earlier in this run must be in the audit trail, with the
// secret recorded as redacted rather than as its value.
const settingAudit = await call('GET', '/api/logs/audit?entityType=Setting');
check('the settings change was recorded', Number(settingAudit.body['total']) > 0);
check(
  'the audit trail redacts secret values',
  !JSON.stringify(settingAudit.body).includes('sekret-smtp-ujian-123'),
);

const roleAudit = await call('GET', `/api/logs/audit?entityType=Role&entityId=${roleId}`);
check('the role permission change was recorded', Number(roleAudit.body['total']) > 0);
const firstRoleChange = (roleAudit.body['rows'] as Array<Record<string, unknown>>)[0];
check(
  'the audit entry holds both before and after',
  JSON.stringify(firstRoleChange?.['changes']).includes('before') &&
    JSON.stringify(firstRoleChange?.['changes']).includes('after'),
);

// Append-only means there is no route to reach for. A 404 here is the assertion.
for (const method of ['PATCH', 'DELETE'] as const) {
  const attempt = await call(method, `/api/logs/audit/${String(firstRoleChange?.['id'] ?? 1)}`, {
    reason: 'ubah',
  });
  check(`${method} on an audit entry has no route`, attempt.status === 404);
}

// ---------------------------------------------------------------------------
console.log('\n=== Raw events remain immutable ===');
// ---------------------------------------------------------------------------

const rawList = await call('GET', '/api/raw-events?pageSize=1');
const firstRaw = (rawList.body['rows'] as Array<Record<string, unknown>>)[0];
if (firstRaw) {
  const rawId = String(firstRaw['id']);
  for (const method of ['PATCH', 'DELETE', 'PUT'] as const) {
    const attempt = await call(method, `/api/raw-events/${rawId}`, { employeeNo: 'X' });
    check(`${method} on a raw event has no route`, attempt.status === 404);
  }
} else {
  show('note', 'no raw events present to test against');
}

// ---------------------------------------------------------------------------
console.log('\n=== Backup ===');
// ---------------------------------------------------------------------------

const backup = await call('GET', '/api/backup');
check('backup listing responds', backup.status === 200);
show('mysqldump available', String(backup.body['toolAvailable']));
show('directory', String(backup.body['directory']));
show('existing files', String((backup.body['files'] as unknown[]).length));
check('no restore endpoint is offered', !JSON.stringify(backup.body).includes('restoreUrl'));
show('restore is shown as a command', String(backup.body['restoreHint']));

// Path traversal on the download route. The filename arrives from the client, so
// it has to be rejected rather than joined onto the directory.
for (const attempt of ['..%2F..%2F.env', 'nota.txt', 'hospital-2026-08-28.sql']) {
  const response = await call('GET', `/api/backup/${attempt}`);
  check(`a filename outside the expected shape is refused (${attempt})`, response.status === 404);
}

if (backup.body['toolAvailable'] === true) {
  const run = await call('POST', '/api/backup/run');
  check('a backup runs', run.status === 200);
  show('file', `${String(run.body['name'])} (${String(run.body['bytes'])} bytes)`);
  show('duration', `${String(run.body['durationMs'])}ms`);
  check('the dump is not empty', Number(run.body['bytes']) > 10_000);

  const afterRun = await call('GET', '/api/backup');
  const files = afterRun.body['files'] as Array<Record<string, unknown>>;
  check('the new file appears in the listing', files.length > 0);

  if (files.length === 1) {
    const onlyOne = await call('DELETE', `/api/backup/${String(files[0]?.['name'])}`);
    check('the only remaining backup cannot be deleted', onlyOne.status === 409);
    show('message', String(onlyOne.body['error']));
  } else {
    show('note', `${files.length} backups present, last-copy guard not exercised`);
  }

  const logged = await call('GET', '/api/logs/activity?pageSize=5');
  const entries = logged.body['rows'] as Array<Record<string, unknown>>;
  const entry = entries.find((row) => String(row['action']) === 'backup.create');
  check('the backup was written to the activity log', entry !== undefined);
  // Category and level are stored, not derived at read time, so the log screen can
  // count severities from an index. A writer that omits them is the failure mode.
  check('with its category set', String(entry?.['category']) === 'backup');
  check('and its level set', String(entry?.['level']) === 'info');
} else {
  show('note', 'mysqldump missing, backup execution not exercised');
}

// ---------------------------------------------------------------------------
console.log('\n=== Cleanup ===');
// ---------------------------------------------------------------------------

const removeRole = await call('DELETE', `/api/roles/${roleId}`);
check('an unused custom role can be deleted', removeRole.status === 200);

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
  console.log(`  ${label.padEnd(30)} ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
