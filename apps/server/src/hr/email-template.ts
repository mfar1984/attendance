/**
 * Email templates for HR request modules: which events send mail, and what it says.
 *
 * Import-free, so the substitution and the placeholder validation run without a database.
 * That matters here because a template is written by an operator, and the failure mode of a
 * bad one is mail that goes out with `{{staffNmae}}` printed in it.
 *
 * ── Why templates are stored rather than coded ──
 *
 * The wording of a decision email is a hospital's own. It carries their department names,
 * their escalation instructions, their tone. Every one of those is a request that would
 * otherwise arrive as "can you change the email text", which is a deployment to change a
 * sentence.
 */

/**
 * Every event any module can send mail for.
 *
 * The union, not the menu. Which of these a given module actually raises is `MODULE_EVENTS`
 * below, and the editor only offers those — a toggle for something that never happens reads as a
 * broken feature rather than an absent one, which is the same rule the notification trigger
 * registry follows.
 */
export const TEMPLATE_EVENTS = [
  // Request lifecycle: leave, overtime, claim, expenses, applicants.
  'submitted',
  'levelApproved',
  'approved',
  'rejected',
  'cancelled',
  'awaitingApprover',
  // Payroll. No `submitted` and no `rejected`: a period is not applied for and is not refused.
  'payslipReady',
  'awardApproved',
  'awardCancelled',
  'lendingApproved',
  // KPI. Scoring, not signatures.
  'reviewAssigned',
  'appraisalFinalised',
  /*
   * Attendance justification's third outcome.
   *
   * pproved and 
ejected are shared with the request modules, but sending a day back for a
   * better explanation is its own event: `your reason was not accepted'' and `I cannot act on what
   * you wrote'' are different messages, and only one of them means the person should try again.
   */
  'reverted',
] as const;

export type TemplateEvent = (typeof TEMPLATE_EVENTS)[number];

export function isTemplateEvent(value: string): value is TemplateEvent {
  return (TEMPLATE_EVENTS as readonly string[]).includes(value);
}

/** The six a request module raises, in the order they occur. */
const REQUEST_EVENTS = [
  'submitted',
  'levelApproved',
  'approved',
  'rejected',
  'cancelled',
  'awaitingApprover',
] as const satisfies readonly TemplateEvent[];

/**
 * Which events each module actually raises.
 *
 * Payroll has no `rejected` because a period is not refused — a mistake found after approval is
 * an adjustment in a following period. KPI has no `approved` because an appraisal is finalised
 * rather than granted. Offering either would put a switch on screen that nothing can ever flip.
 */
export const MODULE_EVENTS: Record<string, readonly TemplateEvent[]> = {
  leave: REQUEST_EVENTS,
  overtime: REQUEST_EVENTS,
  claim: REQUEST_EVENTS,
  expenses: REQUEST_EVENTS,
  applicants: REQUEST_EVENTS,
  payroll: ['payslipReady', 'awardApproved', 'awardCancelled', 'lendingApproved'],
  kpi: ['reviewAssigned', 'appraisalFinalised'],
  /*
   * No submitted. A supervisor learns about new explanations from the live count on the menu
   * entry, which goes down as they work through it — a message per submission would arrive dozens
   * at a time on the first of the month and be filtered away by the second.
   */
  justification: ['approved', 'rejected', 'reverted'],
};

/** Events a module raises, or the request six for a module nothing has named. */
export function eventsFor(module: string): readonly TemplateEvent[] {
  return MODULE_EVENTS[module] ?? REQUEST_EVENTS;
}

/** Whether a module raises an event, checked before a template for it is stored. */
export function moduleRaises(module: string, event: TemplateEvent): boolean {
  return eventsFor(module).includes(event);
}

/**
 * Who each event is addressed to.
 *
 * Recorded because it decides which placeholders make sense and who the editor says the mail
 * goes to. `awaitingApprover` is the only one aimed at somebody other than the applicant, and
 * writing it as though it were addressed to the applicant is the mistake this prevents.
 */
export const EVENT_AUDIENCE: Record<TemplateEvent, 'applicant' | 'approver'> = {
  submitted: 'applicant',
  levelApproved: 'applicant',
  approved: 'applicant',
  rejected: 'applicant',
  cancelled: 'applicant',
  awaitingApprover: 'approver',
  /*
   * Payroll mail is addressed to the person paid, not to whoever ran the period.
   *
   * `payslipReady` fires when the period is marked paid rather than when it is approved. Approval
   * moves no money, and telling somebody their pay is ready before it has left the building is
   * the kind of message that generates a phone call rather than answering one.
   */
  payslipReady: 'applicant',
  awardApproved: 'applicant',
  awardCancelled: 'applicant',
  lendingApproved: 'applicant',
  /** The one KPI event aimed elsewhere: a reviewer is being given work, not told an outcome. */
  reviewAssigned: 'approver',
  appraisalFinalised: 'applicant',
  /** Addressed to the person who wrote the explanation, and asking them to write a better one. */
  reverted: 'applicant',
};

/**
 * Placeholders every module supplies.
 *
 * Names are the wire format — an operator types `{{staffName}}` into a template — so they are
 * not translated and not renamed. A rename would silently blank the field in every template
 * already written.
 */
export const COMMON_PLACEHOLDERS = [
  'organisation',
  'staffName',
  'employeeNo',
  'requestNo',
  'status',
  'decidedBy',
  'note',
  'level',
  'totalLevels',
  'awaitingLevel',
  'awaitingApprover',
] as const;

/** Placeholders only one module can fill. */
export const MODULE_PLACEHOLDERS: Record<string, readonly string[]> = {
  leave: ['leaveType', 'fromDate', 'toDate', 'days'],
  overtime: ['workDate', 'hours', 'measuredHours', 'multiplier', 'amount', 'dayType'],
  /*
   * `amount` is the sum of the lines, and `items` is the lines themselves — one per row, as text.
   *
   * A claim holds several costs on several dates, so a decision notice carrying only the total says
   * "RM 155.80 approved" about three things the recipient has to remember unaided. `itemCount` is
   * offered separately because a subject line has no room for the list.
   *
   * `incurredOn` stays the claim's date rather than becoming a range: it is what the request is filed
   * against, and each line's own date is inside `items`.
   */
  claim: [
    'claimType',
    'incurredOn',
    'amount',
    'approvedAmount',
    'quantity',
    'itemCount',
    'items',
  ],
  expenses: ['category', 'incurredOn', 'payee', 'amount', 'approvedAmount'],
  /*
   * `staffName` carries the candidate's name here, not an employee's — an applicant is not on
   * the payroll yet. Reusing the common placeholder rather than adding `candidateName` keeps
   * one name for "the person this is about" across every template.
   */
  applicants: ['jobTitle', 'postingCode', 'applicantNo', 'pipelineStatus', 'interviewAt'],
  /*
   * One list across all four payroll events, like every other module.
   *
   * A field the firing event does not supply renders as an em dash and is logged, so a template
   * that mentions `{{netPay}}` on an award notice degrades visibly rather than leaking template
   * syntax. Splitting the list per event would be more precise and would also mean an operator
   * cannot see, in one place, what payroll can tell them.
   */
  payroll: [
    'periodCode',
    'periodName',
    'paymentDate',
    'gross',
    'deductions',
    'netPay',
    'payslipNo',
    'amount',
    'instalment',
    'balance',
    'startsOn',
  ],
  kpi: ['periodName', 'templateName', 'dueOn', 'totalScore', 'grade', 'reviewer'],
  /*
   * 
"requestNo" carries the work date here — a justification has no request number, and the day is
   * what identifies it to both parties.
   *
   * "statusKind" is the state being explained — late, early_leave, incomplete, absent — and is
   * separate from "status", which is the decision. Two fields that both read as "status" is the kind
   * of thing that gets a template written the wrong way round, so both are offered by name.
   */
  justification: ['workDate', 'statusKind', 'shiftName', 'checkInAt', 'checkOutAt', 'lateMinutes'],
};

/** Every placeholder a module's templates may use. */
export function placeholdersFor(module: string): string[] {
  return [...COMMON_PLACEHOLDERS, ...(MODULE_PLACEHOLDERS[module] ?? [])];
}

export type TemplateVars = Record<string, string | number | null | undefined>;

/**
 * Substitutes `{{name}}` and reports anything it could not fill.
 *
 * Two deliberate choices about the failure case.
 *
 * A placeholder the module does not supply is replaced with an em dash rather than left as
 * `{{whatever}}`. Recipients should never see template syntax; a dash reads as "not
 * applicable", which is the truth.
 *
 * The names it could not fill come back so the editor can name them while somebody is still
 * writing the template. Warning at save time is the only moment the mistake is cheap.
 */
export function renderTemplate(
  text: string,
  vars: TemplateVars,
): { output: string; unknown: string[] } {
  const unknown = new Set<string>();

  const output = text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, rawName: string) => {
    const value = vars[rawName];
    if (value === undefined) {
      unknown.add(rawName);
      return '—';
    }
    if (value === null || value === '') return '—';
    return String(value);
  });

  return { output, unknown: [...unknown] };
}

/**
 * Placeholders in a template that the module cannot fill.
 *
 * Run when a template is saved. Checked against the module's list rather than against a
 * sample render, because an event that has never fired would otherwise validate clean and
 * fail in front of a recipient.
 */
export function unknownPlaceholders(text: string, module: string): string[] {
  const allowed = new Set(placeholdersFor(module));
  const found = new Set<string>();

  for (const match of text.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
    const name = match[1];
    if (name !== undefined && !allowed.has(name)) found.add(name);
  }
  return [...found];
}

/**
 * Escapes text for the HTML part.
 *
 * Templates are written by operators and rendered into an email body. Without this, a
 * hospital name containing `&` breaks the markup, and a placeholder value carrying a tag
 * would be interpreted rather than shown.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Turns a rendered plain-text body into a minimal HTML part.
 *
 * Paragraphs from blank lines, `<br>` from single ones. Deliberately not a rich editor: an
 * operator writing a decision notice needs paragraphs and nothing else, and every extra
 * capability is another way to send mail that renders differently in Outlook.
 */
export function textToHtml(text: string): string {
  const paragraphs = escapeHtml(text)
    .split(/\n{2,}/)
    .map((block) => block.replace(/\n/g, '<br>'))
    .filter((block) => block.trim().length > 0)
    .map((block) => `<p style="margin:0 0 12px">${block}</p>`);

  return `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">${paragraphs.join('')}</div>`;
}

/**
 * Starting templates, per event.
 *
 * Seeded rather than left blank so an installation that switches email on gets something
 * sensible immediately. Written in Malay because that is the source language of this
 * application, and edited from the settings screen like everything else here.
 *
 * `{{module}}` is not a placeholder: each module seeds its own noun, because "Permohonan anda"
 * reads worse than "Permohonan cuti anda" and the difference is the whole point of having a
 * template per module.
 */
export function defaultTemplate(
  module: string,
  event: TemplateEvent,
): { subject: string; body: string } {
  const noun = MODULE_NOUN[module] ?? 'permohonan';

  switch (event) {
    case 'submitted':
      return {
        subject: `{{requestNo}} — ${noun} anda diterima`,
        body:
          `Salam {{staffName}},\n\n` +
          `${capitalise(noun)} anda ({{requestNo}}) sudah diterima dan sedang menunggu keputusan.\n\n` +
          `Anda akan dimaklumkan sebaik keputusan dibuat.\n\n{{organisation}}`,
      };
    case 'levelApproved':
      return {
        subject: `{{requestNo}} — diluluskan pada aras {{level}} daripada {{totalLevels}}`,
        body:
          `Salam {{staffName}},\n\n` +
          `${capitalise(noun)} anda ({{requestNo}}) diluluskan pada aras {{level}} daripada ` +
          `{{totalLevels}} oleh {{decidedBy}}.\n\n` +
          `Ia masih menunggu kelulusan aras {{awaitingLevel}} ({{awaitingApprover}}), jadi ia ` +
          `belum diluluskan sepenuhnya.\n\n{{organisation}}`,
      };
    case 'approved':
      return {
        subject: `{{requestNo}} — ${noun} anda DILULUSKAN`,
        body:
          `Salam {{staffName}},\n\n` +
          `${capitalise(noun)} anda ({{requestNo}}) telah DILULUSKAN oleh {{decidedBy}}.\n\n` +
          `Catatan: {{note}}\n\n{{organisation}}`,
      };
    case 'rejected':
      return {
        subject: `{{requestNo}} — ${noun} anda DITOLAK`,
        body:
          `Salam {{staffName}},\n\n` +
          `${capitalise(noun)} anda ({{requestNo}}) telah DITOLAK oleh {{decidedBy}}.\n\n` +
          `Sebab: {{note}}\n\n` +
          `Hubungi jabatan anda jika perlu penjelasan lanjut.\n\n{{organisation}}`,
      };
    case 'cancelled':
      return {
        subject: `{{requestNo}} — ${noun} ditarik`,
        body:
          `Salam {{staffName}},\n\n` +
          `${capitalise(noun)} anda ({{requestNo}}) telah ditarik.\n\n{{organisation}}`,
      };
    case 'awaitingApprover':
      return {
        subject: `{{requestNo}} — menunggu kelulusan anda`,
        body:
          `Salam,\n\n` +
          `Satu ${noun} menunggu keputusan anda pada aras {{awaitingLevel}}.\n\n` +
          `Staf: {{staffName}} ({{employeeNo}})\n` +
          `Rujukan: {{requestNo}}\n\n{{organisation}}`,
      };

    /*
     * Payroll. The net figure is in the body and the breakdown is not.
     *
     * A payslip has twenty lines and email is not where somebody reconciles them — the figure they
     * want on their phone is what reached the bank. The rest is on the payslip itself.
     */
    case 'payslipReady':
      return {
        subject: `Slip gaji {{periodName}} — {{payslipNo}}`,
        body:
          `Salam {{staffName}},\n\n` +
          `Gaji anda bagi tempoh {{periodName}} sudah dibayar pada {{paymentDate}}.\n\n` +
          `Slip: {{payslipNo}}\n` +
          `Gaji kasar: RM{{gross}}\n` +
          `Jumlah potongan: RM{{deductions}}\n` +
          `Gaji bersih: RM{{netPay}}\n\n` +
          `Pecahan penuh ada pada slip gaji anda. Hubungi jabatan anda jika ada angka yang ` +
          `tidak sepadan.\n\n{{organisation}}`,
      };
    case 'awardApproved':
      return {
        subject: `{{requestNo}} — {{amount}} diluluskan untuk {{periodName}}`,
        body:
          `Salam {{staffName}},\n\n` +
          `Bayaran berjumlah RM{{amount}} ({{requestNo}}) telah diluluskan dan akan dibayar ` +
          `bersama gaji tempoh {{periodName}}.\n\n` +
          `Catatan: {{note}}\n\n{{organisation}}`,
      };
    case 'awardCancelled':
      return {
        subject: `{{requestNo}} — bayaran dibatalkan`,
        body:
          `Salam {{staffName}},\n\n` +
          `Bayaran berjumlah RM{{amount}} ({{requestNo}}) telah dibatalkan dan tidak akan ` +
          `dibayar.\n\n` +
          `Sebab: {{note}}\n\n` +
          `Hubungi jabatan anda jika perlu penjelasan lanjut.\n\n{{organisation}}`,
      };
    case 'lendingApproved':
      /*
       * The instalment and the start date, because those are the two facts somebody needs before
       * their pay changes. A deduction that appears without warning reads as an error.
       */
      return {
        subject: `{{requestNo}} — potongan bermula {{startsOn}}`,
        body:
          `Salam {{staffName}},\n\n` +
          `Permohonan anda ({{requestNo}}) berjumlah RM{{amount}} telah diluluskan.\n\n` +
          `Potongan bulanan: RM{{instalment}}\n` +
          `Potongan pertama: {{startsOn}}\n` +
          `Baki semasa: RM{{balance}}\n\n{{organisation}}`,
      };

    /* KPI. */
    case 'reviewAssigned':
      return {
        subject: `Penilaian {{periodName}} — {{staffName}}`,
        body:
          `Salam,\n\n` +
          `Anda ditugaskan menilai {{staffName}} ({{employeeNo}}) bagi tempoh {{periodName}}.\n\n` +
          `Templat: {{templateName}}\n` +
          `Tarikh jatuh tempo: {{dueOn}}\n\n{{organisation}}`,
      };
    case 'appraisalFinalised':
      return {
        subject: `Penilaian {{periodName}} anda telah dimuktamadkan`,
        body:
          `Salam {{staffName}},\n\n` +
          `Penilaian anda bagi tempoh {{periodName}} telah dimuktamadkan.\n\n` +
          `Markah: {{totalScore}}%\n` +
          `Hubungi penilai anda jika ingin membincangkannya.\n\n{{organisation}}`,
      };
    /*
     * Sent back for a better explanation.
     *
     * The wording has to say what to do next, which is the whole reason this is a separate event
     * from `rejected`. A message that only reports an outcome leaves somebody with a note they
     * cannot act on — and this outcome is specifically an invitation to try again.
     */
    case 'reverted':
      return {
        subject: `{{requestNo}} — sebab anda dihantar semula`,
        body:
          `Salam {{staffName}},\n\n` +
          `Sebab yang anda beri bagi {{requestNo}} ({{statusKind}}) dihantar semula oleh ` +
          `{{decidedBy}} untuk diperbaiki. Ia belum ditolak.\n\n` +
          `Catatan: {{note}}\n\n` +
          `Buka Rekod Saya › Justifikasi Saya dan tulis semula sebabnya.\n\n{{organisation}}`,
      };
  }
}

const MODULE_NOUN: Record<string, string> = {
  leave: 'permohonan cuti',
  overtime: 'permohonan lebih masa',
  claim: 'tuntutan',
  expenses: 'permohonan perbelanjaan',
  applicants: 'permohonan jawatan',
  payroll: 'bayaran',
  kpi: 'penilaian',
  /*
   * "sebab", not "justifikasi".
   *
   * The templates read `${capitalise(noun)} anda ({{requestNo}}) telah DILULUSKAN` — "Sebab anda
   * telah DILULUSKAN" is the sentence somebody would say out loud, and "Justifikasi anda telah
   * DILULUSKAN" is the sentence a form would.
   */
  justification: 'sebab',
};

function capitalise(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
