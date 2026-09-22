import {
  Activity,
  Archive,
  Banknote,
  Building2,
  CalendarDays,
  CalendarOff,
  CalendarPlus,
  CalendarRange,
  ClipboardList,
  Clock,
  FileBarChart,
  FileCheck,
  Gift,
  HandCoins,
  History,
  Landmark,
  LayoutDashboard,
  Link2,
  Megaphone,
  MessageSquareWarning,
  Percent,
  Plug,
  PlusCircle,
  ReceiptText,
  Router,
  ScanFace,
  ScrollText,
  Settings,
  ShieldCheck,
  Table2,
  Target,
  Timer,
  TriangleAlert,
  Trophy,
  Upload,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import type { ComponentType } from 'react';

import type { LabelKey, NavGroupTitleKey } from '@attendance/shared';

/** Shape lucide icons satisfy, kept local so nav does not depend on the library type. */
export type NavIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

export interface NavItem {
  /**
   * A registry key, not the words.
   *
   * This structure is built once at import. Holding translated text would freeze whatever
   * language was current then, and the sidebar would keep it for the life of the tab.
   */
  labelKey: LabelKey;
  to: string;
  /**
   * Per entry, not per group.
   *
   * The sidebar is scanned rather than read at this length — twenty-two entries under
   * six headings — and an icon is what lets somebody find the row they want without
   * reading each label.
   */
  icon: NavIcon;
  /** Rendered as a count or warning pill. */
  badge?: { value: string; tone: 'neutral' | 'warning' | 'live' };
  /**
   * Screen keys that make this entry reachable, any one of which is enough.
   *
   * A list rather than a single key because several entries are tabbed pages: the
   * Integrasi screen holds five permission rows, and a role with only the Telegram
   * one still has a reason to open it.
   *
   * Used to hide the entry, not to protect it — the server checks every request
   * regardless. Hiding matters because a menu whose entries all return 403 teaches
   * the user to distrust the screen rather than to read the message.
   *
   * Keys mirror `apps/server/src/auth/permissions.ts`. They are stable strings, and
   * the nav has to render before any request completes, so they are not fetched.
   */
  requiresAny?: string[];
  /**
   * What the screen will hold, shown on its generated placeholder.
   *
   * Lives on the nav entry because that is where the agreed structure lives, and the
   * placeholder is generated from it. Only set on entries that have no screen yet; an
   * implemented route never reads it.
   */
  plannedNoteKey?: LabelKey;
}

export interface NavGroup {
  /**
   * Undefined for the ungrouped top entry.
   *
   * Doubles as the group's identity in the expanded-set the sidebar keeps in
   * `localStorage`. A key is a stable string; the visible title is not, so storing that
   * instead would collapse every open group the moment somebody switched language.
   *
   * Typed against the domain map rather than the whole registry, so a group added without a
   * domain is a compile error. Otherwise it would render above the headings beside Dashboard —
   * visible, but only to somebody who knew where it was supposed to be.
   */
  titleKey?: NavGroupTitleKey;
  /** Stands in for the heading when the sidebar is collapsed to icons. */
  icon: NavIcon;
  items: NavItem[];
}

/**
 * Sidebar structure.
 *
 * Grouped by the question a user is trying to answer rather than by database
 * table, because the people using this think in terms of "who was late today",
 * not "which entity holds that".
 *
 * All device management sits under Tetapan > Senarai Peranti. An earlier draft
 * also had a separate Terminal group, which meant two routes owning the same
 * records.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    icon: LayoutDashboard,
    items: [
      { labelKey: 'nav.dashboard', to: '/', icon: LayoutDashboard, requiresAny: ['dashboard'] },
    ],
  },
  /*
   * There is no self-service group here, and that is deliberate.
   *
   * This application is the back office. Staff do not log into it — `UserAccount.accountType` says so
   * in the schema: "`admin` administers the system; `staff` is the mobile check-in app", and the TOTP
   * comment beside it talks about "five thousand staff app logins". A person's own attendance, their
   * own explanations and their own applications are the Android client's screens, served by
   * `/api/saya/*`.
   *
   * A REKOD SAYA group was added here and removed again. It came from reading JPPTAMS, which puts
   * "Get Your Personal Record Here" and "Administration" in one application — but JPPTAMS is a single
   * combined app for a small company, and this system splits the two on purpose. The result was four
   * rows at the top of an administrator's rail showing an administrator their own empty attendance.
   *
   * `Profil Saya` stays in the header avatar menu, where it already was. It belongs to whoever is
   * logged in rather than to a section of the application, and everyone has one.
   */
  {
    titleKey: 'nav.group.attendance',
    icon: Clock,
    items: [
      {
        labelKey: 'nav.attendance.monitor',
        to: '/kehadiran/monitor',
        icon: Activity,
        requiresAny: ['attendance.monitor'],
      },
      {
        labelKey: 'nav.attendance.records',
        to: '/kehadiran/rekod',
        icon: ClipboardList,
        requiresAny: ['attendance.records'],
      },
      /*
       * Above Pengecualian, and separate from it.
       *
       * Exceptions are the eight conditions the engine could not resolve; resolving one corrects
       * data. This is the four states it resolved with confidence and that somebody wants to account
       * for; deciding one changes no figure. Two entries because they are two jobs — and because a
       * single screen would ask one person to decide a terminal's clock drift and a sick child
       * through the same form.
       */
      {
        labelKey: 'nav.attendance.justifications',
        to: '/kehadiran/justifikasi',
        icon: MessageSquareWarning,
        requiresAny: ['attendance.justifications'],
      },
      // Kept distinct from Rekod Kehadiran: this is the untouched device log,
      // which is what settles a dispute over a computed record.
      {
        labelKey: 'nav.attendance.rawLog',
        to: '/kehadiran/log-scan',
        icon: ScrollText,
        requiresAny: ['attendance.rawLog'],
      },
      {
        labelKey: 'nav.attendance.exceptions',
        to: '/kehadiran/pengecualian',
        icon: TriangleAlert,
        requiresAny: ['attendance.exceptions'],
      },
    ],
  },
  {
    titleKey: 'nav.group.staff',
    icon: Users,
    items: [
      {
        labelKey: 'nav.staff.directory',
        to: '/staf',
        icon: Users,
        requiresAny: ['staff.directory'],
      },
      {
        labelKey: 'nav.staff.biometrics',
        to: '/staf/biometrik',
        icon: ScanFace,
        requiresAny: ['staff.biometrics'],
      },
      // Lives under Staf rather than Terminal because the question it answers is
      // "who is this person", not "how is this device configured".
      {
        labelKey: 'nav.staff.mapping',
        to: '/staf/pemetaan',
        icon: Link2,
        requiresAny: ['staff.mapping'],
      },
      {
        labelKey: 'nav.staff.import',
        to: '/staf/import',
        icon: Upload,
        requiresAny: ['staff.import'],
      },
      {
        labelKey: 'nav.staff.departments',
        to: '/staf/jabatan',
        icon: Building2,
        requiresAny: ['staff.departments', 'staff.locations'],
      },
    ],
  },
  {
    titleKey: 'nav.group.schedule',
    icon: CalendarDays,
    items: [
      {
        labelKey: 'nav.schedule.shifts',
        to: '/jadual/shift',
        icon: Clock,
        requiresAny: ['schedule.workPatterns', 'schedule.shifts'],
      },
      {
        labelKey: 'nav.schedule.roster',
        to: '/jadual/kalendar',
        icon: CalendarDays,
        requiresAny: ['schedule.roster'],
      },
      {
        labelKey: 'nav.schedule.holidays',
        to: '/jadual/cuti-umum',
        icon: CalendarOff,
        requiresAny: ['schedule.holidays'],
      },
    ],
  },
  /**
   * HR sits between Jadual and Laporan, following the order the work happens in:
   * attendance is recorded, schedules are set, requests are decided, reports are read.
   * Below Laporan it would put daily work after a monthly read.
   *
   * ## One group per request module, not one group for all four
   *
   * These four were a single `Permohonan` group holding four lists, with the configuration for
   * each buried as tabs three to five of the list screen itself. That put "approve Siti's leave"
   * and "change who approves leave" behind the same door — two jobs the permission model already
   * separated, with `approve` on one side and `configure` on the other.
   *
   * Splitting them also makes these four consistent with the three HR groups below, which all
   * already end in a Tetapan entry. Collapsing four modules into one row was the odd case, not
   * the rule.
   *
   * The cost is three extra rows in the rail when closed. Acceptable now that the domain headings
   * partition it — seven rows under `Sumber Manusia` reads as a section, where ten flat rows read
   * as a wall — and every row is now a complete module rather than a mixture.
   *
   * Leave keeps `/jadual/permohonan` from when it lived under Jadual, so saved links still work.
   * Its settings sibling follows its parent rather than the other three.
   */
  {
    titleKey: 'nav.group.leave',
    icon: CalendarPlus,
    items: [
      {
        labelKey: 'nav.schedule.leave',
        to: '/jadual/permohonan',
        icon: CalendarPlus,
        requiresAny: ['schedule.leave'],
      },
      /*
       * Same permission key as the list, not a separate one.
       *
       * The screen is gated on viewing the module; the write controls inside it are gated on
       * `configure`. Hiding the whole entry from an approver would leave them unable to see who
       * signs after them, which is a question they legitimately have while deciding.
       */
      {
        labelKey: 'nav.hr.leaveSettings',
        to: '/jadual/permohonan/tetapan',
        icon: Settings,
        requiresAny: ['schedule.leave'],
      },
    ],
  },
  {
    titleKey: 'nav.group.claims',
    icon: ReceiptText,
    items: [
      {
        labelKey: 'nav.hr.claims',
        to: '/hr/permohonan/tuntutan',
        icon: ReceiptText,
        requiresAny: ['hr.claims'],
      },
      {
        labelKey: 'nav.hr.claimSettings',
        to: '/hr/permohonan/tuntutan/tetapan',
        icon: Settings,
        requiresAny: ['hr.claims'],
      },
    ],
  },
  {
    titleKey: 'nav.group.overtime',
    icon: Timer,
    items: [
      {
        labelKey: 'nav.hr.overtime',
        to: '/hr/permohonan/lebih-masa',
        icon: Timer,
        requiresAny: ['hr.overtime'],
      },
      {
        labelKey: 'nav.hr.overtimeSettings',
        to: '/hr/permohonan/lebih-masa/tetapan',
        icon: Settings,
        requiresAny: ['hr.overtime'],
      },
    ],
  },
  {
    titleKey: 'nav.group.expenses',
    icon: Wallet,
    items: [
      {
        labelKey: 'nav.hr.expenses',
        to: '/hr/permohonan/perbelanjaan',
        icon: Wallet,
        requiresAny: ['hr.expenses'],
      },
      {
        labelKey: 'nav.hr.expenseSettings',
        to: '/hr/permohonan/perbelanjaan/tetapan',
        icon: Settings,
        requiresAny: ['hr.expenses'],
      },
    ],
  },
  {
    titleKey: 'nav.group.recruitment',
    icon: UserPlus,
    items: [
      {
        labelKey: 'nav.hr.career',
        to: '/hr/pengambilan/iklan',
        icon: Megaphone,
        requiresAny: ['hr.career'],
      },
      {
        labelKey: 'nav.hr.applicants',
        to: '/hr/pengambilan/pemohon',
        icon: UserPlus,
        requiresAny: ['hr.applicants'],
      },
      {
        labelKey: 'nav.hr.careerArchive',
        to: '/hr/pengambilan/arkib',
        icon: Archive,
        requiresAny: ['hr.careerArchive'],
      },
      {
        labelKey: 'nav.hr.careerSettings',
        to: '/hr/pengambilan/tetapan',
        icon: Settings,
        requiresAny: ['hr.careerSettings'],
      },
    ],
  },
  {
    titleKey: 'nav.group.kpi',
    icon: Target,
    items: [
      {
        labelKey: 'nav.hr.kpiTemplates',
        to: '/hr/kpi/templat',
        icon: ClipboardList,
        requiresAny: ['hr.kpiTemplates'],
      },
      {
        labelKey: 'nav.hr.kpiPeriods',
        to: '/hr/kpi/tempoh',
        icon: CalendarRange,
        requiresAny: ['hr.kpiPeriods'],
      },
      {
        labelKey: 'nav.hr.kpiAssignments',
        to: '/hr/kpi/penugasan',
        icon: UserCheck,
        requiresAny: ['hr.kpiAssignments'],
      },
      {
        labelKey: 'nav.hr.kpiReviews',
        to: '/hr/kpi/semakan',
        icon: FileCheck,
        requiresAny: ['hr.kpiReviews'],
      },
      {
        labelKey: 'nav.hr.kpiResults',
        to: '/hr/kpi/keputusan',
        icon: Trophy,
        requiresAny: ['hr.kpiResults'],
      },
      {
        labelKey: 'nav.hr.kpiSettings',
        to: '/hr/kpi/tetapan',
        icon: Settings,
        requiresAny: ['hr.kpiSettings'],
      },
    ],
  },
  {
    titleKey: 'nav.group.payroll',
    icon: Banknote,
    items: [
      {
        labelKey: 'nav.hr.payrollPeriods',
        to: '/hr/payroll/tempoh',
        icon: CalendarRange,
        requiresAny: ['hr.payrollPeriods'],
      },
      {
        labelKey: 'nav.hr.allowances',
        to: '/hr/payroll/elaun',
        icon: PlusCircle,
        requiresAny: ['hr.allowances'],
      },
      {
        labelKey: 'nav.hr.bonuses',
        to: '/hr/payroll/bonus',
        icon: Gift,
        requiresAny: ['hr.bonuses'],
      },
      {
        labelKey: 'nav.hr.commissions',
        to: '/hr/payroll/komisen',
        icon: Percent,
        requiresAny: ['hr.commissions'],
      },
      {
        labelKey: 'nav.hr.loans',
        to: '/hr/payroll/pinjaman',
        icon: Landmark,
        requiresAny: ['hr.loans'],
      },
      {
        labelKey: 'nav.hr.advances',
        to: '/hr/payroll/pendahuluan',
        icon: HandCoins,
        requiresAny: ['hr.advances'],
      },
      {
        labelKey: 'nav.hr.payrollSettings',
        to: '/hr/payroll/tetapan',
        icon: Settings,
        requiresAny: ['hr.payrollSettings'],
      },
    ],
  },
  {
    titleKey: 'nav.group.reports',
    icon: FileBarChart,
    items: [
      {
        labelKey: 'nav.reports.monthly',
        to: '/laporan/bulanan',
        icon: FileBarChart,
        requiresAny: ['reports.monthly'],
      },
      {
        labelKey: 'nav.reports.payroll',
        to: '/laporan/payroll',
        icon: Banknote,
        requiresAny: ['reports.payroll'],
      },
      {
        labelKey: 'nav.reports.builder',
        to: '/laporan/penjana',
        icon: Table2,
        requiresAny: ['reports.builder'],
      },
    ],
  },
  {
    titleKey: 'nav.group.settings',
    icon: Settings,
    items: [
      // Tabbed pages list every screen they contain: a role holding only one tab
      // still has a reason to open the page.
      {
        labelKey: 'nav.settings.general',
        to: '/tetapan/umum',
        icon: Settings,
        requiresAny: ['settings.general', 'settings.backup', 'settings.maintenance'],
      },
      {
        labelKey: 'nav.settings.devices',
        to: '/tetapan/peranti',
        icon: Router,
        requiresAny: ['settings.devices'],
      },
      {
        labelKey: 'nav.settings.integration',
        to: '/tetapan/integrasi',
        icon: Plug,
        requiresAny: [
          'settings.integration.email',
          'settings.integration.sms',
          'settings.integration.telegram',
          'settings.integration.api',
          'settings.integration.holidays',
        ],
      },
      {
        labelKey: 'nav.settings.roles',
        to: '/tetapan/peranan',
        icon: ShieldCheck,
        requiresAny: ['settings.roles'],
      },
      {
        labelKey: 'nav.settings.users',
        to: '/tetapan/pengguna',
        icon: UserCog,
        requiresAny: [
          'settings.users.admin',
          'settings.users.staff',
          'settings.users.apps',
        ],
      },
      {
        labelKey: 'nav.settings.logs',
        to: '/tetapan/log',
        icon: History,
        requiresAny: ['settings.logs.activity', 'settings.logs.audit'],
      },
    ],
  },
];

/**
 * Nav groups the current role can actually open.
 *
 * A group with nothing left in it is dropped entirely, so the sidebar does not
 * carry an empty heading.
 */
export function visibleGroups(permissions: Record<string, string[]>): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        item.requiresAny === undefined ||
        item.requiresAny.some((key) => (permissions[key] ?? []).includes('view')),
    ),
  })).filter((group) => group.items.length > 0);
}

/** Routes that have a real screen, so no placeholder is generated for them. */
export const IMPLEMENTED_ROUTES = new Set([
  '/',
  '/kehadiran/justifikasi',
  '/staf',
  '/staf/biometrik',
  '/staf/pemetaan',
  '/staf/import',
  '/staf/jabatan',
  '/jadual/shift',
  '/jadual/kalendar',
  '/jadual/cuti-umum',
  '/jadual/permohonan',
  '/jadual/permohonan/tetapan',
  '/hr/permohonan/lebih-masa',
  '/hr/permohonan/lebih-masa/tetapan',
  '/hr/permohonan/tuntutan',
  '/hr/permohonan/tuntutan/tetapan',
  '/hr/permohonan/perbelanjaan',
  '/hr/permohonan/perbelanjaan/tetapan',
  '/hr/pengambilan/iklan',
  '/hr/pengambilan/pemohon',
  '/hr/pengambilan/arkib',
  '/hr/pengambilan/tetapan',
  '/hr/kpi/templat',
  '/hr/kpi/tempoh',
  '/hr/kpi/penugasan',
  '/hr/kpi/semakan',
  '/hr/kpi/keputusan',
  '/hr/kpi/tetapan',
  '/hr/payroll/tempoh',
  '/hr/payroll/elaun',
  '/hr/payroll/bonus',
  '/hr/payroll/komisen',
  '/hr/payroll/pinjaman',
  '/hr/payroll/pendahuluan',
  '/hr/payroll/tetapan',
  '/kehadiran/monitor',
  '/kehadiran/rekod',
  '/kehadiran/log-scan',
  '/kehadiran/pengecualian',
  '/laporan/bulanan',
  '/laporan/payroll',
  '/laporan/penjana',
  '/tetapan/umum',
  '/tetapan/peranti',
  '/tetapan/integrasi',
  '/tetapan/peranan',
  '/tetapan/pengguna',
  '/tetapan/log',
]);

export const PLACEHOLDER_ROUTES: Array<{
  path: string;
  titleKey: LabelKey;
  noteKey?: LabelKey;
  icon: typeof ClipboardList;
}> = NAV_GROUPS.flatMap((group) =>
  group.items
    .filter((item) => !IMPLEMENTED_ROUTES.has(item.to))
    .map((item) => ({
      path: item.to,
      titleKey: item.labelKey,
      noteKey: item.plannedNoteKey,
      icon: ClipboardList,
    })),
);