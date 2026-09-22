/**
 * Verifies the payroll RUN against a real database. No HTTP, so no admin password.
 *
 * `test-payroll.mts` proves the arithmetic. This proves the part arithmetic cannot: that the run
 * reads the attendance figures from the shared aggregation, writes payslips whose lines add up, and
 * moves loan and advance balances exactly once per run even when the same draft is processed again.
 *
 * The rebuild is the invariant worth the whole script. Processing a draft twice used to be the
 * obvious way to pick up a corrected terminal clock, and the obvious implementation collects the
 * instalment twice and closes the loan early — silently, because both the payslip and the balance
 * look reasonable on their own.
 *
 * Everything it creates is removed at the end, including on failure.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-payroll-run.mts
 */

const { db } = await import('../apps/server/src/db.js');
const { runPeriod } = await import('../apps/server/src/hr/payroll-run.js');
const { payslipBalances } = await import('../apps/server/src/hr/payroll.js');
const { parsePeriod } = await import('../apps/server/src/reports/aggregate.js');
const { asDateOnly, dateOnlyFromKey } = await import('../apps/server/src/time.js');

const timeZone = process.env.ORG_TIMEZONE ?? 'Asia/Kuala_Lumpur';

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  GAGAL ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, actual === expected, `dapat ${String(actual)}, jangka ${String(expected)}`);
}

/*
 * A window the seeded attendance actually covers, so the payslips carry real day counts rather
 * than zeroes. Reading them from the records is the point: a fixed range would pass on an empty
 * database and prove nothing.
 */
const bounds = await db().attendanceRecord.aggregate({
  _min: { workDate: true },
  _max: { workDate: true },
});
if (bounds._max.workDate === null) {
  console.log('Tiada rekod kehadiran. Jalankan seed dahulu.');
  process.exit(1);
}

const toKey = bounds._max.workDate.toISOString().slice(0, 10);
const fromDate = new Date(bounds._max.workDate);
fromDate.setUTCDate(fromDate.getUTCDate() - 30);
const fromKey = fromDate.toISOString().slice(0, 10);

console.log(`\nTempoh ujian ${fromKey} – ${toKey}`);

const CODE = 'ZZ-VERIFY';
let periodId = 0;
let loanId = 0;
let advanceId = 0;
let bonusId = 0;
let allowanceId = 0;

async function cleanup(): Promise<void> {
  // Payslips and their lines cascade with the period.
  if (periodId > 0) await db().payrollPeriod.deleteMany({ where: { id: periodId } });
  if (bonusId > 0) await db().staffBonus.deleteMany({ where: { id: bonusId } });
  if (loanId > 0) await db().staffLoan.deleteMany({ where: { id: loanId } });
  if (advanceId > 0) await db().staffAdvance.deleteMany({ where: { id: advanceId } });
  if (allowanceId > 0) await db().staffAllowance.deleteMany({ where: { id: allowanceId } });
}

process.on('uncaughtException', (cause) => {
  console.error(cause);
  void cleanup().finally(() => process.exit(1));
});
process.on('unhandledRejection', (cause) => {
  console.error(cause);
  void cleanup().finally(() => process.exit(1));
});

try {
  // Anything left behind by a previous failed run.
  await db().payrollPeriod.deleteMany({ where: { code: CODE } });
  await db().staffLoan.deleteMany({ where: { loanNo: { startsWith: 'ZZV-' } } });
  await db().staffAdvance.deleteMany({ where: { advanceNo: { startsWith: 'ZZV-' } } });
  await db().staffBonus.deleteMany({ where: { bonusNo: { startsWith: 'ZZV-' } } });

  const salaried = await db().staff.findMany({
    where: { active: true, basicSalary: { not: null } },
    orderBy: { id: 'asc' },
    select: { id: true, basicSalary: true, fullName: true },
  });
  check('sekurang-kurangnya seorang staf bergaji', salaried.length > 0);

  const subject = salaried[0];
  if (subject === undefined) throw new Error('tiada staf bergaji');
  const basic = Number(subject.basicSalary);
  console.log(`  subjek: ${subject.fullName} (id ${String(subject.id)}), asas RM${basic.toFixed(2)}`);

  const range = parsePeriod(fromKey, toKey, timeZone);

  const period = await db().payrollPeriod.create({
    data: {
      code: CODE,
      name: 'Verifikasi Payroll',
      periodYear: dateOnlyFromKey(toKey).getUTCFullYear(),
      periodMonth: dateOnlyFromKey(toKey).getUTCMonth() + 1,
      fromDate: range.from,
      toDate: range.to,
      paymentDate: range.to,
      status: 'draft',
    },
  });
  periodId = period.id;

  // ── Fixtures the run must pick up ──

  const allowanceType = await db().allowanceType.findFirst({
    where: { active: true, calcMode: 'fixed' },
    orderBy: { id: 'asc' },
  });
  check('sekurang-kurangnya satu jenis elaun aktif', allowanceType !== null);
  if (allowanceType === null) throw new Error('tiada jenis elaun');

  const allowance = await db().staffAllowance.create({
    data: {
      staffId: subject.id,
      typeId: allowanceType.id,
      value: 400,
      // Starts before the period, so it is inside the window.
      effectiveFrom: range.from,
      active: true,
    },
  });
  allowanceId = allowance.id;

  /*
   * An allowance dated after the period, which must NOT be paid.
   *
   * This is the filter the reference stored and never applied, so an allowance dated next quarter
   * started deducting on the next run.
   */
  const future = await db().staffAllowance.create({
    data: {
      staffId: subject.id,
      typeId: allowanceType.id,
      value: 999,
      effectiveFrom: asDateOnly(new Date(range.to.getTime() + 86_400_000 * 60)),
      active: true,
    },
  });

  const bonus = await db().staffBonus.create({
    data: {
      bonusNo: 'ZZV-000000-001',
      staffId: subject.id,
      periodId,
      bonusType: 'other',
      name: 'Bonus verifikasi',
      amount: 250,
      awardedOn: range.to,
      status: 'approved',
    },
  });
  bonusId = bonus.id;

  const loan = await db().staffLoan.create({
    data: {
      loanNo: 'ZZV-000000-001',
      staffId: subject.id,
      principal: 1200,
      monthlyInstalment: 200,
      totalInstalments: 6,
      remainingBalance: 1200,
      issuedOn: range.from,
      startsOn: range.from,
      status: 'active',
    },
  });
  loanId = loan.id;

  const advance = await db().staffAdvance.create({
    data: {
      advanceNo: 'ZZV-000000-001',
      staffId: subject.id,
      principal: 300,
      repaymentMonths: 3,
      monthlyDeduction: 100,
      remainingBalance: 300,
      issuedOn: range.from,
      startsOn: range.from,
      status: 'active',
    },
  });
  advanceId = advance.id;

  // -------------------------------------------------------------------------
  console.log('\nLarian pertama');
  // -------------------------------------------------------------------------

  const first = await runPeriod({
    id: periodId,
    periodYear: period.periodYear,
    periodMonth: period.periodMonth,
    range,
  });

  equal('slip dibina untuk setiap staf bergaji', first.staffCount, salaried.length);
  check('tempoh bertukar ke processing', (await db().payrollPeriod.findUniqueOrThrow({ where: { id: periodId } })).status === 'processing');

  const payslip = await db().payslip.findFirstOrThrow({
    where: { periodId, staffId: subject.id },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  });

  const fault = payslipBalances({
    basicSalary: Number(payslip.basicSalary),
    allowanceAmount: Number(payslip.allowanceAmount),
    overtimeAmount: Number(payslip.overtimeAmount),
    bonusAmount: Number(payslip.bonusAmount),
    commissionAmount: Number(payslip.commissionAmount),
    gross: Number(payslip.gross),
    epfEmployee: Number(payslip.epfEmployee),
    socsoEmployee: Number(payslip.socsoEmployee),
    eisEmployee: Number(payslip.eisEmployee),
    taxDeduction: Number(payslip.taxDeduction),
    loanDeduction: Number(payslip.loanDeduction),
    advanceDeduction: Number(payslip.advanceDeduction),
    otherDeductions: Number(payslip.otherDeductions),
    totalDeductions: Number(payslip.totalDeductions),
    netPay: Number(payslip.netPay),
  });
  check('slip seimbang', fault === null, fault ?? '');

  equal('gaji asas diambil daripada rekod staf', Number(payslip.basicSalary), basic);
  // 400 in, 999 out: the future-dated row must not be paid.
  equal('hanya elaun dalam tetingkap dibayar', Number(payslip.allowanceAmount), 400);
  equal('bonus diluluskan dibayar', Number(payslip.bonusAmount), 250);
  equal('ansuran pinjaman dipotong', Number(payslip.loanDeduction), 200);
  equal('potongan pendahuluan diambil', Number(payslip.advanceDeduction), 100);
  // PCB is never guessed: it depends on declared reliefs under the LHDN schedule.
  equal('PCB kekal sifar', Number(payslip.taxDeduction), 0);

  check('setiap baris slip ada label', payslip.lines.every((line) => line.label.trim() !== ''));
  const lineEarnings = payslip.lines
    .filter((line) => line.kind === 'earning')
    .reduce((sum, line) => sum + Number(line.amount), 0);
  equal(
    'baris pendapatan berjumlah gaji kasar',
    Math.round(lineEarnings * 100) / 100,
    Number(payslip.gross),
  );

  /*
   * The attendance figures come from `reports/aggregate.ts`, not from a second count.
   * Compared against the same function the payroll export reads.
   */
  const { summarise } = await import('../apps/server/src/reports/aggregate.js');
  const [summary] = await summarise([subject.id], range);
  check('agregasi memulangkan ringkasan', summary !== undefined);
  if (summary !== undefined) {
    equal('hari dijadualkan dari enjin kongsi', payslip.scheduledDays, summary.scheduledDays);
    equal('hari hadir dari enjin kongsi', payslip.presentDays, summary.presentDays);
    equal('hari tidak hadir dari enjin kongsi', payslip.absentDays, summary.absentDays);
  }

  const loanAfterFirst = await db().staffLoan.findUniqueOrThrow({ where: { id: loanId } });
  equal('baki pinjaman berkurang sekali', Number(loanAfterFirst.remainingBalance), 1000);
  equal('kiraan ansuran naik sekali', loanAfterFirst.paidInstalments, 1);

  const advanceAfterFirst = await db().staffAdvance.findUniqueOrThrow({ where: { id: advanceId } });
  equal('baki pendahuluan berkurang sekali', Number(advanceAfterFirst.remainingBalance), 200);
  equal('kiraan bulan naik sekali', advanceAfterFirst.paidMonths, 1);

  const periodAfterFirst = await db().payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
  const payslipSum = await db().payslip.aggregate({
    where: { periodId },
    _sum: { gross: true, totalDeductions: true, netPay: true },
  });
  equal(
    'jumlah tempoh sepadan jumlah slip (kasar)',
    Number(periodAfterFirst.totalGross),
    Math.round(Number(payslipSum._sum.gross ?? 0) * 100) / 100,
  );
  equal(
    'jumlah tempoh sepadan jumlah slip (bersih)',
    Number(periodAfterFirst.totalNet),
    Math.round(Number(payslipSum._sum.netPay ?? 0) * 100) / 100,
  );

  // -------------------------------------------------------------------------
  console.log('\nLarian kedua atas draf yang sama');
  // -------------------------------------------------------------------------

  // Back to draft, which is what the route requires before a rebuild.
  await db().payrollPeriod.update({ where: { id: periodId }, data: { status: 'draft' } });

  const second = await runPeriod({
    id: periodId,
    periodYear: period.periodYear,
    periodMonth: period.periodMonth,
    range,
  });

  equal('bilangan slip sama', second.staffCount, first.staffCount);
  equal('jumlah bersih sama', second.totalNet, first.totalNet);

  const count = await db().payslip.count({ where: { periodId, staffId: subject.id } });
  equal('tiada slip pendua', count, 1);

  /*
   * The whole reason this script exists.
   *
   * A rebuild that does not unwind the previous run's balance movements collects the instalment
   * twice — RM800 left instead of RM1,000 — and closes the loan a month early.
   */
  const loanAfterSecond = await db().staffLoan.findUniqueOrThrow({ where: { id: loanId } });
  equal('baki pinjaman TIDAK dipotong dua kali', Number(loanAfterSecond.remainingBalance), 1000);
  equal('kiraan ansuran TIDAK naik dua kali', loanAfterSecond.paidInstalments, 1);

  const advanceAfterSecond = await db().staffAdvance.findUniqueOrThrow({ where: { id: advanceId } });
  equal('baki pendahuluan TIDAK dipotong dua kali', Number(advanceAfterSecond.remainingBalance), 200);
  equal('kiraan bulan TIDAK naik dua kali', advanceAfterSecond.paidMonths, 1);

  // -------------------------------------------------------------------------
  console.log('\nAnsuran terakhir mengambil baki sahaja');
  // -------------------------------------------------------------------------

  /*
   * The previous run's payslips are cleared first, deliberately.
   *
   * `unwind` restores whatever the last run deducted, so leaving those payslips in place would put
   * RM200 back onto the balance and the run would correctly take a full instalment — which is the
   * behaviour the section above already proves. Clearing them puts the loan in the state it is in
   * on its final month with no prior run to undo, which is the case being tested.
   */
  await db().payslip.deleteMany({ where: { periodId } });
  await db().staffLoan.update({
    where: { id: loanId },
    data: { remainingBalance: 40, paidInstalments: 5 },
  });
  await db().payrollPeriod.update({ where: { id: periodId }, data: { status: 'draft' } });

  await runPeriod({
    id: periodId,
    periodYear: period.periodYear,
    periodMonth: period.periodMonth,
    range,
  });

  const finalSlip = await db().payslip.findFirstOrThrow({
    where: { periodId, staffId: subject.id },
  });
  equal('ansuran terakhir hanya baki', Number(finalSlip.loanDeduction), 40);

  const closedLoan = await db().staffLoan.findUniqueOrThrow({ where: { id: loanId } });
  equal('baki habis', Number(closedLoan.remainingBalance), 0);
  equal('pinjaman ditutup', closedLoan.status, 'completed');
  check('tarikh tutup direkodkan', closedLoan.closedOn !== null);

  await db().staffAllowance.delete({ where: { id: future.id } });
} finally {
  await cleanup();
}

console.log(`\n${String(passed)} lulus, ${String(failed)} gagal\n`);
process.exit(failed > 0 ? 1 : 0);
