/**
 * Verifies face enrolment against the live terminal.
 *
 * The test image is the face already enrolled on the device for staff "1". Using a
 * real, accepted photograph matters: the firmware runs its own quality checks, so a
 * synthetic image would be rejected for reasons that say nothing about our code.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-face.mts <password>
 */
import { generateSync } from 'otplib';

import { HikvisionClient, assertUsableJpeg, readJpegDimensions } from '@attendance/hik-isapi';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-face.mts <adminPassword>');
  process.exit(2);
}

const device = new HikvisionClient({
  baseUrl: process.env['HIK_HOST'] as string,
  username: process.env['HIK_USERNAME'] as string,
  password: process.env['HIK_PASSWORD'] as string,
  verifyTls: false,
});

let cookie = '';
let failures = 0;

try {
  await call('POST', '/api/auth/login', {
    email,
    password,
    ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
  });
  check('logged in', cookie.length > 0);

  console.log('\n=== Fetch a real, device-accepted face to use as input ===');
  const source = await device.persons.find('1');
  check('staff 1 exists on the terminal', source !== null);
  check('and already has a face enrolled', (source?.numOfFace ?? 0) > 0);

  let jpeg: Buffer | null = null;
  if (source?.faceURL) {
    jpeg = await device.faces.image(source.faceURL);
    const size = readJpegDimensions(jpeg);
    show('bytes', `${Math.round(jpeg.length / 1024)} KB`);
    show('dimensions', size ? `${size.width}x${size.height}` : 'unknown');
    // Confirms the library's own validation agrees with what the device produced.
    assertUsableJpeg(jpeg);
    check('the image passes our own validation', true);
  }

  console.log('\n=== Validation rejects unusable images ===');
  const notJpeg = await postFace(2, Buffer.from('this is not a jpeg', 'utf8'));
  check('a non-JPEG body is refused', notJpeg.status === 400);
  show('message', String(notJpeg.body['error']).slice(0, 80));

  if (jpeg) {
    const oversized = Buffer.concat([jpeg, Buffer.alloc(220 * 1024, 0x20)]);
    const tooBig = await postFace(2, oversized);
    check('an oversized image is refused', tooBig.status === 400);
    show('message', String(tooBig.body['error']).slice(0, 90));
  }

  console.log('\n=== Enrolling requires a terminal assignment ===');
  // Staff 5001 is mapped to device id 2001, so this path is exercised with a
  // person who does have an assignment. A staff member with none must be refused
  // rather than silently succeeding, because the face lives on the device.
  const staffList = await call('GET', '/api/staff?page=1&pageSize=50');
  const rows = staffList.body['rows'] as Array<Record<string, unknown>>;
  const mapped = rows.find((row) => String(row['employeeNo']) === '5001');
  check('the test staff member exists', mapped !== undefined);

  if (jpeg && mapped) {
    const staffId = Number(mapped['id']);

    console.log('\n=== Enrol ===');
    const enrolled = await postFace(staffId, jpeg);
    check('enrolment succeeds', enrolled.status === 200);

    const results = (enrolled.body['results'] ?? []) as Array<Record<string, unknown>>;
    for (const row of results) {
      show(
        `  ${String(row['deviceName'])}`,
        row['ok'] === true ? 'berjaya' : `GAGAL ${String(row['error'])}`,
      );
    }
    check('pushed to at least one terminal', results.some((row) => row['ok'] === true));

    console.log('\n=== Read it back off the hardware ===');
    const onDevice = await device.persons.find('2001');
    show('numOfFace on terminal', String(onDevice?.numOfFace ?? 0));
    check('the terminal now reports a face', (onDevice?.numOfFace ?? 0) > 0);

    console.log('\n=== The directory stops flagging them as unable to scan ===');
    const detail = await call('GET', `/api/staff/${staffId}`);
    show('numOfFace in database', String(detail.body['numOfFace']));
    check('credential count mirrored', Number(detail.body['numOfFace']) > 0);

    console.log('\n=== Serve the face back through the API ===');
    const served = await fetch(`${BASE}/api/staff/${staffId}/face`, { headers: { cookie } });
    check('the face is retrievable', served.status === 200);
    show('content-type', served.headers.get('content-type') ?? '(none)');
    const servedBytes = Buffer.from(await served.arrayBuffer());
    check('and is a JPEG', servedBytes[0] === 0xff && servedBytes[1] === 0xd8);

    console.log('\n=== Remove ===');
    const removed = await call('DELETE', `/api/staff/${staffId}/face`);
    check('removal succeeds', removed.status === 200);

    const afterRemoval = await device.persons.find('2001');
    check('the terminal no longer reports a face', (afterRemoval?.numOfFace ?? 0) === 0);
  }
} finally {
  await device.close();
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);

async function postFace(
  staffId: number,
  jpeg: Buffer,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE}/api/staff/${staffId}/face`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg', cookie },
    body: new Uint8Array(jpeg),
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

function show(label: string, value: string): void {
  console.log(`  ${label.padEnd(26)} ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
