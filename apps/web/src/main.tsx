import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';

import { AppShell } from './components/layout/AppShell';
import './index.css';
import { AuthProvider } from './lib/auth';
import { PLACEHOLDER_ROUTES } from './lib/nav';
import { TranslationProvider } from './lib/translation';
import { AdvancesPage } from './pages/AdvancesPage';
import { AllowancesPage } from './pages/AllowancesPage';
import { AttendanceRecordsPage } from './pages/AttendanceRecordsPage';
import { BiometricsPage } from './pages/BiometricsPage';
import { BonusesPage } from './pages/BonusesPage';
import { CommissionsPage } from './pages/CommissionsPage';
import { BulkImportPage } from './pages/BulkImportPage';
import { ClaimSettingsPage } from './pages/ClaimSettingsPage';
import { ClaimsPage } from './pages/ClaimsPage';
import { DashboardPage } from './pages/DashboardPage';
import { DeviceEditorPage } from './pages/DeviceEditorPage';
import { DevicesPage } from './pages/DevicesPage';
import { ExceptionsPage } from './pages/ExceptionsPage';
import { JustificationsPage } from './pages/JustificationsPage';
import { ExpenseSettingsPage } from './pages/ExpenseSettingsPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { ApplicantsPage } from './pages/ApplicantsPage';
import { JobPostingsPage, RecruitmentArchivePage } from './pages/JobPostingsPage';
import { RecruitmentSettingsPage } from './pages/RecruitmentSettingsPage';
import { HolidaysPage } from './pages/HolidaysPage';
import { IdentityMappingPage } from './pages/IdentityMappingPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { KpiAssignmentsPage } from './pages/KpiAssignmentsPage';
import { KpiPeriodsPage } from './pages/KpiPeriodsPage';
import { KpiResultsPage } from './pages/KpiResultsPage';
import { KpiReviewsPage } from './pages/KpiReviewsPage';
import { KpiSettingsPage } from './pages/KpiSettingsPage';
import { KpiTemplatesPage } from './pages/KpiTemplatesPage';
import { LeaveRequestsPage } from './pages/LeaveRequestsPage';
import { LeaveSettingsPage } from './pages/LeaveSettingsPage';
import { LiveMonitorPage } from './pages/LiveMonitorPage';
import { LoansPage } from './pages/LoansPage';
import { OvertimePage } from './pages/OvertimePage';
import { OvertimeSettingsPage } from './pages/OvertimeSettingsPage';
import { LoginPage } from './pages/LoginPage';
import { LogsPage } from './pages/LogsPage';
import { MonthlyReportPage } from './pages/MonthlyReportPage';
import { OrgPage } from './pages/OrgPage';
import { PayrollExportPage } from './pages/PayrollExportPage';
import { PayrollPeriodsPage } from './pages/PayrollPeriodsPage';
import { PayrollSettingsPage } from './pages/PayrollSettingsPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { ProfilePage } from './pages/ProfilePage';
import { RawScanLogPage } from './pages/RawScanLogPage';
import { ReportBuilderPage } from './pages/ReportBuilderPage';
import { RoleEditorPage } from './pages/RoleEditorPage';
import { RolesPage } from './pages/RolesPage';
import { StaffDetailPage } from './pages/StaffDetailPage';
import { RosterPage } from './pages/RosterPage';
import { SettingsPage } from './pages/SettingsPage';
import { ShiftsPage } from './pages/ShiftsPage';
import { StaffDirectoryPage } from './pages/StaffDirectoryPage';
import { UsersPage } from './pages/UsersPage';

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      // Reached from the header avatar menu, not the sidebar: it belongs to whoever is logged in
      // rather than to a section of the application, and everyone has one.
      { path: 'profil', element: <ProfilePage /> },
      { path: 'kehadiran/monitor', element: <LiveMonitorPage /> },
      { path: 'kehadiran/rekod', element: <AttendanceRecordsPage /> },
      { path: 'kehadiran/log-scan', element: <RawScanLogPage /> },
      { path: 'kehadiran/justifikasi', element: <JustificationsPage /> },
      { path: 'kehadiran/pengecualian', element: <ExceptionsPage /> },
      { path: 'staf', element: <StaffDirectoryPage /> },
      { path: 'staf/biometrik', element: <BiometricsPage /> },
      { path: 'staf/pemetaan', element: <IdentityMappingPage /> },
      { path: 'staf/import', element: <BulkImportPage /> },
      { path: 'staf/jabatan', element: <OrgPage /> },
      // After the named staff routes, so the intent is readable at a glance. React Router
      // ranks a static segment above a dynamic one regardless of order, but relying on that
      // silently means the next person has to know it to be sure `/staf/import` still works.
      { path: 'staf/:id', element: <StaffDetailPage /> },
      { path: 'jadual/shift', element: <ShiftsPage /> },
      { path: 'jadual/kalendar', element: <RosterPage /> },
      { path: 'jadual/cuti-umum', element: <HolidaysPage /> },
      { path: 'jadual/permohonan', element: <LeaveRequestsPage /> },
      /*
        Settings sits on its own route beside each module's list rather than as tabs on it.

        Deciding an application and deciding who signs for one are different jobs held by
        different people, which the permission model already said with `approve` against
        `configure`. Leave's settings follow leave's own path, which kept `/jadual/permohonan`
        from when it lived under Jadual so saved links still work.
      */
      { path: 'jadual/permohonan/tetapan', element: <LeaveSettingsPage /> },
      { path: 'hr/permohonan/lebih-masa', element: <OvertimePage /> },
      { path: 'hr/permohonan/lebih-masa/tetapan', element: <OvertimeSettingsPage /> },
      { path: 'hr/permohonan/tuntutan', element: <ClaimsPage /> },
      { path: 'hr/permohonan/tuntutan/tetapan', element: <ClaimSettingsPage /> },
      { path: 'hr/permohonan/perbelanjaan', element: <ExpensesPage /> },
      { path: 'hr/permohonan/perbelanjaan/tetapan', element: <ExpenseSettingsPage /> },
      { path: 'hr/pengambilan/iklan', element: <JobPostingsPage /> },
      { path: 'hr/pengambilan/pemohon', element: <ApplicantsPage /> },
      { path: 'hr/pengambilan/arkib', element: <RecruitmentArchivePage /> },
      { path: 'hr/pengambilan/tetapan', element: <RecruitmentSettingsPage /> },
      { path: 'hr/kpi/templat', element: <KpiTemplatesPage /> },
      { path: 'hr/kpi/tempoh', element: <KpiPeriodsPage /> },
      { path: 'hr/kpi/penugasan', element: <KpiAssignmentsPage /> },
      { path: 'hr/kpi/semakan', element: <KpiReviewsPage /> },
      // Read-only, and a separate screen from the reviews list: a grade carries a bonus,
      // so who may read the outcome is not who may reopen the assessment behind it.
      { path: 'hr/kpi/keputusan', element: <KpiResultsPage /> },
      { path: 'hr/kpi/tetapan', element: <KpiSettingsPage /> },
      // Periods and payslips are one tabbed screen: a period is the batch, a payslip is one
      // person's share of it, and two sidebar entries would ask somebody to know which holds
      // the number they came for.
      { path: 'hr/payroll/tempoh', element: <PayrollPeriodsPage /> },
      { path: 'hr/payroll/elaun', element: <AllowancesPage /> },
      { path: 'hr/payroll/bonus', element: <BonusesPage /> },
      { path: 'hr/payroll/komisen', element: <CommissionsPage /> },
      { path: 'hr/payroll/pinjaman', element: <LoansPage /> },
      { path: 'hr/payroll/pendahuluan', element: <AdvancesPage /> },
      { path: 'hr/payroll/tetapan', element: <PayrollSettingsPage /> },
      { path: 'laporan/bulanan', element: <MonthlyReportPage /> },
      { path: 'laporan/payroll', element: <PayrollExportPage /> },
      { path: 'laporan/penjana', element: <ReportBuilderPage /> },
      { path: 'tetapan/umum', element: <SettingsPage /> },
      { path: 'tetapan/peranti', element: <DevicesPage /> },
      // Its own page for the same reason the permission matrix has one: seven tabs of
      // terminal settings need the viewport, and a dialog would hide the group whose
      // control is being changed.
      { path: 'tetapan/peranti/:id', element: <DeviceEditorPage /> },
      { path: 'tetapan/integrasi', element: <IntegrationsPage /> },
      { path: 'tetapan/peranan', element: <RolesPage /> },
      // The matrix gets its own page: forty screens by nine actions needs the full
      // viewport width, and a dialog would hide the section a row belongs to.
      { path: 'tetapan/peranan/baharu', element: <RoleEditorPage /> },
      { path: 'tetapan/peranan/:id', element: <RoleEditorPage /> },
      { path: 'tetapan/pengguna', element: <UsersPage /> },
      { path: 'tetapan/log', element: <LogsPage /> },
      // Generated for every nav entry that has no screen yet, so the agreed
      // structure stays navigable without pretending it is finished.
      ...PLACEHOLDER_ROUTES.map((route) => ({
        path: route.path.replace(/^\//, ''),
        element: <PlaceholderPage titleKey={route.titleKey} noteKey={route.noteKey} />,
      })),
    ],
  },
]);

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <AuthProvider>
      {/*
        Inside the auth provider, and it has to be: the dictionary needs a session to be read
        at all, and the language it is read in comes from that session — each account chooses
        its own, so the provider cannot know which words to fetch until the session lands.
      */}
      <TranslationProvider>
        <RouterProvider router={router} />
      </TranslationProvider>
    </AuthProvider>
  </StrictMode>,
);
