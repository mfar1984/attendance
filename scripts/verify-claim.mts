/**
 * Verifies multi-line claims against the running server.
 *
 * `test-claim.mts` exercises the rule library with no server. This one exercises the route, and the
 * difference is where the bugs were: the library agreed with itself while the route stored a
 * hundredth of the money.
 *
 * The four failure modes this exists to catch, each of which looked fine from the outside:
 *
 *   the total      — lines summed as integer cents and returned to ringgit. An earlier route
 *                    divided an already-rounded ringgit figure by a hundred and stored RM 1.44 for
 *                    a RM 144.00 mileage claim. Nothing errored, no screen complained, and the
 *                    figure was wrong in the direction nobody queries.
 *   the ceiling    — `maxAmount` is a ceiling per claim, so it must be tested against the sum.
 *                    Tested per line, four RM900 lines pass a RM1,000 cap.
 *   the rate       — a rated category derives its own amount and must ignore a typed one, or the
 *                    rate is decorative.
 *   the receipt    — `requiresReceipt` means every line, not one of them. One hotel bill standing
 *                    in for three unevidenced tolls is the whole reason the rule moved to lines.
 *
 * Every row this files is removed at the end, through Prisma, because an approved claim cannot be
 * cancelled and a verification script must not leave financial records behind. That import is also
 * why `warmUpPrisma()` runs first — building the client writes into `node_modules/.prisma/client`,
 * which `tsx watch` notices, and the restart has to land before the first assertion rather than in
 * the middle of one.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-claim.mts <password>
 */
import { randomBytes } from 'node:crypto';
import { readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-claim.mts <adminPassword>');
  process.exit(2);
}

let cookie = '';
let failures = 0;

/** Every claim this run filed, removed at the end whether or not it passed. */
const filed: number[] = [];
/** Category settings this run changed, put back as they were found. */
const restore: Array<{ id: number; patch: Record<string, unknown> }> = [];

const { db } = await import('../apps/server/src/db.js');

process.on('uncaughtException', (cause) => {
  console.error('\n', cause);
  void cleanUp().then(() => process.exit(1));
});
process.on('unhandledRejection', (cause) => {
  console.error('\n', cause);
  void cleanUp().then(() => process.exit(1));
});

await warmUpPrisma();
await login();
check('logged in', cookie.length > 0);

// ---------------------------------------------------------------------------
console.log('\n=== Fixture ===');
// ---------------------------------------------------------------------------

const staffRows = (await call('GET', '/api/claim-requests/staff-search?limit=1'))
  .body as unknown as Array<Record<string, unknown>>;
check('the staff picker answers', Array.isArray(staffRows) && staffRows.length > 0);
if (!Array.isArray(staffRows) || staffRows.length === 0) await finish();
const staffId = Number(staffRows[0]?.['id']);
show('staf', `#${String(staffId)} ${String(staffRows[0]?.['fullName'])}`);

const types = (await call('GET', '/api/claim-types')).body as unknown as Array<
  Record<string, unknown>
>;
const flat = types.find((row) => row['code'] === 'OFF');
const rated = types.find((row) => row['code'] === 'MLG');
check('a flat category with a ceiling exists', flat !== undefined && flat['maxAmount'] !== null);
check('a rated category exists', rated !== undefined && rated['ratePerUnit'] !== null);
if (!flat || !rated) await finish();

const flatId = Number(flat['id']);
const ratedId = Number(rated['id']);
const cap = Number(flat['maxAmount']);
const rate = Number(rated['ratePerUnit']);
show('rata', `#${String(flatId)} ${String(flat['code'])} had RM ${cap.toFixed(2)}`);
show('berkadar', `#${String(ratedId)} ${String(rated['code'])} RM ${rate.toFixed(2)}/${String(rated['unitLabel'])}`);

/*
 * The flat category has to demand a receipt for the receipt section to mean anything, and the rated
 * one has to not, for the section that proves the rule is per-category. Both are read first and put
 * back at the end, so this does not depend on how somebody configured the installation.
 */
if (flat['requiresReceipt'] !== true) {
  restore.push({ id: flatId, patch: { requiresReceipt: false } });
  await call('PATCH', `/api/claim-types/${String(flatId)}`, { requiresReceipt: true });
}
if (rated['requiresReceipt'] === true) {
  restore.push({ id: ratedId, patch: { requiresReceipt: true } });
  await call('PATCH', `/api/claim-types/${String(ratedId)}`, { requiresReceipt: false });
}

/** Recent enough to be inside the backdating window, past enough not to be in the future. */
const day = dayKey(-4);
const earlier = dayKey(-6);

// ---------------------------------------------------------------------------
console.log('\n=== The total is the sum of the lines, in ringgit ===');
// ---------------------------------------------------------------------------

/*
 * Chosen to be wrong under a float sum: 48.50 + 12.00 + 95.30 does not land on 155.8 exactly in
 * IEEE-754. If the route ever adds the ringgit figures directly instead of scaling to cents, this
 * is the check that notices.
 */
const three = await file(flatId, 'Perjalanan tiga baris', [
  { incurredOn: earlier, description: 'Tol', amount: 48.5 },
  { incurredOn: earlier, description: 'Parkir', amount: 12 },
  { incurredOn: day, description: 'Minyak', amount: 95.3 },
]);
check('three lines file', three.status === 200);
check('and the total is RM 155.80, not RM 1.558', Number(three.body['amount']) === 155.8);
show('jumlah', `RM ${Number(three.body['amount']).toFixed(2)}`);

/*
 * The form collects a receipt per line while somebody is typing, and a receipt has to be attached to a
 * row that exists — so the create response has to name the rows it just made, in the order they were
 * sent. Without this the form would have to re-read the claim to find out what its own lines are
 * called, and the mapping from "the file on line 3" to a row id is positional.
 */
const returnedIds = (three.body['itemIds'] ?? []) as number[];
check('the response names the created lines', returnedIds.length === 3);
check(
  'in the order they were sent',
  returnedIds.every((id, index) => index === 0 || id > (returnedIds[index - 1] ?? 0)),
);

const threeId = Number(three.body['id']);
const readBack = (await call('GET', `/api/claim-requests/${String(threeId)}`)).body;
check('the stored total matches what was returned', Number(readBack['amount']) === 155.8);
check('the line count is reported', Number(readBack['itemCount']) === 3);
check('every line is missing its receipt', Number(readBack['receiptsMissing']) === 3);
const lines = (readBack['items'] ?? []) as Array<Record<string, unknown>>;
check(
  'and each line kept its own amount',
  lines.map((line) => Number(line['amount'])).join(',') === '48.5,12,95.3',
);
check(
  'and its own date',
  lines.map((line) => String(line['incurredOn'])).join(',') === `${earlier},${earlier},${day}`,
);
check('no line leaks the filename on disk', lines.every((line) => !('receiptPath' in line)));

// ---------------------------------------------------------------------------
console.log('\n=== A rated category prices its own lines ===');
// ---------------------------------------------------------------------------

const mileage = await file(ratedId, 'Perbatuan dua hala', [
  { incurredOn: earlier, description: 'Pergi', quantity: 120 },
  { incurredOn: day, description: 'Balik', quantity: 120 },
]);
check('a rated claim files on quantity alone', mileage.status === 200);
check(
  `and the total is 240 × ${rate.toFixed(2)} = RM ${(240 * rate).toFixed(2)}`,
  Number(mileage.body['amount']) === Number((240 * rate).toFixed(2)),
);
show('jumlah', `RM ${Number(mileage.body['amount']).toFixed(2)}`);

const mileageRow = (await call('GET', `/api/claim-requests/${String(Number(mileage.body['id']))}`))
  .body;
check(
  'the claim carries the summed quantity',
  Number(mileageRow['quantity']) === 240,
);
check('and the rate it was priced at, frozen', Number(mileageRow['ratePerUnit']) === rate);

/*
 * The one that keeps the rate a control rather than a label. A typed figure on a rated line is not
 * an error to report — it is a value to ignore, because a mileage claim priced by whoever filed it
 * is a number nobody can check.
 */
const typed = await file(ratedId, 'Perbatuan dengan jumlah ditaip', [
  { incurredOn: day, description: 'Pergi', quantity: 100, amount: 9999 },
]);
check('a typed amount on a rated line is ignored', typed.status === 200);
check(
  `and the rate decides: RM ${(100 * rate).toFixed(2)}`,
  Number(typed.body['amount']) === Number((100 * rate).toFixed(2)),
);

const noQuantity = await file(ratedId, 'Perbatuan tanpa kuantiti', [
  { incurredOn: day, description: 'Pergi', amount: 50 },
]);
check('a rated line without a quantity is refused', noQuantity.status === 409);
check(
  'and the refusal says the category is rated',
  String(noQuantity.body['error']).includes('kadar'),
);

// ---------------------------------------------------------------------------
console.log('\n=== The ceiling is tested against the sum ===');
// ---------------------------------------------------------------------------

/*
 * Two lines, each comfortably under the cap, together over it. This is the shape the per-line
 * version of the check passed: nothing in isolation looks wrong.
 */
const half = Number((cap * 0.6).toFixed(2));
const overCap = await file(flatId, 'Dua baris melebihi had', [
  { incurredOn: earlier, description: 'Kerusi', amount: half },
  { incurredOn: day, description: 'Meja', amount: half },
]);
check('two lines that each pass the cap but together exceed it are refused', overCap.status === 409);
check(
  'and the refusal names both the total and the cap',
  String(overCap.body['error']).includes((half * 2).toFixed(2)) &&
    String(overCap.body['error']).includes(cap.toFixed(2)),
);
show('mesej', String(overCap.body['error']));

// The other half of the assertion: the cap is not simply always firing.
const underCap = await file(flatId, 'Satu baris dalam had', [
  { incurredOn: day, description: 'Kerusi', amount: half },
]);
check('the same figure on one line, inside the cap, is accepted', underCap.status === 200);

// ---------------------------------------------------------------------------
console.log('\n=== Line shape and dates ===');
// ---------------------------------------------------------------------------

const empty = await file(flatId, 'Tiada baris', []);
check('a claim with no lines is refused', empty.status === 400);

const tooMany = await file(
  flatId,
  'Lima puluh satu baris',
  Array.from({ length: 51 }, (_, index) => ({
    incurredOn: day,
    description: `Baris ${String(index + 1)}`,
    amount: 1,
  })),
);
check('a claim with more than fifty lines is refused', tooMany.status === 400);

const future = await file(flatId, 'Baris pada masa hadapan', [
  { incurredOn: day, description: 'Kerusi', amount: 10 },
  { incurredOn: dayKey(30), description: 'Meja', amount: 10 },
]);
check('a future line date is refused', future.status === 409);
/*
 * The line number is the point. A claim may hold fifty lines, and a refusal that does not say which
 * one leaves somebody comparing a list against itself.
 */
check(
  'and the refusal names which line, counted from one',
  String(future.body['error']).startsWith('Baris 2:'),
);
show('mesej', String(future.body['error']));

const stale = await file(flatId, 'Baris terlalu lama', [
  { incurredOn: dayKey(-400), description: 'Kerusi', amount: 10 },
]);
check('a line older than the backdating window is refused', stale.status === 409);

const zero = await file(flatId, 'Baris sifar', [
  { incurredOn: day, description: 'Kerusi', amount: 0 },
]);
check('a line of zero is refused by the schema', zero.status === 400);

// ---------------------------------------------------------------------------
console.log('\n=== A receipt per line ===');
// ---------------------------------------------------------------------------

const ids = lines.map((line) => Number(line['id']));
// The ids the create call handed back have to be the ids the claim actually holds, or the form would
// upload each receipt against somebody else's line.
check('the returned line ids are the claim\'s own lines', returnedIds.join(',') === ids.join(','));

const allMissing = await decide(threeId, 'approved');
check('a claim with no receipts cannot be approved', allMissing.status === 409);
check(
  'and the refusal counts how many are missing',
  String(allMissing.body['error']).includes('3 daripada 3'),
);

const png = pngBytes();
const first = await upload(ids[0] ?? 0, 'resit.png', png, 'image/png');
check('a receipt attaches to a line', first.status === 200);
check('with the type read from the bytes', first.body['contentType'] === 'image/png');

const afterOne = (await call('GET', `/api/claim-requests/${String(threeId)}`)).body;
check(
  'and only that line reports one',
  Number(afterOne['receiptsMissing']) === 2 &&
    ((afterOne['items'] ?? []) as Array<Record<string, unknown>>)
      .filter((line) => line['hasReceipt'] === true)
      .length === 1,
);

/*
 * The reason the receipt moved from the claim to the line. Under the old shape this claim was
 * evidenced: one document existed. Two of the three costs on it had no paper at all.
 */
const stillShort = await decide(threeId, 'approved');
check('one receipt does not evidence three lines', stillShort.status === 409);
check(
  'and the count has moved with the upload',
  String(stillShort.body['error']).includes('2 daripada 3'),
);

const served = await fetch(`${BASE}/api/claim-items/${String(ids[0] ?? 0)}/receipt`, {
  headers: { cookie },
});
check('the file is served back', served.status === 200);
check('as the type it was stored as', served.headers.get('content-type') === 'image/png');
// A receipt names a payee and an amount. A shared cache must not hold one.
check(
  'privately',
  (served.headers.get('cache-control') ?? '').includes('private') &&
    served.headers.get('x-content-type-options') === 'nosniff',
);
await served.arrayBuffer();

const absent = await fetch(`${BASE}/api/claim-items/${String(ids[1] ?? 0)}/receipt`, {
  headers: { cookie },
});
check('a line with no receipt serves 404, not an empty body', absent.status === 404);
await absent.arrayBuffer();

/*
 * Same three rules as every other upload in the application, for the same reason: this file is
 * served from the origin whose CSP allows scripts from 'self'.
 */
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const svgUpload = await upload(ids[1] ?? 0, 'resit.svg', svg, 'image/svg+xml');
check('an SVG receipt is refused', svgUpload.status === 409);
check('and the refusal says why', String(svgUpload.body['error']).includes('skrip'));

const liar = await upload(ids[1] ?? 0, 'resit.png', svg, 'image/png');
check('an SVG relabelled as a PNG is still refused', liar.status === 409);

const emptyFile = await upload(ids[1] ?? 0, 'resit.png', Buffer.alloc(0), 'image/png');
check('an empty file is refused', emptyFile.status === 409);

// A scanner produces PDF, and refusing it would push people into photographing a screen.
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), randomBytes(256)]);
const pdfUpload = await upload(ids[1] ?? 0, 'resit.pdf', pdf, 'application/pdf');
check('a PDF receipt is accepted', pdfUpload.status === 200);
check('as a PDF', pdfUpload.body['contentType'] === 'application/pdf');

const removed = await call('DELETE', `/api/claim-items/${String(ids[1] ?? 0)}/receipt`);
check('a receipt can be removed while the claim is pending', removed.status === 200);
check(
  'and the missing count goes back up',
  Number((await call('GET', `/api/claim-requests/${String(threeId)}`)).body['receiptsMissing']) ===
    2,
);

await upload(ids[1] ?? 0, 'resit.png', png, 'image/png');
await upload(ids[2] ?? 0, 'resit.png', png, 'image/png');
check(
  'with every line evidenced, none are missing',
  Number((await call('GET', `/api/claim-requests/${String(threeId)}`)).body['receiptsMissing']) ===
    0,
);

// ---------------------------------------------------------------------------
console.log('\n=== Approval ===');
// ---------------------------------------------------------------------------

const above = await decide(threeId, 'approved', { approvedAmount: 200 });
check('more than was claimed cannot be approved', above.status === 409);
check(
  'and the refusal says it is no longer the request that was filed',
  String(above.body['error']).includes('difailkan'),
);

const approved = await decide(threeId, 'approved', { approvedAmount: 140, note: 'Sebahagian.' });
check('less than was claimed can be approved', approved.status === 200);
check('and the allowed figure is what was decided', Number(approved.body['approvedAmount']) === 140);
// Approved is not paid. Nothing in this module pays.
check('approval does not mark it paid', approved.body['paid'] === false);

const decided = (await call('GET', `/api/claim-requests/${String(threeId)}`)).body;
check('the claim reads as approved', decided['status'] === 'approved');
check('the claimed total is untouched by a partial approval', Number(decided['amount']) === 155.8);

/*
 * The receipt is the evidence the decision was weighed against. Replacing it afterwards would leave
 * an approved amount justified by a document nobody who approved it saw.
 */
const afterDecision = await upload(ids[0] ?? 0, 'resit.png', png, 'image/png');
check('a receipt cannot be replaced after the decision', afterDecision.status === 409);
const deleteAfter = await call('DELETE', `/api/claim-items/${String(ids[0] ?? 0)}/receipt`);
check('nor removed', deleteAfter.status === 409);

const twice = await decide(threeId, 'approved');
check('a decided claim cannot be decided again', twice.status === 409);

// The rated category asks for no paper, so it approves with none — the rule is per category.
const mileageId = Number(mileage.body['id']);
const noPaper = await decide(mileageId, 'approved');
check('a category that needs no receipt approves without one', noPaper.status === 200);
check(
  'at the full amount',
  Number(noPaper.body['approvedAmount']) === Number((240 * rate).toFixed(2)),
);

const rejected = await decide(Number(underCap.body['id']), 'rejected', { note: 'Tidak wajar.' });
check('a claim can be rejected', rejected.status === 200);
const noReason = await file(flatId, 'Penolakan tanpa sebab', [
  { incurredOn: day, description: 'Kerusi', amount: 10 },
]);
check(
  'a rejection without a written reason is refused',
  (await decide(Number(noReason.body['id']), 'rejected')).status === 409,
);

const cancelled = await call(
  'POST',
  `/api/claim-requests/${String(Number(noReason.body['id']))}/cancel`,
);
check('a pending claim can be withdrawn', cancelled.status === 200);
check(
  'and a withdrawn one cannot then be decided',
  (await decide(Number(noReason.body['id']), 'approved')).status === 409,
);

// ---------------------------------------------------------------------------
console.log('\n=== The list agrees with the rows ===');
// ---------------------------------------------------------------------------

const list = (await call('GET', `/api/claim-requests?staffId=${String(staffId)}&pageSize=200`)).body;
const rows = (list['rows'] ?? []) as Array<Record<string, unknown>>;
const listed = rows.find((row) => Number(row['id']) === threeId);
check('the list carries the lines, not just a count', Array.isArray(listed?.['items']));
check('with the same total as the detail', Number(listed?.['amount']) === 155.8);
check('and the same missing count', Number(listed?.['receiptsMissing']) === 0);

/*
 * The status counts are computed outside the status filter on purpose: computed inside it, choosing
 * one chip would zero the others and the remaining rows would look as though they had vanished.
 */
const filtered = (
  await call('GET', `/api/claim-requests?staffId=${String(staffId)}&status=approved&pageSize=200`)
).body;
const counts = (filtered['counts'] ?? {}) as Record<string, number>;
check(
  'the chip counts survive a status filter',
  Number(counts['approved'] ?? 0) > 0 && Number(counts['rejected'] ?? 0) > 0,
);
show('kiraan', JSON.stringify(counts));

// ---------------------------------------------------------------------------
console.log('\n=== The decision notice can name the lines ===');
// ---------------------------------------------------------------------------

/*
 * A template carrying only `{{amount}}` tells somebody RM 155.80 was approved for three costs it does
 * not name. The placeholder list is what an operator writes against, so if `items` is absent from it
 * the editor refuses the template at save time and nobody can mention the lines at all.
 */
const templates = (await call('GET', '/api/hr/claim/templates')).body;
const placeholders = (templates['placeholders'] ?? []) as string[];
check('the claim module offers a line list placeholder', placeholders.includes('items'));
check('and a line count', placeholders.includes('itemCount'));

const accepted = await call('PUT', '/api/hr/claim/templates/approved', {
  subject: '{{requestNo}} — {{itemCount}} baris diluluskan',
  body: 'Salam {{staffName}},\n\n{{items}}\n\nJumlah: {{amount}}\n\n{{organisation}}',
  enabled: true,
});
check('a template referring to both is accepted', accepted.status === 200);
check(
  'with nothing reported as unfillable',
  ((accepted.body['unknown'] ?? []) as string[]).length === 0,
);
// Put the wording back, so this run does not leave the installation on a fixture template.
await call('DELETE', '/api/hr/claim/templates/approved');

// ---------------------------------------------------------------------------
console.log('\n=== The self-service payload says what is waiting on whom ===');
// ---------------------------------------------------------------------------

/*
 * `/api/saya/*` has no caller in this app — it is the Android client's contract — so nothing here
 * would notice it going stale. It reported only the total, which left somebody looking at their own
 * pending claim with no indication it was stuck on receipts they had not sent.
 *
 * Filed against the caller's OWN staff row, because that endpoint filters on the session and an
 * assertion over an empty list passes without proving anything.
 */
const profile = (await call('GET', '/api/profile')).body;
const employeeNo = String(
  ((profile['managed'] ?? {}) as Record<string, unknown>)['employeeNo'] ?? '',
);
const selfRows = (
  await call('GET', `/api/claim-requests/staff-search?q=${encodeURIComponent(employeeNo)}&limit=5`)
).body as unknown as Array<Record<string, unknown>>;
const selfStaffId = Number(
  selfRows.find((row) => String(row['employeeNo']) === employeeNo)?.['id'] ?? 0,
);
check('the caller has a staff row of their own', selfStaffId > 0);
show('sendiri', `#${String(selfStaffId)} ${employeeNo}`);

const mine = await call('POST', '/api/claim-requests', {
  staffId: selfStaffId,
  claimTypeId: flatId,
  incurredOn: day,
  description: 'Tuntutan sendiri',
  items: [
    { incurredOn: earlier, description: 'Tol', amount: 5 },
    { incurredOn: day, description: 'Parkir', amount: 6 },
  ],
});
if (mine.status === 200) filed.push(Number(mine.body['id']));
check('a claim files against it', mine.status === 200);

const own = (await call('GET', '/api/saya/permohonan')).body;
const ownClaims = (own['claims'] ?? []) as Array<Record<string, unknown>>;
const listedMine = ownClaims.find((row) => Number(row['id']) === Number(mine.body['id']));
check('and appears in the own-applications payload', listedMine !== undefined);
check('with the summed total', Number(listedMine?.['amount']) === 11);
check('the line count', Number(listedMine?.['itemCount']) === 2);
/*
 * The two together are what say "waiting on you" rather than "waiting". The count alone is the line
 * count on a category that asks for no paper, and means nothing without the flag.
 */
check('the number of lines still without a receipt', Number(listedMine?.['receiptsMissing']) === 2);
check('and whether the category asks for paper at all', listedMine?.['receiptRequired'] === true);

await finish();

// ---------------------------------------------------------------------------

/** Files a claim and remembers it for cleanup. */
async function file(
  claimTypeId: number,
  description: string,
  items: Array<Record<string, unknown>>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await call('POST', '/api/claim-requests', {
    staffId,
    claimTypeId,
    incurredOn: day,
    description,
    items,
  });
  if (response.status === 200) filed.push(Number(response.body['id']));
  return response;
}

async function decide(
  id: number,
  decision: 'approved' | 'rejected',
  extra: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return call('POST', `/api/claim-requests/${String(id)}/decide`, { decision, ...extra });
}

/** `offset` days from today, as the calendar key the route takes. */
function dayKey(offset: number): string {
  const now = new Date();
  const shifted = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return shifted.toISOString().slice(0, 10);
}

/** A one-pixel PNG, built rather than read so this script needs no fixture files. */
function pngBytes(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
    'base64',
  );
}

async function upload(
  itemId: number,
  filename: string,
  bytes: Buffer,
  contentType: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const boundary = `----kehadiran${randomBytes(8).toString('hex')}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);

  const response = await fetch(`${BASE}/api/claim-items/${String(itemId)}/receipt`, {
    method: 'POST',
    headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat([head, bytes, tail]),
  });

  const text = await response.text();
  try {
    return { status: response.status, body: (JSON.parse(text) ?? {}) as Record<string, unknown> };
  } catch {
    return { status: response.status, body: { raw: text.slice(0, 200) } };
  }
}

/**
 * Removes every row this run created, and puts the categories back.
 *
 * Through Prisma rather than the API, because there is no delete endpoint for a claim — deliberately,
 * since a decided claim is a financial record. That makes cleanup this script's own problem: an
 * approved test claim cannot be cancelled, so without this the claims screen fills with fixtures
 * carrying real-looking amounts.
 *
 * The uploaded files go too. Deleting the rows alone would leave the receipts on disk with nothing
 * pointing at them — harmless, but it accumulates one orphan per run and the next person looking at
 * that directory has no way to tell a stray fixture from somebody's actual receipt.
 */
async function cleanUp(): Promise<void> {
  for (const entry of restore.splice(0)) {
    await call('PATCH', `/api/claim-types/${String(entry.id)}`, entry.patch);
  }
  if (filed.length === 0) return;

  const ids = filed.splice(0);
  const paths = (
    await db().claimItem.findMany({
      where: { claimRequestId: { in: ids }, receiptPath: { not: null } },
      select: { receiptPath: true },
    })
  ).map((row) => row.receiptPath ?? '');

  await db().claimItem.deleteMany({ where: { claimRequestId: { in: ids } } });
  await db().claimRequest.deleteMany({ where: { id: { in: ids } } });

  /*
   * Resolved the way the route resolves it, from the server's working directory rather than this
   * script's. `STORAGE_DIR` is relative and the two processes do not share a cwd.
   */
  const directory = resolve(
    process.cwd(),
    'apps/server',
    process.env['STORAGE_DIR'] ?? 'storage',
    'receipts',
  );
  for (const name of paths) {
    if (name.length > 0) await unlink(join(directory, name)).catch(() => undefined);
  }
  const left = await readdir(directory).catch(() => [] as string[]);

  console.log(
    `         dibersihkan: ${String(ids.length)} tuntutan · ${String(paths.length)} resit · ` +
      `${String(left.length)} fail kekal`,
  );
}

async function finish(): Promise<never> {
  await cleanUp();
  const left = await db().claimRequest.count({ where: { staffId } });
  check('no fixture claim is left behind', left === 0);
  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

async function warmUpPrisma(): Promise<void> {
  await db().claimRequest.count();
  await waitForServer();
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 60_000;
  let restarted = false;

  for (let tick = 0; Date.now() < deadline; tick += 1) {
    const up = await fetch(`${BASE}/api/health`)
      .then((response) => response.ok)
      .catch(() => false);

    if (up && (restarted || tick >= 3)) {
      if (restarted) console.log('  pelayan dimulakan semula, sambung');
      return;
    }
    if (!up) restarted = true;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  console.error('Pelayan tidak menjawab. Pastikan `npm run dev` berjalan dalam apps/server.');
  process.exit(2);
}

async function login(): Promise<void> {
  cookie = '';
  await call('POST', '/api/auth/login', {
    email,
    password,
    ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
  });
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
  console.log(`         ${label}: ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
