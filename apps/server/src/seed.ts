/**
 * First-run installer.
 *
 * Idempotent: safe to re-run. Creates the roles, the first administrator, a
 * default work pattern, and registers the terminal from .env.
 *
 *   npm run seed --workspace @attendance/server
 */
import { generateSync } from 'otplib';
import { randomBytes } from 'node:crypto';

import { fullPermissions, validatePermissions } from './auth/permissions.js';
import { createTotpSecret, hashPassword } from './auth/service.js';
import { encryptSecret } from './crypto.js';
import { db, disconnectDb } from './db.js';
import { checkDevice } from './devices/health.js';
import { loadEnv } from './env.js';

/**
 * Permission grants per role, built from the registry.
 *
 * Derived rather than typed out, so a screen added to the registry cannot be
 * silently missing from Super Admin. The narrower roles list their screens
 * explicitly, because those are policy decisions and should read as such.
 *
 * `attendance.rawLog` and `settings.logs.audit` are capped at view and export for
 * every role including Super Admin. An administrator who can rewrite the device
 * log destroys the only record that can settle a payroll dispute, so the
 * capability does not exist rather than being merely unassigned.
 */
const ROLES = [
  {
    name: 'Super Admin',
    description: 'Akses penuh termasuk tetapan sistem',
    systemRole: true,
    permissions: fullPermissions(),
  },
  {
    name: 'HR Admin',
    description: 'Staf, kehadiran, jadual dan laporan',
    systemRole: true,
    permissions: grant({
      dashboard: ['view'],
      'attendance.monitor': ['view'],
      'attendance.records': ['view', 'edit', 'approve', 'export'],
      'attendance.rawLog': ['view', 'export'],
      'attendance.exceptions': ['view', 'approve', 'export'],
      'staff.directory': ['view', 'create', 'edit', 'export', 'resync'],
      'staff.biometrics': ['view', 'create', 'delete'],
      'staff.mapping': ['view', 'create', 'delete', 'import'],
      'staff.import': ['view', 'create', 'template'],
      'staff.departments': ['view', 'create', 'edit'],
      'staff.locations': ['view', 'create', 'edit'],
      'schedule.workPatterns': ['view', 'create', 'edit'],
      'schedule.shifts': ['view', 'create', 'edit'],
      'schedule.roster': ['view', 'edit', 'delete'],
      'schedule.holidays': ['view', 'create', 'delete'],
      'schedule.leave': ['view', 'create', 'edit', 'approve'],
      'reports.monthly': ['view', 'export'],
      'reports.payroll': ['view', 'export'],
      'reports.builder': ['view', 'export'],
      'settings.devices': ['view'],
      'settings.users.staff': ['view', 'create', 'edit', 'suspend', 'activate', 'reset', 'unbind'],
    }),
  },
  {
    name: 'Kerani',
    description: 'Baca dan export sahaja',
    systemRole: true,
    permissions: grant({
      dashboard: ['view'],
      'attendance.monitor': ['view'],
      'attendance.records': ['view', 'export'],
      'attendance.rawLog': ['view', 'export'],
      'attendance.exceptions': ['view'],
      'staff.directory': ['view', 'export'],
      'schedule.roster': ['view'],
      'schedule.holidays': ['view'],
      'reports.monthly': ['view', 'export'],
    }),
  },
];

/**
 * Validates a hand-written grant against the registry at seed time.
 *
 * A typo in a screen key would otherwise produce a role that looks configured and
 * grants nothing, which only shows up when someone cannot open a screen they were
 * told they could.
 */
function grant(permissions: Record<string, string[]>): Record<string, string[]> {
  validatePermissions(permissions);
  return permissions;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const prisma = db();

  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      create: {
        name: role.name,
        description: role.description,
        systemRole: role.systemRole,
        permissions: role.permissions,
      },
      update: { permissions: role.permissions, description: role.description },
    });
  }
  console.log(`Roles ready: ${ROLES.map((role) => role.name).join(', ')}`);

  /**
   * Baseline leave categories.
   *
   * Entitlements are the statutory minimum starting points, not policy — every
   * organisation adjusts these, so they are seeded as editable rows rather than
   * hardcoded anywhere in the engine.
   *
   * `allowBackdated` is on for emergency and sick leave because both are filed after
   * the fact by definition. Refusing a past date would make those categories unusable
   * and push people to record them as annual leave instead.
   */
  for (const type of [
    { code: 'AL', name: 'Cuti Tahunan', description: 'Cuti tahunan untuk kegunaan peribadi', annualDays: 14, countedIn: 'working', eligibility: 'all', requiresDocument: false, paid: true, allowBackdated: false, requiresApproval: true, colour: '#2563eb' },
    /*
     * Graded, and the three numbers are the statute's rather than a house rate.
     *
     * s.60F gives 14 days under two years of service, 18 from two, and 22 from five. The seeded
     * base was already 14, so enabling the grading here changes nothing for a new joiner and stops
     * under-granting everybody above two years — which is what a single figure was doing.
     *
     * Annual leave is deliberately left ungraded. s.60E grades it 8/12/16, but the seeded 14 is a
     * house rate well above that floor, and turning grading on would mean choosing later bands on
     * the organisation's behalf. That is policy, not law.
     */
    { code: 'MC', name: 'Cuti Sakit', description: 'Cuti sakit dengan sijil perubatan', annualDays: 14, serviceTiers: true, annualDaysTier2: 18, annualDaysTier3: 22, countedIn: 'working', eligibility: 'all', requiresDocument: true, paid: true, allowBackdated: true, requiresApproval: true, colour: '#dc2626' },
    { code: 'EL', name: 'Cuti Kecemasan', description: 'Kecemasan atau ihsan keluarga', annualDays: 3, countedIn: 'working', eligibility: 'all', requiresDocument: false, paid: true, allowBackdated: true, requiresApproval: true, colour: '#ea580c' },
    /*
     * Maternity and paternity are counted in CALENDAR days, and that is not a preference.
     *
     * The Employment Act grants 98 consecutive days of maternity leave (s.37) and 7 consecutive
     * days of paternity leave (s.60FA). Counted in working days, 98 becomes about four and a half
     * months instead of three and a bit — the entitlement silently inflates by a third, and it
     * inflates on the one category where the figure is fixed by statute rather than by policy.
     *
     * They are also the two categories restricted by gender, which is the other half of why both
     * `countedIn` and `eligibility` exist.
     */
    { code: 'ML', name: 'Cuti Bersalin', description: 'Cuti bersalin untuk pekerja wanita', annualDays: 98, countedIn: 'calendar', eligibility: 'female', requiresDocument: false, paid: true, allowBackdated: false, requiresApproval: true, colour: '#db2777' },
    { code: 'PL', name: 'Cuti Bapa', description: 'Cuti bapa untuk pekerja lelaki', annualDays: 7, countedIn: 'calendar', eligibility: 'male', requiresDocument: false, paid: true, allowBackdated: false, requiresApproval: true, colour: '#7c3aed' },
    { code: 'UL', name: 'Cuti Tanpa Gaji', description: 'Cuti tanpa potongan kelayakan dan tanpa gaji', annualDays: 0, countedIn: 'working', eligibility: 'all', requiresDocument: false, paid: false, allowBackdated: false, requiresApproval: true, colour: '#64748b' },
  ]) {
    await prisma.leaveType.upsert({
      where: { code: type.code },
      create: type,
      // Entitlement and flags are left alone on re-run: they are policy the operator
      // may already have adjusted.
      update: { name: type.name },
    });

    /**
     * The description is filled only where nobody has written one.
     *
     * It cannot go in `update` above: that runs on every re-run, and it would overwrite the
     * wording an operator had adjusted for their own organisation — the same reason entitlement
     * and the flags are left alone. It cannot go in `create` alone either, because these six rows
     * already exist on every installation that was seeded before the column did.
     */
    await prisma.leaveType.updateMany({
      where: { code: type.code, description: null },
      data: { description: type.description },
    });
  }
  console.log('Leave types ready: AL, MC, EL, ML, PL, UL');

  /**
   * One rate per day type, seeded at the Employment Act floor.
   *
   * The floors, not a house rate: 1.5 on a normal day (s.60A(3)(a)), 2.0 on a rest day
   * (s.60(3)(b)) and 3.0 on a paid public holiday (s.60D(3)(aa)). An installation that
   * pays more raises them; an installation that seeds a violation would have shipped one.
   *
   * Without a row per day type the resolver falls back to the statutory floor anyway, so
   * nothing underpays — but the rates screen would be empty and the approver would have
   * nothing to pick, which reads as a broken feature.
   */
  for (const rate of [
    { code: 'OT-BIASA', name: 'Hari Bekerja Biasa', dayType: 'weekday', multiplier: 1.5 },
    { code: 'OT-REHAT', name: 'Hari Rehat', dayType: 'restDay', multiplier: 2 },
    { code: 'OT-KELEPASAN', name: 'Kelepasan Am', dayType: 'holiday', multiplier: 3 },
    {
      code: 'OT-KEL-REHAT',
      name: 'Kelepasan Am pada Hari Rehat',
      dayType: 'holidayRestDay',
      multiplier: 3,
    },
  ]) {
    await prisma.overtimeRate.upsert({
      where: { code: rate.code },
      create: { ...rate, isDefault: true, active: true },
      // The multiplier is policy once an operator has touched it.
      update: { name: rate.name },
    });
  }
  console.log('Overtime rates ready: OT-BIASA, OT-REHAT, OT-KELEPASAN, OT-KEL-REHAT');

  /**
   * Baseline claim categories.
   *
   * Two rated and two flat, so both shapes are visible from the first login and neither has to
   * be discovered from the field descriptions. Rates are starting points, not policy — every
   * organisation sets its own, which is why they are editable rows rather than constants.
   *
   * `PERJALANAN` needs no receipt: the rate and the distance are the evidence, and asking for
   * a receipt for mileage is asking for something that does not exist.
   */
  /*
   * Nine categories, three-letter codes.
   *
   * The codes are short because they are what appears in the pill at the head of every row and in
   * the request number — `PERJALANAN` filled that column and pushed the name out of the row.
   *
   * Two are rated and seven are flat, and the split is not arbitrary. A rate is a stronger control
   * than a cap: a cap says "not more than this", a rate says "this much per kilometre, and here is
   * the distance". So mileage and accommodation are priced by rule, and the rest take the figure from
   * the receipt.
   *
   * `MLG` is the one category that needs no receipt, because the rate *is* the evidence — there is no
   * piece of paper for driving your own car. Every other category demands one on every line.
   */
  for (const type of [
    {
      code: 'ACC',
      name: 'Penginapan',
      description: 'Hotel dan tempat menginap',
      ratePerUnit: 150,
      unitLabel: 'malam',
      maxAmount: 3000,
      requiresReceipt: true,
    },
    {
      code: 'COM',
      name: 'Komunikasi',
      description: 'Bil telefon, internet, pos',
      ratePerUnit: null,
      unitLabel: null,
      maxAmount: 500,
      requiresReceipt: true,
    },
    {
      code: 'ENT',
      name: 'Keramahan',
      description: 'Keramahan perniagaan dan tetamu',
      ratePerUnit: null,
      unitLabel: null,
      maxAmount: 2000,
      requiresReceipt: true,
    },
    {
      code: 'MED',
      name: 'Perubatan',
      description: 'Perbelanjaan perubatan dan kesihatan',
      ratePerUnit: null,
      unitLabel: null,
      maxAmount: 10_000,
      requiresReceipt: true,
    },
    {
      code: 'MLG',
      name: 'Perbatuan',
      description: 'Elaun perbatuan untuk kenderaan sendiri',
      ratePerUnit: 0.6,
      unitLabel: 'km',
      maxAmount: null,
      requiresReceipt: false,
    },
    {
      code: 'OFF',
      name: 'Bekalan Pejabat',
      description: 'Alat tulis dan peralatan pejabat',
      ratePerUnit: null,
      unitLabel: null,
      maxAmount: 1000,
      requiresReceipt: true,
    },
    {
      code: 'OTH',
      name: 'Lain-lain',
      description: 'Tuntutan perbelanjaan lain',
      ratePerUnit: null,
      unitLabel: null,
      maxAmount: null,
      requiresReceipt: true,
    },
    {
      code: 'TRN',
      name: 'Latihan',
      description: 'Kursus, seminar, persidangan',
      ratePerUnit: null,
      unitLabel: null,
      maxAmount: 5000,
      requiresReceipt: true,
    },
    {
      code: 'TRV',
      name: 'Perjalanan',
      description: 'Tol, tambang, parkir, bahan api',
      ratePerUnit: null,
      unitLabel: null,
      maxAmount: 5000,
      requiresReceipt: true,
    },
  ]) {
    await prisma.claimType.upsert({
      where: { code: type.code },
      create: { ...type, active: true },
      // Rate and cap are policy once an operator has touched them.
      update: { name: type.name },
    });
  }
  console.log('Claim types ready: ACC, COM, ENT, MED, MLG, OFF, OTH, TRN, TRV');

  /**
   * Baseline expense categories.
   *
   * No rates here, and that is the distinction from a claim type: a category classifies a cost,
   * it does not price one. The amount always comes from the receipt.
   */
  for (const category of [
    {
      code: 'ALATTULIS',
      name: 'Alat Tulis & Pejabat',
      description: 'Barang pejabat yang dibeli sendiri',
      maxAmount: 500,
    },
    {
      code: 'PERALATAN',
      name: 'Peralatan Klinikal',
      description: 'Peralatan kecil yang dibeli segera',
      maxAmount: 2000,
    },
    {
      code: 'PENGHANTARAN',
      name: 'Penghantaran & Pos',
      description: 'Kos kurier dan pos',
      maxAmount: 300,
    },
    {
      code: 'LAIN',
      name: 'Lain-lain',
      description: 'Kos yang tiada kategorinya sendiri',
      maxAmount: null,
    },
  ]) {
    await prisma.expenseCategory.upsert({
      where: { code: category.code },
      create: { ...category, active: true },
      // The cap is policy once an operator has touched it.
      update: { name: category.name },
    });
  }
  console.log('Expense categories ready: ALATTULIS, PERALATAN, PENGHANTARAN, LAIN');

  /**
   * The competency catalogue.
   *
   * Seeded because a form builder facing an empty catalogue has nothing to build with, and the
   * first person to hit that types a competency name into whatever field will take one — which is
   * the free-text situation the catalogue was introduced to end.
   *
   * `category` groups the picker and affects no arithmetic: a leadership item at 10% counts exactly
   * as much as a core item at 10%. Upserted by name, and only the description follows the seed —
   * a category an organisation has moved stays moved.
   */
  const competencies: Array<{ name: string; category: string; description: string }> = [
    // Core — asked of everybody, whatever they do.
    { name: 'Kualiti Kerja', category: 'core', description: 'Ketepatan, kelengkapan dan kemasan hasil kerja.' },
    { name: 'Kuantiti Kerja', category: 'core', description: 'Jumlah kerja disiapkan berbanding jangkaan jawatan.' },
    { name: 'Kebolehpercayaan', category: 'core', description: 'Menyiapkan tugasan tanpa perlu diingatkan atau diperiksa semula.' },
    { name: 'Kehadiran dan Ketepatan Masa', category: 'core', description: 'Hadir mengikut jadual dan mengikut waktu shift yang ditetapkan.' },
    { name: 'Komunikasi', category: 'core', description: 'Menyampaikan maklumat dengan jelas secara lisan dan bertulis.' },
    { name: 'Kerja Berpasukan', category: 'core', description: 'Bekerjasama merentas jabatan tanpa perlu dipujuk.' },
    { name: 'Disiplin dan Etika Kerja', category: 'core', description: 'Mematuhi peraturan, kod pakaian dan tatakelakuan perkhidmatan.' },

    // Functional — the work itself.
    { name: 'Pengetahuan Teknikal', category: 'functional', description: 'Menguasai prosedur dan peralatan bidang tugas sendiri.' },
    { name: 'Ketelitian Prosedur', category: 'functional', description: 'Mengikut protokol klinikal dan tatacara operasi tanpa jalan singkat.' },
    { name: 'Keselamatan Pesakit', category: 'functional', description: 'Mengenal pasti dan melaporkan risiko sebelum ia menjadi insiden.' },
    { name: 'Layanan Pelanggan', category: 'functional', description: 'Berurusan dengan pesakit dan keluarga dengan hormat dan sabar.' },
    { name: 'Penyelesaian Masalah', category: 'functional', description: 'Mencari punca dan bukan hanya melegakan gejala.' },
    { name: 'Pengurusan Rekod', category: 'functional', description: 'Dokumentasi lengkap, tepat masa dan boleh dijejaki.' },
    { name: 'Penggunaan Sistem dan Teknologi', category: 'functional', description: 'Menggunakan sistem yang disediakan dan bukan catatan sampingan.' },
    { name: 'Inisiatif dan Inovasi', category: 'functional', description: 'Menambah baik cara kerja tanpa diarahkan.' },

    // Leadership — asked only of those who hold others accountable.
    { name: 'Kepimpinan Pasukan', category: 'leadership', description: 'Mengarah dan menyokong pasukan ke arah hasil yang disepakati.' },
    { name: 'Pembangunan Staf', category: 'leadership', description: 'Membimbing orang bawahan dan meningkatkan keupayaan mereka.' },
    { name: 'Membuat Keputusan', category: 'leadership', description: 'Memutuskan dengan maklumat yang ada dan mempertanggungjawabkan keputusan itu.' },
    { name: 'Perancangan dan Penyeliaan', category: 'leadership', description: 'Merancang beban kerja dan memantau tanpa mengurus setiap butiran.' },
  ];

  for (const competency of competencies) {
    await prisma.kpiCompetency.upsert({
      where: { name: competency.name },
      create: competency,
      // Category is policy once an organisation has moved it; only the wording follows the seed.
      update: { description: competency.description },
    });
  }
  console.log(
    `KPI competencies ready: ${String(competencies.length)} (7 teras, 8 fungsian, 4 kepimpinan)`,
  );

  /**
   * Baseline KPI grade bands.
   *
   * The bands cover 0–100 exactly once, which `hr/kpi.ts` enforces on write: a gap is a score
   * that earns no grade at all, and an overlap is the same score earning different grades
   * depending on read order. Seeded so the review screen is usable before anybody configures
   * anything, and upserted by code so a band an operator has widened stays widened.
   *
   * Five bands, not four. The fourth used to be `D — Perlu Penambahbaikan` sitting on 0–49.99, so a
   * score of 5 and a score of 49 earned the same grade — which makes the bottom band unable to
   * distinguish somebody struggling from somebody who is not doing the job. `E` splits it.
   *
   * `bonusMonths` is months of basic salary. It was `bonusFactor`, and a screen showing `1.5` states
   * a multiplier without saying of what, over what period. Every bonus policy anybody writes is
   * written in months.
   *
   * `color` is stored rather than derived from the sort order, because bands get inserted and
   * renamed and the colours should not shuffle when they do. Green through red, so a distribution
   * is scanned rather than counted.
   */
  for (const grade of [
    { code: 'A', name: 'Cemerlang', minScore: 85, maxScore: 100, bonusMonths: 2, color: '#16a34a', sortOrder: 1 },
    { code: 'B', name: 'Baik', minScore: 70, maxScore: 84.99, bonusMonths: 1.5, color: '#3b82f6', sortOrder: 2 },
    { code: 'C', name: 'Memuaskan', minScore: 55, maxScore: 69.99, bonusMonths: 1, color: '#f59e0b', sortOrder: 3 },
    { code: 'D', name: 'Perlu Penambahbaikan', minScore: 40, maxScore: 54.99, bonusMonths: null, color: '#f97316', sortOrder: 4 },
    { code: 'E', name: 'Tidak Memuaskan', minScore: 0, maxScore: 39.99, bonusMonths: null, color: '#ef4444', sortOrder: 5 },
  ]) {
    await prisma.kpiGrade.upsert({
      where: { code: grade.code },
      create: grade,
      // Bands and bonus months are policy once touched; only the wording follows the seed.
      update: { name: grade.name },
    });
  }
  console.log('KPI grades ready: A, B, C, D, E (0–100 covered exactly once)');

  /**
   * One example form, summing to exactly 100.
   *
   * Seeded so somebody opening Templat KPI sees what a form is meant to look like rather than an
   * empty table with an Add button. Created only when absent — a form an organisation has edited is
   * theirs, and re-running the seed must not rewrite their weights.
   *
   * Seven core competencies, because the core set is the one that applies to everybody. A
   * supervisor's form adds the leadership items and reduces these; that is a second form, not a
   * variation of this one.
   */
  const exampleTemplate = await prisma.kpiTemplate.findUnique({ where: { code: 'AM-UMUM' } });
  if (exampleTemplate === null) {
    const weights: Array<[string, number]> = [
      ['Kualiti Kerja', 20],
      ['Kuantiti Kerja', 15],
      ['Kebolehpercayaan', 15],
      ['Kehadiran dan Ketepatan Masa', 15],
      ['Komunikasi', 10],
      ['Kerja Berpasukan', 10],
      ['Disiplin dan Etika Kerja', 15],
    ];

    const catalogue = await prisma.kpiCompetency.findMany({
      where: { name: { in: weights.map(([name]) => name) } },
      select: { id: true, name: true },
    });
    const byName = new Map(catalogue.map((row) => [row.name, row.id]));

    await prisma.kpiTemplate.create({
      data: {
        code: 'AM-UMUM',
        name: 'Penilaian Am — Semua Staf',
        description:
          'Tujuh kompetensi teras yang dikenakan pada semua staf. Berjumlah tepat 100%. ' +
          'Borang penyelia berasingan: ia menambah kompetensi kepimpinan dan mengurangkan ini.',
        active: true,
        items: {
          create: weights.map(([name, weight], index) => ({
            competencyId: byName.get(name) ?? null,
            competencyName: name,
            weight,
            sortOrder: index + 1,
          })),
        },
      },
    });
    console.log('KPI template ready: AM-UMUM (7 kompetensi, 100%)');
  }

  /**
   * Statutory payroll rates, seeded as DATA FLAGGED FOR REVIEW.
   *
   * Not constants, and the distinction is the whole point. EPF's employer rate steps down at a
   * wage threshold; the EIS ceiling has moved twice by government announcement. A rate held in a
   * source file means a deployment to obey the law.
   *
   * **These values have NOT been verified against a current KWSP or PERKESO schedule.** They are a
   * starting point so the screens are usable. `ratesReviewed` stays `'0'` until somebody in finance
   * compares each one against the schedule in force, and while it is `'0'` every payroll screen and
   * every exported file carries a warning saying so. Two approximations are stated on the settings
   * screen rather than hidden: SOCSO and EIS are a percentage with a ceiling instead of the real
   * wage-band table, and PCB is not computed at all.
   *
   * `createOnly` semantics: a value an operator has corrected must not be reset by a later seed
   * run, so `update` is empty.
   */
  for (const [key, value] of Object.entries({
    epfEmployeeRate: '11',
    epfEmployerRate: '13',
    epfEmployerRateHigh: '12',
    epfWageThreshold: '5000',
    epfIncludeBonus: '1',
    socsoEmployeeRate: '0.5',
    socsoEmployerRate: '1.75',
    socsoWageCeiling: '6000',
    eisEmployeeRate: '0.2',
    eisEmployerRate: '0.2',
    eisWageCeiling: '6000',
    payDay: '25',
    ratesReviewed: '0',
  })) {
    await prisma.hrModuleSetting.upsert({
      where: { module_key: { module: 'payroll', key } },
      create: { module: 'payroll', key, value },
      update: {},
    });
  }
  console.log('Payroll statutory rates seeded — FLAGGED UNVERIFIED, finance must confirm');

  /**
   * Notification preferences for the two modules that have no approval chain.
   *
   * `emailProfileKey` is blank, and that is the honest default: there may be no email profile
   * configured at all, and picking whichever happened to be first would put hospital mail out
   * under a sender nobody chose. Nominating one on the settings screen is what switches mail on.
   *
   * `notifyEveryLevel` is absent from both — there are no levels. `notifyApprover` stays for KPI,
   * where the reviewer is the person being asked to act, and for payroll it is simply unused.
   */
  for (const module of ['payroll', 'kpi']) {
    for (const [key, value] of Object.entries({
      emailProfileKey: '',
      notifyApplicant: '1',
      notifyApprover: '1',
      notifyEveryLevel: '0',
      ccEmail: '',
    })) {
      await prisma.hrModuleSetting.upsert({
        where: { module_key: { module, key } },
        create: { module, key, value },
        update: {},
      });
    }
  }
  console.log('Notification defaults ready for payroll and kpi (email off until a profile is named)');

  /**
   * A starter allowance catalogue.
   *
   * A catalogue rather than fixed columns, which is why these are rows: a fifth kind of allowance
   * should be one insert, not a migration. `epfLiable` differs per type because it genuinely does —
   * a travel reimbursement is not wages, a housing allowance is.
   */
  for (const type of [
    {
      code: 'RUMAH',
      name: 'Elaun Rumah',
      description: 'Elaun perumahan bulanan',
      calcMode: 'fixed',
      defaultAmount: 300,
      epfLiable: true,
      taxable: true,
    },
    {
      code: 'PENGANGKUTAN',
      name: 'Elaun Pengangkutan',
      description: 'Elaun perjalanan bulanan',
      calcMode: 'fixed',
      defaultAmount: 150,
      epfLiable: true,
      taxable: true,
    },
    {
      code: 'MAKAN',
      name: 'Elaun Makan',
      description: 'Elaun makan bulanan',
      calcMode: 'fixed',
      defaultAmount: 200,
      epfLiable: true,
      taxable: true,
    },
    {
      // Neither EPF wages nor taxable: it repays a cost somebody already carried.
      code: 'TUGASLUAR',
      name: 'Bayaran Balik Tugas Luar',
      description: 'Bayaran balik kos tugas luar — bukan upah',
      calcMode: 'fixed',
      defaultAmount: null,
      epfLiable: false,
      taxable: false,
    },
    {
      code: 'KRITIKAL',
      name: 'Elaun Kritikal',
      description: 'Peratus gaji asas bagi jawatan kritikal',
      calcMode: 'percentOfBasic',
      defaultAmount: 10,
      epfLiable: true,
      taxable: true,
    },
  ]) {
    await prisma.allowanceType.upsert({
      where: { code: type.code },
      create: { ...type, active: true },
      // `calcMode` and `epfLiable` are frozen once a type is in use, so the seed never moves
      // them: doing so would reprice allowances already paid.
      update: { name: type.name, description: type.description },
    });
  }
  console.log('Allowance types ready: RUMAH, PENGANGKUTAN, MAKAN, TUGASLUAR, KRITIKAL');

  const location = await prisma.location.upsert({
    where: { id: 1 },
    create: { name: 'Hospital Sibu', geofenceRadiusM: 200 },
    update: {},
  });

  /**
   * Default pattern, used when a staff member has no rostered shift.
   *
   * The grace windows are what make a scan a few minutes before the start count
   * towards the shift instead of falling outside it.
   */
  const pattern = await prisma.workPattern.upsert({
    where: { id: 1 },
    create: {
      name: 'Pejabat 8:00-17:00',
      kind: 'regular',
      timeBlocks: {
        create: [
          {
            blockOrder: 1,
            startTime: '08:00',
            endTime: '17:00',
            endsNextDay: false,
            breakMinutes: 60,
            graceBeforeMinutes: 60,
            graceAfterMinutes: 120,
          },
        ],
      },
    },
    update: {},
    include: { timeBlocks: true },
  });

  /**
   * A night shift is seeded from the start because this is a hospital and the
   * midnight-crossing case is the one most likely to be modelled wrongly.
   */
  await prisma.workPattern.upsert({
    where: { id: 2 },
    create: {
      name: 'Shift Malam 22:00-07:00',
      kind: 'shift',
      timeBlocks: {
        create: [
          {
            blockOrder: 1,
            startTime: '22:00',
            endTime: '07:00',
            endsNextDay: true,
            breakMinutes: 45,
            graceBeforeMinutes: 45,
            graceAfterMinutes: 90,
          },
        ],
      },
    },
    update: {},
  });

  // ---- First administrator -------------------------------------------------
  // Created as a staff record and an account together. Every login is bound to a
  // person in the directory, and the installer is not an exception to that.
  const superAdmin = await prisma.role.findUniqueOrThrow({ where: { name: 'Super Admin' } });
  const adminEmail = 'faizan@hospital.local';

  const existing = await prisma.userAccount.findUnique({ where: { email: adminEmail } });

  if (existing) {
    console.log(`Administrator ${adminEmail} already exists; left untouched.`);
  } else {
    const staff = await prisma.staff.upsert({
      where: { employeeNo: '1' },
      create: {
        employeeNo: '1',
        fullName: 'Mohamad Faizan Bin Abdul Rahman',
        locationId: location.id,
        workPatternId: pattern.id,
        active: true,
      },
      update: {},
    });

    // Generated rather than defaulted, so no installation ships with a password
    // that is already public knowledge.
    const password = randomBytes(9).toString('base64url');
    const totp = createTotpSecret(adminEmail);

    await prisma.userAccount.create({
      data: {
        staffId: staff.id,
        accountType: 'admin',
        status: 'active',
        email: adminEmail,
        passwordHash: await hashPassword(password),
        roleId: superAdmin.id,
        totpSecretEncrypted: totp.encrypted,
        totpConfirmedAt: new Date(),
      },
    });

    console.log('\n--- Administrator created -------------------------------');
    console.log(`  Email     : ${adminEmail}`);
    console.log(`  Password  : ${password}`);
    console.log(`  TOTP key  : ${totp.secret}`);
    console.log(`  Auth URI  : ${totp.otpauthUrl}`);
    console.log(`  Code now  : ${generateSync({ secret: totp.secret })}  (rotates every 30s)`);
    console.log('  Record these now - the password is not recoverable.');
    console.log('--------------------------------------------------------\n');
  }

  // ---- Terminal ------------------------------------------------------------
  // Registered from .env when present, so a fresh install lands with the real
  // terminal already probed rather than an empty device list.
  const hikHost = process.env['HIK_HOST'];
  if (hikHost && process.env['HIK_USERNAME'] && process.env['HIK_PASSWORD']) {
    const parsed = new URL(hikHost);
    const useHttps = parsed.protocol === 'https:';
    const port = parsed.port ? Number(parsed.port) : useHttps ? 443 : 80;

    const device = await prisma.device.upsert({
      where: { id: 1 },
      create: {
        name: 'Rumah Mayat',
        host: parsed.hostname,
        port,
        useHttps,
        verifyTls: process.env['HIK_VERIFY_TLS'] === 'true',
        username: process.env['HIK_USERNAME'] as string,
        passwordEncrypted: encryptSecret(process.env['HIK_PASSWORD'] as string),
        locationId: location.id,
      },
      update: {},
    });

    await prisma.deviceSyncState.upsert({
      where: { deviceId: device.id },
      create: { deviceId: device.id },
      update: {},
    });

    console.log(`Terminal registered: ${parsed.hostname}:${port}`);

    const health = await checkDevice(device);
    console.log(`  status  : ${health.status}`);
    console.log(`  drift   : ${health.clockDriftSeconds ?? '?'}s (${health.clockMode ?? '?'})`);
    console.log(`  enrolled: ${health.enrolled ?? '?'} / ${health.faceCapacity ?? '?'}`);
    for (const warning of health.warnings) console.log(`  warn    : ${warning}`);
    if (health.error) console.log(`  error   : ${health.error}`);
  }

  console.log('\nSeed complete.');
}

try {
  await main();
} finally {
  await disconnectDb();
}
