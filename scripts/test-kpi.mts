/**
 * Regression suite for the KPI rules. No server and no database.
 *
 * The ones that matter most all fail silently: weights that do not sum to 100, grade bands with a
 * gap, rounding applied per line instead of once at the end, and a boundary score grading
 * differently on two screens. Each produces a real-looking percentage that is wrong, and a grade
 * boundary is where a bonus changes.
 */
import {
  ASSIGNMENT_STATUSES,
  COMPETENCY_CATEGORIES,
  MAX_BONUS_MONTHS,
  PERIOD_STATUSES,
  SCORE_MAX,
  TOTAL_WEIGHT,
  assignmentSettled,
  assignmentTransitionAllowed,
  auditBands,
  auditTemplateItems,
  bandFor,
  checkBands,
  checkBonusMonths,
  checkComplete,
  checkCompetency,
  checkPeriod,
  checkReviewer,
  checkScore,
  checkWeights,
  equaliseWeights,
  normaliseCompetencyName,
  periodTransitionAllowed,
  scoringOpen,
  weightedScore,
} from '../apps/server/src/hr/kpi.js';
import { kpiBonusAmount } from '../apps/server/src/hr/payroll.js';

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

console.log('\nKatalog kompetensi');
check('nama biasa diterima', checkCompetency({ name: 'Komunikasi', category: 'core' }), null);
check('tiga kategori', COMPETENCY_CATEGORIES.length, 3);
check(
  'kategori tidak dikenali ditolak',
  checkCompetency({ name: 'Komunikasi', category: 'strategic' })?.key,
  'kpi.refuse.competencyCategory',
);
check(
  'nama kosong ditolak',
  checkCompetency({ name: '   ', category: 'core' })?.key,
  'kpi.refuse.competencyName',
);
/*
 * Whitespace is the cheapest way to defeat a unique index, and the catalogue exists to stop one
 * competency being several spellings of itself.
 */
check('ruang di hujung dibuang', normaliseCompetencyName('  Komunikasi  '), 'Komunikasi');
check('ruang berganda diruntuhkan', normaliseCompetencyName('Kerja   Berpasukan'), 'Kerja Berpasukan');
check('tab dianggap ruang', normaliseCompetencyName('Kualiti\tKerja'), 'Kualiti Kerja');
check('nama bersih tidak berubah', normaliseCompetencyName('Disiplin'), 'Disiplin');

console.log('\nPemberat borang mesti berjumlah 100');
check('empat pemberat 25', checkWeights([25, 25, 25, 25]), null);
check('dua pemberat 50', checkWeights([50, 50]), null);
/*
 * Thirds cannot be expressed exactly in two decimals. One sen of slack accepts the honest
 * rounding without accepting a form that is genuinely short.
 */
check('pertiga dengan pembundaran jujur', checkWeights([33.33, 33.33, 33.34]), null);
check('99.99 diterima dalam toleransi', checkWeights([33.33, 33.33, 33.33]), null);
check('jumlah 90 ditolak', checkWeights([30, 30, 30])?.key, 'kpi.refuse.weightSum');
check('jumlah 110 ditolak', checkWeights([50, 60])?.key, 'kpi.refuse.weightSum');
check('borang kosong ditolak', checkWeights([])?.key, 'kpi.refuse.noItems');
check('pemberat sifar ditolak', checkWeights([0, 100])?.key, 'kpi.refuse.badWeight');
check('pemberat negatif ditolak', checkWeights([-10, 110])?.key, 'kpi.refuse.badWeight');
check('satu pemberat 100 diterima', checkWeights([100]), null);

console.log('\nPemberat sama rata');
check('dua baris', equaliseWeights(2), [50, 50]);
check('empat baris', equaliseWeights(4), [25, 25, 25, 25]);
// The remainder goes on the last row, so the numbers a reader sees are 33.33/33.33/33.34.
check('tiga baris — baki pada baris akhir', equaliseWeights(3), [33.33, 33.33, 33.34]);
check('tiga baris berjumlah tepat 100', checkWeights(equaliseWeights(3)), null);
check('tujuh baris berjumlah tepat 100', checkWeights(equaliseWeights(7)), null);
check('sebelas baris berjumlah tepat 100', checkWeights(equaliseWeights(11)), null);
check('satu baris', equaliseWeights(1), [100]);
check('sifar baris kosong', equaliseWeights(0), []);

console.log('\nAudit borang menyenaraikan SEMUA kesalahan');
check(
  'borang betul tiada kesalahan',
  auditTemplateItems([
    { competencyName: 'Kualiti Kerja', weight: 60 },
    { competencyName: 'Komunikasi', weight: 40 },
  ]),
  [],
);
check(
  'borang kosong',
  auditTemplateItems([]).map((fault) => fault.key),
  ['kpi.audit.noItems'],
);
check(
  'jumlah terkurang dinamakan',
  auditTemplateItems([{ competencyName: 'A', weight: 90 }])[0],
  { key: 'kpi.audit.weightUnder', vars: { total: '90.00', difference: '10.00' } },
);
check(
  'jumlah terlebih dinamakan',
  auditTemplateItems([{ competencyName: 'A', weight: 130 }])[0],
  { key: 'kpi.audit.weightOver', vars: { total: '130.00', difference: '30.00' } },
);
/*
 * Two faults at once. A banner that reveals its second problem only after you fix the first is a
 * banner people stop reading.
 */
check(
  'jumlah salah DAN kompetensi berulang dilaporkan bersama',
  auditTemplateItems([
    { competencyName: 'Komunikasi', weight: 30 },
    { competencyName: 'Komunikasi', weight: 30 },
  ]).map((fault) => fault.key),
  ['kpi.audit.weightUnder', 'kpi.audit.duplicateCompetency'],
);
// Case and stray whitespace do not make it a different competency.
check(
  'berulang walaupun ejaan huruf berbeza',
  auditTemplateItems([
    { competencyName: 'Komunikasi', weight: 50 },
    { competencyName: '  komunikasi ', weight: 50 },
  ]).map((fault) => fault.key),
  ['kpi.audit.duplicateCompetency'],
);

console.log('\nMarkah berpemberat — SUM(markah x pemberat) / SUM(pemberat)');
check('markah penuh', weightedScore([{ score: 100, weight: 50 }, { score: 100, weight: 50 }]), 100);
check('separuh markah', weightedScore([{ score: 50, weight: 100 }]), 50);
check(
  'pemberat berbeza',
  weightedScore([{ score: 100, weight: 70 }, { score: 20, weight: 30 }]),
  76,
);
/*
 * Divided by the weights present, not by 100. A form summing to 90 still scores out of 100 — so a
 * form that slipped past `checkWeights` cannot silently mark everybody 10% low.
 */
check(
  'borang berjumlah 90 masih memberi markah atas 100',
  weightedScore([{ score: 80, weight: 45 }, { score: 80, weight: 45 }]),
  80,
);
check(
  'borang berjumlah 200 masih memberi markah atas 100',
  weightedScore([{ score: 60, weight: 100 }, { score: 80, weight: 100 }]),
  70,
);
/*
 * Rounded once at the end. Rounding each contribution first drifts by hundredths, which is enough
 * to move somebody across a grade boundary.
 */
check(
  'dibundarkan sekali di akhir',
  weightedScore([
    { score: 80, weight: 33.33 },
    { score: 80, weight: 33.33 },
    { score: 80, weight: 33.34 },
  ]),
  80,
);
/*
 * Unanswered lines drop out of both halves rather than counting as zero. This feeds the running
 * total on a half-filled form, and counting the blanks as zero would show a reviewer 12% after
 * their first answer of 60.
 */
check(
  'baris belum dijawab dilangkau, bukan dikira sifar',
  weightedScore([
    { score: 60, weight: 20 },
    { score: null, weight: 80 },
  ]),
  60,
);
check(
  'satu daripada lima dijawab',
  weightedScore([
    { score: 90, weight: 20 },
    { score: null, weight: 20 },
    { score: null, weight: 20 },
    { score: null, weight: 20 },
    { score: null, weight: 20 },
  ]),
  90,
);
check('markah sifar dikira, bukan dilangkau', weightedScore([{ score: 0, weight: 100 }]), 0);
check(
  'tiada apa dijawab bukan nombor',
  Number.isNaN(weightedScore([{ score: null, weight: 100 }])),
  true,
);
check('tiada baris bukan nombor', Number.isNaN(weightedScore([])), true);
check('markah maksimum ialah 100', SCORE_MAX, 100);

console.log('\nMarkah 0–100, tiada skala boleh dikonfigurasikan');
check('100 diterima', checkScore(100), null);
check('sifar diterima', checkScore(0), null);
check('pecahan diterima', checkScore(72.5), null);
check('melebihi 100 ditolak', checkScore(101)?.key, 'kpi.refuse.scoreRange');
check('negatif ditolak', checkScore(-1)?.key, 'kpi.refuse.scoreRange');
check('bukan nombor ditolak', checkScore(Number.NaN)?.key, 'kpi.refuse.badScore');

console.log('\nSemakan tidak lengkap tidak boleh dihantar');
check('semua dijawab', checkComplete({ lineCount: 4, scoredCount: 4 }), null);
check(
  'satu tertinggal ditolak',
  checkComplete({ lineCount: 4, scoredCount: 3 })?.key,
  'kpi.refuse.incomplete',
);
check('baki dinyatakan', checkComplete({ lineCount: 5, scoredCount: 2 })?.vars, {
  scored: 2,
  total: 5,
});
check('borang tanpa baris ditolak', checkComplete({ lineCount: 0, scoredCount: 0 })?.key, 'kpi.refuse.noItems');

console.log('\nJalur gred mesti melitupi 0–100 tepat sekali');
const bands = [
  { code: 'E', minScore: 0, maxScore: 39.99 },
  { code: 'D', minScore: 40, maxScore: 54.99 },
  { code: 'C', minScore: 55, maxScore: 69.99 },
  { code: 'B', minScore: 70, maxScore: 84.99 },
  { code: 'A', minScore: 85, maxScore: 100 },
];
check('jalur bersambung diterima', checkBands(bands), null);
check('lima jalur tiada kesalahan', auditBands(bands), []);
check('satu jalur penuh diterima', checkBands([{ code: 'P', minScore: 0, maxScore: 100 }]), null);
check('tiada jalur ditolak', checkBands([])?.key, 'kpi.refuse.noBands');
check(
  'jalur bertindih ditolak',
  checkBands([
    { code: 'X', minScore: 0, maxScore: 60 },
    { code: 'Y', minScore: 50, maxScore: 100 },
  ])?.key,
  'kpi.refuse.bandOverlap',
);
// A gap means a score that earns no grade at all, on a review somebody has already signed.
check(
  'jurang jalur ditolak',
  checkBands([
    { code: 'X', minScore: 0, maxScore: 59 },
    { code: 'Y', minScore: 60, maxScore: 100 },
  ])?.key,
  'kpi.refuse.bandGap',
);
// The gap names the range nobody can score into, not just the two codes either side of it.
check(
  'jurang menamakan julat yang tiada gred',
  auditBands([
    { code: 'X', minScore: 0, maxScore: 59 },
    { code: 'Y', minScore: 70, maxScore: 100 },
  ])[0]?.vars,
  { first: 'X', second: 'Y', from: '59.01', to: '69.99' },
);
check(
  'tidak bermula pada sifar ditolak',
  checkBands([{ code: 'X', minScore: 10, maxScore: 100 }])?.key,
  'kpi.refuse.bandStart',
);
check(
  'tidak berakhir pada 100 ditolak',
  checkBands([{ code: 'X', minScore: 0, maxScore: 90 }])?.key,
  'kpi.refuse.bandEnd',
);
check(
  'min melebihi max ditolak',
  checkBands([{ code: 'X', minScore: 80, maxScore: 20 }])?.key,
  'kpi.refuse.bandOrder',
);
check(
  'jalur luar 0-100 ditolak',
  checkBands([{ code: 'X', minScore: 0, maxScore: 120 }])?.key,
  'kpi.refuse.bandRange',
);
check(
  'kod gred berulang ditolak',
  checkBands([
    { code: 'A', minScore: 0, maxScore: 49.99 },
    { code: 'A', minScore: 50, maxScore: 100 },
  ])?.key,
  'kpi.refuse.bandDuplicate',
);
/*
 * Every fault at once. `checkBands` returns the first for a refusal; `auditBands` returns all of
 * them for the banner on the screen where they get fixed.
 */
check(
  'audit melaporkan permulaan DAN penghujung sekali gus',
  auditBands([{ code: 'X', minScore: 10, maxScore: 90 }]).map((fault) => fault.key),
  ['kpi.refuse.bandStart', 'kpi.refuse.bandEnd'],
);
// Ordering faults are not meaningful once a band carries a nonsense number, so they are withheld.
check(
  'nombor tidak sah menahan semakan susunan',
  auditBands([{ code: 'X', minScore: Number.NaN, maxScore: 90 }]).map((fault) => fault.key),
  ['kpi.refuse.badBand'],
);

console.log('\nGred: jalur tertinggi yang lantainya dicapai');
check('100 dapat A', bandFor(100, bands), 'A');
check('85 tepat pada sempadan dapat A', bandFor(85, bands), 'A');
check('84.99 dapat B', bandFor(84.99, bands), 'B');
check('70 tepat pada sempadan dapat B', bandFor(70, bands), 'B');
check('55 dapat C', bandFor(55, bands), 'C');
check('40 dapat D', bandFor(40, bands), 'D');
check('0 dapat E', bandFor(0, bands), 'E');
/*
 * Only `minScore` is consulted, so a score on a boundary always takes the better grade — the same
 * answer on the results screen as on the review form. Reading `min <= x <= max` over an ascending
 * list makes the answer depend on list order wherever two bands touch.
 */
check(
  'sempadan bertindih tetap dapat gred lebih baik',
  bandFor(85, [
    { code: 'B', minScore: 70, maxScore: 85 },
    { code: 'A', minScore: 85, maxScore: 100 },
  ]),
  'A',
);
check(
  'susunan senarai tidak mengubah jawapan',
  bandFor(85, [
    { code: 'A', minScore: 85, maxScore: 100 },
    { code: 'B', minScore: 70, maxScore: 85 },
  ]),
  'A',
);
/*
 * A perfect score above every ceiling still grades. `auditBands` is where a top band stopping
 * short of 100 gets reported; refusing to grade is not the way to report a settings fault.
 */
check(
  'markah di atas setiap siling masih dapat gred',
  bandFor(100, [{ code: 'A', minScore: 85, maxScore: 95 }]),
  'A',
);
check('markah di bawah setiap lantai tiada gred', bandFor(5, [{ code: 'A', minScore: 60, maxScore: 100 }]), null);
check('bukan nombor tiada gred', bandFor(Number.NaN, bands), null);

console.log('\nBonus dalam bulan gaji asas');
check('siling 12 bulan', MAX_BONUS_MONTHS, 12);
check('tiada bonus diterima', checkBonusMonths(null), null);
check('satu bulan diterima', checkBonusMonths(1), null);
check('dua bulan setengah diterima', checkBonusMonths(2.5), null);
check('tepat pada siling diterima', checkBonusMonths(12), null);
/*
 * Zero is the same statement as null written in a way that reads as an amount, and `0.00 bulan` on
 * a screen invites somebody to wonder whether it failed to save.
 */
check('sifar bulan ditolak', checkBonusMonths(0)?.key, 'kpi.refuse.bonusZero');
check('negatif ditolak', checkBonusMonths(-1)?.key, 'kpi.refuse.bonusZero');
// The ceiling is a typo guard: a stray zero turns one month into ten.
check('melebihi siling ditolak', checkBonusMonths(20)?.key, 'kpi.refuse.bonusCeiling');
check('siling dinamakan dalam penolakan', checkBonusMonths(20)?.vars, { months: 20, max: 12 });
check('bukan nombor ditolak', checkBonusMonths(Number.NaN)?.key, 'kpi.refuse.badBonus');

console.log('\nAmaun bonus dari gred');
check('dua bulan atas 3000', kpiBonusAmount(3000, 2), 6000);
check('satu bulan setengah atas 4200', kpiBonusAmount(4200, 1.5), 6300);
check('gred tanpa bonus bayar sifar', kpiBonusAmount(3000, null), 0);
check('tiada gaji asas bayar sifar', kpiBonusAmount(0, 2), 0);
// Clamped rather than refused: by the time a payroll run reads a stored grade, the only choices
// left are to pay a wrong figure or a capped one, and a capped one shows up in the payslip line.
check('melebihi siling diapit pada 12 bulan', kpiBonusAmount(1000, 100), 12000);
check('sen dibundarkan betul', kpiBonusAmount(1500.15, 1), 1500.15);

console.log('\nKitaran hayat tempoh');
check('buka → tutup', periodTransitionAllowed('open', 'closed'), true);
// Reopening would let a figure that was paid on change underneath the payment.
check('tutup → buka ditolak', periodTransitionAllowed('closed', 'open'), false);
// There is no draft. A period that cannot be assigned to is a row nobody can act on.
check('dua status tempoh sahaja', PERIOD_STATUSES.length, 2);
check('tiada status draf', (PERIOD_STATUSES as readonly string[]).includes('draft'), false);

console.log('\nKitaran hayat penugasan');
check('menunggu → sedang dibuat', assignmentTransitionAllowed('pending', 'inProgress'), true);
check('sedang dibuat → dihantar', assignmentTransitionAllowed('inProgress', 'submitted'), true);
check('dihantar → dimuktamadkan', assignmentTransitionAllowed('submitted', 'finalised'), true);
check('dihantar → sedang dibuat dibenarkan', assignmentTransitionAllowed('submitted', 'inProgress'), true);
check('menunggu → dihantar ditolak', assignmentTransitionAllowed('pending', 'submitted'), false);
check('dimuktamadkan terminal', assignmentSettled('finalised'), true);
check('dimuktamadkan tiada langkah', assignmentTransitionAllowed('finalised', 'inProgress'), false);
check('empat status penugasan', ASSIGNMENT_STATUSES.length, 4);

console.log('\nBila markah boleh ditulis');
check(
  'tempoh buka, sedang dibuat',
  scoringOpen({ periodStatus: 'open', assignmentStatus: 'inProgress' }),
  null,
);
check(
  'tempoh ditutup ditolak',
  scoringOpen({ periodStatus: 'closed', assignmentStatus: 'inProgress' })?.key,
  'kpi.refuse.periodClosed',
);
check(
  'penugasan dimuktamadkan ditolak',
  scoringOpen({ periodStatus: 'open', assignmentStatus: 'finalised' })?.key,
  'kpi.refuse.assignmentFinalised',
);

console.log('\nPenilai — seorang, dinamakan');
check('penilai berbeza dari subjek', checkReviewer({ subjectStaffId: 1, reviewerStaffId: 2 }), null);
// Reviewing yourself is not a review.
check(
  'menilai diri sendiri ditolak',
  checkReviewer({ subjectStaffId: 1, reviewerStaffId: 1 })?.key,
  'kpi.refuse.selfReview',
);
check('penilai tanpa rekod staf diterima', checkReviewer({ subjectStaffId: 1, reviewerStaffId: null }), null);

console.log('\nSemakan tempoh');
const period = { fromDate: '2026-01-01', toDate: '2026-06-30', dueOn: '2026-07-15' };
check('kes asas diterima', checkPeriod(period), null);
check('jatuh tempo sama dengan hujung', checkPeriod({ ...period, dueOn: '2026-06-30' }), null);
// A due date inside the period asks somebody to grade work that has not happened yet.
check(
  'jatuh tempo sebelum hujung ditolak',
  checkPeriod({ ...period, dueOn: '2026-06-01' })?.key,
  'kpi.refuse.dueBeforeEnd',
);
check(
  'hujung sebelum mula ditolak',
  checkPeriod({ ...period, toDate: '2025-12-31' })?.key,
  'kpi.refuse.periodOrder',
);
check(
  'tarikh tidak sah ditolak',
  checkPeriod({ ...period, fromDate: '01-01-2026' })?.key,
  'kpi.refuse.badDate',
);
check('jumlah pemberat ialah 100', TOTAL_WEIGHT, 100);

console.log(`\n${passed} lulus, ${failed} gagal\n`);
process.exit(failed > 0 ? 1 : 0);
