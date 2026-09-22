/**
 * Verifies the accounts screen: tab counts, status facets, and the two-step
 * suspend-then-delete rule.
 *
 * The guards are the point. A row of small icons sits next to "delete", and the
 * accessible version of "are you sure" is a state the record has to already be in.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-users.mts <password>
 */
import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-users.mts <adminPassword>');
  process.exit(2);
}

let cookie = '';
let failures = 0;
const stamp = Date.now().toString().slice(-6);

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

// ---------------------------------------------------------------------------
console.log('\n=== Tab counts ===');
// ---------------------------------------------------------------------------

const counts = await call('GET', '/api/users/counts');
check('counts load', counts.status === 200);
show('admin / staf / apps', `${String(counts.body['admin'])} / ${String(counts.body['staff'])} / ${String(counts.body['apps'])}`);

const adminList = await call('GET', '/api/users?accountType=admin');
check(
  'the admin badge matches what the admin tab returns',
  Number(counts.body['admin']) === Number(adminList.body['total']),
);

// ---------------------------------------------------------------------------
console.log('\n=== Status facets ===');
// ---------------------------------------------------------------------------

const statuses = adminList.body['statuses'] as Record<string, number>;
show('statuses', JSON.stringify(statuses));
check(
  'the facet counts sum to the tab total',
  Object.values(statuses).reduce((running, value) => running + value, 0) ===
    Number(counts.body['admin']),
);

// Filtering by one status must not change what the others report, or selecting a
// chip makes the remaining rows look like they vanished.
const filtered = await call('GET', '/api/users?accountType=admin&status=active');
check(
  'the facets are unaffected by the status filter',
  JSON.stringify(filtered.body['statuses']) === JSON.stringify(statuses),
);
check('but the row total is', Number(filtered.body['total']) === statuses['active']);

const rows = adminList.body['rows'] as Array<Record<string, unknown>>;
const first = rows[0];
show('first row', `${String(first?.['email'])} · ${String(first?.['status'])}`);
check(
  'rows carry what the columns need',
  first !== undefined &&
    'createdAt' in first &&
    'lastLoginAt' in first &&
    'twoFactorEnabled' in first &&
    'failedLoginCount' in first,
);
check(
  'the staff relation carries department for the Staf column',
  (first?.['staff'] as Record<string, unknown> | null) !== null &&
    'department' in ((first?.['staff'] ?? {}) as Record<string, unknown>),
);
check(
  'no hash or secret is present',
  !JSON.stringify(adminList.body).toLowerCase().includes('passwordhash') &&
    !JSON.stringify(adminList.body).toLowerCase().includes('totpsecret'),
);

// ---------------------------------------------------------------------------
console.log('\n=== Suspend then delete ===');
// ---------------------------------------------------------------------------

// A throwaway staff account, so the guards are exercised without touching the real
// administrator this script is signed in as.
const candidates = await call('GET', '/api/users/staff-search?q=');
const free = (candidates.body as unknown as Array<Record<string, unknown>>).find(
  (row) => row['existingAccountEmail'] === null,
);
check('a staff record without an account is available', free !== undefined);

let createdId = 0;
if (free) {
  const created = await call('POST', '/api/users', {
    staffId: Number(free['id']),
    email: `ujian.buang.${stamp}@hospital.local`,
    accountType: 'staff',
    roleId: 3,
    password: 'KataLaluanUjian123',
  });
  check('a staff account can be created', created.status === 200);
  createdId = Number(created.body['id']);

  const activeDelete = await call('DELETE', `/api/users/${createdId}`);
  check('an active account cannot be deleted', activeDelete.status === 409);
  show('message', String(activeDelete.body['error']));

  const suspend = await call('PATCH', `/api/users/${createdId}`, { status: 'suspended' });
  check('it can be suspended', suspend.status === 200);

  const suspendedDelete = await call('DELETE', `/api/users/${createdId}`);
  check('once suspended it can be deleted', suspendedDelete.status === 200);

  const gone = await call('GET', `/api/users?accountType=staff&search=ujian.buang.${stamp}`);
  check('and it is gone', Number(gone.body['total']) === 0);

  // The trail has to outlive the login, or removing an account erases who did what.
  const trail = await call('GET', '/api/logs/audit?entityType=UserAccount&pageSize=5');
  const removal = (trail.body['rows'] as Array<Record<string, unknown>>).find(
    (row) => String(row['action']) === 'delete',
  );
  check('the deletion is in the audit trail', removal !== undefined);
  check(
    'the trail still names the actor after the account is gone',
    String(removal?.['actorLabel']).length > 0,
  );
  show('recorded as', `${String(removal?.['action'])} · ${String(removal?.['reason'])}`);
}

// ---------------------------------------------------------------------------
console.log('\n=== Self-protection ===');
// ---------------------------------------------------------------------------

const selfDelete = await call('DELETE', `/api/users/${selfAccountId}`);
check('you cannot delete your own account', selfDelete.status === 409);
show('message', String(selfDelete.body['error']));

const selfSuspend = await call('PATCH', `/api/users/${selfAccountId}`, { status: 'suspended' });
check('nor suspend it', selfSuspend.status === 409);

// ---------------------------------------------------------------------------
console.log('\n=== App clients ===');
// ---------------------------------------------------------------------------

const client = await call('POST', '/api/app-clients', {
  name: `Ujian Buang ${stamp}`,
  platform: 'android',
});
check('a client can be created', client.status === 200);
const clientId = Number(client.body['id']);

const activeClientDelete = await call('DELETE', `/api/app-clients/${clientId}`);
check('an active client cannot be deleted', activeClientDelete.status === 409);
show('message', String(activeClientDelete.body['error']));

await call('PATCH', `/api/app-clients/${clientId}`, { status: 'suspended' });
const suspendedClientDelete = await call('DELETE', `/api/app-clients/${clientId}`);
check('once suspended it can be deleted', suspendedClientDelete.status === 200);

const clientsLeft = await call('GET', '/api/app-clients');
check(
  'and it is gone from the list',
  !(clientsLeft.body as unknown as Array<Record<string, unknown>>).some(
    (row) => Number(row['id']) === clientId,
  ),
);

const finalCounts = await call('GET', '/api/users/counts');
show('counts after cleanup', JSON.stringify(finalCounts.body));

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
