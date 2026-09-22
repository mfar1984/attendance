/**
 * Regression suite for notification templates. No server and no database.
 *
 * Templates are written by operators, so the failure mode is mail that goes out with
 * `{{staffNmae}}` printed in it, or markup broken by a hospital name containing an ampersand.
 * Both are cheap to catch here and expensive to catch in an inbox.
 */
import {
  COMMON_PLACEHOLDERS,
  EVENT_AUDIENCE,
  TEMPLATE_EVENTS,
  defaultTemplate,
  escapeHtml,
  eventsFor,
  isTemplateEvent,
  moduleRaises,
  placeholdersFor,
  renderTemplate,
  textToHtml,
  unknownPlaceholders,
} from '../apps/server/src/hr/email-template.js';

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

console.log('\nPenggantian medan');
check(
  'medan diisi',
  renderTemplate('Salam {{staffName}}', { staffName: 'Ahmad' }).output,
  'Salam Ahmad',
);
check(
  'ruang dalam pendakap dibenarkan',
  renderTemplate('{{ staffName }}', { staffName: 'Ahmad' }).output,
  'Ahmad',
);
check(
  'nombor ditukar ke teks',
  renderTemplate('{{days}} hari', { days: 3 }).output,
  '3 hari',
);
check(
  'medan sama beberapa kali',
  renderTemplate('{{requestNo}} / {{requestNo}}', { requestNo: 'OT-1' }).output,
  'OT-1 / OT-1',
);

console.log('\nMedan yang tidak dapat diisi');
/*
 * Recipients must never see template syntax. An em dash reads as "not applicable", which is
 * the truth, where `{{whatever}}` reads as a broken system.
 */
check('medan tidak dikenali jadi sengkang', renderTemplate('{{tiada}}', {}).output, '—');
check('nama dilaporkan', renderTemplate('{{tiada}}', {}).unknown, ['tiada']);
check('null jadi sengkang', renderTemplate('{{note}}', { note: null }).output, '—');
check('rentetan kosong jadi sengkang', renderTemplate('{{note}}', { note: '' }).output, '—');
// null is a supplied value, not a missing field: it is not reported as unknown.
check('null bukan tidak dikenali', renderTemplate('{{note}}', { note: null }).unknown, []);
check(
  'nama berulang dilaporkan sekali',
  renderTemplate('{{x}} {{x}}', {}).unknown,
  ['x'],
);

console.log('\nSemakan masa simpan');
check('medan sah lulus', unknownPlaceholders('{{staffName}} {{days}}', 'leave'), []);
check('salah taip ditangkap', unknownPlaceholders('{{staffNmae}}', 'leave'), ['staffNmae']);
// A field one module supplies is not a field every module supplies.
check('medan modul lain ditangkap', unknownPlaceholders('{{hours}}', 'leave'), ['hours']);
check('medan modul sendiri lulus', unknownPlaceholders('{{hours}}', 'overtime'), []);
check(
  'medan bersama lulus setiap modul',
  ['leave', 'overtime', 'claim', 'expenses'].flatMap((module) =>
    unknownPlaceholders('{{staffName}} {{requestNo}} {{organisation}}', module),
  ),
  [],
);

console.log('\nSenarai medan');
check('medan bersama disertakan', placeholdersFor('leave').includes('staffName'), true);
check('medan cuti disertakan', placeholdersFor('leave').includes('leaveType'), true);
check('medan lebih masa tiada pada cuti', placeholdersFor('leave').includes('hours'), false);
check('modul tidak dikenali dapat medan bersama sahaja', placeholdersFor('tiada').length, COMMON_PLACEHOLDERS.length);

console.log('\nHTML dilepaskan');
/*
 * A hospital name containing `&` would otherwise break the markup, and a value carrying a tag
 * would be interpreted rather than shown.
 */
check('ampersand dilepaskan', escapeHtml('A & B'), 'A &amp; B');
check('tag dilepaskan', escapeHtml('<script>'), '&lt;script&gt;');
check(
  'nilai medan dilepaskan dalam badan',
  textToHtml(renderTemplate('{{staffName}}', { staffName: '<b>x</b>' }).output).includes('&lt;b&gt;'),
  true,
);
check('perenggan dari baris kosong', textToHtml('satu\n\ndua').includes('</p><p'), true);
check('baris tunggal jadi br', textToHtml('satu\ndua').includes('<br>'), true);

console.log('\nTemplat lalai');
/*
 * The union, across every module. Widened from six when payroll and KPI arrived with their own
 * events, and again by `reverted` for attendance justification; the per-module count is asserted
 * further down, and that is the number the editor uses.
 *
 * `reverted` earns its own event rather than reusing `rejected`. Sending somebody a message saying
 * their reason was refused, when what happened is that they were asked to rewrite it, is the failure
 * a shared event would produce — and the wording has to say what to do next, which a rejection notice
 * has no reason to.
 */
check('setiap peristiwa ada templat', TEMPLATE_EVENTS.length, 13);
for (const event of eventsFor('leave')) {
  const seeded = defaultTemplate('leave', event);
  const bad = [
    ...unknownPlaceholders(seeded.subject, 'leave'),
    ...unknownPlaceholders(seeded.body, 'leave'),
  ];
  check(`lalai ${event} guna medan sah`, bad, []);
}
/*
 * Every module's defaults validate against its own placeholder list, or the seeded mail would be
 * refused by the very check that guards the editor.
 *
 * Iterating `eventsFor(module)` and not the union, which is the point: `defaultTemplate('leave',
 * 'payslipReady')` returns payroll wording with payroll placeholders, and asserting on that
 * combination tests a pairing no code path can produce.
 */
for (const module of ['leave', 'overtime', 'claim', 'expenses', 'applicants']) {
  const bad = eventsFor(module).flatMap((event) => {
    const seeded = defaultTemplate(module, event);
    return [
      ...unknownPlaceholders(seeded.subject, module),
      ...unknownPlaceholders(seeded.body, module),
    ];
  });
  check(`lalai ${module} guna medan sah`, bad, []);
}
check(
  'noun modul muncul dalam subjek',
  defaultTemplate('overtime', 'approved').subject.includes('lebih masa'),
  true,
);

console.log('\nPenerima setiap peristiwa');
check('kelulusan kepada pemohon', EVENT_AUDIENCE.approved, 'applicant');
// The only event aimed at somebody else. Writing it as though addressed to the applicant is
// the mistake this mapping prevents.
check('menunggu kepada pelulus', EVENT_AUDIENCE.awaitingApprover, 'approver');
check('peristiwa sah dikenali', isTemplateEvent('approved'), true);
check('peristiwa palsu ditolak', isTemplateEvent('tiada'), false);

// ---------------------------------------------------------------------------
console.log('\nSetiap modul hanya membangkitkan peristiwanya sendiri');
// ---------------------------------------------------------------------------

/*
 * The editor offers `eventsFor(module)`, not the whole union.
 *
 * A switch for something that can never fire reads as a broken feature rather than an absent one,
 * which is the same rule the notification trigger registry follows. Payroll showing `rejected`
 * would invite somebody to write a refusal notice for a period that cannot be refused.
 */
check('modul permohonan ada enam peristiwa', eventsFor('leave').length, 6);
check('cuti membangkitkan submitted', moduleRaises('leave', 'submitted'), true);
check('cuti TIDAK membangkitkan payslipReady', moduleRaises('leave', 'payslipReady'), false);

check('payroll ada empat peristiwa', eventsFor('payroll').length, 4);
check('payroll membangkitkan payslipReady', moduleRaises('payroll', 'payslipReady'), true);
// A period is not applied for and is not refused: a mistake found later is an adjustment.
check('payroll TIDAK membangkitkan submitted', moduleRaises('payroll', 'submitted'), false);
check('payroll TIDAK membangkitkan rejected', moduleRaises('payroll', 'rejected'), false);
check(
  'payroll TIDAK membangkitkan awaitingApprover',
  moduleRaises('payroll', 'awaitingApprover'),
  false,
);

check('kpi ada dua peristiwa', eventsFor('kpi').length, 2);
check('kpi membangkitkan reviewAssigned', moduleRaises('kpi', 'reviewAssigned'), true);
check('kpi membangkitkan appraisalFinalised', moduleRaises('kpi', 'appraisalFinalised'), true);
// An appraisal is finalised, not granted.
check('kpi TIDAK membangkitkan approved', moduleRaises('kpi', 'approved'), false);

// A module nothing has named falls back to the request six rather than to nothing at all.
check('modul tidak dikenali jatuh ke enam peristiwa', eventsFor('tiada').length, 6);

// ---------------------------------------------------------------------------
console.log('\nPenerima peristiwa payroll dan KPI');
// ---------------------------------------------------------------------------

// Payroll mail is addressed to the person paid, never to whoever ran the period.
check('slip gaji kepada pekerja', EVENT_AUDIENCE.payslipReady, 'applicant');
check('bonus diluluskan kepada pekerja', EVENT_AUDIENCE.awardApproved, 'applicant');
check('pinjaman diluluskan kepada pekerja', EVENT_AUDIENCE.lendingApproved, 'applicant');
// The one KPI event aimed elsewhere: a reviewer is being given work, not told an outcome.
check('penilaian ditugaskan kepada penilai', EVENT_AUDIENCE.reviewAssigned, 'approver');
check('penilaian muktamad kepada yang dinilai', EVENT_AUDIENCE.appraisalFinalised, 'applicant');

// ---------------------------------------------------------------------------
console.log('\nTemplat lalai bagi peristiwa baharu boleh dirender penuh');
// ---------------------------------------------------------------------------

/*
 * Every seeded template must render with nothing left unfilled from its own module's list.
 *
 * A default naming a placeholder the module cannot supply ships an em dash to a recipient on the
 * very first send, and nobody notices until somebody reads their own payslip notice.
 */
for (const module of ['payroll', 'kpi']) {
  const allowed = placeholdersFor(module);
  const vars = Object.fromEntries(allowed.map((name) => [name, `[${name}]`]));

  for (const event of eventsFor(module)) {
    const seeded = defaultTemplate(module, event);
    const subject = renderTemplate(seeded.subject, vars);
    const body = renderTemplate(seeded.body, vars);
    check(
      `${module}/${event}: tiada placeholder tidak dikenali`,
      [...subject.unknown, ...body.unknown],
      [],
    );
    check(
      `${module}/${event}: tiada baki sintaks templat`,
      /\{\{/.test(subject.output) || /\{\{/.test(body.output),
      false,
    );
  }
}

check('payroll ada placeholder netPay', placeholdersFor('payroll').includes('netPay'), true);
check('kpi ada placeholder grade', placeholdersFor('kpi').includes('grade'), true);
// Cross-module leakage: a payroll template must not be able to name a KPI field.
check('payroll TIADA placeholder grade', placeholdersFor('payroll').includes('grade'), false);
check(
  'placeholder KPI dalam templat payroll ditolak',
  unknownPlaceholders('Gred {{grade}}', 'payroll'),
  ['grade'],
);

console.log(`\n${passed} lulus, ${failed} gagal\n`);
process.exit(failed > 0 ? 1 : 0);
