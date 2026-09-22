/**
 * Regression suite for the overtime rules. No server and no database.
 *
 * The calculation library is import-free precisely so this can run anywhere, and these
 * are the parts that turn into money: an hourly rate derived wrong, or a claim allowed
 * past the evidence, is a wrong payslip rather than a broken screen.
 */
import {
  MAX_CLAIM_MINUTES,
  MONTHLY_OVERTIME_CAP_MINUTES,
  STATUTORY_MULTIPLIER,
  checkOvertimeClaim,
  hourlyRateFrom,
  nextRequestNo,
  overtimeAmount,
  rateShortfall,
  sequenceOf,
  toSen,
} from '../apps/server/src/hr/overtime.js';

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (same) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  GAGAL ${label}\n          dapat  : ${JSON.stringify(actual)}`);
    console.log(`          jangka : ${JSON.stringify(expected)}`);
  }
}

console.log('\nKadar sejam (s.60I: bulanan / 26 / 8)');
// 3120 / 26 / 8 = 15.00 exactly, so the divisor is visible rather than inferred.
check('RM3120 sebulan → RM15.00 sejam', hourlyRateFrom(3120), 15);
check('RM2600 sebulan → RM12.50 sejam', hourlyRateFrom(2600), 12.5);
// 2000 / 208 = 9.615384..., rounded half-up at two places.
check('pembundaran separuh ke atas', hourlyRateFrom(2000), 9.62);
check('gaji sifar bukan kadar', Number.isNaN(hourlyRateFrom(0)), true);
check('gaji negatif bukan kadar', Number.isNaN(hourlyRateFrom(-100)), true);

console.log('\nJumlah dibayar');
// 15.00 × 1.5 × 2h = 45.00
check('2 jam pada 1.5×', overtimeAmount(15, 1.5, 120), 45);
check('90 minit pada 2.0×', overtimeAmount(15, 2, 90), 45);
check('kelepasan am 3.0×', overtimeAmount(15, 3, 60), 45);
/*
 * Rounded once at the end, not at each step. 9.62 × 1.5 × (100/60) = 24.05.
 * Rounding the hours first would give 9.62 × 1.5 × 1.67 = 24.10 — a five sen gap that
 * makes the screen disagree with the export.
 */
check('dibundarkan sekali di akhir', overtimeAmount(9.62, 1.5, 100), 24.05);
check('minit sifar tiada bayaran', overtimeAmount(15, 1.5, 0), 0);

console.log('\nLantai statutori');
check('1.5 pada hari biasa mematuhi', rateShortfall('weekday', 1.5), null);
check('1.4 pada hari biasa kurang', rateShortfall('weekday', 1.4), { floor: 1.5, actual: 1.4 });
// The reference app seeds a 1.75 weekend rate, which is below the 2.0 rest-day floor.
check('1.75 pada hari rehat kurang', rateShortfall('restDay', 1.75), { floor: 2, actual: 1.75 });
check('3.0 pada kelepasan am mematuhi', rateShortfall('holiday', 3), null);
check('kelepasan am pada hari rehat = 3.0', STATUTORY_MULTIPLIER.holidayRestDay, 3);
check('bayar lebih dibenarkan', rateShortfall('weekday', 2.5), null);

console.log('\nTuntutan disemak terhadap ukuran enjin');
const ok = { measuredMinutes: 180, requestedMinutes: 120, monthMinutes: 0 };
check('kurang daripada diukur diterima', checkOvertimeClaim(ok), null);
check(
  'sama dengan diukur diterima',
  checkOvertimeClaim({ ...ok, requestedMinutes: 180 }),
  null,
);
check(
  'lebih daripada diukur ditolak',
  checkOvertimeClaim({ ...ok, requestedMinutes: 181 })?.key,
  'overtime.refuse.aboveMeasured',
);
check(
  'tiada diukur ditolak',
  checkOvertimeClaim({ measuredMinutes: 0, requestedMinutes: 60, monthMinutes: 0 })?.key,
  'overtime.refuse.noneMeasured',
);
check(
  'sifar minit ditolak',
  checkOvertimeClaim({ ...ok, requestedMinutes: 0 })?.key,
  'overtime.refuse.noMinutes',
);
check(
  'lebih 16 jam ditolak',
  checkOvertimeClaim({
    measuredMinutes: MAX_CLAIM_MINUTES + 60,
    requestedMinutes: MAX_CLAIM_MINUTES + 1,
    monthMinutes: 0,
  })?.key,
  'overtime.refuse.tooLong',
);

console.log('\nHad 104 jam sebulan');
check(
  'tepat pada had diterima',
  checkOvertimeClaim({
    measuredMinutes: 60,
    requestedMinutes: 60,
    monthMinutes: MONTHLY_OVERTIME_CAP_MINUTES - 60,
  }),
  null,
);
check(
  'satu minit melebihi had ditolak',
  checkOvertimeClaim({
    measuredMinutes: 61,
    requestedMinutes: 61,
    monthMinutes: MONTHLY_OVERTIME_CAP_MINUTES - 60,
  })?.key,
  'overtime.refuse.monthlyCap',
);
/*
 * The cap counts pending claims too. Without that, a dozen separate claims each pass on
 * their own and together walk straight past 104 hours.
 */
check(
  'baki dinyatakan dalam penolakan',
  checkOvertimeClaim({
    measuredMinutes: 600,
    requestedMinutes: 600,
    monthMinutes: MONTHLY_OVERTIME_CAP_MINUTES - 120,
  })?.vars?.left,
  '2',
);

console.log('\nNombor permohonan');
check('pertama bulan itu', nextRequestNo('OT', '202609', 0), 'OT-202609-001');
check('selepas 9 ialah 10', nextRequestNo('OT', '202609', 9), 'OT-202609-010');
// String ordering would sort -10 before -9 and reissue a number already used.
check('selepas 10 ialah 11', nextRequestNo('OT', '202609', 10), 'OT-202609-011');
check('urutan dibaca semula', sequenceOf('OT-202609-010'), 10);
check('nombor tanpa urutan', sequenceOf('OT-202609'), 0);
// Shared across modules now, so the prefix has to be honoured rather than assumed.
check('awalan tuntutan', nextRequestNo('TT', '202609', 4), 'TT-202609-005');
check('awalan perbelanjaan', nextRequestNo('PB', '202612', 0), 'PB-202612-001');
check('urutan awalan lain dibaca', sequenceOf('PB-202612-007'), 7);

console.log('\nPembundaran sen');
check('separuh ke atas', toSen(1.005), 1.01);
check('sudah dua tempat', toSen(12.34), 12.34);
check('bukan nombor', Number.isNaN(toSen(Number.NaN)), true);
/*
 * The case that made the naive version wrong: 10.01 × 1.5 for one hour is 15.015, which
 * IEEE-754 holds just below the boundary. Rounding the scaled value directly pays 15.01.
 */
check('sempadan separuh sen sebenar', overtimeAmount(10.01, 1.5, 60), 15.02);

console.log(`\n${passed} lulus, ${failed} gagal\n`);
process.exit(failed > 0 ? 1 : 0);
