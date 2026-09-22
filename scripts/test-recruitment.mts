/**
 * Regression suite for the recruitment state machines. No server and no database.
 *
 * Two invariants worth more than the rest: a rejected candidate cannot walk back into an offer,
 * and a posting cannot be filled past the vacancies it advertised. Both are decisions nobody
 * would have made deliberately, and both are silent when they go wrong.
 */
import {
  APPLICANT_STATUSES,
  POSTING_STATUSES,
  applicantTransitionAllowed,
  canPublish,
  checkHireable,
  checkPosting,
  checkVacancy,
  isTerminal,
  nextApplicantStatuses,
  postingTransitionAllowed,
  type ApplicantStatus,
} from '../apps/server/src/hr/recruitment.js';

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

console.log('\nKitaran hayat iklan');
check('draft boleh diterbitkan', canPublish('draft'), true);
check('yang sudah terbit tidak boleh terbit lagi', canPublish('published'), false);
check('terbit → tutup', postingTransitionAllowed('published', 'closed'), true);
/*
 * Forward only. Reopening a closed post quietly extends a deadline some candidates were already
 * told had passed.
 */
check('tutup → terbit ditolak', postingTransitionAllowed('closed', 'published'), false);
check('tutup → draf ditolak', postingTransitionAllowed('closed', 'draft'), false);
check('draf → tutup ditolak', postingTransitionAllowed('draft', 'closed'), false);
check('tiga status sahaja', POSTING_STATUSES.length, 3);

console.log('\nSaluran pemohon');
check('baharu → saringan', applicantTransitionAllowed('new', 'screening'), true);
check('saringan → temuduga', applicantTransitionAllowed('screening', 'interview'), true);
check('temuduga → tawaran', applicantTransitionAllowed('interview', 'offered'), true);
check('tawaran → diambil', applicantTransitionAllowed('offered', 'hired'), true);
/*
 * Hiring somebody never offered the post skips the step where terms were agreed — and that step
 * is the one an employment dispute turns on.
 */
check('temuduga → diambil ditolak', applicantTransitionAllowed('interview', 'hired'), false);
check('baharu → diambil ditolak', applicantTransitionAllowed('new', 'hired'), false);
check('saringan → tawaran ditolak', applicantTransitionAllowed('screening', 'offered'), false);

console.log('\nStatus terminal tidak boleh berpatah balik');
for (const status of ['hired', 'rejected', 'withdrawn'] as ApplicantStatus[]) {
  check(`${status} terminal`, isTerminal(status), true);
  check(`${status} tiada langkah seterusnya`, nextApplicantStatuses(status).length, 0);
}
check('ditolak → tawaran ditolak', applicantTransitionAllowed('rejected', 'offered'), false);
check('diambil → ditolak ditolak', applicantTransitionAllowed('hired', 'rejected'), false);
check('tarik diri → saringan ditolak', applicantTransitionAllowed('withdrawn', 'screening'), false);

console.log('\nTolak dan tarik diri boleh dari mana-mana peringkat hidup');
for (const status of ['new', 'screening', 'interview', 'offered'] as ApplicantStatus[]) {
  check(`${status} → ditolak`, applicantTransitionAllowed(status, 'rejected'), true);
  check(`${status} → tarik diri`, applicantTransitionAllowed(status, 'withdrawn'), true);
}
check('tujuh status saluran', APPLICANT_STATUSES.length, 7);

console.log('\nHad kekosongan');
check('satu kekosongan, belum diambil', checkVacancy({ positions: 1, hired: 0 }), null);
check('dua kekosongan, satu diambil', checkVacancy({ positions: 2, hired: 1 }), null);
// A post advertised for two that quietly hires four is a headcount decision made by nobody.
check(
  'penuh ditolak',
  checkVacancy({ positions: 2, hired: 2 })?.key,
  'recruit.refuse.noVacancy',
);
check(
  'terlebih penuh ditolak',
  checkVacancy({ positions: 1, hired: 3 })?.key,
  'recruit.refuse.noVacancy',
);

console.log('\nSemakan iklan');
const posting = {
  openedOn: '2026-09-01',
  closesOn: '2026-09-30',
  today: '2026-09-10',
  positions: 2,
  salaryMin: 2500,
  salaryMax: 3500,
};
check('kes asas diterima', checkPosting(posting), null);
check('tiada tarikh tutup diterima', checkPosting({ ...posting, closesOn: null }), null);
check(
  'tutup sebelum buka ditolak',
  checkPosting({ ...posting, closesOn: '2026-08-31' })?.key,
  'recruit.refuse.closesBeforeOpens',
);
check('tutup sama hari diterima', checkPosting({ ...posting, closesOn: '2026-09-01' }), null);
check(
  'tarikh tidak sah ditolak',
  checkPosting({ ...posting, openedOn: '01-09-2026' })?.key,
  'recruit.refuse.badDate',
);
check(
  'kekosongan sifar ditolak',
  checkPosting({ ...posting, positions: 0 })?.key,
  'recruit.refuse.noPositions',
);
check(
  'kekosongan pecahan ditolak',
  checkPosting({ ...posting, positions: 1.5 })?.key,
  'recruit.refuse.noPositions',
);
check(
  'gaji min melebihi max ditolak',
  checkPosting({ ...posting, salaryMin: 4000 })?.key,
  'recruit.refuse.salaryOrder',
);
check('julat gaji sama diterima', checkPosting({ ...posting, salaryMin: 3500 }), null);
check('tiada julat gaji diterima', checkPosting({ ...posting, salaryMin: null, salaryMax: null }), null);
check(
  'gaji negatif ditolak',
  checkPosting({ ...posting, salaryMin: -1 })?.key,
  'recruit.refuse.badSalary',
);

console.log('\nBoleh diambil sebagai staf');
check('nama dan KP ada', checkHireable({ fullName: 'Ali bin Abu', icNo: '880101015123' }), null);
/*
 * Checked at hire, not at application. A candidate applies with whatever they have; an employee
 * needs an IC because payroll and the statutory returns are keyed on it.
 */
check(
  'tiada KP ditolak',
  checkHireable({ fullName: 'Ali bin Abu', icNo: null })?.key,
  'recruit.refuse.noIc',
);
check(
  'KP kosong ditolak',
  checkHireable({ fullName: 'Ali bin Abu', icNo: '   ' })?.key,
  'recruit.refuse.noIc',
);
check(
  'tiada nama ditolak',
  checkHireable({ fullName: '  ', icNo: '880101015123' })?.key,
  'recruit.refuse.noName',
);

console.log(`\n${passed} lulus, ${failed} gagal\n`);
process.exit(failed > 0 ? 1 : 0);
