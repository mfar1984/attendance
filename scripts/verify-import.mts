/**
 * Verifies bulk import at the real target volume.
 *
 * Generates 5000 rows, deliberately including the mistakes an operator actually
 * makes: a name with a comma, a duplicate, an oversized identifier, a bad PIN and
 * an invalid email. Validation must catch all of them and write nothing.
 *
 * The commit runs without a terminal assignment, so it measures the database path
 * alone. Pushing 5000 people to hardware is a separate, much slower operation.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-import.mts <password>
 */
import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-import.mts <adminPassword>');
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

console.log('\n=== Template is downloadable ===');
const template = await fetch(`${BASE}/api/staff/import/template`, { headers: { cookie } });
check('template responds', template.status === 200);
// Inspected as bytes, not text: `response.text()` strips a leading BOM per spec,
// so a string comparison would fail even when the BOM is correctly present.
const templateBytes = Buffer.from(await template.arrayBuffer());
const hasBom = templateBytes[0] === 0xef && templateBytes[1] === 0xbb && templateBytes[2] === 0xbf;
// The BOM is what makes Excel read the file as UTF-8 instead of mangling names.
check('template carries a UTF-8 BOM for Excel', hasBom);
check(
  'template has the expected header',
  templateBytes.toString('utf8').includes('No. Staf,Nama'),
);

console.log('\n=== A file with mistakes is rejected wholesale ===');
const broken = [
  'No. Staf,Nama,Emel,PIN',
  'B001,Nama Betul,ok@hospital.local,123456',
  `${'X'.repeat(40)},Terlalu Panjang,,`,
  'B002,Emel Salah,bukan-emel,',
  'B003,Pin Salah,,12',
  'B001,Berulang,,',
  ',Tiada No Staf,,',
].join('\n');

const brokenPreview = await postCsv('/api/staff/import/preview', broken);
check('preview responds', brokenPreview.status === 200);
const problems = brokenPreview.body['problems'] as Array<Record<string, unknown>>;
show('rows read', String(brokenPreview.body['totalLines']));
show('valid', String((brokenPreview.body['valid'] as unknown[]).length));
show('problems', String(problems.length));
for (const problem of problems) {
  show(`  baris ${String(problem['line'])}`, `${String(problem['field'])}: ${String(problem['message'])}`);
}
check('every bad row is reported', problems.length >= 5);
check(
  'the duplicate inside the file is caught',
  problems.some((problem) => String(problem['message']).includes('Berulang')),
);

const refused = await call('POST', '/api/staff/import/commit', { csv: broken, deviceIds: [] });
check('committing a file with errors is refused', refused.status === 409);
show('message', String(refused.body['error']));

console.log('\n=== Quoted names containing commas survive parsing ===');
const quoted = [
  'No. Staf,Nama',
  'Q001,"Ali bin Abu, Dr"',
  'Q002,"Siti binti Hassan, PhD"',
].join('\n');
const quotedPreview = await postCsv('/api/staff/import/preview', quoted);
const quotedRows = quotedPreview.body['valid'] as Array<Record<string, unknown>>;
check('both rows parse', quotedRows.length === 2);
show('name 1', String(quotedRows[0]?.['fullName']));
check('the comma is preserved', String(quotedRows[0]?.['fullName']) === 'Ali bin Abu, Dr');

console.log('\n=== 5000 rows ===');
const rows = ['No. Staf,Nama,No. KP,Telefon,Emel,Jabatan,Lokasi,PIN'];
for (let index = 1; index <= 5000; index += 1) {
  const no = `L${String(index).padStart(5, '0')}`;
  const dept = ['Kejururawatan', 'Perubatan', 'Pentadbiran', 'Farmasi'][index % 4];
  rows.push(
    `${no},Staf Ujian ${index},9001010${String(index).padStart(5, '0')},01${String(index).padStart(8, '0')},` +
      `${no.toLowerCase()}@hospital.local,${dept},Blok Utama,${String(100000 + (index % 900000))}`,
  );
}
const bulk = rows.join('\n');

const startPreview = Date.now();
const bigPreview = await postCsv('/api/staff/import/preview', bulk);
check('preview responds', bigPreview.status === 200);
show('preview took', `${Date.now() - startPreview} ms`);
show('valid rows', String((bigPreview.body['valid'] as unknown[]).length));
show('problems', String((bigPreview.body['problems'] as unknown[]).length));
show('new departments', JSON.stringify(bigPreview.body['newDepartments']));
check('all 5000 rows validate', (bigPreview.body['valid'] as unknown[]).length === 5000);
check('no problems reported', (bigPreview.body['problems'] as unknown[]).length === 0);

console.log('\n=== Commit ===');
const started = Date.now();
const commit = await call('POST', '/api/staff/import/commit', { csv: bulk, deviceIds: [] });
check('commit starts', commit.status === 200);
const jobId = String(commit.body['jobId']);
show('job', jobId);

let job: Record<string, unknown> = commit.body;
for (let attempt = 0; attempt < 240; attempt += 1) {
  await wait(1000);
  const status = await call('GET', `/api/staff/import/status/${jobId}`);
  if (status.status !== 200) break;
  job = status.body;
  if (String(job['status']) !== 'running') break;
}

show('status', String(job['status']));
show('created', String(job['created']));
show('skipped', String(job['skipped']));
show('elapsed', `${Math.round((Date.now() - started) / 1000)}s`);
check('the job finished', String(job['status']) === 'done');

/**
 * Asserted on the end state, not on this run's counters.
 *
 * A row already present is skipped rather than created, so `created` depends on
 * what the directory held beforehand. What must always hold is that every row in
 * the file ends up in the directory exactly once.
 */
const imported = await call('GET', '/api/staff?page=1&pageSize=1&search=L0');
show('rows matching the import', String(imported.body['total']));
check('every row from the file is present', Number(imported.body['total']) === 5000);
check(
  'created plus skipped accounts for everything queued',
  Number(job['created']) + Number(job['skipped']) === Number(job['total']),
);

console.log('\n=== Re-running skips what exists ===');
const rerun = await call('POST', '/api/staff/import/commit', { csv: bulk, deviceIds: [] });
const rerunJobId = String(rerun.body['jobId']);
await wait(1500);
const rerunStatus = await call('GET', `/api/staff/import/status/${rerunJobId}`);
show('created on rerun', String(rerunStatus.body['created']));
show('total queued', String(rerunStatus.body['total']));
// Existing rows are filtered out before the job even starts, so nothing is
// overwritten and a partially-fixed file can be re-uploaded safely.
check('nothing is created twice', Number(rerunStatus.body['total']) === 0);

console.log('\n=== The directory reflects the import ===');
const listed = await call('GET', '/api/staff?page=1&pageSize=1');
show('staff total', String(listed.body['total']));
check('directory count includes the imported rows', Number(listed.body['total']) >= 5000);

const missing = await call('GET', '/api/staff?page=1&pageSize=1&missingBiometrics=true');
show('cannot scan yet', String(missing.body['total']));
// Imported staff have no biometrics, which is exactly the condition the directory
// filter exists to surface.
check('imported staff are flagged as unable to scan', Number(missing.body['total']) >= 5000);

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);

async function postCsv(
  path: string,
  csv: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'text/csv', cookie },
    body: csv,
  });
  const text = await response.text();
  try {
    return { status: response.status, body: (JSON.parse(text) ?? {}) as Record<string, unknown> };
  } catch {
    return { status: response.status, body: { raw: text.slice(0, 200) } };
  }
}

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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function show(label: string, value: string): void {
  console.log(`  ${label.padEnd(26)} ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
