/**
 * Regression suite for claim and expense rules. No server and no database.
 *
 * These decide what somebody is reimbursed, so the arithmetic and the ceilings are tested
 * rather than assumed.
 */
import {
  MAX_BACKDATE_DAYS,
  checkApprovedAmount,
  checkClaim,
  checkClaimLine,
  checkClaimTotal,
  claimAmountFor,
  daysBetween,
} from '../apps/server/src/hr/claim.js';
import { ratedAmount, toSen } from '../apps/server/src/hr/money.js';

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  GAGAL ${label}`);
    console.log(`          dapat  : ${JSON.stringify(actual)}`);
    console.log(`          jangka : ${JSON.stringify(expected)}`);
  }
}

const TODAY = '2026-09-10';

/** A flat claim that passes, as the baseline every case below varies from. */
const flat = {
  incurredOn: '2026-09-01',
  today: TODAY,
  amount: 100,
  maxAmount: null,
  requiresReceipt: true,
  hasReceipt: true,
  ratePerUnit: null,
  quantity: null,
};

console.log('\nJumlah berkadar dikira, bukan diterima');
// 120 km at RM0.60 = RM72.00. The applicant supplies the distance, never the ringgit.
check('120 km pada RM0.60', claimAmountFor({ ratePerUnit: 0.6, quantity: 120 }), 72);
check('kategori rata tiada kadar', claimAmountFor({ ratePerUnit: null, quantity: null }), null);
check(
  'kadar tanpa kuantiti bukan nombor',
  Number.isNaN(claimAmountFor({ ratePerUnit: 0.6, quantity: null }) as number),
  true,
);
// Rounded once at the end: 33 × 0.605 = 19.965 → 19.97, not 19.96.
check('dibundarkan sekali di akhir', ratedAmount(33, 0.605), 19.97);

console.log('\nTuntutan rata');
check('kes asas diterima', checkClaim(flat), null);
check('tarikh hari ini diterima', checkClaim({ ...flat, incurredOn: TODAY }), null);
check(
  'tarikh masa hadapan ditolak',
  checkClaim({ ...flat, incurredOn: '2026-09-11' })?.key,
  'claim.refuse.future',
);
check(
  'tarikh tidak sah ditolak',
  checkClaim({ ...flat, incurredOn: '10-09-2026' })?.key,
  'claim.refuse.badDate',
);
// A year back is generous; beyond that it is a slip rather than a late claim.
check(
  'tepat setahun diterima',
  checkClaim({ ...flat, incurredOn: '2025-09-10' }),
  null,
);
check(
  'lebih setahun ditolak',
  checkClaim({ ...flat, incurredOn: '2025-09-09' })?.key,
  'claim.refuse.tooOld',
);
check('jumlah sifar ditolak', checkClaim({ ...flat, amount: 0 })?.key, 'claim.refuse.noAmount');
check(
  'jumlah negatif ditolak',
  checkClaim({ ...flat, amount: -5 })?.key,
  'claim.refuse.noAmount',
);

console.log('\nHad kategori');
check('tepat pada had diterima', checkClaim({ ...flat, amount: 100, maxAmount: 100 }), null);
check(
  'melebihi had ditolak',
  checkClaim({ ...flat, amount: 100.01, maxAmount: 100 })?.key,
  'claim.refuse.overCap',
);
check('tiada had bermakna tiada had', checkClaim({ ...flat, amount: 99_999 }), null);
check(
  'melebihi had mutlak ditolak',
  checkClaim({ ...flat, amount: 100_001 })?.key,
  'claim.refuse.tooLarge',
);

console.log('\nResit');
check(
  'resit diperlukan tetapi tiada',
  checkClaim({ ...flat, hasReceipt: false })?.key,
  'claim.refuse.noReceipt',
);
check(
  'resit tidak diperlukan',
  checkClaim({ ...flat, requiresReceipt: false, hasReceipt: false }),
  null,
);

console.log('\nKategori berkadar perlukan kuantiti');
const rated = { ...flat, ratePerUnit: 0.6, requiresReceipt: false, hasReceipt: false };
check('kuantiti dibekalkan', checkClaim({ ...rated, quantity: 120, amount: 72 }), null);
check(
  'kuantiti tiada ditolak',
  checkClaim({ ...rated, quantity: null, amount: 72 })?.key,
  'claim.refuse.noQuantity',
);
check(
  'kuantiti sifar ditolak',
  checkClaim({ ...rated, quantity: 0, amount: 72 })?.key,
  'claim.refuse.noQuantity',
);

console.log('\nJumlah yang diluluskan');
check('sama dengan dituntut', checkApprovedAmount({ claimed: 100, approved: 100 }), null);
/*
 * Less than claimed is legitimate: a receipt above the cap is approved at the cap, and an
 * approver may disallow part of a claim with a note.
 */
check('kurang daripada dituntut', checkApprovedAmount({ claimed: 100, approved: 60 }), null);
check(
  'lebih daripada dituntut ditolak',
  checkApprovedAmount({ claimed: 100, approved: 100.01 })?.key,
  'claim.refuse.aboveClaimed',
);
check(
  'sifar ditolak',
  checkApprovedAmount({ claimed: 100, approved: 0 })?.key,
  'claim.refuse.noApprovedAmount',
);
// Compared after rounding, so float noise cannot refuse an equal amount.
check(
  'sempadan sen tidak menolak yang sama',
  checkApprovedAmount({ claimed: toSen(0.1 + 0.2), approved: 0.3 }),
  null,
);

/*
 * Multi-line claims.
 *
 * The split between the two functions is the whole point, and it is the thing that would be wrong in
 * a way nobody notices: the category cap is a ceiling on the CLAIM, so four lines of RM900 must fail
 * a RM1,000 cap. Checked per line, they would all pass.
 */
console.log('\nBaris tuntutan');

const line = {
  incurredOn: '2026-09-10',
  today: '2026-09-20',
  requiresReceipt: false,
  hasReceipt: false,
  ratePerUnit: null,
  quantity: null,
};

check('baris sah', checkClaimLine({ ...line, amount: 50 }), null);
check('baris tanpa jumlah ditolak', checkClaimLine({ ...line, amount: 0 })?.key, 'claim.refuse.noAmount');
check(
  'baris masa depan ditolak',
  checkClaimLine({ ...line, incurredOn: '2026-09-21', amount: 50 })?.key,
  'claim.refuse.future',
);
// Quantity is per line now, so a rated line without one is refused on its own account.
check(
  'baris berkadar tanpa kuantiti ditolak',
  checkClaimLine({ ...line, amount: 72, ratePerUnit: 0.6, quantity: null })?.key,
  'claim.refuse.noQuantity',
);
check(
  'baris berkadar dengan kuantiti diterima',
  checkClaimLine({ ...line, amount: 72, ratePerUnit: 0.6, quantity: 120 }),
  null,
);
// `requiresReceipt` means every line, so a line with none is refused even if a sibling has one.
check(
  'baris tanpa resit ditolak bila kategori menuntutnya',
  checkClaimLine({ ...line, amount: 50, requiresReceipt: true, hasReceipt: false })?.key,
  'claim.refuse.noReceipt',
);

console.log('\nJumlah tuntutan');
check('jumlah dalam had', checkClaimTotal({ lineCount: 3, amount: 900, maxAmount: 1000 }), null);
check(
  'tiada baris ditolak',
  checkClaimTotal({ lineCount: 0, amount: 0, maxAmount: null })?.key,
  'claim.refuse.noLines',
);
/*
 * The assertion that matters. Four RM900 lines is RM3,600 against a RM1,000 cap — each line is well
 * inside it and the claim is not. Per-line checking would have let this through.
 */
check(
  'empat baris RM900 gagal had RM1000',
  checkClaimTotal({ lineCount: 4, amount: 3600, maxAmount: 1000 })?.key,
  'claim.refuse.overCap',
);
check(
  'melebihi had mutlak ditolak',
  checkClaimTotal({ lineCount: 1, amount: 100_001, maxAmount: null })?.key,
  'claim.refuse.tooLarge',
);
// Summed in sen before comparing, so a run of two-decimal lines cannot drift past a cap by a cent.
check(
  'sempadan sen tidak menolak jumlah yang tepat pada had',
  checkClaimTotal({ lineCount: 3, amount: toSen(0.1 + 0.2), maxAmount: 0.3 }),
  null,
);

console.log('\nJarak hari');
check('hari sama', daysBetween('2026-09-10', '2026-09-10'), 0);
check('merentas bulan', daysBetween('2026-08-31', '2026-09-01'), 1);
// UTC has no daylight saving, so a 24-hour step is exact across any boundary.
check('merentas tahun', daysBetween('2025-12-31', '2026-01-01'), 1);
check('had ke belakang', MAX_BACKDATE_DAYS, 365);

console.log(`\n${passed} lulus, ${failed} gagal\n`);
process.exit(failed > 0 ? 1 : 0);
