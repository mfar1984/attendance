import type { LabelKey } from '@attendance/shared';

/**
 * English, layered over the Malay source.
 *
 * Typed as `Partial<Record<LabelKey, string>>`, so a key that no longer exists in the registry is a
 * compile error rather than a line that silently does nothing. Partial because coverage is built up
 * group by group and an incomplete file has to compile.
 *
 * ## Rules followed here
 *
 * **Placeholders are copied exactly.** `{count}`, `{total}`, `{label}` are substituted by
 * `format()` at render time; renaming one blanks the field and prints an em dash.
 *
 * **Proper nouns stay.** `Hospital Sibu`, `Hikvision`, `KWSP`, `PERKESO`, `LHDN`. A statutory body
 * has one name.
 *
 * **Log levels, HTTP verbs and stored enum values stay.** `INFO`, `WARN`, `DEBUG`, `Auth` — these are
 * read beside raw log output, and translating the badge while the log line keeps the English word
 * makes them look like two different things.
 *
 * **Register is matched, not just meaning.** Where the Malay is a full sentence explaining a
 * consequence, the English is too. These notes exist because somebody would otherwise change a
 * setting without reading what it does, and a shortened English version loses exactly the clause that
 * was the point.
 */
export const EN_LABELS: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // Shared idioms — row actions, badges, column headers
  // ---------------------------------------------------------------------------
  'action.create': 'Create',
  'action.view': 'View',
  'action.edit': 'Edit',
  'action.delete': 'Delete',
  // `Sahkan` is the permission to decide, not to verify. "Approve" is what the action does.
  'action.approve': 'Approve',
  'action.suspend': 'Suspend',
  'action.activate': 'Activate',
  'action.export': 'Export',

  'app.brand': 'Attendance System',
  'app.loading': 'Loading',
  'app.refresh': 'Refresh',
  'app.remove': 'Remove',
  'app.error.save': 'Could not save',
  'app.error.remove': 'Could not remove',
  'app.status.active': 'Active',
  'app.status.inactive': 'Inactive',

  'status.on_time': 'On time',
  'status.late': 'Late',
  'status.early_leave': 'Left early',
  'status.absent': 'Absent',
  'status.incomplete': 'Incomplete',
  'status.on_leave': 'On leave',
  'status.rest_day': 'Rest day',
  'status.holiday': 'Public holiday',

  'panel.search': 'Search',
  'panel.reset': 'Reset',
  'panel.export': 'Export',
  'panel.expand.open': 'Open {label}',
  'panel.expand.close': 'Close {label}',
  'panel.footer.showing': 'Showing {shown} of {total}',
  'panel.footer.readAt': 'read at',
  'panel.footer.perPage': 'Per page',
  'panel.footer.pages': 'Page',
  'panel.footer.previous': 'Previous',
  'panel.footer.next': 'Next',
  'panel.column.status': 'Status',
  'panel.column.created': 'Created',
  'panel.column.actions': 'Actions',

  'weekday.0': 'Sunday',
  'weekday.1': 'Monday',
  'weekday.2': 'Tuesday',
  'weekday.3': 'Wednesday',
  'weekday.4': 'Thursday',
  'weekday.5': 'Friday',
  'weekday.6': 'Saturday',

  // ---------------------------------------------------------------------------
  // Sign in
  // ---------------------------------------------------------------------------
  // Not translated: it is the name of the hospital.
  'login.organisation': 'Hospital Sibu',
  'login.email': 'Email',
  'login.email.placeholder': 'name@hospital.local',
  'login.password': 'Password',
  'login.totp': '2FA Code',
  'login.totp.hint': 'Required for administrator accounts. Leave blank for staff accounts.',
  'login.submit': 'Sign In',
  'login.submit.pending': 'Signing in…',
  'login.error.email': 'Enter a valid email address',
  'login.error.password': 'Password is required',
  'login.error.totp': 'The 2FA code must be 6 digits',
  'login.error.unreachable': 'Could not reach the server',

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  'nav.dashboard': 'Dashboard',

  'nav.group.attendance': 'Attendance',
  'nav.attendance.monitor': 'Today’s Monitor',
  'nav.attendance.records': 'Attendance Records',
  'nav.attendance.rawLog': 'Raw Scan Log',
  'nav.attendance.exceptions': 'Exceptions',
  'nav.attendance.justifications': 'Justification Approvals',

  'nav.group.staff': 'Staff',
  'nav.staff.directory': 'Staff Directory',
  'nav.staff.biometrics': 'Biometric Enrolment',
  'nav.staff.mapping': 'Terminal ID Mapping',
  'nav.staff.import': 'Bulk Import',
  'nav.staff.departments': 'Departments & Locations',
  'nav.staff.detail': 'Staff Detail',

  'nav.group.schedule': 'Schedule',
  'nav.schedule.shifts': 'Shifts & Working Hours',
  'nav.schedule.roster': 'Work Calendar',
  'nav.schedule.holidays': 'Public Holidays',
  'nav.schedule.leave': 'Leave Applications',

  'nav.group.requests': 'Applications',
  'nav.hr.claims': 'Claim Applications',
  'nav.hr.overtime': 'Overtime Applications',
  'nav.hr.expenses': 'Expense Applications',

  'nav.group.recruitment': 'Recruitment',
  'nav.hr.career': 'Job Postings',
  'nav.hr.applicants': 'Applicants',
  'nav.hr.careerArchive': 'Recruitment Archive',
  'nav.hr.careerSettings': 'Recruitment Settings',

  'nav.group.kpi': 'KPI & Appraisal',
  'nav.hr.kpiTemplates': 'KPI Forms',
  'nav.hr.kpiPeriods': 'Appraisal Periods',
  'nav.hr.kpiAssignments': 'KPI Assignments',
  'nav.hr.kpiReviews': 'Appraisal Reviews',
  'nav.hr.kpiResults': 'KPI Results',
  'nav.hr.kpiSettings': 'KPI Settings',

  'nav.group.payroll': 'Payroll & Compensation',
  'nav.hr.payrollPeriods': 'Payroll Periods',
  'nav.hr.allowances': 'Allowances',
  'nav.hr.bonuses': 'Bonuses',
  'nav.hr.commissions': 'Commissions',
  'nav.hr.loans': 'Loans',
  'nav.hr.advances': 'Salary Advances',
  'nav.hr.payrollSettings': 'Payroll Settings',

  'nav.group.reports': 'Reports',
  'nav.reports.monthly': 'Monthly Summary',
  'nav.reports.payroll': 'Payroll Export',
  'nav.reports.builder': 'Report Builder',

  'nav.group.settings': 'Settings',
  'nav.settings.general': 'General Configuration',
  'nav.settings.devices': 'Device List',
  'nav.settings.integration': 'Integrations',
  'nav.settings.roles': 'Role Management',
  'nav.settings.users': 'User Management',
  'nav.settings.logs': 'Logs',
  'nav.settings.roles.new': 'New Role',
  'nav.settings.roles.edit': 'Edit Role',
  'nav.settings.devices.edit': 'Terminal Settings',

  'nav.profile': 'My Profile',

  // ---------------------------------------------------------------------------
  // Application shell
  // ---------------------------------------------------------------------------
  'shell.nav.aria': 'Main navigation',
  'shell.mode': '{mode} mode',
  'shell.sidebar.open': 'Open sidebar',
  'shell.sidebar.close': 'Close sidebar',
  'shell.sidebar.attention': 'Something inside needs attention',
  'shell.sync.never': 'Not synced yet',
  'shell.sync.at': 'Synced {time}',
  'shell.serial': 'serial #{serial}',
  'shell.skipLink': 'Skip to content',
  'shell.error.load': 'Could not load data',
  'shell.drift.one': 'Terminal “{name}” has a clock drift of {drift}',
  'shell.drift.many': '{count} terminals have a drifted clock',
  'shell.drift.consequence': 'Records written now inherit this error.',
  'shell.drift.forward': 'forward',
  'shell.drift.backward': 'backward',
  'shell.offline':
    '{count} terminals offline: {names}. Scans taken during this period will not be accepted until the connection returns.',
  'shell.alerts.none': 'No alerts',
  'shell.alerts.aria': '{count} things need attention',
  'shell.alerts.title': 'Needs attention',
  'shell.alerts.empty': 'Nothing needs attention.',
  'shell.alerts.unreadable': 'Could not be read.',
  /*
   * The bell shows state, not messages. Keeping the second sentence matters: it is the answer to
   * "why can I not dismiss this", and dropping it would make the absence of a read flag look like an
   * omission rather than a decision.
   */
  'shell.alerts.note':
    'These are current conditions, not messages. There is nothing to mark as read — an item disappears when its condition is no longer true.',
  'shell.user.profile': 'Profile',
  'shell.user.signOut': 'Sign Out',
  'shell.placeholder.body':
    'This screen has not been built yet. The navigation structure is in place so the layout can be reviewed first.',

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------
  'dashboard.empty': 'Nothing to show.',
  'dashboard.stat.present': 'Present',
  'dashboard.stat.present.hint': 'of {total} active staff',
  'dashboard.stat.late': 'Late',
  'dashboard.stat.absent': 'Absent',
  'dashboard.stat.onLeave': 'On Leave',
  'dashboard.stat.noBiometrics': 'No Biometrics',
  'dashboard.stat.noBiometrics.hint': 'cannot scan at all',

  'dashboard.scans.title': 'Today’s Scans',
  'dashboard.scans.none': 'No scans yet today',
  'dashboard.scans.count': '{count} most recent scans',
  'dashboard.scans.subtitle':
    'Filtered duplicates are shown too, so this view does not contradict the terminal log.',
  'dashboard.scans.monitor': 'Live monitor',
  'dashboard.scans.empty': 'No scans recorded today yet.',
  'dashboard.scans.column.time': 'Time',
  'dashboard.scans.column.staff': 'Staff',
  'dashboard.scans.column.terminal': 'Terminal',
  'dashboard.scans.column.status': 'Status',

  'dashboard.exceptions.title': 'Exceptions',
  'dashboard.exceptions.none': 'No exceptions',
  'dashboard.exceptions.count': '{count} need review',
  'dashboard.exceptions.open': 'Open the queue',
  'dashboard.exceptions.clear': 'No exceptions waiting for review.',

  'dashboard.devices.title': 'Terminals',
  'dashboard.devices.count': '{count} terminals',
  'dashboard.devices.subtitle':
    'Face capacity and clock accuracy. A full terminal is only noticed when an enrolment fails, so it is drawn here.',
  'dashboard.devices.manage': 'Manage terminals',
  'dashboard.devices.empty': 'No terminals registered yet.',
  'dashboard.devices.column.name': 'Name',
  'dashboard.devices.column.host': 'Address',
  'dashboard.devices.column.status': 'Status',
  'dashboard.devices.column.capacity': 'Capacity',
  'dashboard.devices.column.clock': 'Clock',
  'dashboard.devices.column.serial': 'Serial',
  'dashboard.devices.clock.exact': 'Exact',
  'dashboard.devices.clock.exactManual': 'Exact (manual)',
  'dashboard.devices.capacity.aria': '{percent}% full',

  // ---------------------------------------------------------------------------
  // Enum maps — scans, exceptions, terminal events
  // ---------------------------------------------------------------------------
  'scan.in': 'IN',
  'scan.out': 'OUT',
  'scan.undecided': 'UNDECIDED',
  'scan.suppressed': 'DUPLICATE FILTERED',

  'method.face': 'Face',
  'method.fingerprint': 'Fingerprint',
  'method.card': 'Card',

  'punchSource.terminal': 'Terminal',
  'punchSource.app': 'App',
  'punchSource.manual': 'Manual',

  'exception.missing_check_out': 'No scan out',
  'exception.missing_check_in': 'No scan in',
  'exception.duplicate_scan': 'Repeated scan',
  'exception.unrecognised_face': 'Face not recognised',
  'exception.unknown_employee': 'Terminal ID not mapped',
  'exception.outside_roster': 'Scan outside the roster',
  'exception.clock_drift': 'Terminal clock drifted',
  'exception.outside_geofence': 'Outside the permitted area',

  // Hikvision minor codes. The wording describes what the terminal reported.
  'event.5:38': 'Valid card',
  'event.5:75': 'Face recognised',
  'event.5:76': 'Face not recognised',
  'event.5:113': 'Valid fingerprint',
  'event.5:27': 'Exit button',
  'event.5:22': 'Door opened',
  'event.major.1': 'Alarm',
  'event.major.2': 'Exception',
  'event.major.3': 'Operation',
  'event.major.5': 'Event',

  'leaveStatus.pending': 'Pending',
  'leaveStatus.approved': 'Approved',
  'leaveStatus.rejected': 'Rejected',
  'leaveStatus.cancelled': 'Cancelled',

  'tokenStatus.active': 'ACTIVE',
  'tokenStatus.grace': 'GRACE PERIOD',
  'tokenStatus.expired': 'EXPIRED',
  'tokenStatus.revoked': 'REVOKED',
  'tokenStatus.superseded': 'SUPERSEDED',

  'channel.on': 'On',
  'channel.off': 'Off',
  'channel.toggle': 'Enable channel',
  'channel.test.never': 'Not tested yet.',
  'channel.test.ok': 'Succeeded',
  'channel.test.failed': 'Failed',

  'entity.Setting': 'Setting',
  'entity.Role': 'Role',
  'entity.UserAccount': 'User account',
  'entity.AppClient': 'App client',
  'entity.Staff': 'Staff',
  'entity.StaffFace': 'Face biometric',
  'entity.AttendanceRecord': 'Attendance record',
  'entity.Exception': 'Exception',
  'entity.Device': 'Terminal',

  // ---------------------------------------------------------------------------
  // Logs
  // ---------------------------------------------------------------------------
  'logs.title': 'Logs',
  'logs.subtitle': 'Monitor system activity, user actions and the security audit trail.',
  'logs.tabs.aria': 'Log type',
  'logs.tab.activity': 'Activity Log',
  'logs.tab.audit': 'Audit Log',

  'logs.activity.error.load': 'Could not load the activity log',
  'logs.activity.search': 'Search messages, users, IP, paths…',
  'logs.activity.empty': 'No activity matches these filters.',
  'logs.filter.allCategories': 'All categories',
  'logs.filter.allSources': 'All sources',
  'logs.filter.allActors': 'All users',
  'logs.filter.allEntities': 'All record types',
  'logs.facet.withCount': '{label} ({count})',
  'logs.activity.column.time': 'Time',
  'logs.activity.column.level': 'Level',
  'logs.activity.column.category': 'Category',
  'logs.activity.column.message': 'Message',
  'logs.activity.column.actor': 'User',
  'logs.activity.column.ip': 'IP',
  'logs.activity.row.expand': 'activity detail',
  'logs.activity.detail.action': 'Action',
  'logs.activity.detail.source': 'Source',
  'logs.activity.detail.path': 'Path',
  'logs.activity.detail.entryId': 'Entry ID',
  'logs.activity.detail.accountId': 'Account ID',
  'logs.activity.detail.system': 'System',
  'logs.activity.detail.fullTime': 'Full timestamp',
  'logs.activity.detail.message': 'Message',

  'logs.audit.error.load': 'Could not load the audit log',
  'logs.audit.search': 'Search actor, record type, reason, IP…',
  'logs.audit.empty': 'No changes match these filters.',
  // A literal marker written into the stored row, not prose. It stays as it is.
  'logs.audit.redacted': '[redacted]',
  /*
   * `{redacted}` is a variable carrying the marker above, so it is copied rather than translated.
   *
   * The last clause is the one that earns the sentence: it explains why a secret's new value is not
   * recorded, which otherwise reads as the audit log failing to do its job.
   */
  'logs.audit.appendOnly':
    'Append-only. There is no path in this system to alter or remove an entry, including for a Super Admin. Secret values are recorded as {redacted} — the fact of the change is what matters, not the value.',
  'logs.audit.column.action': 'Action',
  'logs.audit.column.record': 'Record',
  'logs.audit.column.changes': 'Changes',
  'logs.audit.column.actor': 'Actor',
  'logs.audit.fieldCount': '({count} fields)',
  'logs.audit.row.expand': 'change detail',
  'logs.audit.noFields': 'No fields were recorded for this entry.',
  'logs.audit.change.field': 'Field',
  'logs.audit.change.before': 'Before',
  'logs.audit.change.after': 'After',
  'logs.audit.change.becomes': 'becomes',
  'logs.audit.detail.reason': 'Reason',
  'logs.value.true': 'yes',
  'logs.value.false': 'no',

  // Kept as they are: these badges sit beside raw log output that uses the same words.
  'logLevel.info': 'INFO',
  'logLevel.warn': 'WARN',
  'logLevel.error': 'ERROR',
  'logLevel.debug': 'DEBUG',

  'logSource.web': 'Web',
  'logSource.terminal': 'Terminal',
  'logSource.app': 'App',
  'logSource.system': 'System',

  'logCategory.auth': 'Auth',
  'logCategory.attendance': 'Attendance',
  'logCategory.staff': 'Staff',
  'logCategory.schedule': 'Schedule',
  'logCategory.reports': 'Reports',
  'logCategory.devices': 'Terminals',
  'logCategory.users': 'Users',
  'logCategory.roles': 'Roles',
  'logCategory.settings': 'Settings',
  'logCategory.backup': 'Backup',
  'logCategory.retention': 'Retention',
  'logCategory.system': 'System',

  // ---------------------------------------------------------------------------
  // Report field catalogue — these become CSV column headers
  // ---------------------------------------------------------------------------
  'reportField.workDate': 'Date',
  'reportField.workDateOfWork': 'Work date',
  'reportField.employeeNo': 'Staff No.',
  'reportField.fullName': 'Name',
  'reportField.department': 'Department',
  'reportField.location': 'Location',
  'reportField.shift': 'Shift',
  'reportField.status': 'Status',
  'reportField.scheduledStart': 'Scheduled start',
  'reportField.scheduledEnd': 'Scheduled end',
  'reportField.checkInAt': 'In',
  'reportField.checkOutAt': 'Out',
  'reportField.lateMinutes': 'Late minutes',
  'reportField.earlyLeaveMinutes': 'Early leave minutes',
  'reportField.workedMinutes': 'Worked minutes',
  'reportField.overtimeMinutes': 'OT minutes',
  'reportField.occurredAt': 'Occurred',
  'reportField.kind': 'Kind',
  'reportField.deviceName': 'Terminal',
  'reportField.detail': 'Detail',
  'reportField.resolvedAt': 'Resolved',
  'reportField.resolutionNote': 'Resolution reason',
  'reportField.fromDate': 'From',
  'reportField.toDate': 'To',
  'reportField.leaveType': 'Leave type',
  'reportField.days': 'Days',
  'reportField.reason': 'Reason',
  'reportField.decisionNote': 'Decision note',
  'reportField.count': 'Count',
  'reportField.group': 'Group',

  'reportGroup.none.attendance': 'None — one row per record',
  'reportGroup.none.exceptions': 'None — one row per exception',
  'reportGroup.none.leave': 'None — one row per application',
  'reportGroup.staff': 'Per staff',
  'reportGroup.department': 'Per department',
  'reportGroup.status': 'Per status',
  'reportGroup.workDate': 'Per date',
  'reportGroup.kind': 'Per kind',
  'reportGroup.leaveType': 'Per leave type',
};

/**
 * Batch 2: the attendance screens.
 *
 * Appended as a second object rather than merged into the first, so a batch can be reviewed as a unit
 * and a regression can be traced to one of them. `Object.assign` in the seeder flattens them.
 */
export const EN_LABELS_ATTENDANCE: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // Small shared maps
  // ---------------------------------------------------------------------------
  'dialog.close': 'Close',
  'dialog.cancel': 'Cancel',
  'dialog.save': 'Save',

  'filter.from': 'From',
  'filter.to': 'To',

  'auditAction.create': 'Create',
  'auditAction.update': 'Update',
  'auditAction.delete': 'Delete',

  // Protocol names. They are what the mail server documentation calls them.
  'encryption.none': 'None',
  'encryption.tls': 'TLS',
  'encryption.ssl': 'SSL',

  'patternKind.regular': 'Regular',
  'patternKind.shift': 'Shift',
  'patternKind.standby': 'Standby',

  'userStatus.pending': 'Pending',
  'userStatus.suspended': 'Suspended',

  'reportDataset.attendance.note':
    'One row per staff member per day. Generated by the engine from the scan log.',
  'reportDataset.exceptions.note':
    'Things the engine could not resolve. Useful for an audit report.',
  'reportDataset.leave.note': 'Applications and their decisions.',

  // ---------------------------------------------------------------------------
  // Attendance records
  // ---------------------------------------------------------------------------
  'records.title': 'Attendance Records',
  'records.subtitle':
    'Attendance as the engine computed it. Every row can be rebuilt from the raw scan log.',
  'records.count': '{count} records',
  'records.range': '{from} to {to}',
  'records.recompute': 'Recompute this range',
  'records.error.load': 'Could not load records',
  'records.error.recompute': 'Recompute failed',
  'records.recompute.done':
    '{records} records rebuilt for {staff} staff, {exceptions} exceptions raised.',
  'records.empty': 'No records in this range. Run a recompute if scans have already arrived.',
  'records.search': 'Search name or staff no.…',
  'records.column.date': 'Date',
  'records.column.staff': 'Staff',
  'records.column.shift': 'Shift',
  'records.column.scheduled': 'Scheduled',
  'records.column.in': 'In',
  'records.column.out': 'Out',
  'records.column.late': 'Late',
  'records.column.worked': 'Worked',
  'records.column.status': 'Status',
  'records.row.defaultShift': 'default',
  'records.row.blocks': '{count} blocks',
  'records.row.expand': 'record detail',
  'records.detail.shift': 'Shift',
  'records.detail.defaultPattern': 'Default pattern',
  'records.detail.earlyLeave': 'Left early',
  'records.detail.overtime': 'Overtime worked',
  'records.detail.origin': 'Origin',
  'records.detail.calculatedAt': 'Calculated at',
  'records.detail.recordId': 'Record ID',
  'records.block.column.block': 'Block',
  'records.block.column.scheduled': 'Scheduled',
  'records.block.column.in': 'In',
  'records.block.column.out': 'Out',
  'records.block.column.late': 'Late',
  'records.block.column.worked': 'Worked',
  /*
   * The second half is the point of this note: fix the cause, not the result.
   *
   * A shortened English version that only said "this day is incomplete" would invite somebody to edit
   * the record, which destroys the only link between the figure and its evidence.
   */
  'records.incomplete.note':
    'This day is incomplete — usually a missing scan out. Check the Raw Scan Log before correcting it: this record is generated, so fixing the cause and recomputing is more accurate than editing the result.',

  // ---------------------------------------------------------------------------
  // Exceptions
  // ---------------------------------------------------------------------------
  'exceptions.title': 'Exceptions',
  'exceptions.subtitle':
    'Things the engine could not resolve on its own and that need a human to review.',
  'exceptions.none': 'No open exceptions',
  'exceptions.outstanding': '{count} exceptions not yet resolved',
  'exceptions.section.subtitle':
    'Each one is closed with a written reason, because that is what answers a pay dispute later.',
  'exceptions.error.load': 'Could not load exceptions',
  'exceptions.empty': 'No exceptions in this range.',
  'exceptions.filter.allStatuses': 'All statuses',
  'exceptions.filter.open': 'Not resolved',
  'exceptions.filter.resolved': 'Resolved',
  'exceptions.column.kind': 'Kind',
  'exceptions.column.staff': 'Staff',
  'exceptions.column.terminal': 'Terminal',
  'exceptions.column.occurred': 'Occurred',
  'exceptions.column.detail': 'Detail',
  'exceptions.row.unmapped': 'no staff mapped',
  'exceptions.row.resolve': 'Resolve with a reason',
  'exceptions.row.done': 'RESOLVED',
  'exceptions.row.expand': 'exception detail',
  'exceptions.detail.kind': 'Kind',
  'exceptions.detail.internalCode': 'Internal code',
  'exceptions.detail.workDate': 'Work date',
  'exceptions.detail.occurred': 'Occurred',
  'exceptions.detail.terminal': 'Terminal',
  'exceptions.detail.rawEvent': 'Raw scan log',
  'exceptions.detail.rawEvent.none': 'None',
  'exceptions.detail.heading': 'Detail',
  'exceptions.detail.resolvedAt': 'Resolved {when} — {note}',
  'exceptions.detail.noReason': 'no reason recorded',
  'exceptions.detail.unmappedWarning':
    'This terminal ID is not mapped to anybody, so that person’s attendance is not being recorded. Fix it under Staff › Terminal ID Mapping — closing it here only hides the warning, it does not fix the cause.',
  'exceptions.resolve.note': 'Resolution reason',
  'exceptions.resolve.placeholder':
    'Required. This record becomes the evidence if the attendance is disputed.',
  'exceptions.resolve.submit': 'Resolve',
  'exceptions.resolve.done': '{kind} exception resolved.',
  'exceptions.resolve.error': 'Could not save',
  'exceptions.resolve.preset.forgotOut': 'Staff forgot to scan out, confirmed by supervisor',
  'exceptions.resolve.preset.fieldWork': 'Staff was out on field duty, no scan',
  'exceptions.resolve.preset.notStaff': 'Not a staff member, no action needed',
  'exceptions.resolve.preset.fixedManually': 'Already corrected manually',

  // ---------------------------------------------------------------------------
  // Justification approvals
  // ---------------------------------------------------------------------------
  'justify.title': 'Justification Approvals',
  'justify.subtitle':
    'The reasons staff gave for days recorded as late, left early, incomplete or absent. A decision here does not change any attendance figure — the record is correct, and what is being decided is whether the reason is accepted.',
  'justify.note.notExceptions':
    'This is separate from Exceptions. Exceptions are the eight conditions the engine could not resolve — an unrecognised face, a drifted terminal clock — and resolving one corrects data. This screen does not touch data at all.',
  'justify.note.noChain':
    'There is no level chain. One submission, one decision, one message to the person who sent it.',
  'justify.kind.late': 'Late In',
  'justify.kind.early_leave': 'Early Out',
  'justify.kind.incomplete': 'Incomplete',
  'justify.kind.absent': 'Absent',
  'justify.status.pending': 'Pending',
  'justify.status.approved': 'Approved',
  'justify.status.rejected': 'Rejected',
  // Not "Returned": the point is that it went back to the person to be rewritten, not that it bounced.
  'justify.status.reverted': 'Sent Back',
  'justify.column.staff': 'Staff',
  'justify.column.date': 'Date',
  'justify.column.kind': 'Kind',
  'justify.column.record': 'That Day’s Record',
  'justify.column.reason': 'Reason',
  'justify.column.submitted': 'Submitted',
  'justify.column.decided': 'Decided',
  'justify.empty': 'No justifications in this period.',
  'justify.error.load': 'Could not load the justification list.',
  'justify.filter.from': 'From',
  'justify.filter.to': 'To',
  'justify.filter.department': 'All departments',
  'justify.filter.kind': 'All kinds',
  'justify.action.view': 'Open detail',
  'justify.action.approve': 'Approve',
  'justify.action.reject': 'Reject',
  'justify.action.revert': 'Send back',
  'justify.form.title': 'Reason for {date}',
  'justify.form.reason': 'Reason',
  'justify.form.record': 'That day’s record',
  'justify.decision.note': 'Note',
  'justify.decision.note.hint':
    'Required to reject and to send back. A decision with no words is a decision the person can neither accept nor act on.',
  'justify.decision.note.optional': 'Optional for an approval — the person has already written why.',
  'justify.decided': 'Decision recorded.',
  'justify.decision.recordMissing':
    'The attendance record for this day has since been recomputed and no longer matches. This row stands as a record of what was asked and answered.',
  'justify.refuse.alreadyPending': 'There is already a reason awaiting a decision for that day.',
  'justify.record.shift': 'Shift',
  'justify.record.scheduled': 'Scheduled',
  'justify.record.actual': 'Actual',
  'justify.record.hours': 'Hours Worked',
  'justify.record.late': '{minutes} min late',
  'justify.record.early': '{minutes} min early',

  // ---------------------------------------------------------------------------
  // Live monitor
  // ---------------------------------------------------------------------------
  'monitor.title': 'Today’s Monitor',
  'monitor.subtitle':
    'Scans as they happen. This feed is best-effort — records are still stored in the Raw Scan Log even if the connection drops.',
  'monitor.connected': 'Connected',
  'monitor.disconnected': 'Connection lost',
  'monitor.connected.hint': 'Scans will appear below as soon as a terminal reports them.',
  'monitor.disconnected.hint': 'The browser will retry on its own. No records are lost.',
  'monitor.waiting': 'waiting for scans',
  'monitor.lastAt': 'last {time}',
  'monitor.stat.accepted': 'Accepted this session',
  'monitor.stat.accepted.hint': 'punches recorded',
  'monitor.stat.suppressed': 'Duplicates filtered',
  'monitor.stat.suppressed.hint': 'repeat scans inside the dedup window',
  'monitor.stat.problems': 'Needs attention',
  'monitor.stat.problems.hint': 'unrecognised face or unmapped ID',
  'monitor.offline.note':
    'This live feed is not the source of truth. Every scan is written to the Raw Scan Log before it reaches this screen, so a gap here does not mean attendance was lost.',
  'monitor.chip.accepted': 'Accepted',
  'monitor.chip.suppressed': 'Duplicate',
  'monitor.chip.problem': 'Needs attention',
  'monitor.idle': 'Waiting for a scan. Stand in front of a terminal to test.',
  'monitor.empty': 'No scans match these filters.',
  'monitor.column.time': 'Time',
  'monitor.column.staff': 'Staff',
  'monitor.column.terminal': 'Terminal',
  'monitor.column.method': 'Method',
  'monitor.column.outcome': 'Outcome',
  'monitor.row.unknown': 'Unknown',
  'monitor.row.unmapped': 'Terminal ID {employeeNo}, not mapped',
  'monitor.row.recorded': 'RECORDED',
  'monitor.row.expand': 'scan detail',
  'monitor.detail.fullTime': 'Full timestamp',
  'monitor.detail.serial': 'Terminal serial',
  'monitor.detail.rawEventId': 'Raw event ID',
  'monitor.detail.terminalId': 'ID on the terminal',
  'monitor.detail.punch': 'Punch',
  'monitor.detail.punch.none': 'No punch generated',
  'monitor.detail.direction': 'Direction',
  'monitor.detail.unmappedWarning':
    'ID {employeeNo} on {device} is not mapped to anybody, so this person’s attendance is not being recorded. Fix it under Staff › Terminal ID Mapping.',
  'monitor.detail.noPunchWarning':
    'This scan did not become a punch. Check Exceptions for the detail.',
  'monitor.footer.showing': 'Showing {shown} of {total} scans this session',
  // The leading space and separator are deliberate: this clause sits mid-sentence.
  'monitor.footer.capped': ' · capped at the {max} most recent rows',
  'monitor.footer.note':
    'The full history is in the Raw Scan Log — this screen is only for watching a shift changeover.',

  // ---------------------------------------------------------------------------
  // Raw scan log
  // ---------------------------------------------------------------------------
  'rawlog.title': 'Raw Scan Log',
  'rawlog.subtitle':
    'The terminal log exactly as reported. Never edited — this is what settles a dispute over an attendance record.',
  'rawlog.count': '{count} events',
  'rawlog.section.subtitle':
    'Push is real-time delivery from the terminal; pull is the reconcile pass that catches what push missed.',
  'rawlog.error.load': 'Could not load the log',
  'rawlog.empty': 'No events in this range.',
  'rawlog.search': 'Search the ID on the terminal, e.g. 1001…',
  'rawlog.chip.push': 'Push',
  'rawlog.chip.pull': 'Pull',
  'rawlog.filter.allDevices': 'All terminals',
  'rawlog.filter.allCategories': 'All categories',
  'rawlog.immutable': 'cannot be altered or removed',
  // `{emphasis}` carries the phrase above, already wrapped in a <strong>. Do not fold it into the text.
  'rawlog.immutable.note':
    'This log {emphasis} by anybody, including a Super Admin. To correct an attendance record, fix the cause and run a recompute — do not edit the result.',
  'rawlog.column.serial': 'Serial',
  'rawlog.column.deviceTime': 'Terminal time',
  'rawlog.column.event': 'Event',
  'rawlog.column.terminalId': 'Terminal ID',
  'rawlog.column.terminalName': 'Name on the terminal',
  'rawlog.column.terminal': 'Terminal',
  'rawlog.column.punch': 'Punch',
  'rawlog.row.drift': 'clock {drift}s',
  'rawlog.row.noPunch': 'none',
  'rawlog.row.recorded': 'RECORDED',
  'rawlog.row.picture': 'View the captured picture',
  'rawlog.row.expand': 'event detail',
  'rawlog.detail.serial': 'Terminal serial',
  'rawlog.detail.eventCode': 'Event code',
  'rawlog.detail.verifyMode': 'Verification method',
  'rawlog.detail.cardNo': 'Card no.',
  'rawlog.detail.door': 'Door',
  'rawlog.detail.mask': 'Face mask',
  'rawlog.detail.arrivedVia': 'Arrived via',
  'rawlog.detail.receivedAt': 'Received by server',
  'rawlog.detail.drift': 'Terminal clock drift',
  'rawlog.detail.drift.unmeasured': 'Not measured',
  'rawlog.detail.eventId': 'Event ID',
  'rawlog.detail.suppressed':
    'Punch #{punch} was filtered as a duplicate — another scan was too close to this one.',
  'rawlog.detail.recorded': 'Recorded as punch #{punch}, direction “{direction}”.',
  'rawlog.detail.noPunchWarning':
    'This event did not become a punch. The usual causes: the terminal ID is not mapped to anybody, or this event code is not a person verification (a door opening, for instance).',
  'rawlog.picture.title': 'Picture for event #{serial}',
  'rawlog.picture.alt': 'Picture captured by the terminal for event {serial}',
  'rawlog.picture.note':
    'Pictures are stored on the terminal, not on this server. The terminal overwrites them when it runs out of room, so an old picture will disappear even though its event log entry remains.',

  // ---------------------------------------------------------------------------
  // Work calendar
  // ---------------------------------------------------------------------------
  'roster.title': 'Work Calendar',
  'roster.subtitle':
    'Select cells then pick a shift. Click a name to select that person’s whole month.',
  'roster.count': '{count} staff in this view',
  'roster.month.previous': 'Previous month',
  'roster.month.next': 'Next month',
  'roster.recompute': 'Recompute this month',
  'roster.error.load': 'Could not load the roster',
  'roster.error.save': 'Could not save the roster',
  'roster.error.clear': 'Could not clear',
  'roster.error.recompute': 'Recompute failed',
  'roster.empty': 'No staff to show.',
  'roster.selected': '{count} days selected',
  'roster.apply.rest': 'Rest',
  'roster.apply.leave': 'Leave',
  'roster.apply.clear': 'Clear',
  'roster.selection.drop': 'Drop the selection',
  'roster.saved':
    '{count} days updated. Run an attendance recompute for this range so the records reflect the new roster.',
  'roster.cleared': '{count} days cleared.',
  'roster.recomputed': '{count} attendance records rebuilt for this month.',
  'roster.caption': 'Monthly work calendar. Click a cell to select it, then pick a shift.',
  'roster.column.staff': 'Staff',
  'roster.selectMonth': 'Select the whole month for {name}',
  'roster.cell.aria': '{name}, {day} {month}, {state}',
  'roster.cell.unscheduled': 'not scheduled',
  'roster.cell.work': 'work',
  'roster.note':
    'A work day with no shift is refused by the server — there would be nothing to measure attendance against. Setting a shift on the same day overwrites it rather than adding a second row.',

  // ---------------------------------------------------------------------------
  // Public holidays
  // ---------------------------------------------------------------------------
  'holidays.title': 'Public Holidays',
  'holidays.subtitle':
    'Holidays affect pay calculation: a holiday with no scan is recorded as on leave, not absent.',
  'holidays.count': '{count} holidays in {year}',
  // Sarawak is a proper noun; the clause about late announcements is the operational warning.
  'holidays.section.subtitle':
    'Sarawak holidays differ from other states, and Islamic holiday dates can move on a late announcement.',
  'holidays.add': 'Add Holiday',
  'holidays.year.previous': 'Previous year',
  'holidays.year.next': 'Next year',
  'holidays.error.load': 'Could not load holidays',
  'holidays.empty': 'No holidays recorded for {year} yet.',
  'holidays.search': 'Search holiday name…',
  'holidays.chip.public': 'Public holiday',
  'holidays.chip.company': 'Company holiday',
  'holidays.filter.allScopes': 'All scopes',
  'holidays.scope.nationwide': 'Nationwide',
  'holidays.recomputeNote':
    'After adding or removing a holiday, run an attendance recompute for the affected date range under General Configuration › Maintenance. Records that have already been computed do not change on their own.',
  'holidays.column.date': 'Date',
  'holidays.column.day': 'Day',
  'holidays.column.name': 'Name',
  'holidays.column.scope': 'Scope',
  'holidays.column.kind': 'Kind',
  'holidays.weekend': 'weekend',
  'holidays.kind.company': 'Company',
  'holidays.kind.public': 'Public',
  'holidays.row.remove': 'Remove holiday',
  'holidays.remove.title': 'Remove “{name}”?',
  'holidays.remove.body': '{date} becomes an ordinary working day again.',
  'holidays.remove.warning':
    'Attendance records already computed for that day do not change on their own. Run a recompute afterwards, or anybody who was absent that day will still be reported as on leave.',
  'holidays.removed':
    '“{name}” removed. Run an attendance recompute for {date} — that day now counts as an ordinary working day.',
  'holidays.error.remove': 'Could not remove',
  'holidays.dialog.title': 'Add a holiday',
  'holidays.dialog.description':
    'A public holiday, or a day the organisation has declared for itself.',
  // Hari Gawai is a proper noun: the Sarawak harvest festival.
  'holidays.dialog.name.placeholder': 'e.g. Hari Gawai',
  'holidays.dialog.company': 'Company holiday',
  'holidays.dialog.company.hint':
    'A day declared by the organisation, not a public holiday. Marked separately so it can be told apart from the official calendar later.',
  'holidays.dialog.submit': 'Add',
  'holidays.error.add': 'Could not add',
  'holidays.added': '“{name}” added on {date}. Run a recompute for that date.',
};

/** Batch 3: the staff directory, the staff form, and the organisation structure. */
export const EN_LABELS_STAFF: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // Departments & locations
  // ---------------------------------------------------------------------------
  'org.title': 'Departments & Locations',
  'org.subtitle':
    'The organisation structure and its physical sites. Both are referenced by staff records, so neither can be removed while still in use.',
  'org.tabs.aria': 'Organisation structure',
  'org.tab.departments': 'Departments',
  'org.tab.locations': 'Locations',

  'org.dept.count': '{count} departments',
  'org.dept.subtitle': '{staff} staff assigned. Bulk import also creates departments automatically.',
  'org.dept.add': 'Add Department',
  'org.dept.search': 'Search department name or code…',
  'org.dept.empty': 'No departments match.',
  'org.dept.error.load': 'Could not load departments',
  'org.dept.removed': 'Department “{name}” removed.',
  'org.dept.saved': 'Department “{name}” saved.',
  'org.dept.column.name': 'Name',
  'org.dept.column.code': 'Code',
  'org.dept.column.parent': 'Parent',
  'org.dept.column.children': 'Sub-departments',
  'org.dept.column.staff': 'Staff',
  'org.dept.row.edit': 'Update department',
  'org.dept.row.remove': 'Remove department',
  'org.dept.row.locked': '{staff} staff and {children} sub-departments are still attached',
  'org.dept.row.expand': 'department detail',
  'org.dept.detail.parent': 'Parent department',
  'org.dept.detail.topLevel': 'Top level',
  'org.dept.detail.staff': 'Staff assigned',
  'org.dept.detail.id': 'Department ID',
  /*
   * The last clause is the reason, not decoration: removing a department must not detach staff as a
   * side effect, because nothing on this screen would show that it had happened.
   */
  'org.dept.detail.locked':
    'Cannot be removed while {staff} staff and {children} sub-departments still reference it. Move them first — removing this department should not detach staff as a side effect.',
  'org.dept.remove.title': 'Remove department “{name}”?',
  'org.dept.remove.body': 'No staff or sub-departments are attached to it, so it is safe to remove.',
  'org.dept.dialog.edit': 'Update department',
  'org.dept.dialog.create': 'Add department',
  'org.dept.dialog.parent.none': 'None — top level',

  'org.loc.count': '{count} locations',
  'org.loc.subtitle':
    'Coordinates and a radius are collected now even though app check-in has not been built — those values belong to the site, not to the app.',
  'org.loc.add': 'Add Location',
  'org.loc.search': 'Search location name or address…',
  'org.loc.empty': 'No locations match.',
  'org.loc.error.load': 'Could not load locations',
  'org.loc.removed': 'Location “{name}” removed.',
  'org.loc.saved': 'Location “{name}” saved.',
  'org.loc.missingCoords':
    '{count} locations have no coordinates yet. Without them, app check-in cannot be confined to that area — and that would only be noticed after the app is built.',
  'org.loc.column.coords': 'Coordinates',
  'org.loc.column.radius': 'Radius',
  'org.loc.column.devices': 'Terminals',
  'org.loc.coords.unset': 'not set',
  'org.loc.row.edit': 'Update location',
  'org.loc.row.remove': 'Remove location',
  'org.loc.row.locked': '{staff} staff and {devices} terminals are still attached',
  'org.loc.row.expand': 'location detail',
  'org.loc.detail.address': 'Address',
  'org.loc.detail.latitude': 'Latitude',
  'org.loc.detail.longitude': 'Longitude',
  'org.loc.detail.radius': 'Geofence radius',
  'org.loc.detail.devices': 'Terminals here',
  'org.loc.detail.id': 'Location ID',
  'org.loc.detail.noCoords':
    'Coordinates are not set, so a geofence cannot be enforced for this site.',
  'org.loc.remove.title': 'Remove location “{name}”?',
  'org.loc.remove.body': 'No staff or terminals are attached to it, so it is safe to remove.',
  'org.loc.dialog.edit': 'Update location',
  'org.loc.dialog.create': 'Add location',
  'org.loc.dialog.radius': 'Geofence radius (metres)',
  'org.loc.dialog.radius.hint':
    'Used later for check-in through the app. Between 20 and 5000 metres.',
  'org.loc.dialog.note':
    'Without coordinates, check-in through the app cannot be confined to this area.',

  // ---------------------------------------------------------------------------
  // Staff directory
  // ---------------------------------------------------------------------------
  'staff.title': 'Staff Directory',
  'staff.subtitle':
    'Staff records and their ability to scan. Deactivating somebody removes them from the terminals but keeps their attendance records.',
  'staff.count': '{count} staff',
  /*
   * The silent failure this screen exists to surface: a staff row can be on a terminal with no
   * credential at all, and nothing reports an error when that person tries to scan.
   */
  'staff.section.subtitle':
    'Staff can exist on a terminal with no face, fingerprint or card — in that state they cannot scan at all and nothing reports an error.',
  'staff.add': 'Add Staff',
  'staff.error.load': 'Could not load the staff list',
  'staff.empty': 'No staff match these filters.',
  'staff.search': 'Search name or staff no.…',
  'staff.chip.noBiometrics': 'No biometrics',
  'staff.filter.allDepartments': 'All departments',
  'staff.filter.allLocations': 'All locations',
  'staff.column.employeeNo': 'Staff No.',
  'staff.column.name': 'Name',
  'staff.column.department': 'Department',
  'staff.column.location': 'Location',
  'staff.column.biometrics': 'Biometrics',
  'staff.column.account': 'Account',
  'staff.status.cannotScan': 'Cannot scan',
  'staff.biometric.face.present': 'Face enrolled',
  'staff.biometric.face.absent': 'No face',
  'staff.biometric.fingerprint.present': 'Fingerprint enrolled',
  'staff.biometric.fingerprint.absent': 'No fingerprint',
  'staff.biometric.card.present': 'Card enrolled',
  'staff.biometric.card.absent': 'No card',
  'staff.biometric.pin.present': 'Door PIN stored',
  'staff.biometric.pin.absent': 'No door PIN',
  'staff.row.noAccount': 'none',
  'staff.row.edit': 'Update staff',
  'staff.row.deactivate': 'Deactivate and remove from terminals',
  'staff.row.reactivate': 'Reactivate through the update form',
  'staff.row.open': 'Open staff detail',
  'staff.detail.employeeNo': 'Staff no.',
  'staff.detail.department': 'Department',
  'staff.detail.location': 'Location',
  'staff.detail.faces': 'Faces enrolled',
  'staff.detail.fingerprints': 'Fingerprints enrolled',
  'staff.detail.cards': 'Cards enrolled',
  'staff.detail.doorPin': 'Door PIN',
  'staff.detail.account': 'Account',
  'staff.detail.appCheckIn': 'App check-in',
  'staff.detail.appCheckIn.allowed': 'Allowed',
  'staff.detail.appCheckIn.denied': 'No',
  'staff.detail.staffId': 'Staff ID',
  'staff.detail.blockedWarning':
    'This person has no face, fingerprint or card on the terminals, so they cannot scan at all — and nothing reports an error when they try. Enrol them under Staff › Biometric Enrolment.',

  'staff.deactivate.title': 'Deactivate {name}?',
  'staff.deactivate.body': 'They will be removed from every terminal so they can no longer scan.',
  'staff.deactivate.kept': 'are kept',
  // `{emphasis}` carries the phrase above, already wrapped in a <strong>.
  'staff.deactivate.note':
    'Punches and attendance records {emphasis}. They are the evidence for pay already issued, so they are not removed along with access.',
  'staff.deactivate.submit': 'Deactivate',
  'staff.deactivate.error': 'Could not deactivate',
  'staff.deactivate.done': '{name} deactivated and removed from {count} terminals.',
  'staff.deactivate.partial':
    '{name} deactivated, but {count} terminals could not be reached: {devices}. The mapping has already been removed, so scans from those IDs will land in the review queue.',

  // ---------------------------------------------------------------------------
  // Staff detail screen
  // ---------------------------------------------------------------------------
  'staff.view.back.aria': 'Back to the staff directory',
  'staff.view.avatarAlt': 'Photo of {name}',
  'staff.view.edit': 'Update',
  'staff.view.deactivate': 'Deactivate',
  'staff.view.deactivated': '{name} deactivated and removed from every terminal.',
  'staff.view.deactivated.partial':
    '{name} deactivated, but {count} terminals could not be reached. The mapping has already been removed, so scans from those IDs will land in the review queue.',
  'staff.view.error.load': 'Could not load the staff detail',
  'staff.view.tabs.aria': 'Staff detail sections',
  'staff.view.tab.details': 'Details',
  'staff.view.tab.terminal': 'Terminal',
  'staff.view.tab.attendance': 'Attendance',
  'staff.view.tab.exceptions': 'Exceptions',
  'staff.view.tab.roster': 'Roster',
  'staff.view.tab.leave': 'Leave',
  'staff.view.tab.scans': 'Scan Log',
  'staff.view.tab.audit': 'Audit',

  'staff.view.details.title': 'Staff details',
  'staff.view.details.subtitle':
    'Shown only here. Edits go through the Update form, where the HR field boundary is already enforced.',
  'staff.view.managedByHr': 'Managed by HR',
  'staff.view.group.identity': 'Identity',
  'staff.view.group.contact': 'Contact',
  'staff.view.group.access': 'Access',
  'staff.view.group.notes': 'Notes',
  'staff.view.group.record': 'Record',
  'staff.view.employeeNo.hint':
    'The key between this system and every terminal and every attendance row. Cannot be changed after creation.',
  'staff.view.field.icNo': 'NRIC',
  'staff.view.field.position': 'Position',
  'staff.view.field.posting': 'Posting',
  'staff.view.field.dates': 'Dates',
  'staff.view.field.dates.hint':
    'The start date is a calendar date. The validity period is a timestamp written to the terminal.',
  'staff.view.field.hireDate': 'Start date',
  'staff.view.field.validFrom': 'Valid from',
  'staff.view.field.validTo': 'Valid to',
  'staff.view.field.workPattern': 'Work pattern',
  'staff.view.field.workPattern.hint':
    'Decides the scheduled hours when there is no roster row for that day.',
  'staff.view.field.contact': 'Contact',
  'staff.view.field.phone': 'Phone',
  'staff.view.field.email': 'Email',
  'staff.view.field.address': 'Address',
  'staff.view.field.address.hint': 'Free text — nothing in the system computes on it.',
  'staff.view.field.loginEmail': 'Login email',
  'staff.view.field.account.hint':
    'Most staff have no account. Attendance is recorded from the terminals, not from a login.',
  'staff.view.field.appCheckIn.hint':
    'App check-in only proves a token was held, not physical presence at a door. Granted per person.',
  'staff.view.field.recordDates': 'Database record',
  'staff.view.field.updatedAt': 'Updated',
  'staff.view.pin.set': 'PIN stored',
  'staff.view.pin.unset': 'No PIN',
  /*
   * The statutory reference stays. `s.60I` of the Employment Act 1955 is what an HR officer would
   * quote in a dispute, and translating the citation would make it unfindable.
   */
  'staff.view.field.basicSalary': 'Monthly salary',
  'staff.view.field.basicSalary.hint':
    'The overtime hourly rate is derived from it — monthly salary ÷ 26 ÷ 8, per s.60I of the Employment Act 1955. That rate is frozen onto an application when it is submitted, so a later pay rise does not change a claim already decided.',
  'staff.view.field.basicSalary.monthly': 'Per month',
  'staff.view.field.basicSalary.hourly': 'Per hour (derived)',

  'staff.view.terminal.title': 'Terminals and biometrics',
  'staff.view.terminal.subtitle':
    'The credentials this person scans with, and the ID they carry at each door.',
  'staff.view.terminal.refresh': 'Re-read from the terminals',
  'staff.view.terminal.refreshed':
    'Re-read from the terminals: {face} faces, {fingerprint} fingerprints, {card} cards.',
  'staff.view.terminal.refresh.error': 'Could not re-read the credential counts',
  'staff.view.terminal.group.credentials': 'Credentials',
  'staff.view.terminal.counts': 'FACE {face} · FINGERPRINT {fingerprint} · CARD {card}',
  'staff.view.terminal.face': 'Face enrolled',
  'staff.view.terminal.face.hint':
    'The picture is stored on the terminal, not on this server. Showing it here is a round trip to the unit.',
  // The avatar/biometric distinction, stated where somebody might confuse the two.
  'staff.view.terminal.face.present':
    'Re-read from the terminal. This is not the avatar — the avatar is the picture beside the name on screen, and changing it does not re-enrol a face.',
  'staff.view.terminal.face.absent':
    'No face enrolled. Enrol one under Staff › Biometric Enrolment — the terminal has to know this person first.',
  'staff.view.terminal.credentialCounts': 'Credential counts',
  'staff.view.terminal.group.identities': 'Per-terminal identities',
  'staff.view.terminal.group.identities.subtitle':
    'A different ID on each terminal is normal. This mapping is the only link between a scan and this person — a wrong row credits somebody else’s attendance to them with no error anywhere.',
  'staff.view.terminal.identity.detail': 'ID on terminal {employeeNo} · {face} faces',
  'staff.view.terminal.identity.noFace': 'not enrolled',
  'staff.view.terminal.unconfirmed': 'Not confirmed',
  'staff.view.terminal.noTerminals':
    'This person is not assigned to any terminal, so they cannot scan anywhere. Assign terminals through the Update form.',
  'staff.view.terminal.resync': 'Push again to the terminals',
  'staff.view.terminal.resync.hint':
    'Resends the name, validity period and door PIN to terminals already assigned. It cannot add a new terminal, and it does not send a face.',
  'staff.view.terminal.resynced': 'Pushed again to {count} terminals.',
  'staff.view.terminal.resynced.partial': 'Pushed to {count} terminals, some failed: {failed}',
  'staff.view.terminal.resync.error': 'Could not push again',

  'staff.view.attendance.title': 'Attendance',
  'staff.view.attendance.subtitle':
    'Work days as the engine computed them. Every row can be rebuilt from the raw scan log.',
  'staff.view.attendance.month': 'Month',
  'staff.view.attendance.allStatuses': 'All statuses',
  'staff.view.attendance.summary': 'Month summary',
  'staff.view.attendance.none': 'No records',
  'staff.view.attendance.empty':
    'No records for this month. Run a recompute if scans have already arrived.',

  'staff.view.exceptions.title': 'Exceptions',
  'staff.view.exceptions.subtitle':
    'Things the engine could not resolve on its own for this person.',
  'staff.view.exceptions.empty': 'No exceptions for this staff member.',

  'staff.view.roster.title': 'Work roster',
  'staff.view.roster.subtitle':
    'What was scheduled, as distinct from what happened. A scheduled day with no scan becomes an absence; a scan on a rest day becomes an exception.',
  'staff.view.roster.error': 'Could not load the roster',
  'staff.view.roster.pattern': 'Work pattern',
  'staff.view.roster.summary': 'Month summary',
  'staff.view.roster.none': 'No rows',
  'staff.view.roster.note':
    'A day with no row here is not a rest day — it is not scheduled at all, and the engine falls back to the work pattern for that day.',
  'staff.view.roster.column.type': 'Type',
  'staff.view.roster.column.notes': 'Notes',
  'staff.view.roster.empty': 'No roster rows for this month.',

  'staff.view.leave.title': 'Leave',
  'staff.view.leave.subtitle': 'The annual balance and every application filed.',
  'staff.view.leave.error': 'Could not load leave data',
  'staff.view.leave.year': 'Year',
  'staff.view.leave.group.balance': '{year} balance',
  'staff.view.leave.group.balance.subtitle':
    'Days still awaiting a decision count against the balance — otherwise several separate applications could each pass review and together exceed the entitlement.',
  'staff.view.leave.balanceLine': 'entitled {entitlement} · taken {taken} · pending {pending}',
  'staff.view.leave.unlimited': 'no limit',
  'staff.view.leave.unpaid': 'Unpaid — the balance is not the control',
  'staff.view.leave.noTypes': 'No active leave types.',
  'staff.view.leave.group.requests': 'Applications',
  'staff.view.leave.group.requests.subtitle':
    'Only charged days are written to the roster. Rest days and public holidays inside the range are skipped, so the balance and the monthly report agree.',
  'staff.view.leave.column.days': 'Days',
  'staff.view.leave.column.type': 'Type',
  'staff.view.leave.column.reason': 'Reason',
  'staff.view.leave.empty': 'No leave applications for this staff member.',

  'staff.view.scans.title': 'Scan log',
  'staff.view.scans.subtitle':
    'What the terminals reported about this person, and what became of it. The rows with no punch are what you look for when a day is missing.',
  'staff.view.scans.error': 'Could not load the scan log',
  'staff.view.scans.matchedOn': 'Matched on ID',
  'staff.view.scans.matchedOn.hint':
    'The terminal’s local ID, not the Staff No. Filtering by Staff No. would miss every scan from a terminal where this person carries a different number.',
  'staff.view.scans.summary': 'Summary',
  'staff.view.scans.counts': '{total} rows · {unresolved} with no punch',
  'staff.view.scans.truncated':
    'Capped at the {limit} most recent rows, so this is not the whole month. Narrow the range to see earlier ones.',
  'staff.view.scans.column.at': 'Time',
  'staff.view.scans.column.outcome': 'Outcome',
  'staff.view.scans.noPunch': 'NO PUNCH',
  'staff.view.scans.empty': 'No scans for this month.',

  'staff.view.audit.title': 'Audit trail',
  'staff.view.audit.subtitle':
    'Who changed what about this person, and when. Only fields that actually changed are recorded.',
  'staff.view.audit.error': 'Could not load the audit trail',
  'staff.view.audit.column.when': 'When',
  'staff.view.audit.column.actor': 'By',
  'staff.view.audit.column.action': 'Action',
  'staff.view.audit.column.changes': 'Changes',
  'staff.view.audit.empty': 'No changes recorded for this staff member.',

  // ---------------------------------------------------------------------------
  // Staff form
  // ---------------------------------------------------------------------------
  'staffForm.title.edit': 'Update staff',
  'staffForm.title.create': 'Add staff',
  'staffForm.description': 'The staff record and the terminals they can scan at.',
  'staffForm.error.load': 'Could not load',
  'staffForm.error.save': 'Could not save',
  'staffForm.employeeNo': 'Staff No.',
  'staffForm.employeeNo.locked':
    'Cannot be changed — it is the key to the terminals and to the attendance history',
  'staffForm.employeeNo.hint': 'Maximum {max} characters (terminal limit)',
  'staffForm.fullName': 'Full Name',
  'staffForm.icNo': 'NRIC',
  'staffForm.phone': 'Phone',
  'staffForm.email': 'Email',
  'staffForm.doorPin': 'Door PIN',
  'staffForm.doorPin.hint':
    '{min}–{max} digits. Do not reuse an account password — the terminal stores the PIN in clear text.',
  'staffForm.department': 'Department',
  'staffForm.location': 'Location',
  'staffForm.none': 'None',
  'staffForm.active': 'Active',
  'staffForm.devices': 'Terminals',
  'staffForm.devices.hint':
    'Staff can only scan at the terminals selected here. Each unit stores a limited number of faces, so spread people across terminals.',
  'staffForm.devices.none': 'No terminals registered.',
  'staffForm.sync.heading': 'Enrolment result',
  'staffForm.sync.ok': 'succeeded',
  'staffForm.saved': '{name} saved.',
  'staffForm.saved.enrolled': '{name} saved and enrolled on {count} terminals.',
  'staffForm.submit.create': 'Add',
  'staffForm.error.employeeNo.required': 'Staff No. is required',
  'staffForm.error.maxChars': 'Maximum {max} characters',
  'staffForm.error.employeeNo.charset': 'Letters, numbers, dots and hyphens only',
  'staffForm.error.fullName.required': 'Name is required',
  'staffForm.error.email': 'Invalid email address',
  'staffForm.error.pin.digits': 'The PIN must be digits',
  'staffForm.error.pin.min': 'Minimum {min} digits',
  'staffForm.error.pin.max': 'Maximum {max} digits',
  'staffForm.basicSalary': 'Monthly Salary (RM)',
  'staffForm.basicSalary.hint':
    'The overtime hourly rate is derived from it. Leave blank if no salary is recorded — overtime applications will be refused until it is filled in.',
  'staffForm.error.basicSalary': 'Salary must be a positive number, maximum 1,000,000',
};

/** Batch 3b: biometric enrolment, terminal ID mapping, bulk import. */
export const EN_LABELS_ENROLMENT: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // Biometric enrolment
  // ---------------------------------------------------------------------------
  'biometrics.title': 'Biometric Enrolment',
  'biometrics.subtitle':
    'Face pictures are stored on the terminals, not in this database. Each terminal matches faces locally.',
  'biometrics.count.missing': '{count} staff cannot scan yet',
  'biometrics.count.all': '{count} staff',
  'biometrics.count.enrolled': '{count} staff already have biometrics',
  'biometrics.limits':
    'Terminal limits: JPEG, maximum {maxKb} KB, minimum {minPixels}×{minPixels} pixels. Pictures are cropped and compressed automatically.',
  'biometrics.error.load': 'Could not load the list',
  'biometrics.empty.missing': 'Every staff member already has biometrics. Nothing to enrol.',
  'biometrics.empty.all': 'No staff match.',
  'biometrics.chip.missing': 'No biometrics yet',
  'biometrics.chip.enrolled': 'Face enrolled',
  'biometrics.column.face': 'Face',
  'biometrics.column.canScan': 'Can scan',
  'biometrics.face.enrolled': 'Enrolled',
  'biometrics.face.none': 'None',
  'biometrics.canScan.yes': 'yes',
  'biometrics.canScan.no': 'no',
  'biometrics.row.replace': 'Replace face',
  'biometrics.row.enrol': 'Enrol face',
  'biometrics.row.expand': 'biometric detail',
  'biometrics.row.faceAlt': 'Face enrolled for {name}',
  'biometrics.detail.active': 'Active',
  'biometrics.detail.active.yes': 'Yes',
  'biometrics.detail.active.no': 'No',
  /*
   * The last clause is the whole point: the failure is silent. A scan simply never arrives, so
   * nobody looks for it.
   */
  'biometrics.detail.blockedWarning':
    'No face, fingerprint or card on the terminals. This person cannot scan at all, and the terminal reports no error when they try — their scans just never arrive.',
  'biometrics.dialog.description': '{name} · Staff No. {employeeNo}',
  'biometrics.dialog.current': 'The current face, read straight from the terminal.',
  'biometrics.dialog.remove': 'Remove',
  'biometrics.dialog.pick': 'Choose a picture',
  'biometrics.dialog.pick.hint':
    'Front-facing, one person only. The picture is cropped and compressed automatically to meet the terminal limits.',
  'biometrics.dialog.previewAlt': 'Preview of the picture that will be sent to the terminal',
  'biometrics.dialog.size': 'Size',
  'biometrics.dialog.dimensions': 'Dimensions',
  'biometrics.dialog.quality': 'Quality',
  'biometrics.dialog.zoom': 'Tighten the crop',
  'biometrics.dialog.submit': 'Enrol to the terminals',
  'biometrics.dialog.submit.pending': 'Sending…',
  'biometrics.dialog.sending': 'Sending to every terminal this person is assigned to.',
  'biometrics.error.image': 'The picture could not be processed',
  'biometrics.error.compress': 'Could not compress',
  'biometrics.error.send': 'Could not send',
  'biometrics.error.remove': 'Could not remove',
  'biometrics.error.status': 'Failed ({status})',
  'biometrics.done.enrolled': '{name}’s face enrolled on {count} terminals.',
  'biometrics.done.removed': '{name}’s face removed from {count} terminals.',

  // ---------------------------------------------------------------------------
  // Terminal ID mapping
  // ---------------------------------------------------------------------------
  'mapping.title': 'Terminal ID Mapping',
  'mapping.subtitle':
    'A terminal only reports its own number, not a face. This mapping is the only link between a scan and a person.',
  'mapping.tabs.aria': 'Mapping queues',
  'mapping.tab.unmapped': 'Not Mapped',
  'mapping.tab.unconfirmed': 'Not Confirmed',
  'mapping.tab.import': 'Read From Terminal',
  'mapping.error.load': 'Could not load data',

  'mapping.import.title': 'Read the user list from a terminal',
  'mapping.import.subtitle':
    'For terminals already filled in by another tool, or by hand at the keypad.',
  'mapping.import.unconfirmed': 'not confirmed',
  // `{emphasis}` carries the phrase above, already wrapped in a <strong>.
  'mapping.import.note':
    'An ID that matches a Staff No. exactly is matched automatically but stays {emphasis} — an exact number match is strong evidence, not proof.',
  'mapping.import.noDevices': 'No terminals registered.',
  'mapping.import.error': 'Import failed',
  'mapping.import.done':
    '{device}: {users} users read — {auto} matched automatically, {existing} already mapped, {review} need review.',

  'mapping.unmapped.none': 'Every terminal ID is mapped',
  'mapping.unmapped.count': '{count} IDs not mapped',
  'mapping.unmapped.subtitle':
    'Every ID here is somebody who scanned and whose attendance was recorded nowhere.',
  'mapping.unmapped.lostScans':
    '{scans} scans from {ids} IDs have been lost. Their attendance is not recorded — map those IDs and the history will be regenerated.',
  'mapping.unmapped.search': 'Search the ID or the name on the terminal…',
  'mapping.unmapped.empty': 'Every terminal ID is mapped to somebody.',
  'mapping.column.terminal': 'Terminal',
  'mapping.column.terminalId': 'ID on the terminal',
  'mapping.column.terminalName': 'Name on the terminal',
  'mapping.column.biometrics': 'Biometrics',
  'mapping.column.lostScans': 'Lost scans',
  'mapping.column.matchedTo': 'Matched to',
  'mapping.row.noName': 'none',
  'mapping.row.lost': '{count} lost',
  'mapping.row.map': 'Map to a staff member',
  'mapping.row.expand': 'ID detail',
  'mapping.detail.firstSeen': 'First seen',
  'mapping.detail.lastSeen': 'Last seen',
  'mapping.detail.heldScans': 'Held scans',
  'mapping.detail.face': 'Face',
  'mapping.detail.fingerprint': 'Fingerprint',
  'mapping.detail.card': 'Card',
  /*
   * Two reasons, and both are needed: the name is editable at the keypad, and names are not unique
   * across five thousand people. The consequence sentence is what stops somebody matching on it.
   */
  'mapping.detail.nameWarning':
    'The name on the terminal is not used for matching. It can be edited at the keypad, and names are not unique across 5000 people — one wrong row credits somebody’s attendance to another person with no error raised anywhere.',

  'mapping.unconfirmed.none': 'No mappings awaiting confirmation',
  'mapping.unconfirmed.count': '{count} mappings awaiting confirmation',
  'mapping.unconfirmed.subtitle':
    'Matched because the terminal ID equals the Staff No. exactly. That is strong evidence, not proof.',
  'mapping.unconfirmed.empty': 'No mappings awaiting confirmation.',
  'mapping.unconfirmed.confirm': 'Confirm this mapping',
  'mapping.unconfirmed.error': 'Confirmation failed',
  'mapping.unconfirmed.warning':
    'Only confirm after establishing that it is the right person. Once confirmed, missed past scans are regenerated into punches — so a wrong mapping writes somebody else’s attendance history.',

  'mapping.dialog.title': 'Map a terminal ID',
  'mapping.dialog.description': '{device} · ID {employeeNo}',
  'mapping.dialog.description.named':
    '{device} · ID {employeeNo} · name on the terminal “{name}”',
  'mapping.dialog.search': 'Search staff',
  'mapping.dialog.search.placeholder': 'Name, Staff No. or NRIC',
  'mapping.dialog.searching': 'Searching…',
  'mapping.dialog.noMatch': 'No staff match.',
  'mapping.dialog.clash': 'already ID {employeeNo}',
  'mapping.dialog.note':
    'Mapping this ID regenerates punches for missed past scans, so the attendance history is restored too.',
  'mapping.dialog.searchError': 'Search failed',
  'mapping.dialog.error': 'Mapping failed',
  'mapping.dialog.done': '{name} mapped to ID {employeeNo}. {note}',
  'mapping.confirmed.backfilled':
    '{count} past scans have been regenerated. Run an attendance recompute for the affected date range.',
  'mapping.confirmed.nothingToBackfill': 'No past scans to regenerate.',
  'mapping.unconfirmed.done': '{name}: {note}',

  // ---------------------------------------------------------------------------
  // Bulk import
  // ---------------------------------------------------------------------------
  'import.title': 'Bulk Import',
  'import.subtitle':
    'Create staff records from a CSV file. The preview validates every row before anything is written.',
  'import.step1': '1. Upload the file',
  /*
   * These are the header spellings the parser actually accepts, not a loose description.
   *
   * `COLUMN_ALIASES` in `apps/server/src/staff/import.ts` was Malay-first and knew `employeeno` but
   * not `Staff No.`; the English aliases were added so this sentence is true. If a name here changes,
   * that map has to change with it.
   */
  'import.step1.subtitle':
    'Recognised columns: Staff No., Name, NRIC, Phone, Email, Department, Location, PIN. Only Staff No. and Name are required.',
  'import.pick': 'Choose a CSV file',
  'import.template': 'Download the template',
  // The example name is a real Malaysian naming pattern and stays as it is.
  'import.commas':
    'Names containing a comma need quoting. This parser handles them because Malaysian names often contain one — “Ali bin Abu, Dr” would break under a plain separator.',
  'import.error.read': 'Could not read the file',
  'import.error.status': 'Failed ({status})',
  'import.error.start': 'Could not start the import',

  'import.preview.title': 'Preview result',
  'import.preview.subtitle': 'Nothing is written at this stage.',
  'import.stat.linesRead': 'Lines read',
  'import.stat.valid': 'Valid',
  'import.stat.errors': 'Errors',
  'import.stat.existing': 'Already exist',
  'import.stat.existing.hint': 'will be skipped',
  'import.problems.title': '{count} errors need fixing',
  'import.problems.subtitle':
    'Nothing is written until every error is fixed. The line numbers match what Excel shows.',
  'import.problems.caption': 'Errors in the import file',
  'import.problems.column.line': 'Line',
  'import.problems.column.employeeNo': 'Staff No.',
  'import.problems.column.field': 'Field',
  'import.problems.column.message': 'Problem',
  'import.problems.capped': 'Showing the first 200 errors of {total}.',
  'import.newRefs': 'The following departments and locations will be created automatically:',
  'import.newRefs.departments': 'Departments: {names}',
  'import.newRefs.locations': 'Locations: {names}',

  'import.step2': '2. Choose terminals and start',
  'import.step2.subtitle':
    'Can be skipped. Staff will be created in the directory but cannot scan until they are assigned to a terminal and have a face enrolled.',
  'import.devices': 'Enrol to terminals',
  'import.commit': 'Import {count} staff',
  'import.allExisting': 'Every row in the file already exists in the directory.',

  'import.step3': '3. Progress',
  'import.step3.subtitle':
    'The import runs in the background and is safe to repeat — existing rows are skipped, not overwritten.',
  'import.status.running': 'Running',
  'import.status.done': 'Finished',
  'import.status.failed': 'Failed',
  'import.progress.aria': 'Import progress',
  'import.stat.created': 'Created',
  'import.stat.skipped': 'Skipped',
  'import.stat.pushed': 'To terminals',
  'import.stat.pushFailed': 'Failed to terminals',
  'import.failures.heading': 'Staff created but not yet on the terminals',
  'import.failures.hint':
    'Use the resync button on the staff record once the terminal can be reached.',
  'import.done':
    'Import finished. Next step: enrol faces on the Biometric Enrolment screen — the staff created cannot scan until then.',
};

/** Batch 4a: shifts and working-hour patterns, leave applications and leave types. */
export const EN_LABELS_SCHEDULE: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // Working-hour patterns
  // ---------------------------------------------------------------------------
  'shifts.title': 'Shifts & Working Hours',
  'shifts.subtitle':
    'A working-hour pattern decides when somebody is supposed to be at work. A shift gives that pattern a code to use on the calendar.',
  'shifts.tabs.aria': 'Schedule definitions',
  'shifts.tab.patterns': 'Working-Hour Patterns',
  'shifts.tab.shifts': 'Shifts',

  'shifts.pattern.count': '{count} working-hour patterns',
  'shifts.pattern.subtitle':
    '{overnight} cross midnight. Each pattern can hold several time blocks — needed for split shifts.',
  'shifts.pattern.add': 'Add Pattern',
  'shifts.pattern.search': 'Search pattern name…',
  'shifts.pattern.empty': 'No working-hour patterns yet.',
  'shifts.pattern.error.load': 'Could not load patterns',
  'shifts.pattern.removed': 'Pattern “{name}” removed.',
  'shifts.pattern.saved': 'Pattern “{name}” saved.',
  /*
   * The consequence clause is the one that matters: an overlap makes the answer depend on processing
   * order, which is not something an operator can reason about from the screen.
   */
  'shifts.pattern.graceNote':
    'The tolerance window decides how early or late a scan still counts for that block. Windows cannot overlap between blocks — if they do, one scan can satisfy two blocks and the choice depends on processing order rather than on anything an operator could reason about.',
  'shifts.pattern.column.name': 'Name',
  'shifts.pattern.column.kind': 'Kind',
  'shifts.pattern.column.blocks': 'Time blocks',
  'shifts.pattern.column.dailyHours': 'Hours per day',
  'shifts.pattern.column.staff': 'Staff',
  'shifts.pattern.column.shifts': 'Shifts',
  'shifts.pattern.overnight': 'overnight',
  'shifts.pattern.inactive': 'inactive',
  'shifts.pattern.row.edit': 'Update pattern',
  'shifts.pattern.row.remove': 'Remove pattern',
  'shifts.pattern.row.locked': '{staff} staff and {shifts} shifts still reference it',
  'shifts.pattern.row.expand': 'pattern detail',

  'shifts.block.column.block': 'Block',
  'shifts.block.column.start': 'Start',
  'shifts.block.column.end': 'End',
  'shifts.block.column.break': 'Break',
  'shifts.block.column.graceBefore': 'Tolerance before',
  'shifts.block.column.graceAfter': 'Tolerance after',
  'shifts.block.nextDay': '+1 day',

  'shifts.pattern.detail.dailyHours': 'Hours per day',
  'shifts.pattern.detail.staffUsing': 'Staff using it',
  'shifts.pattern.detail.shiftsUsing': 'Shifts referencing it',
  // The times stay as digits; the rule is that the night is filed against the day it starts.
  'shifts.pattern.detail.overnight':
    'This pattern crosses midnight. A 22:00–07:00 shift is filed against the work date it starts on, not the date it ends — otherwise one night of work would split across two days in every report.',
  'shifts.pattern.remove.title': 'Remove pattern “{name}”?',
  'shifts.pattern.remove.body': 'No staff or shifts reference it, so it is safe to remove.',
  'shifts.pattern.dialog.edit': 'Update working-hour pattern',
  'shifts.pattern.dialog.create': 'Add working-hour pattern',
  'shifts.pattern.dialog.description': 'Time blocks decide what attendance is measured against.',
  'shifts.pattern.dialog.blocks': 'Time blocks',
  'shifts.pattern.dialog.blockLabel': 'Block {order}',
  'shifts.pattern.dialog.removeBlock': 'Remove block {order}',
  'shifts.pattern.dialog.break': 'Break (min)',
  'shifts.pattern.dialog.endsNextDay': 'Ends the next day',
  'shifts.pattern.dialog.graceBefore': 'Tolerance before the start (min)',
  'shifts.pattern.dialog.graceAfter': 'Tolerance after the end (min)',
  'shifts.pattern.dialog.addBlock': 'Add block',
  'shifts.pattern.dialog.overlapWarning':
    'Tolerance windows cannot overlap between blocks. If they do, one scan can satisfy two blocks and the choice becomes dependent on processing order. The server will refuse it.',
  'shifts.pattern.blocksChanged':
    'The time blocks changed. Run an attendance recompute for the affected dates so older records reflect the new rule.',

  // ---------------------------------------------------------------------------
  // Shifts
  // ---------------------------------------------------------------------------
  'shifts.shift.count': '{count} shifts',
  'shifts.shift.subtitle':
    'The short codes used on the work calendar. Each one references a working-hour pattern.',
  'shifts.shift.add': 'Add Shift',
  'shifts.shift.search': 'Search shift code or name…',
  'shifts.shift.empty': 'No shifts yet.',
  'shifts.shift.error.load': 'Could not load shifts',
  'shifts.shift.removed': 'Shift “{code}” removed.',
  'shifts.shift.saved': 'Shift “{code}” saved.',
  'shifts.shift.needPattern':
    'Create a working-hour pattern first — a shift references a pattern to know its hours, so it cannot exist without one.',
  'shifts.shift.column.code': 'Code',
  'shifts.shift.column.name': 'Name',
  'shifts.shift.column.pattern': 'Working-hour pattern',
  'shifts.shift.column.hours': 'Hours',
  'shifts.shift.column.rosterDays': 'Days scheduled',
  'shifts.shift.row.edit': 'Update shift',
  'shifts.shift.row.remove': 'Remove shift',
  'shifts.shift.row.locked': '{count} calendar days still use it',
  'shifts.shift.row.expand': 'shift detail',
  // A yes/no answer, kept apart from the Active/Inactive badge: the register is different.
  'shifts.shift.detail.active': 'Active',
  'shifts.shift.detail.active.yes': 'Yes',
  'shifts.shift.detail.active.no': 'No',
  'shifts.shift.remove.title': 'Remove shift “{code}”?',
  'shifts.shift.remove.body': 'No calendar days use it, so it is safe to remove.',
  'shifts.shift.dialog.edit': 'Update shift',
  'shifts.shift.dialog.create': 'Add shift',
  'shifts.shift.dialog.description': 'The short code and colour that appear on the work calendar.',
  // Example codes. Short enough to stay as they are in either language.
  'shifts.shift.dialog.code.hint': 'e.g. P, M, N',
  'shifts.shift.dialog.colour': 'Colour',

  // ---------------------------------------------------------------------------
  // Leave applications
  // ---------------------------------------------------------------------------
  'leave.title': 'Leave Applications',
  'leave.subtitle':
    'Approval writes the leave days to the work calendar and recomputes attendance — without that, somebody whose leave was approved is still reported absent.',
  'leave.tab.types': 'Leave Types',

  'leave.request.none': 'No applications awaiting a decision',
  'leave.request.pending': '{count} awaiting a decision',
  /*
   * "surfaces as a complaint, not as a bug" is the whole sentence's purpose — it says why this rule
   * is worth having rather than what the rule is.
   */
  'leave.request.subtitle':
    'Rest days and public holidays do not count against the entitlement — charging annual leave for a Sunday is the kind of error that surfaces as a complaint, not as a bug.',
  'leave.request.add': 'New Application',
  'leave.request.search': 'Search name, staff no. or reason…',
  'leave.request.empty': 'No applications match these filters.',
  'leave.request.error.load': 'Could not load applications',
  'leave.filter.allTypes': 'All leave types',
  'leave.column.staff': 'Staff',
  'leave.column.type': 'Leave type',
  'leave.column.period': 'Period',
  'leave.column.days': 'Days',
  'leave.column.status': 'Status',
  'leave.column.appliedAt': 'Applied',
  'leave.row.unpaid': 'unpaid',
  'leave.row.approve': 'Approve — writes the leave days to the calendar',
  'leave.row.reject': 'Reject with a reason',
  'leave.row.cancelApproved': 'Cancel — removes the leave days from the calendar',
  'leave.row.cancelPending': 'Cancel the application',
  'leave.row.expand': 'application detail',
  'leave.detail.paid': 'Paid',
  'leave.detail.paid.yes': 'Yes',
  'leave.detail.paid.no': 'No',
  'leave.detail.period': '{from} to {to}',
  'leave.detail.workingDays': 'Working days charged',
  'leave.detail.decidedAt': 'Decided',
  'leave.detail.decidedAt.pending': 'Not yet',
  'leave.detail.requestId': 'Application ID',
  'leave.detail.reasonHeading': 'Reason given',
  'leave.detail.decisionNote': 'Decision note: {note}',
  'leave.detail.notRestored': 'is not',
  // `{emphasis}` carries the phrase above, already wrapped in a <strong>.
  'leave.detail.replacedRoster':
    'This approval replaced a shift already on the calendar. If the application is cancelled, the original shift {emphasis} restored — the calendar keeps no history of what was replaced.',

  'leave.new.title': 'New leave application',
  'leave.new.description':
    'Choose the staff member, the leave type and the period. Working days are counted automatically.',
  'leave.new.searchStaff': 'Search staff',
  'leave.new.searchStaff.placeholder': 'Name or staff no.',
  'leave.new.searching': 'Searching',
  'leave.new.noMatch': 'No staff match.',
  'leave.new.change': 'Change',
  'leave.new.type': 'Leave type',
  'leave.new.type.annual': '{code} — {name} ({days} days/year)',
  'leave.new.type.unlimited': '{code} — {name} (no limit)',
  // Leading space and separator are deliberate: this clause is appended to the option above.
  'leave.new.type.unpaidSuffix': ' · unpaid',
  'leave.new.noBackdated': 'This type cannot be applied for against a date that has already passed.',
  'leave.new.reason': 'Reason (optional)',
  'leave.new.reason.placeholder': 'Context for whoever approves it',
  'leave.new.submit': 'Record the application',
  'leave.new.error': 'Could not record the application',
  'leave.new.saved': '{days}-day application for {name} recorded ({status}).',
  'leave.new.saved.applied':
    '{days}-day application for {name} recorded ({status}) — {roster} calendar days written and attendance recomputed.',

  'leave.quote.workingDays': 'Working days',
  'leave.quote.restDays': 'Rest days skipped',
  'leave.quote.holidays': 'Public holidays skipped',
  'leave.quote.entitlement': 'Entitlement',
  'leave.quote.unlimited': 'No limit',
  'leave.quote.perYear': '{days} days/year',
  'leave.quote.taken': 'Already taken',
  'leave.quote.remaining': 'Remaining after this',
  'leave.quote.noWorkingDays':
    'This range has no working days — it is all rest days or public holidays. There is nothing to apply for.',
  'leave.quote.overlap':
    'There is already a {status} application overlapping this period. Two applications over the same day write the same calendar row, and the second will overwrite the first without warning.',
  'leave.quote.wouldExceed':
    'This exceeds the annual entitlement. It can still be recorded — some organisations allow it as an advance — but the balance will go negative.',
  'leave.quote.backdated':
    'The start date has passed and this leave type does not allow backdated applications.',

  'leave.decision.approve.title': 'Approve a leave application',
  'leave.decision.reject.title': 'Reject a leave application',
  'leave.decision.description': '{name} · {code} · {days} days',
  'leave.decision.applicantReason': 'Applicant’s reason: {reason}',
  'leave.decision.approveWarning':
    'Approving writes {days} leave days to the work calendar and recomputes attendance for that period. Shifts already set on those days will be replaced.',
  'leave.decision.rejectWarning':
    'A rejection requires a written reason. Without one the applicant has nothing to act on, and a later dispute has nothing to refer to.',
  'leave.decision.note.approve': 'Note (optional)',
  'leave.decision.note.reject': 'Reason for rejection',
  'leave.decision.note.approve.placeholder': 'Context for the record',
  'leave.decision.note.reject.placeholder': 'Required — what the applicant needs to know',
  'leave.decision.submit.approve': 'Approve',
  'leave.decision.submit.reject': 'Reject',
  'leave.decision.error': 'Could not save the decision',
  'leave.decision.rejected': '{name}’s application rejected.',
  'leave.decision.approved': '{name}’s leave approved — {roster} days written to the calendar',
  // Mid-sentence clauses, appended to the line above. The leading comma is part of each.
  'leave.decision.approved.replaced': ', {count} shifts replaced',
  'leave.decision.approved.skipped': ', {count} rest days/public holidays skipped',
  'leave.decision.approved.recomputed': ', {count} attendance records recomputed.',

  'leave.cancel.title': 'Cancel a leave application',
  'leave.cancel.notRestored': 'is not restored',
  // `{emphasis}` carries the phrase above, already wrapped in a <strong>.
  'leave.cancel.approvedWarning':
    'The leave days will be removed from the calendar and attendance recomputed. The shift that was there before approval {emphasis} — the calendar keeps no history of what was replaced, so set the shift again by hand if it is needed.',
  'leave.cancel.pendingNote':
    'This application has not been approved, so there is nothing on the calendar to remove.',
  'leave.cancel.note': 'Reason (optional)',
  'leave.cancel.submit': 'Cancel the application',
  'leave.cancel.error': 'Could not cancel',
  'leave.cancel.done': '{name}’s application cancelled.',
  'leave.cancel.done.removed':
    '{name}’s application cancelled — {count} leave days removed from the calendar and attendance recomputed.',

  // ---------------------------------------------------------------------------
  // Leave types
  // ---------------------------------------------------------------------------
  'leave.type.count': '{count} leave types',
  'leave.type.subtitle':
    'The seeded entitlements are the statutory minimum as a starting point, not policy — every organisation adjusts them.',
  'leave.type.add': 'Add Type',
  'leave.type.search': 'Search code or name…',
  'leave.type.empty': 'No leave types yet.',
  'leave.type.error.load': 'Could not load leave types',
  'leave.type.removed': 'Leave type “{code}” removed.',
  'leave.type.saved': 'Leave type “{code}” saved.',
  'leave.type.column.code': 'Code',
  'leave.type.column.name': 'Name',
  'leave.type.column.entitlement': 'Entitlement',
  'leave.type.column.paid': 'Paid',
  'leave.type.column.backdated': 'Backdated',
  'leave.type.column.approval': 'Needs approval',
  'leave.type.unlimited': 'no limit',
  'leave.type.days': '{days} days',
  /*
   * `leave.type.yes`/`no`/`allowed`/`autoApprove` and `leave.type.inactive` were here.
   *
   * They were words in cells. The column now renders a `BoolMark` or a `Badge`, so the wording moved to
   * the keys that name what is being answered — `leave.type.paid.no` is 'Unpaid', not 'no'. The status
   * column reads `app.status.inactive` like every other screen, because the idiom rendering it became
   * the same one.
   */
  'leave.type.row.edit': 'Update leave type',
  'leave.type.row.remove': 'Remove leave type',
  'leave.type.row.locked': '{count} applications use it — deactivate it instead',
  /*
   * `leave.type.backdatedNote` was here — a banner under the table explaining why sick and emergency
   * leave allow past dates. It repeated the checkbox hint inside the dialog, which is where the
   * decision is actually made, so the key was dropped rather than translated twice.
   */
  'leave.type.dialog.edit': 'Update leave type',
  'leave.type.dialog.create': 'Add leave type',
  // Malaysian leave codes in common use. They stay as they are.
  'leave.type.dialog.code.hint': 'e.g. AL, MC, EL',
  'leave.type.dialog.annualDays': 'Entitlement per year (days)',
  'leave.type.dialog.annualDays.hint':
    'Zero means no limit — the balance is not the control for that category, as with unpaid leave.',
  'leave.type.dialog.paid': 'Paid leave',
  'leave.type.dialog.paid.hint':
    'An unpaid day still clears the absent status, but payroll needs to be able to tell them apart.',
  'leave.type.dialog.backdated': 'Allow backdated applications',
  'leave.type.dialog.backdated.hint':
    'Needed for sick and emergency leave — both are filed after the fact.',
  'leave.type.dialog.approval': 'Requires approval',
  'leave.type.dialog.approval.hint':
    'When off, an application is approved immediately and the calendar is written at the moment it is recorded.',
};

/** Batch 4b: overtime, claims and expenses. */
export const EN_LABELS_REQUESTS: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // Overtime
  // ---------------------------------------------------------------------------
  /*
   * The second sentence is the design, stated to the person using the screen: the reviewer is not
   * being asked to verify that the overtime happened. The engine already measured that.
   */
  'overtime.title': 'Overtime Applications',
  'overtime.subtitle':
    'The hours come from scans the attendance engine already measured, not from a typed number. The question a reviewer answers is whether it was authorised, not whether it happened.',
  'overtime.tab.requests': 'Applications',
  'overtime.tab.rates': 'Rates',

  // Malaysian statutory day categories. "Public holiday" is the official English term.
  'overtime.dayType.weekday': 'Ordinary working day',
  'overtime.dayType.restDay': 'Rest day',
  'overtime.dayType.holiday': 'Public holiday',
  'overtime.dayType.holidayRestDay': 'Public holiday falling on a rest day',

  'overtime.status.pending': 'Pending',
  'overtime.status.approved': 'Approved',
  'overtime.status.rejected': 'Rejected',
  // Withdrawn by the applicant, not cancelled by an administrator.
  'overtime.status.cancelled': 'Withdrawn',

  'overtime.column.requestNo': 'Application No.',
  'overtime.column.staff': 'Staff',
  'overtime.column.workDate': 'Work Date',
  'overtime.column.dayType': 'Day Type',
  'overtime.column.hours': 'Hours',
  'overtime.column.rate': 'Rate',
  'overtime.column.amount': 'Amount',
  'overtime.hours.claimed': '{claimed} of {measured}',
  'overtime.hours.measuredNote': 'Measured from scans: {hours} hours',
  'overtime.empty': 'No overtime applications in this range.',
  'overtime.error.load': 'Could not load the overtime application list.',
  'overtime.action.new': 'Record Overtime',
  'overtime.action.cancel': 'Withdraw',
  'overtime.action.view': 'View',
  'overtime.note.notPaid':
    'Approved does not mean paid. Nothing in this system pays anybody yet, so payment is recorded elsewhere and a payroll period will consume the approved applications when it is built.',
  /*
   * The statutory instrument keeps its official English title so it can be looked up. The second
   * sentence is the reason pending applications count against the cap.
   */
  'overtime.note.cap':
    'Overtime is capped at 104 hours a month under the Employment (Limitation of Overtime Work) Regulations 1980. Pending applications count against that cap, otherwise a dozen separate applications would each clear it one at a time.',

  'overtime.new.title': 'Record Overtime',
  'overtime.new.description':
    'Choose the staff member and the date first. The claimable hours come from what the engine measured for that day.',
  'overtime.new.staff': 'Staff',
  'overtime.new.staffPlaceholder': 'Search name or staff no.',
  'overtime.new.workDate': 'Work date',
  'overtime.new.minutes': 'Minutes claimed',
  'overtime.new.minutesHint':
    'May be less than measured when only part of it was authorised. It cannot be more.',
  'overtime.new.task': 'Task or project',
  'overtime.new.reason': 'Reason',
  'overtime.new.submit': 'Submit',

  'overtime.quote.heading': 'That day',
  'overtime.quote.measured': 'Measured from scans',
  'overtime.quote.hourlyRate': 'Hourly rate',
  'overtime.quote.hourlyRateHint': 'Monthly salary ÷ 26 ÷ 8, per s.60I of the Employment Act 1955.',
  'overtime.quote.multiplier': 'Multiplier',
  'overtime.quote.estimate': 'Estimate',
  'overtime.quote.estimateHint': 'An estimate only. The reviewer is who confirms the rate.',
  'overtime.quote.monthUsed': 'This month',
  'overtime.quote.monthUsedValue': '{used} of {cap} hours',
  'overtime.quote.noneMeasured':
    'No overtime was measured on that date, so there is nothing to claim.',
  'overtime.quote.noSalary':
    'This staff member has no monthly salary recorded. The hourly rate is derived from it, so the application cannot be priced.',
  'overtime.quote.statutoryFloor':
    'No rate is configured for that day type, so the statutory minimum is being used for now.',
  'overtime.quote.holiday': 'Public holiday: {name}',

  'overtime.decide.title': 'Decide {requestNo}',
  'overtime.decide.description':
    'Approving sets the amount payable, because approving is when the rate is chosen.',
  'overtime.decide.ratePlaceholder': 'Choose a rate',
  'overtime.decide.note': 'Note',
  'overtime.decide.noteRequired': 'A rejection requires a written reason.',
  'overtime.decide.approve': 'Approve',
  'overtime.decide.reject': 'Reject',
  'overtime.decide.willPay': 'Will pay: {amount}',
  'overtime.decide.mismatch':
    'The rate chosen is not for that day type. It is allowed, but it should be deliberate.',

  'overtime.rates.title': 'Overtime Rates',
  /*
   * "silently pay a public holiday at the weekday rate" is the failure this paragraph exists to
   * prevent, and it has to survive translation intact.
   */
  'overtime.rates.subtitle':
    'One rate per day type gives a default answer. The day type is not decoration — rates are looked up by it, so a rate with the wrong day type will silently pay a public holiday at the ordinary rate.',
  'overtime.rates.column.code': 'Code',
  'overtime.rates.column.name': 'Name',
  'overtime.rates.column.dayType': 'Day Type',
  'overtime.rates.column.multiplier': 'Multiplier',
  'overtime.rates.column.used': 'Used',
  'overtime.rates.default': 'Default',
  'overtime.rates.empty': 'No rates configured.',
  'overtime.rates.shortfall': '{actual}× below the {floor}× minimum',
  /*
   * The reasoning is deliberate and unusual, so it is kept whole: an organisation genuinely
   * underpaying must be able to record what it pays, because a screen that refuses is how the
   * shortfall reaches the payslip unrecorded.
   */
  'overtime.rates.shortfallNote':
    'A rate below the Employment Act minimum is stated rather than blocked. An organisation that genuinely pays less must be able to record what it pays — a screen that stays silent is how that shortfall reaches the payslip.',
  'overtime.rates.action.new': 'Add Rate',
  'overtime.rates.form.title': 'Overtime Rate',
  'overtime.rates.form.code': 'Code',
  'overtime.rates.form.name': 'Name',
  'overtime.rates.form.description': 'Description',
  'overtime.rates.form.dayType': 'Day type',
  'overtime.rates.form.multiplier': 'Multiplier',
  'overtime.rates.form.isDefault': 'Default rate for this day type',
  'overtime.rates.form.active': 'Active',
  'overtime.rates.form.floorHint': 'The statutory minimum for this day type is {floor}×.',

  // ---------------------------------------------------------------------------
  // Claims
  // ---------------------------------------------------------------------------
  'claim.title': 'Claim Applications',
  'claim.subtitle':
    'A rated category computes its own total from a quantity — the rate is the control. A flat category takes the figure from the receipt.',
  'claim.tab.requests': 'Claims',
  'claim.tab.types': 'Claim Types',
  'claim.status.pending': 'Pending',
  'claim.status.approved': 'Approved',
  'claim.status.rejected': 'Rejected',
  'claim.status.cancelled': 'Withdrawn',
  'claim.column.requestNo': 'Claim No.',
  'claim.column.staff': 'Staff',
  'claim.column.type': 'Type',
  'claim.column.incurredOn': 'Date Incurred',
  'claim.column.amount': 'Claimed',
  'claim.column.approved': 'Approved',
  'claim.column.receipt': 'Receipt',
  'claim.empty': 'No claims in this range.',
  'claim.error.load': 'Could not load the claim list.',
  'claim.action.new': 'Record Claim',
  'claim.action.view': 'View',
  'claim.action.cancel': 'Withdraw',
  'claim.receipt.present': 'Attached',
  'claim.receipt.missing': 'None',
  /*
   * `claim.receipt.required` was here — an amber badge reading 'Required' in the claim-types Receipt
   * column. Now that a receipt is demanded per line, that column carries `claim.types.receipt.yes`,
   * which states the rule in full: 'A receipt is required on every line'.
   */
  'claim.receipt.open': 'Open the receipt',
  'claim.receipt.upload': 'Upload a receipt',
  'claim.receipt.remove': 'Remove the receipt',
  'claim.receipt.hint':
    'PDF, PNG, JPEG or WEBP, maximum 4 MB. The file type is determined from its bytes, not from its name.',
  'claim.receipt.locked':
    'A receipt cannot be changed after a decision — it is the evidence the decision was made against.',
  'claim.receipt.uploaded': 'Receipt uploaded.',
  /*
   * The second half explains the two-step flow: file first, attach after. A failed upload must not
   * discard everything already typed.
   */
  'claim.note.receipt':
    'A category that requires a receipt cannot be approved without one. A claim can be filed first and the receipt attached afterwards — a failed upload should not discard everything already typed.',
  'claim.note.notPaid': 'Approved does not mean paid. Nothing in this system pays anybody yet.',

  'claim.new.title': 'Record Claim',
  'claim.new.description':
    'Choose the type first — a rated category asks for a quantity, not an amount.',
  'claim.new.staff': 'Staff (ID)',
  'claim.new.type': 'Claim type',
  'claim.new.incurredOn': 'Date the cost was incurred',
  'claim.new.quantity': 'Quantity ({unit})',
  'claim.new.quantity.hint': 'Computed total: {amount}',
  'claim.new.amount': 'Amount (RM)',
  'claim.new.submit': 'Submit',
  'claim.new.cap': 'Cap for this category: {cap}',
  'claim.new.detail': 'Description',
  'claim.new.receiptNext':
    'After submitting, attach the receipt to that claim row. Without a receipt it cannot be approved.',

  'claim.decide.title': 'Decide {requestNo}',
  'claim.decide.description':
    'It can be approved at a lower amount — a receipt above the category cap is approved at the cap.',
  'claim.decide.claimed': 'Claimed',
  'claim.decide.approvedAmount': 'Amount approved (RM)',
  'claim.decide.approvedAmount.hint':
    'Leave it unchanged to approve in full. A lower figure means part of it was not allowed, and the note should say why.',
  'claim.decide.note': 'Note',
  'claim.decide.noteRequired': 'A rejection requires a written reason.',
  'claim.decide.approve': 'Approve',
  'claim.decide.reject': 'Reject',
  'claim.decide.noReceipt':
    'This category requires a receipt and none is attached. The approval will be refused.',

  /*
   * `claim.types.title` was here. The section heading is the count now — `claim.types.count`, '9 claim
   * types' — because a heading that repeats the name of the tab above it spends a line saying nothing,
   * and the figure it displaced had been sitting in a note underneath.
   */
  'claim.types.subtitle':
    'A per-unit rate is what makes a category rated: the applicant enters a quantity and the server computes the total. Leave it blank for categories that take the figure from the receipt.',
  'claim.types.column.code': 'Code',
  'claim.types.column.name': 'Name',
  'claim.types.column.rate': 'Rate',
  'claim.types.column.cap': 'Cap',
  'claim.types.column.receipt': 'Receipt',
  'claim.types.column.used': 'Used',
  'claim.types.flat': 'Flat',
  'claim.types.empty': 'No claim types configured.',
  'claim.types.action.new': 'Add Type',
  'claim.types.form.title': 'Claim Type',
  'claim.types.form.code': 'Code',
  'claim.types.form.name': 'Name',
  'claim.types.form.description': 'Description',
  'claim.types.form.rate': 'Rate per unit (RM)',
  'claim.types.form.rate.hint': 'Leave blank for a flat category.',
  'claim.types.form.unit': 'Unit name',
  'claim.types.form.unit.hint': 'km, days, nights. Required when a rate is set.',
  'claim.types.form.cap': 'Cap per claim (RM)',
  'claim.types.form.cap.hint': 'Leave blank for no cap.',
  'claim.types.form.requiresReceipt': 'Requires a receipt',
  'claim.types.form.active': 'Active',

  // ---------------------------------------------------------------------------
  // Expenses
  // ---------------------------------------------------------------------------
  'expense.title': 'Expense Applications',
  'expense.subtitle':
    'Money staff paid out of pocket and are claiming back. There are no rates here — the receipt is the basis for the amount, so it is never optional.',
  'expense.tab.requests': 'Expenses',
  'expense.tab.categories': 'Categories',
  'expense.column.requestNo': 'Application No.',
  'expense.column.payee': 'Paid To',
  'expense.column.category': 'Category',
  'expense.empty': 'No expense applications in this range.',
  'expense.error.load': 'Could not load the expense list.',
  'expense.action.new': 'Record Expense',
  'expense.note.receipt':
    'An expense cannot be approved without a receipt. It can be filed first and the receipt attached afterwards — a failed upload should not discard everything already typed.',
  'expense.new.title': 'Record Expense',
  'expense.new.description':
    'The amount comes from the receipt. Attach the receipt after submitting.',
  'expense.new.category': 'Category',
  'expense.new.payee': 'Paid to',
  'expense.new.payee.hint':
    'A receipt with no payee named is hard to check against a bank statement.',
  'expense.decide.noReceipt':
    'No receipt is attached. An expense cannot be approved without one — the receipt is the basis for the amount.',
  'expense.categories.title': 'Expense Categories',
  'expense.categories.subtitle':
    'A per-application cap only. No rates — an expense category classifies a cost, it does not price it.',
  'expense.categories.empty': 'No categories configured.',
  'expense.categories.action.new': 'Add Category',
  'expense.categories.form.title': 'Expense Category',
};

/** Batch 5a: the permission catalogue and the self-service profile. */
export const EN_LABELS_PERMISSIONS: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // Permission screen names
  //
  // These are read inside the role matrix, where the prefix before the colon is the page and the part
  // after it is the tab. Keeping that shape is what lets forty rows be scanned by section.
  // ---------------------------------------------------------------------------
  'perm.screen.dashboard': 'Dashboard',
  'perm.screen.staff.departments': 'Departments',
  'perm.screen.staff.locations': 'Locations',
  'perm.screen.schedule.workPatterns': 'Working-Hour Patterns',
  'perm.screen.schedule.shifts': 'Shifts',
  'perm.screen.settings.general': 'General Configuration: General',
  'perm.screen.settings.translation': 'General Configuration: Translation',
  'perm.screen.settings.backup': 'General Configuration: Backup & Restore',
  'perm.screen.settings.maintenance': 'General Configuration: Maintenance & Cache',
  'perm.screen.settings.integration.email': 'Integrations: Email',
  'perm.screen.settings.integration.sms': 'Integrations: SMS',
  'perm.screen.settings.integration.telegram': 'Integrations: Telegram',
  'perm.screen.settings.integration.api': 'Integrations: API & Webhooks',
  'perm.screen.settings.integration.holidays': 'Integrations: Public Holidays',
  'perm.screen.settings.security': 'Security',
  'perm.screen.settings.users.admin': 'User Management: Administrators',
  'perm.screen.settings.users.staff': 'User Management: Staff',
  'perm.screen.settings.users.apps': 'User Management: Apps',
  'perm.screen.settings.logs.activity': 'Logs: Activity',
  'perm.screen.settings.logs.audit': 'Logs: Audit',

  // ---------------------------------------------------------------------------
  // Custom permission actions
  //
  // Each note says what the grant lets somebody do, in the terms of the consequence rather than the
  // mechanism. A matrix of forty screens is ticked quickly, and the note is the only thing slowing a
  // tick that should not be made.
  // ---------------------------------------------------------------------------
  'perm.action.resync': 'Sync Terminal',
  'perm.action.resync.note': 'Push the staff record to the terminals again',
  'perm.action.import': 'Import Users',
  'perm.action.import.note': 'Pull the user list from a terminal',
  'perm.action.template': 'Download Template',
  'perm.action.download': 'Download',
  'perm.action.download.note': 'The dump file contains every attendance record',
  'perm.action.recompute': 'Recompute',
  'perm.action.recompute.note': 'Rebuild attendance records from the raw log',
  'perm.action.purge': 'Purge Aged Data',
  'perm.action.purge.note':
    'Deletes scan logs past the retention period. Cannot be undone.',
  'perm.action.maintenanceMode': 'Maintenance Mode',
  'perm.action.maintenanceMode.note':
    'Refuses every operator request. Terminal pushes are still accepted.',
  'perm.action.clearCache': 'Clear Cache',
  'perm.action.clearCache.note':
    'Forces the configuration to be re-read and the terminal clients to shake hands again',
  'perm.action.test.connection': 'Test Connection',
  'perm.action.sync.push': 'Sync & Push',
  'perm.action.clock': 'Set Clock',
  'perm.action.clock.note': 'A wrong clock corrupts every record after it',
  'perm.action.test.email': 'Send Test',
  'perm.action.test': 'Test',
  'perm.action.test.webhook': 'Send Test Webhook',
  'perm.action.sync': 'Sync',
  'perm.action.reset': 'Reset Password',
  'perm.action.unbind': 'Unbind Device',
  'perm.action.rotate': 'Rotate Secret',
  'perm.action.terminalConfig': 'Terminal Settings',
  'perm.action.terminalConfig.note':
    'Verification mode, door-open duration, and opening a door remotely — separate from Edit',
  'perm.action.configure': 'Module Settings',
  'perm.action.configure.note':
    'Types, approval chain and notifications — not the applications themselves',
  'perm.action.salary': 'Monthly Salary',
  'perm.action.salary.note':
    'Read and write salary. Separate from Edit — it prices every overtime claim.',

  // ---------------------------------------------------------------------------
  // Permission notes
  // ---------------------------------------------------------------------------
  'perm.note.attendance.records':
    'Records are generated by the engine, so there is no manual create or delete.',
  'perm.note.attendance.rawLog': 'Cannot be altered by anybody, including a Super Admin.',
  'perm.note.attendance.exceptions': 'Approve = mark resolved.',
  'perm.note.attendance.justifications':
    'Reasons are submitted by staff themselves through the mobile app, so there is no Create action. Approve = accept, reject, or send back.',
  'perm.note.staff.biometrics': 'A face is replaced, not edited — so there is no Edit action.',
  'perm.note.schedule.roster':
    'Setting a shift overwrites the same day, so it is Edit rather than Create.',
  'perm.note.schedule.leave':
    'Approval writes the leave days to the calendar and recomputes attendance.',
  'perm.note.reports.payroll':
    'This export becomes pay. It states the exceptions that are still unresolved.',
  'perm.note.settings.backup':
    'Restore is deliberately not here — it is a command run on the server.',
  'perm.note.settings.devices': 'A terminal cannot be removed — the scan history references it.',
  'perm.note.settings.integration.email':
    'Sending a test sends a real email through the configured relay.',
  'perm.note.settings.integration.api':
    'Creating a token means issuing a credential that can read staff data from outside the system.',
  'perm.note.settings.security': 'Login and password policy for the whole system.',
  'perm.note.settings.users.admin':
    'An administrator account can alter the attendance of thousands of people.',
  'perm.note.settings.users.apps': 'A client must be suspended before it can be removed.',
  'perm.note.settings.logs.audit': 'Append-only. There is no path to alter or remove an entry.',
  'perm.note.hr.overtime':
    'The hours come from scans the engine already measured, not from the number applied for.',
  'perm.note.hr.applicants':
    'Applicant data is an outsider’s data — deleting means deleting outright.',
  'perm.note.hr.claims':
    'Module Settings controls the claim types and their rates — that is what decides the price, separate from approving one claim.',
  'perm.note.hr.expenses':
    'An expense cannot be approved without a receipt — the receipt is the basis for the amount, not the category’s choice.',
  'perm.note.hr.kpiResults':
    'Results are a fact separate from the review that produced them.',
  'perm.note.hr.payrollPeriods':
    'A period consumes the Payroll Export; it does not count hours itself.',
  'perm.note.hr.loans':
    'Somebody’s outstanding debt — more restricted than the salary itself.',

  // ---------------------------------------------------------------------------
  // My Profile
  // ---------------------------------------------------------------------------
  'profile.title': 'My Profile',
  'profile.subtitle':
    'Your own details. What HR manages is shown but cannot be edited here.',
  'profile.error.load': 'Could not load the profile',
  'profile.saved': 'Profile updated.',
  'profile.header.subtitle': '{employeeNo} · {roleName}',
  'profile.twoFactor.on': '2FA ON',
  'profile.twoFactor.off': '2FA OFF',

  'profile.group.photo': 'Profile Photo',
  'profile.photo.label': 'Picture',
  'profile.photo.hint':
    'PNG, JPEG or WEBP up to {kilobytes} KB. The file type is determined from its first bytes, not its name.',
  'profile.photo.uploading': 'Uploading',
  'profile.photo.alt': 'Current profile photo',
  'profile.photo.replace': 'Replace the picture',
  'profile.photo.choose': 'Choose a picture',
  'profile.photo.size': '{kilobytes} KB',
  'profile.photo.tooLarge': 'The {size} KB file exceeds the {limit} KB limit.',
  'profile.photo.error.upload': 'Upload failed',
  'profile.photo.error.remove': 'Could not remove the photo',
  /*
   * Stated under the control because a file input holds a handle to something on disk rather than a
   * value in the form, and carrying it through a save that might fail on another field is how an
   * upload silently does not happen.
   */
  'profile.photo.savedImmediately':
    'Saved as soon as it is chosen, not by the save button below.',

  'profile.group.basic': 'Basic Information',
  'profile.group.basic.subtitle':
    'The phone number and email here are for being contacted, not for signing in.',
  'profile.position': 'Position',
  // A Malaysian public service grade. `U29` is the grade code and stays as it is.
  'profile.position.placeholder': 'e.g. Community Nurse U29',
  'profile.position.hint':
    'Typed in by hand. There is no picklist — the range of positions here is too wide for a list that would ever be complete.',
  'profile.phone': 'Phone no.',
  'profile.phone.hint': 'For SMS notifications if that channel is switched on.',
  'profile.contactEmail': 'Contact email',
  'profile.contactEmail.hint':
    'Optional, and separate from the login email. Changing it does not change how you sign in.',

  'profile.group.address': 'Address',
  'profile.group.address.subtitle': 'All typed in. No lists of states, cities or postcodes.',
  'profile.address1': 'Address line 1',
  'profile.address2': 'Address line 2',
  'profile.city': 'City',
  'profile.state': 'State',
  'profile.postcode': 'Postcode',
  'profile.country': 'Country',

  /*
   * Per-account language.
   *
   * The system default sets the language everybody opens in; this overrides it for one person.
   * Stored on the account rather than in `localStorage` so the choice follows the person to
   * every device.
   */
  'profile.group.language': 'Language',
  'profile.group.language.subtitle':
    'The language you read this interface in. Your own choice, not an organisation setting.',
  'profile.language': 'Interface language',
  'profile.language.hint':
    'Only languages that are already on offer are listed. A label that has not been translated is shown in Malay, so a screen is never blank.',
  'profile.language.followDefault': 'Follow the system default ({name})',
  'profile.language.followDefault.unknown': 'Follow the system default',
  // The em dash is the separator from the source, and stays.
  'profile.language.option.source': '{name} — source language',
  /*
   * The last clause is the reason this note exists.
   *
   * CSV headers and email bodies are written in the source wording because they are generated
   * with no reader whose language could be consulted — timers, cron, and files opened
   * elsewhere. Unstated, somebody who changes language and then opens an export reads the
   * translation as broken.
   */
  'profile.language.note':
    'Only your own screens change. Colleagues carry on seeing their own language, and {emphasis} — both are generated with no reader whose language could be consulted.',
  'profile.language.note.emphasis':
    'export file headers and notification emails do not change',
  'profile.language.appliesOnSave': 'Takes effect once you press save below.',
  'profile.language.onlyOne':
    'Only one language is on offer on this installation, so there is nothing to choose. Languages are added under Settings › General Configuration › Translation.',

  'profile.group.managed': 'Managed by HR',
  'profile.group.managed.subtitle': 'Contact HR if anything here is wrong.',
  'profile.group.managed.readOnly': 'read-only',
  'profile.managed.employeeNo': 'Employee no.',
  'profile.managed.fullName': 'Full name',
  'profile.managed.icNo': 'NRIC',
  'profile.managed.department': 'Department',
  'profile.managed.location': 'Location',
  'profile.managed.hireDate': 'Start date',
  'profile.managed.basicSalary': 'Monthly salary',
  'profile.managed.loginEmail': 'Login email',
  'profile.managed.roleName': 'Role',
  'profile.managed.lastLogin': 'Last sign-in',
  /*
   * The two `{...}` slots carry the emphasised field names below. The final clause — "which is why
   * this is not a form" — is the sentence that turns a read-only card from an oversight into a
   * decision, and it has to survive.
   */
  'profile.managed.note':
    '{employeeNo} is the key between this system and every terminal, and {department} feeds the payroll report subtotals. If either could be retyped here, one department’s pay figures could change with nobody approving it — which is why this is not a form.',
  'profile.managed.note.employeeNo': 'Employee no.',
  'profile.managed.note.department': 'department',
  'profile.managed.salaryNote':
    '{salary} is the only input to your overtime hourly rate — salary ÷ 26 ÷ 8, per s.60I of the Employment Act 1955. Editing it here would mean repricing your own overtime claims, so it is displayed rather than typed.',
  'profile.managed.salaryNote.emphasis': 'Monthly salary',

  'profile.group.credentials': 'Terminal Credentials',
  'profile.group.credentials.subtitle': 'What is enrolled on the devices, not the photo above.',
  'profile.credentials.count': '{count} enrolled',
  'profile.credentials.face': 'Face',
  'profile.credentials.fingerprint': 'Fingerprint',
  'profile.credentials.card': 'Card',
  // `{emphasis}` carries the negation below, already wrapped in a <strong>.
  'profile.credentials.note':
    'The profile photo above {emphasis} your face template. That template lives on the terminal and is what you scan with; the profile photo is only the picture beside your name on screen. Changing one does not change the other.',
  'profile.credentials.note.emphasis': 'is not',
  'profile.credentials.none':
    'You have no credentials on any terminal, so you cannot scan at all. Contact HR to be enrolled.',

  'profile.dirty': 'There are unsaved changes.',
  'profile.clean': 'No changes.',
  'profile.action.save': 'Update profile',
  'profile.action.cancel': 'Cancel',

  'profile.password.title': 'Change Password',
  'profile.password.subtitle':
    'All three fields are required. Ignore this section if you do not want to change it.',
  'profile.password.group': 'Password',
  'profile.password.hint':
    'Minimum {count} characters, as set in the system security policy.',
  'profile.password.current': 'Current password',
  'profile.password.current.hint':
    'Required. A session left open on an unlocked machine should not be enough to lock its owner out.',
  'profile.password.new': 'New password',
  'profile.password.confirm': 'Confirm the new password',
  'profile.password.tooShort': 'At least {min} characters ({current} so far)',
  'profile.password.mismatch': 'The two do not match',
  /*
   * `{emphasis}` carries the phrase below. The second sentence is the point: you are not signed out
   * by your own successful change, which would otherwise read as the change having failed.
   */
  'profile.password.otherSessions':
    'Changing your password signs out {emphasis} that signed in with the old one. This session stays — you are not signed out by your own action.',
  'profile.password.otherSessions.emphasis': 'every other device',
  'profile.password.error': 'Could not change the password',
  'profile.password.action': 'Change password',
};

/** Batch 5b: role management and the permission matrix editor. */
export const EN_LABELS_ROLES: Partial<Record<LabelKey, string>> = {
  'roles.title': 'Role Management',
  'roles.subtitle': 'Manage user roles and their access permissions.',
  'roles.section.title': 'Roles',
  'roles.section.subtitle':
    'Every account holds one role. That role is what decides what can be seen and what can be changed.',
  'roles.action.new': 'New Role',
  'roles.search': 'Search role name or description…',
  'roles.empty': 'No roles match these filters.',
  'roles.error.load': 'Could not load roles',
  'roles.error.remove': 'Could not remove the role',
  'roles.notice.removed': 'Role “{name}” removed.',
  /*
   * `{emphasis}` carries the sentence below. The last clause is the claim being made: the capability
   * does not exist in the system, rather than being withheld from most roles.
   */
  'roles.note.immutable':
    '{emphasis} No role — including Super Admin — can be granted permission to alter them. They are the evidence when an attendance record is disputed, so that capability does not exist in the system.',
  'roles.note.immutable.emphasis': 'The Raw Scan Log and the Audit Log are read-only.',
  'roles.column.name': 'Role name',
  'roles.column.description': 'Description',
  'roles.column.accounts': 'Users',
  'roles.column.permissions': 'Permissions',
  'roles.badge.system': 'System',
  'roles.row.view': 'View the permission matrix',
  'roles.row.edit': 'Edit the role',
  'roles.row.remove': 'Remove the role',
  'roles.row.locked': '{count} accounts still use it',
  'roles.row.expand': 'permission summary',
  'roles.coverage.aria': '{granted} of {total} permissions granted',
  'roles.detail.systemRole': 'System role',
  'roles.detail.systemRole.yes': 'Yes',
  'roles.detail.systemRole.no': 'No',
  'roles.detail.accounts': 'Accounts holding it',
  'roles.detail.permissions': 'Permissions',
  'roles.detail.permissions.value': '{granted} of {total}',
  'roles.detail.updated': 'Updated',
  'roles.detail.id': 'Role ID',
  'roles.detail.coverage': 'Coverage per section',
  'roles.viewOnly.heading': 'Can view but not change ({count})',
  'roles.remove.title': 'Remove role “{name}”?',
  'roles.remove.blocked':
    '{count} accounts still use this role. The request will be refused — move those accounts to another role first.',
  'roles.remove.safe': 'No accounts use this role, so it is safe to remove.',

  'roles.editor.heading.view': 'Permissions: {name}',
  'roles.editor.heading.edit': 'Edit Role: {name}',
  'roles.editor.subtitle.view': 'View only. Use the pencil icon on the list to make changes.',
  'roles.editor.subtitle.edit': 'Set the role name and its permission matrix.',
  'roles.editor.error.notFound': 'Role not found.',
  'roles.editor.error.load': 'Could not load the matrix',
  'roles.editor.error.save': 'Could not save the role',
  'roles.editor.back': 'Back',
  'roles.editor.back.aria': 'Back to the role list',
  'roles.editor.clearAll': 'Clear All',
  'roles.editor.selectAll': 'Select All',
  'roles.editor.save': 'Save Role',
  'roles.editor.details': 'Role details',
  'roles.editor.affected': '{count} accounts affected',
  'roles.editor.name': 'Role name *',
  // Example role names. Malay job titles become their English equivalents.
  'roles.editor.name.placeholder': 'e.g. Ward Clerk, HR Supervisor',
  'roles.editor.name.locked':
    'A system role’s name cannot be changed — other processes reference it.',
  'roles.editor.description': 'Description (optional)',
  'roles.editor.description.placeholder': 'A short summary of this role',
  'roles.editor.status': 'Status',
  'roles.editor.status.warning': 'Accounts holding this role will not be able to sign in.',
  'roles.editor.matrix.title': 'Permission Matrix',
  // The leading dash is the symbol shown in a cell, not punctuation. It has to stay a dash.
  'roles.editor.matrix.subtitle':
    'Tick the permissions for each screen. — means the action does not apply. The columns after the divider are screen-specific actions.',
  'roles.editor.matrix.granted': '{granted} / {total} granted',
  'roles.editor.matrix.caption':
    'Permission matrix: one row per screen, one column per action',
  'roles.editor.matrix.column.screen': 'Screen',
  'roles.editor.matrix.column.others': 'Others',
  'roles.editor.matrix.column.fullRow': 'Whole row',
  'roles.editor.section.clear': 'Clear the section',
  'roles.editor.section.select': 'Select the section',
  'roles.editor.section.progress': '({granted}/{total})',
  'roles.editor.screen.planned': 'Not built yet',
  'roles.editor.checkbox.aria': '{action} — {screen}',
  'roles.editor.notApplicable': 'Does not apply',
  'roles.editor.noCustom': 'No specific actions',
  'roles.editor.row.clear': 'Clear',
  'roles.editor.row.all': 'All',
  'roles.editor.fullAccess':
    'This role would have full access, the same as Super Admin. Every account holding it could alter the attendance and pay of thousands of people.',
  'roles.editor.hint':
    'Permissions are enforced on the server for every request, not only by hiding menu entries.',
};

/** Batch 5c: user accounts, staff accounts and app clients. */
export const EN_LABELS_USERS: Partial<Record<LabelKey, string>> = {
  // Sent by the server as `noteKey` on a create/rotate reply, so these read as consequences.
  'users.create.needs2fa': 'An administrator account must set up 2FA before it can sign in.',
  'users.apps.secret.issued':
    'Record this secret now — it is stored as a hash and cannot be shown again.',
  'users.apps.secret.rotated': 'The old secret is no longer valid. Record this new one now.',

  'users.title': 'User Management',
  'users.subtitle': 'Manage system accounts and the roles given to them.',
  'users.tabs.label': 'Account type',
  'users.tab.admin': 'Administrators',
  'users.tab.staff': 'Staff',
  'users.tab.apps': 'Apps',
  'users.error.load': 'Could not load accounts',
  'users.error.status': 'Could not change the status',
  'users.error.remove': 'Could not remove the account',
  'users.error.create': 'Could not create the account',
  'users.error.update': 'Could not update the account',
  'users.error.password': 'Could not set the password',

  'users.section.admin': 'Administrator Accounts',
  'users.section.admin.subtitle':
    'Admin panel logins. What each one can do comes from the role assigned to it.',
  'users.section.staff': 'Staff Accounts',
  'users.section.staff.subtitle':
    'Self-service logins for staff. Personal data is managed under the Staff Directory.',
  'users.action.newAdmin': 'New Administrator',
  'users.action.newStaff': 'New Staff Account',
  'users.search': 'Search email, staff name or staff no.…',
  'users.filter.roles': 'All roles',
  /*
   * `{pending}` carries the status name below. The second sentence is the reason app check-in is off
   * by default, and it is the distinction the whole feature rests on.
   */
  'users.staff.note':
    'A staff account is created {pending} and can only be used once that person claims it from their phone. App check-in is off by default: it only proves possession of a token, not physical presence.',
  'users.staff.note.pending': 'Pending',
  'users.empty.admin': 'No administrator accounts match these filters.',
  'users.empty.staff':
    'No staff accounts match. Create accounts for staff who need to use the check-in app.',
  'users.column.email': 'Email',
  'users.column.role': 'Role',
  'users.column.twoFactor': '2FA',
  'users.column.lastLogin': 'Last sign-in',
  'users.column.staff': 'Staff',
  'users.column.device': 'Device',
  'users.locked': 'Locked',
  'users.twoFactor.on': 'On',
  'users.twoFactor.off': 'Not set up',
  'users.noDepartment': 'No department',
  // Leading space and separator are deliberate: this clause is appended mid-line.
  'users.staffInactive': ' · staff inactive',
  'users.device.unclaimed': 'Not claimed',
  'users.never': 'Never',
  'users.action.view': 'View detail',
  'users.action.edit': 'Change the role and status',
  'users.action.reset': 'Reset the password',
  'users.action.reactivate': 'Reactivate the account',
  'users.action.suspend': 'Suspend the account',
  'users.action.remove': 'Remove the account',
  'users.action.suspendFirst': 'Suspend it first before it can be removed',
  'users.expand': 'account detail',
  'users.suspended': '{email} suspended. Sessions in progress have been ended.',
  'users.reactivated': '{email} reactivated.',
  'users.removed': 'Account {email} removed.',

  'users.detail.staffName': 'Staff name',
  'users.detail.employeeNo': 'Staff no.',
  'users.detail.department': 'Department',
  'users.detail.role': 'Role',
  'users.detail.accountType': 'Account type',
  'users.detail.created': 'Created',
  'users.detail.appCheckIn': 'App check-in',
  'users.detail.appCheckIn.allowed': 'Allowed',
  'users.detail.appCheckIn.denied': 'Not allowed',
  'users.detail.boundDevice': 'Bound device',
  'users.detail.boundDevice.value': '{id} ({when})',
  'users.detail.failedLogins': 'Failed sign-ins',
  'users.detail.failedLogins.none': 'None',
  'users.detail.failedLogins.count': '{count} failed attempts',
  'users.detail.lockedUntil': 'Locked until',
  'users.detail.accountId': 'Account ID',
  'users.detail.staffInactiveWarning':
    'This staff record is inactive but its account can still sign in. Suspend the account too.',
  'users.remove.title': 'Remove account {email}?',
  'users.remove.suspended':
    'This account is already suspended, so it is safe to remove. The audit trail stays — the actor’s name is stored as text on every past entry.',
  'users.remove.active':
    'This account is still active. The request will be refused: suspend it first so removal is two deliberate steps.',

  // ---------------------------------------------------------------------------
  // App clients
  // ---------------------------------------------------------------------------
  'users.apps.title': 'App Clients',
  'users.apps.subtitle':
    'An application build, not a person. Its token acts on behalf of one staff member and is limited to that person’s records.',
  'users.apps.action.add': 'New App Client',
  'users.apps.error.load': 'Could not load app clients',
  'users.apps.error.rotate': 'Could not rotate the secret',
  'users.apps.error.remove': 'Could not remove the client',
  'users.apps.error.create': 'Could not create the client',
  'users.apps.search': 'Search name or client ID…',
  'users.apps.chip.active': 'ACTIVE',
  'users.apps.chip.suspended': 'SUSPENDED',
  'users.apps.status.active': 'ACTIVE',
  'users.apps.status.suspended': 'SUSPENDED',
  /*
   * The last clause is the operational instruction: suspend or rotate rather than waiting for every
   * phone to be reinstalled.
   */
  'users.apps.note':
    'The secret is shown once, when it is created — it is stored as a hash, the same as a password. If it leaks, suspend the client or rotate its secret; do not wait for every phone to be reinstalled.',
  'users.apps.empty': 'No app clients. Create one when the check-in app is ready.',
  'users.apps.column.name': 'Name',
  'users.apps.column.platform': 'Platform',
  'users.apps.column.minVersion': 'Minimum version',
  'users.apps.noLimit': 'No limit',
  'users.apps.action.rotate': 'Rotate the secret',
  'users.apps.action.reactivate': 'Reactivate the client',
  'users.apps.action.suspend': 'Suspend the client',
  'users.apps.action.remove': 'Remove the client',
  'users.apps.expand': 'client detail',
  'users.apps.suspended': '{name} suspended. Tokens already issued are no longer accepted.',
  'users.apps.reactivated': '{name} reactivated.',
  'users.apps.removed': '{name} removed.',
  'users.apps.rotated': 'The old secret is no longer valid.',
  'users.apps.detail.clientId': 'Client ID',
  'users.apps.detail.updated': 'Updated',
  'users.apps.detail.secret': 'Secret',
  'users.apps.detail.secret.value': 'Stored as a hash — cannot be shown',
  'users.apps.remove.title': 'Remove client “{name}”?',
  'users.apps.remove.body':
    'This client is already suspended, so no phone still depends on it. The client ID cannot be reused.',

  // ---------------------------------------------------------------------------
  // Creating accounts
  // ---------------------------------------------------------------------------
  'users.create.admin': 'New administrator',
  'users.create.staff': 'New staff account',
  'users.create.description': 'Choose the staff member first. One person can only have one account.',
  'users.create.searchStaff': 'Search staff',
  'users.create.searchStaff.placeholder': 'Name, staff no. or email',
  'users.create.searching': 'Searching',
  'users.create.noMatch': 'No staff match.',
  'users.create.taken': 'Already has an account: {email}',
  'users.create.change': 'Change',
  'users.create.email': 'Login email',
  'users.create.role': 'Role',
  'users.create.role.option': '{name} ({granted}/{total})',
  'users.create.password': 'Initial password',
  'users.create.password.hint': 'Minimum 12 characters.',
  'users.create.password.short': '{count} more characters needed',
  'users.create.allowAppCheckIn': 'Allow check-in through the app',
  'users.create.allowAppCheckIn.hint':
    'Only relevant once this person’s location has coordinates and a geofence radius. Without those there is nothing to verify a position against.',
  'users.create.adminWarning':
    'An administrator account can alter the attendance records of thousands of people. Give it only to somebody who genuinely needs it.',
  'users.create.submit': 'Create account',
  'users.created': 'Account for {name} created.',

  'users.edit.status': 'Status',
  'users.edit.status.active': 'Active',
  'users.edit.status.pending': 'Pending',
  'users.edit.status.suspended': 'Suspended',
  'users.edit.status.warning': 'Sessions in progress will be ended immediately.',
  'users.edit.resetBinding': 'Release the device binding',
  'users.edit.resetBinding.hint':
    'Needed when a phone is replaced or lost. One account can only be bound to one device — two bindings for one person is a sign of a shared login.',
  'users.updated': 'Account {email} updated.',

  'users.reset.title': 'Reset the password',
  'users.reset.description': '{email} · {name}',
  'users.reset.password': 'New password',
  'users.reset.password.hint':
    'Minimum 12 characters. Deliver it through a channel other than this account’s email.',
  'users.reset.warning':
    'Every session for this account will be ended and its lock cleared. The password value is never recorded in the audit log — only the fact that it was changed.',
  'users.reset.submit': 'Reset',
  'users.reset.done': '{email}’s password has been reset. All of their sessions have been ended.',

  'users.apps.create.title': 'New app client',
  'users.apps.create.name': 'Name',
  // Hospital Sibu is a proper noun; Android is the platform name.
  'users.apps.create.name.placeholder': 'e.g. Hospital Sibu Check-In (Android)',
  'users.apps.create.platform': 'Platform',
  'users.apps.create.minVersion': 'Minimum version',
  'users.apps.create.minVersion.hint':
    'Builds older than this are refused. The lightest way to force an update when the check-in rules change.',
  'users.apps.create.submit': 'Create',
  'users.apps.secret.title': 'App client secret',
  'users.apps.secret.clientId': 'Client ID',
  'users.apps.secret.secret': 'Client secret',
  'users.apps.secret.copy': 'Copy both',
  'users.apps.secret.copied': 'Copied',
  /*
   * Not "Close". Closing this dialog is an acknowledgement that the value has been stored, and it is
   * the only chance to store it.
   */
  'users.apps.secret.close': 'I have recorded it',
};

/** Batch 6a: general configuration, the security policy, backup and restore. */
export const EN_LABELS_SETTINGS: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // General configuration
  // ---------------------------------------------------------------------------
  'settings.title': 'General Configuration',
  'settings.subtitle':
    'Settings that can be changed while the system is running. Values fixed at installation are shown read-only.',
  'settings.tabs.aria': 'Setting groups',
  'settings.tab.general': 'General',
  'settings.tab.backup': 'Backup & Restore',
  'settings.tab.maintenance': 'Maintenance & Cache',
  'settings.translation.title': 'Translation',
  'settings.error.load': 'Could not load settings',
  'settings.notice.saved': 'Settings saved.',
  'settings.save': 'Save',

  'settings.general.title': 'General',
  'settings.general.subtitle':
    'The names, formats and visual identity that appear on screens, reports and the payroll export.',
  'settings.general.hint':
    'The logo and favicon are saved as soon as they are uploaded, not by this button.',

  'settings.org.group': 'Organisation',
  'settings.org.name': 'Organisation name',
  'settings.org.name.hint': 'Appears on every report and on the payroll export header.',
  // A proper noun.
  'settings.org.name.placeholder': 'Hospital Sibu',
  'settings.dedup.label': 'Repeat scan window',
  'settings.dedup.hint':
    'A second scan inside this period is not counted twice. People often scan again when a terminal beeps late.',
  'settings.dedup.unit': 'seconds',

  'settings.datetime.group': 'Date & Time',
  'settings.datetime.subtitle': 'How dates and clocks are written throughout the application.',
  'settings.datetime.summary': '{format} · {clock}',
  'settings.datetime.clock24': '24-hour',
  'settings.datetime.clock12': '12-hour',
  /*
   * The distinction matters: this setting decides how a value is written, not which day a scan is
   * counted against. That comes from `ORG_TIMEZONE`.
   */
  'settings.datetime.note':
    'The timezone used for calculation comes from the environment file and is shown below. What is here only decides how values are written, not which day a scan counts against.',
  'settings.dateFormat.label': 'Date format',
  'settings.dateFormat.option': '{pattern} ({sample})',
  'settings.timeFormat.label': 'Time format',
  'settings.timeFormat.hint': 'Duty rosters are usually written in 24-hour, so that is the default.',
  'settings.timeFormat.option': '{clock} ({sample})',
  'settings.timeFormat.note':
    'Takes effect immediately once saved. Calendar dates such as holiday dates are unaffected — they have no time in them.',
  'settings.weekStart.label': 'Week starts',

  'settings.branding.group': 'Logo & Favicon',
  'settings.branding.subtitle':
    'Uploaded to this installation, not referenced from an external CDN.',
  'settings.branding.logo': 'Organisation logo',
  'settings.branding.logo.hint':
    'Appears on the sign-in screen and on reports. PNG or JPEG, around 64px tall.',
  'settings.branding.favicon': 'Favicon',
  'settings.branding.favicon.hint': 'The browser tab icon. PNG or ICO, 32×32 or 48×48.',
  /*
   * `{refusal}` carries the SVG clause below. The reason is kept: an SVG is an XML document that can
   * carry a script, and it would be served from this application's own origin.
   */
  'settings.branding.formats':
    'PNG, JPEG, WEBP or ICO, up to {limit}. The file type is determined from its first bytes, not from its name. {refusal} — it is an XML document that can carry a script, and it would be served from the same origin as this application.',
  'settings.branding.formats.refusal': 'SVG is not accepted',
  'settings.branding.offline':
    'Uploads are stored on this server. A LAN installation may have no internet access, and a logo that fails to load makes a report look broken.',

  'settings.upload.busy': 'Uploading',
  'settings.upload.empty': 'Not uploaded yet',
  'settings.upload.replace': 'Replace',
  'settings.upload.choose': 'Choose a file',
  'settings.upload.currentAlt': 'Current {label}',
  'settings.upload.tooLarge': 'The {size} file exceeds the {limit} limit.',
  'settings.upload.error': 'Upload failed',

  'settings.env.group': 'Fixed at Installation',
  'settings.env.subtitle':
    'These come from the environment file and need a restart to change.',
  'settings.env.connectorMode': 'Connector mode',
  // Stored values the operator chose literally. They stay as they are.
  'settings.env.connectorMode.direct': 'direct (LAN)',
  'settings.env.connectorMode.agent': 'agent (cloud)',
  'settings.env.timezone': 'Organisation timezone',
  'settings.env.driftWarn': 'Clock warning threshold',
  'settings.env.syncInterval': 'Terminal sync interval',
  'settings.env.seconds': '{count}s',
  'settings.env.require2fa': 'Admin 2FA',
  'settings.env.require2fa.on': 'required',
  'settings.env.require2fa.off': 'not required',
  'settings.env.ingestPath': 'Ingest path',
  'settings.env.no2fa':
    'Admin 2FA is off. One administrator account can alter the attendance records of thousands of people — switch {flag} on before the system goes into real use.',

  // ---------------------------------------------------------------------------
  // Security policy
  // ---------------------------------------------------------------------------
  'security.title': 'Security',
  'security.subtitle':
    'The authentication policy the server enforces, and the system’s current posture.',
  'security.error.load': 'Could not load the security settings',
  'security.saved': 'Security policy saved. In force within a few seconds.',

  'security.group.posture': 'Current Posture',
  'security.group.posture.subtitle': 'Read straight from the database each time this screen opens.',
  'security.posture.locked': 'Accounts locked right now',
  'security.posture.failed': 'Failed sign-ins (24 hours)',
  'security.posture.tokens': 'Active API tokens',
  'security.posture.expiring': 'Tokens expiring within 14 days',
  'security.posture.webhooks': 'Webhooks currently failing',

  'security.group.login': 'Sign-in & Passwords',
  'security.group.login.subtitle':
    'Read on every sign-in attempt and every password change.',
  'security.group.login.summary':
    '{attempts} attempts · {minutes} minutes · {characters} characters',
  /*
   * "no server restart is needed" is the claim being made. These were once hardcoded, and the note
   * exists so nobody assumes they still are.
   */
  'security.group.login.hint':
    'These values used to be hardcoded in the server. They are now read from the database on every attempt, so changing them here genuinely changes the behaviour — no server restart is needed.',
  'security.maxFailedLogins': 'Attempts before lockout',
  'security.maxFailedLogins.hint':
    'Minimum 3. A single attempt would lock somebody out of their own account over one typo.',
  'security.lockoutMinutes': 'Lockout duration',
  'security.lockoutMinutes.hint':
    'How long an account is refused after the attempt limit is reached. A lock expires on its own; nobody has to clear it.',
  'security.passwordMinLength': 'Minimum password length',
  'security.passwordMinLength.hint':
    'Enforced at account creation and on every password change, including by an administrator.',
  /*
   * The consequence clause is the argument against forcing an immediate reset, and it is the reason
   * the rule applies only at the next change.
   */
  'security.passwordMinLength.note':
    'A minimum length does not check existing passwords. It takes effect at the next change — forcing 5000 people to change immediately would produce five thousand passwords written on sticky notes.',

  'security.group.tokens': 'API Tokens',
  'security.group.tokens.subtitle':
    'The defaults for tokens issued in the API & Webhooks tab.',
  'security.group.tokens.summary': '{validity} · {grace} hours grace',
  'security.tokenDefaultDays': 'Default validity',
  'security.tokenDefaultDays.hint':
    'The value suggested when a new token is issued. Zero means no expiry.',
  'security.rotationGraceHours': 'Rotation grace period',
  'security.rotationGraceHours.hint':
    'How long the old token stays valid after a rotation, so a deployment can pick up the new value without a window of failure.',
  // `{emphasis}` carries the phrase below, already wrapped in a <strong>.
  'security.rotation.note':
    'There is no automatic rotation, and that is a deliberate decision. Rotating a static credential on a timer breaks every integration holding it with nobody being told. This grace period is for a rotation {emphasis}, which means somebody knows it happened and can update the receivers.',
  'security.rotation.note.emphasis': 'somebody pressed',

  'security.group.env': 'Fixed at Deploy',
  'security.group.env.subtitle':
    'Read from the environment file when the server starts. Shown here, not editable here.',
  'security.env.require2fa': 'Admin 2FA required',
  'security.env.yes': 'YES',
  'security.env.no': 'NO',
  'security.env.sessionTtl': 'Session lifetime',
  'security.env.sessionTtl.value': '{hours} hours',
  'security.env.connectorMode': 'Connector mode',
  'security.env.nodeEnv': 'Environment',
  /*
   * "a control that silently does nothing" is the failure mode this explains, and it is worse than
   * having no control at all.
   */
  'security.env.note':
    'These values are read once when the server starts. Making them editable here would produce a control that silently does nothing — the screen would say one thing and the running server another. Change them in {envFile}, then restart.',
  // `{emphasis}` carries the env var name below. `REQUIRE_ADMIN_2FA` is an identifier and stays.
  'security.env.no2fa':
    '{emphasis} That is fine for development and not for production: one leaked password is enough for full access, including the power to issue API tokens. Switch it on before this system goes into real use.',
  'security.env.no2fa.emphasis': 'REQUIRE_ADMIN_2FA is off.',

  'security.dirty': 'There are unsaved changes.',
  'security.clean': 'No changes. The values above are the ones being enforced.',
  'security.action.save': 'Save policy',
  'security.action.reset': 'Back to defaults',
  'security.unit.attempts': 'attempts',
  'security.unit.minutes': 'minutes',
  'security.unit.characters': 'characters',
  'security.unit.hours': 'hours',
  'security.unit.days': 'days',
  'security.unit.daysNoExpiry': 'days (no expiry)',
  'security.noExpiry': 'no expiry',
  'security.validity.days': '{count} days',
  'security.default': 'default {value}',

  // ---------------------------------------------------------------------------
  // Backup & restore
  // ---------------------------------------------------------------------------
  'backup.subtitle': 'Where dumps are stored, when they are taken, and how long they are kept.',
  'backup.run.action': 'Back Up Now',
  'backup.run.busy': 'Backing up…',
  'backup.error.load': 'Could not read the backup list',
  'backup.error.savePolicy': 'Could not save the schedule',
  'backup.error.run': 'Backup failed',
  'backup.error.remove': 'Could not remove the file',
  'backup.notice.removed': '{name} removed.',
  'backup.run.result': '{name} ({size}) finished in {seconds}s.',
  'backup.run.pruned': '{count} older files removed under the retention limit.',
  'backup.run.note':
    'Copy this file off this machine. A backup sitting on the same disk does not help when it is the disk that fails.',
  'backup.tool.missing':
    '{tool} was not found on this server. Install the MySQL client tools, or schedule backups outside the application — until then no backup can be taken from this screen, including a scheduled one.',
  'backup.empty.warning':
    'There are no backups yet. This database is the only place the attendance history exists, and it is what computes pay.',
  'backup.stale.warning':
    'The newest backup is {days} days old. If the database were lost today, that is how much work would go with it.',

  'backup.auto.group': 'Automatic Backup',
  'backup.auto.subtitle': 'One dump a day, checked every hour.',
  'backup.auto.summary.on': 'Daily at {time}',
  'backup.auto.summary.off': 'Off',
  /*
   * The mechanism is stated because it decides the behaviour somebody will observe: a missed hour is
   * skipped, not caught up.
   */
  'backup.auto.note':
    'Checked every hour and compared against the last run rather than fired by a timer at a set moment — so it survives a server restart. If the server is down through the chosen hour, that day’s dump is skipped, not caught up.',
  'backup.schedule.label': 'Schedule',
  'backup.schedule.hint':
    'Off by default. An installation that has not made a backup decision does not fill itself with dumps.',
  'backup.schedule.switch': 'Take one dump every day',
  'backup.hour.label': 'Hour',
  'backup.hour.hint': 'Pick an hour when nobody is scanning. The server’s local time.',
  'backup.hour.aria': 'Backup hour',
  'backup.keep.label': 'How many files to keep',
  'backup.keep.hint':
    'The oldest file is removed after a new dump succeeds, not before — a failed dump must not reduce the number of copies on hand.',
  'backup.keep.aria': 'Number of files kept',
  'backup.keep.unit': 'files',
  'backup.keep.minimum': 'Minimum 2',
  'backup.policy.save': 'Save the schedule',

  'backup.destination.group': 'Storage Destination',
  'backup.destination.summary': 'local disk',
  'backup.destination.directory': 'Directory',
  'backup.destination.fileCount': 'File count',
  'backup.destination.spaceUsed': 'Space used',
  'backup.destination.last': 'Last backup',
  'backup.destination.never': 'Never',
  /*
   * `{sameDisk}` carries the emphasised phrase below. The whole paragraph is kept: it explains why
   * automatic off-host push is absent rather than pending, which is a different claim.
   */
  'backup.destination.warning':
    'Dumps are stored on {sameDisk} as the database. Automatic push to FTP, SFTP or cloud storage has not been built: these files contain every attendance record and every password hash, so sending them to an external host unattended would require that host’s credentials stored here and would add one more way a 2 a.m. job can fail. Until that is built properly, download the files off this machine regularly.',
  'backup.destination.warning.sameDisk': 'the same disk',

  'backup.files.title': 'Backup Files',
  'backup.files.subtitle':
    'Newest first. Download them off this machine — a backup on a disk that failed does not help.',
  'backup.files.empty': 'No backup files yet.',
  'backup.column.file': 'File',
  'backup.column.size': 'Size',
  'backup.row.newest': 'Newest',
  'backup.row.download': 'Download {name}',
  'backup.row.remove': 'Remove {name}',
  'backup.row.onlyCopy': 'This is the only backup — run a new one first',

  'backup.restore.title': 'Restore',
  'backup.restore.subtitle': 'Deliberately not run from this screen.',
  'backup.restore.warning':
    'A restore overwrites current data. Stop the server first, otherwise scans arriving during the restore are lost without trace.',
  'backup.restore.lead': 'Run these commands on the server after stopping the application:',
  /*
   * The reason the button is absent, stated as a consequence: one click reachable by anybody who can
   * open this screen would overwrite every attendance record.
   */
  'backup.restore.note':
    'A restore button on a web screen is one click that overwrites every attendance record, reachable by anybody who gets to this screen. Printing the commands keeps that decision with the person running them.',
  'backup.remove.title': 'Remove a backup file?',
  'backup.remove.body':
    '{name} will be removed from disk. If you do not already have a copy off this machine, it is gone.',
};

/** Batch 6b: maintenance mode, caches, recompute, retention and system health. */
export const EN_LABELS_MAINTENANCE: Partial<Record<LabelKey, string>> = {
  'maintenance.subtitle': 'Maintenance mode, logs, caches and system state.',
  'maintenance.state.under': 'Under maintenance',
  'maintenance.state.operating': 'Operating',

  // ---------------------------------------------------------------------------
  // Maintenance mode
  // ---------------------------------------------------------------------------
  'maintenance.mode.group': 'Maintenance Mode',
  'maintenance.mode.subtitle': 'Refuses operator screens while work is carried out.',
  'maintenance.mode.on': 'On',
  'maintenance.mode.off': 'Off',
  /*
   * `{never}` carries the emphasised word. The middle clause is the reason ingest is exempt: a scan
   * the terminal cannot deliver is not retried, it leaves the device's internal log and is gone.
   */
  'maintenance.mode.ingestNote':
    'Terminal pushes are {never} refused, even while this mode is on. A scan that cannot be delivered is not retried by the device — it leaves its internal log and is lost. Attendance recording continues throughout maintenance.',
  'maintenance.mode.ingestNote.never': 'never',
  'maintenance.mode.enable': 'Switch the mode on',
  'maintenance.mode.enable.hint':
    'Takes effect immediately once saved. The check itself is cached for 15 seconds, so a change made directly in the database takes that long.',
  'maintenance.mode.enable.switch': 'Refuse operator requests',
  'maintenance.mode.message': 'Message',
  'maintenance.mode.message.hint':
    'Shown to anybody trying to use the system while this mode is on.',
  'maintenance.mode.message.placeholder':
    'The system is under maintenance. Attendance recording at the terminals is unaffected.',
  'maintenance.mode.allowIps': 'Permitted addresses',
  // The CIDR and wildcard forms are literal syntax and stay as they are.
  'maintenance.mode.allowIps.hint':
    'Comma-separated. Exact addresses, CIDR, or a starred tail such as 192.168.1.*',
  'maintenance.mode.allowIps.loopback':
    'Loopback is matched in both forms, so {ipv4} covers {ipv6} as well.',
  /*
   * The consequence is the point: the way back is through the database, so the server refuses a save
   * that would cause it.
   */
  'maintenance.mode.lockoutWarning':
    'Your own address must be in this list before the mode can be switched on — otherwise you lock yourself out, and the way back is only through the database. The server refuses a save that would cause it.',

  // ---------------------------------------------------------------------------
  // Debug & logs
  // ---------------------------------------------------------------------------
  'maintenance.log.group': 'Debug & Logs',
  'maintenance.log.subtitle': 'What is written to the Activity Log, and how long it is kept.',
  'maintenance.log.summary': '{level} · {days} days',
  'maintenance.log.level': 'Minimum level',
  'maintenance.log.level.hint':
    'Entries below this level are not written at all, so a quieter level genuinely is cheaper.',
  'maintenance.log.level.aria': 'Minimum log level',
  // The level names stay: they sit beside raw log output that uses the same words.
  'maintenance.log.level.debug': 'DEBUG — everything',
  'maintenance.log.level.info': 'INFO — default',
  'maintenance.log.level.warn': 'WARN — only what needs attention',
  /*
   * `{warn}` and `{error}` carry the level names. The quoted question is the reason those two cannot
   * be discarded, and the final clause names what such a control would actually be.
   */
  'maintenance.log.floorNote':
    'No option can discard {warn} or {error}. Those are the entries that answer “who deleted a month of scans”, and a control that could dispose of them is not a verbosity control.',
  'maintenance.log.retention': 'Activity log retention',
  'maintenance.log.retention.hint': 'Entries older than this are removed during the daily sweep.',
  'maintenance.log.retention.unit': 'days',
  'maintenance.log.retention.minimum': 'Minimum 7',
  // `{emphasis}` carries the sentence below.
  'maintenance.log.auditNote':
    '{emphasis} Two tables on purpose: the Activity Log is a running commentary that grows without limit, the Audit Log is the record of what changed and it is kept.',
  'maintenance.log.auditNote.emphasis': 'The Audit Log is not trimmed.',
  'maintenance.save': 'Save settings',
  'maintenance.save.hint':
    'Saving with the mode switched on will refuse every operator screen immediately.',

  // ---------------------------------------------------------------------------
  // Cache management
  // ---------------------------------------------------------------------------
  'maintenance.cache.title': 'Cache Management',
  'maintenance.cache.subtitle': 'Diagnostic actions, not repairs.',
  /*
   * Each parenthesis is the consequence of clearing that cache, which is why none of the three is
   * offered. Dropping them would leave three unexplained absences.
   */
  'maintenance.cache.leftAlone':
    'Three other caches are left alone deliberately: the API rate-limit counters (clearing them would let a caller reset its own limit), the Digest nonce store (it would reopen the replay window on the ingest path), and the bulk import job map (a running import would lose its place).',
  'maintenance.cache.config': 'Configuration cache',
  'maintenance.cache.config.detail':
    'API configuration, security policy, maintenance mode and log level. All of them expire on their own within 1–30 seconds, so this only shortens that.',
  'maintenance.cache.devices': 'Terminal clients',
  'maintenance.cache.devices.detail':
    'Forces every terminal to shake hands again. This is the one that genuinely helps after a terminal has been rebooted or its credentials changed.',
  'maintenance.cache.all': 'Clear everything',
  'maintenance.cache.all.detail': 'Both of the above in one action.',
  'maintenance.cache.action': 'Clear',
  'maintenance.cache.error': 'Could not clear the cache',
  'maintenance.cache.result': 'Cleared: {items}.',
  'maintenance.cache.item.apiConfig': 'API configuration',
  'maintenance.cache.item.securityPolicy': 'security policy',
  'maintenance.cache.item.maintenanceMode': 'maintenance mode',
  'maintenance.cache.item.logLevel': 'log level',
  'maintenance.cache.item.deviceClients': 'terminal clients',
  'maintenance.cache.note.config':
    'The configuration cache expires on its own within 1–30 seconds, so this only shortens that.',
  'maintenance.cache.note.devices': 'Terminal clients will shake hands again on the next request.',

  // ---------------------------------------------------------------------------
  // Recompute
  // ---------------------------------------------------------------------------
  'maintenance.recompute.title': 'Recompute Attendance',
  'maintenance.recompute.subtitle': 'Rebuilds attendance records from the raw scan log.',
  /*
   * This is the system's founding principle in one paragraph, so it is translated whole rather than
   * shortened to what the button does.
   */
  'maintenance.recompute.note':
    'This is why the scan log is stored immutably: after a terminal clock is corrected, a shift rule changes, or an ID mapping is fixed, the records can be regenerated with no original data lost. Running it twice gives the same result.',
  'maintenance.recompute.action': 'Recompute',
  'maintenance.recompute.result':
    '{records} records rebuilt for {staff} staff, {exceptions} exceptions raised.',
  'maintenance.recompute.error': 'Recompute failed',
  'maintenance.recompute.futureNote':
    'Future dates are ignored — a day that has not happened cannot be an absence.',

  // ---------------------------------------------------------------------------
  // Retention
  // ---------------------------------------------------------------------------
  'maintenance.retention.title': 'Data Retention & Automatic Purge',
  'maintenance.retention.subtitle':
    'How long scan logs are kept, and when aged ones are removed.',
  'maintenance.retention.purge': 'Purge now',
  'maintenance.retention.purge.busy': 'Purging…',
  'maintenance.retention.error.load': 'Could not read the retention policy',
  'maintenance.retention.error.purge': 'Purge failed',
  'maintenance.retention.error.trim': 'Could not trim the log',
  'maintenance.retention.policy.group': 'Retention Policy',
  'maintenance.retention.policy.summary': '{months} months · {schedule}',
  'maintenance.retention.policy.summary.auto': 'auto {time}',
  'maintenance.retention.policy.summary.manual': 'manual',
  'maintenance.retention.raw': 'Keep raw scan logs for',
  'maintenance.retention.raw.hint': 'This log is the evidence for pay already issued.',
  'maintenance.retention.months': 'months',
  'maintenance.retention.raw.floor':
    'Minimum {months} months — a month that has been purged cannot be recomputed',
  'maintenance.retention.pictures': 'Clear picture references after',
  'maintenance.retention.pictures.hint':
    'Pictures live on the terminal, not on this server. The terminal overwrites them itself, so this only removes links that were already going to fail.',
  'maintenance.retention.auto': 'Automatic purge',
  'maintenance.retention.auto.hint':
    'Off by default. While it is off, nothing is removed even once the retention period has passed.',
  'maintenance.retention.auto.switch': 'Run the purge every day',
  'maintenance.retention.hour': 'Hour it runs',
  'maintenance.retention.hour.hint':
    'The purge runs in batches and stops after a minute, so it does not hold the database — the remainder continues on the next pass. The activity log is trimmed in the same pass.',
  'maintenance.retention.hour.aria': 'Purge hour',
  'maintenance.retention.policy.save': 'Save the policy',

  'maintenance.retention.preview.group': 'What Would Be Removed Now',
  'maintenance.retention.preview.subtitle':
    'Computed against real data, before anything is removed.',
  'maintenance.retention.preview.total': 'Total scan logs stored',
  'maintenance.retention.preview.oldest': 'Oldest record',
  'maintenance.retention.preview.cutoff': 'Cut-off date',
  'maintenance.retention.preview.lastPurge': 'Last purge',
  'maintenance.retention.preview.never': 'Never',
  // `{punches}` is a conditional clause that carries its own leading space and full stop.
  'maintenance.retention.due':
    '{scans} would be removed permanently, and {pictures} picture references cleared.{punches}',
  'maintenance.retention.due.scans': '{count} scan logs',
  // The leading space belongs to this clause: it is appended mid-sentence.
  'maintenance.retention.due.punches':
    ' {count} punches would lose their link to the evidence — the attendance records themselves remain, but that month can no longer be recomputed.',
  'maintenance.retention.nothingDue':
    'No data is past the retention period. Nothing would be removed.',
  'maintenance.retention.auditNote':
    'Every purge is recorded in both the Activity Log and the Audit Log with its cut-off date and totals, so a gap in the scan log can be explained later.',
  'maintenance.retention.trim': 'Trim the activity log now',
  'maintenance.retention.trim.hint':
    'Uses the retention period set above. The Audit Log is not touched.',
  'maintenance.retention.trim.result':
    '{count} activity log entries before {cutoff} removed.',
  'maintenance.retention.trim.note':
    'The Audit Log is not touched — it is the permanent record of what changed.',
  'maintenance.retention.purge.result':
    '{scans} scan logs removed, {pictures} picture references cleared, {links} exception links released in {seconds}s.',
  'maintenance.retention.purge.incomplete':
    'The single-pass time limit was reached. Run it again to continue with the remainder.',
  'maintenance.retention.confirm.title': 'Permanently remove aged data?',
  'maintenance.retention.confirm.body':
    '{count} scan logs before {cutoff} will be removed. This cannot be undone and no backup is taken first.',
  'maintenance.retention.confirm.note':
    'Run a backup first if you are not certain. After this, a pay dispute for that month can no longer be answered from the terminal log.',
  'maintenance.retention.confirm.submit': 'Yes, remove them',

  // ---------------------------------------------------------------------------
  // Recent logs & system health
  // ---------------------------------------------------------------------------
  'maintenance.recentLogs.title': 'Recent System Logs',
  'maintenance.recentLogs.subtitle': 'The last 25 entries. Full filters are under Settings › Logs.',
  'maintenance.recentLogs.empty': 'No entries.',

  'maintenance.health.title': 'System Health',
  'maintenance.health.subtitle': 'Measured, not read from the configuration.',
  'maintenance.health.error': 'Could not read the system health',
  'maintenance.health.database': 'Database',
  'maintenance.health.database.ok': 'Connected · {latency}ms',
  'maintenance.health.database.fail': 'Failed',
  'maintenance.health.storage': 'File storage',
  'maintenance.health.storage.ok': 'Writable',
  'maintenance.health.storage.fail': 'Not writable',
  'maintenance.health.mode': 'Maintenance mode',
  'maintenance.health.backup': 'Backup',
  'maintenance.health.backup.value': '{count} files · {days} days ago',
  'maintenance.health.backup.scheduled': 'Scheduled',
  'maintenance.health.backup.unscheduled': 'Not scheduled',
  'maintenance.health.email': 'Email (SMTP)',
  'maintenance.health.email.value': '{count} active profiles',
  'maintenance.health.logs': 'Activity log',
  'maintenance.health.logs.value': '{count} entries',
  'maintenance.health.logs.detail': 'Audit {audit} · {days} days retention',
  'maintenance.health.memory': 'Memory',
  'maintenance.health.memory.value': '{used} / {total}',
  // RSS and Node are technical identifiers.
  'maintenance.health.memory.detail': 'RSS {rss} · Node {version}',
  'maintenance.health.uptime': 'Process uptime',
  'maintenance.health.orphans': 'Unreferenced branding files',
  'maintenance.health.orphans.detail': 'Left over from earlier uploads',
  // `h` for days and `j` for hours in the source become `d` and `h`.
  'maintenance.uptime.days': '{days}d {hours}h',
  'maintenance.uptime.hours': '{hours}h {minutes}m',
  'maintenance.uptime.minutes': '{minutes}m',
};

/** Batch 7a: the Integrations shell, email profiles, SMS and Telegram. */
export const EN_LABELS_CHANNELS: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // Integrations shell
  // ---------------------------------------------------------------------------
  'integration.title': 'Integrations',
  'integration.subtitle':
    'Outbound channels for notifications and external access. Credentials are encrypted before storage and are never shown again.',
  'integration.tabs.aria': 'Integration channels',
  'integration.tab.email': 'Email',
  'integration.tab.sms': 'SMS',
  'integration.tab.telegram': 'Telegram',
  'integration.tab.api': 'API & Webhooks',
  'integration.tab.security': 'Security',
  'integration.tab.holidays': 'Public Holidays',
  'integration.notice.saved': 'Integration settings saved.',
  /*
   * `{emphasis}` carries the mode line below. The point of the paragraph is that a LAN installation
   * keeps recording attendance when the line drops, so these channels are additions rather than
   * dependencies.
   */
  'integration.lan.note':
    '{emphasis} Every channel below needs the internet. A LAN installation is designed so attendance keeps working when the line drops — treat these channels as additions, not as something to rely on. Attendance recording itself does not depend on them.',
  'integration.lan.note.emphasis': 'Current mode: direct (LAN).',

  'integration.holiday.title': 'Public holiday source',
  'integration.holiday.subtitle':
    'Public holidays affect pay, so the list is entered and checked by a person.',
  'integration.holiday.group': 'External Feed',
  'integration.holiday.managed':
    'The actual list is managed under {link}. Sarawak holidays differ from other states and Islamic holiday dates can move on a late announcement.',
  'integration.holiday.managed.link': 'Schedule › Public Holidays',
  /*
   * Four keys were here: `autoOff`, `warning`, `url` and `url.hint` — a notice saying automatic import
   * was not switched on, plus a text box for a feed URL that nothing read.
   *
   * The tab now syncs from the gazette for the states that are ticked, so the notice describes a state
   * the screen is no longer in, and the URL box was a control pointing at nothing. The consequence that
   * made the warning worth having is still stated, in `integration.holiday.offices.warning`, against
   * the choice it actually applies to.
   */
  'integration.holiday.timezone': 'Calculation timezone: {timezone}',

  // ---------------------------------------------------------------------------
  // Email profiles
  // ---------------------------------------------------------------------------
  'emailProfile.title': 'Email Profile Management',
  'emailProfile.subtitle':
    'The SMTP profiles used for system email. Each notification sends through the profile that matches it — HR notices from HR, support tickets from Support.',
  'emailProfile.error.load': 'Could not load email profiles',
  'emailProfile.error.save': 'Could not save the profile',
  'emailProfile.error.remove': 'Could not remove the profile',
  'emailProfile.error.test': 'Could not run the test',
  'emailProfile.created': 'Profile “{name}” created. Send a test to confirm it works.',
  'emailProfile.saved': 'Profile “{name}” saved.',
  'emailProfile.removed': 'Profile “{name}” removed.',
  'emailProfile.test.sent': 'Test email sent to {recipient}.',
  'emailProfile.test.failed': 'The test failed.',
  'emailProfile.select': 'Choose a profile:',
  'emailProfile.action.add': 'New',
  'emailProfile.action.add.aria': 'Add an email profile',
  'emailProfile.none':
    'No email profiles yet. Press {newButton} to add the first one. Until a profile is configured and tested, no system email can be sent.',

  'emailProfile.group.sender': 'Profile & Sender',
  'emailProfile.group.sender.new': 'New profile — not saved yet.',
  'emailProfile.key': 'Profile key',
  'emailProfile.key.hintNew':
    'Used in code to select this profile. Cannot be changed once saved.',
  'emailProfile.key.hint': 'Used in code to select this profile. Cannot be changed.',
  'emailProfile.name': 'Profile name',
  'emailProfile.fromName': 'Sender name',
  'emailProfile.fromName.hint': 'The name recipients see.',
  'emailProfile.fromEmail': 'Sender email',
  'emailProfile.replyTo': 'Reply-to',
  'emailProfile.replyTo.hint':
    'Optional. Where replies should go if not to the sender address.',
  'emailProfile.status': 'Status',
  'emailProfile.status.hint':
    'An inactive profile is skipped, and anything that needs it stops sending.',
  'emailProfile.status.switch': 'This profile is active',
  'emailProfile.action.remove': 'Remove',

  'emailProfile.group.smtp': 'SMTP Server',
  'emailProfile.provider': 'Provider',
  'emailProfile.provider.hint':
    'Choosing a provider fills in the host, port and encryption below.',
  'emailProfile.host': 'Host',
  'emailProfile.port': 'Port',
  'emailProfile.port.hint': '587 for TLS, 465 for SSL, 25 for none.',
  'emailProfile.encryption': 'Encryption',
  /*
   * The reason it is stored explicitly rather than inferred: relays genuinely run on non-standard
   * ports, and a guess produces a handshake error nobody can read.
   */
  'emailProfile.encryption.hint':
    'Stored explicitly rather than guessed from the port — relays are genuinely configured on non-standard ports, and a guess produces a handshake error nobody can read.',
  'emailProfile.timeout': 'Timeout',
  'emailProfile.timeout.hint': 'Seconds to wait for the server to answer.',
  'emailProfile.maxRetries': 'Maximum attempts',
  'emailProfile.maxRetries.hint':
    'Only transient failures are retried. A rejected password is rejected the same way on every attempt.',

  'emailProfile.group.auth': 'Authentication',
  'emailProfile.auth.none': 'NONE',
  'emailProfile.auth.stored': 'PASSWORD STORED',
  'emailProfile.auth.needed': 'PASSWORD NEEDED',
  'emailProfile.authenticate': 'Authenticate',
  'emailProfile.authenticate.hint':
    'Switch off for an internal relay that authorises by source address.',
  'emailProfile.authenticate.switch': 'Sign in to the SMTP server',
  'emailProfile.username': 'Username',
  'emailProfile.password': 'Password',
  'emailProfile.password.hint':
    'Encrypted before storage and never returned to the browser.',
  'emailProfile.password.stored': 'Stored — leave blank to keep it',
  'emailProfile.action.create': 'Create profile',
  'emailProfile.action.save': 'Save settings',
  'emailProfile.saveFirst':
    'The profile is saved first, then tested. A test sends a real email through this relay.',

  'emailProfile.group.test': 'Test This Profile',
  /*
   * The last clause names the failure that actually happens in practice — the relay refusing the
   * sender address — which is why verifying credentials is not enough.
   */
  'emailProfile.group.test.subtitle':
    'Sends a real email. Verifying the credentials alone does not prove the relay will accept this sender address — that is what genuinely fails in practice.',
  'emailProfile.test.lastResult': 'Last result',
  'emailProfile.test.never': 'Not tested yet.',
  'emailProfile.test.ok': 'Succeeded',
  'emailProfile.test.bad': 'Failed',
  'emailProfile.test.recipient': 'Recipient',
  'emailProfile.test.recipient.hint': 'Leave blank to send to {address}.',
  'emailProfile.test.recipient.aria': 'Test recipient',
  'emailProfile.test.submit': 'Send test',
  'emailProfile.test.inactive':
    'This profile is inactive, so testing is disabled. Switch the status on above and save before testing — otherwise the test would pass against something that will not send anyway.',
  // `{emphasis}` carries the word below, already wrapped in a <strong>.
  'emailProfile.test.usesStored':
    'The test uses the {emphasis} credentials, not what is in the form. Save first if you have just changed them.',
  'emailProfile.test.usesStored.emphasis': 'stored',

  'emailProfile.remove.title': 'Remove profile “{name}”?',
  'emailProfile.remove.description': 'Key: {key}',
  'emailProfile.remove.body':
    'Any notification that selects {key} will stop sending, and it stops silently. If you only want to pause it, switch its status off instead.',
  'emailProfile.remove.submit': 'Remove profile',

  // ---------------------------------------------------------------------------
  // SMS via Infobip
  // ---------------------------------------------------------------------------
  // Infobip is the gateway's name and stays throughout.
  'sms.title': 'SMS via Infobip',
  'sms.subtitle':
    'Sends automatic SMS notifications through the hospital’s Infobip account.',
  'sms.error.load': 'Could not load the SMS settings',
  'sms.error.clear': 'Could not remove the key',
  'sms.error.test': 'Could not run the test',
  'sms.saved': 'SMS settings saved.',
  'sms.cleared':
    'API key removed. The channel was switched off at the same time — it cannot send without a key.',
  'sms.test.sent': 'Test SMS sent.',
  'sms.test.failed': 'The test failed.',
  'sms.group.credentials': 'Infobip Credentials',
  'sms.keySet': 'KEY STORED',
  'sms.keyMissing': 'NO KEY',
  // The portal path and the scope name are Infobip's own wording and stay.
  'sms.hint':
    'Get an API key from the Infobip portal: Account Settings › API Keys, with the {scope} scope. The base URL is unique to your account — it is not {wrongHost}.',
  'sms.apiKey': 'API key',
  'sms.apiKey.hint': 'Encrypted before storage and never returned to the browser.',
  'sms.apiKey.aria': 'Infobip API key',
  'sms.apiKey.stored': 'Stored — leave blank to keep it',
  'sms.apiKey.clear': 'Remove the stored key',
  'sms.baseUrl': 'Base URL',
  'sms.baseUrl.hint': 'The Infobip API host unique to your account.',
  'sms.senderId': 'Sender ID',
  'sms.senderId.hint':
    'A sender registered with Infobip — a short code or alphanumeric. During a trial, use ServiceSMS.',
  /*
   * The failure mode is the point: the API accepts it, the carrier drops it, and there is no error
   * anywhere to find.
   */
  'sms.senderId.note':
    'An unregistered sender ID is accepted by the API and then dropped by the carrier — with no error anywhere. Confirm it is registered on your Infobip account.',
  'sms.group.triggers': 'Notification Triggers',
  'sms.group.triggers.subtitle':
    'System events that send an SMS to the phone number of the staff member concerned.',
  'sms.triggers.count': '{count} selected',
  'sms.disabled.hint':
    'The channel is off: settings are saved but no SMS is sent, including by the triggers above.',
  'sms.action.save': 'Save settings',
  'sms.group.test': 'Send a Test SMS',
  'sms.group.test.subtitle':
    'Sends a real message through Infobip. It is billed like any other SMS.',
  'sms.test.usesStored': 'uses the stored credentials',
  'sms.test.lastResult': 'Last result',
  'sms.test.phone': 'Phone number',
  // The Malaysian dialling forms are literal examples and stay as digits.
  'sms.test.phone.hint': 'Include the country code. 012… is converted to 6012… automatically.',
  'sms.test.phone.aria': 'Test phone number',
  'sms.test.message': 'Message',
  'sms.test.message.aria': 'Test message',
  'sms.test.default': 'This is a test SMS from the Hospital Sibu Attendance System.',
  'sms.test.submit': 'Send test',
  'sms.segments.characters': '{count}/{limit} characters',
  'sms.segments.billed': '{count} segments billed',
  // GSM is the character-set standard and stays.
  'sms.segments.unicode': 'contains non-GSM characters, so the limit drops to 70',
  'sms.test.mustEnable':
    'Switch the channel on and save before testing — a test that passes against a disabled channel confirms something that will not send anyway.',

  // ---------------------------------------------------------------------------
  // Telegram
  // ---------------------------------------------------------------------------
  'telegram.title': 'Telegram Notifications',
  'telegram.subtitle':
    'Sends automatic notifications to one Telegram channel through a bot.',
  'telegram.error.load': 'Could not load the Telegram settings',
  'telegram.error.clear': 'Could not remove the token',
  'telegram.error.verify': 'Could not verify the token',
  'telegram.error.test': 'Could not run the test',
  'telegram.saved.unverified':
    'Settings saved. The bot name could not be read — verify the token to get it.',
  'telegram.saved.withBot': 'Settings saved. Bot: @{username}',
  'telegram.cleared':
    'Bot token removed. The channel was switched off at the same time — it cannot send without a token.',
  'telegram.verify.ok': 'The token is valid. Bot: {name}',
  'telegram.verify.failed': 'The token could not be verified.',
  'telegram.test.sent': 'Test message sent.',
  'telegram.test.failed': 'The test failed.',
  'telegram.group.bot': 'Bot Configuration',
  'telegram.unverified': 'NOT VERIFIED',
  // `{botFather}` carries @BotFather; the two channel slots carry the example forms.
  'telegram.hint':
    'Message {botFather} to create a bot and get its token. Add that bot to your channel as an administrator, then use the channel name ({channelName}) or its numeric ID ({channelId}).',
  'telegram.botToken': 'Bot token',
  'telegram.botToken.hint':
    'Encrypted before storage. Anybody holding it can send as this bot.',
  'telegram.botToken.stored': 'Stored — leave blank to keep it',
  'telegram.botToken.clear': 'Remove the stored token',
  'telegram.botUsername': 'Bot username',
  'telegram.botUsername.hint':
    'Read from Telegram when the token is verified, not typed in.',
  'telegram.botUsername.none': '— not verified —',
  'telegram.chatId': 'Channel ID',
  'telegram.chatId.hint':
    'Where messages are posted. The bot must be an administrator of that channel.',
  'telegram.ownerUserId': 'Owner user ID',
  // `/start` is a Telegram command and stays.
  'telegram.ownerUserId.hint':
    'Optional. A numeric Telegram ID for direct alerts. A bot cannot start a conversation until that person sends it /start.',
  'telegram.ownerUsername': 'Owner username',
  'telegram.ownerUsername.hint': 'Optional. For reference only.',
  'telegram.group.triggers': 'Notification Triggers',
  'telegram.group.triggers.subtitle':
    'System events that post a message to the Telegram channel.',
  'telegram.triggers.count': '{count} selected',
  'telegram.disabled.hint':
    'The channel is off: settings are saved but no message is sent, including by the triggers above.',
  'telegram.action.save': 'Save settings',
  'telegram.group.test': 'Test the Connection',
  'telegram.group.test.subtitle':
    'Verify the token first, then send a real message to the channel.',
  'telegram.test.lastResult': 'Last result',
  'telegram.action.verify': 'Verify the bot token',
  'telegram.action.send': 'Send to the channel',
  /*
   * The two slots carry the button names. The last sentence is the diagnostic this paragraph exists
   * for: a valid token that cannot post means the bot was never made a channel administrator.
   */
  'telegram.test.note':
    '{verify} only proves the token is valid — it sends nothing. {send} proves the bot is genuinely allowed to post there. A valid token that fails to post means the bot has not been made a channel administrator.',
  'telegram.test.note.verify': 'Verify the token',
  'telegram.test.note.send': 'Send to the channel',
  'telegram.test.usesStored':
    'The test uses the {emphasis} credentials, not what is in the form. Save first if you have just changed the token.',
  'telegram.test.usesStored.emphasis': 'stored',
};

/** Batch 7b: public API configuration, API tokens, and the shared notification triggers. */
export const EN_LABELS_API: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // Public API configuration
  // ---------------------------------------------------------------------------
  'api.subtitle': 'Access rules for the public API, and outbound webhook subscriptions.',
  'api.error.load': 'Could not load the API configuration',
  'api.state.on': 'Enabled',
  'api.state.off': 'Disabled',
  'api.notice.saved.on': 'Configuration saved. The public API is now answering requests.',
  'api.notice.saved.off':
    'Configuration saved. The public API is off — every one of its endpoints answers 404.',
  /*
   * `{emphasis}` carries the refusal below. The guard genuinely rejects this combination with a 409,
   * so the wording has to say it will not be saved rather than merely warn about it.
   */
  'api.wideOpen':
    'This combination {emphasis}: enabled, no token required, and no IP whitelist means the entire staff directory is open to anything that can reach this port. Switch on “Require a token”, or restrict it to specific addresses.',
  'api.wideOpen.emphasis': 'will not be saved',
  'api.access.group': 'Access',
  'api.access.answering': 'Answering',
  'api.access.silent': '404',
  // `{code}` carries the status code.
  'api.access.note':
    'When it is off, every endpoint answers {code} rather than 403. An endpoint that admits it exists is an endpoint worth trying again with a longer word list.',
  'api.requireToken': 'Require a token',
  'api.requireToken.hint':
    'Without this, anybody who can reach this port can read. Only reasonable behind an IP whitelist on an isolated VLAN.',
  'api.requireToken.switch': 'Every request must carry a token',
  'api.logRequests': 'Log every request',
  'api.logRequests.hint':
    'Rejections are always logged even with this off — this setting only controls the noise from successful traffic.',
  'api.logRequests.switch': 'Record successful requests',
  'api.baseUrl': 'Base address',
  'api.baseUrl.hint': 'The path callers should target.',
  'api.endpoints.group': 'Available Endpoints',
  'api.endpoints.subtitle': 'Read-only, and small on purpose.',
  'api.endpoints.count': '{count} endpoints',
  'api.endpoints.privacy':
    'NRIC numbers, phone numbers, email addresses and leave reasons are not sent: that is personal data with no stated purpose here.',
  // Lowercase prose, sits inside a scope line.
  'api.scope.anyToken': 'any valid token',
  'api.rate.group': 'Rate Limit & IP Filter',
  'api.rate.subtitle': 'Counted per token where there is one, per address otherwise.',
  'api.rate.summary.limited': '{count}/min',
  'api.rate.summary.unlimited': 'no limit',
  // Mid-sentence clause: keeps its own leading space and separator.
  'api.rate.summary.whitelist': ' · {count} addresses allowed',
  'api.rate.enable': 'Limit the request rate',
  'api.rate.perMinute': 'Requests per minute',
  'api.rate.perMinute.hint':
    'One noisy integration cannot consume everyone else’s allowance, because the count is tied to the token and not to the address.',
  'api.rate.perMinute.unit': 'per minute',
  'api.whitelist': 'IP whitelist',
  'api.whitelist.hint':
    'One address or CIDR per line, IPv4 or IPv6. Empty means no address restriction.',
  'api.whitelist.empty': 'Empty: any address may try.',
  'api.whitelist.count':
    '{count} entries. Addresses outside this list receive 404, not 403 — an address that is not allowed should not learn the endpoint exists.',
  'api.cors.group': 'CORS',
  'api.cors.subtitle': 'Origins allowed to call from inside a browser.',
  'api.cors.summary.all': 'all origins',
  'api.cors.summary.listed': '{count} listed',
  /*
   * The two slots carry phrases already wrapped in <strong>. The last sentence is the whole point:
   * CORS is not a control, and reading it as one leaves the API open while looking configured.
   */
  'api.cors.note':
    'CORS is enforced by the {browser}, not by this server. It restricts pages running in somebody’s browser and does nothing at all to a server-to-server caller. This is {notAccessControl} — the token and the IP whitelist above are the controls.',
  'api.cors.note.browser': 'browser',
  'api.cors.note.notAccessControl': 'not access control',
  'api.cors.allowAll': 'Allow all origins',
  'api.cors.allowAll.hint': 'Sends Access-Control-Allow-Origin: *',
  'api.cors.origins': 'Allowed origins',
  'api.cors.origins.hint':
    'One per line, scheme and host with no path. Example: https://portal.hospital.local',
  'api.install.group': 'Installation',
  'api.install.mode': 'Connection mode',
  'api.install.mode.hint': 'Set in the environment file, not here.',
  /*
   * Stated rather than assumed because it changes what every setting above is worth: on a LAN
   * install the API is not reachable from outside to begin with.
   */
  'api.install.mode.lanNote':
    'On a LAN installation this API is only reachable from inside the hospital network to begin with. That changes what every setting above is worth, so it is stated rather than assumed.',
  'api.save': 'Save configuration',
  'api.save.hint.on': 'Takes effect within a second. Tokens already issued do not change.',
  'api.save.hint.off':
    'The API is off: settings are saved but every public endpoint answers 404.',

  // ---------------------------------------------------------------------------
  // API tokens
  // ---------------------------------------------------------------------------
  'token.title': 'API Tokens',
  'token.subtitle':
    'One token per integration. The value is shown once, when it is issued.',
  'token.action.new': 'New Token',
  'token.search': 'Search a name or prefix…',
  'token.empty':
    'No tokens. Issue one when an integration genuinely needs to read this data.',
  'token.error.load': 'Could not load the tokens',
  'token.error.revoke': 'Could not revoke the token',
  'token.error.rotate': 'Could not rotate the token',
  'token.error.remove': 'Could not remove the token',
  'token.error.create': 'Could not create the token',
  'token.notice.revoked':
    '{prefix} revoked. The next request carrying that token is refused.',
  'token.notice.removed': '{prefix} removed.',
  /*
   * `{rotate}` carries the word below. The last clause is the reason rotation exists as its own
   * action: a lost token cannot be read back, so replacing it is the only remedy.
   */
  'token.hashNote':
    'Stored as a SHA-256 hash, so a database dump does not hand over API access and the value cannot be read back even by an administrator. If a token goes missing, {rotate} — that is why rotation exists as an action of its own.',
  'token.hashNote.rotate': 'rotate it',
  'token.column.name': 'Name',
  'token.column.scopes': 'Scopes',
  'token.column.lastUsed': 'Last used',
  'token.column.expires': 'Expires',
  'token.row.neverUsed': 'Never used',
  'token.row.noExpiry': 'No expiry',
  'token.row.view': 'View details',
  'token.row.rotate':
    'Rotate token — a replacement is issued, the old one stays valid through the grace period',
  'token.row.rotate.blocked': 'Only an active token can be rotated',
  'token.row.revoke': 'Revoke token — takes effect immediately',
  'token.row.revoke.done': 'This token is already revoked',
  'token.row.remove': 'Remove the token row',
  'token.row.remove.blocked': 'Revoke it first before it can be removed',
  'token.row.expand': 'token details',
  'token.detail.prefix': 'Prefix',
  'token.detail.value': 'Token value',
  'token.detail.value.hashed': 'Stored as a hash — cannot be shown',
  'token.detail.requests': 'Total requests',
  'token.detail.lastIp': 'Last address',
  'token.detail.rate': 'Rate this minute',
  'token.detail.rate.none': 'No requests',
  'token.detail.rate.count': '{count} requests',
  'token.detail.rotatedAt': 'Rotated at',
  'token.detail.rotatedTo': 'Replaced by',
  'token.detail.graceEnds': 'Grace period ends',
  'token.detail.revokedAt': 'Revoked',
  'token.detail.scopes': 'Scopes',
  'token.reveal.new': 'New API token',
  'token.reveal.rotated': 'Replacement token',
  'token.reveal.label': 'Token',
  'token.reveal.note.new':
    'This is the only time this value is shown. No endpoint returns it again.',
  'token.reveal.note.rotated':
    'The old token is still valid through the grace period. Update your integration before it ends.',
  'token.reveal.note.rotated.until':
    'The old token stays valid until {until}. Update your integration before then — after that it is refused.',
  // The two slots carry the header forms; they are masks and stay as they are.
  'token.reveal.hint': 'Send it as {bearer} or {apiKey}.',
  'token.remove.title': 'Remove token "{name}"?',
  /*
   * The argument against removing the row: the activity log still names the prefix, so deleting the
   * row leaves entries nobody can explain.
   */
  'token.remove.body':
    'This token is already revoked, so no integration can still use it. Removing its row loses the record of what it was allowed to do, while the activity log still refers to prefix {prefix}.',
  'token.create.title': 'New API token',
  'token.create.description': 'Read-only scopes. No write scope is offered.',
  'token.create.submit': 'Issue token',
  'token.create.name': 'Name',
  'token.create.name.hint':
    'Who this token is for. A clear name is the only way to know what breaks when you revoke it.',
  'token.create.name.placeholder': 'e.g. HR Portal — attendance reads',
  'token.create.name.aria': 'Token name',
  'token.create.validity': 'Validity',
  'token.create.validity.hint':
    'A token with no expiry stays valid until somebody revokes it by hand, including after whoever issued it has moved on.',
  'token.create.days.aria': 'Number of days',
  'token.create.days.unit': 'days',
  'token.create.neverExpires': 'No expiry date',
  'token.create.scopes.chosen': '{count} selected',
  /*
   * `{view}` and `{export}` carry the scope action names. The reason is the second sentence: a write
   * scope would let a token change attendance with nobody attached to the change.
   */
  'token.create.scopes.note':
    'Only {view} and {export} are offered. A write scope would let a token change attendance with nobody attached to that change, and the audit trail is built on there always being somebody.',
  // The dash belongs to this label, not to the caller that joins the two halves.
  'token.scope.label': '{screen} — {action}',
  'token.policy.note':
    'Rotation is {notAutomatic}. Rotating a static credential on a timer breaks every integration holding it, silently, at whatever hour the timer fires. Instead: press rotate, a new token is issued, and the old one stays valid for {hours} hours so a deployment can pick up the new value on its own schedule. That window is set in the Security tab.',
  'token.policy.note.notAutomatic': 'not automatic',

  // ---------------------------------------------------------------------------
  // Notification triggers, shared by the SMS, Telegram and webhook channels
  // ---------------------------------------------------------------------------
  'trigger.leave.requested': 'New leave request',
  'trigger.leave.requested.detail':
    'Applicant name, leave type, the dates, and how many working days are charged.',
  'trigger.leave.approved': 'Leave approved',
  'trigger.leave.approved.detail':
    'Who was approved, by whom, and how many calendar days were written to the roster.',
  'trigger.leave.rejected': 'Leave rejected',
  'trigger.leave.rejected.detail':
    'The rejection reason is included — it is the only thing the applicant can act on.',
  'trigger.leave.cancelled': 'Leave cancelled',
  'trigger.leave.cancelled.detail':
    'Includes the reminder that the original shifts are not restored.',
  'trigger.attendance.exception': 'Attendance exception',
  'trigger.attendance.exception.detail':
    'A day the engine could not resolve. Prone to noise — one faulty terminal can generate hundreds in a day.',
  'trigger.device.offline': 'Terminal lost connection',
  'trigger.device.offline.detail':
    'Current scans are not received until the connection returns.',
  'trigger.device.clockDrift': 'Terminal clock drifted',
  'trigger.device.clockDrift.detail':
    'The one fault that corrupts every record without producing an error anywhere. Worth switching on.',
  'trigger.payroll.exported': 'Payroll export generated',
  'trigger.payroll.exported.detail':
    'Who generated it, which period, and how many exceptions are still unresolved.',
  'trigger.notWired': 'not wired yet',
  'trigger.overtime.approved': 'Overtime approved',
  'trigger.overtime.approved.detail':
    'The rate chosen and the amount payable. A mid-level approval says still pending, not approved.',
  'trigger.overtime.rejected': 'Overtime rejected',
  'trigger.overtime.rejected.detail': 'The rejection reason is included.',
  'trigger.claim.approved': 'Claim approved',
  'trigger.claim.approved.detail':
    'The approved amount, which can be less than what was claimed when a category cap applies.',
  'trigger.claim.rejected': 'Claim rejected',
  'trigger.claim.rejected.detail': 'The rejection reason is included.',
  'trigger.expense.approved': 'Expense approved',
  'trigger.expense.approved.detail':
    'Includes the payee name, so the payment can be checked against the bank statement.',
  'trigger.expense.rejected': 'Expense rejected',
  'trigger.expense.rejected.detail': 'The rejection reason is included.',
  'trigger.applicant.offered': 'Job offer approved',
  'trigger.applicant.offered.detail':
    'Sent to the candidate, not to staff. A mid-level approval says still pending — an offer that is not fully approved has not been made.',
  'trigger.applicant.rejected': 'Application unsuccessful',
  'trigger.applicant.rejected.detail':
    'The wording matters: the recipient is an outsider.',
  'trigger.payroll.paid': 'Salary paid',
  'trigger.payroll.paid.detail':
    'One message to each person paid, with net pay and the payslip number. Raised when a period is marked paid, not when it is approved — approval does not move money.',
  'trigger.payroll.awardDecided': 'Bonus or commission decided',
  'trigger.payroll.awardDecided.detail':
    'The amount, the period that will pay it, and the decision note.',
  'trigger.payroll.lendingApproved': 'Loan or advance approved',
  'trigger.payroll.lendingApproved.detail':
    'The monthly instalment and the first deduction date — a deduction that appears without warning reads as a mistake.',
  'trigger.kpi.reviewAssigned': 'Review assigned',
  'trigger.kpi.reviewAssigned.detail':
    'To the reviewer: who needs reviewing, which template, and the due date.',
  'trigger.kpi.finalised': 'Review finalised',
  'trigger.kpi.finalised.detail':
    'To the person reviewed: the score, the grade, and the reviewer’s name.',
  'trigger.justification.decided': 'Attendance justification decided',
  'trigger.justification.decided.detail':
    'To the staff member who submitted the reason: approved, rejected, or sent back for correction. There is no notification for submissions — supervisors see a live count on the menu, and one message per submission would arrive dozens at a time at the start of the month.',
};

/** Batch 7c: outbound webhook subscriptions, signing secrets and the delivery log. */
export const EN_LABELS_WEBHOOK: Partial<Record<LabelKey, string>> = {
  'webhook.title': 'Webhooks',
  'webhook.subtitle':
    'Events pushed out to your URL, signed so the receiver can prove they came from here.',
  'webhook.action.add': 'New Webhook',
  'webhook.error.load': 'Could not load the webhooks',
  'webhook.error.test': 'Could not run the test',
  'webhook.error.status': 'Could not change the status',
  'webhook.error.regenerate': 'Could not generate a new secret',
  'webhook.error.remove': 'Could not remove the webhook',
  'webhook.error.save': 'Could not save the webhook',
  'webhook.error.deliveries': 'Could not load the log',
  // Chips are uppercased by CSS in Malay too; the words stay uppercase here.
  'webhook.chip.active': 'ACTIVE',
  'webhook.chip.off': 'DISABLED',
  'webhook.chip.broken': 'AUTO-DISABLED',
  'webhook.search': 'Search a name or URL…',
  /*
   * The four slots carry the header name, its format, the signed material and the tolerance. The last
   * clause is the reason the timestamp is inside the signed material rather than beside it.
   */
  'webhook.signature':
    'Every request carries {header} in the form {format}, an HMAC-SHA256 over {payload}. The timestamp sits inside the signed material, so a captured request expires after {seconds} seconds — a signature over the body alone is still correct when replayed a month later. Compare it in constant time.',
  'webhook.empty':
    'No webhooks. Add one when an external system needs to know when something happens here.',
  'webhook.column.name': 'Name',
  'webhook.column.events': 'Events',
  'webhook.column.lastSent': 'Last sent',
  'webhook.status.autoOff': 'AUTO-DISABLED',
  'webhook.status.active': 'ACTIVE',
  'webhook.status.off': 'DISABLED',
  'webhook.failures': '{count} consecutive failures',
  'webhook.never': 'Never',
  'webhook.action.test': 'Send a signed test event',
  'webhook.action.edit': 'Edit webhook',
  'webhook.action.regenerate':
    'Generate a new signing secret — the old one stops working immediately',
  'webhook.action.disable': 'Disable webhook',
  'webhook.action.enable': 'Re-enable webhook',
  'webhook.action.remove': 'Remove webhook',
  'webhook.expand': 'delivery log',
  'webhook.test.ok': '{name}: the receiver answered HTTP {status} in {duration}ms.',
  'webhook.test.failed': '{name}: failed on attempt {attempt} — {reason}',
  'webhook.test.unknownReason': 'reason unknown',
  'webhook.enabled': '{name} enabled. The failure count was cleared.',
  'webhook.disabled': '{name} disabled. No events are sent to it.',
  'webhook.removed': '{name} removed.',
  /*
   * `{noRetry}` and `{retried}` carry the two retry rules. The auto-disable reasoning is the last
   * sentence and is the point: an endless retry loop looks like an outbound scan.
   */
  'webhook.retry.note':
    'A {noRetry} — the receiver understood the request and refused it, so sending it three more times only produces three more entries in their log. {retried} After 20 consecutive failures the subscription disables itself: an endless retry loop against a host that has been gone a week is indistinguishable from an outbound scan, and the receiver’s firewall notices first.',
  'webhook.retry.note.noRetry': '4xx is not retried',
  'webhook.retry.note.retried': '5xx and network failures are retried three times.',
  'webhook.secret.titleNew': 'Webhook signing secret',
  'webhook.secret.titleRegenerated': 'New signing secret',
  'webhook.secret.label': 'Signing secret',
  'webhook.secret.noteNew':
    'This is the only time this secret is shown. The receiver needs it to verify the signature; if it is lost, generate a new one.',
  'webhook.secret.noteRegenerated':
    'The old secret no longer works. Your receiver will reject every delivery until it is updated with this value.',
  'webhook.secret.hint':
    'Store it on your receiver, not here. It is encrypted before storage and is not returned by any endpoint.',
  'webhook.remove.title': 'Remove webhook "{name}"?',
  'webhook.remove.body':
    'Its delivery log goes with it. If you only want to stop it for a while, disable the subscription instead — the log stays and the signing secret does not change.',
  'webhook.detail.subscribed': 'Subscribed to',
  'webhook.detail.recent': 'Recent deliveries',
  'webhook.detail.loading': 'Loading…',
  'webhook.detail.none': 'No deliveries yet.',
  'webhook.detail.error': 'ERROR',
  'webhook.detail.attempt': 'attempt {count}',
  'webhook.detail.duration': '{ms}ms',
  'webhook.form.titleNew': 'New webhook',
  'webhook.form.titleEdit': 'Edit "{name}"',
  'webhook.form.description':
    'The URL is checked before it is saved, and checked again on every delivery.',
  'webhook.form.name': 'Name',
  'webhook.form.name.hint': 'Which system receives this.',
  'webhook.form.name.aria': 'Webhook name',
  'webhook.form.name.placeholder': 'e.g. HR Portal — leave updates',
  'webhook.form.url': 'Receiver URL',
  'webhook.form.url.hint':
    'https is required for public addresses. http is only allowed to private ranges, where the traffic does not leave the site.',
  'webhook.form.active': 'Active',
  'webhook.form.active.hint':
    'When switched off, the subscription stays but nothing is sent.',
  'webhook.form.active.switch': 'Webhook is active',
  // `{address}` carries the metadata endpoint address, which is a literal and stays.
  'webhook.form.ssrf':
    'Host names are resolved through DNS before being accepted, rather than matched as text. A check over the URL text can be bypassed by any name pointing at {address} — the cloud metadata endpoint that hands instance credentials to anybody who asks, with no authentication.',
  'webhook.form.events': 'Events',
  'webhook.form.events.count': '{count} selected',
  'webhook.form.submitNew': 'Create webhook',
};

/** Batch 8a: recruitment — job postings, applicants, offers and hiring. */
export const EN_LABELS_RECRUIT: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // Job postings
  // ---------------------------------------------------------------------------
  'recruit.posting.title': 'Job Postings',
  'recruit.posting.subtitle':
    'A posting is created as a draft. Publishing is a separate action, and closing is not deleting — applicants still need to name the posting they applied for.',
  'recruit.posting.tab.list': 'Postings',
  'recruit.posting.status.draft': 'Draft',
  'recruit.posting.status.published': 'Published',
  'recruit.posting.status.closed': 'Closed',
  'recruit.posting.column.code': 'Code',
  'recruit.posting.column.title': 'Position',
  'recruit.posting.column.department': 'Department',
  'recruit.posting.column.positions': 'Vacancies',
  'recruit.posting.column.applicants': 'Applicants',
  'recruit.posting.column.opened': 'Opened',
  'recruit.posting.column.closes': 'Closes',
  'recruit.posting.filled': '{hired} of {positions}',
  'recruit.posting.empty': 'No job postings.',
  'recruit.posting.error.load': 'The posting list could not be loaded.',
  'recruit.posting.action.new': 'New Posting',
  'recruit.posting.action.publish': 'Publish',
  'recruit.posting.action.close': 'Close posting',
  'recruit.posting.action.edit': 'Edit posting',
  'recruit.posting.action.delete': 'Remove posting',
  'recruit.posting.action.view': 'View',
  /*
   * The arrows are the lifecycle drawn as a diagram and stay as arrows. The last clause is the reason
   * closing is one-way: reopening would extend a closing date some candidates were already told had
   * passed.
   */
  'recruit.posting.note.forward':
    'A posting’s lifecycle only moves forward: draft → published → closed. A closed posting is not reopened, because that would extend a closing date some candidates have already been told has passed.',
  'recruit.posting.note.locked':
    'A closed posting cannot be edited — candidates applied on the basis of what it said.',
  'recruit.posting.form.title': 'Job Posting',
  'recruit.posting.form.code': 'Posting code',
  'recruit.posting.form.code.hint':
    'Short and fixed — this is what a candidate quotes on the phone.',
  'recruit.posting.form.jobTitle': 'Position',
  'recruit.posting.form.department': 'Department',
  'recruit.posting.form.location': 'Location',
  'recruit.posting.form.positions': 'Number of vacancies',
  'recruit.posting.form.employmentType': 'Employment type',
  'recruit.posting.form.salaryMin': 'Minimum salary (RM)',
  'recruit.posting.form.salaryMax': 'Maximum salary (RM)',
  'recruit.posting.form.salary.hint': 'Leave both blank if the range is not advertised.',
  'recruit.posting.form.openedOn': 'Opening date',
  'recruit.posting.form.closesOn': 'Closing date',
  'recruit.posting.form.closesOn.hint': 'Leave blank for a posting with no closing date.',
  'recruit.posting.form.summary': 'Summary of duties',
  'recruit.posting.form.requirements': 'Requirements',
  'recruit.employment.permanent': 'Permanent',
  'recruit.employment.contract': 'Contract',
  'recruit.employment.temporary': 'Temporary',
  'recruit.employment.internship': 'Internship',

  // ---------------------------------------------------------------------------
  // Applicants
  // ---------------------------------------------------------------------------
  'recruit.applicant.title': 'Applicants',
  'recruit.applicant.subtitle':
    'A candidate is an outsider, not a staff member — they have no employee number, department or attendance. Hiring one creates a staff record from data that is already here.',
  'recruit.applicant.status.new': 'New',
  'recruit.applicant.status.screening': 'Screening',
  'recruit.applicant.status.interview': 'Interview',
  'recruit.applicant.status.offered': 'Offered',
  'recruit.applicant.status.hired': 'Hired',
  // Deliberately softer than "Rejected": the person reading it is an outsider.
  'recruit.applicant.status.rejected': 'Unsuccessful',
  'recruit.applicant.status.withdrawn': 'Withdrawn',
  'recruit.applicant.column.applicantNo': 'Applicant No.',
  'recruit.applicant.column.name': 'Name',
  'recruit.applicant.column.posting': 'Posting',
  'recruit.applicant.column.contact': 'Contact',
  'recruit.applicant.column.interview': 'Interview',
  'recruit.applicant.column.staff': 'Staff Record',
  'recruit.applicant.empty': 'No applicants.',
  'recruit.applicant.error.load': 'The applicant list could not be loaded.',
  'recruit.applicant.action.new': 'Record Applicant',
  'recruit.applicant.action.advance': 'Advance stage',
  'recruit.applicant.action.hire': 'Hire as staff',
  'recruit.applicant.action.delete': 'Remove applicant',
  'recruit.applicant.action.view': 'View',
  // The quoted word is the stage a candidate would be told, and stays quoted.
  'recruit.applicant.note.offer':
    'An offer is made through the approval flow, not by changing the stage. Until the last level signs off, the candidate stays at the interview stage — telling them “offered” before that is an offer that has not been made.',
  'recruit.applicant.note.delete':
    'Removing an applicant deletes an outsider’s personal data outright, along with the trail of decisions about them. It cannot be undone.',
  'recruit.applicant.note.hired':
    'The staff record is created as INACTIVE. Activate it after enrolling biometrics on a terminal — an active staff member who cannot scan is reported absent from the first day.',
  'recruit.applicant.form.title': 'Record Applicant',
  'recruit.applicant.form.posting': 'Posting',
  'recruit.applicant.form.posting.hint': 'Only published postings accept applications.',
  'recruit.applicant.form.fullName': 'Full name',
  'recruit.applicant.form.icNo': 'NRIC number',
  'recruit.applicant.form.icNo.hint':
    'Not required to apply, but required before being hired.',
  'recruit.applicant.form.email': 'Email',
  'recruit.applicant.form.phone': 'Phone',
  'recruit.applicant.form.coverNote': 'Application note',

  // ---------------------------------------------------------------------------
  // Stage changes, offer decisions and hiring
  // ---------------------------------------------------------------------------
  'recruit.advance.title': 'Advance {applicantNo}',
  'recruit.advance.description':
    'Only the stages the pipeline allows are shown. Unsuccessful and withdrawn are final states.',
  'recruit.advance.status': 'New stage',
  'recruit.advance.interviewAt': 'Interview date and time',
  'recruit.advance.note': 'Note',
  'recruit.advance.note.required': 'A rejection requires a written reason.',
  'recruit.decide.title': 'Offer decision — {applicantNo}',
  'recruit.decide.description':
    'Approving means offering the position. Vacancies are checked first, because offering a post that is already filled is a promise somebody has to take back.',
  'recruit.decide.approve': 'Approve offer',
  'recruit.decide.reject': 'Reject',
  'recruit.hire.title': 'Hire {name} as staff',
  'recruit.hire.description':
    'Name, NRIC, email and phone are carried over from the application. You supply the employee number — it is the key to every terminal and has to match the organisation’s numbering.',
  'recruit.hire.employeeNo': 'Employee no.',
  'recruit.hire.hireDate': 'Start date',
  'recruit.hire.position': 'Position',
  'recruit.hire.position.hint': 'Leave blank to use the posting title.',
  'recruit.hire.department': 'Department',
  'recruit.hire.location': 'Location',
  'recruit.hire.submit': 'Create staff record',
  'recruit.hire.done': '{name} created as staff {employeeNo}, inactive.',

  // ---------------------------------------------------------------------------
  // Archive and settings
  // ---------------------------------------------------------------------------
  'recruit.archive.title': 'Recruitment Archive',
  'recruit.archive.subtitle':
    'Closed postings together with their applicants, kept separately so the active list stays readable.',
  'recruit.archive.tab.postings': 'Closed Postings',
  'recruit.archive.tab.applicants': 'Applicants',
  'recruit.settings.title': 'Recruitment Settings',
  'recruit.settings.subtitle':
    'Who signs off an offer, and what a candidate is told. The wording matters here — the recipient is an outsider, not a staff member.',
};

/** Batch 8b: the approval chain, notifications and email templates shared by every HR module. */
export const EN_LABELS_HR: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // Approval chain
  // ---------------------------------------------------------------------------
  /*
   * `hr.approval.title` was here — 'Approval Flow', which is the name of the tab it sat under. The
   * section heading is the rung count now ('3 approval levels'), a figure that had been exiled to a
   * note below the table.
   */
  'hr.approval.subtitle':
    'Who signs off, and in what order. With no levels configured, a single decision settles a request — that is the default behaviour and it stays that way.',
  'hr.approval.tab': 'Approval Flow',
  'hr.approval.column.level': 'Level',
  'hr.approval.column.approver': 'Approver',
  'hr.approval.column.kind': 'Type',
  'hr.approval.column.note': 'Note',
  'hr.approval.kind.account': 'User',
  'hr.approval.kind.role': 'Role',
  'hr.approval.empty': 'No levels configured. A single decision settles a request.',
  'hr.approval.empty.hint':
    'Add a level to require more than one signature. The first level decides first, and only the last level approves the request.',
  'hr.approval.action.add': 'Add Level',
  'hr.approval.action.up': 'Up',
  'hr.approval.action.down': 'Down',
  'hr.approval.action.remove': 'Remove level',
  'hr.approval.action.suspend': 'Suspend level',
  'hr.approval.action.resume': 'Activate level',
  'hr.approval.suspended': 'Suspended',
  'hr.approval.suspended.note':
    'A suspended level is skipped entirely — the chain becomes shorter rather than stuck at a level with nobody in it.',
  'hr.approval.blocked': '{count} requests are already part-way through this chain',
  /*
   * Both failure modes are named because they are the reason the edit is refused at all: removing a
   * level approves those requests retroactively, adding one asks a level to sign after the request has
   * already passed it.
   */
  'hr.approval.blocked.note':
    'A request that is already part-signed cannot have its levels moved. Removing a level would approve it retroactively; adding one would ask that level to sign after the request has already passed it. Settle or reject those first.',
  'hr.approval.chainLength': 'Chain: {count} levels',
  'hr.approval.chainLength.none': 'Chain: one step',
  'hr.approval.form.title': 'Approval Level',
  'hr.approval.form.by': 'Signed off by',
  'hr.approval.form.byAccount': 'A specific user',
  'hr.approval.form.byRole': 'Anybody with a role',
  'hr.approval.form.byRole.hint':
    'A level that names a role keeps working when people change. A level that names a person is more precise but stalls when they leave.',
  'hr.approval.form.account': 'User',
  'hr.approval.form.role': 'Role',
  'hr.approval.form.note': 'Note',
  'hr.approval.form.note.hint': 'For a level whose purpose is not obvious from its name.',
  'hr.approval.form.candidates.empty':
    'No user or role holds the Approve permission for this module. Grant that permission in Role Management first — a level naming somebody who cannot approve will block every request that reaches them.',
  'hr.approval.form.override':
    'Holders of the Module Settings permission can bypass this order. That is the recovery path when an approver leaves — without it, requests stall forever.',
  'hr.approval.trail.title': 'Decision History',
  'hr.approval.trail.level': 'Level {level}',
  'hr.approval.trail.approved': 'Approved',
  'hr.approval.trail.rejected': 'Rejected',
  'hr.approval.trail.empty': 'No decisions yet.',
  'hr.approval.awaiting': 'Awaiting level {level} ({name})',
  'hr.approval.progress': 'Level {level} of {total}',

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------
  'hr.notify.title': 'Notifications',
  'hr.notify.subtitle':
    'Who is told about a decision. The channels themselves — email, SMS, Telegram — are configured under Settings › Integrations; this decides when this module speaks.',
  'hr.notify.tab': 'Notifications',
  'hr.notify.applicant': 'Notify the applicant',
  'hr.notify.applicant.hint': 'When their request is approved or rejected.',
  'hr.notify.approver': 'Notify the next approver',
  'hr.notify.approver.hint': 'When a request reaches their level.',
  'hr.notify.everyLevel': 'Notify at every level',
  // The quoted word is what the applicant would read, and stays quoted.
  'hr.notify.everyLevel.hint':
    'Off by default. Telling somebody “approved” at level 1 of 3 tells them something that is not true — the request is still pending and can still be rejected.',
  'hr.notify.everyLevel.notApplicable':
    'No effect while this module is a single step. Add levels under Approval Flow first.',
  'hr.notify.cc': 'Copy to',
  'hr.notify.cc.hint': 'One address copied on every decision. Leave blank for none.',
  'hr.notify.saved': 'Notification settings saved.',
  /*
   * The last clause is the honest limitation: there is no outbox, so a gateway that is down at the
   * moment of the decision loses the message.
   */
  'hr.notify.channels':
    'A notification is a side effect of something that has already succeeded, so it never fails the decision. There is no outbox — if the gateway is down when the decision is made, the message is lost.',
  'hr.notify.profile': 'Email profile',
  'hr.notify.profile.hint':
    'Which profile sends this module’s email. Configured under Settings › Integrations › Email. Empty means this module does not send email at all.',
  'hr.notify.profile.none': 'None — do not send email',
  'hr.notify.profile.empty':
    'No email profile is configured yet. Create one under Settings › Integrations › Email first — without one there is no sender to name, and email cannot be sent.',
  'hr.notify.profile.inactive': '(inactive)',
  'hr.notify.profile.notSending':
    'This module does not send email. SMS and Telegram still work if those channels are switched on.',

  // ---------------------------------------------------------------------------
  // Email templates
  // ---------------------------------------------------------------------------
  'hr.template.tab': 'Email Templates',
  'hr.template.title': 'Email Templates',
  'hr.template.subtitle':
    'The words each notification carries. Stored as data rather than code — so changing one sentence is not a release.',
  'hr.template.event.submitted': 'Request received',
  'hr.template.event.levelApproved': 'Approved at an intermediate level',
  'hr.template.event.approved': 'Fully approved',
  'hr.template.event.rejected': 'Rejected',
  'hr.template.event.cancelled': 'Withdrawn',
  'hr.template.event.awaitingApprover': 'Awaiting your approval',
  'hr.template.audience.applicant': 'To the applicant',
  'hr.template.audience.approver': 'To the approver',
  'hr.template.customised': 'Customised',
  'hr.template.default': 'Default',
  'hr.template.disabled': 'Disabled',
  'hr.template.column.event': 'Event',
  'hr.template.column.subject': 'Subject',
  'hr.template.column.state': 'State',
  'hr.template.empty': 'No notification events for this module.',
  'hr.template.action.edit': 'Edit template',
  'hr.template.action.revert': 'Revert to default',
  'hr.template.action.preview': 'Preview',
  'hr.template.form.subject': 'Subject',
  'hr.template.form.body': 'Email body',
  'hr.template.form.enabled': 'Send email for this event',
  'hr.template.form.placeholders': 'Fields you can use',
  'hr.template.form.placeholders.hint':
    'Click to insert. A field this module cannot fill is refused when you save — that is the only moment the mistake is cheap.',
  'hr.template.form.unknown': 'Unknown fields: {names}',
  'hr.template.preview.title': 'Preview',
  'hr.template.preview.hint':
    'Rendered on the server with sample values, through the same substitution that sends real email. No email is sent.',
  'hr.template.saved': 'Template saved.',
  'hr.template.reverted': 'Template reverted to the default.',
  // Outlook is a product name and stays.
  'hr.template.note.paragraphs':
    'A blank line becomes a paragraph. There is no other formatting — a decision notice needs paragraphs and nothing else, and every extra capability is one more way the email renders differently in Outlook.',
  'hr.template.event.payslipReady': 'Payslip ready',
  'hr.template.event.awardApproved': 'Bonus or commission approved',
  'hr.template.event.awardCancelled': 'Bonus or commission cancelled',
  'hr.template.event.lendingApproved': 'Loan or advance approved',
  'hr.template.event.reviewAssigned': 'Review assigned to a reviewer',
  'hr.template.event.appraisalFinalised': 'Review finalised',
};

/** Batch 8c: the report builder. */
export const EN_LABELS_BUILDER: Partial<Record<LabelKey, string>> = {
  'builder.status.open': 'Unresolved',
  'builder.status.resolved': 'Resolved',
  'builder.title': 'Report Builder',
  /*
   * The reason no custom formulas are offered: a second calculation engine would produce numbers that
   * disagree with the attendance engine's, with no way to tell which is right.
   */
  'builder.subtitle':
    'Choose a dataset, the columns, and how to group them. There are no custom formulas here — every column is a value that is already stored, so this report does not become a second calculation engine.',
  'builder.tabs.aria': 'Datasets',
  'builder.error.fields': 'Could not read the field list',
  'builder.error.run': 'Could not generate the report',
  'builder.error.export': 'Could not export the report',
  'builder.run': 'Generate preview',
  'builder.columns': 'Columns',
  'builder.columns.full': 'The {max} column limit has been reached',
  'builder.groupBy': 'Group by',
  'builder.groupBy.none': 'None',
  'builder.limit': 'Preview limit',
  'builder.limit.rows': '{count} rows',
  // `{totals}` is a mid-sentence clause that carries its own leading space or leading full stop.
  'builder.grouped.note':
    'Grouped: each row becomes one group with a record count{totals}. Grouping is calculated over the rows that were read, not the whole database.',
  'builder.grouped.withTotals': ' and totals for the {count} numeric columns selected',
  'builder.grouped.noNumeric':
    '. No numeric column is selected, so only the count is shown — pick a column such as minutes worked to get totals',
  'builder.needColumn': 'Choose at least one column before generating.',
  'builder.search.exceptions': 'Search an exception type…',
  'builder.filter.allStatuses': 'All statuses',
  'builder.stale':
    'The selection changed after this table was generated. Generate it again before reading it.',
  // Names the button, so this has to match `builder.run` exactly.
  'builder.empty.notRun': 'Not generated yet. Choose columns and press Generate preview.',
  'builder.empty.noMatch': 'No rows match these filters.',
  'builder.truncated':
    'The {limit} row limit was reached, so this is a part and not the whole{grouped}. Narrow the period or the filters, or export — the file takes more rows than this preview.',
  'builder.truncated.grouped': '. The totals in each group are partial too',
  'builder.hint.notRun':
    'The preview reads up to the limit chosen. An export takes up to 20,000 rows and says inside the file if that limit was reached.',
  'builder.hint.shown':
    '{count} rows shown{cap} · generated {time}. An export takes up to 20,000 rows.',
  'builder.hint.cap': ' ({limit} limit reached)',
  'builder.export': 'Export CSV',
};

/** Batch 8d: the language list and the translation editor — the screen that translates the labels. */
export const EN_LABELS_TRANSLATION: Partial<Record<LabelKey, string>> = {
  'translation.subtitle': 'The languages the interface can be displayed in.',
  'translation.action.add': 'Add Language',
  'translation.empty': 'No languages.',
  'translation.error.load': 'Could not load the language list',
  'translation.error.status': 'Could not change the status',
  'translation.error.default': 'Could not change the default language',
  'translation.error.remove': 'Could not remove the language',
  'translation.notice.enabled': '{name} enabled.',
  'translation.notice.disabled': '{name} disabled. The interface returns to the source language.',
  'translation.notice.default':
    '{name} is now the default language — this is the language every user opens.',
  'translation.notice.added': '{name} added. It stays inactive until you enable it.',
  'translation.notice.removed': '{name} removed.',
  'translation.notice.removed.withTranslations':
    '{name} removed along with {count} translations.',
  'translation.numbers.show': 'Show Labels',
  'translation.numbers.hide': 'Hide Labels',
  // The three slots carry the coloured sample badges.
  'translation.numbers.legend':
    'Label numbers are being shown across the interface. An amber {source} means it is still the source wording, a green {translated} means it has been translated, and {unregistered} means the label is not registered yet. This mode switches itself off when the browser tab closes.',
  'translation.column.language': 'Language',
  'translation.column.code': 'Code',
  'translation.column.translated': 'Labels translated',
  'translation.column.default': 'Default',
  'translation.row.isSource': 'Source language — its words come from the application code',
  'translation.row.all': 'All ({count})',
  'translation.row.progress': '{translated} / {total}',
  'translation.row.incomplete': 'incomplete',
  'translation.row.default': 'Default',
  'translation.row.viewSource': 'View labels — the source language cannot be edited',
  'translation.row.edit': 'Edit the {name} translation',
  'translation.row.alreadyDefault': '{name} is already the default language',
  'translation.row.needsActive':
    'Enable this language first — the default is the one every user opens',
  'translation.row.makeDefault': 'Make {name} the default language',
  'translation.row.sourceNameLocked': 'The source language name cannot be changed',
  'translation.row.rename': 'Rename language',
  'translation.row.sourceAlwaysActive': 'The source language is always active',
  'translation.row.defaultLocked':
    'This is the default language — make another one the default first',
  'translation.row.disable': 'Disable language',
  'translation.row.enable': 'Enable language',
  'translation.row.sourceUndeletable':
    'The source language cannot be removed — the labels are written in it',
  'translation.row.remove': 'Remove {name}',
  /*
   * `{inactive}` carries the state word. The reasoning is the second sentence: a half-translated
   * language that is switched on reads as a broken screen rather than as unfinished work.
   */
  'translation.note.addedInactive':
    'A new language is added {inactive}. A half-translated language that is then enabled shows screens that are half one language and half the other, which reads as a broken screen rather than as a translation that is not finished.',
  'translation.note.addedInactive.inactive': 'inactive',
  'translation.note.fallback':
    'An empty translation means that label falls back to the source language. No label will ever be blank on screen because it has not been translated.',
  'translation.add.title': 'Add language',
  'translation.add.description':
    'A language is added inactive until its translation is ready.',
  'translation.add.submit': 'Add',
  'translation.add.error': 'Could not add the language',
  'translation.field.name': 'Language name',
  'translation.field.name.hint': 'As it will appear in the list.',
  // Mask: the example is a language name and stays as it is.
  'translation.field.name.placeholder': 'English',
  'translation.field.code': 'Language code',
  'translation.field.code.hint':
    'Two letters, or two letters with a variant such as zh-Hans. It becomes part of the URL, so it cannot be changed afterwards.',
  'translation.field.code.placeholder': 'en',
  'translation.field.code.short': 'Code',
  'translation.field.code.locked': 'Cannot be changed.',
  'translation.rename.title': 'Rename "{name}"',
  'translation.rename.error': 'Could not rename it',
  'translation.remove.title': 'Remove language "{name}"?',
  'translation.remove.withTranslations':
    '{count} translations that have already been written will be removed with it.',
  'translation.remove.empty': 'No translations have been written for this language yet.',
  'translation.remove.hint':
    'If you only want to stop offering it, disable the language instead — its translations stay.',
  'translation.editor.error.load': 'Could not load the labels',
  'translation.editor.saved': '{count} translations saved.',
  'translation.editor.saved.cleared': '{count} translations saved, {cleared} cleared.',
  'translation.editor.subtitle': 'The Malay wording on the left, the translation on the right.',
  'translation.editor.subtitle.source':
    'The source language. Its words come from the application code and are not edited here.',
  'translation.editor.progress': '{done} / {total}',
  'translation.editor.back': 'Language list',
  /*
   * The last clause is the argument: a stored copy becomes a second place the wording is set, and it
   * wins over every later correction made in the code.
   */
  'translation.editor.sourceWarning':
    'This is the source language. Its words are written in the application code, so they cannot be edited here — a stored copy would become a second place the wording is set, and that copy would win over every correction made later in the code.',
  'translation.editor.group': 'Labels',
  'translation.editor.group.subtitle':
    'The number beside each label is its ID, and it does not change.',
  'translation.editor.labelCount': '{count} labels',
  'translation.editor.hint':
    'Leave it blank to use the Malay wording. An untranslated label will not be blank on screen.',
  'translation.editor.dirty': 'There are unsaved changes.',
  'translation.editor.clean': 'No changes.',
  'translation.editor.save': 'Save translations',
  'translation.editor.row.aria': 'Translation for {source}',
};

/** Batch 8e: the monthly summary and the payroll export. */
export const EN_LABELS_PAYROLL: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // Monthly summary
  // ---------------------------------------------------------------------------
  'monthly.title': 'Monthly Summary',
  'monthly.subtitle':
    'Day counts and total minutes for each staff member, calculated from the attendance records.',
  'monthly.loading': 'Loading…',
  'monthly.section.subtitle': '{staff} staff · {days} calendar days in the period',
  'monthly.export': 'Export CSV',
  'monthly.error.load': 'Could not generate the summary',
  'monthly.empty': 'No staff match these filters.',
  'monthly.stat.presentDays': 'Days present',
  'monthly.stat.presentDays.hint': 'of {total} days scheduled',
  'monthly.stat.lateDays': 'Days late',
  'monthly.stat.lateDays.hint': '{hours} accumulated',
  'monthly.stat.absentDays': 'Days absent',
  'monthly.stat.workedHours': 'Hours worked',
  // OT is the abbreviation used on the screens and stays.
  'monthly.stat.workedHours.hint': 'OT {hours}',
  'monthly.stat.incompleteDays': 'Incomplete days',
  'monthly.stat.incompleteDays.hint': 'usually a missing out-scan',
  'monthly.unresolved.count': '{count} unresolved exceptions',
  // `{emphasis}` and `{kinds}` are mid-sentence slots; `{link}` carries the navigation link.
  'monthly.unresolved.note':
    '{emphasis} in this period{kinds}. Hours worked for those days may be lower than they really are. Resolve them under {link} before using these figures.',
  'monthly.unresolved.link': 'Attendance › Exceptions',
  'monthly.column.staff': 'Staff',
  'monthly.column.department': 'Department',
  'monthly.column.present': 'Present',
  'monthly.column.late': 'Late',
  'monthly.column.absent': 'Absent',
  'monthly.column.onLeave': 'On leave',
  'monthly.column.workedHours': 'Hours worked',
  'monthly.column.overtime': 'OT',
  'monthly.row.expand': 'staff details',
  'monthly.byDept.title': 'By department',
  'monthly.byDept.subtitle':
    'Sorted by days absent — the departments that most need attention sit at the top.',
  'monthly.byDept.empty': 'No departments.',
  'monthly.byDept.column.incomplete': 'Incomplete',
  'monthly.byDept.column.exceptions': 'Exceptions',
  'monthly.detail.scheduledDays': 'Days scheduled',
  'monthly.detail.presentDays': 'Days present',
  'monthly.detail.lateDays': 'Days late',
  'monthly.detail.absentDays': 'Days absent',
  'monthly.detail.incompleteDays': 'Incomplete days',
  'monthly.detail.leaveDays': 'Days on leave',
  'monthly.detail.restDays': 'Rest days',
  'monthly.detail.holidayDays': 'Public holidays',
  'monthly.detail.workedHours': 'Hours worked',
  'monthly.detail.lateMinutes': 'Minutes late',
  'monthly.detail.earlyLeaveMinutes': 'Minutes left early',
  'monthly.detail.overtimeHours': 'Overtime hours',
  /*
   * The reading this note exists to prevent: no records looks like somebody who did not work, when it
   * almost always means somebody who could not scan at all.
   */
  'monthly.detail.noRecords':
    'Not one attendance record in this period. That usually means this person could not scan at all — not that they did not work. Check the biometrics and the terminal ID mapping.',
  'monthly.detail.openExceptions':
    '{count} unresolved exceptions for this person in this period. The hours worked above may be lower than they really are.',
  'monthly.detail.incompleteNote':
    '{count} incomplete days — almost always a missing out-scan. Fix the cause and run a recompute; do not edit the result.',

  // ---------------------------------------------------------------------------
  // Payroll export
  // ---------------------------------------------------------------------------
  // Matches `nav.reports.payroll`, which is already "Payroll Export".
  'payroll.title': 'Payroll Export',
  'payroll.subtitle':
    'One row per staff member: days scheduled, days present, and total minutes for the period chosen. Hours are exported as decimal hours, the form a payroll system accepts.',
  'payroll.period': '{from} to {to}',
  'payroll.period.withDays': '{from} to {to} · {days} calendar days',
  'payroll.staffCount': '{count} staff active in this period',
  'payroll.error.load': 'Could not read the payroll preview',
  'payroll.stat.scheduledDays': 'Days scheduled',
  'payroll.stat.scheduledDays.hint': 'excludes rest days and public holidays',
  'payroll.stat.presentDays': 'Days present',
  'payroll.stat.presentDays.hint': '{late} of them late',
  'payroll.stat.absentDays': 'Days absent',
  'payroll.stat.absentDays.hint': '{leave} days of approved leave',
  'payroll.stat.workedHours': 'Hours worked',
  'payroll.stat.workedHours.hint': '{decimal} decimal hours in the file',
  'payroll.stat.overtimeHours': 'Overtime hours',
  'payroll.stat.overtimeHours.hint': '{minutes} minutes late',
  'payroll.safe':
    'Every check passed. No exceptions outstanding, every active staff member has records, and no scan was recorded while a terminal clock had drifted.',
  'payroll.unsafe.count': '{failing} of {total} checks failed.',
  /*
   * `{emphasis}` carries the failure line. Exporting is allowed on purpose — payroll has a deadline —
   * and the warning is written into the file itself rather than only shown here.
   */
  'payroll.unsafe.note':
    '{emphasis} The export is still allowed — payroll has a deadline — and this warning is written as a comment row inside the CSV file. But the figures for the days involved may be lower than they really are.',
  'payroll.filter.fromDate': 'From date',
  'payroll.filter.toDate': 'To date',
  'payroll.filter.between': 'to',
  'payroll.check.empty': 'No checks for this period.',
  'payroll.check.column.name': 'Check',
  'payroll.check.column.count': 'Count',
  'payroll.check.column.effect': 'Effect on the file',
  'payroll.check.unresolvedExceptions': 'Unresolved exceptions',
  'payroll.check.unresolvedExceptions.clear':
    'No exceptions outstanding in this period.',
  'payroll.check.staffWithoutRecords': 'Staff with no records at all',
  'payroll.check.staffWithoutRecords.clear':
    'Every active staff member has at least one record in this period.',
  'payroll.check.clockDrift': 'Scans taken while a terminal clock had drifted',
  'payroll.check.clockDrift.clear':
    'No scan was recorded while a terminal clock had drifted past the threshold.',
  'payroll.exceptions.title': 'Unresolved exceptions',
  'payroll.exceptions.subtitle':
    'Each one is a day the engine could not resolve on its own. Fix the cause and run a recompute — do not edit the result.',
  'payroll.exceptions.open': 'Open exceptions',
  'payroll.exceptions.empty': 'None.',
  'payroll.exceptions.column.kind': 'Type',
  'payroll.exceptions.column.count': 'Count',
  // `{hash}` carries the "#" symbol. Excel and UTF-8 BOM are literal and stay.
  'payroll.export.hint':
    'The file carries a UTF-8 BOM so Excel does not mangle Malay names, and {hash} comment rows above the header stating the period, the staff count, and the exception warnings.',
  // Appended to the hint above, so it keeps its leading space.
  'payroll.export.readAt': ' Read {time} · timezone {zone}.',
  'payroll.export.submit': 'Export payroll CSV',
  'payroll.export.permission': 'Payroll Export › export',
  'payroll.export.denied':
    'You can read this preview but not generate it as a file. Ask for the {permission} permission if you need it.',
  'payroll.check.pendingOvertime': 'Overtime not yet decided',
  'payroll.check.pendingOvertime.clear':
    'Every overtime application in this period has been approved or rejected.',
};

/** Batch 9a: appraisal forms, appraisal periods, assignments, reviews and results. */
export const EN_LABELS_KPI: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // Appraisal forms
  // ---------------------------------------------------------------------------
  'kpi.template.title': 'Appraisal Forms',
  // The 0–100 range uses an en dash, as in the source.
  'kpi.template.subtitle':
    'The competencies that are asked about and the weight of each. Every competency is scored 0–100 and the weight is its percentage, so they total 100.',
  'kpi.template.column.code': 'Code',
  'kpi.template.column.name': 'Name',
  'kpi.template.column.items': 'Competencies',
  'kpi.template.column.weight': 'Total Weight',
  'kpi.template.column.used': 'In use',
  'kpi.template.empty': 'No appraisal forms.',
  'kpi.template.error.load': 'The form list could not be loaded.',
  'kpi.template.action.new': 'New Form',
  'kpi.template.action.edit': 'Edit form',
  'kpi.template.action.delete': 'Remove form',
  'kpi.template.action.view': 'View',
  'kpi.template.weightOff': 'Totals {total}, not 100',
  'kpi.template.form.title': 'Appraisal Form',
  'kpi.template.form.code': 'Code',
  'kpi.template.form.name': 'Name',
  'kpi.template.form.description': 'Description',
  'kpi.template.form.items': 'Competencies',
  'kpi.template.form.item.weight': 'Weight (%)',
  'kpi.template.form.item.add': 'Add competency',
  'kpi.template.form.item.remove': 'Remove',
  'kpi.template.form.total': 'Total: {total}%',
  'kpi.template.form.total.ok': 'Total: {total}% — correct',
  'kpi.template.form.active': 'Active',

  // ---------------------------------------------------------------------------
  // Appraisal periods
  // ---------------------------------------------------------------------------
  'kpi.period.title': 'Appraisal Periods',
  'kpi.period.subtitle':
    'The due date is when the appraisal is expected, not when the period ends. A January–June cycle is usually appraised in July.',
  'kpi.period.status.open': 'Open',
  'kpi.period.status.closed': 'Closed',
  'kpi.period.column.code': 'Code',
  'kpi.period.column.name': 'Name',
  'kpi.period.column.span': 'Period Appraised',
  'kpi.period.column.due': 'Due',
  'kpi.period.column.assignments': 'Appraisals',
  'kpi.period.column.outstanding': 'Not Submitted',
  'kpi.period.empty': 'No appraisal periods.',
  'kpi.period.error.load': 'The period list could not be loaded.',
  'kpi.period.action.new': 'New Period',
  'kpi.period.action.close': 'Close period',
  'kpi.period.action.delete': 'Remove period',
  /*
   * Both refusals are argued: a period that cannot be assigned is a row nobody can use, and reopening
   * one whose grades have already been read may already have driven a bonus.
   */
  'kpi.period.note.forward':
    'A period is created already open, and only moves forward: open → closed. There is no draft state, because a period that cannot be assigned is a row nobody can use. A closed period is not reopened: the grades in it have already been read, and may already have driven a bonus.',
  'kpi.period.close.outstanding':
    '{count} appraisals have not been submitted. Closing the period now leaves them permanently without a grade.',
  'kpi.period.close.confirm': 'I understand — close it anyway',
  'kpi.period.form.title': 'Appraisal Period',
  'kpi.period.form.code': 'Code',
  'kpi.period.form.name': 'Name',
  'kpi.period.form.from': 'Period appraised from',
  'kpi.period.form.to': 'To',
  'kpi.period.form.due': 'Appraisal due',
  'kpi.period.form.due.hint':
    'After the end of the period — earlier than that means appraising work that has not happened yet.',

  // ---------------------------------------------------------------------------
  // Assignments
  // ---------------------------------------------------------------------------
  'kpi.assignment.title': 'KPI Assignments',
  'kpi.assignment.subtitle':
    'Who is appraised, by whom, on which form. Nobody can appraise themselves, and one person can only be appraised once in a period.',
  'kpi.assignment.status.pending': 'Not Started',
  'kpi.assignment.status.inProgress': 'In Progress',
  'kpi.assignment.status.submitted': 'Submitted',
  'kpi.assignment.status.finalised': 'Finalised',
  'kpi.assignment.column.period': 'Period',
  'kpi.assignment.column.staff': 'Appraised',
  'kpi.assignment.column.template': 'Form',
  'kpi.assignment.column.progress': 'Progress',
  'kpi.assignment.column.score': 'Score',
  'kpi.assignment.column.grade': 'Grade',
  'kpi.assignment.progress': '{scored} of {total}',
  'kpi.assignment.empty': 'No assignments.',
  'kpi.assignment.error.load': 'The assignment list could not be loaded.',
  'kpi.assignment.action.new': 'Assign Appraisal',
  'kpi.assignment.action.open': 'Open form',
  'kpi.assignment.action.delete': 'Remove assignment',
  'kpi.assignment.form.title': 'KPI Assignment',
  'kpi.assignment.form.period': 'Period',
  'kpi.assignment.form.staff': 'Staff appraised (ID)',
  'kpi.assignment.form.template': 'Form',
  'kpi.assignment.form.reviewer': 'Reviewer',

  // ---------------------------------------------------------------------------
  // Filling in a review
  // ---------------------------------------------------------------------------
  'kpi.review.title': 'Appraisal Review',
  'kpi.review.subtitle':
    'Every competency is scored 0–100. The form can be saved part-finished; completeness is checked when it is submitted.',
  'kpi.review.filter.mine': 'My appraisals only',
  'kpi.review.form.title': 'Appraisal — {staffName}',
  'kpi.review.form.item': 'Competency',
  'kpi.review.form.weight': 'Weight',
  'kpi.review.form.score': 'Score (0–100)',
  'kpi.review.form.comment': 'Comment',
  'kpi.review.form.running': 'Weighted total: {total}%',
  // `{total_items}` keeps its exact name; renaming it empties the field.
  'kpi.review.form.running.partial':
    'So far answered: {total}% ({scored} of {total_items})',
  'kpi.review.action.save': 'Save',
  'kpi.review.action.submit': 'Submit',
  'kpi.review.action.reopen': 'Reopen',
  'kpi.review.action.finalise': 'Finalise',
  'kpi.review.saved': 'Scores saved.',
  'kpi.review.submitted': 'Submitted: {total}% — grade {grade}.',
  'kpi.review.finalised': 'The appraisal has been finalised.',
  'kpi.review.reopened': 'The appraisal has been reopened.',
  'kpi.review.reopen.note': 'Reason for reopening',
  /*
   * The second clause is why answers survive a reopen: the reviewer is being asked to look again, not
   * to start from nothing.
   */
  'kpi.review.reopen.hint':
    'The score and grade are cleared, because showing a figure for an appraisal that is being changed would mislead. Answers already filled in stay — the reviewer is being asked to look again, not to start from scratch.',
  'kpi.review.note.reviewerOnly':
    'Only the assigned reviewer can fill in this form. The screen permission allows filling in appraisals; it does not decide which ones.',
  'kpi.review.note.locked':
    'A finalised appraisal cannot be changed — it is the record of the grade.',

  // ---------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------
  'kpi.result.title': 'KPI Results',
  /*
   * The reason this is a separate screen with a separate permission: a grade carries a bonus, and the
   * people who may read one are not the people who may reopen the appraisal behind it.
   */
  'kpi.result.subtitle':
    'Finalised grades only. A separate screen with a separate permission: a grade carries a bonus, and the people who may read one are not the people who may reopen the appraisal behind it.',
  'kpi.result.column.period': 'Period',
  'kpi.result.column.staff': 'Staff',
  'kpi.result.column.department': 'Department',
  'kpi.result.column.score': 'Score',
  'kpi.result.column.grade': 'Grade',
  'kpi.result.column.finalised': 'Finalised',
  'kpi.result.empty': 'No finalised results.',
  'kpi.result.error.load': 'The results could not be loaded.',
};

/** Batch 9b: grade bands, the competency catalogue, form audits and the refusal messages. */
export const EN_LABELS_KPI_SETTINGS: Partial<Record<LabelKey, string>> = {
  'kpi.result.distribution': 'Grade distribution',
  'kpi.result.filter.grade': 'All grades',
  'kpi.result.filter.period': 'All periods',

  // ---------------------------------------------------------------------------
  // Grade bands
  // ---------------------------------------------------------------------------
  'kpi.grade.title': 'KPI Settings',
  /*
   * Both failure modes are named because they are what the coverage check exists to prevent: a gap
   * leaves a score with no grade, an overlap gives the same score different grades.
   */
  'kpi.grade.subtitle':
    'The grades and their score bands. The bands have to cover 0–100 exactly once — a gap means a score that gets no grade at all, and an overlap means the same score gets a different grade depending on the order it was read in.',
  'kpi.grade.column.code': 'Grade',
  'kpi.grade.column.name': 'Name',
  'kpi.grade.column.band': 'Score Band',
  'kpi.grade.column.bonus': 'Bonus',
  'kpi.grade.empty': 'No grades configured.',
  'kpi.grade.error.load': 'The grades could not be loaded.',
  'kpi.grade.action.add': 'New Grade',
  'kpi.grade.action.remove': 'Remove grade',
  'kpi.grade.action.save': 'Save grade set',
  'kpi.grade.form.code': 'Code',
  'kpi.grade.form.name': 'Name',
  'kpi.grade.form.min': 'Minimum (%)',
  'kpi.grade.form.max': 'Maximum (%)',
  'kpi.grade.form.bonus': 'Bonus (months of basic salary)',
  'kpi.grade.form.bonus.hint':
    'Leave blank if this grade carries no bonus. The {max} month ceiling is a typo guard rather than policy — a stray zero turns one month into ten, and it only shows up after the payslips are generated.',
  'kpi.grade.covered': 'The bands cover 0–100 with no gap or overlap.',
  'kpi.grade.saved': 'Grades saved.',
  'kpi.grade.note.set':
    'Grades are saved as one set because the bands are only valid together. Saving a single grade could leave a gap that stays invisible until somebody tries to submit an appraisal.',
  'kpi.grade.note.history':
    'The grade on a finalised appraisal is stored as a code, not a reference. Removing a grade does not change past appraisals — they keep naming the grade that was awarded.',
  'kpi.review.filter.all': 'All appraisals',

  // ---------------------------------------------------------------------------
  // Competency catalogue
  // ---------------------------------------------------------------------------
  'kpi.competency.title': 'Competency Catalogue',
  // The quoted example keeps the source's straight quotes.
  'kpi.competency.subtitle':
    'The wording every appraisal form picks from. One competency, one spelling — without a catalogue, "Communication" is typed ten times with ten spellings and nobody can ask what its average score is.',
  'kpi.competency.category.core': 'Core',
  'kpi.competency.category.functional': 'Functional',
  'kpi.competency.category.leadership': 'Leadership',
  'kpi.competency.category.core.hint': 'Applies to all staff, whatever their job.',
  'kpi.competency.category.functional.hint':
    'The work itself — procedures, equipment, area of duty.',
  'kpi.competency.category.leadership.hint': 'Only for those accountable for other people.',
  'kpi.competency.column.name': 'Competency',
  'kpi.competency.column.category': 'Category',
  'kpi.competency.column.used': 'In use',
  'kpi.competency.used': '{count} forms',
  'kpi.competency.used.none': 'Not used yet',
  'kpi.competency.empty': 'The catalogue is still empty.',
  'kpi.competency.error.load': 'The competency catalogue could not be loaded.',
  'kpi.competency.action.new': 'New Competency',
  'kpi.competency.action.edit': 'Edit competency',
  'kpi.competency.action.delete': 'Remove competency',
  'kpi.competency.action.deactivate': 'Deactivate',
  'kpi.competency.action.activate': 'Reactivate',
  'kpi.competency.form.title': 'Competency',
  'kpi.competency.form.name': 'Name',
  'kpi.competency.form.name.hint':
    'Trailing spaces and double spaces are stripped before saving — otherwise one extra space produces a second competency that reads identically.',
  'kpi.competency.form.category': 'Category',
  'kpi.competency.form.category.hint':
    'Groups the pick list only. It does not affect the arithmetic: a leadership competency at 10% is worth the same as a core competency at 10%.',
  'kpi.competency.form.description': 'Description',
  'kpi.competency.form.description.hint':
    'What a reviewer should be thinking about when scoring this row.',
  'kpi.competency.form.active': 'Active',
  'kpi.competency.saved': 'Competency saved.',
  'kpi.competency.removed': 'Competency removed.',
  'kpi.competency.renamed':
    'Renamed. The {count} forms that ask about it were updated too; appraisals already created keep the wording that was put to those people.',
  // The quoted question keeps the source's straight quotes.
  'kpi.competency.note.retire':
    'Deactivate rather than remove. A deactivated competency disappears from the pick list for new forms but its wording stays on the forms already using it — which is why "which forms use this" can still be answered next year.',
  'kpi.competency.note.inUse':
    'A competency currently used by a form cannot be removed. Deactivate it instead.',
  'kpi.competency.inactive': 'Inactive',

  // ---------------------------------------------------------------------------
  // Form composition
  // ---------------------------------------------------------------------------
  /*
   * The point is the snapshot: each appraisal keeps its own copy of the questions and weights, which is
   * what makes editing a form safe and a typo still fixable.
   */
  'kpi.template.note.editable':
    'A form can be edited even after it has been used. Each appraisal stores its own copy of the questions and weights at the moment it is created, so editing a form does not change appraisals that are already signed off — and a typo can still be fixed.',
  'kpi.template.note.catalogue':
    'Competencies are picked from the catalogue under KPI Settings, not typed. That is what lets one competency be compared across forms.',
  'kpi.template.retiredItem':
    'This competency has been deactivated in the catalogue. Its wording stays here; it cannot be picked on a new form.',
  'kpi.template.form.item.competency': 'Competency',
  'kpi.template.form.item.competency.placeholder': 'Pick from the catalogue',
  'kpi.template.form.equalise': 'Equal weights',
  'kpi.template.form.equalise.hint':
    'The remainder is rounded onto the last row, so the total is exactly 100.',
  'kpi.template.form.catalogueEmpty':
    'The competency catalogue is still empty. Add competencies under KPI Settings › Competencies first — forms are built from the catalogue, not from free text.',
  'kpi.audit.noItems': 'This form has no competencies, so there is nothing to score.',
  'kpi.audit.weightOver':
    'The weights total {total}% — {difference}% too much. Two people are only on the same scale if both forms are read over the same total.',
  'kpi.audit.weightUnder':
    'The weights total {total}% — {difference}% too little. Two people are only on the same scale if both forms are read over the same total.',
  'kpi.audit.duplicateCompetency':
    '"{name}" is listed more than once. It would be weighted twice and read as two questions.',
  'kpi.period.delete.hasAssignments':
    'This period contains {count} appraisals. Removing it removes those appraisals too.',
  'kpi.assignment.form.reviewer.hint':
    'One person, named. Appraisals have no chain of approval levels: they are reviewed by the person named here, not by whoever holds a particular level.',
  'kpi.assignment.note.snapshot':
    'Assigning an appraisal copies the form’s questions and weights onto that appraisal, there and then. Editing the form afterwards does not change appraisals that are already assigned.',
  'kpi.assignment.note.oneReviewer':
    'The screen permission allows somebody to fill in appraisals; it does not decide which ones. Only the reviewer named on the assignment can fill in its form.',
  /*
   * The worked example is the argument: counting unanswered rows as zero would show 12% after a first
   * answer of 60, which reads as a bad score rather than an unfinished form.
   */
  'kpi.review.form.running.hint':
    'Calculated over the competencies already answered. Unanswered rows do not count as zero — otherwise a first answer of 60 would display 12%.',
  'kpi.review.form.unanswered': 'Not answered',
  'kpi.review.note.snapshot':
    'The questions and weights on this form are a copy taken when the appraisal was assigned. They do not change even if the original form is edited.',
  'kpi.review.incomplete':
    '{scored} of {total} competencies have been scored. Unanswered competencies drop out of the calculation, so submitting now totals a form that was only half read.',
  'kpi.result.column.bonus': 'Bonus',
  'kpi.result.bonusMonths': '{months} months of basic salary',
  'kpi.result.bonusNone': 'No bonus',
  'kpi.result.note.bonus':
    'A bonus is stated in months of basic salary, not as an amount. It becomes money only when a payroll period freezes it onto a bonus row — until then the amount changes every time that person’s basic salary changes.',
  'kpi.settings.tab.competencies': 'Competencies',
  'kpi.settings.tab.grades': 'Grade Bands',
  // Names the tab that other modules do have, so it matches `hr.approval.tab`.
  'kpi.settings.note.noChain':
    'This module has no Approval Flow tab. An appraisal moves through scoring, not signatures — there is no level waiting, so a chain here would configure nothing.',

  // ---------------------------------------------------------------------------
  // Band editing and refusals
  // ---------------------------------------------------------------------------
  // The spaced en dash is the band separator and stays exactly as it is.
  'kpi.grade.band': '{min}% – {max}%',
  'kpi.grade.action.edit': 'Edit grade',
  'kpi.grade.form.title': 'Grade Band',
  'kpi.grade.form.color': 'Colour',
  // The letter list is a column of grade codes and stays.
  'kpi.grade.form.color.hint':
    'The colour of the chip behind the grade letter. A grade is glanced at, not read — a column of A/B/C/D/E in one colour forces somebody to work through it.',
  'kpi.grade.bonusMonths': '{months} months',
  'kpi.grade.bonusNone': 'None',
  'kpi.grade.faults': 'The grade bands have problems',
  'kpi.grade.note.boundary':
    'A grade is found by taking the highest band whose floor the score reaches. A score exactly on a boundary gets the better grade — the same answer on every screen, and one that can be defended out loud.',
  'kpi.refuse.noBands': 'At least one grade band is required.',
  'kpi.refuse.badBand': 'Grade {code} has an invalid number.',
  'kpi.refuse.bandOrder': 'Grade {code}: the minimum score is above the maximum.',
  'kpi.refuse.bandRange': 'Grade {code} falls outside 0–100.',
  'kpi.refuse.bandDuplicate': 'The grade code "{code}" is used more than once.',
  'kpi.refuse.bandStart':
    'The lowest band starts at {lowest}%, not 0. Scores below that get no grade at all.',
  'kpi.refuse.bandEnd':
    'The highest band ends at {highest}%, not 100. Scores above that have no band that owns them.',
  'kpi.refuse.bandOverlap':
    'Grades {first} and {second} overlap. The same score would get a different grade depending on the order it was read in.',
  'kpi.refuse.bandGap':
    'A gap between grades {first} and {second}: scores {from}% to {to}% get no grade.',
};

/**
 * Batch 10a: payroll enums, refusal messages, and the payroll period lifecycle.
 *
 * KWSP, PERKESO and SIP are rendered as EPF, SOCSO and EIS. Those are the same three bodies' own
 * English names — the ones printed on their English forms — and they are what an English-reading
 * payroll clerk in Malaysia actually uses. Leaving the Malay acronyms would be the odd choice here.
 */
export const EN_LABELS_PAY: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // Enum maps
  // ---------------------------------------------------------------------------
  'pay.status.draft': 'Draft',
  'pay.status.processing': 'Processed',
  'pay.status.approved': 'Approved',
  'pay.status.paid': 'Paid',
  'pay.status.closed': 'Closed',
  'pay.state.draft': 'Draft',
  'pay.state.pending': 'Pending',
  'pay.state.approved': 'Approved',
  'pay.state.active': 'Active',
  'pay.state.completed': 'Completed',
  'pay.state.paid': 'Paid',
  'pay.state.cancelled': 'Cancelled',
  'pay.bonusType.performance': 'Performance',
  'pay.bonusType.annual': 'Annual',
  'pay.bonusType.festival': 'Festive',
  'pay.bonusType.project': 'Project',
  'pay.bonusType.attendance': 'Attendance',
  'pay.bonusType.other': 'Other',
  'pay.commissionType.sales': 'Sales',
  'pay.commissionType.project': 'Project',
  'pay.commissionType.referral': 'Referral',
  'pay.commissionType.other': 'Other',
  'pay.method.bank_transfer': 'Bank transfer',
  'pay.method.cash': 'Cash',
  'pay.method.cheque': 'Cheque',
  'pay.calcMode.fixed': 'Fixed amount (RM)',
  'pay.calcMode.percentOfBasic': 'Percentage of basic salary (%)',

  // ---------------------------------------------------------------------------
  // Refusals
  // ---------------------------------------------------------------------------
  'pay.settings.fault.percent': 'The rate has to be between 0 and 100.',
  'pay.settings.fault.amount': 'The amount has to be between 0 and 1,000,000.',
  'pay.settings.fault.payDay': 'The pay day has to be a day of the month, 1 to 31.',
  /*
   * The second sentence is the reason this is refused rather than accepted: the statutory step at that
   * ceiling goes down, not up, so a higher rate above it is always a data-entry error.
   */
  'pay.settings.fault.step':
    'The employer rate above the ceiling cannot exceed the rate below it. The statutory step at that ceiling goes down, not up.',
  'pay.period.fault.status': 'That period status is not recognised.',
  'pay.period.fault.transition':
    'The status order is draft → process → approve → pay → close, with no way back.',
  'pay.payslip.fault.gross': 'The earning rows do not add up to the gross pay.',
  'pay.payslip.fault.deductions': 'The deduction rows do not add up to the total deductions.',
  'pay.payslip.fault.net': 'Gross pay less deductions does not equal the net pay.',

  // ---------------------------------------------------------------------------
  // Payroll periods
  // ---------------------------------------------------------------------------
  'pay.period.title': 'Payroll Periods',
  /*
   * The argument for consuming hours rather than counting them: two engines computing the same hours
   * produce two answers nobody reconciles.
   */
  'pay.period.subtitle':
    'One pay run, and how far it has moved. The hours come from the Payroll Export — a period does not count hours itself, because two engines counting the same hours produce two answers nobody reconciles.',
  'pay.period.tab.periods': 'Periods',
  'pay.period.tab.payslips': 'Payslips',
  'pay.period.action.add': 'New period',
  'pay.period.action.process': 'Process',
  'pay.period.action.approve': 'Approve',
  'pay.period.action.pay': 'Mark as paid',
  'pay.period.action.close': 'Close',
  'pay.period.action.export': 'Export CSV',
  'pay.period.action.remove': 'Remove period',
  'pay.period.column.code': 'Code',
  'pay.period.column.range': 'Range',
  'pay.period.column.payment': 'Payment date',
  'pay.period.column.staff': 'Payslips',
  'pay.period.column.gross': 'Gross (RM)',
  'pay.period.column.deductions': 'Deductions (RM)',
  'pay.period.column.net': 'Net (RM)',
  'pay.period.empty': 'No payroll periods. Create one to start.',
  'pay.period.error.load': 'The period list could not be loaded.',
  'pay.period.range': '{from} to {to}',
  'pay.period.filter.year': 'All years',
  'pay.period.stat.periods': 'Periods',
  'pay.period.stat.periods.hint': '{draft} still draft',
  'pay.period.stat.gross': 'Gross this year',
  'pay.period.stat.gross.hint': 'total of every period shown',
  'pay.period.stat.net': 'Net this year',
  'pay.period.stat.net.hint': 'after employee deductions',
  'pay.period.stat.employer': 'Employer cost',
  'pay.period.stat.employer.hint': 'the employer share of EPF, SOCSO and EIS',
  /*
   * Reprocessing a draft is what lets a corrected terminal clock or a repaired identity mapping flow
   * back in. After approval the figures are the record, so a mistake becomes an adjustment.
   */
  'pay.period.note.oneWay':
    'The order is one-way: draft → process → approve → pay → close. A draft can be reprocessed as many times as needed — that is what lets a corrected terminal clock or a repaired identity mapping flow back in. Once approved, those figures are the record, and a mistake is corrected as an adjustment in the following period.',
  'pay.period.note.unreviewed':
    'The statutory rates (EPF, SOCSO, EIS) have not been confirmed against the current schedules. Every deduction is calculated from the default values. Confirm them under Payroll Settings before the period is paid.',
  'pay.period.note.reviewLink': 'Open Payroll Settings',
  'pay.period.form.title': 'New payroll period',
  'pay.period.form.edit': 'Edit period',
  'pay.period.form.name': 'Period name',
  // The quoted example keeps the source's straight quotes.
  'pay.period.form.name.hint':
    'What people call this run, e.g. "August 2026 Salary".',
  'pay.period.form.year': 'Year',
  'pay.period.form.month': 'Month',
  'pay.period.form.month.hint':
    'Names the run and orders the list. It is not the period boundary — the range below decides which days are paid.',
  'pay.period.form.from': 'From date',
  'pay.period.form.to': 'To date',
  'pay.period.form.range.hint':
    'A 26th-to-25th cycle is common, so this range is independent of the month above.',
  'pay.period.form.payment': 'Payment date',
  'pay.period.form.note': 'Note',
  'pay.period.form.submit': 'Create period',
  'pay.period.process.title': 'Process period {code}',
  /*
   * The refund of instalments is stated because it is what stops a reprocess from deducting the same
   * loan twice.
   */
  'pay.period.process.body':
    'This rebuilds every payslip in this period. Payslips from the previous run are removed, and the loan and advance instalments that run deducted are refunded first so they are not deducted twice.',
  'pay.period.process.submit': 'Process now',
  'pay.period.process.done':
    '{staff} payslips built. Gross RM{gross}, deductions RM{deductions}, net RM{net}.',
  'pay.period.process.skipped':
    '{count} active staff have no basic salary and were skipped. They will not get a payslip until a basic salary is recorded on their staff record.',
  'pay.period.approve.title': 'Approve period {code}',
  'pay.period.approve.body':
    'Every payslip is checked so its rows add up to its net figure before anything is approved. After this those figures are the record — there is no way back, and corrections are made as adjustments in the following period.',
  'pay.period.approve.submit': 'Approve period',
  'pay.period.approve.done': '{count} payslips approved.',
};

/**
 * Batch 10b: paying and closing a period, payslips, and the allowance catalogue.
 *
 * PCB is rendered as MTD and LHDN as the IRB, for the same reason as EPF/SOCSO/EIS above: those are
 * the bodies' and the deduction's own English names.
 */
export const EN_LABELS_PAY_SLIPS: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // Paying, closing and removing a period
  // ---------------------------------------------------------------------------
  'pay.period.pay.title': 'Mark period {code} as paid',
  /*
   * The reason it gets its own column rather than living in the note: the reference is what reconciles
   * a bulk transfer against the payslips it covers.
   */
  'pay.period.pay.body':
    'The reference below is what reconciles the bulk transfer against the payslips it covers, so it is stored in a column of its own rather than inside the note.',
  'pay.period.pay.method': 'Payment method',
  'pay.period.pay.reference': 'Payment reference',
  'pay.period.pay.reference.placeholder': 'e.g. bank transfer batch no.',
  'pay.period.pay.submit': 'Mark as paid',
  'pay.period.close.title': 'Close period {code}',
  'pay.period.close.body':
    'A closed period is locked for audit. No write is accepted after this — not to the period, and not to any payslip inside it.',
  'pay.period.close.submit': 'Close period',
  'pay.period.remove.title': 'Remove period {code}',
  'pay.period.remove.body':
    'Only a draft can be removed, and a draft has no payslips worth keeping. Everything after that is a record of pay already calculated.',
  'pay.period.note.processFirst': 'Process the period first — there are no payslips to approve.',
  'pay.period.note.notDraft': 'Only a draft can be reprocessed or removed.',

  // ---------------------------------------------------------------------------
  // Payslips
  // ---------------------------------------------------------------------------
  'pay.payslip.title': 'Payslips',
  /*
   * The reason every figure is stored as calculated: statutory rates move with a government
   * announcement, so a payslip recomputed next year would not match the one that was paid.
   */
  'pay.payslip.subtitle':
    'One row per person, for the period chosen. Every figure is stored as it was calculated — statutory rates change with a government announcement, so a payslip recomputed next year would not match the one that was paid.',
  'pay.payslip.filter.period': 'Choose a period',
  'pay.payslip.filter.department': 'All departments',
  'pay.payslip.empty': 'No payslips. Process the period to generate them.',
  'pay.payslip.error.load': 'The payslips could not be loaded.',
  'pay.payslip.selectPeriod': 'Choose a payroll period to see its payslips.',
  'pay.payslip.column.no': 'Payslip No.',
  'pay.payslip.column.staff': 'Staff',
  'pay.payslip.column.department': 'Department',
  'pay.payslip.column.basic': 'Basic',
  'pay.payslip.column.allowance': 'Allowances',
  'pay.payslip.column.overtime': 'Overtime',
  'pay.payslip.column.gross': 'Gross',
  'pay.payslip.column.deductions': 'Deductions',
  'pay.payslip.column.net': 'Net',
  'pay.payslip.action.open': 'Open payslip',
  'pay.payslip.detail.title': 'Payslip {no}',
  'pay.payslip.detail.earnings': 'Earnings',
  'pay.payslip.detail.deductions': 'Deductions',
  'pay.payslip.detail.employer': 'Employer share',
  'pay.payslip.detail.attendance': 'Attendance in the period',
  'pay.payslip.detail.gross': 'Gross pay',
  'pay.payslip.detail.totalDeductions': 'Total deductions',
  'pay.payslip.detail.net': 'Net pay',
  'pay.payslip.detail.epfWages': 'EPF contributory wages',
  'pay.payslip.detail.contributoryWages': 'Ordinary monthly wages',
  'pay.payslip.detail.wages.hint':
    'Overtime is in neither. SOCSO and EIS are charged on ordinary monthly wages only.',
  'pay.payslip.detail.scheduledDays': 'Days scheduled',
  'pay.payslip.detail.presentDays': 'Days present',
  'pay.payslip.detail.absentDays': 'Days absent',
  'pay.payslip.detail.leaveDays': 'Days on leave',
  'pay.payslip.detail.overtimeHours': 'Approved overtime hours',
  'pay.payslip.detail.attendance.hint':
    'Stored on this payslip rather than read back. After the roster changes, the payslip can still be checked against itself.',
  'pay.payslip.detail.balanceFault':
    'This payslip does not balance: {reason} Reprocess the period before approving.',
  'pay.payslip.form.tax': 'MTD (RM)',
  /*
   * The consequence is the argument: a guessed figure under-deducts, and the employee is the one who
   * receives the bill.
   */
  'pay.payslip.form.tax.hint':
    'The system does not calculate MTD. It depends on declared reliefs, marital status and dependants under the IRB schedules — a guessed figure under-deducts, and the employee is the one who receives the bill.',
  'pay.payslip.form.other': 'Other deductions (RM)',
  'pay.payslip.form.other.hint': 'Any one-off deduction that has no row of its own.',
  'pay.payslip.form.note': 'Note',

  // ---------------------------------------------------------------------------
  // Allowances and the allowance type catalogue
  // ---------------------------------------------------------------------------
  'pay.allowance.title': 'Allowances',
  'pay.allowance.subtitle':
    'Recurring allowances, and the catalogue of types that decides how each one is calculated. A catalogue rather than fixed columns: a fifth allowance type should be one row, not a release.',
  'pay.allowance.tab.staff': 'Staff Allowances',
  'pay.allowance.tab.types': 'Allowance Types',
  'pay.allowance.type.section': 'Allowance type catalogue',
  'pay.allowance.type.subtitle':
    'What the organisation pays, and whether it counts towards EPF contributory wages. A travel reimbursement is not wages; a housing allowance is.',
  'pay.allowance.type.action.add': 'New type',
  'pay.allowance.type.column.code': 'Code',
  'pay.allowance.type.column.name': 'Name',
  'pay.allowance.type.column.mode': 'Calculation',
  'pay.allowance.type.column.default': 'Default',
  'pay.allowance.type.column.epf': 'EPF',
  'pay.allowance.type.column.used': 'In use',
  'pay.allowance.type.empty':
    'No allowance types. Create one before assigning staff allowances.',
  'pay.allowance.type.error.load': 'The allowance type catalogue could not be loaded.',
  'pay.allowance.type.epf.yes': 'Contributory',
  'pay.allowance.type.epf.no': 'Exempt',
  'pay.allowance.type.usage': '{count} staff',
  'pay.allowance.type.inUse':
    'Used by {count} staff allowances — the calculation method and EPF status are frozen.',
  'pay.allowance.type.form.title': 'New allowance type',
  'pay.allowance.type.form.edit': 'Edit allowance type',
  'pay.allowance.type.form.code': 'Code',
  'pay.allowance.type.form.name': 'Name',
  'pay.allowance.type.form.description': 'Description',
  'pay.allowance.type.form.mode': 'Calculation method',
  'pay.allowance.type.form.mode.hint':
    'A percentage is calculated on the basic salary only, not on other allowances — otherwise the order they were read in would change the amount paid.',
  'pay.allowance.type.form.default': 'Default amount',
  'pay.allowance.type.form.default.hint':
    'Offered on the form. A per-staff row can differ.',
  'pay.allowance.type.form.epf': 'Counts towards EPF wages',
  /*
   * The direction of the default is argued: under-contributing is the problem an employee discovers
   * years later.
   */
  'pay.allowance.type.form.epf.hint':
    'On by default, the more cautious direction: under-contributing is the problem an employee discovers years later.',
  'pay.allowance.type.form.taxable': 'Taxable',
  'pay.allowance.type.form.active': 'Active',
  'pay.allowance.type.form.frozen':
    'This type is already in use. The calculation method and EPF status cannot be changed — that would change amounts already paid. Deactivate it and create a new one.',
  'pay.allowance.section': 'Staff allowances',
  'pay.allowance.section.subtitle':
    'Recurring by nature, so there is no period link: each run picks up the rows that are active and whose start date has arrived.',
  'pay.allowance.action.add': 'Assign allowance',
  'pay.allowance.column.staff': 'Staff',
  'pay.allowance.column.type': 'Type',
  'pay.allowance.column.value': 'Value',
};

/** Batch 10c: staff allowance rows, bonuses, commissions and the shared award decisions. */
export const EN_LABELS_PAY_AWARDS: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // Staff allowance rows
  // ---------------------------------------------------------------------------
  'pay.allowance.column.resolved': 'Paid (RM)',
  'pay.allowance.column.window': 'In effect',
  'pay.allowance.empty': 'No staff allowances assigned.',
  'pay.allowance.error.load': 'The allowance list could not be loaded.',
  'pay.allowance.window.open': 'from {from}',
  // The spaced en dash is the range separator and stays exactly as it is.
  'pay.allowance.window.closed': '{from} – {to}',
  'pay.allowance.percentOf': '{percent}% of basic',
  'pay.allowance.form.title': 'Assign allowance',
  'pay.allowance.form.edit': 'Edit allowance',
  'pay.allowance.form.staff': 'Staff',
  'pay.allowance.form.type': 'Allowance type',
  'pay.allowance.form.value': 'Value',
  'pay.allowance.form.value.fixed': 'The amount per month in RM.',
  'pay.allowance.form.value.percent':
    'A percentage of the basic salary. Cannot exceed 100.',
  'pay.allowance.form.from': 'In effect from',
  'pay.allowance.form.from.hint':
    'Compared against the period. An allowance dated next quarter will not be paid before that date.',
  'pay.allowance.form.to': 'In effect until',
  'pay.allowance.form.to.hint': 'Leave blank for an allowance that continues.',
  'pay.allowance.form.active': 'Active',
  'pay.allowance.form.note': 'Note',
  'pay.allowance.remove.title': 'Remove allowance',
  'pay.allowance.remove.body':
    'This removes the arrangement going forward only. Payslips that have already paid this allowance stay as paid — their figures are stored on those payslips.',

  // ---------------------------------------------------------------------------
  // Bonuses
  // ---------------------------------------------------------------------------
  'pay.bonus.title': 'Bonuses',
  /*
   * The consequence is the reason a period is required at approval: a run reads records by period, so
   * an approved bonus with no period is never paid.
   */
  'pay.bonus.subtitle':
    'A one-off payment, tied to the period that pays it. A bonus approved with no period will never be paid — a run reads records by period.',
  'pay.bonus.action.add': 'New bonus',
  'pay.bonus.action.generate': 'Generate from KPI',
  'pay.bonus.column.reference': 'Reference',
  'pay.bonus.column.staff': 'Staff',
  'pay.bonus.column.kind': 'Type',
  'pay.bonus.column.name': 'Description',
  'pay.bonus.column.amount': 'Amount (RM)',
  'pay.bonus.column.date': 'Date',
  'pay.bonus.column.period': 'Period',
  'pay.bonus.empty': 'No bonuses recorded.',
  'pay.bonus.error.load': 'The bonus list could not be loaded.',
  // Lowercase prose, sits beside a reference.
  'pay.bonus.fromAppraisal': 'from an appraisal',
  'pay.bonus.noPeriod': 'no period',
  'pay.bonus.form.title': 'New bonus',
  'pay.bonus.form.edit': 'Edit bonus',
  'pay.bonus.form.staff': 'Staff',
  'pay.bonus.form.kind': 'Bonus type',
  'pay.bonus.form.name': 'Description',
  'pay.bonus.form.amount': 'Amount (RM)',
  'pay.bonus.form.date': 'Date awarded',
  'pay.bonus.form.period': 'Payroll period',
  'pay.bonus.form.period.hint':
    'The period that will pay it. It can be left blank for now, but approval requires it.',
  'pay.bonus.form.note': 'Note',
  'pay.bonus.generate.title': 'Generate bonuses from KPI grades',
  /*
   * The distinction is the point: a grade carries a factor and the row carries the amount, which is
   * what lets HR hold or reschedule a bonus instead of it appearing out of nowhere on pay day.
   * HR stays uppercase.
   */
  'pay.bonus.generate.body':
    'Every appraisal finalised in the KPI period chosen produces one bonus row that still has to be approved. The grade carries the factor, the row carries the amount — that is the difference between a bonus HR can hold or reschedule and a bonus that appears out of nowhere on pay day.',
  'pay.bonus.generate.kpiPeriod': 'KPI period',
  'pay.bonus.generate.period': 'Payroll period',
  'pay.bonus.generate.submit': 'Generate bonuses',
  'pay.bonus.generate.done':
    '{created} bonuses generated as pending approval. {existing} already existed, {noGrade} had no grade factor, {noSalary} had no basic salary.',

  // ---------------------------------------------------------------------------
  // Commissions
  // ---------------------------------------------------------------------------
  'pay.commission.title': 'Commissions',
  'pay.commission.subtitle':
    'A one-off payment, tied to the period that pays it. Separate from a bonus because it is awarded by different people for different reasons, and the permission registry keeps them apart.',
  'pay.commission.action.add': 'New commission',
  'pay.commission.column.reference': 'Reference',
  'pay.commission.column.staff': 'Staff',
  'pay.commission.column.kind': 'Type',
  'pay.commission.column.name': 'Description',
  'pay.commission.column.amount': 'Amount (RM)',
  'pay.commission.column.date': 'Date',
  'pay.commission.column.period': 'Period',
  'pay.commission.empty': 'No commissions recorded.',
  'pay.commission.error.load': 'The commission list could not be loaded.',
  'pay.commission.form.title': 'New commission',
  'pay.commission.form.edit': 'Edit commission',
  'pay.commission.form.staff': 'Staff',
  'pay.commission.form.kind': 'Commission type',
  'pay.commission.form.name': 'Description',
  'pay.commission.form.amount': 'Amount (RM)',
  'pay.commission.form.date': 'Date earned',
  'pay.commission.form.period': 'Payroll period',
  'pay.commission.form.note': 'Note',

  // ---------------------------------------------------------------------------
  // Award decisions, shared by bonuses and commissions
  // ---------------------------------------------------------------------------
  'pay.award.approve.title': 'Approve {reference}',
  'pay.award.approve.body':
    'Approving makes this payable by the period named. The amount cannot be changed afterwards — it may already be on a payslip.',
  'pay.award.approve.submit': 'Approve',
  'pay.award.cancel.title': 'Cancel {reference}',
  'pay.award.cancel.body':
    'Cancelling stops it being paid. Something already paid cannot be cancelled — make an adjustment in the following period so there is a trail.',
  'pay.award.cancel.submit': 'Cancel',
  'pay.award.note': 'Decision note',
  'pay.award.remove.title': 'Remove {reference}',
  'pay.award.remove.body':
    'Only a pending or cancelled record can be removed. Removing an approved row loses the record of what was approved.',
  'pay.award.locked': 'Only a record awaiting a decision can be edited.',

  // ---------------------------------------------------------------------------
  // Loans
  // ---------------------------------------------------------------------------
  'pay.loan.title': 'Loans',
  /*
   * The last clause is the reason the balance moves inside the payslip transaction: when the two
   * disagree, the balance is what people believe.
   */
  'pay.loan.subtitle':
    'A loan repaid through instalments from salary. The balance is moved by the payroll run inside the same transaction as the payslip that deducts it — outside that, the balance and the payslip can disagree, and the balance is what people believe.',
  'pay.loan.action.add': 'New loan',
  'pay.loan.column.reference': 'Reference',
  'pay.loan.column.staff': 'Staff',
  'pay.loan.column.principal': 'Principal (RM)',
  'pay.loan.column.instalment': 'Instalment (RM)',
  'pay.loan.column.progress': 'Progress',
};

/** Batch 10d: loans, salary advances, lending decisions and the statutory rate settings. */
export const EN_LABELS_PAY_LENDING: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // Loans
  // ---------------------------------------------------------------------------
  'pay.loan.column.balance': 'Balance (RM)',
  'pay.loan.column.startsOn': 'Deductions start',
  'pay.loan.empty': 'No loans recorded.',
  'pay.loan.error.load': 'The loan list could not be loaded.',
  'pay.loan.progress': '{paid} of {total}',
  'pay.loan.form.title': 'New loan',
  'pay.loan.form.staff': 'Staff',
  'pay.loan.form.principal': 'Loan amount (RM)',
  'pay.loan.form.instalment': 'Monthly instalment (RM)',
  /*
   * The worked example is the argument: deducting the full instalment against a small remaining balance
   * collects more than is owed.
   */
  'pay.loan.form.instalment.hint':
    'The instalment agreed. The last instalment takes whatever balance is left rather than the full figure — deducting the full amount against an RM40 balance would collect more than is owed.',
  'pay.loan.form.months': 'Number of instalments',
  'pay.loan.form.issuedOn': 'Date issued',
  'pay.loan.form.startsOn': 'Deductions start',
  'pay.loan.form.startsOn.hint':
    'Compared against the payroll period. A loan starting next month will not be deducted in this month’s run.',
  'pay.loan.form.purpose': 'Purpose',
  'pay.loan.form.note': 'Note',

  // ---------------------------------------------------------------------------
  // Salary advances
  // ---------------------------------------------------------------------------
  'pay.advance.title': 'Salary Advances',
  'pay.advance.subtitle':
    'An advance recovered over the number of months chosen. The only difference from a loan is where the instalment comes from: a loan carries an agreed instalment, an advance divides the amount by the months.',
  'pay.advance.action.add': 'New advance',
  'pay.advance.column.reference': 'Reference',
  'pay.advance.column.staff': 'Staff',
  'pay.advance.column.principal': 'Amount (RM)',
  'pay.advance.column.instalment': 'Deduction (RM)',
  'pay.advance.column.progress': 'Progress',
  'pay.advance.column.balance': 'Balance (RM)',
  'pay.advance.column.startsOn': 'Deductions start',
  'pay.advance.empty': 'No advances recorded.',
  'pay.advance.error.load': 'The advance list could not be loaded.',
  'pay.advance.progress': '{paid} of {total} months',
  'pay.advance.form.title': 'New advance',
  'pay.advance.form.staff': 'Staff',
  'pay.advance.form.principal': 'Advance amount (RM)',
  'pay.advance.form.months': 'Months to repay',
  'pay.advance.form.months.hint':
    'The monthly deduction is the amount divided by the months.',
  'pay.advance.form.preview': 'Monthly deduction: RM{amount}',
  'pay.advance.form.issuedOn': 'Date given',
  'pay.advance.form.startsOn': 'Deductions start',
  'pay.advance.form.reason': 'Reason',
  'pay.advance.form.note': 'Note',

  // ---------------------------------------------------------------------------
  // Lending decisions, shared by loans and advances
  // ---------------------------------------------------------------------------
  'pay.lending.approve.title': 'Approve {reference}',
  'pay.lending.approve.body':
    'Approving makes it active, and the next payroll run starts deducting instalments from salary.',
  'pay.lending.approve.submit': 'Approve',
  'pay.lending.cancel.title': 'Cancel {reference}',
  /*
   * The reason cancellation closes once a deduction has happened: it would leave money taken with
   * nothing recording why.
   */
  'pay.lending.cancel.body':
    'It can only be cancelled while no instalment has been deducted. Once salary has been deducted, cancelling would leave money taken with nothing recording why — make the repayment as an adjustment instead.',
  'pay.lending.cancel.submit': 'Cancel',
  'pay.lending.locked':
    'Instalments have already been deducted from salary — this record cannot be removed.',
  'pay.lending.remove.title': 'Remove {reference}',
  'pay.lending.remove.body':
    'Only a record that is not yet approved and has no deduction history can be removed. The payslips that deducted it refer to this record.',

  // ---------------------------------------------------------------------------
  // Statutory rates
  // ---------------------------------------------------------------------------
  'pay.settings.title': 'Payroll Settings',
  /*
   * The argument for rates as editable data: the EIS ceiling has already moved twice by government
   * announcement, and a rate in a source file means a release in order to obey the law.
   */
  'pay.settings.subtitle':
    'Statutory rates, notifications and email wording. The rates are editable data rather than constants in code: the EIS ceiling has already changed twice by government announcement, and a rate inside a source file means a release in order to comply with the law.',
  'pay.settings.group.epf': 'EPF',
  'pay.settings.group.socso': 'SOCSO',
  'pay.settings.group.eis': 'EIS',
  'pay.settings.group.cycle': 'Pay cycle',
  'pay.settings.group.review': 'Rate confirmation',
  'pay.settings.epfEmployeeRate': 'Employee rate (%)',
  'pay.settings.epfEmployerRate': 'Employer rate at or below the threshold (%)',
  'pay.settings.epfEmployerRateHigh': 'Employer rate above the threshold (%)',
  'pay.settings.epfEmployerRateHigh.hint':
    'The statutory step at that threshold goes down, not up. Entered the wrong way round it over-contributes for every senior employee, every month.',
  'pay.settings.epfWageThreshold': 'Wage threshold (RM)',
  'pay.settings.epfIncludeBonus': 'Count bonuses and commissions as EPF wages',
  'pay.settings.epfIncludeBonus.hint':
    'They are EPF wages. This toggle exists because a particular organisation may differ.',
  'pay.settings.epf.note':
    'Overtime is not in the EPF base. Overtime pay is not contributory wages.',
  'pay.settings.socsoEmployeeRate': 'Employee rate (%)',
  'pay.settings.socsoEmployerRate': 'Employer rate (%)',
  'pay.settings.socsoWageCeiling': 'Wage ceiling (RM)',
  'pay.settings.socsoWageCeiling.hint': '0 means no ceiling.',
  'pay.settings.eisEmployeeRate': 'Employee rate (%)',
  'pay.settings.eisEmployerRate': 'Employer rate (%)',
  'pay.settings.eisWageCeiling': 'Wage ceiling (RM)',
  'pay.settings.payDay': 'Pay day',
  'pay.settings.payDay.hint':
    'A day of the month, offered as the default on a new period.',
  'pay.settings.ratesReviewed': 'The rates have been reviewed and confirmed',
  'pay.settings.ratesReviewed.hint':
    'Only tick this after finance has compared every rate above against the EPF and SOCSO schedules in force. Until then, every screen and every export file carries a warning.',
  'pay.settings.action.save': 'Save settings',
  'pay.settings.saved': 'Payroll settings saved.',
  'pay.settings.error.load': 'The payroll settings could not be loaded.',
  // The uppercase word is uppercase in the source too.
  'pay.settings.caveat.unverified':
    'The default values here have NOT been confirmed against the current statutory schedules. They are a starting point so the screen can be used; finance must confirm them before any period is paid.',
  /*
   * The honest limitation: the real contribution is a wage band table in fixed sen amounts, so these
   * figures are close but not exact.
   */
  'pay.settings.caveat.socsoBands':
    'SOCSO and EIS are calculated here as a capped percentage. The actual contribution is a wage band table with fixed sen amounts, around thirty rows. The figures here are close but not exact, so a statement will not reconcile sen-for-sen with SOCSO.',
  'pay.settings.caveat.pcb':
    'MTD is not calculated at all. It depends on declared reliefs, marital status and dependants under the IRB schedules — a guessed figure under-deducts and the employee is the one who receives the bill at assessment. It is entered by hand on each payslip.',
  'pay.settings.caveat.heading': 'What to know before ticking this as reviewed',

  // ---------------------------------------------------------------------------
  // Shared controls
  // ---------------------------------------------------------------------------
  'pay.form.staffPlaceholder': 'Staff number, e.g. 1001',
  'pay.form.periodNone': 'No period',
  'pay.chip.all': 'All',
  'pay.filter.period': 'All periods',
  'pay.filter.type': 'All types',
  'pay.action.decide': 'Approve or cancel',
  'pay.action.edit': 'Edit',
  'pay.action.remove': 'Remove',
  'pay.settings.tab.rates': 'Statutory Rates',
};

/**
 * Batch 11a: the terminal list, the add dialog, connection mode and the ingest endpoint.
 *
 * Hikvision and ISAPI vocabulary stays: push, pull, heartbeat, firmware, MAC, ISAPI, and the stored
 * values `timeMode: manual`, `direct` and `agent`. Those are what the terminal's own interface says,
 * and an operator comparing the two screens has to be able to match the words.
 */
export const EN_LABELS_DEVICE: Partial<Record<LabelKey, string>> = {
  // Status chips, uppercase in the source and uppercase here.
  'device.status.online': 'ONLINE',
  'device.status.degraded': 'DEGRADED',
  'device.status.offline': 'OFFLINE',
  'device.status.unknown': 'NOT CHECKED',

  // Matches `nav.settings.devices`.
  'device.title': 'Device List',
  'device.subtitle':
    'The attendance terminals, how each one is reached, and the state of its clock. A terminal cannot be removed because the scan history refers to it.',
  'device.tabs.aria': 'Device settings',
  'device.tab.list': 'List',
  'device.tab.connection': 'Connection Mode',
  'device.tab.health': 'Health & Clock',

  'device.warning.drift':
    'The clock has drifted {seconds}s from the server. Records written now inherit this error.',
  // `timeMode: manual` is a stored value and stays literal.
  'device.warning.manualClock':
    'timeMode is manual, so the clock drift will keep growing.',
  'device.warning.capacity':
    'Capacity is nearly full: {enrolled}/{capacity}. The next enrolment risks failing.',
  'device.warning.remoteCheck':
    'Remote verification is active through "{channel}". Every scan waits {timeout}s.',

  'device.list.count': '{count} terminals',
  /*
   * The reason the periodic pull is kept even with push working: push is faster but it is not the source
   * of truth.
   */
  'device.list.subtitle':
    'Push makes events arrive faster but it is not the source of truth — the periodic pull keeps running as a safety net.',
  'device.list.add': 'Add Terminal',
  'device.list.search': 'Search a terminal name or address…',
  'device.list.empty': 'No terminals registered yet.',
  'device.error.load': 'Could not load the terminals',
  'device.error.sync': 'The sync failed',
  'device.error.import': 'The import failed',
  'device.sync.done': '{name}: {stored} new events, {duplicates} already present.',
  'device.sync.failed': '{name}: {error}',
  // Names the mapping screen, so it matches `nav.staff.mapping`.
  'device.import.done':
    '{name}: {users} users read, {mapped} matched, {review} need review under Terminal ID Mapping.',

  'device.column.name': 'Name',
  'device.column.address': 'Address',
  'device.column.clock': 'Clock',
  'device.column.enrolled': 'Enrolled',
  'device.column.serial': 'Serial',
  'device.column.seen': 'Seen',
  // Lowercase prose, sits beside the terminal name.
  'device.row.unknownModel': 'model unknown',
  'device.row.neverSeen': 'never',
  'device.row.edit': 'Edit terminal settings',
  'device.row.sync': 'Sync now',
  'device.row.importUsers': 'Read the user list from the terminal',
  'device.row.expand': 'terminal details',

  'device.detail.model': 'Model',
  'device.detail.firmware': 'Firmware',
  'device.detail.serial': 'Serial no.',
  'device.detail.mac': 'MAC',
  'device.detail.location': 'Location',
  'device.detail.clockMode': 'Clock mode',
  'device.detail.lastSync': 'Last sync',
  'device.detail.lastPush': 'Last push',
  'device.detail.recovered': 'Recovered by pull',
  /*
   * The reassurance matters as much as the diagnosis: attendance is still correct, it just arrives late.
   */
  'device.detail.recoveredNote':
    '{count} events were found by the periodic pull that push never sent. A number that keeps climbing means push cannot be relied on for this terminal — attendance is still correct, it just arrives late.',
  // Names the tab, so it matches `device.tab.health`.
  'device.detail.driftWarning':
    'The clock has drifted {drift}. Every scan recorded now inherits this error. Fix it under the Health & Clock tab.',

  'device.dialog.add': 'Add terminal',
  'device.dialog.description': 'The terminal is probed immediately after it is saved.',
  'device.dialog.name': 'Name',
  'device.dialog.name.placeholder': 'e.g. Main Door',
  'device.dialog.host': 'IP / hostname',
  'device.dialog.port': 'Port',
  'device.dialog.https': 'Use HTTPS',
  'device.dialog.username': 'Username',
  'device.dialog.password': 'Password',
  'device.dialog.location': 'Location',
  'device.dialog.location.none': 'None',
  /*
   * The reason for probing on save: an address or credential mistake shows up now rather than as missing
   * attendance tomorrow.
   */
  'device.dialog.credentialNote':
    'The password is encrypted before storage and is never returned. The terminal is probed immediately so an address or credential mistake shows up now, not as missing attendance tomorrow.',
  'device.dialog.probing': 'Probing…',
  'device.dialog.submit.add': 'Add and probe',
  'device.saved.added': '{name} added and probed.',
  'device.saved.added.warnings': '{name} added and probed — {count} warnings.',
  'device.saved.added.unreachable': '{name} added but could not be reached: {error}',

  // ---------------------------------------------------------------------------
  // Connection mode
  // ---------------------------------------------------------------------------
  'device.connection.title': 'Connection mode',
  'device.connection.subtitle':
    'Set at installation. Changing it moves where the database and the server live, not just one setting.',
  'device.connection.error.load': 'Could not load it',
  // The two mode names are the stored values and stay.
  'device.connection.direct': 'Direct',
  'device.connection.direct.body':
    'The server sits on the same LAN as the terminals. Terminals push to the server, and the server pulls directly from the terminals.',
  'device.connection.agent': 'Agent',
  'device.connection.agent.body':
    'The server is in the cloud. An on-site connector dials out to the server, so no inbound port has to be opened on the hospital network.',
  // Lowercase prose, sits beside the mode name.
  'device.connection.active': 'active',
  'device.connection.fixed':
    'The mode is set through {env} and cannot be changed from this screen.',

  // ---------------------------------------------------------------------------
  // Ingest endpoint
  // ---------------------------------------------------------------------------
  'device.ingest.title': 'Ingest endpoint',
  'device.ingest.subtitle': 'Where terminals send events, and how well that is going.',
  'device.ingest.pushed': 'Events via push',
  'device.ingest.pulled': 'Events via pull',
  'device.ingest.heartbeats': 'Heartbeats',
  'device.ingest.undecodable': 'Could not be read',
  'device.ingest.path': 'Ingest path',
  'device.ingest.auth': 'Auth method',
  'device.ingest.lastContact': 'Last contact',
  'device.ingest.rejected': 'Auth rejections',
  /*
   * The comparison is the point: this is worse than an unreachable terminal, because it looks like it is
   * working.
   */
  'device.ingest.undecodable.note':
    '{count} deliveries arrived but could not be read. The terminal is reaching us and we are discarding its payload — this is worse than a terminal we cannot reach, because it looks like it is working.',

  // ---------------------------------------------------------------------------
  // Pointing a terminal at this server
  // ---------------------------------------------------------------------------
  'device.push.title': 'Point the terminal at this server',
  'device.push.subtitle':
    'The server address as the terminal sees it, not as your computer sees it.',
  'device.push.host': 'Server IP (as the terminal sees it)',
  'device.push.error': 'Could not configure push',
  'device.push.done':
    '{name} is now sending to {target}. Wait about 30 seconds for the first heartbeat, then reload this tab.',
};

/** Batch 11b: terminal health and clocks, plus the connection and identity tabs of the editor. */
export const EN_LABELS_DEVICE_HEALTH: Partial<Record<LabelKey, string>> = {
  'device.push.note':
    'Push makes events arrive faster but it is not the source of truth: the firmware keeps no queue and does not retry, so the periodic pull keeps running as a safety net.',

  // ---------------------------------------------------------------------------
  // Terminal health
  // ---------------------------------------------------------------------------
  'device.health.title': 'Terminal health',
  'device.health.subtitle':
    'A terminal clock is the one fault that corrupts every record without producing an error.',
  'device.health.recheck': 'Re-check',
  'device.health.error.load': 'Could not probe the terminals',
  // `{drifting}` is a mid-sentence clause that carries its own leading space. Hikvision stays.
  'device.health.silentNote':
    'The terminal keeps working, scans keep arriving, and the timestamps are simply wrong. Nothing in the Hikvision interface reports it.{drifting}',
  'device.health.silentNote.drifting':
    ' {count} terminals have drifted past 30 seconds right now.',
  'device.health.ntp': 'NTP source',
  'device.health.ntp.hint':
    'A LAN gateway is more resilient than public NTP — the clocks stay in sync even when the internet is down.',
  'device.health.empty': 'No terminals to probe.',
  'device.health.column.terminal': 'Terminal',
  'device.health.column.capacity': 'Capacity',
  'device.health.column.warnings': 'Warnings',
  'device.health.noWarnings': 'No warnings',
  'device.health.warningCount': '{count} warnings — open to see them',
  'device.health.row.fixClock': 'Fix the clock through NTP',
  'device.health.row.disableRemote': 'Turn off remote verification',
  'device.health.row.expand': 'health details',
  'device.health.detail.driftTarget': 'Clock drift',
  'device.health.detail.unmeasured': 'Not measured',
  'device.health.detail.lastSeen': 'Last seen',
  /*
   * The reason the measured drift is stored on every row: a past record keeps its error, and storing the
   * drift beside it is what makes that record judgeable later.
   */
  'device.health.pastRecords':
    'Fixing the clock does not change timestamps already recorded. Past records keep their error, and the drift measured at the time is stored alongside every row so it can still be judged later.',
  // The terminal's own field names stay literal.
  'device.health.ntp.done':
    '{name}: timeMode={mode} drift={drift}s. The terminal may restart its services briefly after the time settings change, so a probe immediately after this can fail temporarily.',
  'device.health.ntp.error': 'Could not set NTP',
  'device.health.remoteOff': '{name}: remote verification turned off.',
  'device.health.remoteOff.error': 'Could not turn it off',

  // ---------------------------------------------------------------------------
  // Terminal editor shell
  // ---------------------------------------------------------------------------
  'device.editor.back.aria': 'Back to the device list',
  'device.editor.recheck': 'Probe',
  'device.editor.notFound': 'Terminal not found.',
  'device.editor.error.load': 'Could not load the terminal',
  'device.editor.error.check': 'Could not probe the terminal',
  'device.editor.unknownModel': 'Model not read yet',
  'device.editor.save': 'Save',
  'device.editor.enrolled': '{enrolled}/{capacity} enrolled',
  'device.editor.passwordStored': 'Password stored',
  'device.editor.tabs.aria': 'Terminal settings sections',
  'device.editor.tab.connection': 'Connection',
  'device.editor.tab.identity': 'Identity',
  'device.editor.tab.clock': 'Clock',
  'device.editor.tab.attendance': 'Attendance',
  'device.editor.tab.door': 'Door',
  'device.editor.tab.push': 'Push',
  'device.editor.tab.diagnostics': 'Diagnostics',
  'device.editor.live.readAt': 'Read from the terminal {time}',
  'device.editor.live.reading': 'Reading…',
  'device.editor.live.reload': 'Read again',
  'device.editor.live.unsupported': 'This terminal’s firmware does not report this setting.',

  // ---------------------------------------------------------------------------
  // Connection tab
  // ---------------------------------------------------------------------------
  'device.editor.connection.title': 'Connection',
  'device.editor.connection.subtitle':
    'Stored in this database, not on the terminal. Can be edited even when the unit cannot be reached.',
  'device.editor.connection.hint':
    'Saving releases the cached connection and probes the terminal again. The scan history is untouched — it stays tied to this terminal.',
  'device.editor.group.address': 'Address',
  'device.editor.group.credentials': 'Credentials',
  'device.editor.group.placement': 'Placement',
  'device.editor.field.name': 'Name',
  'device.editor.field.name.placeholder': 'e.g. Main Door',
  'device.editor.field.host': 'Address',
  'device.editor.field.host.caption': 'IP / hostname',
  'device.editor.field.host.hint':
    'The terminal accepts either. This address also becomes the target for push notifications.',
  'device.editor.field.port': 'Port',
  'device.editor.field.tls': 'Transport',
  // self-signed is the certificate's own term and stays.
  'device.editor.field.tls.hint':
    'Terminals ship with a self-signed certificate, so certificate verification is off by default and switched on per device.',
  'device.editor.field.https': 'Use HTTPS',
  'device.editor.field.verifyTls': 'Verify certificate',
  'device.editor.field.username': 'Username',
  'device.editor.field.password': 'Password',
  // The quoted word keeps the source's straight quotes.
  'device.editor.field.password.hint':
    'Leave it blank to keep the stored one. It is encrypted and never returned, so blank cannot mean "remove".',
  'device.editor.field.location': 'Location',
  'device.editor.field.location.caption': 'Organisation location',
  'device.editor.field.location.none': 'None',
  'device.editor.field.doorNo': 'Door no.',
  'device.editor.field.doorNo.hint':
    'Written into the door rights of every staff member assigned here.',
  'device.editor.field.active': 'Active',
  /*
   * The last clause is the reason to deactivate a removed unit: a permanent warning becomes a warning
   * people stop reading.
   */
  'device.editor.field.active.hint':
    'An inactive terminal is skipped by the scheduled probes and by roster pushes. Deactivate a unit that has been taken off the wall — otherwise it reports offline forever, and that warning becomes a warning people stop reading.',
  'device.editor.saved': '{name} saved and probed.',
  'device.editor.saved.warnings': '{name} saved and probed — {count} warnings.',
  'device.editor.saved.unreachable': '{name} saved but could not be reached: {error}',
  'device.editor.saved.noProbe': '{name} saved. Not probed because it is inactive.',

  // ---------------------------------------------------------------------------
  // Identity tab
  // ---------------------------------------------------------------------------
  'device.editor.identity.title': 'Terminal identity',
  'device.editor.identity.subtitle':
    'What this unit reports about itself, and what it is currently holding.',
  'device.editor.identity.group.unit': 'Unit',
  'device.editor.identity.group.credentials': 'Credentials on the terminal',
  'device.editor.identity.group.library': 'Face library',
  'device.editor.identity.model': 'Model',
  'device.editor.identity.model.caption': 'Model',
  'device.editor.identity.deviceName': 'Name on the terminal',
};

/**
 * Batch 11c: identity readings, clock and timezone, attendance mode, and the start of the door tab.
 *
 * ISAPI field and library names stay exactly as the terminal reports them: FDID, blackFD, infraredFD,
 * attendanceStatus, timeMode, the factory placeholder 192.0.0.64, and the Hikvision timezone notation
 * CST-8:00:00.
 */
export const EN_LABELS_DEVICE_CLOCK: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // Identity readings
  // ---------------------------------------------------------------------------
  'device.editor.identity.firmware': 'Firmware',
  'device.editor.identity.firmware.caption': 'Version',
  'device.editor.identity.serial': 'Serial number',
  'device.editor.identity.serial.live': 'Read just now',
  'device.editor.identity.serial.hint':
    'Compared against the one stored on the record. Every ID mapping on this record belongs to the serial we saw first.',
  'device.editor.identity.mac': 'MAC address',
  /*
   * Both readings are named because they distinguish the two causes: a replaced unit, or two records
   * pointing at one terminal.
   */
  'device.editor.identity.serialMismatch':
    'This address answers with serial {live}, but the record stores {stored}. The unit may have been replaced, or two records may be pointing at one terminal. Every ID mapping on this record belongs to the stored serial.',
  'device.editor.identity.users': 'People on the terminal',
  'device.editor.identity.users.caption': 'Total',
  'device.editor.identity.users.hint':
    'This breakdown answers who exists on the unit but cannot scan.',
  'device.editor.identity.withFace': 'Has a face',
  'device.editor.identity.withFingerprint': 'Has a fingerprint',
  'device.editor.identity.withCard': 'Has a card',
  'device.editor.identity.noCredentials':
    '{count} people exist on this terminal with no face, fingerprint or card. They cannot scan at all, and the terminal reports no error when they try.',
  'device.editor.identity.libraries': 'Libraries',
  // The ISAPI field name stays; only the word after the colon is translated.
  'device.editor.identity.libraries.caption': 'FDID:type',
  'device.editor.identity.libraries.hint':
    'Enrolment writes to the blackFD library. infraredFD is not for enrolment.',
  'device.editor.identity.capacity': 'Reported capacity',
  'device.editor.identity.noLibrary':
    'The terminal reports no face library at all. Face enrolment will not succeed until this is resolved.',

  // ---------------------------------------------------------------------------
  // Clock and timezone
  // ---------------------------------------------------------------------------
  'device.editor.clock.title': 'Clock and timezone',
  'device.editor.clock.subtitle':
    'Measured rather than assumed. A wrong clock is the one fault that corrupts every record while the unit stays fully functional.',
  'device.editor.clock.silentNote':
    'Scans keep arriving, nothing errors, and the timestamps are simply wrong. Nothing in the Hikvision interface reports it.',
  'device.editor.clock.group.state': 'Current state',
  'device.editor.clock.group.ntp': 'NTP source',
  // `timeMode` is the terminal's own field and stays.
  'device.editor.clock.group.ntp.subtitle':
    'Writing the server alone is not enough — timeMode stays manual and the terminal carries on ignoring it. Both are written together.',
  'device.editor.clock.group.manual': 'Set the time by hand',
  'device.editor.clock.group.manual.subtitle':
    'Only for a site with no reachable NTP host.',
  'device.editor.clock.drift': 'Clock drift',
  'device.editor.clock.drift.caption': 'Drift',
  /*
   * The measurement point is stated because it is what stops network latency being read as clock error.
   */
  'device.editor.clock.drift.hint':
    'Positive means the terminal is ahead of the server. Measured at the midpoint of the request window so network latency is not counted as clock error.',
  'device.editor.clock.deviceTime': 'Terminal time',
  'device.editor.clock.serverTime': 'Server time',
  'device.editor.clock.slots': 'Terminal NTP slots',
  'device.editor.clock.slots.hint':
    'As the terminal stores them right now. An empty box beside a working configuration invites somebody to overwrite it.',
  'device.editor.clock.slots.none': 'The terminal reports no NTP slots at all.',
  // The factory placeholder address stays.
  'device.editor.clock.slots.placeholder':
    'One slot is still on the factory placeholder 192.0.0.64. It will not synchronise.',
  'device.editor.clock.ntpHost': 'NTP host',
  'device.editor.clock.ntpHost.caption': 'IP / hostname',
  'device.editor.clock.ntpHost.hint':
    'A LAN gateway is more resilient than public NTP — the clock stays in sync even when the internet is down.',
  'device.editor.clock.ntpPort': 'Port',
  'device.editor.clock.ntpInterval': 'Interval',
  'device.editor.clock.ntpInterval.hint': 'Minutes',
  'device.editor.clock.timeZone': 'Terminal timezone',
  'device.editor.clock.timeZone.caption': 'Hikvision notation',
  // The notation example and its meaning both stay literal.
  'device.editor.clock.timeZone.hint':
    'POSIX notation is inverted: CST-8:00:00 means UTC+8. The organisation timezone is shown beside it for reference.',
  'device.editor.clock.orgTimeZone': 'Organisation timezone',
  'device.editor.clock.apply': 'Hand the clock over to NTP',
  'device.editor.clock.applied':
    'timeMode={mode}, drift={drift}s. The terminal may restart its services briefly after the time changes, so a probe immediately after this can fail temporarily.',
  'device.editor.clock.hint':
    'Fixing the clock does not change timestamps already recorded. Past records keep their error, and the drift measured at the time is stored alongside every row.',
  'device.editor.clock.manual.note':
    'A clock set by hand starts drifting again immediately and nothing corrects it. Use this only when no NTP host can be reached, and go back to NTP as soon as one can.',
  'device.editor.clock.manual.action': 'Set to the server time',
  'device.editor.clock.manual.action.hint':
    'Writes this server’s time now, with the timezone above.',
  'device.editor.clock.manual.apply': 'Set the time now',
  'device.editor.clock.manual.applied':
    'The time was set by hand. Drift is now {drift}s.',

  // ---------------------------------------------------------------------------
  // Attendance mode
  // ---------------------------------------------------------------------------
  'device.editor.attendance.title': 'Attendance mode',
  'device.editor.attendance.subtitle':
    'How the terminal labels each scan as an in or an out.',
  'device.editor.attendance.group.mode': 'Mode',
  'device.editor.attendance.mode': 'Attendance mode',
  // `attendanceStatus` is the ISAPI field name and stays.
  'device.editor.attendance.mode.hint':
    'This decides whether the terminal sends attendanceStatus with each event.',
  'device.editor.attendance.mode.disable': 'Off',
  'device.editor.attendance.mode.disable.hint':
    'The terminal sends no status. Ins and outs are derived from the scan order by the engine — this is the state of a test unit.',
  'device.editor.attendance.mode.manual': 'Manual',
  // The button words on the terminal screen, uppercase as in the source.
  'device.editor.attendance.mode.manual.hint':
    'A person presses IN or OUT on the terminal screen.',
  'device.editor.attendance.mode.auto': 'Auto',
  'device.editor.attendance.mode.auto.hint':
    'The terminal decides for itself from its own schedule, which is separate from the shift schedule in this system.',
  'device.editor.attendance.mode.manualAndAuto': 'Manual + Auto',
  'device.editor.attendance.mode.manualAndAuto.hint':
    'The terminal decides, but a person can override it.',
  'device.editor.attendance.derived': 'Read, not written',
  /*
   * The argument against offering the control: a control that writes a setting nobody reads looks like it
   * works and does nothing.
   */
  'device.editor.attendance.derived.hint':
    'The terminal manages this as part of the mode definition itself, and nothing in this system reads it. A control that writes a setting nobody reads is a control that looks like it works and does nothing.',
  'device.editor.attendance.statusTime': 'Status display duration',
  'device.editor.attendance.reqStatus': 'Status selection required',
  'device.editor.attendance.apply': 'Save to the terminal',
  'device.editor.attendance.saved': 'The attendance mode was written to the terminal.',
  'device.editor.attendance.note':
    'Changing this changes how scans are labelled from now on. Past records do not change — the engine derives them again from the punches, so run a recompute if their labels need to change too.',
  'device.editor.attendance.hint':
    'Written straight to the terminal. One audit row is recorded with your name on it.',

  // ---------------------------------------------------------------------------
  // Door and verification
  // ---------------------------------------------------------------------------
  'device.editor.door.title': 'Door and verification',
  'device.editor.door.subtitle': 'How this door decides to open.',
  'device.editor.door.group.verify': 'Verification mode',
  'device.editor.door.group.verify.subtitle':
    'The pick list is read from the terminal rather than coded into this system — different firmware supports a different set.',
};

/** Batch 11d: door behaviour, verification modes, and the push slots. */
export const EN_LABELS_DEVICE_DOOR: Partial<Record<LabelKey, string>> = {
  // ---------------------------------------------------------------------------
  // Door behaviour
  // ---------------------------------------------------------------------------
  'device.editor.door.verifyMode': 'How entry is granted',
  'device.editor.door.verifyMode.hint':
    'The terminal matches locally. A mode that requires two factors refuses a scan that only offers one.',
  'device.editor.door.reader.unsupported':
    'This firmware does not expose the reader configuration, so the verification mode has to be set on the terminal itself.',
  'device.editor.door.fingerprintLevel': 'Fingerprint level',
  'device.editor.door.fingerprintLevel.hint': 'The values this terminal accepts',
  'device.editor.door.unchanged': 'Keep as is',
  'device.editor.door.group.remote': 'Remote verification',
  'device.editor.door.remote.on': 'On',
  'device.editor.door.remote.off': 'Off',
  'device.editor.door.remoteCheck': 'Require server approval',
  // Timeout is the terminal's own field name and stays.
  'device.editor.door.remoteCheck.hint':
    'When this is on with an unreachable channel, every verification waits out the full timeout before the door opens.',
  'device.editor.door.remoteDetail': 'Channel details',
  'device.editor.door.channel': 'Channel',
  'device.editor.door.timeout': 'Timeout (seconds)',
  /*
   * The consequence is what makes this worth warning about: the timeout is felt as a queue at the door
   * every morning.
   */
  'device.editor.door.remoteWarning':
    'Remote verification is currently on. If its channel does not answer, that timeout is added to every scan — which is felt as a queue at the door every morning.',
  'device.editor.door.group.behaviour': 'Door behaviour',
  'device.editor.door.doorNo': 'Door {doorNo}',
  'device.editor.door.timing': 'Timing and sensor',
  'device.editor.door.timing.hint':
    'Written read-modify-write: the terminal manages this as one whole object, so sending a single field would clear the rest.',
  'device.editor.door.openDuration': 'Open duration',
  'device.editor.door.openDuration.hint': 'Seconds',
  'device.editor.door.magneticType': 'Magnetic sensor',
  'device.editor.door.magneticType.alwaysClose': 'Normally closed',
  'device.editor.door.magneticType.alwaysOpen': 'Normally open',
  'device.editor.door.param.unsupported':
    'This firmware does not expose the door parameters, so the open duration and the sensor have to be set on the terminal itself.',
  'device.editor.door.remoteOpen': 'Open the door remotely',
  'device.editor.door.remoteOpen.hint':
    'Releases the lock once, with nobody presenting a credential. One audit row is recorded with your name on it.',
  'device.editor.door.open': 'Open the door now',
  'device.editor.door.open.error': 'Could not open the door',
  'device.editor.door.opened': 'Door {doorNo} opened.',
  'device.editor.door.open.confirm.title': 'Open the door now?',
  'device.editor.door.open.confirm.description': 'Terminal {name} will release its lock.',
  /*
   * The last clause is why this system's audit row matters: the terminal records the door event but not
   * who asked for it from a browser.
   */
  'device.editor.door.open.confirm.body':
    'This opens a physical door with nobody presenting a credential. The terminal records the door event but not who requested it from a browser — this system’s audit row is the only record of that.',
  'device.editor.door.group.display': 'Display and sound',
  'device.editor.door.voicePrompt': 'Voice prompt',
  'device.editor.door.voicePrompt.hint': 'The terminal speaks on every verification.',
  'device.editor.door.apply': 'Save to the terminal',
  'device.editor.door.saved': '{count} settings written to the terminal.',
  'device.editor.door.partial': '{applied} settings written, but some failed: {failed}',
  'device.editor.door.hint':
    'The three groups are written separately to three endpoints, so one can succeed while another is refused. Every change is recorded in the audit log.',

  // ---------------------------------------------------------------------------
  // Verification modes
  // ---------------------------------------------------------------------------
  'device.editor.verify.face': 'Face only',
  'device.editor.verify.face.hint': 'The fastest, and enough for most internal doors.',
  'device.editor.verify.faceOrFp': 'Face or fingerprint',
  'device.editor.verify.faceOrCard': 'Face or card',
  'device.editor.verify.faceOrFpOrCard': 'Face, fingerprint or card',
  'device.editor.verify.faceAndFp': 'Face and fingerprint',
  'device.editor.verify.faceAndCard': 'Face and card',
  'device.editor.verify.faceAndPw': 'Face and PIN',
  'device.editor.verify.faceAndPw.hint':
    'Two factors. Adds a few seconds to every entry, so consider the queue at shift changeover.',
  'device.editor.verify.card': 'Card only',
  'device.editor.verify.fp': 'Fingerprint only',
  'device.editor.verify.pw': 'PIN only',
  /*
   * The point is what the record proves: a PIN can be shared, so attendance recorded with one only proves
   * the number was known.
   */
  'device.editor.verify.pw.hint':
    'No biometrics. A PIN can be shared, so attendance recorded with one only proves the number was known.',
  'device.editor.verify.cardOrPw': 'Card or PIN',

  // ---------------------------------------------------------------------------
  // Push slots
  // ---------------------------------------------------------------------------
  'device.editor.push.title': 'Push and ingest',
  'device.editor.push.subtitle':
    'Where the terminal sends events. This firmware has exactly two slots.',
  'device.editor.push.slot': 'Slot {slot}',
  // Matches `api.access.answering`.
  'device.editor.push.set': 'Answering',
  'device.editor.push.empty': 'Empty',
  'device.editor.push.empty.detail':
    'This slot is not configured. A second server would sit here.',
  'device.editor.push.target': 'Target',
  'device.editor.push.url': 'URL',
  'device.editor.push.format': 'Format',
  'device.editor.push.auth': 'Authentication',
  'device.editor.push.auth.hint':
    'The password is never returned from the terminal, so only the method and the username are shown.',
  'device.editor.push.auth.method': 'Method',
  'device.editor.push.auth.user': 'Username',
  'device.editor.push.heartbeat': 'Heartbeat',
  'device.editor.push.noAuth':
    'This slot sends with no authentication. Anybody who can reach the ingest endpoint can send fake punches. Reconfigure it to fix that.',
  'device.editor.push.release': 'Release slot',
  'device.editor.push.release.hint':
    'A terminal moved between servers carries on sending to the old one until its slot is released.',
  'device.editor.push.clear': 'Clear slot',
  'device.editor.push.cleared': 'Slot {slot} cleared.',
  'device.editor.push.group.configure': 'Configure slot',
  'device.editor.push.group.configure.subtitle':
    'Authentication is always set from the server’s ingest credentials — the firmware defaults to none.',
  'device.editor.push.destination': 'Destination',
  // localhost is a literal and stays.
  'device.editor.push.destination.hint':
    'This server’s address as the terminal can reach it, not localhost.',
  'device.editor.push.host': 'Host',
  'device.editor.push.port': 'Port',
  'device.editor.push.slotCaption': 'Slot',
};

/**
 * Batch 11e: diagnostics, liveness and on-screen display, and the remote restart.
 *
 * `AcsCfg` is the ISAPI object's own name and stays.
 */
export const EN_LABELS_DEVICE_DIAG: Partial<Record<LabelKey, string>> = {
  'device.editor.push.path': 'Ingest path',
  'device.editor.push.path.hint': 'Has to match this server’s ingest path.',
  'device.editor.push.configure': 'Write to the terminal',
  'device.editor.push.configured': 'The terminal is now sending to {target}.',
  'device.editor.push.hint':
    'Push makes events arrive faster but it is not the source of truth: the firmware keeps no queue and does not retry, so the periodic pull keeps running as a safety net.',

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------
  'device.editor.diag.title': 'Diagnostics',
  /*
   * The purpose is the second sentence: this tab is what answers why a control on another tab is
   * disabled.
   */
  'device.editor.diag.subtitle':
    'What the terminal says about itself, unfiltered. This is what answers why a control on another tab is disabled.',
  'device.editor.diag.group.cursor': 'Cursor and delivery',
  'device.editor.diag.cursor': 'Cursor position',
  'device.editor.diag.cursor.hint':
    'Anchored to the serial number rather than a timestamp — the serial survives a clock correction, and correcting this clock is entirely expected.',
  'device.editor.diag.lastSerial': 'Last serial',
  'device.editor.diag.lastSync': 'Last pull',
  'device.editor.diag.lastPush': 'Last push',
  'device.editor.diag.recovered': 'Recovered by pull',
  'device.editor.diag.recoveredNote':
    'The pull found {count} events that push never sent. A climbing number means push notifications are being lost — the events still arrive, just late.',
  'device.editor.diag.group.acs': 'Full AcsCfg',
  'device.editor.diag.group.acs.subtitle':
    'The health probe reads this object and keeps one flag from it. The rest is shown here so a firmware change can be diagnosed without a site visit.',
  'device.editor.diag.group.capabilities': 'Capability documents',
  'device.editor.diag.group.capabilities.subtitle':
    'The pick lists on the other tabs are built from these documents. An empty entry explains why the related control is disabled.',
  'device.editor.diag.none': 'Not reported.',
  'device.editor.diag.unsupported': 'Not supported on this firmware.',
  'device.editor.diag.noCapabilities': 'The terminal answered no capability document at all.',

  // ---------------------------------------------------------------------------
  // Reader capabilities, thresholds and liveness
  // ---------------------------------------------------------------------------
  // Names the Diagnostics tab, so it matches `device.editor.tab.diagnostics`.
  'device.editor.door.verifyMode.unpublished':
    'The terminal does not publish the list of modes it accepts, so the list above is the documented one and has not been confirmed against this unit. A value it refuses will fail with a message from the terminal rather than being saved silently. See the Diagnostics tab for its capability documents.',
  'device.editor.door.modules': 'Active modules',
  'device.editor.door.modules.hint':
    'The credential modules the reader has enabled. Read-only — turning one off here would stop everybody who only enrolled with that module.',
  'device.editor.door.thresholds': 'Matching thresholds',
  'device.editor.door.thresholds.hint':
    'A higher threshold refuses more near matches: fewer false matches, more scans that have to be repeated.',
  'device.editor.door.faceThreshold': 'Face threshold',
  'device.editor.door.faceThreshold.hint': '0–100',
  'device.editor.door.group.liveness': 'Liveness detection',
  'device.editor.door.liveness': 'Liveness detection',
  /*
   * The last clause is what the setting is actually for: without it a matched face is only a
   * sufficiently similar image.
   */
  'device.editor.door.liveness.hint':
    'Screens out photographs, video and masks. Without it, a matched face is only an image that was similar enough.',
  'device.editor.door.liveness.offWarning':
    'Liveness detection is off on this terminal. A photograph of somebody held up to the reader can open the door and be recorded as their attendance.',
  'device.editor.door.livenessLevel': 'Detection level',
  'device.editor.door.livenessLevel.caption': 'Level',
  'device.editor.door.livenessLevel.hint':
    'A stricter level refuses more attempts but also refuses more genuine faces in poor light.',
  'device.editor.door.disabledOpenDuration': 'Extended duration',
  'device.editor.door.disabledOpenDuration.hint': 'Seconds, for those who need longer',
  'device.editor.door.alarmTimeout': 'Held-open alarm',
  'device.editor.door.alarmTimeout.hint': 'Seconds, 0 turns it off',
  'device.editor.door.sensors': 'Sensors',
  'device.editor.door.sensors.hint':
    'The resting state of the magnetic sensor and the exit button. The exit button is wired in hardware, so it is shown only.',
  'device.editor.door.exitButton': 'Exit button',
  'device.editor.door.onScreen': 'Shown on screen',
  /*
   * The use case is named: it is what makes resolving an ID mapping possible, because the terminal screen
   * names who it thinks just scanned.
   */
  'device.editor.door.onScreen.hint':
    'Showing the name is useful while resolving ID mappings: the terminal screen names the person it thinks just scanned.',
  'device.editor.door.showName': 'Name',
  'device.editor.door.showEmployeeNo': 'Staff no.',
  'device.editor.door.showPicture': 'Photo',
  'device.editor.door.masking': 'Masking',
  /*
   * The reason it is display-only: turning it off puts full names and staff numbers on a screen in a
   * public corridor, which should be a recorded decision rather than a switch on a settings tab.
   */
  'device.editor.door.masking.hint':
    'Shown only. Turning it off puts full names and staff numbers on a screen in a public corridor, so it should be a recorded decision rather than a switch on a settings tab.',
  'device.editor.door.masking.on': 'Masked',
  'device.editor.door.masking.off': 'Shown in full',
  'device.editor.door.masking.unknown': 'Not reported',
  'device.editor.verify.faceOrPw': 'Face or PIN',
  'device.editor.verify.faceOrFpOrCardOrPw': 'Any one: face, fingerprint, card or PIN',
  'device.editor.verify.faceOrFpOrCardOrPw.hint':
    'The loosest setting. This is a test unit’s configuration — anybody who knows the PIN can get in with no biometrics.',
  'device.editor.verify.cardAndPw': 'Card and PIN',
  // Names the screen and the permission page, matching `device.title` and the nav.
  'device.editor.readOnly':
    'This tab is read-only because your role does not hold the {action} permission on the Device List. Ask for it under Settings › Role Management.',

  // ---------------------------------------------------------------------------
  // Remote restart
  // ---------------------------------------------------------------------------
  'device.editor.reboot.group': 'Restart the terminal',
  'device.editor.reboot.group.subtitle':
    'The only control on this screen that takes a door out of service.',
  'device.editor.reboot.disruptive': 'Disruptive',
  'device.editor.reboot.action': 'Restart remotely',
  'device.editor.reboot.action.hint':
    'Use this after changing a setting the terminal is ignoring, or when a unit answers but behaves oddly. One audit row is recorded with your name on it.',
  'device.editor.reboot': 'Restart terminal',
  // Names the probe button, so it matches `device.editor.recheck`.
  'device.editor.reboot.sent':
    '{name} is restarting. It will not answer for one to two minutes — press Probe after that to confirm it is back.',
  'device.editor.reboot.error': 'Could not send the restart command',
  'device.editor.reboot.confirm.title': 'Restart {name}?',
  'device.editor.reboot.confirm.description':
    'The terminal will stop answering entirely while it comes back up.',
  /*
   * The consequence is stated in full, including the timing advice, because that is the decision being
   * asked for.
   */
  'device.editor.reboot.confirm.consequence':
    'This door will not verify anybody for one to two minutes. Anyone standing in front of it during that time cannot get in and their scan will not be recorded. Do not do this at shift changeover.',
  'device.editor.reboot.confirm.safe':
    'Attendance already recorded is not lost. Events are held on the terminal against a rising serial number, and the periodic pull picks up whatever push missed while it was down.',
  'device.editor.reboot.confirm.submit': 'Yes, restart it now',
};

/**
 * Navigation and the terminal driver vocabulary.
 *
 * The domain headings and group rows came in when the rail grew to twenty-two entries under six
 * headings; they are read at a glance rather than word by word, so each is one or two words.
 *
 * Vendor and protocol names are left alone. `Hikvision`, `ZKTeco`, `Dahua`, `ISAPI`, `ADMS`, `CGI` —
 * these are read beside the terminal's own web interface and its documentation, and translating them
 * would leave somebody comparing two different names for one thing.
 */
export const EN_LABELS_NAV_DRIVERS: Partial<Record<LabelKey, string>> = {
  'nav.domain.operations': 'Operations',
  'nav.domain.humanResources': 'Human Resources',
  'nav.domain.system': 'System',

  'nav.group.leave': 'Leave',
  'nav.group.claims': 'Claims',
  'nav.group.overtime': 'Overtime',
  'nav.group.expenses': 'Expenses',

  /*
   * All four read 'Settings', because each sits inside its own module's group.
   *
   * The Malay is the same word four times for the same reason: the group row above already says which
   * module it belongs to, and repeating it would give the rail four entries whose labels differ only
   * in a word nobody needs to read twice.
   */
  'nav.hr.leaveSettings': 'Settings',
  'nav.hr.claimSettings': 'Settings',
  'nav.hr.overtimeSettings': 'Settings',
  'nav.hr.expenseSettings': 'Settings',

  'event.kind.identified': 'Identified',
  'event.kind.unrecognised': 'Not recognised',
  'event.kind.other': 'Other events',

  'device.vendor.hikvision': 'Hikvision',
  'device.vendor.zkteco': 'ZKTeco',
  'device.vendor.dahua': 'Dahua',
  'device.protocol.isapi': 'ISAPI',
  'device.protocol.ta-push': 'TA Push (ADMS)',
  'device.protocol.dahua-cgi': 'CGI',

  /*
   * Which side opens the connection, in the badge's own voice.
   *
   * Upper case comes from `className`, not from the words — `.toUpperCase()` is not safe in every
   * language. The distinction carries a real consequence stated in the dialog hints below: one needs a
   * route to the terminal, the other needs nothing inbound at all.
   */
  'device.reach.inbound': 'Server connects',
  'device.reach.outbound': 'Terminal connects',

  'monitor.detail.eventKey': 'Event key',
  'rawlog.detail.eventKey': 'Event key',
  /** The credential, not a stored password. A terminal keypad takes a PIN. */
  'method.password': 'PIN',
  'method.unknown': 'Unknown',
};

/**
 * Leave policy: the per-type gates, the balance panel, and the settings screen around them.
 *
 * Several of these state a statutory position. `s.60E` and `s.60F` are sections of the Employment Act
 * and stay as written — a clerk checking the figure against the Act needs the same reference.
 *
 * The consequence clauses are kept whole. Each exists because somebody would otherwise switch a
 * setting without reading what it does, and the clause that would be cut in a shorter version is the
 * clause that was the point.
 */
export const EN_LABELS_LEAVE_POLICY: Partial<Record<LabelKey, string>> = {
  'staffForm.gender': 'Gender',
  'staffForm.gender.unset': 'Not recorded',
  'staffForm.gender.male': 'Male',
  'staffForm.gender.female': 'Female',
  'staffForm.gender.hint':
    'Needed only for leave restricted to one gender, such as Maternity Leave and Paternity Leave. An application of that kind is refused when this field is empty.',

  'leave.new.searchStaff.hint':
    'Choosing a staff member loads their balance, and which leave types that person is eligible for.',
  'leave.new.reason.hint': 'The basis for the application. Whoever approves it reads this first.',
  'leave.new.remarks': 'Remarks',
  'leave.new.remarks.hint': 'Practical detail — handover, a number to call. Optional.',
  'leave.new.remarks.placeholder': 'Additional notes…',

  'leave.new.balance': 'Balance',
  'leave.new.balance.waiting': 'Choose a staff member and a leave type.',
  'leave.new.balance.unlimited': 'No limit — the balance is not a control for this category.',
  'leave.new.balance.remaining': '{days} days left',
  'leave.new.balance.breakdown': 'of {entitled} · {taken} taken · {pending} pending',
  'leave.new.balance.carried': '{days} carried from last year',

  'leave.type.column.countedIn': 'Counted in',
  'leave.type.column.eligibility': 'Applicant eligibility',
  'leave.type.column.document': 'Document',

  'leave.type.countedIn.working': 'Working days',
  'leave.type.countedIn.calendar': 'Calendar days',
  'leave.type.eligibility.all': 'All employees',
  'leave.type.eligibility.male': 'Men only',
  'leave.type.eligibility.female': 'Women only',
  'leave.type.tiers.tooltip': 'Under 2 years / 2 to 5 years / over 5 years of service',
  'leave.type.carry.badge': 'balance carried',

  /*
   * Each names the column it answers, not 'yes' or 'no'.
   *
   * These are the accessible names on `BoolMark`, which renders a mark rather than a word. A cell
   * announcing 'no' on its own tells a screen reader user nothing about what is being denied.
   */
  'leave.type.paid.yes': 'Paid',
  'leave.type.paid.no': 'Unpaid',
  'leave.type.backdated.yes': 'Past dates allowed',
  'leave.type.backdated.no': 'Past dates refused',
  'leave.type.approval.yes': 'Needs approval',
  'leave.type.approval.auto': 'Approved on submit',
  'leave.type.document.yes': 'Supporting document required',
  'leave.type.document.no': 'No document required',

  'leave.type.dialog.description': 'Description',
  'leave.type.dialog.description.placeholder': 'e.g. Sick leave with a medical certificate',
  'leave.type.dialog.description.hint':
    'Shown to staff on the application form, and under the name in this list.',
  'leave.type.dialog.countedIn.hint': 'Calendar counts rest days and public holidays.',
  'leave.type.dialog.eligibility.hint': 'Refused when the staff gender is missing.',

  'leave.type.dialog.serviceTiers': 'Entitlement rises with length of service',
  'leave.type.dialog.serviceTiers.hint':
    'The Employment Act grades annual leave at 8/12/16 days (s.60E) and sick leave at 14/18/22 days (s.60F), stepping at two and five years of service.',
  'leave.type.dialog.tier1': 'Under 2 years',
  'leave.type.dialog.tier1.hint': 'Taken from Days per year above.',
  'leave.type.dialog.tier2': '2 to 5 years',
  'leave.type.dialog.tier3': 'Over 5 years',

  'leave.type.dialog.carryForward': 'Carry the balance into next year',
  'leave.type.dialog.carryForward.hint':
    'Derived from the previous year when the balance is read, not stored — so there is no year-end job that can be missed. It carries one year forward only.',
  'leave.type.dialog.carryMax': 'Cap on days carried',
  'leave.type.dialog.carryMax.placeholder': 'No cap',
  'leave.type.dialog.carryMax.hint': 'Leave empty to carry the whole balance.',

  'leave.type.dialog.document': 'Requires a supporting document',
  'leave.type.dialog.document.hint':
    'Checked at approval, not at application — so sick leave can be filed first and the certificate attached later. A rejection is still allowed without the document.',

  'hr.template.form.enabled.hint':
    'Switched off, the event still happens and is still recorded — no email is sent for it.',

  'leave.settings.title': 'Leave Settings',
  'leave.settings.subtitle':
    'Leave types, who approves an application, and who is told the outcome.',
  'claim.settings.title': 'Claim Settings',
  'claim.settings.subtitle': 'Claim types, who approves them, and who is told the outcome.',
  'overtime.settings.title': 'Overtime Settings',
  'overtime.settings.subtitle':
    'The rates that multiply hours worked, who approves an application, and who is told the outcome.',
  'expense.settings.title': 'Expense Settings',
  'expense.settings.subtitle':
    'Expense categories, who approves them, and who is told the outcome.',
};

/**
 * Multi-line claims: the line editor, the per-line receipt, and the category settings.
 *
 * 'Line' throughout for `baris`, not 'item' or 'row'. A claim line is a cost with its own date and its
 * own paper, and 'item' reads as a thing bought rather than as an entry on a claim.
 *
 * `EVERY` is capitalised in `items.receiptHint` as the Malay capitalises `SETIAP`, and `NOT` in
 * `requiresApproval.hint` as it capitalises `BELUM`. Both mark the word that changes the meaning of
 * the sentence, and both are the words somebody skims past.
 */
export const EN_LABELS_CLAIM_LINES: Partial<Record<LabelKey, string>> = {
  'claim.column.items': 'Lines',
  /*
   * A count, not a link. Receipts hang off lines now, so one cell cannot open 'the receipt' — and what
   * an approver needs from that column is whether any are still outstanding.
   */
  'claim.receipt.allPresent': '{count} receipts',
  'claim.receipt.someMissing': '{missing} of {count} without a receipt',
  'claim.receipt.removed': 'That line’s receipt was removed.',

  'claim.new.staff.hint': 'Type a name or staff number. The list is filtered on the server.',
  'claim.new.incurredOn.hint':
    'The date the claim is filed against. Each line carries the date its own cost was incurred.',
  'claim.new.detail.hint': 'What this claim is for as a whole. Each line describes itself.',
  'claim.new.remarks.hint': 'Practical detail — order number, project name. Optional.',

  'claim.new.items': 'Claim Lines',
  'claim.new.items.hint': 'One line per cost. Add as many as needed, up to 50.',
  'claim.new.items.receiptHint':
    'One line per cost, and this category requires a receipt on EVERY line before the claim can be approved.',
  'claim.new.items.add': 'Add Line',
  'claim.new.items.row': 'Line {index}',
  'claim.new.items.remove': 'Remove this line',
  'claim.new.items.lastRow': 'A claim needs at least one line',
  'claim.new.items.date': 'Date',
  'claim.new.items.description': 'Line description',
  'claim.new.items.description.placeholder': 'e.g. Kanowit–Sibu toll',
  'claim.new.items.category': 'Category',
  'claim.new.items.category.placeholder': 'Optional',

  /*
   * The wording says the upload has not happened yet, because it has not.
   *
   * A file input holds a handle to something on the user's disk, not a value in the form, so it cannot
   * travel with the claim — the file waits, the claim is filed, then each line's file is posted against
   * the row that came back. A control labelled 'attach' that does nothing until submit is a control
   * that lies about what it did.
   */
  'claim.new.items.receipt': 'Receipt',
  'claim.new.items.receipt.attach': 'Choose a receipt file',
  'claim.new.items.receipt.replace': 'Change file',
  'claim.new.items.receipt.clear': 'Remove the chosen file',
  'claim.new.items.receipt.none': 'No file chosen yet',
  'claim.new.items.receipt.pending': 'Will upload after submit',
  'claim.new.items.receipt.formats': 'PDF, PNG, JPEG or WEBP, 4 MB maximum.',
  'claim.new.items.receipt.tooBig': '{name} is over 4 MB. Choose a smaller file.',
  'claim.new.uploaded': '{count} receipts attached.',
  'claim.new.uploadFailed':
    '{count} receipts failed to upload. The claim is already recorded — attach them again from the list.',

  'claim.new.total': 'Total',
  'claim.new.total.overCap':
    'Over the {cap} category ceiling. That ceiling applies to the claim total, not to each line — the server will refuse it.',

  'claim.types.count': '{count} claim types',
  'claim.types.column.approval': 'Needs approval',
  'claim.types.receipt.yes': 'A receipt is required on every line',
  'claim.types.receipt.no': 'No receipt required',
  'claim.types.approval.yes': 'Needs approval',
  'claim.types.approval.auto': 'Recorded as approved on submit',
  'claim.types.form.description.hint':
    'Shown to staff on the claim form, and under the name in this list.',
  'claim.types.form.requiresReceipt.hint':
    'A claim with no receipt cannot be approved. Checked at approval, not on submit — so the form can be saved first and the receipt attached later.',
  'claim.types.form.requiresApproval': 'Requires approval',
  'claim.types.form.requiresApproval.hint':
    'Switched off, a claim is recorded as approved on submit. It is still NOT paid — payment is recorded separately either way.',
};

/**
 * Multi-vendor device fields, and the public holiday calendar.
 *
 * The holiday warnings name Malaysian states and festivals. `Sarawak`, `Deepavali`, `Nuzul Al-Quran` —
 * proper nouns, and the gazette question is about those specific days, so a generic phrasing would lose
 * the fact the warning exists to state.
 */
export const EN_LABELS_DEVICE_VENDOR_HOLIDAY: Partial<Record<LabelKey, string>> = {
  'device.warning.noSerial':
    'No serial number recorded yet. This terminal identifies itself by serial number alone, so a scan from it cannot be matched to this record and will be refused until it has contacted the server once.',
  'device.warning.faceAtTerminal':
    'This firmware does not accept face uploads. Faces have to be enrolled at the terminal itself — staff need to stand in front of the machine.',

  'device.dialog.vendor': 'Make',
  'device.dialog.protocol': 'Protocol',
  'device.dialog.reach.inbound':
    'The server connects to this terminal. For a remote site the server has to be able to reach its address — usually over a site-to-site VPN.',
  'device.dialog.reach.outbound':
    'This terminal connects to the server, not the other way round. No inbound access is needed, so a remote site needs no VPN — only an outbound connection to this server.',

  /*
   * The failure that looks like success.
   *
   * Deliveries arriving and parsing to nothing is what a renamed firmware field looks like from here:
   * the terminal is reachable, the log fills, and no attendance is recorded. Counted separately so the
   * screen can say so instead of showing a healthy device with an empty punch list.
   */
  'device.ingest.ignored': 'No events',
  'device.ingest.ignored.note':
    '{count} deliveries were read but held no event that could be filed. This usually means the firmware renamed a field: the terminal looks like it is working, and no scans arrive.',

  'device.editor.group.identification': 'Identification',
  'device.editor.field.serialIdentity': 'Serial number',
  'device.editor.field.serialIdentity.hint':
    'This protocol uses no username or password. The terminal identifies itself by serial number on every request, so that number is the only thing matching an incoming scan to this record.',
  'device.editor.field.serialIdentity.missing':
    'The serial number is not known yet. It is filled in when the terminal first contacts the server — until then a scan from it cannot be matched to this record and will be refused.',
  'device.editor.field.vendor': 'Make and protocol',
  'device.editor.field.vendor.hint':
    'Cannot be changed once the device exists. Every raw event and ID mapping on this record belongs to that protocol’s semantics, so changing it would reinterpret the history rather than change the connection. For a terminal of another make, add a new record and deactivate the old one.',

  'integration.holiday.never': 'Never synced',
  'integration.holiday.enabled': 'Enable public holidays',
  'integration.holiday.enabled.hint':
    'Switched off, public holidays no longer count as days off in leave calculations. Weekly rest days still apply.',
  'integration.holiday.autoSync': 'Auto-sync',
  'integration.holiday.autoSync.hint':
    'Refreshes the list on the interval below. Switching it off leaves the list as it is — which is not the same as switching public holidays off.',
  'integration.holiday.year': 'Scheduled sync year',
  'integration.holiday.year.hint':
    'The year auto-sync will pull. The Sync button below uses the year currently shown, not this one.',
  'integration.holiday.cache': 'Refresh every',
  'integration.holiday.cache.hint': 'Minutes. 1440 is a day. Zero means every time.',

  'integration.holiday.offices': 'States the organisation operates in',
  'integration.holiday.offices.count': '{count} of 16 selected',
  'integration.holiday.offices.note':
    'Tick every state this organisation has an office in. A sync pulls the lists for these states in one pass, and a day observed in more than one state is listed as nationwide.',
  /*
   * The reason the union of ticked states is used rather than the library's own national list.
   *
   * Measured, not assumed: that list carries Deepavali and Nuzul Al-Quran, which Sarawak does not
   * gazette. Writing them would take two working days a year out of the divisor payroll divides by,
   * and nothing on any screen would look wrong.
   */
  'integration.holiday.offices.warning':
    'Only days gazetted by the ticked states are written. This matters: the library’s "national" list includes Deepavali and Nuzul Al-Quran, which Sarawak does not gazette — writing them would stop two working days a year counting as working days in the divisor payroll uses.',

  'integration.holiday.sync': 'Sync',
  'integration.holiday.synced': '{count} holidays synced for {year}.',
  'integration.holiday.dirty':
    'Save the state list first. A sync stores holidays against the saved list, not against the ticks on screen.',
  'integration.holiday.error.list': 'Could not load the holiday list',
  'integration.holiday.error.sync': 'Holiday sync failed',

  'integration.holiday.list.title': 'Holidays in {year} — {count} days',
  'integration.holiday.list.hidden':
    '{count} more days belong to states with no office here, hidden.',
  'integration.holiday.list.empty': 'No holidays for this year. Press Sync to pull them.',
  'integration.holiday.list.year': 'Year shown',
  'integration.holiday.list.scope': 'List scope',
  'integration.holiday.list.scope.offices': 'Our offices',
  'integration.holiday.list.scope.all': 'All states',

  'integration.holiday.column.date': 'Date',
  'integration.holiday.column.day': 'Day',
  'integration.holiday.column.name': 'Holiday',
  'integration.holiday.column.type': 'Type',
  'integration.holiday.column.states': 'States',
  'integration.holiday.type.national': 'Nationwide',
  'integration.holiday.type.state': 'State',
  'integration.holiday.type.company': 'Organisation',
  'integration.holiday.allStates': 'All offices',
};
