/**
 * The permission registry.
 *
 * One row per screen, not one row per database table. The question a person
 * setting up a role is answering is "can a ward clerk open the payroll export",
 * and that maps to a screen. A registry keyed by table forces them to reason
 * about which screens touch which tables, which is knowledge they do not have and
 * should not need.
 *
 * This file is the single source of truth. The server validates grants against it
 * and the web matrix renders from it, so a screen cannot exist in one and be
 * missing from the other.
 *
 * Wording lives in the translation registry, and this file holds keys. Many of them are keys
 * the interface already uses elsewhere — the matrix row for the exceptions queue names it with
 * the same label as that screen's own title, because they are the same words.
 */

import { LABELS, type LabelKey } from '@attendance/shared';

/**
 * Actions that get their own column in the matrix.
 *
 * Fixed and ordered, so the columns stay in the same place on every row. A screen
 * that does not support one shows a dash rather than an unusable checkbox.
 */
export const STANDARD_ACTIONS = [
  'create',
  'view',
  'edit',
  'delete',
  'approve',
  'suspend',
  'activate',
] as const;

export type StandardAction = (typeof STANDARD_ACTIONS)[number];

/**
 * Registry keys, not words.
 *
 * The matrix is a screen somebody reads, so its wording resolves through the translation
 * registry. The server still needs the words for the message a refused request returns —
 * `screenLabel` and `actionLabel` resolve them from the source wording.
 */
export const ACTION_LABELS: Record<string, LabelKey> = {
  create: 'action.create',
  view: 'action.view',
  edit: 'action.edit',
  delete: 'action.delete',
  approve: 'action.approve',
  suspend: 'action.suspend',
  activate: 'action.activate',
};

/** An action specific to one screen, shown in the OTHERS column with its own label. */
export interface CustomAction {
  id: string;
  labelKey: LabelKey;
  /** Why this is separate from edit. Surfaced as a tooltip. */
  noteKey?: LabelKey;
}

export interface ScreenPermission {
  /** Stored key. Also the value passed to `requirePermission`. */
  key: string;
  labelKey: LabelKey;
  /** Route this screen lives at, so the matrix can link to it. */
  path?: string;
  actions: StandardAction[];
  custom?: CustomAction[];
  /** Shown beside the row when the limits need explaining. */
  noteKey?: LabelKey;
  /**
   * Marks a screen whose endpoints are not built yet.
   *
   * Kept in the type rather than removed now that every screen exists, because the
   * next feature will need it again — and a grant that silently does nothing is worse
   * than one labelled as not yet wired up.
   */
  planned?: boolean;
}

export interface PermissionSection {
  key: string;
  labelKey: LabelKey;
  screens: ScreenPermission[];
}

/**
 * The source wording for a screen, for messages the server writes.
 *
 * A refused request explains itself in prose, and prose needs words. The reader's language
 * is not available here, so this resolves the source wording — the same string the registry
 * holds and the same one the interface falls back to.
 */
export function screenLabel(key: string): string {
  const screen = findScreen(key);
  return screen === undefined ? key : LABELS[screen.labelKey];
}

/** The source wording for one action, for the same reason. */
export function actionLabel(action: string): string {
  const labelKey = ACTION_LABELS[action];
  return labelKey === undefined ? action : LABELS[labelKey];
}

export const PERMISSION_SECTIONS: PermissionSection[] = [
  {
    key: 'dashboard',
    labelKey: 'perm.screen.dashboard',
    screens: [{ key: 'dashboard', labelKey: 'perm.screen.dashboard', path: '/', actions: ['view'] }],
  },
  {
    key: 'attendance',
    labelKey: 'nav.group.attendance',
    screens: [
      {
        key: 'attendance.monitor',
        labelKey: 'nav.attendance.monitor',
        path: '/kehadiran/monitor',
        actions: ['view'],
      },
      {
        key: 'attendance.records',
        labelKey: 'records.title',
        path: '/kehadiran/rekod',
        actions: ['view', 'edit', 'approve'],
        custom: [{ id: 'export', labelKey: 'action.export' }],
        noteKey: 'perm.note.attendance.records',
      },
      {
        /**
         * View and export only, for every role including Super Admin.
         *
         * This is the untouched device log. It is what settles a dispute over a
         * computed record, so the ability to alter it does not exist rather than
         * being merely left unassigned. Enforced in `validatePermissions`.
         */
        key: 'attendance.rawLog',
        labelKey: 'rawlog.title',
        path: '/kehadiran/log-scan',
        actions: ['view'],
        custom: [{ id: 'export', labelKey: 'action.export' }],
        noteKey: 'perm.note.attendance.rawLog',
      },
      /*
       * Deciding the explanations staff file for their own attendance.
       *
       * Its own screen, separate from `attendance.exceptions`, and the separation is the point.
       * Exceptions are the eight conditions the engine could not resolve — an unmatched face, a
       * terminal whose clock drifted — and resolving one corrects data. This is the four states the
       * engine resolved with confidence and that somebody wants to account for; deciding one changes
       * no attendance figure anywhere.
       *
       * One screen for both would ask the same person to decide "this terminal's clock drifted by
       * eight minutes" and "Siti was late because her child was ill" through one form, with nothing
       * saying which kind of thing they were looking at.
       *
       * No `create`: a justification is filed by the person it is about, through `/api/saya/*`,
       * which is reached with a session and no screen permission. No `edit` either — a supervisor
       * decides an explanation, they do not rewrite it.
       */
      {
        key: 'attendance.justifications',
        labelKey: 'justify.title',
        noteKey: 'perm.note.attendance.justifications',
        path: '/kehadiran/justifikasi',
        actions: ['view', 'approve'],
        custom: [{ id: 'export', labelKey: 'action.export' }],
      },
      {
        key: 'attendance.exceptions',
        labelKey: 'exceptions.title',
        path: '/kehadiran/pengecualian',
        actions: ['view', 'approve'],
        custom: [{ id: 'export', labelKey: 'action.export' }],
        noteKey: 'perm.note.attendance.exceptions',
      },
    ],
  },
  {
    key: 'staff',
    labelKey: 'nav.group.staff',
    screens: [
      {
        key: 'staff.directory',
        labelKey: 'staff.title',
        path: '/staf',
        actions: ['create', 'view', 'edit', 'delete'],
        custom: [
          { id: 'export', labelKey: 'action.export' },
          { id: 'resync', labelKey: 'perm.action.resync', noteKey: 'perm.action.resync.note' },
          /*
           * Separate from `edit`, and it gates reading as well as writing.
           *
           * A clerk who maintains the directory has a reason to fix a phone number and
           * no reason to read what a colleague earns. Folding the wage into `edit` would
           * hand out every salary in the hospital with the permission to correct a
           * typo — and the field is what prices every overtime claim, so writing it is
           * a payroll decision wearing a directory form.
           */
          { id: 'salary', labelKey: 'perm.action.salary', noteKey: 'perm.action.salary.note' },
        ],
      },
      {
        key: 'staff.biometrics',
        labelKey: 'biometrics.title',
        path: '/staf/biometrik',
        actions: ['create', 'view', 'delete'],
        noteKey: 'perm.note.staff.biometrics',
      },
      {
        key: 'staff.mapping',
        labelKey: 'mapping.title',
        path: '/staf/pemetaan',
        actions: ['create', 'view', 'delete'],
        custom: [
          { id: 'import', labelKey: 'perm.action.import', noteKey: 'perm.action.import.note' },
        ],
      },
      {
        key: 'staff.import',
        labelKey: 'import.title',
        path: '/staf/import',
        actions: ['create', 'view'],
        custom: [{ id: 'template', labelKey: 'perm.action.template' }],
      },
      {
        key: 'staff.departments',
        labelKey: 'perm.screen.staff.departments',
        path: '/staf/jabatan',
        actions: ['create', 'view', 'edit', 'delete'],
      },
      {
        key: 'staff.locations',
        labelKey: 'perm.screen.staff.locations',
        path: '/staf/jabatan',
        actions: ['create', 'view', 'edit', 'delete'],
      },
    ],
  },
  {
    key: 'schedule',
    labelKey: 'nav.group.schedule',
    screens: [
      {
        key: 'schedule.workPatterns',
        labelKey: 'perm.screen.schedule.workPatterns',
        path: '/jadual/shift',
        actions: ['create', 'view', 'edit', 'delete'],
      },
      {
        key: 'schedule.shifts',
        labelKey: 'perm.screen.schedule.shifts',
        path: '/jadual/shift',
        actions: ['create', 'view', 'edit', 'delete'],
      },
      {
        key: 'schedule.roster',
        labelKey: 'roster.title',
        path: '/jadual/kalendar',
        actions: ['view', 'edit', 'delete'],
        noteKey: 'perm.note.schedule.roster',
      },
      {
        key: 'schedule.holidays',
        labelKey: 'holidays.title',
        path: '/jadual/cuti-umum',
        actions: ['create', 'view', 'delete'],
      },
    ],
  },
  /**
   * The four request types, in one section because they are one idiom: somebody files, a
   * supervisor decides. A role that approves is usually allowed to approve all four.
   *
   * `schedule.leave` keeps its key. It is what stored role rows hold and what
   * `requireScreen` is called with across the leave routes, so renaming it to `hr.leave`
   * would silently drop the grant from every saved role. Only the section it displays under
   * has moved.
   */
  {
    key: 'hr.requests',
    labelKey: 'nav.group.requests',
    screens: [
      {
        key: 'schedule.leave',
        labelKey: 'leave.title',
        path: '/jadual/permohonan',
        actions: ['create', 'view', 'edit', 'delete', 'approve'],
        custom: [
          /*
           * Added alongside the shared approval engine. Deciding an application and
           * rewriting the chain that decides it are different jobs: an approver signs, an
           * administrator changes who signs.
           */
          {
            id: 'configure',
            labelKey: 'perm.action.configure',
            noteKey: 'perm.action.configure.note',
          },
        ],
        noteKey: 'perm.note.schedule.leave',
      },
      {
        key: 'hr.claims',
        labelKey: 'nav.hr.claims',
        path: '/hr/permohonan/tuntutan',
        actions: ['create', 'view', 'edit', 'delete', 'approve'],
        custom: [
          {
            id: 'configure',
            labelKey: 'perm.action.configure',
            noteKey: 'perm.action.configure.note',
          },
          { id: 'export', labelKey: 'action.export' },
        ],
        noteKey: 'perm.note.hr.claims',
      },
      {
        key: 'hr.overtime',
        labelKey: 'nav.hr.overtime',
        path: '/hr/permohonan/lebih-masa',
        actions: ['create', 'view', 'edit', 'delete', 'approve'],
        custom: [
          {
            id: 'configure',
            labelKey: 'perm.action.configure',
            noteKey: 'perm.action.configure.note',
          },
          { id: 'export', labelKey: 'action.export' },
        ],
        noteKey: 'perm.note.hr.overtime',
      },
      {
        key: 'hr.expenses',
        labelKey: 'nav.hr.expenses',
        path: '/hr/permohonan/perbelanjaan',
        actions: ['create', 'view', 'edit', 'delete', 'approve'],
        custom: [
          {
            id: 'configure',
            labelKey: 'perm.action.configure',
            noteKey: 'perm.action.configure.note',
          },
          { id: 'export', labelKey: 'action.export' },
        ],
        noteKey: 'perm.note.hr.expenses',
      },
    ],
  },
  {
    key: 'hr.recruitment',
    labelKey: 'nav.group.recruitment',
    screens: [
      {
        key: 'hr.career',
        labelKey: 'nav.hr.career',
        path: '/hr/pengambilan/iklan',
        actions: ['create', 'view', 'edit', 'delete'],
      },
      {
        key: 'hr.applicants',
        labelKey: 'nav.hr.applicants',
        path: '/hr/pengambilan/pemohon',
        actions: ['view', 'edit', 'delete', 'approve'],
        custom: [{ id: 'export', labelKey: 'action.export' }],
        noteKey: 'perm.note.hr.applicants',
      },
      {
        key: 'hr.careerArchive',
        labelKey: 'nav.hr.careerArchive',
        path: '/hr/pengambilan/arkib',
        actions: ['view', 'delete'],
        custom: [{ id: 'export', labelKey: 'action.export' }],
      },
      {
        key: 'hr.careerSettings',
        labelKey: 'nav.hr.careerSettings',
        path: '/hr/pengambilan/tetapan',
        actions: ['view', 'edit'],
      },
    ],
  },
  /**
   * Results sit apart from reviews on purpose. A grade carries a bonus, and the people who
   * may read the finished grade are not the people who may reopen the review behind it.
   */
  {
    key: 'hr.kpi',
    labelKey: 'nav.group.kpi',
    screens: [
      {
        key: 'hr.kpiTemplates',
        labelKey: 'nav.hr.kpiTemplates',
        path: '/hr/kpi/templat',
        actions: ['create', 'view', 'edit', 'delete'],
      },
      {
        key: 'hr.kpiPeriods',
        labelKey: 'nav.hr.kpiPeriods',
        path: '/hr/kpi/tempoh',
        actions: ['create', 'view', 'edit', 'delete'],
      },
      {
        key: 'hr.kpiAssignments',
        labelKey: 'nav.hr.kpiAssignments',
        path: '/hr/kpi/penugasan',
        actions: ['create', 'view', 'edit', 'delete'],
      },
      {
        key: 'hr.kpiReviews',
        labelKey: 'nav.hr.kpiReviews',
        path: '/hr/kpi/semakan',
        actions: ['view', 'edit', 'approve'],
      },
      {
        key: 'hr.kpiResults',
        labelKey: 'nav.hr.kpiResults',
        path: '/hr/kpi/keputusan',
        actions: ['view'],
        custom: [{ id: 'export', labelKey: 'action.export' }],
        noteKey: 'perm.note.hr.kpiResults',
      },
      {
        key: 'hr.kpiSettings',
        labelKey: 'nav.hr.kpiSettings',
        path: '/hr/kpi/tetapan',
        // Same split as payroll: `edit` moves the grade bands, `configure` owns the notification
        // wiring and the wording an appraisal notice goes out with.
        custom: [
          {
            id: 'configure',
            labelKey: 'perm.action.configure',
            noteKey: 'perm.action.configure.note',
          },
        ],
        actions: ['view', 'edit'],
      },
    ],
  },
  /**
   * Split per screen rather than one `hr.payroll` key, because these are not degrees of the
   * same secret. Somebody who prepares allowances has no reason to read what a colleague
   * still owes on a loan, and one key would hand them both together.
   */
  {
    key: 'hr.payroll',
    labelKey: 'nav.group.payroll',
    screens: [
      {
        key: 'hr.payrollPeriods',
        labelKey: 'nav.hr.payrollPeriods',
        path: '/hr/payroll/tempoh',
        actions: ['create', 'view', 'edit', 'delete', 'approve'],
        custom: [{ id: 'export', labelKey: 'action.export' }],
        noteKey: 'perm.note.hr.payrollPeriods',
      },
      {
        key: 'hr.allowances',
        labelKey: 'nav.hr.allowances',
        path: '/hr/payroll/elaun',
        actions: ['create', 'view', 'edit', 'delete'],
      },
      {
        key: 'hr.bonuses',
        labelKey: 'nav.hr.bonuses',
        path: '/hr/payroll/bonus',
        actions: ['create', 'view', 'edit', 'delete', 'approve'],
      },
      {
        key: 'hr.commissions',
        labelKey: 'nav.hr.commissions',
        path: '/hr/payroll/komisen',
        actions: ['create', 'view', 'edit', 'delete', 'approve'],
      },
      {
        key: 'hr.loans',
        labelKey: 'nav.hr.loans',
        path: '/hr/payroll/pinjaman',
        actions: ['create', 'view', 'edit', 'delete', 'approve'],
        noteKey: 'perm.note.hr.loans',
      },
      {
        key: 'hr.advances',
        labelKey: 'nav.hr.advances',
        path: '/hr/payroll/pendahuluan',
        actions: ['create', 'view', 'edit', 'delete', 'approve'],
      },
      {
        key: 'hr.payrollSettings',
        labelKey: 'nav.hr.payrollSettings',
        path: '/hr/payroll/tetapan',
        actions: ['view', 'edit'],
        custom: [
          /*
           * `edit` moves the statutory rates; `configure` owns the notification wiring and the
           * wording of the mail. Different jobs held by different people: finance confirms a
           * contribution rate, and whoever owns hospital correspondence writes the notice.
           */
          {
            id: 'configure',
            labelKey: 'perm.action.configure',
            noteKey: 'perm.action.configure.note',
          },
        ],
      },
    ],
  },
  {
    key: 'reports',
    labelKey: 'nav.group.reports',
    screens: [
      {
        key: 'reports.monthly',
        labelKey: 'monthly.title',
        path: '/laporan/bulanan',
        actions: ['view'],
        custom: [{ id: 'export', labelKey: 'action.export' }],
      },
      {
        key: 'reports.payroll',
        labelKey: 'payroll.title',
        path: '/laporan/payroll',
        actions: ['view'],
        custom: [{ id: 'export', labelKey: 'action.export' }],
        noteKey: 'perm.note.reports.payroll',
      },
      {
        key: 'reports.builder',
        labelKey: 'builder.title',
        path: '/laporan/penjana',
        actions: ['view'],
        custom: [{ id: 'export', labelKey: 'action.export' }],
      },
    ],
  },
  {
    key: 'settings',
    labelKey: 'nav.group.settings',
    screens: [
      {
        key: 'settings.general',
        labelKey: 'perm.screen.settings.general',
        path: '/tetapan/umum',
        actions: ['view', 'edit'],
      },
      // Branding was a screen of its own. It held one colour and one logo URL, which
      // is not a job somebody is granted separately from naming the organisation, so
      // it folded into `settings.general` along with its keys.
      {
        key: 'settings.translation',
        labelKey: 'perm.screen.settings.translation',
        path: '/tetapan/umum',
        // Its own grant rather than riding on `settings.general`: rewording the whole
        // interface is a different job from naming the organisation, and somebody doing
        // the wording should not need the rest of the settings to do it.
        actions: ['view', 'edit'],
      },
      {
        key: 'settings.backup',
        labelKey: 'perm.screen.settings.backup',
        path: '/tetapan/umum',
        // `edit` is the schedule and the retention count, which is a different decision
        // from taking a dump by hand — and without it the `backup.*` setting keys would
        // map to a screen that has no way to save them.
        actions: ['create', 'view', 'edit', 'delete'],
        custom: [
          {
            id: 'download',
            labelKey: 'perm.action.download',
            noteKey: 'perm.action.download.note',
          },
        ],
        noteKey: 'perm.note.settings.backup',
      },
      {
        key: 'settings.maintenance',
        labelKey: 'perm.screen.settings.maintenance',
        path: '/tetapan/umum',
        actions: ['view', 'edit'],
        custom: [
          {
            id: 'recompute',
            labelKey: 'perm.action.recompute',
            noteKey: 'perm.action.recompute.note',
          },
          {
            id: 'purge',
            labelKey: 'perm.action.purge',
            noteKey: 'perm.action.purge.note',
          },
          {
            id: 'maintenanceMode',
            labelKey: 'perm.action.maintenanceMode',
            noteKey: 'perm.action.maintenanceMode.note',
          },
          {
            id: 'clearCache',
            labelKey: 'perm.action.clearCache',
            noteKey: 'perm.action.clearCache.note',
          },
        ],
      },
      {
        key: 'settings.devices',
        labelKey: 'nav.settings.devices',
        path: '/tetapan/peranti',
        actions: ['create', 'view', 'edit'],
        custom: [
          { id: 'test', labelKey: 'perm.action.test.connection' },
          { id: 'sync', labelKey: 'perm.action.sync.push' },
          { id: 'clock', labelKey: 'perm.action.clock', noteKey: 'perm.action.clock.note' },
          /**
           * Writing settings onto the terminal itself, kept apart from `edit`.
           *
           * `edit` is renaming a terminal and correcting its address. This one decides
           * whether a face alone opens a door, how long the lock stays released, and can
           * release it outright. Granting the first should not hand over the second, for
           * the same reason `settings.security` is separate from the API screen.
           */
          {
            id: 'terminal',
            labelKey: 'perm.action.terminalConfig',
            noteKey: 'perm.action.terminalConfig.note',
          },
        ],
        noteKey: 'perm.note.settings.devices',
      },
      {
        key: 'settings.integration.email',
        labelKey: 'perm.screen.settings.integration.email',
        path: '/tetapan/integrasi',
        // Create and delete because this is several named senders rather than one set
        // of settings: a profile is a thing that gets added and retired.
        actions: ['view', 'create', 'edit', 'delete'],
        custom: [{ id: 'test', labelKey: 'perm.action.test.email' }],
        noteKey: 'perm.note.settings.integration.email',
      },
      {
        key: 'settings.integration.sms',
        labelKey: 'perm.screen.settings.integration.sms',
        path: '/tetapan/integrasi',
        actions: ['view', 'edit'],
        custom: [{ id: 'test', labelKey: 'perm.action.test' }],
      },
      {
        key: 'settings.integration.telegram',
        labelKey: 'perm.screen.settings.integration.telegram',
        path: '/tetapan/integrasi',
        actions: ['view', 'edit'],
        custom: [{ id: 'test', labelKey: 'perm.action.test' }],
      },
      {
        key: 'settings.integration.api',
        labelKey: 'perm.screen.settings.integration.api',
        path: '/tetapan/integrasi',
        /**
         * Create and delete because tokens and webhook subscriptions are things that get
         * issued and retired, not settings that get edited.
         *
         * This is the most consequential grant in the registry: `create` here mints a
         * credential that reads staff and attendance data from outside the application,
         * and `edit` decides whether the API answers unauthenticated callers at all.
         */
        actions: ['view', 'create', 'edit', 'delete'],
        custom: [{ id: 'test', labelKey: 'perm.action.test.webhook' }],
        noteKey: 'perm.note.settings.integration.api',
      },
      {
        key: 'settings.security',
        labelKey: 'perm.screen.settings.security',
        path: '/tetapan/integrasi',
        // Separate from the API screen: deciding the lockout policy and deciding who may
        // mint API tokens are different jobs, and a role can reasonably hold one.
        actions: ['view', 'edit'],
        noteKey: 'perm.note.settings.security',
      },
      {
        key: 'settings.integration.holidays',
        labelKey: 'perm.screen.settings.integration.holidays',
        path: '/tetapan/integrasi',
        actions: ['view', 'edit'],
        custom: [{ id: 'sync', labelKey: 'perm.action.sync' }],
      },
      {
        key: 'settings.roles',
        labelKey: 'nav.settings.roles',
        path: '/tetapan/peranan',
        actions: ['create', 'view', 'edit', 'delete'],
      },
      {
        key: 'settings.users.admin',
        labelKey: 'perm.screen.settings.users.admin',
        path: '/tetapan/pengguna',
        actions: ['create', 'view', 'edit', 'delete', 'suspend', 'activate'],
        custom: [{ id: 'reset', labelKey: 'perm.action.reset' }],
        noteKey: 'perm.note.settings.users.admin',
      },
      {
        key: 'settings.users.staff',
        labelKey: 'perm.screen.settings.users.staff',
        path: '/tetapan/pengguna',
        actions: ['create', 'view', 'edit', 'delete', 'suspend', 'activate'],
        custom: [
          { id: 'reset', labelKey: 'perm.action.reset' },
          { id: 'unbind', labelKey: 'perm.action.unbind' },
        ],
      },
      {
        key: 'settings.users.apps',
        labelKey: 'perm.screen.settings.users.apps',
        path: '/tetapan/pengguna',
        actions: ['create', 'view', 'edit', 'delete', 'suspend', 'activate'],
        custom: [{ id: 'rotate', labelKey: 'perm.action.rotate' }],
        noteKey: 'perm.note.settings.users.apps',
      },
      {
        key: 'settings.logs.activity',
        labelKey: 'perm.screen.settings.logs.activity',
        path: '/tetapan/log',
        actions: ['view'],
        custom: [{ id: 'export', labelKey: 'action.export' }],
      },
      {
        key: 'settings.logs.audit',
        labelKey: 'perm.screen.settings.logs.audit',
        path: '/tetapan/log',
        actions: ['view'],
        custom: [{ id: 'export', labelKey: 'action.export' }],
        noteKey: 'perm.note.settings.logs.audit',
      },
    ],
  },
];

/** Screens whose log may never be made writable, whatever a request asks for. */
const READ_ONLY_SCREENS = new Set(['attendance.rawLog', 'settings.logs.audit']);

/** Actions that count as reading, and so remain allowed on a read-only screen. */
const READ_ACTIONS = new Set(['view', 'export']);

const SCREEN_INDEX = new Map<string, ScreenPermission>(
  PERMISSION_SECTIONS.flatMap((section) => section.screens).map((screen) => [screen.key, screen]),
);

export function findScreen(key: string): ScreenPermission | undefined {
  return SCREEN_INDEX.get(key);
}

/** Every action a screen supports, standard and custom together. */
export function screenActions(screen: ScreenPermission): string[] {
  return [...screen.actions, ...(screen.custom ?? []).map((action) => action.id)];
}

/** Total number of checkboxes in the matrix, for the "x of y granted" counter. */
export function totalPermissionCount(): number {
  let total = 0;
  for (const section of PERMISSION_SECTIONS) {
    for (const screen of section.screens) total += screenActions(screen).length;
  }
  return total;
}

export function countGranted(permissions: Record<string, string[]>): number {
  let total = 0;
  for (const [key, actions] of Object.entries(permissions)) {
    const screen = SCREEN_INDEX.get(key);
    if (!screen) continue;
    const supported = new Set(screenActions(screen));
    total += actions.filter((action) => supported.has(action)).length;
  }
  return total;
}

/** Grants every action on every screen. Used for the Super Admin seed. */
export function fullPermissions(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const section of PERMISSION_SECTIONS) {
    for (const screen of section.screens) result[screen.key] = screenActions(screen);
  }
  return result;
}

export class PermissionError extends Error {}

/**
 * Rejects anything the registry does not describe.
 *
 * Validated server-side rather than only constrained by the UI, because the stored
 * shape is free-form JSON and a crafted request would otherwise write a grant that
 * no screen displays and no reviewer would ever notice.
 */
export function validatePermissions(permissions: Record<string, string[]>): void {
  for (const [key, actions] of Object.entries(permissions)) {
    const screen = SCREEN_INDEX.get(key);
    if (!screen) throw new PermissionError(`Skrin tidak dikenali: ${key}`);

    const supported = new Set(screenActions(screen));
    for (const action of actions) {
      if (!supported.has(action)) {
        throw new PermissionError(`Tindakan "${action}" tidak berkenaan untuk ${LABELS[screen.labelKey]}`);
      }
    }

    if (READ_ONLY_SCREENS.has(key)) {
      const writes = actions.filter((action) => !READ_ACTIONS.has(action));
      if (writes.length > 0) {
        throw new PermissionError(
          `${LABELS[screen.labelKey]} hanya boleh dibaca. Ia adalah bukti apabila rekod kehadiran ` +
            'dipertikaikan, jadi tiada peranan boleh diberi kebenaran mengubahnya.',
        );
      }
    }

    // A grant to change a record without the ability to open it describes an
    // account that cannot use the permission it holds.
    if (actions.length > 0 && screen.actions.includes('view') && !actions.includes('view')) {
      throw new PermissionError(
        `${LABELS[screen.labelKey]}: kebenaran "Lihat" diperlukan sebelum tindakan lain boleh digunakan.`,
      );
    }
  }
}

/**
 * Keys a role must keep to stay able to repair its own configuration.
 *
 * A Super Admin that drops these locks everybody out of role management with no
 * way back except editing the database by hand.
 */
export const SELF_REPAIR_REQUIREMENTS: Array<{ key: string; action: string }> = [
  { key: 'settings.roles', action: 'edit' },
  { key: 'settings.roles', action: 'view' },
  { key: 'settings.users.admin', action: 'view' },
];

/**
 * Maps a stored setting key to the screen that owns it.
 *
 * Prefix order matters and the fallthrough is `settings.general`, which means a new
 * prefix without a branch here lands under General silently. That is how a backup
 * schedule would become editable by anyone who can rename the organisation.
 */
export function settingScreen(settingKey: string): string {
  if (settingKey.startsWith('retention.')) return 'settings.maintenance';
  if (settingKey.startsWith('maintenance.')) return 'settings.maintenance';
  if (settingKey.startsWith('logging.')) return 'settings.maintenance';
  if (settingKey.startsWith('backup.')) return 'settings.backup';
  if (settingKey.startsWith('integration.email')) return 'settings.integration.email';
  if (settingKey.startsWith('integration.sms')) return 'settings.integration.sms';
  if (settingKey.startsWith('integration.telegram')) return 'settings.integration.telegram';
  if (settingKey.startsWith('integration.holiday')) return 'settings.integration.holidays';
  return 'settings.general';
}

/** Screen keys under the Tetapan section, for the "can view any setting" check. */
export const SETTINGS_SCREEN_KEYS: string[] =
  PERMISSION_SECTIONS.find((section) => section.key === 'settings')?.screens.map(
    (screen) => screen.key,
  ) ?? [];
