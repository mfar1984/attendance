/**
 * Regression suite for the payroll arithmetic. No server and no database.
 *
 * The failures worth guarding against here all look plausible on screen:
 *
 *   - **The EPF employer step read at the wrong side of the threshold.** The statutory rate drops
 *     above the threshold, so `>=` instead of `>` moves everybody sitting exactly on a round salary
 *     figure to the wrong rate — and RM5,000 is a very common salary.
 *   - **A missing SOCSO/EIS ceiling.** An employee on RM12,000 charged twice the legal maximum,
 *     straight out of net pay, with a payslip that adds up perfectly.
 *   - **Overtime inside a statutory base.** Overtime pay is not EPF wages.
 *   - **Rounding at the wrong point.** `Math.round(v * 100) / 100` is a sen short at exactly the
 *     boundary it exists to handle. Guarded in `test-time`'s sibling for `toSen`; guarded again
 *     here because a payslip is where the sen is noticed.
 *   - **The last instalment taking the full amount.** A RM250 instalment against a RM40 balance
 *     collects RM210 that is not owed, and the balance goes negative where nobody looks.
 *   - **Overlapping periods.** Two cycles covering one day pay that day twice, from two payslips
 *     that each look right on their own.
 */
import {
  PERIOD_STATUSES,
  STATUTORY_DEFAULTS,
  allowanceValue,
  capped,
  checkStatutory,
  checkTransition,
  computePayslip,
  findOverlap,
  instalmentDue,
  isRebuildable,
  isWritable,
  kpiBonusAmount,
  monthlyRecovery,
  parseStatutory,
  payslipBalances,
} from '../apps/server/src/hr/payroll.js';

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

// ---------------------------------------------------------------------------
console.log('\nSiling upah');
// ---------------------------------------------------------------------------

check('bawah siling tidak dipotong', capped(4000, 6000), 4000);
check('atas siling diapit', capped(12000, 6000), 6000);
check('tepat pada siling', capped(6000, 6000), 6000);
check('siling 0 bermakna tiada siling', capped(12000, 0), 12000);
check('siling negatif diabaikan', capped(12000, -1), 12000);
check('upah negatif jadi sifar', capped(-500, 6000), 0);

// ---------------------------------------------------------------------------
console.log('\nLangkah kadar majikan KWSP pada ambang');
// ---------------------------------------------------------------------------

/*
 * The step is "above the threshold", so the threshold itself is on the LOWER side of it and takes
 * the higher rate. `>=` here would move every employee on exactly RM5,000 to 12% — which is a
 * common salary, and the error is 1% of wages every month, paid by the employer.
 */
const atThreshold = computePayslip({ basicSalary: 5000 }, {});
check('tepat pada ambang guna kadar 13%', atThreshold.epfEmployer, 650);

const aboveThreshold = computePayslip({ basicSalary: 5000.01 }, {});
check('satu sen di atas ambang guna kadar 12%', aboveThreshold.epfEmployer, 600);

const belowThreshold = computePayslip({ basicSalary: 3000 }, {});
check('bawah ambang guna kadar 13%', belowThreshold.epfEmployer, 390);

// ---------------------------------------------------------------------------
console.log('\nLebih masa di luar setiap asas statutori');
// ---------------------------------------------------------------------------

const withOvertime = computePayslip({ basicSalary: 3000, overtimeAmount: 500 }, {});
check('lebih masa masuk gaji kasar', withOvertime.gross, 3500);
check('lebih masa TIADA dalam upah KWSP', withOvertime.epfWages, 3000);
check('lebih masa TIADA dalam upah bercarum', withOvertime.contributoryWages, 3000);
check('KWSP pekerja atas 3000 sahaja', withOvertime.epfEmployee, 330);
check('PERKESO pekerja atas 3000 sahaja', withOvertime.socsoEmployee, 15);
check('SIP pekerja atas 3000 sahaja', withOvertime.eisEmployee, 6);

// ---------------------------------------------------------------------------
console.log('\nElaun: yang bercarum dan yang dikecualikan');
// ---------------------------------------------------------------------------

const mixedAllowance = computePayslip(
  { basicSalary: 3000, allowanceEpfLiable: 500, allowanceExempt: 200 },
  {},
);
check('kedua-dua elaun masuk gaji kasar', mixedAllowance.gross, 3700);
check('hanya elaun bercarum dalam upah KWSP', mixedAllowance.epfWages, 3500);
check('elaun dikecualikan di luar upah bercarum', mixedAllowance.contributoryWages, 3500);
check('KWSP pekerja atas 3500', mixedAllowance.epfEmployee, 385);

// ---------------------------------------------------------------------------
console.log('\nBonus dalam asas KWSP, mengikut tetapan');
// ---------------------------------------------------------------------------

const bonusIn = computePayslip({ basicSalary: 3000, bonusAmount: 1000 }, {});
check('bonus dikira sebagai upah KWSP secara lalai', bonusIn.epfWages, 4000);
check('bonus TIADA dalam upah bercarum PERKESO', bonusIn.contributoryWages, 3000);

const bonusOut = computePayslip(
  { basicSalary: 3000, bonusAmount: 1000 },
  {},
  { ...STATUTORY_DEFAULTS, epfIncludeBonus: false },
);
check('bonus dikecualikan bila tetapan dimatikan', bonusOut.epfWages, 3000);

// ---------------------------------------------------------------------------
console.log('\nSiling PERKESO dan SIP dikuatkuasakan');
// ---------------------------------------------------------------------------

/*
 * Without the ceiling this is 0.5% of 12,000 = RM60 instead of RM30 — double the legal maximum,
 * taken out of net pay every month, on a payslip whose lines add up.
 */
const highEarner = computePayslip({ basicSalary: 12000 }, {});
check('PERKESO pekerja diapit pada 6000', highEarner.socsoEmployee, 30);
check('PERKESO majikan diapit pada 6000', highEarner.socsoEmployer, 105);
check('SIP pekerja diapit pada 6000', highEarner.eisEmployee, 12);
check('SIP majikan diapit pada 6000', highEarner.eisEmployer, 12);
// EPF has a rate step, not a ceiling: it is charged on the whole wage.
check('KWSP tiada siling — dikira atas 12000 penuh', highEarner.epfEmployee, 1320);

// ---------------------------------------------------------------------------
console.log('\nPembundaran ke sen');
// ---------------------------------------------------------------------------

/*
 * 0.2% of 12,345.67 is 24.69134. Stored into a Decimal(12,2) unrounded, MySQL rounds it silently
 * and the payslip lines stop adding up to a figure the employee can compute by hand.
 */
const rounding = computePayslip(
  { basicSalary: 12345.67 },
  {},
  { ...STATUTORY_DEFAULTS, eisWageCeiling: 0 },
);
check('SIP dibundarkan ke dua tempat', rounding.eisEmployee, 24.69);
check('gaji kasar dibundarkan ke dua tempat', rounding.gross, 12345.67);

// The half-up boundary `Math.round(v * 100) / 100` gets wrong. Reachable with ordinary inputs.
check('elaun 15.015 dibundarkan naik, bukan turun', allowanceValue('fixed', 15.015, 0), 15.02);

// ---------------------------------------------------------------------------
console.log('\nSlip mesti seimbang');
// ---------------------------------------------------------------------------

const full = computePayslip(
  {
    basicSalary: 3120,
    allowanceEpfLiable: 450,
    allowanceExempt: 100,
    overtimeAmount: 234.56,
    bonusAmount: 500,
    commissionAmount: 0,
  },
  { taxDeduction: 45, loanDeduction: 250, advanceDeduction: 100, otherDeductions: 0 },
);

check(
  'kasar tolak potongan sama dengan bersih',
  Math.round((full.gross - full.totalDeductions) * 100) / 100,
  full.netPay,
);

check(
  'payslipBalances lulus atas angka enjin sendiri',
  payslipBalances({
    basicSalary: 3120,
    allowanceAmount: 550,
    overtimeAmount: 234.56,
    bonusAmount: 500,
    commissionAmount: 0,
    gross: full.gross,
    epfEmployee: full.epfEmployee,
    socsoEmployee: full.socsoEmployee,
    eisEmployee: full.eisEmployee,
    taxDeduction: 45,
    loanDeduction: 250,
    advanceDeduction: 100,
    otherDeductions: 0,
    totalDeductions: full.totalDeductions,
    netPay: full.netPay,
  }),
  null,
);

// A payslip whose gross does not match its lines is the one failure nothing in the database can
// catch, because Prisma has no generated columns.
check(
  'gaji kasar yang tidak sepadan ditangkap',
  payslipBalances({
    basicSalary: 3000,
    allowanceAmount: 0,
    overtimeAmount: 0,
    bonusAmount: 0,
    commissionAmount: 0,
    gross: 3500,
    epfEmployee: 330,
    socsoEmployee: 15,
    eisEmployee: 6,
    taxDeduction: 0,
    loanDeduction: 0,
    advanceDeduction: 0,
    otherDeductions: 0,
    totalDeductions: 351,
    netPay: 3149,
  }),
  'pay.payslip.fault.gross',
);

check(
  'jumlah potongan yang tidak sepadan ditangkap',
  payslipBalances({
    basicSalary: 3000,
    allowanceAmount: 0,
    overtimeAmount: 0,
    bonusAmount: 0,
    commissionAmount: 0,
    gross: 3000,
    epfEmployee: 330,
    socsoEmployee: 15,
    eisEmployee: 6,
    taxDeduction: 0,
    loanDeduction: 0,
    advanceDeduction: 0,
    otherDeductions: 0,
    totalDeductions: 400,
    netPay: 2600,
  }),
  'pay.payslip.fault.deductions',
);

check(
  'gaji bersih yang tidak sepadan ditangkap',
  payslipBalances({
    basicSalary: 3000,
    allowanceAmount: 0,
    overtimeAmount: 0,
    bonusAmount: 0,
    commissionAmount: 0,
    gross: 3000,
    epfEmployee: 330,
    socsoEmployee: 15,
    eisEmployee: 6,
    taxDeduction: 0,
    loanDeduction: 0,
    advanceDeduction: 0,
    otherDeductions: 0,
    totalDeductions: 351,
    netPay: 2600,
  }),
  'pay.payslip.fault.net',
);

// ---------------------------------------------------------------------------
console.log('\nElaun berkadar');
// ---------------------------------------------------------------------------

check('10% daripada 3120', allowanceValue('percentOfBasic', 10, 3120), 312);
check('amaun tetap tidak dipengaruhi gaji asas', allowanceValue('fixed', 300, 3120), 300);
check('peratus tanpa gaji asas jadi sifar', allowanceValue('percentOfBasic', 10, 0), 0);
check('nilai sifar jadi sifar', allowanceValue('fixed', 0, 3120), 0);
check('nilai negatif jadi sifar', allowanceValue('fixed', -50, 3120), 0);

// ---------------------------------------------------------------------------
console.log('\nAnsuran tidak melebihi baki');
// ---------------------------------------------------------------------------

check('ansuran biasa dipotong penuh', instalmentDue(250, 1000), 250);
/*
 * The last instalment. Taking the contracted RM250 against a RM40 balance collects RM210 that is
 * not owed and leaves the balance at minus RM210 — money owed back to somebody with no way to
 * notice.
 */
check('ansuran terakhir mengambil baki sahaja', instalmentDue(250, 40), 40);
check('baki sifar tiada potongan', instalmentDue(250, 0), 0);
check('baki negatif tiada potongan', instalmentDue(250, -10), 0);
check('ansuran tepat sama dengan baki', instalmentDue(250, 250), 250);

// ---------------------------------------------------------------------------
console.log('\nPotongan pendahuluan diterbitkan');
// ---------------------------------------------------------------------------

check('1200 atas 12 bulan', monthlyRecovery(1200, 12), 100);
check('1000 atas 3 bulan dibundarkan', monthlyRecovery(1000, 3), 333.33);
check('bulan sifar ditolak', monthlyRecovery(1200, 0), 0);
check('bulan pecahan ditolak', monthlyRecovery(1200, 2.5), 0);
check('pokok sifar ditolak', monthlyRecovery(0, 12), 0);

// ---------------------------------------------------------------------------
console.log('\nBonus daripada gred KPI');
// ---------------------------------------------------------------------------

check('faktor 1.5 atas gaji 3120', kpiBonusAmount(3120, 1.5), 4680);
check('faktor 0.5 atas gaji 3120', kpiBonusAmount(3120, 0.5), 1560);
// A grade with no factor is not meant to pay, and zero is the honest answer.
check('gred tanpa faktor tidak membayar', kpiBonusAmount(3120, null), 0);
check('faktor sifar tidak membayar', kpiBonusAmount(3120, 0), 0);
check('tiada gaji asas tidak membayar', kpiBonusAmount(0, 1.5), 0);

// ---------------------------------------------------------------------------
console.log('\nTangga status tempoh');
// ---------------------------------------------------------------------------

check('lima status', PERIOD_STATUSES.length, 5);
check('draf ke proses', checkTransition('draft', 'processing'), null);
check('proses ke lulus', checkTransition('processing', 'approved'), null);
check('lulus ke bayar', checkTransition('approved', 'paid'), null);
check('bayar ke tutup', checkTransition('paid', 'closed'), null);

// No reverse and no skipping: the figures have been signed by then.
check(
  'draf tidak boleh terus ke lulus',
  checkTransition('draft', 'approved'),
  'pay.period.fault.transition',
);
check(
  'lulus tidak boleh balik ke proses',
  checkTransition('approved', 'processing'),
  'pay.period.fault.transition',
);
check(
  'tutup tiada langkah seterusnya',
  checkTransition('closed', 'paid'),
  'pay.period.fault.transition',
);
check('status tidak dikenali ditolak', checkTransition('nonsense', 'paid'), 'pay.period.fault.status');

check('draf boleh ditulis', isWritable('draft'), true);
check('proses boleh ditulis', isWritable('processing'), true);
check('lulus tidak boleh ditulis', isWritable('approved'), false);
// A lock that only exists in the interface is a lock against people using the interface.
check('tutup tidak boleh ditulis', isWritable('closed'), false);
check('hanya draf boleh dibina semula', isRebuildable('draft'), true);
check('proses tidak boleh dibina semula', isRebuildable('processing'), false);

// ---------------------------------------------------------------------------
console.log('\nTempoh tidak boleh bertindih');
// ---------------------------------------------------------------------------

const existing = [
  { id: 1, fromKey: '2026-07-01', toKey: '2026-07-31' },
  { id: 2, fromKey: '2026-08-01', toKey: '2026-08-31' },
];

check(
  'bulan berikutnya tidak bertindih',
  findOverlap({ fromKey: '2026-09-01', toKey: '2026-09-30' }, existing),
  null,
);
// One shared day is enough: that day's approved overtime is picked up by both runs.
check(
  'satu hari bertindih ditangkap',
  findOverlap({ fromKey: '2026-07-31', toKey: '2026-08-25' }, existing)?.id,
  1,
);
check(
  'tempoh yang menelan tempoh lain ditangkap',
  findOverlap({ fromKey: '2026-06-01', toKey: '2026-12-31' }, existing)?.id,
  1,
);
check(
  'tempoh di dalam tempoh lain ditangkap',
  findOverlap({ fromKey: '2026-08-10', toKey: '2026-08-20' }, existing)?.id,
  2,
);
// Editing a period must not collide with itself.
check(
  'tempoh membandingkan dengan dirinya dilangkau',
  findOverlap({ id: 2, fromKey: '2026-08-01', toKey: '2026-08-31' }, existing),
  null,
);
check(
  'pusingan 26 hingga 25 tidak bertindih dengan sendiri',
  findOverlap({ fromKey: '2026-09-26', toKey: '2026-10-25' }, [
    { id: 1, fromKey: '2026-08-26', toKey: '2026-09-25' },
  ]),
  null,
);

// ---------------------------------------------------------------------------
console.log('\nSemakan borang kadar');
// ---------------------------------------------------------------------------

check('kadar sah diterima', checkStatutory({ epfEmployeeRate: '11' }), {});
check(
  'kadar melebihi 100 ditolak',
  checkStatutory({ epfEmployeeRate: '150' }).epfEmployeeRate,
  'pay.settings.fault.percent',
);
check(
  'kadar negatif ditolak',
  checkStatutory({ socsoEmployeeRate: '-1' }).socsoEmployeeRate,
  'pay.settings.fault.percent',
);
check(
  'ambang tidak masuk akal ditolak',
  checkStatutory({ epfWageThreshold: '99999999' }).epfWageThreshold,
  'pay.settings.fault.amount',
);
check(
  'hari bayaran 32 ditolak',
  checkStatutory({ payDay: '32' }).payDay,
  'pay.settings.fault.payDay',
);
check('hari bayaran 31 diterima', checkStatutory({ payDay: '31' }).payDay, undefined);
/*
 * The step at the threshold goes down, never up. Entered backwards it over-contributes for every
 * senior employee, every month, and both figures look plausible on their own.
 */
check(
  'kadar atas ambang melebihi kadar bawah ditolak',
  checkStatutory({ epfEmployerRate: '12', epfEmployerRateHigh: '13' }).epfEmployerRateHigh,
  'pay.settings.fault.step',
);
check(
  'kadar atas ambang lebih rendah diterima',
  checkStatutory({ epfEmployerRate: '13', epfEmployerRateHigh: '12' }),
  {},
);

// ---------------------------------------------------------------------------
console.log('\nMembaca tetapan');
// ---------------------------------------------------------------------------

check('tetapan kosong jatuh ke lalai', parseStatutory({}), STATUTORY_DEFAULTS);
check('nilai tersimpan mengatasi lalai', parseStatutory({ epfEmployeeRate: '9' }).epfEmployeeRate, 9);
// A row somebody blanked must not become zero: a 0% EPF rate deducts nothing at all.
check('rentetan kosong jatuh ke lalai', parseStatutory({ epfEmployeeRate: '' }).epfEmployeeRate, 11);
check('nilai bukan nombor jatuh ke lalai', parseStatutory({ epfEmployeeRate: 'x' }).epfEmployeeRate, 11);
check('nilai negatif jatuh ke lalai', parseStatutory({ epfEmployeeRate: '-5' }).epfEmployeeRate, 11);
check("bendera '1' jadi true", parseStatutory({ epfIncludeBonus: '1' }).epfIncludeBonus, true);
check("bendera '0' jadi false", parseStatutory({ epfIncludeBonus: '0' }).epfIncludeBonus, false);
check('siling 0 diterima sebagai sengaja', parseStatutory({ socsoWageCeiling: '0' }).socsoWageCeiling, 0);

// ---------------------------------------------------------------------------
console.log(`\n${String(passed)} lulus, ${String(failed)} gagal\n`);
if (failed > 0) process.exit(1);
