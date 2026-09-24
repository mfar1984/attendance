/**
 * Every translatable string in the interface.
 *
 * Shared rather than living in either app, because both need it and for different reasons:
 * the web renders from it and falls back to it, the server syncs it into the database to
 * assign each label the number an operator sees. Two copies would drift, and the first
 * symptom would be a translation attached to the wrong string.
 *
 * The key is the stable identity. The number an operator quotes is an autoincrement in
 * `translation_labels`, assigned once against the key and never reused — so renaming a key
 * here creates a new label and retires the old one, which is the right outcome: a renamed
 * key is a different string.
 *
 * The value is the Malay wording, and it is the single place that wording is written.
 * `<T>` reads it as the fallback, so a call site never repeats the text and the two cannot
 * disagree.
 *
 * Malay is not stored as a translation of itself. Correcting a word here corrects it
 * everywhere immediately; a stored Malay copy would win over the correction and the change
 * would appear to do nothing.
 */

/** Group names, keyed by the first segment of a label key. */
export const LABEL_GROUPS: Record<string, string> = {
  app: 'Umum',
  login: 'Log Masuk',
  nav: 'Navigasi',
  shell: 'Rangka Aplikasi',
  panel: 'Panel & Jadual',
  filter: 'Penapis',
  dialog: 'Dialog',
  exception: 'Jenis Pengecualian',
  exceptions: 'Skrin Pengecualian',
  records: 'Rekod Kehadiran',
  monitor: 'Monitor Hari Ini',
  rawlog: 'Log Scan Mentah',
  builder: 'Penjana Laporan',
  staff: 'Direktori Staf',
  staffForm: 'Borang Staf',
  biometrics: 'Pendaftaran Biometrik',
  import: 'Import Pukal',
  mapping: 'Pemetaan ID Terminal',
  org: 'Jabatan & Lokasi',
  weekday: 'Hari Dalam Minggu',
  holidays: 'Cuti Umum',
  roster: 'Kalendar Kerja',
  shifts: 'Shift & Waktu Kerja',
  patternKind: 'Jenis Pola Kerja',
  leave: 'Permohonan Cuti',
  overtime: 'Permohonan Lebih Masa',
  claim: 'Permohonan Tuntutan',
  expense: 'Permohonan Perbelanjaan',
  recruit: 'Pengambilan',
  kpi: 'KPI & Penilaian',
  hr: 'Aliran Kelulusan HR',
  // Two groups for the justification flow, on purpose. `self` is what a person reads about
  // themselves — and it is the whole Android surface, so whoever translates it is translating a
  // phone app. `justify` is the supervisor's queue. Different readers, different register.
  justify: 'Justifikasi Kehadiran',
  monthly: 'Ringkasan Bulanan',
  // Two payroll groups on purpose. `payroll` is the attendance export a payroll clerk reads;
  // `pay` is the module that pays people. Sharing one prefix would put "hari dijadualkan" and
  // "KWSP majikan" under one heading for whoever is translating, and they are different jobs.
  payroll: 'Export Payroll',
  pay: 'Payroll & Pampasan',
  reportField: 'Medan Laporan',
  reportDataset: 'Set Data Laporan',
  reportGroup: 'Cara Pengumpulan',
  action: 'Tindakan Kebenaran',
  userStatus: 'Status Akaun',
  logLevel: 'Aras Log',
  logCategory: 'Kategori Log',
  logSource: 'Sumber Log',
  entity: 'Jenis Entiti',
  encryption: 'Penyulitan Emel',
  tokenStatus: 'Status Token',
  auditAction: 'Tindakan Audit',
  logs: 'Skrin Log',
  perm: 'Registri Kebenaran',
  roles: 'Peranan & Kebenaran',
  backup: 'Backup & Restore',
  maintenance: 'Maintenance & Cache',
  users: 'Pengurusan Pengguna',
  translation: 'Alih Bahasa',
  integration: 'Integrasi',
  api: 'API & Webhook',
  token: 'Token API',
  trigger: 'Pencetus Notifikasi',
  channel: 'Borang Saluran',
  // One group per integration tab rather than everything under `integration`. A translator
  // working on the SMS gateway should not have to read past the webhook signature wording.
  sms: 'SMS melalui Infobip',
  telegram: 'Telegram',
  emailProfile: 'Profil Emel',
  webhook: 'Webhook',
  security: 'Dasar Keselamatan',
  profile: 'Profil Saya',
  method: 'Cara Pengesahan',
  status: 'Status Kehadiran',
  leaveStatus: 'Status Cuti',
  event: 'Kod Peristiwa Terminal',
  scan: 'Scan',
  device: 'Peranti',
  // Own group rather than `device.*`. A terminal and the machine that reaches one are different
  // subjects, and whoever translates the connector screen is writing about firewalls and
  // installers rather than about clocks and face enrolment.
  agent: 'Connector Tapak',
  dashboard: 'Dashboard',
  settings: 'Tetapan',
};

export const LABELS = {
  // -------------------------------------------------------------------------
  // Dipakai di lebih satu tempat
  //
  // These are `app.*` rather than living under the first screen that happened to need
  // them. The product name appears on the login card and in the sidebar head; two labels
  // holding the same words would have to be translated twice and could disagree, and a
  // sidebar that disagrees with the login screen about what the product is called reads as
  // two applications.
  // -------------------------------------------------------------------------
  'app.brand': 'Sistem Kehadiran',
  'app.loading': 'Memuatkan',
  /** The header control and the panel footer control are the same act, so one label. */
  'app.refresh': 'Muat semula',

  /**
   * The confirm button on every destructive dialog, and the fallback message when a save
   * or a delete fails without the server naming a reason.
   *
   * These began as `org.*` because the departments screen needed them first. That put
   * three strings that appear on six screens into the group a translator opens to work on
   * departments, where they would be read in that context. They are `app.*` for the same
   * reason as the product name: shared words, one label.
   */
  'app.remove': 'Buang',
  'app.error.save': 'Gagal menyimpan',
  'app.error.remove': 'Gagal membuang',

  /**
   * The state badge, wherever a row is either in use or not.
   *
   * Staff, roles, languages and accounts all carry it, and it is the same two words meaning
   * the same thing. Upper case comes from the badge's own class, not from the string.
   *
   * The line drawn here: one label when the same UI idiom renders it — a badge or a chip.
   * Not shared with the lower-case runs of prose (`leave.type.inactive`) or with the
   * yes/no answers in a detail grid (`shifts.shift.detail.active.yes`), because those are
   * different registers and a language may not be able to change one into the other.
   */
  'app.status.active': 'Aktif',
  'app.status.inactive': 'Tidak aktif',

  // -------------------------------------------------------------------------
  // Log masuk
  // -------------------------------------------------------------------------
  'login.organisation': 'Hospital Sibu',
  'login.email': 'Emel',
  'login.email.placeholder': 'nama@hospital.local',
  'login.password': 'Kata Laluan',
  'login.totp': 'Kod 2FA',
  'login.totp.hint': 'Wajib untuk akaun admin. Biarkan kosong untuk akaun staf.',
  'login.submit': 'Log Masuk',
  'login.submit.pending': 'Sedang masuk…',

  /**
   * Validation messages are labels too.
   *
   * They are the sentences a person reads most often on this screen — nobody sees a login
   * form as much as they see its complaints — so leaving them untranslated would make the
   * screen bilingual exactly when somebody is already having trouble.
   */
  'login.error.email': 'Masukkan emel yang sah',
  'login.error.password': 'Kata laluan diperlukan',
  'login.error.totp': 'Kod 2FA mesti 6 digit',
  'login.error.unreachable': 'Tidak dapat menghubungi pelayan',

  // -------------------------------------------------------------------------
  // Navigasi
  //
  // The sidebar entries. `lib/nav.ts` holds these keys rather than the words, because the
  // nav is data: a structure that carried translated text would be built once at import and
  // keep whatever language was current then.
  //
  // A group's key doubles as its identity in the expanded-set stored in `localStorage`. That
  // is deliberate — using the visible title would reset every open group the moment somebody
  // switched language.
  // -------------------------------------------------------------------------
  'nav.dashboard': 'Dashboard',

  'nav.group.attendance': 'Kehadiran',
  'nav.attendance.monitor': 'Monitor Hari Ini',
  'nav.attendance.records': 'Rekod Kehadiran',
  'nav.attendance.rawLog': 'Log Scan Mentah',
  'nav.attendance.exceptions': 'Pengecualian',

  'nav.group.staff': 'Staf',
  'nav.staff.directory': 'Direktori Staf',
  'nav.staff.biometrics': 'Pendaftaran Biometrik',
  'nav.staff.mapping': 'Pemetaan ID Terminal',
  'nav.staff.import': 'Import Pukal',
  'nav.staff.departments': 'Jabatan & Lokasi',

  'nav.group.schedule': 'Jadual',
  'nav.schedule.shifts': 'Shift & Waktu Kerja',
  'nav.schedule.roster': 'Kalendar Kerja',
  'nav.schedule.holidays': 'Cuti Umum',
  /**
   * Leave keeps this key and the `/jadual/permohonan` URL even though the entry now sits
   * under Permohonan.
   *
   * The wording is what the header reads, and "Cuti" alone there could be taken for the
   * public holiday screen. The URL is what saved links and habits already point at.
   */
  'nav.schedule.leave': 'Permohonan Cuti',

  /**
   * Still the heading of the permission matrix section, no longer a sidebar group.
   *
   * The rail now carries one group per module — Cuti, Tuntutan, Lebih Masa, Perbelanjaan — each
   * holding its applications list and its settings, which matches the three HR groups beside it
   * that already end in Tetapan.
   *
   * The matrix keeps them as four rows under this one heading, and deliberately. Each module is a
   * single permission key, so four sections would be four heading rows introducing four data rows.
   * The rail navigates screens; the matrix grants actions on keys. Their natural granularity
   * differs, and the domain heading above both is what keeps them aligned.
   */
  'nav.group.requests': 'Permohonan',

  'nav.group.leave': 'Cuti',
  'nav.group.claims': 'Tuntutan',
  'nav.group.overtime': 'Lebih Masa',
  'nav.group.expenses': 'Perbelanjaan',

  'nav.hr.claims': 'Permohonan Tuntutan',
  'nav.hr.overtime': 'Permohonan Lebih Masa',
  'nav.hr.expenses': 'Permohonan Perbelanjaan',

  /**
   * The settings entry under each request module.
   *
   * One word, because the group title beside it already names the module — "Cuti › Tetapan" reads
   * where "Cuti › Tetapan Cuti" stutters. The screen's own heading carries the full name.
   */
  'nav.hr.leaveSettings': 'Tetapan',
  'nav.hr.claimSettings': 'Tetapan',
  'nav.hr.overtimeSettings': 'Tetapan',
  'nav.hr.expenseSettings': 'Tetapan',

  'nav.group.recruitment': 'Pengambilan',
  'nav.hr.career': 'Iklan Jawatan',
  'nav.hr.applicants': 'Pemohon',
  'nav.hr.careerArchive': 'Arkib Pengambilan',
  'nav.hr.careerSettings': 'Tetapan Pengambilan',

  'nav.group.kpi': 'KPI & Penilaian',
  'nav.hr.kpiTemplates': 'Templat KPI',
  'nav.hr.kpiPeriods': 'Tempoh Penilaian',
  'nav.hr.kpiAssignments': 'Penugasan KPI',
  'nav.hr.kpiReviews': 'Semakan Penilaian',
  'nav.hr.kpiResults': 'Keputusan KPI',
  'nav.hr.kpiSettings': 'Tetapan KPI',

  'nav.group.payroll': 'Payroll & Pampasan',
  'nav.hr.payrollPeriods': 'Tempoh Payroll',
  'nav.hr.allowances': 'Elaun',
  'nav.hr.bonuses': 'Bonus',
  'nav.hr.commissions': 'Komisen',
  'nav.hr.loans': 'Pinjaman',
  'nav.hr.advances': 'Pendahuluan Gaji',
  'nav.hr.payrollSettings': 'Tetapan Payroll',

  'nav.group.reports': 'Laporan',
  'nav.reports.monthly': 'Ringkasan Bulanan',
  'nav.reports.payroll': 'Export Payroll',
  'nav.reports.builder': 'Penjana Laporan',

  // -------------------------------------------------------------------------
  // Justifikasi kehadiran — barisan penyelia
  // -------------------------------------------------------------------------
  /**
   * The supervisor's queue, and why it is not the Pengecualian screen.
   *
   * Exceptions are the eight conditions the engine could not resolve — an unmatched face, a terminal
   * whose clock drifted — and resolving one corrects data. These are the four states the engine
   * resolved with confidence and that somebody wants to account for; deciding one changes no
   * attendance figure anywhere. One screen for both would ask the same person to decide a terminal's
   * clock drift and a sick child through the same form.
   *
   * There is no `self.*` group beside this. Staff do not log into this application —
   * `UserAccount.accountType` is documented as "`admin` administers the system; `staff` is the mobile
   * check-in app" — so the screens where somebody files an explanation belong to the Android client,
   * served by `/api/saya/*`. A four-entry REKOD SAYA group was added to the sidebar and removed
   * again; its labels went with it.
   */
  'nav.attendance.justifications': 'Kelulusan Justifikasi',

  'justify.title': 'Kelulusan Justifikasi',
  'justify.subtitle':
    'Sebab yang staf beri bagi hari yang direkodkan sebagai lewat, keluar awal, tidak lengkap atau tidak hadir. Keputusan di sini tidak mengubah mana-mana angka kehadiran — rekodnya betul, dan yang diputuskan ialah sama ada sebabnya diterima.',
  'justify.note.notExceptions':
    'Ini berasingan daripada Pengecualian. Pengecualian ialah lapan keadaan yang enjin tidak dapat selesaikan — muka tidak dikenali, jam terminal hanyut — dan menyelesaikannya membetulkan data. Skrin ini pula tidak menyentuh data sama sekali.',
  'justify.note.noChain':
    'Tiada rantaian aras. Satu penghantaran, satu keputusan, satu mesej kepada orang yang menghantarnya.',

  'justify.kind.late': 'Lewat Masuk',
  'justify.kind.early_leave': 'Keluar Awal',
  'justify.kind.incomplete': 'Tidak Lengkap',
  'justify.kind.absent': 'Tidak Hadir',

  'justify.status.pending': 'Menunggu',
  'justify.status.approved': 'Diluluskan',
  'justify.status.rejected': 'Ditolak',
  /**
   * Not a rejection, and named so it cannot be read as one.
   *
   * "Your reason was not accepted" and "I cannot act on what you wrote" are different messages, and
   * only one of them means the person should try again. It is amber on screen, not red.
   */
  'justify.status.reverted': 'Dihantar Semula',

  'justify.column.staff': 'Staf',
  'justify.column.date': 'Tarikh',
  'justify.column.kind': 'Jenis',
  'justify.column.record': 'Rekod Hari Itu',
  'justify.column.reason': 'Sebab',
  'justify.column.submitted': 'Dihantar',
  'justify.column.decided': 'Diputuskan',
  'justify.empty': 'Tiada justifikasi dalam tempoh ini.',
  'justify.error.load': 'Senarai justifikasi tidak dapat dimuatkan.',

  'justify.filter.from': 'Dari',
  'justify.filter.to': 'Hingga',
  'justify.filter.department': 'Semua jabatan',
  'justify.filter.kind': 'Semua jenis',

  'justify.action.view': 'Buka butiran',
  'justify.action.approve': 'Luluskan',
  'justify.action.reject': 'Tolak',
  'justify.action.revert': 'Hantar semula',

  'justify.form.title': 'Sebab bagi {date}',
  'justify.form.reason': 'Sebab',
  'justify.form.record': 'Rekod hari itu',

  /**
   * Columns describing the attendance day the explanation is about.
   *
   * Under `justify.*` rather than `self.*`. They were written for a staff-facing screen that no
   * longer exists here, and a prefix naming a reader who never opens this application would send
   * whoever translates it looking for a screen they cannot find.
   */
  'justify.record.shift': 'Shift',
  'justify.record.scheduled': 'Jadual',
  'justify.record.actual': 'Sebenar',
  'justify.record.hours': 'Jam Kerja',
  'justify.record.late': 'Lewat {minutes} min',
  'justify.record.early': 'Awal {minutes} min',

  'justify.decision.note': 'Catatan',
  'justify.decision.note.hint':
    'Wajib untuk menolak dan untuk menghantar semula. Keputusan tanpa perkataan ialah keputusan yang orang itu tidak boleh terima atau perbaiki.',
  'justify.decision.note.optional': 'Pilihan untuk kelulusan — orang itu sudah menulis sebabnya.',
  'justify.decided': 'Keputusan direkodkan.',
  'justify.decision.recordMissing':
    'Rekod kehadiran bagi hari ini sudah dikira semula dan tidak lagi sepadan. Baris ini kekal sebagai rekod apa yang ditanya dan dijawab.',

  // Penolakan yang pelayan hantar sebagai prosa; didaftar di sini untuk sepanduk pada skrin.
  'justify.refuse.alreadyPending': 'Sudah ada sebab yang menunggu keputusan untuk hari itu.',

  'nav.group.settings': 'Tetapan',
  'nav.settings.general': 'Konfigurasi Umum',
  'nav.settings.devices': 'Senarai Peranti',
  'nav.settings.integration': 'Integrasi',
  'nav.settings.roles': 'Pengurusan Peranan',
  'nav.settings.users': 'Pengurusan Pengguna',
  'nav.settings.logs': 'Log',

  /**
   * Screens reached from somewhere other than the sidebar.
   *
   * Registered because the header title comes from here. Without them the header falls back
   * to "Dashboard", so somebody on their own profile page is told they are looking at the
   * dashboard.
   */
  'nav.profile': 'Profil Saya',
  'nav.staff.detail': 'Butiran Staf',
  'nav.settings.roles.new': 'Peranan Baharu',
  'nav.settings.roles.edit': 'Sunting Peranan',
  'nav.settings.devices.edit': 'Tetapan Terminal',

  // -------------------------------------------------------------------------
  // Rangka aplikasi — sidebar, header, loceng amaran, sepanduk
  // -------------------------------------------------------------------------
  'shell.nav.aria': 'Navigasi utama',
  'shell.mode': 'Mod {mode}',
  'shell.sidebar.open': 'Buka sidebar',
  'shell.sidebar.close': 'Tutup sidebar',
  'shell.sidebar.attention': 'Ada perkara perlu perhatian di dalam',
  'shell.sync.never': 'Belum sync',
  'shell.sync.at': 'Sync {time}',
  'shell.serial': 'serial #{serial}',

  'shell.skipLink': 'Terus ke kandungan',
  'shell.error.load': 'Gagal memuatkan data',

  'shell.drift.one': 'Jam terminal "{name}" tersasar {drift}',
  'shell.drift.many': '{count} terminal mempunyai jam tersasar',
  'shell.drift.consequence': 'Rekod yang direkod sekarang mewarisi kesilapan ini.',
  'shell.drift.forward': 'ke hadapan',
  'shell.drift.backward': 'ke belakang',
  'shell.offline':
    '{count} terminal offline: {names}. Scan semasa ini tidak akan diterima sehingga sambungan kembali.',

  'shell.alerts.none': 'Tiada amaran',
  'shell.alerts.aria': '{count} perkara perlu perhatian',
  'shell.alerts.title': 'Perlu perhatian',
  'shell.alerts.empty': 'Tiada apa yang perlu perhatian.',
  'shell.alerts.unreadable': 'Tidak dapat dibaca.',
  'shell.alerts.note':
    'Ini keadaan semasa, bukan mesej. Tiada apa untuk ditanda sudah dibaca — satu item hilang bila keadaannya sudah tidak benar.',

  'shell.user.profile': 'Profil',
  'shell.user.signOut': 'Log Keluar',

  'shell.placeholder.body':
    'Skrin ini belum dibina. Struktur navigasi sudah disediakan supaya susunan boleh disemak dahulu.',

  /*
   * No `shell.planned.*` keys any more: every nav entry has a real screen, so
   * `PLACEHOLDER_ROUTES` is empty and nothing renders one.
   *
   * `PlaceholderPage` and `shell.placeholder.body` above stay. They are the mechanism for the
   * next agreed-but-unbuilt screen, and the reason it exists is worth keeping: twenty identical
   * placeholders make the rail unreviewable, so a placeholder states what the screen will hold
   * and which existing data it reads. Add a `plannedNoteKey` beside the nav entry to use it.
   */

  // -------------------------------------------------------------------------
  // Panel rekod — kongsi oleh setiap skrin senarai
  //
  // The widest coverage per label in the application: `RecordPanel` is the shell every
  // list screen is built from, so one entry here is one entry on twenty screens.
  // -------------------------------------------------------------------------
  'panel.search': 'Cari',
  'panel.reset': 'Reset',
  'panel.export': 'Export',

  /**
   * Date-range bounds.
   *
   * Their own labels rather than a copy per screen: every list with a date range uses these
   * two words, and they mean the same thing on all of them.
   */
  'filter.from': 'Dari',
  'filter.to': 'Hingga',
  /**
   * Column headers that every list screen has.
   *
   * Ten screens carry an actions column, a status column and a created column, and the
   * words mean the same thing on all of them. Registered per screen, a translator would be
   * asked for "Actions" ten times and could answer differently each time.
   */
  'panel.column.status': 'Status',
  'panel.column.created': 'Dicipta',
  'panel.column.actions': 'Tindakan',

  'panel.expand.open': 'Buka {label}',
  'panel.expand.close': 'Tutup {label}',
  'panel.footer.showing': 'Memaparkan {shown} daripada {total}',
  'panel.footer.readAt': 'dibaca',
  'panel.footer.perPage': 'Per halaman',
  'panel.footer.pages': 'Halaman',
  'panel.footer.previous': 'Sebelum',
  'panel.footer.next': 'Seterusnya',

  // -------------------------------------------------------------------------
  // Dialog
  // -------------------------------------------------------------------------
  'dialog.close': 'Tutup',
  'dialog.cancel': 'Batal',
  'dialog.save': 'Simpan',

  // -------------------------------------------------------------------------
  // Perbendaharaan kata domain
  //
  // The stored enum values, in words. These are not screen chrome — they are the vocabulary
  // the records are written in, and the same value is rendered on the dashboard, in the
  // exception queue, in the monthly report and in the payroll preview.
  //
  // The maps in `lib/operations-api.ts` now hold these keys instead of the words. Before
  // that, the dashboard carried its own copy of the exception wording, which is exactly the
  // divergence a registry exists to stop.
  // -------------------------------------------------------------------------
  'exception.missing_check_out': 'Tiada scan keluar',
  'exception.missing_check_in': 'Tiada scan masuk',
  'exception.duplicate_scan': 'Scan berulang',
  'exception.unrecognised_face': 'Muka tidak dikenali',
  'exception.unknown_employee': 'ID terminal belum dipetakan',
  'exception.outside_roster': 'Scan di luar jadual',
  'exception.clock_drift': 'Jam terminal tersasar',
  'exception.outside_geofence': 'Di luar kawasan dibenarkan',

  'status.on_time': 'Tepat masa',
  'status.late': 'Lewat',
  'status.early_leave': 'Keluar awal',
  'status.absent': 'Tidak hadir',
  'status.incomplete': 'Tidak lengkap',
  'status.on_leave': 'Bercuti',
  'status.rest_day': 'Hari rehat',
  'status.holiday': 'Cuti umum',

  'leaveStatus.pending': 'Menunggu',
  'leaveStatus.approved': 'Diluluskan',
  'leaveStatus.rejected': 'Ditolak',
  'leaveStatus.cancelled': 'Dibatalkan',

  /**
   * Event codes this hardware emits.
   *
   * Major 5 carries both person authentications and door events, so the minor code is what
   * separates a punch from a door opening.
   */
  'event.5:38': 'Kad sah',
  'event.5:75': 'Muka dikenali',
  'event.5:76': 'Muka gagal dikenali',
  'event.5:113': 'Cap jari sah',
  'event.5:27': 'Butang keluar',
  'event.5:22': 'Pintu dibuka',
  'event.major.1': 'Penggera',
  'event.major.2': 'Pengecualian',
  'event.major.3': 'Operasi',
  'event.major.5': 'Event',

  /**
   * What an event means, decided by the driver that decoded it.
   *
   * Separate from the `event.5:NN` codes above, which are Hikvision's own numbering. A
   * terminal whose protocol has no two-level code renders these instead, so the log
   * describes what happened rather than leaving a blank where an ISAPI row shows a label.
   */
  'event.kind.identified': 'Dikenali',
  'event.kind.unrecognised': 'Gagal dikenali',
  'event.kind.other': 'Peristiwa lain',

  /**
   * Domain headings, one layer above the nav groups.
   *
   * Rendered by both the sidebar and the permission matrix, from one shared mapping, so the
   * role editor's sections cannot disagree with the rail the role grants access to.
   *
   * Uppercase is applied in `className`, not here — `.toUpperCase()` is not safe in every
   * language, and these are the headings a translator reads while working.
   */
  'nav.domain.operations': 'Operasi',
  'nav.domain.humanResources': 'Sumber Manusia',
  'nav.domain.system': 'Sistem',

  /** Scan direction and the dedup marker, shown as badges on three screens. */
  'scan.in': 'MASUK',
  'scan.out': 'KELUAR',
  'scan.undecided': 'BELUM DITENTUKAN',
  'scan.suppressed': 'PENDUA DITAPIS',

  /** Terminal reachability, shown as badges on the dashboard and the device list. */
  'device.status.online': 'ONLINE',
  'device.status.degraded': 'BERMASALAH',
  'device.status.offline': 'OFFLINE',
  'device.status.unknown': 'BELUM DIPERIKSA',

  /**
   * Manufacturer and transport, shown wherever a terminal is listed or configured.
   *
   * Proper nouns, so they are not translated — but they are registered rather than written as
   * literals, because the screens that show them would otherwise each hold their own copy and
   * the casing would drift between them.
   */
  'device.vendor.hikvision': 'Hikvision',
  'device.vendor.zkteco': 'ZKTeco',
  'device.vendor.dahua': 'Dahua',
  'device.protocol.isapi': 'ISAPI',
  'device.protocol.ta-push': 'TA Push (ADMS)',
  'device.protocol.dahua-cgi': 'CGI',

  /** Which side opens the connection. Decides whether a remote site needs a VPN. */
  'device.reach.inbound': 'PELAYAN MENGHUBUNGI',
  'device.reach.outbound': 'TERMINAL MENGHUBUNGI',

  // -------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------
  'dashboard.empty': 'Tiada data untuk dipaparkan.',
  'dashboard.stat.present': 'Hadir',
  'dashboard.stat.present.hint': 'daripada {total} staf aktif',
  'dashboard.stat.late': 'Lewat',
  'dashboard.stat.absent': 'Tidak Hadir',
  'dashboard.stat.onLeave': 'Bercuti',
  'dashboard.stat.noBiometrics': 'Tiada Biometrik',
  'dashboard.stat.noBiometrics.hint': 'tidak boleh scan sama sekali',

  'dashboard.scans.title': 'Scan Hari Ini',
  'dashboard.scans.none': 'Belum ada scan hari ini',
  'dashboard.scans.count': '{count} scan terkini',
  'dashboard.scans.subtitle':
    'Pendua yang ditapis turut dipaparkan supaya paparan ini tidak bercanggah dengan log terminal.',
  'dashboard.scans.monitor': 'Monitor langsung',
  'dashboard.scans.empty': 'Belum ada scan direkodkan hari ini.',
  'dashboard.scans.column.time': 'Masa',
  'dashboard.scans.column.staff': 'Staf',
  'dashboard.scans.column.terminal': 'Terminal',
  'dashboard.scans.column.status': 'Status',

  'dashboard.exceptions.title': 'Pengecualian',
  'dashboard.exceptions.none': 'Tiada pengecualian',
  'dashboard.exceptions.count': '{count} perlu semakan',
  'dashboard.exceptions.open': 'Buka barisan',
  'dashboard.exceptions.clear': 'Tiada pengecualian menunggu semakan.',

  'dashboard.devices.title': 'Terminal',
  'dashboard.devices.count': '{count} terminal',
  'dashboard.devices.subtitle':
    'Kapasiti muka dan sasaran jam. Terminal penuh hanya disedari apabila pendaftaran gagal, jadi ia dilukis di sini.',
  'dashboard.devices.manage': 'Urus terminal',
  'dashboard.devices.empty': 'Belum ada terminal berdaftar.',
  'dashboard.devices.column.name': 'Nama',
  'dashboard.devices.column.host': 'Alamat',
  'dashboard.devices.column.status': 'Status',
  'dashboard.devices.column.capacity': 'Kapasiti',
  'dashboard.devices.column.clock': 'Jam',
  'dashboard.devices.column.serial': 'Serial',
  'dashboard.devices.clock.exact': 'Tepat',
  'dashboard.devices.clock.exactManual': 'Tepat (manual)',
  'dashboard.devices.capacity.aria': '{percent}% penuh',

  // -------------------------------------------------------------------------
  // Kehadiran › Pengecualian
  // -------------------------------------------------------------------------
  'exceptions.title': 'Pengecualian',
  'exceptions.subtitle':
    'Perkara yang enjin tidak dapat selesaikan sendiri dan memerlukan semakan manusia.',
  'exceptions.none': 'Tiada pengecualian terbuka',
  'exceptions.outstanding': '{count} pengecualian belum diselesaikan',
  'exceptions.section.subtitle':
    'Setiap satu ditutup dengan sebab bertulis, kerana itulah yang menjawab pertikaian gaji kemudian.',
  'exceptions.error.load': 'Gagal memuatkan pengecualian',
  'exceptions.empty': 'Tiada pengecualian dalam julat ini.',

  'exceptions.filter.allStatuses': 'Semua status',
  'exceptions.filter.open': 'Belum diselesaikan',
  'exceptions.filter.resolved': 'Sudah diselesaikan',

  'exceptions.column.kind': 'Jenis',
  'exceptions.column.staff': 'Staf',
  'exceptions.column.terminal': 'Terminal',
  'exceptions.column.occurred': 'Berlaku',
  'exceptions.column.detail': 'Butiran',

  'exceptions.row.unmapped': 'tiada staf dipetakan',
  'exceptions.row.resolve': 'Selesaikan dengan sebab',
  'exceptions.row.done': 'SELESAI',
  'exceptions.row.expand': 'butiran pengecualian',

  'exceptions.detail.kind': 'Jenis',
  'exceptions.detail.internalCode': 'Kod dalaman',
  'exceptions.detail.workDate': 'Tarikh kerja',
  'exceptions.detail.occurred': 'Berlaku',
  'exceptions.detail.terminal': 'Terminal',
  'exceptions.detail.rawEvent': 'Log scan mentah',
  'exceptions.detail.rawEvent.none': 'Tiada',
  'exceptions.detail.heading': 'Butiran',
  'exceptions.detail.resolvedAt': 'Diselesaikan {when} — {note}',
  'exceptions.detail.noReason': 'tiada sebab direkodkan',
  'exceptions.detail.unmappedWarning':
    'ID terminal ini belum dipetakan kepada sesiapa, jadi kehadiran orang itu tidak direkodkan. Selesaikan di Staf › Pemetaan ID Terminal — menutupnya di sini hanya menyembunyikan amaran, bukan membetulkan puncanya.',

  'exceptions.resolve.note': 'Sebab penyelesaian',
  'exceptions.resolve.placeholder':
    'Wajib. Rekod ini akan menjadi bukti jika kehadiran dipertikaikan.',
  'exceptions.resolve.submit': 'Selesaikan',
  'exceptions.resolve.done': 'Pengecualian {kind} diselesaikan.',
  'exceptions.resolve.error': 'Gagal menyimpan',
  'exceptions.resolve.preset.forgotOut': 'Staf lupa scan keluar, dikonfirmasi oleh penyelia',
  'exceptions.resolve.preset.fieldWork': 'Staf keluar tugas luar, tiada scan',
  'exceptions.resolve.preset.notStaff': 'Bukan staf, tiada tindakan diperlukan',
  'exceptions.resolve.preset.fixedManually': 'Sudah diperbetulkan secara manual',

  // -------------------------------------------------------------------------
  // Kehadiran › Rekod Kehadiran
  // -------------------------------------------------------------------------
  'records.title': 'Rekod Kehadiran',
  'records.subtitle':
    'Kehadiran seperti yang dikira oleh enjin. Setiap baris boleh dibina semula daripada log scan mentah.',
  'records.count': '{count} rekod',
  'records.range': '{from} hingga {to}',
  'records.recompute': 'Kira semula julat ini',
  'records.error.load': 'Gagal memuatkan rekod',
  'records.error.recompute': 'Kira semula gagal',
  'records.recompute.done':
    '{records} rekod dibina semula untuk {staff} staf, {exceptions} pengecualian dikemukakan.',
  'records.empty': 'Tiada rekod dalam julat ini. Jalankan kira semula jika scan sudah masuk.',
  'records.search': 'Cari nama atau no. staf…',

  'records.column.date': 'Tarikh',
  'records.column.staff': 'Staf',
  'records.column.shift': 'Shift',
  'records.column.scheduled': 'Jadual',
  'records.column.in': 'Masuk',
  'records.column.out': 'Keluar',
  'records.column.late': 'Lewat',
  'records.column.worked': 'Bekerja',
  'records.column.status': 'Status',

  'records.row.defaultShift': 'lalai',
  'records.row.blocks': '{count} blok',
  'records.row.expand': 'butiran rekod',

  'records.detail.shift': 'Shift',
  'records.detail.defaultPattern': 'Pola lalai',
  'records.detail.earlyLeave': 'Keluar awal',
  'records.detail.overtime': 'Kerja lebih masa',
  'records.detail.origin': 'Sumber',
  'records.detail.calculatedAt': 'Dikira pada',
  'records.detail.recordId': 'ID rekod',

  'records.block.column.block': 'Blok',
  'records.block.column.scheduled': 'Dijadualkan',
  'records.block.column.in': 'Masuk',
  'records.block.column.out': 'Keluar',
  'records.block.column.late': 'Lewat',
  'records.block.column.worked': 'Bekerja',

  'records.incomplete.note':
    'Hari ini tidak lengkap — biasanya scan keluar yang tiada. Semak Log Scan Mentah sebelum membetulkan: rekod ini dijana, jadi membetulkan puncanya dan mengira semula lebih tepat daripada menyunting hasilnya.',

  // -------------------------------------------------------------------------
  // Kehadiran › Monitor Hari Ini
  // -------------------------------------------------------------------------
  'monitor.title': 'Monitor Hari Ini',
  'monitor.subtitle':
    'Scan seperti ia berlaku. Suapan ini best-effort — rekod kekal disimpan dalam Log Scan Mentah walaupun sambungan terputus.',
  'monitor.connected': 'Bersambung',
  'monitor.disconnected': 'Sambungan terputus',
  'monitor.connected.hint': 'Scan akan muncul di bawah sebaik terminal melaporkannya.',
  'monitor.disconnected.hint': 'Pelayar akan mencuba semula sendiri. Tiada rekod hilang.',
  'monitor.waiting': 'menunggu scan',
  'monitor.lastAt': 'terakhir {time}',

  'monitor.stat.accepted': 'Diterima sesi ini',
  'monitor.stat.accepted.hint': 'punch direkod',
  'monitor.stat.suppressed': 'Pendua ditapis',
  'monitor.stat.suppressed.hint': 'scan berulang dalam tetingkap dedup',
  'monitor.stat.problems': 'Perlu perhatian',
  'monitor.stat.problems.hint': 'muka tak dikenali atau ID belum dipetakan',

  'monitor.offline.note':
    'Suapan langsung ini bukan sumber kebenaran. Setiap scan sudah ditulis ke Log Scan Mentah sebelum ia dihantar ke skrin ini, jadi jurang di sini tidak bermakna kehadiran hilang.',

  'monitor.chip.accepted': 'Diterima',
  'monitor.chip.suppressed': 'Pendua',
  'monitor.chip.problem': 'Perlu perhatian',

  'monitor.idle': 'Menunggu scan. Berdiri depan terminal untuk menguji.',
  'monitor.empty': 'Tiada scan sepadan dengan penapis ini.',

  'monitor.column.time': 'Masa',
  'monitor.column.staff': 'Staf',
  'monitor.column.terminal': 'Terminal',
  'monitor.column.method': 'Cara',
  'monitor.column.outcome': 'Keputusan',

  'monitor.row.unknown': 'Tidak dikenali',
  'monitor.row.unmapped': 'ID terminal {employeeNo}, belum dipetakan',
  'monitor.row.recorded': 'DIREKOD',
  'monitor.row.expand': 'butiran scan',

  'monitor.detail.fullTime': 'Masa penuh',
  'monitor.detail.serial': 'Serial terminal',
  'monitor.detail.eventKey': 'Kunci event',
  'monitor.detail.rawEventId': 'ID event mentah',
  'monitor.detail.terminalId': 'ID di terminal',
  'monitor.detail.punch': 'Punch',
  'monitor.detail.punch.none': 'Tiada punch dijana',
  'monitor.detail.direction': 'Arah',
  'monitor.detail.unmappedWarning':
    'ID {employeeNo} pada {device} belum dipetakan kepada sesiapa, jadi kehadiran orang ini tidak direkodkan. Selesaikan di Staf › Pemetaan ID Terminal.',
  'monitor.detail.noPunchWarning':
    'Scan ini tidak menjadi punch. Semak Pengecualian untuk butirannya.',

  'monitor.footer.showing': 'Memaparkan {shown} daripada {total} scan sesi ini',
  'monitor.footer.capped': ' · dihadkan kepada {max} baris terkini',
  'monitor.footer.note':
    'Sejarah penuh ada di Log Scan Mentah — skrin ini hanya untuk melihat waktu pertukaran shift.',

  /** Verification method, shared with the raw scan log. */
  'method.face': 'Muka',
  'method.fingerprint': 'Cap jari',
  'method.card': 'Kad',
  'method.password': 'PIN',
  'method.unknown': 'Tidak diketahui',

  /**
   * Where a punch came from.
   *
   * Recorded rather than inferred: a terminal scan proves physical presence at a door, an
   * app check-in proves only that a token was held. Naming them differently on screen is
   * what keeps somebody from reading the two as the same evidence.
   */
  'punchSource.terminal': 'Terminal',
  'punchSource.app': 'App',
  'punchSource.manual': 'Manual',

  // -------------------------------------------------------------------------
  // Kehadiran › Log Scan Mentah
  // -------------------------------------------------------------------------
  'rawlog.title': 'Log Scan Mentah',
  'rawlog.subtitle':
    'Log terminal seperti yang dilaporkan. Tidak pernah disunting — inilah yang menjadi bukti apabila rekod kehadiran dipertikaikan.',
  'rawlog.count': '{count} event',
  'rawlog.section.subtitle':
    'Push adalah penghantaran realtime dari terminal; pull adalah pas penyelarasan yang menangkap apa yang push terlepas.',
  'rawlog.error.load': 'Gagal memuatkan log',
  'rawlog.empty': 'Tiada event dalam julat ini.',
  'rawlog.search': 'Cari ID di terminal, cth. 1001…',

  'rawlog.chip.push': 'Push',
  'rawlog.chip.pull': 'Pull',
  'rawlog.filter.allDevices': 'Semua terminal',
  'rawlog.filter.allCategories': 'Semua kategori',

  'rawlog.immutable': 'tidak boleh diubah atau dibuang',
  'rawlog.immutable.note':
    'Log ini {emphasis} oleh sesiapa, termasuk Super Admin. Untuk membetulkan rekod kehadiran, betulkan puncanya dan jalankan kira semula — jangan sunting hasilnya.',

  'rawlog.column.serial': 'Serial',
  'rawlog.column.deviceTime': 'Masa terminal',
  'rawlog.column.event': 'Event',
  'rawlog.column.terminalId': 'ID terminal',
  'rawlog.column.terminalName': 'Nama di terminal',
  'rawlog.column.terminal': 'Terminal',
  'rawlog.column.punch': 'Punch',

  'rawlog.row.drift': 'jam {drift}s',
  'rawlog.row.noPunch': 'tiada',
  'rawlog.row.recorded': 'DIREKOD',
  'rawlog.row.picture': 'Lihat gambar yang dirakam',
  'rawlog.row.expand': 'butiran event',

  'rawlog.detail.serial': 'Serial terminal',
  'rawlog.detail.eventKey': 'Kunci event',
  'rawlog.detail.eventCode': 'Kod event',
  'rawlog.detail.verifyMode': 'Cara pengesahan',
  'rawlog.detail.cardNo': 'No. kad',
  'rawlog.detail.door': 'Pintu',
  'rawlog.detail.mask': 'Pelitup muka',
  'rawlog.detail.arrivedVia': 'Sampai melalui',
  'rawlog.detail.receivedAt': 'Diterima pelayan',
  'rawlog.detail.drift': 'Sasaran jam terminal',
  'rawlog.detail.drift.unmeasured': 'Tidak diukur',
  'rawlog.detail.eventId': 'ID event',
  'rawlog.detail.suppressed':
    'Punch #{punch} ditapis sebagai pendua — scan lain terlalu hampir dengan yang ini.',
  'rawlog.detail.recorded': 'Direkod sebagai punch #{punch}, arah "{direction}".',
  'rawlog.detail.noPunchWarning':
    'Event ini tidak menjadi punch. Punca biasa: ID terminal belum dipetakan kepada sesiapa, atau kod event ini bukan pengesahan orang (contohnya pintu dibuka).',

  'rawlog.picture.title': 'Gambar event #{serial}',
  'rawlog.picture.alt': 'Gambar yang dirakam terminal untuk event {serial}',
  'rawlog.picture.note':
    'Gambar disimpan pada terminal, bukan pada pelayan ini. Terminal menulis gantinya bila ruangnya penuh, jadi gambar lama akan hilang walaupun log eventnya kekal.',

  /**
   * Report builder status options.
   *
   * The rest of this screen is registered with the report screens; these two live here
   * because the option list is built from the same helper as the shared status vocabulary.
   */
  'builder.status.open': 'Belum selesai',
  'builder.status.resolved': 'Sudah selesai',

  // -------------------------------------------------------------------------
  // Staf › Direktori Staf
  // -------------------------------------------------------------------------
  'staff.title': 'Direktori Staf',
  'staff.subtitle':
    'Rekod staf dan keupayaan mereka untuk scan. Menyahaktifkan seseorang membuangnya dari terminal tetapi mengekalkan rekod kehadirannya.',
  'staff.count': '{count} staf',
  'staff.section.subtitle':
    'Staf boleh wujud pada terminal tanpa muka, cap jari atau kad — dalam keadaan itu mereka tidak boleh scan sama sekali dan tiada apa yang melaporkan ralat.',
  'staff.add': 'Tambah Staf',
  'staff.error.load': 'Gagal memuatkan senarai staf',
  'staff.empty': 'Tiada staf sepadan dengan penapis ini.',
  'staff.search': 'Cari nama atau no. staf…',

  'staff.chip.noBiometrics': 'Tiada biometrik',
  'staff.filter.allDepartments': 'Semua jabatan',
  'staff.filter.allLocations': 'Semua lokasi',

  'staff.column.employeeNo': 'No. Staf',
  'staff.column.name': 'Nama',
  'staff.column.department': 'Jabatan',
  'staff.column.location': 'Lokasi',
  'staff.column.biometrics': 'Biometrik',
  'staff.column.account': 'Akaun',

  /** Shown as a chip and as a row badge; one label because it is the same state. */
  'staff.status.cannotScan': 'Tidak boleh scan',

  'staff.biometric.face.present': 'Muka didaftar',
  'staff.biometric.face.absent': 'Muka tiada',
  'staff.biometric.fingerprint.present': 'Cap jari didaftar',
  'staff.biometric.fingerprint.absent': 'Cap jari tiada',
  'staff.biometric.card.present': 'Kad didaftar',
  'staff.biometric.card.absent': 'Kad tiada',
  /**
   * The fourth credential.
   *
   * Read from our own record rather than mirrored from the terminal, because the PIN is the
   * one credential this system writes rather than reads. The wording says "disimpan" instead
   * of "didaftar" for that reason.
   */
  'staff.biometric.pin.present': 'PIN pintu disimpan',
  'staff.biometric.pin.absent': 'PIN pintu tiada',

  'staff.row.noAccount': 'tiada',
  /**
   * Row actions.
   *
   * `staff.row.expand` is gone with the expanded row it opened. It could only render the
   * nine fields the list query already held, so the detail page replaced it rather than
   * growing it — and a key for a control that no longer exists is a string a translator is
   * asked to translate for nothing.
   */
  'staff.row.open': 'Buka butiran staf',
  'staff.row.edit': 'Kemas kini staf',
  'staff.row.deactivate': 'Nyahaktifkan dan buang dari terminal',
  'staff.row.reactivate': 'Aktifkan semula melalui borang kemas kini',

  'staff.detail.employeeNo': 'No. staf',
  'staff.detail.department': 'Jabatan',
  'staff.detail.location': 'Lokasi',
  'staff.detail.faces': 'Muka didaftar',
  'staff.detail.fingerprints': 'Cap jari didaftar',
  'staff.detail.cards': 'Kad didaftar',
  'staff.detail.doorPin': 'PIN pintu',
  'staff.detail.account': 'Akaun',
  'staff.detail.appCheckIn': 'Check-in app',
  'staff.detail.appCheckIn.allowed': 'Dibenarkan',
  'staff.detail.appCheckIn.denied': 'Tidak',
  'staff.detail.staffId': 'ID staf',
  'staff.detail.blockedWarning':
    'Orang ini tiada muka, cap jari mahupun kad pada terminal, jadi mereka tidak boleh scan sama sekali — dan tiada apa yang melaporkan ralat apabila mereka mencuba. Daftarkan di Staf › Pendaftaran Biometrik.',

  'staff.deactivate.title': 'Nyahaktifkan {name}?',
  'staff.deactivate.body':
    'Staf akan dibuang dari semua terminal supaya mereka tidak boleh scan lagi.',
  'staff.deactivate.kept': 'dikekalkan',
  'staff.deactivate.note':
    'Punch dan rekod kehadiran {emphasis}. Ia adalah bukti bagi gaji yang telah dibayar, jadi ia tidak dibuang bersama akses.',
  'staff.deactivate.submit': 'Nyahaktifkan',
  'staff.deactivate.error': 'Gagal menyahaktifkan',
  'staff.deactivate.done': '{name} dinyahaktifkan dan dibuang dari {count} terminal.',

  // -------------------------------------------------------------------------
  // Staf › Butiran Staf
  //
  // The per-person page at /staf/:id, replacing the expanded table row. Grouped under
  // `staff.view.*` rather than folded into `staff.*` because a translator opening this works
  // on one screen with six tabs, and mixing it with the directory list would put two screens'
  // worth of strings in one place.
  //
  // Five of the six tabs read filters the server already accepted and nothing had ever sent,
  // so most of the wording here is naming data that existed but was unreachable.
  // -------------------------------------------------------------------------
  'staff.view.back.aria': 'Kembali ke direktori staf',
  'staff.view.avatarAlt': 'Gambar {name}',
  'staff.view.edit': 'Kemas kini',
  'staff.view.deactivate': 'Nyahaktifkan',
  'staff.view.deactivated': '{name} dinyahaktifkan dan dibuang dari setiap terminal.',
  'staff.view.deactivated.partial':
    '{name} dinyahaktifkan, tetapi {count} terminal tidak dapat dihubungi. Pemetaan sudah dibuang, jadi scan dari ID itu akan masuk giliran semakan.',
  'staff.view.error.load': 'Gagal memuatkan butiran staf',

  'staff.view.tabs.aria': 'Bahagian butiran staf',
  'staff.view.tab.details': 'Butiran',
  'staff.view.tab.terminal': 'Terminal',
  'staff.view.tab.attendance': 'Kehadiran',
  'staff.view.tab.exceptions': 'Pengecualian',
  'staff.view.tab.roster': 'Jadual',
  'staff.view.tab.leave': 'Cuti',
  'staff.view.tab.scans': 'Log Scan',
  'staff.view.tab.audit': 'Audit',

  // Tab Butiran
  'staff.view.details.title': 'Butiran staf',
  'staff.view.details.subtitle':
    'Dipaparkan sahaja di sini. Suntingan melalui borang Kemas kini, di mana sempadan medan HR sudah dikuatkuasakan.',
  'staff.view.managedByHr': 'Diuruskan oleh HR',
  'staff.view.group.identity': 'Identiti',
  'staff.view.group.contact': 'Hubungan',
  'staff.view.group.access': 'Akses',
  'staff.view.group.notes': 'Nota',
  'staff.view.group.record': 'Rekod',
  'staff.view.employeeNo.hint':
    'Kunci antara sistem ini dengan setiap terminal dan setiap baris kehadiran. Tidak boleh ditukar selepas dicipta.',
  'staff.view.field.icNo': 'No. KP',
  'staff.view.field.position': 'Jawatan',
  'staff.view.field.posting': 'Penempatan',
  'staff.view.field.dates': 'Tarikh',
  'staff.view.field.dates.hint':
    'Tarikh mula ialah tarikh kalendar. Tempoh sah ialah cap masa yang ditulis ke terminal.',
  'staff.view.field.hireDate': 'Tarikh mula',
  'staff.view.field.basicSalary': 'Gaji bulanan',
  'staff.view.field.basicSalary.hint':
    'Kadar sejam lebih masa dikira daripadanya — gaji bulanan ÷ 26 ÷ 8, seperti s.60I Akta Kerja 1955. Kadar itu dibekukan pada permohonan semasa dihantar, jadi kenaikan gaji kemudian tidak mengubah tuntutan yang sudah diputuskan.',
  'staff.view.field.basicSalary.monthly': 'Sebulan',
  'staff.view.field.basicSalary.hourly': 'Sejam (dikira)',
  'staff.view.field.validFrom': 'Sah dari',
  'staff.view.field.validTo': 'Sah hingga',
  'staff.view.field.workPattern': 'Pola kerja',
  'staff.view.field.workPattern.hint':
    'Menentukan waktu jadual apabila tiada baris roster untuk hari itu.',
  'staff.view.field.contact': 'Hubungan',
  'staff.view.field.phone': 'Telefon',
  'staff.view.field.email': 'Emel',
  'staff.view.field.address': 'Alamat',
  'staff.view.field.address.hint': 'Teks bebas — tiada apa dalam sistem mengira atasnya.',
  'staff.view.field.loginEmail': 'Emel log masuk',
  'staff.view.field.account.hint':
    'Kebanyakan staf tiada akaun. Kehadiran direkod dari terminal, bukan dari log masuk.',
  'staff.view.field.appCheckIn.hint':
    'Check-in app hanya membuktikan token dipegang, bukan kehadiran fizikal di pintu. Diberi per orang.',
  'staff.view.field.recordDates': 'Rekod pangkalan data',
  'staff.view.field.updatedAt': 'Dikemas kini',
  'staff.view.pin.set': 'PIN tersimpan',
  'staff.view.pin.unset': 'Tiada PIN',

  // Tab Terminal & Biometrik
  'staff.view.terminal.title': 'Terminal dan biometrik',
  'staff.view.terminal.subtitle':
    'Kredensial yang orang ini scan dengannya, dan ID yang dia bawa pada setiap pintu.',
  'staff.view.terminal.refresh': 'Baca semula dari terminal',
  'staff.view.terminal.refreshed':
    'Dibaca semula dari terminal: muka {face}, cap jari {fingerprint}, kad {card}.',
  'staff.view.terminal.refresh.error': 'Gagal membaca semula kiraan kredensial',
  'staff.view.terminal.group.credentials': 'Kredensial',
  'staff.view.terminal.counts': 'MUKA {face} · CAP JARI {fingerprint} · KAD {card}',
  'staff.view.terminal.face': 'Muka didaftar',
  'staff.view.terminal.face.hint':
    'Gambar disimpan pada terminal, bukan pada pelayan ini. Memaparkannya di sini adalah satu perjalanan pergi-balik ke unit.',
  'staff.view.terminal.face.present':
    'Dibaca semula dari terminal. Ini bukan avatar — avatar ialah gambar di sebelah nama pada skrin, dan menukarnya tidak mendaftar semula muka.',
  'staff.view.terminal.face.absent':
    'Tiada muka didaftar. Daftarkan di Staf › Pendaftaran Biometrik — terminal mesti tahu orang ini dahulu.',
  'staff.view.terminal.credentialCounts': 'Kiraan kredensial',
  'staff.view.terminal.group.identities': 'Identiti per terminal',
  'staff.view.terminal.group.identities.subtitle':
    'ID berbeza pada setiap terminal adalah normal. Pemetaan inilah satu-satunya hubungan antara scan dan orang ini — baris yang salah mengkreditkan kehadiran seseorang kepada orang lain tanpa apa-apa ralat.',
  'staff.view.terminal.identity.detail': 'ID di terminal {employeeNo} · muka {face}',
  'staff.view.terminal.identity.noFace': 'belum didaftar',
  'staff.view.terminal.unconfirmed': 'Belum disahkan',
  'staff.view.terminal.noTerminals':
    'Staf ini belum diagihkan ke mana-mana terminal, jadi dia tidak boleh scan di mana-mana. Agihkan terminal melalui borang Kemas kini.',
  'staff.view.terminal.resync': 'Tolak semula ke terminal',
  'staff.view.terminal.resync.hint':
    'Menghantar semula nama, tempoh sah dan PIN pintu ke terminal yang sudah diagihkan. Ia tidak boleh menambah terminal baharu, dan ia tidak menghantar muka.',
  'staff.view.terminal.resynced': 'Ditolak semula ke {count} terminal.',
  'staff.view.terminal.resynced.partial': 'Ditolak ke {count} terminal, sebahagian gagal: {failed}',
  'staff.view.terminal.resync.error': 'Gagal menolak semula',

  // Tab Kehadiran
  'staff.view.attendance.title': 'Kehadiran',
  'staff.view.attendance.subtitle':
    'Hari kerja seperti yang dikira oleh enjin. Setiap baris boleh dibina semula daripada log scan mentah.',
  'staff.view.attendance.month': 'Bulan',
  'staff.view.attendance.allStatuses': 'Semua status',
  'staff.view.attendance.summary': 'Ringkasan bulan',
  'staff.view.attendance.none': 'Tiada rekod',
  'staff.view.attendance.empty':
    'Tiada rekod untuk bulan ini. Jalankan kira semula jika scan sudah masuk.',

  // Tab Pengecualian
  'staff.view.exceptions.title': 'Pengecualian',
  'staff.view.exceptions.subtitle':
    'Perkara yang enjin tidak dapat selesaikan sendiri untuk orang ini.',
  'staff.view.exceptions.empty': 'Tiada pengecualian untuk staf ini.',

  // Tab Jadual
  'staff.view.roster.title': 'Jadual kerja',
  'staff.view.roster.subtitle':
    'Apa yang dijadualkan, berbeza daripada apa yang berlaku. Hari yang dijadualkan tanpa scan menjadi ketidakhadiran; scan pada hari rehat menjadi pengecualian.',
  'staff.view.roster.error': 'Gagal memuatkan jadual',
  'staff.view.roster.pattern': 'Pola kerja',
  'staff.view.roster.summary': 'Ringkasan bulan',
  'staff.view.roster.none': 'Tiada baris',
  'staff.view.roster.note':
    'Hari tanpa baris di sini bukan hari rehat — ia tidak dijadualkan sama sekali, dan enjin jatuh balik kepada pola kerja untuk hari itu.',
  'staff.view.roster.column.type': 'Jenis',
  'staff.view.roster.column.notes': 'Nota',
  'staff.view.roster.empty': 'Tiada baris jadual untuk bulan ini.',

  // Tab Cuti
  'staff.view.leave.title': 'Cuti',
  'staff.view.leave.subtitle': 'Baki tahunan dan setiap permohonan yang difailkan.',
  'staff.view.leave.error': 'Gagal memuatkan data cuti',
  'staff.view.leave.year': 'Tahun',
  'staff.view.leave.group.balance': 'Baki {year}',
  'staff.view.leave.group.balance.subtitle':
    'Hari yang masih menunggu keputusan dikira terhadap baki — kalau tidak, beberapa permohonan berasingan boleh masing-masing lulus semakan dan bersama melebihi kelayakan.',
  'staff.view.leave.balanceLine': 'hak {entitlement} · diambil {taken} · menunggu {pending}',
  'staff.view.leave.unlimited': 'tiada had',
  'staff.view.leave.unpaid': 'Tanpa gaji — baki bukan kawalannya',
  'staff.view.leave.noTypes': 'Tiada jenis cuti aktif.',
  'staff.view.leave.group.requests': 'Permohonan',
  'staff.view.leave.group.requests.subtitle':
    'Hari yang dicaj sahaja ditulis ke roster. Hari rehat dan cuti umum dalam julat dilangkau, supaya baki dan laporan bulanan sepadan.',
  'staff.view.leave.column.days': 'Hari',
  'staff.view.leave.column.type': 'Jenis',
  'staff.view.leave.column.reason': 'Sebab',
  'staff.view.leave.empty': 'Tiada permohonan cuti untuk staf ini.',

  // Tab Log Scan
  //
  // The evidence tab. Guarded by the raw log permission, not the directory one, so the
  // wording assumes a reader who is allowed to see the untouched device log.
  'staff.view.scans.title': 'Log scan',
  'staff.view.scans.subtitle':
    'Apa yang terminal laporkan tentang orang ini, dan apa yang jadi kepadanya. Baris tanpa punch adalah yang dicari apabila sehari hilang.',
  'staff.view.scans.error': 'Gagal memuatkan log scan',
  'staff.view.scans.matchedOn': 'Dipadan pada ID',
  'staff.view.scans.matchedOn.hint':
    'ID tempatan terminal, bukan No. Staf. Menapis dengan No. Staf akan terlepas setiap scan dari terminal di mana orang ini membawa nombor berbeza.',
  'staff.view.scans.summary': 'Ringkasan',
  'staff.view.scans.counts': '{total} baris · {unresolved} tanpa punch',
  'staff.view.scans.truncated':
    'Dihadkan kepada {limit} baris terkini, jadi ini bukan keseluruhan bulan. Persempitkan julat untuk melihat yang lebih awal.',
  'staff.view.scans.column.at': 'Masa',
  'staff.view.scans.column.outcome': 'Keputusan',
  'staff.view.scans.noPunch': 'TIADA PUNCH',
  'staff.view.scans.empty': 'Tiada scan untuk bulan ini.',

  // Tab Audit
  'staff.view.audit.title': 'Jejak audit',
  'staff.view.audit.subtitle':
    'Siapa menukar apa tentang orang ini, dan bila. Hanya medan yang benar-benar berubah direkodkan.',
  'staff.view.audit.error': 'Gagal memuatkan jejak audit',
  'staff.view.audit.column.when': 'Bila',
  'staff.view.audit.column.actor': 'Oleh',
  'staff.view.audit.column.action': 'Tindakan',
  'staff.view.audit.column.changes': 'Perubahan',
  'staff.view.audit.empty': 'Tiada perubahan direkodkan untuk staf ini.',
  'staff.deactivate.partial':
    '{name} dinyahaktifkan, tetapi {count} terminal tidak dapat dihubungi: {devices}. Pemetaan sudah dibuang, jadi scan dari ID itu akan masuk ke barisan semakan.',

  // -------------------------------------------------------------------------
  // Borang staf (dialog)
  // -------------------------------------------------------------------------
  'staffForm.title.edit': 'Kemas kini staf',
  'staffForm.title.create': 'Tambah staf',
  'staffForm.description': 'Rekod staf dan terminal yang mereka boleh scan.',
  'staffForm.error.load': 'Gagal memuatkan',
  'staffForm.error.save': 'Gagal menyimpan',

  'staffForm.employeeNo': 'No. Staf',
  'staffForm.employeeNo.locked':
    'Tidak boleh ditukar — ia kunci ke terminal dan sejarah kehadiran',
  'staffForm.employeeNo.hint': 'Maksimum {max} aksara (had terminal)',
  'staffForm.fullName': 'Nama Penuh',
  'staffForm.icNo': 'No. KP',
  'staffForm.gender': 'Jantina',
  'staffForm.gender.unset': 'Tidak direkodkan',
  'staffForm.gender.male': 'Lelaki',
  'staffForm.gender.female': 'Wanita',
  'staffForm.gender.hint':
    'Diperlukan hanya untuk cuti yang dihadkan kepada satu jantina, seperti Cuti Bersalin dan Cuti Bapa. Permohonan jenis itu ditolak jika medan ini kosong.',
  'staffForm.phone': 'Telefon',
  'staffForm.email': 'Emel',
  'staffForm.doorPin': 'PIN Pintu',
  'staffForm.doorPin.hint':
    '{min}–{max} digit. Jangan guna kata laluan akaun — terminal simpan PIN dalam teks jelas.',
  'staffForm.basicSalary': 'Gaji Bulanan (RM)',
  'staffForm.basicSalary.hint':
    'Kadar sejam lebih masa dikira daripadanya. Biarkan kosong jika tiada gaji direkodkan — permohonan lebih masa akan ditolak sampai ia diisi.',
  'staffForm.department': 'Jabatan',
  'staffForm.location': 'Lokasi',
  'staffForm.none': 'Tiada',
  'staffForm.active': 'Aktif',

  'staffForm.devices': 'Terminal',
  'staffForm.devices.hint':
    'Staf hanya boleh scan pada terminal yang dipilih. Setiap unit menyimpan bilangan muka yang terhad, jadi agihkan merentas terminal.',
  'staffForm.devices.none': 'Tiada terminal berdaftar.',

  'staffForm.sync.heading': 'Keputusan pendaftaran',
  'staffForm.sync.ok': 'berjaya',
  'staffForm.saved': '{name} disimpan.',
  'staffForm.saved.enrolled': '{name} disimpan dan didaftar pada {count} terminal.',
  'staffForm.submit.create': 'Tambah',

  /**
   * Validation messages.
   *
   * The limits are the terminal's, so the numbers are substituted rather than written into
   * the sentence: accepting a longer `employeeNo` here would push the failure all the way to
   * enrolment, after the record already exists.
   */
  'staffForm.error.employeeNo.required': 'No. Staf diperlukan',
  'staffForm.error.maxChars': 'Maksimum {max} aksara',
  'staffForm.error.employeeNo.charset': 'Hanya huruf, nombor, titik, sengkang',
  'staffForm.error.fullName.required': 'Nama diperlukan',
  'staffForm.error.email': 'Emel tidak sah',
  'staffForm.error.basicSalary': 'Gaji mesti nombor positif, maksimum 1,000,000',
  'staffForm.error.pin.digits': 'PIN mesti nombor',
  'staffForm.error.pin.min': 'Minimum {min} digit',
  'staffForm.error.pin.max': 'Maksimum {max} digit',

  // -------------------------------------------------------------------------
  // Staf › Pendaftaran Biometrik
  // -------------------------------------------------------------------------
  'biometrics.title': 'Pendaftaran Biometrik',
  'biometrics.subtitle':
    'Gambar muka disimpan pada terminal, bukan dalam pangkalan data ini. Setiap terminal memadankan muka secara tempatan.',
  'biometrics.count.missing': '{count} staf belum boleh scan',
  /**
   * Three headings, not two.
   *
   * The enrolled chip used to fall through to the neutral "{count} staf", which named a
   * number without naming what it counted — and it did that while the chip beside it was
   * hardcoded to zero, so nothing on the screen said what was being looked at.
   */
  'biometrics.count.enrolled': '{count} staf sudah ada biometrik',
  'biometrics.count.all': '{count} staf',
  'biometrics.limits':
    'Had terminal: JPEG, maksimum {maxKb} KB, minimum {minPixels}×{minPixels} piksel. Gambar dipotong dan dimampatkan secara automatik.',
  'biometrics.error.load': 'Gagal memuatkan senarai',
  'biometrics.empty.missing': 'Semua staf sudah ada biometrik. Tiada apa yang perlu didaftarkan.',
  'biometrics.empty.all': 'Tiada staf sepadan.',

  'biometrics.chip.missing': 'Belum ada biometrik',
  'biometrics.chip.enrolled': 'Muka didaftar',

  'biometrics.column.face': 'Muka',
  'biometrics.column.canScan': 'Boleh scan',

  'biometrics.face.enrolled': 'Didaftar',
  'biometrics.face.none': 'Tiada',
  'biometrics.canScan.yes': 'ya',
  'biometrics.canScan.no': 'tidak',
  'biometrics.row.replace': 'Ganti muka',
  'biometrics.row.enrol': 'Daftar muka',
  'biometrics.row.expand': 'butiran biometrik',
  'biometrics.row.faceAlt': 'Muka yang didaftar untuk {name}',

  'biometrics.detail.active': 'Aktif',
  'biometrics.detail.active.yes': 'Ya',
  'biometrics.detail.active.no': 'Tidak',
  'biometrics.detail.blockedWarning':
    'Tiada muka, cap jari mahupun kad pada terminal. Orang ini tidak boleh scan sama sekali, dan terminal tidak melaporkan apa-apa ralat apabila mereka mencuba — scan mereka hanya tidak akan sampai.',

  'biometrics.dialog.description': '{name} · No. Staf {employeeNo}',
  'biometrics.dialog.current': 'Muka semasa, dibaca terus dari terminal.',
  'biometrics.dialog.remove': 'Buang',
  'biometrics.dialog.pick': 'Pilih gambar',
  'biometrics.dialog.pick.hint':
    'Muka depan, seorang sahaja. Gambar akan dipotong dan dimampatkan secara automatik untuk memenuhi had terminal.',
  'biometrics.dialog.previewAlt': 'Pratonton gambar yang akan dihantar ke terminal',
  'biometrics.dialog.size': 'Saiz',
  'biometrics.dialog.dimensions': 'Dimensi',
  'biometrics.dialog.quality': 'Kualiti',
  'biometrics.dialog.zoom': 'Rapatkan potongan',
  'biometrics.dialog.submit': 'Daftar ke terminal',
  'biometrics.dialog.submit.pending': 'Menghantar…',
  'biometrics.dialog.sending': 'Menghantar ke setiap terminal yang staf ini diagihkan.',

  'biometrics.error.image': 'Gambar tidak dapat diproses',
  'biometrics.error.compress': 'Gagal memampatkan',
  'biometrics.error.send': 'Gagal menghantar',
  'biometrics.error.remove': 'Gagal membuang',
  'biometrics.error.status': 'Gagal ({status})',
  'biometrics.done.enrolled': 'Muka {name} didaftar pada {count} terminal.',
  'biometrics.done.removed': 'Muka {name} dibuang dari {count} terminal.',

  // -------------------------------------------------------------------------
  // Staf › Import Pukal
  // -------------------------------------------------------------------------
  'import.title': 'Import Pukal',
  'import.subtitle':
    'Cipta rekod staf daripada fail CSV. Pratonton mengesahkan setiap baris sebelum apa-apa ditulis.',

  'import.step1': '1. Muat naik fail',
  'import.step1.subtitle':
    'Kolum dikenali: No. Staf, Nama, No. KP, Telefon, Emel, Jabatan, Lokasi, PIN. Hanya No. Staf dan Nama wajib.',
  'import.pick': 'Pilih fail CSV',
  'import.template': 'Muat turun template',
  'import.commas':
    'Nama yang mengandungi koma perlu dalam tanda petik. Parser ini menanganinya kerana nama di Malaysia kerap mengandungi koma — "Ali bin Abu, Dr" akan rosak dengan pemisah biasa.',
  'import.error.read': 'Gagal membaca fail',
  'import.error.status': 'Gagal ({status})',
  'import.error.start': 'Gagal memulakan import',

  'import.preview.title': 'Hasil pratonton',
  'import.preview.subtitle': 'Tiada apa ditulis pada peringkat ini.',
  'import.stat.linesRead': 'Baris dibaca',
  'import.stat.valid': 'Sah',
  'import.stat.errors': 'Ralat',
  'import.stat.existing': 'Sudah ada',
  'import.stat.existing.hint': 'akan dilangkau',

  'import.problems.title': '{count} ralat perlu dibetulkan',
  'import.problems.subtitle':
    'Tiada apa akan ditulis sehingga semua ralat dibetulkan. Nombor baris sepadan dengan yang dipaparkan dalam Excel.',
  'import.problems.caption': 'Senarai ralat dalam fail import',
  'import.problems.column.line': 'Baris',
  'import.problems.column.employeeNo': 'No. Staf',
  'import.problems.column.field': 'Medan',
  'import.problems.column.message': 'Masalah',
  'import.problems.capped': 'Menunjukkan 200 ralat pertama daripada {total}.',

  'import.newRefs': 'Jabatan dan lokasi berikut akan dicipta secara automatik:',
  'import.newRefs.departments': 'Jabatan: {names}',
  'import.newRefs.locations': 'Lokasi: {names}',

  'import.step2': '2. Pilih terminal dan mulakan',
  'import.step2.subtitle':
    'Boleh dilangkau. Staf akan dicipta dalam direktori tetapi belum boleh scan sehingga diagihkan ke terminal dan didaftarkan muka.',
  'import.devices': 'Daftar ke terminal',
  'import.commit': 'Import {count} staf',
  'import.allExisting': 'Semua baris dalam fail sudah ada dalam direktori.',

  'import.step3': '3. Kemajuan',
  'import.step3.subtitle':
    'Import berjalan di latar belakang dan selamat diulang — baris yang sudah ada dilangkau, bukan ditulis ganti.',
  'import.status.running': 'Berjalan',
  'import.status.done': 'Selesai',
  'import.status.failed': 'Gagal',
  'import.progress.aria': 'Kemajuan import',

  'import.stat.created': 'Dicipta',
  'import.stat.skipped': 'Dilangkau',
  'import.stat.pushed': 'Ke terminal',
  'import.stat.pushFailed': 'Gagal ke terminal',

  'import.failures.heading': 'Staf dicipta tetapi belum sampai ke terminal',
  'import.failures.hint':
    'Guna butang segerak semula pada rekod staf selepas terminal dapat dihubungi.',
  'import.done':
    'Import selesai. Langkah seterusnya: daftarkan muka di skrin Pendaftaran Biometrik — staf yang dicipta belum boleh scan sehingga itu.',

  // -------------------------------------------------------------------------
  // Staf › Pemetaan ID Terminal
  // -------------------------------------------------------------------------
  'mapping.title': 'Pemetaan ID Terminal',
  'mapping.subtitle':
    'Terminal hanya melaporkan nombornya sendiri, bukan muka. Pemetaan ini satu-satunya penghubung antara scan dan orang.',
  'mapping.tabs.aria': 'Barisan pemetaan',
  'mapping.tab.unmapped': 'Belum Dipetakan',
  'mapping.tab.unconfirmed': 'Belum Disahkan',
  'mapping.tab.import': 'Baca Dari Terminal',
  'mapping.error.load': 'Gagal memuatkan data',

  'mapping.import.title': 'Baca senarai pengguna dari terminal',
  'mapping.import.subtitle':
    'Untuk terminal yang sudah diisi oleh alat lain atau secara manual di keypad.',
  'mapping.import.unconfirmed': 'belum disahkan',
  'mapping.import.note':
    'ID yang sama tepat dengan No. Staf akan dipadan automatik tetapi kekal {emphasis} — padanan nombor yang tepat adalah bukti kuat, bukan bukti mutlak.',
  'mapping.import.noDevices': 'Tiada terminal berdaftar.',
  'mapping.import.error': 'Import gagal',
  'mapping.import.done':
    '{device}: {users} pengguna dibaca — {auto} dipadan automatik, {existing} sudah ada, {review} perlu semakan.',

  'mapping.unmapped.none': 'Semua ID terminal sudah dipetakan',
  'mapping.unmapped.count': '{count} ID belum dipetakan',
  'mapping.unmapped.subtitle':
    'Setiap ID di sini adalah orang yang scan tetapi kehadirannya tidak direkodkan ke mana-mana.',
  'mapping.unmapped.lostScans':
    '{scans} scan daripada {ids} ID sudah hilang. Kehadiran mereka tidak direkodkan — petakan ID itu dan sejarahnya akan dijana semula.',
  'mapping.unmapped.search': 'Cari ID atau nama di terminal…',
  'mapping.unmapped.empty': 'Semua ID terminal sudah dipetakan kepada seseorang.',

  'mapping.column.terminal': 'Terminal',
  'mapping.column.terminalId': 'ID di terminal',
  'mapping.column.terminalName': 'Nama di terminal',
  'mapping.column.biometrics': 'Biometrik',
  'mapping.column.lostScans': 'Scan hilang',
  'mapping.column.matchedTo': 'Dipadan kepada',

  'mapping.row.noName': 'tiada',
  'mapping.row.lost': '{count} hilang',
  'mapping.row.map': 'Petakan kepada staf',
  'mapping.row.expand': 'butiran ID',

  'mapping.detail.firstSeen': 'Kali pertama dilihat',
  'mapping.detail.lastSeen': 'Kali terakhir dilihat',
  'mapping.detail.heldScans': 'Scan tertahan',
  'mapping.detail.face': 'Muka',
  'mapping.detail.fingerprint': 'Cap jari',
  'mapping.detail.card': 'Kad',
  'mapping.detail.nameWarning':
    'Nama di terminal tidak digunakan untuk memadan. Ia boleh disunting di keypad, dan nama tidak unik pada 5000 orang — satu baris yang salah akan mengkreditkan kehadiran seorang kepada orang lain tanpa apa-apa ralat timbul.',

  'mapping.unconfirmed.none': 'Tiada pemetaan menunggu pengesahan',
  'mapping.unconfirmed.count': '{count} pemetaan menunggu pengesahan',
  'mapping.unconfirmed.subtitle':
    'Dipadan kerana ID terminal sama tepat dengan No. Staf. Itu bukti kuat, bukan bukti mutlak.',
  'mapping.unconfirmed.empty': 'Tiada pemetaan menunggu pengesahan.',
  'mapping.unconfirmed.confirm': 'Sahkan pemetaan ini',
  'mapping.unconfirmed.error': 'Pengesahan gagal',
  'mapping.unconfirmed.warning':
    'Sahkan hanya selepas memastikan orangnya betul. Selepas disahkan, scan lampau yang terlepas akan dijana semula menjadi punch — jadi pemetaan yang salah akan menulis sejarah kehadiran orang lain.',

  'mapping.dialog.title': 'Petakan ID terminal',
  'mapping.dialog.description': '{device} · ID {employeeNo}',
  'mapping.dialog.description.named': '{device} · ID {employeeNo} · nama di terminal "{name}"',
  'mapping.dialog.search': 'Cari staf',
  'mapping.dialog.search.placeholder': 'Nama, No. Staf atau No. KP',
  'mapping.dialog.searching': 'Mencari…',
  'mapping.dialog.noMatch': 'Tiada staf sepadan.',
  'mapping.dialog.clash': 'sudah ID {employeeNo}',
  'mapping.dialog.note':
    'Memetakan ID ini akan menjana semula punch untuk scan lampau yang terlepas, jadi sejarah kehadiran turut dipulihkan.',
  'mapping.dialog.searchError': 'Carian gagal',
  'mapping.dialog.error': 'Pemetaan gagal',
  'mapping.dialog.done': '{name} dipetakan ke ID {employeeNo}. {note}',

  /**
   * What `POST /api/identity/map` reports it did with the held scans.
   *
   * Returned as a key with the count alongside, not as a finished sentence: the route has
   * no reader whose language to consult, and the number sits in a different place in
   * different languages.
   */
  'mapping.confirmed.backfilled':
    '{count} scan lampau telah dijana semula. Jalankan kira semula kehadiran untuk julat tarikh berkenaan.',
  'mapping.confirmed.nothingToBackfill': 'Tiada scan lampau untuk dijana semula.',
  'mapping.unconfirmed.done': '{name}: {note}',

  // -------------------------------------------------------------------------
  // Staf › Jabatan & Lokasi
  // -------------------------------------------------------------------------
  'org.title': 'Jabatan & Lokasi',
  'org.subtitle':
    'Struktur organisasi dan tapak fizikal. Kedua-duanya dirujuk oleh rekod staf, jadi ia tidak boleh dibuang selagi masih digunakan.',
  'org.tabs.aria': 'Struktur organisasi',
  'org.tab.departments': 'Jabatan',
  'org.tab.locations': 'Lokasi',

  'org.dept.count': '{count} jabatan',
  'org.dept.subtitle':
    '{staff} staf diagihkan. Import pukal juga mencipta jabatan secara automatik.',
  'org.dept.add': 'Tambah Jabatan',
  'org.dept.search': 'Cari nama atau kod jabatan…',
  'org.dept.empty': 'Belum ada jabatan sepadan.',
  'org.dept.error.load': 'Gagal memuatkan jabatan',
  'org.dept.removed': 'Jabatan "{name}" dibuang.',
  'org.dept.saved': 'Jabatan "{name}" disimpan.',

  'org.dept.column.name': 'Nama',
  'org.dept.column.code': 'Kod',
  'org.dept.column.parent': 'Induk',
  'org.dept.column.children': 'Sub-jabatan',
  'org.dept.column.staff': 'Staf',

  'org.dept.row.edit': 'Kemas kini jabatan',
  'org.dept.row.remove': 'Buang jabatan',
  'org.dept.row.locked': '{staff} staf dan {children} sub-jabatan masih terikat',
  'org.dept.row.expand': 'butiran jabatan',

  'org.dept.detail.parent': 'Jabatan induk',
  'org.dept.detail.topLevel': 'Aras tertinggi',
  'org.dept.detail.staff': 'Staf diagihkan',
  'org.dept.detail.id': 'ID jabatan',
  'org.dept.detail.locked':
    'Tidak boleh dibuang selagi {staff} staf dan {children} sub-jabatan masih merujuknya. Pindahkan mereka dahulu — membuang jabatan ini tidak sepatutnya melepaskan ikatan staf sebagai efek sampingan.',

  'org.dept.remove.title': 'Buang jabatan "{name}"?',
  'org.dept.remove.body': 'Tiada staf atau sub-jabatan terikat padanya, jadi ia selamat dibuang.',

  'org.dept.dialog.edit': 'Kemas kini jabatan',
  'org.dept.dialog.create': 'Tambah jabatan',
  'org.dept.dialog.parent.none': 'Tiada — aras tertinggi',

  'org.loc.count': '{count} lokasi',
  'org.loc.subtitle':
    'Koordinat dan radius dikumpul sekarang walaupun check-in app belum dibina — nilai itu milik tapak, bukan milik app.',
  'org.loc.add': 'Tambah Lokasi',
  'org.loc.search': 'Cari nama atau alamat lokasi…',
  'org.loc.empty': 'Belum ada lokasi sepadan.',
  'org.loc.error.load': 'Gagal memuatkan lokasi',
  'org.loc.removed': 'Lokasi "{name}" dibuang.',
  'org.loc.saved': 'Lokasi "{name}" disimpan.',
  'org.loc.missingCoords':
    '{count} lokasi belum ada koordinat. Tanpanya, check-in melalui app tidak boleh dihadkan kepada kawasan itu — dan itu hanya akan disedari selepas app dibina.',

  'org.loc.column.coords': 'Koordinat',
  'org.loc.column.radius': 'Radius',
  'org.loc.column.devices': 'Terminal',
  'org.loc.coords.unset': 'belum ditetapkan',

  'org.loc.row.edit': 'Kemas kini lokasi',
  'org.loc.row.remove': 'Buang lokasi',
  'org.loc.row.locked': '{staff} staf dan {devices} terminal masih terikat',
  'org.loc.row.expand': 'butiran lokasi',

  'org.loc.detail.address': 'Alamat',
  'org.loc.detail.latitude': 'Latitud',
  'org.loc.detail.longitude': 'Longitud',
  'org.loc.detail.radius': 'Radius geofence',
  'org.loc.detail.devices': 'Terminal di sini',
  'org.loc.detail.id': 'ID lokasi',
  'org.loc.detail.noCoords':
    'Koordinat belum ditetapkan, jadi geofence tidak boleh dikuatkuasakan untuk tapak ini.',

  'org.loc.remove.title': 'Buang lokasi "{name}"?',
  'org.loc.remove.body': 'Tiada staf atau terminal terikat padanya, jadi ia selamat dibuang.',

  'org.loc.dialog.edit': 'Kemas kini lokasi',
  'org.loc.dialog.create': 'Tambah lokasi',
  'org.loc.dialog.radius': 'Radius geofence (meter)',
  'org.loc.dialog.radius.hint':
    'Digunakan nanti untuk check-in melalui aplikasi. Antara 20 dan 5000 meter.',
  'org.loc.dialog.note':
    'Tanpa koordinat, check-in melalui aplikasi tidak boleh dihadkan kepada kawasan ini.',

  // -------------------------------------------------------------------------
  // Hari dalam minggu
  //
  // Keyed by `getUTCDay()` so the index is the lookup. Shared because the holiday list
  // names the day and the general settings tab offers two of them as the week's first day.
  // -------------------------------------------------------------------------
  'weekday.0': 'Ahad',
  'weekday.1': 'Isnin',
  'weekday.2': 'Selasa',
  'weekday.3': 'Rabu',
  'weekday.4': 'Khamis',
  'weekday.5': 'Jumaat',
  'weekday.6': 'Sabtu',

  // -------------------------------------------------------------------------
  // Jadual › Cuti Umum
  // -------------------------------------------------------------------------
  'holidays.title': 'Cuti Umum',
  'holidays.subtitle':
    'Cuti mempengaruhi pengiraan gaji: hari cuti tanpa scan direkod sebagai bercuti, bukan tidak hadir.',
  'holidays.count': '{count} hari cuti dalam {year}',
  'holidays.section.subtitle':
    'Cuti Sarawak berbeza dari negeri lain, dan tarikh cuti Islam boleh berubah dengan pengumuman lewat.',
  'holidays.add': 'Tambah Cuti',
  'holidays.year.previous': 'Tahun sebelum',
  'holidays.year.next': 'Tahun seterusnya',
  'holidays.error.load': 'Gagal memuatkan cuti',
  'holidays.empty': 'Belum ada cuti direkod untuk {year}.',
  'holidays.search': 'Cari nama cuti…',

  'holidays.chip.public': 'Cuti umum',
  'holidays.chip.company': 'Cuti syarikat',
  'holidays.filter.allScopes': 'Semua liputan',
  'holidays.scope.nationwide': 'Seluruh negara',

  'holidays.recomputeNote':
    'Selepas menambah atau membuang cuti, jalankan kira semula kehadiran untuk julat tarikh berkenaan di Konfigurasi Umum › Maintenance. Rekod yang sudah dikira tidak berubah dengan sendirinya.',

  'holidays.column.date': 'Tarikh',
  'holidays.column.day': 'Hari',
  'holidays.column.name': 'Nama',
  'holidays.column.scope': 'Liputan',
  'holidays.column.kind': 'Jenis',
  'holidays.weekend': 'hujung minggu',
  'holidays.kind.company': 'Syarikat',
  'holidays.kind.public': 'Umum',
  'holidays.row.remove': 'Buang cuti',

  'holidays.remove.title': 'Buang "{name}"?',
  'holidays.remove.body': '{date} akan menjadi hari kerja biasa semula.',
  'holidays.remove.warning':
    'Rekod kehadiran yang sudah dikira untuk hari itu tidak berubah dengan sendirinya. Jalankan kira semula selepas ini, jika tidak sesiapa yang tidak hadir pada hari itu masih akan dilaporkan sebagai bercuti.',
  'holidays.removed':
    '"{name}" dibuang. Jalankan kira semula kehadiran untuk {date} — hari itu kini dikira sebagai hari kerja biasa.',
  'holidays.error.remove': 'Gagal membuang',

  'holidays.dialog.title': 'Tambah cuti',
  'holidays.dialog.description':
    'Cuti umum atau hari yang diisytiharkan oleh organisasi sendiri.',
  'holidays.dialog.name.placeholder': 'cth. Hari Gawai',
  'holidays.dialog.company': 'Cuti syarikat',
  'holidays.dialog.company.hint':
    'Hari yang diisytiharkan sendiri, bukan cuti umum. Ditanda berasingan supaya ia boleh dibezakan daripada kalendar rasmi kemudian.',
  'holidays.dialog.submit': 'Tambah',
  'holidays.error.add': 'Gagal menambah',
  'holidays.added': '"{name}" ditambah pada {date}. Jalankan kira semula untuk tarikh itu.',

  // -------------------------------------------------------------------------
  // Jadual › Kalendar Kerja
  // -------------------------------------------------------------------------
  'roster.title': 'Kalendar Kerja',
  'roster.subtitle':
    'Pilih sel kemudian pilih shift. Klik nama untuk memilih seluruh bulan bagi seorang staf.',
  'roster.count': '{count} staf dalam paparan ini',
  'roster.month.previous': 'Bulan sebelum',
  'roster.month.next': 'Bulan seterusnya',
  'roster.recompute': 'Kira semula bulan ini',
  'roster.error.load': 'Gagal memuatkan jadual',
  'roster.error.save': 'Gagal menyimpan jadual',
  'roster.error.clear': 'Gagal mengosongkan',
  'roster.error.recompute': 'Kira semula gagal',
  'roster.empty': 'Tiada staf untuk dipaparkan.',

  'roster.selected': '{count} hari dipilih',
  'roster.apply.rest': 'Rehat',
  'roster.apply.leave': 'Cuti',
  'roster.apply.clear': 'Kosongkan',
  'roster.selection.drop': 'Buang pilihan',
  'roster.saved':
    '{count} hari dikemas kini. Jalankan kira semula kehadiran untuk julat ini supaya rekod mencerminkan jadual baharu.',
  'roster.cleared': '{count} hari dikosongkan.',
  'roster.recomputed': '{count} rekod kehadiran dibina semula untuk bulan ini.',

  'roster.caption': 'Kalendar kerja bulanan. Klik sel untuk memilih, kemudian pilih shift.',
  'roster.column.staff': 'Staf',
  'roster.selectMonth': 'Pilih seluruh bulan untuk {name}',

  /**
   * The accessible name for one grid cell.
   *
   * Built from two labels because the state part varies: a scheduled cell names its shift,
   * an empty one says so. Both go in the same slot.
   */
  'roster.cell.aria': '{name}, {day} {month}, {state}',
  'roster.cell.unscheduled': 'belum dijadualkan',
  'roster.cell.work': 'kerja',

  'roster.note':
    'Hari kerja tanpa shift ditolak oleh pelayan — tiada apa yang boleh diukur kehadirannya terhadapnya. Menetapkan shift pada hari yang sama menulis ganti, bukan menambah baris kedua.',

  // -------------------------------------------------------------------------
  // Jadual › Shift & Waktu Kerja
  // -------------------------------------------------------------------------
  'shifts.title': 'Shift & Waktu Kerja',
  'shifts.subtitle':
    'Pola waktu kerja menentukan bila seseorang sepatutnya bekerja. Shift memberi pola itu satu kod untuk digunakan pada kalendar.',
  'shifts.tabs.aria': 'Definisi jadual',
  'shifts.tab.patterns': 'Pola Waktu Kerja',
  'shifts.tab.shifts': 'Shift',

  /** Work-pattern kind, stored as an enum. */
  'patternKind.regular': 'Biasa',
  'patternKind.shift': 'Shift',
  'patternKind.standby': 'Bersedia',

  'shifts.pattern.count': '{count} pola waktu kerja',
  'shifts.pattern.subtitle':
    '{overnight} melintasi tengah malam. Setiap pola boleh mempunyai beberapa blok masa — perlu untuk shift berpecah.',
  'shifts.pattern.add': 'Tambah Pola',
  'shifts.pattern.search': 'Cari nama pola…',
  'shifts.pattern.empty': 'Belum ada pola waktu kerja.',
  'shifts.pattern.error.load': 'Gagal memuatkan pola',
  'shifts.pattern.removed': 'Pola "{name}" dibuang.',
  'shifts.pattern.saved': 'Pola "{name}" disimpan.',
  /** Returned as a key by `routes/schedule.ts` when a pattern's time blocks were rewritten. */
  'shifts.pattern.blocksChanged':
    'Blok masa diubah. Jalankan kira semula kehadiran untuk tarikh terjejas supaya rekod lama mencerminkan peraturan baharu.',
  'shifts.pattern.graceNote':
    'Tetingkap toleransi menentukan berapa awal atau lewat satu scan masih dikira untuk blok itu. Ia tidak boleh bertindih antara blok — kalau bertindih, satu scan boleh memenuhi dua blok dan pilihannya bergantung pada susunan pemprosesan, bukan pada apa-apa yang operator boleh fikirkan.',

  'shifts.pattern.column.name': 'Nama',
  'shifts.pattern.column.kind': 'Jenis',
  'shifts.pattern.column.blocks': 'Blok masa',
  'shifts.pattern.column.dailyHours': 'Jam sehari',
  'shifts.pattern.column.staff': 'Staf',
  'shifts.pattern.column.shifts': 'Shift',

  'shifts.pattern.overnight': 'tengah malam',
  'shifts.pattern.inactive': 'tidak aktif',
  'shifts.pattern.row.edit': 'Kemas kini pola',
  'shifts.pattern.row.remove': 'Buang pola',
  'shifts.pattern.row.locked': '{staff} staf dan {shifts} shift masih merujuknya',
  'shifts.pattern.row.expand': 'butiran pola',

  'shifts.block.column.block': 'Blok',
  'shifts.block.column.start': 'Mula',
  'shifts.block.column.end': 'Tamat',
  'shifts.block.column.break': 'Rehat',
  'shifts.block.column.graceBefore': 'Toleransi sebelum',
  'shifts.block.column.graceAfter': 'Toleransi selepas',
  'shifts.block.nextDay': '+1 hari',

  'shifts.pattern.detail.dailyHours': 'Jam sehari',
  'shifts.pattern.detail.staffUsing': 'Staf menggunakannya',
  'shifts.pattern.detail.shiftsUsing': 'Shift merujuknya',
  'shifts.pattern.detail.overnight':
    'Pola ini melintasi tengah malam. Shift 22:00–07:00 difailkan pada tarikh kerja ia dimulakan, bukan tarikh ia berakhir — kalau tidak, satu malam kerja akan berpecah antara dua hari dalam laporan.',

  'shifts.pattern.remove.title': 'Buang pola "{name}"?',
  'shifts.pattern.remove.body': 'Tiada staf atau shift merujuknya, jadi ia selamat dibuang.',

  'shifts.pattern.dialog.edit': 'Kemas kini pola waktu kerja',
  'shifts.pattern.dialog.create': 'Tambah pola waktu kerja',
  'shifts.pattern.dialog.description': 'Blok masa menentukan bila kehadiran diukur terhadapnya.',
  'shifts.pattern.dialog.blocks': 'Blok masa',
  'shifts.pattern.dialog.blockLabel': 'Blok {order}',
  'shifts.pattern.dialog.removeBlock': 'Buang blok {order}',
  'shifts.pattern.dialog.break': 'Rehat (min)',
  'shifts.pattern.dialog.endsNextDay': 'Tamat hari esok',
  'shifts.pattern.dialog.graceBefore': 'Toleransi sebelum mula (min)',
  'shifts.pattern.dialog.graceAfter': 'Toleransi selepas tamat (min)',
  'shifts.pattern.dialog.addBlock': 'Tambah blok',
  'shifts.pattern.dialog.overlapWarning':
    'Tetingkap toleransi tidak boleh bertindih antara blok. Jika bertindih, satu scan boleh memenuhi dua blok dan pilihan menjadi bergantung pada susunan pemprosesan. Pelayan akan menolaknya.',

  'shifts.shift.count': '{count} shift',
  'shifts.shift.subtitle':
    'Kod pendek yang digunakan pada kalendar kerja. Setiap satu merujuk satu pola waktu kerja.',
  'shifts.shift.add': 'Tambah Shift',
  'shifts.shift.search': 'Cari kod atau nama shift…',
  'shifts.shift.empty': 'Belum ada shift.',
  'shifts.shift.error.load': 'Gagal memuatkan shift',
  'shifts.shift.removed': 'Shift "{code}" dibuang.',
  'shifts.shift.saved': 'Shift "{code}" disimpan.',
  'shifts.shift.needPattern':
    'Cipta pola waktu kerja dahulu — shift merujuk kepada pola untuk mengetahui waktunya, jadi ia tidak boleh wujud tanpa satu.',

  'shifts.shift.column.code': 'Kod',
  'shifts.shift.column.name': 'Nama',
  'shifts.shift.column.pattern': 'Pola waktu kerja',
  'shifts.shift.column.hours': 'Waktu',
  'shifts.shift.column.rosterDays': 'Hari dijadualkan',

  'shifts.shift.row.edit': 'Kemas kini shift',
  'shifts.shift.row.remove': 'Buang shift',
  'shifts.shift.row.locked': '{count} hari kalendar masih menggunakannya',
  'shifts.shift.row.expand': 'butiran shift',
  'shifts.shift.detail.active': 'Aktif',
  'shifts.shift.detail.active.yes': 'Ya',
  'shifts.shift.detail.active.no': 'Tidak',

  'shifts.shift.remove.title': 'Buang shift "{code}"?',
  'shifts.shift.remove.body': 'Tiada hari kalendar menggunakannya, jadi ia selamat dibuang.',

  'shifts.shift.dialog.edit': 'Kemas kini shift',
  'shifts.shift.dialog.create': 'Tambah shift',
  'shifts.shift.dialog.description': 'Kod pendek dan warna yang muncul pada kalendar kerja.',
  'shifts.shift.dialog.code.hint': 'cth. P, M, N',
  'shifts.shift.dialog.colour': 'Warna',

  // -------------------------------------------------------------------------
  // Jadual › Permohonan Cuti
  // -------------------------------------------------------------------------
  'leave.title': 'Permohonan Cuti',
  'leave.subtitle':
    'Kelulusan menulis hari cuti ke kalendar kerja dan mengira semula kehadiran — tanpa itu, orang yang diluluskan cutinya masih dilaporkan tidak hadir.',
  'leave.tab.types': 'Jenis Cuti',

  'leave.request.none': 'Tiada permohonan menunggu keputusan',
  'leave.request.pending': '{count} menunggu keputusan',
  'leave.request.subtitle':
    'Hari rehat dan cuti umum tidak dikira terhadap kelayakan — mengenakan cuti tahunan untuk hari Ahad adalah ralat yang muncul sebagai rungutan, bukan sebagai pepijat.',
  'leave.request.add': 'Permohonan Baharu',
  'leave.request.search': 'Cari nama, no. staf atau sebab…',
  'leave.request.empty': 'Tiada permohonan sepadan dengan penapis ini.',
  'leave.request.error.load': 'Gagal memuatkan permohonan',
  'leave.filter.allTypes': 'Semua jenis cuti',

  'leave.column.staff': 'Staf',
  'leave.column.type': 'Jenis cuti',
  'leave.column.period': 'Tempoh',
  'leave.column.days': 'Hari',
  'leave.column.status': 'Status',
  'leave.column.appliedAt': 'Dimohon',

  'leave.row.unpaid': 'tanpa gaji',
  'leave.row.approve': 'Luluskan — menulis hari cuti ke kalendar',
  'leave.row.reject': 'Tolak dengan sebab',
  'leave.row.cancelApproved': 'Batalkan — membuang hari cuti dari kalendar',
  'leave.row.cancelPending': 'Batalkan permohonan',
  'leave.row.expand': 'butiran permohonan',

  'leave.detail.paid': 'Dibayar',
  'leave.detail.paid.yes': 'Ya',
  'leave.detail.paid.no': 'Tidak',
  'leave.detail.period': '{from} hingga {to}',
  'leave.detail.workingDays': 'Hari bekerja dikira',
  'leave.detail.decidedAt': 'Diputuskan',
  'leave.detail.decidedAt.pending': 'Belum',
  'leave.detail.requestId': 'ID permohonan',
  'leave.detail.reasonHeading': 'Sebab permohonan',
  'leave.detail.decisionNote': 'Nota keputusan: {note}',
  'leave.detail.notRestored': 'tidak',
  'leave.detail.replacedRoster':
    'Kelulusan ini menggantikan shift yang sudah ada pada kalendar. Jika permohonan dibatalkan, shift asal {emphasis} dipulihkan — kalendar tidak menyimpan sejarah apa yang digantikan.',

  'leave.new.title': 'Permohonan cuti baharu',
  'leave.new.description':
    'Pilih staf, jenis cuti dan tempoh. Hari bekerja dikira secara automatik.',
  'leave.new.searchStaff': 'Cari staf',
  'leave.new.searchStaff.placeholder': 'Nama atau no. staf',
  'leave.new.searching': 'Mencari',
  'leave.new.noMatch': 'Tiada staf sepadan.',
  'leave.new.change': 'Tukar',
  'leave.new.type': 'Jenis cuti',
  'leave.new.type.annual': '{code} — {name} ({days} hari/tahun)',
  'leave.new.type.unlimited': '{code} — {name} (tiada had)',
  'leave.new.type.unpaidSuffix': ' · tanpa gaji',
  'leave.new.noBackdated': 'Jenis ini tidak boleh dimohon untuk tarikh yang sudah lepas.',
  /*
    Wajib pada borang, pilihan pada route.
    Klien mudah alih dan API awam menghantar ke endpoint yang sama, jadi mengetatkan medan di pelayan
    akan menolak setiap pemanggil yang sudah berfungsi. Label ini tidak lagi berkata '(pilihan)'.
  */
  'leave.new.reason': 'Sebab',
  'leave.new.reason.hint': 'Asas permohonan. Pihak yang meluluskan membaca ini dahulu.',
  'leave.new.reason.placeholder': 'Mengapa cuti ini diperlukan',
  'leave.new.remarks': 'Catatan',
  'leave.new.remarks.hint': 'Butiran praktikal — serah tugas, nombor untuk dihubungi. Pilihan.',
  'leave.new.remarks.placeholder': 'Catatan tambahan…',

  'leave.new.searchStaff.hint':
    'Memilih staf memuatkan baki mereka, dan kelayakan setiap jenis cuti bagi orang itu.',

  /*
    Baris Baki berdiri sendiri, tidak menunggu julat tarikh.
    Ia menjawab "bolehkah orang ini ambil cuti ini" dan soalan itu datang sebelum memilih tarikh.
  */
  'leave.new.balance': 'Baki',
  'leave.new.balance.waiting': 'Pilih staf dan jenis cuti.',
  'leave.new.balance.unlimited': 'Tiada had — baki bukan kawalan bagi kategori ini.',
  'leave.new.balance.remaining': '{days} hari lagi',
  'leave.new.balance.breakdown': 'daripada {entitled} · {taken} diambil · {pending} menunggu',
  'leave.new.balance.carried': '{days} dibawa dari tahun lepas',
  'leave.new.submit': 'Rekod permohonan',
  'leave.new.error': 'Gagal merekod permohonan',
  'leave.new.saved': 'Permohonan {days} hari untuk {name} direkodkan ({status}).',
  'leave.new.saved.applied':
    'Permohonan {days} hari untuk {name} direkodkan ({status}) — {roster} hari kalendar ditulis dan kehadiran dikira semula.',

  'leave.quote.workingDays': 'Hari bekerja',
  'leave.quote.restDays': 'Hari rehat dilangkau',
  'leave.quote.holidays': 'Cuti umum dilangkau',
  'leave.quote.entitlement': 'Kelayakan',
  'leave.quote.unlimited': 'Tiada had',
  'leave.quote.perYear': '{days} hari/tahun',
  'leave.quote.taken': 'Sudah diambil',
  'leave.quote.remaining': 'Baki selepas ini',
  'leave.quote.noWorkingDays':
    'Julat ini tiada hari bekerja — semuanya hari rehat atau cuti umum. Tiada apa yang perlu dimohon.',
  'leave.quote.overlap':
    'Sudah ada permohonan {status} yang bertindih dengan tempoh ini. Dua permohonan atas hari yang sama akan menulis baris kalendar yang sama, dan yang kedua akan menimpa yang pertama tanpa amaran.',
  'leave.quote.wouldExceed':
    'Ini melebihi kelayakan tahunan. Ia masih boleh direkodkan — sesetengah organisasi membenarkannya sebagai pendahuluan — tetapi bakinya akan menjadi negatif.',
  'leave.quote.backdated':
    'Tarikh mula sudah lepas dan jenis cuti ini tidak membenarkan permohonan ke belakang.',

  'leave.decision.approve.title': 'Luluskan permohonan cuti',
  'leave.decision.reject.title': 'Tolak permohonan cuti',
  'leave.decision.description': '{name} · {code} · {days} hari',
  'leave.decision.applicantReason': 'Sebab pemohon: {reason}',
  'leave.decision.approveWarning':
    'Meluluskan akan menulis {days} hari cuti ke kalendar kerja dan mengira semula kehadiran bagi tempoh itu. Shift yang sudah ditetapkan pada hari-hari tersebut akan digantikan.',
  'leave.decision.rejectWarning':
    'Penolakan memerlukan sebab bertulis. Tanpanya pemohon tiada apa yang boleh ditindaklanjuti, dan pertikaian kemudian tiada rujukan.',
  'leave.decision.note.approve': 'Nota (pilihan)',
  'leave.decision.note.reject': 'Sebab penolakan',
  'leave.decision.note.approve.placeholder': 'Konteks untuk rekod',
  'leave.decision.note.reject.placeholder': 'Wajib — apa yang perlu pemohon tahu',
  'leave.decision.submit.approve': 'Luluskan',
  'leave.decision.submit.reject': 'Tolak',
  'leave.decision.error': 'Gagal menyimpan keputusan',
  'leave.decision.rejected': 'Permohonan {name} ditolak.',
  /**
   * The approval outcome, assembled from optional clauses.
   *
   * Kept as separate labels rather than one sentence with empty slots: a clause that does not
   * apply is dropped entirely, and a slot substituted with an empty string would leave the
   * punctuation around it stranded.
   */
  'leave.decision.approved': 'Cuti {name} diluluskan — {roster} hari ditulis ke kalendar',
  'leave.decision.approved.replaced': ', {count} shift digantikan',
  'leave.decision.approved.skipped': ', {count} hari rehat/cuti umum dilangkau',
  'leave.decision.approved.recomputed': ', {count} rekod kehadiran dikira semula.',

  'leave.cancel.title': 'Batalkan permohonan cuti',
  'leave.cancel.notRestored': 'tidak dipulihkan',
  'leave.cancel.approvedWarning':
    'Hari cuti akan dibuang dari kalendar dan kehadiran dikira semula. Shift yang ada sebelum kelulusan {emphasis} — kalendar tidak menyimpan sejarah apa yang digantikan, jadi tetapkan semula shift secara manual jika perlu.',
  'leave.cancel.pendingNote':
    'Permohonan ini belum diluluskan, jadi tiada apa pada kalendar yang perlu dibuang.',
  'leave.cancel.note': 'Sebab (pilihan)',
  'leave.cancel.submit': 'Batalkan permohonan',
  'leave.cancel.error': 'Gagal membatalkan',
  'leave.cancel.done': 'Permohonan {name} dibatalkan.',
  'leave.cancel.done.removed':
    'Permohonan {name} dibatalkan — {count} hari cuti dibuang dari kalendar dan kehadiran dikira semula.',

  'leave.type.count': '{count} jenis cuti',
  'leave.type.subtitle':
    'Kelayakan yang diseed adalah minimum statutori sebagai titik permulaan, bukan polisi — setiap organisasi menyesuaikannya.',
  'leave.type.add': 'Tambah Jenis',
  'leave.type.search': 'Cari kod atau nama…',
  'leave.type.empty': 'Belum ada jenis cuti.',
  'leave.type.error.load': 'Gagal memuatkan jenis cuti',
  'leave.type.removed': 'Jenis cuti "{code}" dibuang.',
  'leave.type.saved': 'Jenis cuti "{code}" disimpan.',

  'leave.type.column.code': 'Kod',
  'leave.type.column.name': 'Nama',
  'leave.type.column.entitlement': 'Kelayakan',
  'leave.type.column.countedIn': 'Dikira dalam',
  'leave.type.column.eligibility': 'Kelayakan pemohon',
  'leave.type.column.paid': 'Dibayar',
  'leave.type.column.backdated': 'Ke belakang',
  'leave.type.column.approval': 'Perlu kelulusan',
  'leave.type.column.document': 'Dokumen',

  'leave.type.countedIn.working': 'Hari bekerja',
  'leave.type.countedIn.calendar': 'Hari kalendar',
  /*
    'Lelaki sahaja' — a restriction on a category.
    Deliberately not shared with `staffForm.gender.*`, which is 'Lelaki' — a fact about a person.
    Same word, different register: a staff member is male, a leave type is male-only. Merging them
    would put "Lelaki sahaja" in a dropdown that answers "what is this person".
  */
  'leave.type.eligibility.all': 'Semua pekerja',
  'leave.type.eligibility.male': 'Lelaki sahaja',
  'leave.type.eligibility.female': 'Wanita sahaja',

  'leave.type.unlimited': 'tiada had',
  'leave.type.days': '{days} hari',
  'leave.type.tiers.tooltip': 'Bawah 2 tahun / 2 hingga 5 tahun / lebih 5 tahun perkhidmatan',
  'leave.type.carry.badge': 'baki dibawa',

  /*
    Names for the yes/no marks in the table, not words drawn in the cell.
    Each one says which column it belongs to, because the mark is read out on its own — a cell
    that announces "ya" tells somebody nothing about what is being answered. So they are not
    shareable with `app.status.*` or with each other.
  */
  'leave.type.paid.yes': 'Berbayar',
  'leave.type.paid.no': 'Tanpa gaji',
  'leave.type.backdated.yes': 'Tarikh lepas dibenarkan',
  'leave.type.backdated.no': 'Tarikh lepas ditolak',
  'leave.type.approval.yes': 'Perlukan kelulusan',
  'leave.type.approval.auto': 'Lulus serta-merta',
  'leave.type.document.yes': 'Dokumen sokongan diperlukan',
  'leave.type.document.no': 'Tiada dokumen diperlukan',

  'leave.type.row.edit': 'Kemas kini jenis cuti',
  'leave.type.row.remove': 'Buang jenis cuti',
  'leave.type.row.locked': '{count} permohonan menggunakannya — nyahaktifkan sebaliknya',

  'leave.type.dialog.edit': 'Kemas kini jenis cuti',
  'leave.type.dialog.create': 'Tambah jenis cuti',
  'leave.type.dialog.code.hint': 'cth. AL, MC, EL',
  'leave.type.dialog.description': 'Keterangan',
  'leave.type.dialog.description.placeholder': 'cth. Cuti sakit dengan sijil perubatan',
  'leave.type.dialog.description.hint':
    'Dipaparkan kepada staf pada borang permohonan, dan di bawah nama dalam senarai ini.',
  'leave.type.dialog.countedIn.hint': 'Kalendar mengira hari rehat dan cuti umum.',
  'leave.type.dialog.eligibility.hint': 'Ditolak jika jantina staf tiada.',
  'leave.type.dialog.serviceTiers': 'Kelayakan naik mengikut tempoh perkhidmatan',
  'leave.type.dialog.serviceTiers.hint':
    'Akta Kerja menggredkan cuti tahunan 8/12/16 hari (s.60E) dan cuti sakit 14/18/22 hari (s.60F), melangkah pada dua dan lima tahun perkhidmatan.',
  'leave.type.dialog.tier1': 'Bawah 2 tahun',
  'leave.type.dialog.tier1.hint': 'Diambil dari Hari setahun di atas.',
  'leave.type.dialog.tier2': '2 hingga 5 tahun',
  'leave.type.dialog.tier3': 'Lebih 5 tahun',
  'leave.type.dialog.carryForward': 'Bawa baki ke tahun hadapan',
  'leave.type.dialog.carryForward.hint':
    'Dikira dari tahun sebelum apabila baki dibaca, bukan disimpan — jadi tiada kerja hujung tahun yang boleh terlepas. Ia hanya dibawa satu tahun ke hadapan.',
  'leave.type.dialog.carryMax': 'Had hari dibawa',
  'leave.type.dialog.carryMax.placeholder': 'Tiada had',
  'leave.type.dialog.carryMax.hint': 'Biarkan kosong untuk bawa semua baki.',
  'leave.type.dialog.document': 'Perlukan dokumen sokongan',
  'leave.type.dialog.document.hint':
    'Disemak semasa kelulusan, bukan semasa memohon — supaya cuti sakit boleh difailkan dahulu dan sijil dilampirkan kemudian. Penolakan tetap dibenarkan tanpa dokumen.',
  /*
    Short on purpose, all four of these.
    They label a five-across row, and a label that wraps to two lines pushes its own input below the
    ones beside it — the row then reads as ragged rather than dense. The reasoning that used to sit
    in these hints moved to where it belongs: the statutory detail is on the schema and in the
    `countedIn` hint, which is the one consequence somebody must see while choosing.
  */
  'leave.type.dialog.annualDays': 'Hari setahun',
  'leave.type.dialog.annualDays.hint': '0 bermaksud tiada had.',
  'leave.type.dialog.paid': 'Cuti berbayar',
  'leave.type.dialog.paid.hint':
    'Hari tanpa gaji tetap menghilangkan status tidak hadir, tetapi payroll perlu boleh membezakannya.',
  'leave.type.dialog.backdated': 'Benarkan permohonan ke belakang',
  'leave.type.dialog.backdated.hint':
    'Perlu untuk cuti sakit dan kecemasan — kedua-duanya difailkan selepas berlaku.',
  'leave.type.dialog.approval': 'Perlukan kelulusan',
  'leave.type.dialog.approval.hint':
    'Jika dimatikan, permohonan diluluskan serta-merta dan kalendar ditulis pada masa permohonan direkodkan.',

  // -------------------------------------------------------------------------
  // Laporan › Ringkasan Bulanan
  // -------------------------------------------------------------------------
  'monthly.title': 'Ringkasan Bulanan',
  'monthly.subtitle':
    'Kiraan hari dan jumlah minit setiap staf, dikira dari rekod kehadiran.',
  'monthly.loading': 'Memuatkan…',
  'monthly.section.subtitle': '{staff} staf · {days} hari kalendar dalam tempoh',
  'monthly.export': 'Export CSV',
  'monthly.error.load': 'Gagal menjana ringkasan',
  'monthly.empty': 'Tiada staf sepadan dengan penapis ini.',

  'monthly.stat.presentDays': 'Hari hadir',
  'monthly.stat.presentDays.hint': 'daripada {total} hari dijadualkan',
  'monthly.stat.lateDays': 'Hari lewat',
  'monthly.stat.lateDays.hint': '{hours} terkumpul',
  'monthly.stat.absentDays': 'Hari tidak hadir',
  'monthly.stat.workedHours': 'Jam bekerja',
  'monthly.stat.workedHours.hint': 'OT {hours}',
  'monthly.stat.incompleteDays': 'Hari tidak lengkap',
  'monthly.stat.incompleteDays.hint': 'biasanya tiada scan keluar',

  'monthly.unresolved.count': '{count} pengecualian belum diselesaikan',
  /**
   * The caveat that travels with the figures.
   *
   * `{kinds}` is empty when the breakdown is unavailable, so the leading separator lives in
   * the substituted value rather than in the sentence.
   */
  'monthly.unresolved.note':
    '{emphasis} dalam tempoh ini{kinds}. Jam bekerja bagi hari tersebut mungkin kurang daripada yang sebenar. Selesaikan di {link} sebelum menggunakan angka ini.',
  'monthly.unresolved.link': 'Kehadiran › Pengecualian',

  'monthly.column.staff': 'Staf',
  'monthly.column.department': 'Jabatan',
  'monthly.column.present': 'Hadir',
  'monthly.column.late': 'Lewat',
  'monthly.column.absent': 'Tidak hadir',
  'monthly.column.onLeave': 'Bercuti',
  'monthly.column.workedHours': 'Jam bekerja',
  'monthly.column.overtime': 'OT',
  'monthly.row.expand': 'butiran staf',

  'monthly.byDept.title': 'Per jabatan',
  'monthly.byDept.subtitle':
    'Disusun mengikut hari tidak hadir — jabatan yang paling perlu diperhatikan di atas.',
  'monthly.byDept.empty': 'Tiada jabatan.',
  'monthly.byDept.column.incomplete': 'Tidak lengkap',
  'monthly.byDept.column.exceptions': 'Pengecualian',

  'monthly.detail.scheduledDays': 'Hari dijadualkan',
  'monthly.detail.presentDays': 'Hari hadir',
  'monthly.detail.lateDays': 'Hari lewat',
  'monthly.detail.absentDays': 'Hari tidak hadir',
  'monthly.detail.incompleteDays': 'Hari tidak lengkap',
  'monthly.detail.leaveDays': 'Hari bercuti',
  'monthly.detail.restDays': 'Hari rehat',
  'monthly.detail.holidayDays': 'Hari cuti umum',
  'monthly.detail.workedHours': 'Jam bekerja',
  'monthly.detail.lateMinutes': 'Minit lewat',
  'monthly.detail.earlyLeaveMinutes': 'Minit keluar awal',
  'monthly.detail.overtimeHours': 'Jam kerja lebih masa',

  'monthly.detail.noRecords':
    'Tiada satu pun rekod kehadiran dalam tempoh ini. Biasanya bermakna orang ini tidak boleh scan sama sekali — bukan bahawa mereka tidak bekerja. Semak biometrik dan pemetaan ID terminal.',
  'monthly.detail.openExceptions':
    '{count} pengecualian belum diselesaikan untuk orang ini dalam tempoh ini. Jam bekerja di atas mungkin kurang daripada yang sebenar.',
  'monthly.detail.incompleteNote':
    '{count} hari tidak lengkap — hampir selalunya scan keluar yang tiada. Betulkan puncanya dan jalankan kira semula, jangan sunting hasilnya.',

  // -------------------------------------------------------------------------
  // Laporan › Export Payroll
  // -------------------------------------------------------------------------
  'payroll.title': 'Export Payroll',
  'payroll.subtitle':
    'Satu baris setiap staf: hari dijadualkan, hari hadir, dan jumlah minit untuk tempoh yang dipilih. Jam dieksport sebagai jam perpuluhan, bentuk yang sistem gaji terima.',
  'payroll.period': '{from} hingga {to}',
  'payroll.period.withDays': '{from} hingga {to} · {days} hari kalendar',
  'payroll.staffCount': '{count} staf aktif dalam tempoh ini',
  'payroll.error.load': 'Gagal membaca pratonton payroll',

  'payroll.stat.scheduledDays': 'Hari dijadualkan',
  'payroll.stat.scheduledDays.hint': 'tidak termasuk hari rehat dan cuti umum',
  'payroll.stat.presentDays': 'Hari hadir',
  'payroll.stat.presentDays.hint': '{late} daripadanya lewat',
  'payroll.stat.absentDays': 'Hari tidak hadir',
  'payroll.stat.absentDays.hint': '{leave} hari bercuti diluluskan',
  'payroll.stat.workedHours': 'Jam bekerja',
  'payroll.stat.workedHours.hint': '{decimal} jam perpuluhan dalam fail',
  'payroll.stat.overtimeHours': 'Jam kerja lebih masa',
  'payroll.stat.overtimeHours.hint': 'minit lewat {minutes}',

  'payroll.safe':
    'Semua semakan lulus. Tiada pengecualian tertunggak, setiap staf aktif ada rekod, dan tiada scan direkod ketika jam terminal tersasar.',
  'payroll.unsafe.count': '{failing} daripada {total} semakan gagal.',
  'payroll.unsafe.note':
    '{emphasis} Export tetap dibenarkan — payroll ada tarikh akhir — dan amaran ini ditulis sebagai baris komen di dalam fail CSV. Tetapi angka bagi hari yang terlibat mungkin kurang daripada yang sebenar.',

  'payroll.filter.fromDate': 'Dari tarikh',
  'payroll.filter.toDate': 'Hingga tarikh',
  'payroll.filter.between': 'hingga',

  'payroll.check.empty': 'Tiada semakan untuk tempoh ini.',
  'payroll.check.column.name': 'Semakan',
  'payroll.check.column.count': 'Kiraan',
  'payroll.check.column.effect': 'Kesan pada fail',

  /**
   * The checks the server runs, named on the client.
   *
   * Held here so a check the server stops reporting still appears — at zero — rather than
   * silently dropping off the list somebody signs off against. `detail` for a failing check
   * comes from the server and is not a label.
   */
  'payroll.check.unresolvedExceptions': 'Pengecualian belum diselesaikan',
  'payroll.check.unresolvedExceptions.clear':
    'Tiada pengecualian tertunggak dalam tempoh ini.',
  'payroll.check.staffWithoutRecords': 'Staf tanpa sebarang rekod',
  'payroll.check.staffWithoutRecords.clear':
    'Setiap staf aktif ada sekurang-kurangnya satu rekod dalam tempoh ini.',
  'payroll.check.pendingOvertime': 'Lebih masa belum diputuskan',
  'payroll.check.pendingOvertime.clear':
    'Setiap permohonan lebih masa dalam tempoh ini sudah diluluskan atau ditolak.',
  'payroll.check.clockDrift': 'Scan ketika jam terminal tersasar',
  'payroll.check.clockDrift.clear':
    'Tiada scan direkod ketika jam terminal tersasar melebihi ambang.',

  'payroll.exceptions.title': 'Pengecualian belum diselesaikan',
  'payroll.exceptions.subtitle':
    'Setiap satu adalah hari yang enjin tidak dapat selesaikan sendiri. Betulkan puncanya dan jalankan kira semula — jangan sunting hasilnya.',
  'payroll.exceptions.open': 'Buka pengecualian',
  'payroll.exceptions.empty': 'Tiada.',
  'payroll.exceptions.column.kind': 'Jenis',
  'payroll.exceptions.column.count': 'Bilangan',

  'payroll.export.hint':
    'Fail membawa BOM UTF-8 supaya Excel tidak merosakkan nama Melayu, dan baris komen {hash} di atas pengepala yang menyatakan tempoh, bilangan staf, dan amaran pengecualian.',
  'payroll.export.readAt': ' Dibaca {time} · zon waktu {zone}.',
  'payroll.export.submit': 'Export CSV payroll',
  'payroll.export.permission': 'Export Payroll › export',
  'payroll.export.denied':
    'Anda boleh membaca pratonton ini tetapi tidak menjananya sebagai fail. Minta kebenaran {permission} jika perlu.',

  // -------------------------------------------------------------------------
  // Medan penjana laporan
  //
  // These are the only labels the SERVER holds keys for. `/api/reports/fields` describes the
  // picker, and the wording has to come from the registry like everything else — otherwise
  // turning label numbers on would show a hole exactly where somebody is choosing columns.
  //
  // The server sends `labelKey`; the client resolves it. CSV headers are resolved on the
  // server from the source wording, because the file is written there and has no reader.
  // -------------------------------------------------------------------------
  'reportField.workDate': 'Tarikh',
  'reportField.workDateOfWork': 'Tarikh kerja',
  'reportField.employeeNo': 'No. Staf',
  'reportField.fullName': 'Nama',
  'reportField.department': 'Jabatan',
  'reportField.location': 'Lokasi',
  'reportField.shift': 'Shift',
  'reportField.status': 'Status',
  'reportField.scheduledStart': 'Jadual mula',
  'reportField.scheduledEnd': 'Jadual tamat',
  'reportField.checkInAt': 'Masuk',
  'reportField.checkOutAt': 'Keluar',
  'reportField.lateMinutes': 'Minit lewat',
  'reportField.earlyLeaveMinutes': 'Minit keluar awal',
  'reportField.workedMinutes': 'Minit bekerja',
  'reportField.overtimeMinutes': 'Minit OT',
  'reportField.occurredAt': 'Berlaku',
  'reportField.kind': 'Jenis',
  'reportField.deviceName': 'Terminal',
  'reportField.detail': 'Butiran',
  'reportField.resolvedAt': 'Diselesaikan',
  'reportField.resolutionNote': 'Sebab penyelesaian',
  'reportField.fromDate': 'Dari',
  'reportField.toDate': 'Hingga',
  'reportField.leaveType': 'Jenis cuti',
  'reportField.days': 'Hari',
  'reportField.reason': 'Sebab',
  'reportField.decisionNote': 'Nota keputusan',
  'reportField.count': 'Bilangan',
  'reportField.group': 'Kumpulan',

  'reportDataset.attendance.note':
    'Satu baris setiap staf setiap hari. Dijana oleh enjin dari log scan.',
  'reportDataset.exceptions.note':
    'Perkara yang enjin tidak dapat selesaikan. Berguna untuk laporan audit.',
  'reportDataset.leave.note': 'Permohonan dan keputusannya.',

  'reportGroup.none.attendance': 'Tiada — satu baris setiap rekod',
  'reportGroup.none.exceptions': 'Tiada — satu baris setiap pengecualian',
  'reportGroup.none.leave': 'Tiada — satu baris setiap permohonan',
  'reportGroup.staff': 'Per staf',
  'reportGroup.department': 'Per jabatan',
  'reportGroup.status': 'Per status',
  'reportGroup.workDate': 'Per tarikh',
  'reportGroup.kind': 'Per jenis',
  'reportGroup.leaveType': 'Per jenis cuti',

  // -------------------------------------------------------------------------
  // Laporan › Penjana Laporan
  // -------------------------------------------------------------------------
  'builder.title': 'Penjana Laporan',
  'builder.subtitle':
    'Pilih set data, lajur, dan cara pengumpulan. Tiada formula sendiri di sini — setiap lajur adalah nilai yang sudah tersimpan, supaya laporan ini tidak menjadi enjin kiraan kedua.',
  'builder.tabs.aria': 'Set data',
  'builder.error.fields': 'Gagal membaca senarai medan',
  'builder.error.run': 'Gagal menjana laporan',
  'builder.error.export': 'Gagal export laporan',
  'builder.run': 'Jana pratonton',

  'builder.columns': 'Lajur',
  'builder.columns.full': 'Had {max} lajur dicapai',
  'builder.groupBy': 'Kumpulkan',
  'builder.groupBy.none': 'Tiada',
  'builder.limit': 'Had pratonton',
  'builder.limit.rows': '{count} baris',

  'builder.grouped.note':
    'Dikumpulkan: setiap baris menjadi satu kumpulan dengan bilangan rekod{totals}. Pengumpulan dikira atas baris yang dibaca sahaja, bukan seluruh pangkalan data.',
  'builder.grouped.withTotals': ' dan jumlah bagi {count} lajur angka yang dipilih',
  'builder.grouped.noNumeric':
    '. Tiada lajur angka dipilih, jadi hanya bilangan dipaparkan — pilih lajur seperti minit bekerja untuk mendapatkan jumlah',
  'builder.needColumn': 'Pilih sekurang-kurangnya satu lajur sebelum menjana.',

  'builder.search.exceptions': 'Cari jenis pengecualian…',
  'builder.filter.allStatuses': 'Semua status',

  'builder.stale': 'Pilihan berubah selepas jadual ini dijana. Jana semula sebelum membacanya.',
  'builder.empty.notRun': 'Belum dijana. Pilih lajur dan tekan Jana pratonton.',
  'builder.empty.noMatch': 'Tiada baris sepadan dengan penapis ini.',

  'builder.truncated':
    'Had {limit} baris dicapai, jadi ini adalah sebahagian dan bukan keseluruhan{grouped}. Sempitkan tempoh atau penapis, atau export — fail mengambil lebih banyak baris daripada pratonton ini.',
  'builder.truncated.grouped': '. Jumlah dalam setiap kumpulan juga sebahagian',

  'builder.hint.notRun':
    'Pratonton dibaca sehingga had yang dipilih. Export mengambil sehingga 20,000 baris dan menyatakan di dalam fail jika had itu dicapai.',
  'builder.hint.shown':
    '{count} baris dipaparkan{cap} · dijana {time}. Export mengambil sehingga 20,000 baris.',
  'builder.hint.cap': ' (had {limit} dicapai)',
  'builder.export': 'Export CSV',

  // -------------------------------------------------------------------------
  // Perbendaharaan kata tetapan
  //
  // The stored enum values behind the roles matrix, the account list and the two log
  // screens. Shared because the same value is rendered in a permission checkbox, a status
  // badge and a log row.
  // -------------------------------------------------------------------------
  'action.create': 'Cipta',
  'action.view': 'Lihat',
  'action.edit': 'Ubah',
  'action.delete': 'Buang',
  'action.approve': 'Sahkan',
  'action.suspend': 'Gantung',
  'action.activate': 'Aktifkan',
  'action.export': 'Export',

  'userStatus.pending': 'Menunggu',
  'userStatus.suspended': 'Digantung',

  /** Log severity. Upper case in the source because it is a severity code, not a word. */
  'logLevel.info': 'INFO',
  'logLevel.warn': 'WARN',
  'logLevel.error': 'ERROR',
  'logLevel.debug': 'DEBUG',

  'logCategory.auth': 'Auth',
  'logCategory.attendance': 'Kehadiran',
  'logCategory.staff': 'Staf',
  'logCategory.schedule': 'Jadual',
  'logCategory.reports': 'Laporan',
  'logCategory.devices': 'Terminal',
  'logCategory.users': 'Pengguna',
  'logCategory.roles': 'Peranan',
  'logCategory.settings': 'Tetapan',
  'logCategory.backup': 'Backup',
  'logCategory.retention': 'Simpanan',
  'logCategory.system': 'Sistem',

  'logSource.web': 'Web',
  'logSource.terminal': 'Terminal',
  'logSource.app': 'App',
  'logSource.system': 'Sistem',

  /** Audited entity types. Keyed by the Prisma model name the audit row stores. */
  'entity.Setting': 'Tetapan',
  'entity.Role': 'Peranan',
  'entity.UserAccount': 'Akaun pengguna',
  'entity.AppClient': 'Klien app',
  'entity.Staff': 'Staf',
  'entity.StaffFace': 'Biometrik muka',
  'entity.AttendanceRecord': 'Rekod kehadiran',
  'entity.Exception': 'Pengecualian',
  'entity.Device': 'Terminal',

  'encryption.none': 'Tiada',
  'encryption.tls': 'TLS',
  'encryption.ssl': 'SSL',

  'tokenStatus.active': 'AKTIF',
  'tokenStatus.grace': 'TEMPOH RAHMAT',
  'tokenStatus.superseded': 'DIGANTI',
  'tokenStatus.expired': 'LUPUT',
  'tokenStatus.revoked': 'DIBATALKAN',

  /** Audit action, shown as a chip and as a row badge on the audit log. */
  'auditAction.create': 'Cipta',
  'auditAction.update': 'Kemas kini',
  'auditAction.delete': 'Buang',

  // -------------------------------------------------------------------------
  // Tetapan › Log
  // -------------------------------------------------------------------------
  'logs.title': 'Log',
  'logs.subtitle': 'Pantau aktiviti sistem, tindakan pengguna dan jejak audit keselamatan.',
  'logs.tabs.aria': 'Jenis log',
  'logs.tab.activity': 'Log Aktiviti',
  'logs.tab.audit': 'Log Audit',

  'logs.activity.error.load': 'Gagal memuatkan log aktiviti',
  'logs.activity.search': 'Cari mesej, pengguna, IP, laluan…',
  'logs.activity.empty': 'Tiada aktiviti sepadan dengan penapis ini.',
  'logs.filter.allCategories': 'Semua kategori',
  'logs.filter.allSources': 'Semua sumber',
  'logs.filter.allActors': 'Semua pengguna',
  'logs.filter.allEntities': 'Semua jenis rekod',
  /** A facet option carries its own row count, so the two are one label. */
  'logs.facet.withCount': '{label} ({count})',

  'logs.activity.column.time': 'Masa',
  'logs.activity.column.level': 'Tahap',
  'logs.activity.column.category': 'Kategori',
  'logs.activity.column.message': 'Mesej',
  'logs.activity.column.actor': 'Pengguna',
  'logs.activity.column.ip': 'IP',
  'logs.activity.row.expand': 'butiran aktiviti',

  'logs.activity.detail.action': 'Tindakan',
  'logs.activity.detail.source': 'Sumber',
  'logs.activity.detail.path': 'Laluan',
  'logs.activity.detail.entryId': 'ID entri',
  'logs.activity.detail.accountId': 'ID akaun',
  'logs.activity.detail.system': 'Sistem',
  'logs.activity.detail.fullTime': 'Masa penuh',
  'logs.activity.detail.message': 'Mesej',

  'logs.audit.error.load': 'Gagal memuatkan log audit',
  'logs.audit.search': 'Cari pelaku, jenis rekod, sebab, IP…',
  'logs.audit.empty': 'Tiada perubahan sepadan dengan penapis ini.',
  'logs.audit.redacted': '[redacted]',
  'logs.audit.appendOnly':
    'Hanya boleh ditambah. Tiada laluan dalam sistem ini untuk mengubah atau membuangnya, termasuk untuk Super Admin. Nilai rahsia direkodkan sebagai {redacted} — hakikat perubahan itu yang penting, bukan nilainya.',

  'logs.audit.column.action': 'Tindakan',
  'logs.audit.column.record': 'Rekod',
  'logs.audit.column.changes': 'Perubahan',
  'logs.audit.column.actor': 'Pelaku',
  'logs.audit.fieldCount': '({count} medan)',
  'logs.audit.row.expand': 'butiran perubahan',

  'logs.audit.noFields': 'Tiada medan direkodkan untuk entri ini.',
  'logs.audit.change.field': 'Medan',
  'logs.audit.change.before': 'Sebelum',
  'logs.audit.change.after': 'Selepas',
  'logs.audit.change.becomes': 'menjadi',
  'logs.audit.detail.reason': 'Sebab',

  /** Rendering of a stored JSON value in the before/after grid. */
  'logs.value.true': 'ya',
  'logs.value.false': 'tidak',

  // -------------------------------------------------------------------------
  // Registri kebenaran (pelayan)
  //
  // `apps/server/src/auth/permissions.ts` holds these keys. The permission matrix is a
  // screen somebody reads, and the same wording appears in the forbidden message the server
  // returns, so it belongs in the registry like anything else.
  //
  // Most screen names reuse a key that already exists — the matrix row for the exceptions
  // queue is the same words as that screen's own title, and two labels holding the same
  // words would have to be translated twice.
  // -------------------------------------------------------------------------
  'perm.screen.dashboard': 'Dashboard',
  'perm.screen.staff.departments': 'Jabatan',
  'perm.screen.staff.locations': 'Lokasi',
  'perm.screen.schedule.workPatterns': 'Pola Waktu Kerja',
  'perm.screen.schedule.shifts': 'Shift',
  'perm.screen.settings.general': 'Konfigurasi Umum: Umum',
  'perm.screen.settings.translation': 'Konfigurasi Umum: Alih Bahasa',
  'perm.screen.settings.backup': 'Konfigurasi Umum: Backup & Restore',
  'perm.screen.settings.maintenance': 'Konfigurasi Umum: Maintenance & Cache',
  'perm.screen.settings.integration.email': 'Integrasi: Emel',
  'perm.screen.settings.integration.sms': 'Integrasi: SMS',
  'perm.screen.settings.integration.telegram': 'Integrasi: Telegram',
  'perm.screen.settings.integration.api': 'Integrasi: API & Webhook',
  'perm.screen.settings.security': 'Keselamatan',
  'perm.screen.settings.integration.holidays': 'Integrasi: Cuti Umum',
  'perm.screen.settings.users.admin': 'Pengurusan Pengguna: Administrator',
  'perm.screen.settings.users.staff': 'Pengurusan Pengguna: Staff',
  'perm.screen.settings.users.apps': 'Pengurusan Pengguna: Apps',
  'perm.screen.settings.logs.activity': 'Log: Aktiviti',
  'perm.screen.settings.logs.audit': 'Log: Audit',

  /** Screen-specific actions, shown in the matrix under OTHERS. */
  'perm.action.resync': 'Sync Terminal',
  'perm.action.resync.note': 'Tolak semula rekod staf ke terminal',
  'perm.action.salary': 'Gaji Bulanan',
  'perm.action.salary.note':
    'Baca dan tulis gaji. Berasingan daripada Ubah — ia mengharga setiap tuntutan lebih masa.',
  'perm.action.import': 'Import Pengguna',
  'perm.action.import.note': 'Tarik senarai pengguna dari terminal',
  'perm.action.template': 'Muat Turun Templat',
  'perm.action.download': 'Muat Turun',
  'perm.action.download.note': 'Fail dump mengandungi setiap rekod kehadiran',
  'perm.action.recompute': 'Kira Semula',
  'perm.action.recompute.note': 'Bina semula rekod kehadiran dari log mentah',
  'perm.action.purge': 'Buang Data Lapuk',
  'perm.action.purge.note':
    'Memadam log scan yang melebihi tempoh simpanan. Tidak boleh dibatalkan.',
  'perm.action.maintenanceMode': 'Mod Penyelenggaraan',
  'perm.action.maintenanceMode.note':
    'Menolak setiap permintaan operator. Push terminal tetap diterima.',
  'perm.action.clearCache': 'Kosongkan Cache',
  'perm.action.clearCache.note':
    'Memaksa konfigurasi dibaca semula dan klien terminal berjabat tangan semula',
  'perm.action.test.connection': 'Uji Sambungan',
  'perm.action.sync.push': 'Sync & Push',
  'perm.action.clock': 'Set Jam',
  'perm.action.clock.note': 'Jam yang salah merosakkan setiap rekod selepasnya',
  'perm.action.terminalConfig': 'Tetapan Terminal',
  'perm.action.terminalConfig.note':
    'Mod pengesahan, tempoh pintu terbuka, dan buka pintu dari jauh — berasingan daripada Ubah',
  'perm.action.test.email': 'Hantar Ujian',
  'perm.action.test': 'Uji',
  'perm.action.test.webhook': 'Hantar Ujian Webhook',
  'perm.action.sync': 'Sync',
  'perm.action.reset': 'Set Semula Kata Laluan',
  'perm.action.unbind': 'Lepas Ikatan Peranti',
  'perm.action.rotate': 'Putar Secret',
  /**
   * Each request type is one tabbed screen: the queue, then its types, approval chain and
   * notifications. Deciding an application and changing the rules it is decided by are
   * different jobs, so the settings tabs are gated apart from Ubah.
   */
  'perm.action.configure': 'Tetapan Modul',
  'perm.action.configure.note': 'Jenis, aliran kelulusan dan notifikasi — bukan permohonan',

  /** Why a screen's action list is shaped the way it is. */
  'perm.note.attendance.records': 'Rekod dijana oleh enjin, jadi tiada cipta atau buang manual.',
  'perm.note.attendance.rawLog': 'Tidak boleh diubah oleh sesiapa, termasuk Super Admin.',
  'perm.note.attendance.exceptions': 'Sahkan = tandakan selesai.',
  'perm.note.attendance.justifications':
    'Sebab dihantar oleh staf sendiri melalui Rekod Saya, jadi tiada tindakan Cipta. Sahkan = luluskan, tolak, atau hantar semula.',
  'perm.note.staff.biometrics': 'Muka digantikan, bukan diubah — jadi tiada tindakan Ubah.',
  'perm.note.schedule.roster':
    'Menetapkan shift menulis ganti hari yang sama, jadi ia Ubah bukan Cipta.',
  'perm.note.schedule.leave':
    'Kelulusan menulis hari cuti ke kalendar dan mengira semula kehadiran.',
  'perm.note.hr.overtime':
    'Jam datang dari scan yang enjin sudah ukur, bukan dari nombor yang dimohon.',
  'perm.note.hr.expenses':
    'Perbelanjaan tidak boleh diluluskan tanpa resit — resit itulah asas jumlahnya, bukan pilihan kategori.',
  'perm.note.hr.claims':
    'Tetapan Modul mengawal jenis tuntutan dan kadarnya — itu yang menentukan harga, berasingan daripada meluluskan satu tuntutan.',
  'perm.note.hr.applicants': 'Data pemohon adalah data orang luar — buang bermakna buang terus.',
  'perm.note.hr.kpiResults':
    'Keputusan adalah fakta berasingan daripada semakan yang menghasilkannya.',
  'perm.note.hr.payrollPeriods': 'Tempoh memakan Export Payroll; ia tidak mengira jam sendiri.',
  'perm.note.hr.loans': 'Baki hutang seseorang — lebih terhad daripada gaji itu sendiri.',
  'perm.note.reports.payroll':
    'Export ini menjadi gaji. Ia menyatakan pengecualian yang belum diselesaikan.',
  'perm.note.settings.backup':
    'Restore tiada di sini dengan sengaja — ia arahan yang dijalankan pada pelayan.',
  'perm.note.settings.devices': 'Terminal tidak boleh dibuang — sejarah scan merujuk kepadanya.',
  'perm.note.settings.integration.email':
    'Menghantar ujian menghantar emel sebenar melalui relay yang dikonfigurasikan.',
  'perm.note.settings.integration.api':
    'Mencipta token bermakna mengeluarkan kredensial yang boleh membaca data staf dari luar sistem.',
  'perm.note.settings.security': 'Dasar log masuk dan kata laluan untuk keseluruhan sistem.',
  'perm.note.settings.users.admin': 'Akaun admin boleh mengubah kehadiran ribuan orang.',
  'perm.note.settings.users.apps': 'Klien mesti digantung dahulu sebelum boleh dibuang.',
  'perm.note.settings.logs.audit':
    'Hanya boleh ditambah. Tiada laluan untuk mengubah atau membuang.',

  // -------------------------------------------------------------------------
  // Permohonan › Aliran Kelulusan & Notifikasi (dikongsi setiap modul)
  // -------------------------------------------------------------------------
  /*
    No `hr.approval.title`. The section heading is the rung count — "3 aras kelulusan" — the same way
    the leave types tab heads its list with "6 jenis cuti". The tab beside it is already named
    Aliran Kelulusan, and a heading that repeats the tab it sits under is a line nobody reads.
  */
  'hr.approval.subtitle':
    'Siapa menandatangani, dan dalam susunan apa. Tanpa aras dikonfigurasikan, satu keputusan menyelesaikan permohonan — itu kelakuan lalai dan ia kekal begitu.',
  'hr.approval.tab': 'Aliran Kelulusan',

  'hr.approval.column.level': 'Aras',
  'hr.approval.column.approver': 'Pelulus',
  'hr.approval.column.kind': 'Jenis',
  'hr.approval.column.note': 'Catatan',

  'hr.approval.kind.account': 'Pengguna',
  'hr.approval.kind.role': 'Peranan',

  'hr.approval.empty': 'Tiada aras dikonfigurasikan. Satu keputusan menyelesaikan permohonan.',
  'hr.approval.empty.hint':
    'Tambah aras untuk memerlukan lebih daripada satu tandatangan. Aras pertama memutuskan dahulu, dan hanya aras terakhir meluluskan permohonan.',

  'hr.approval.action.add': 'Tambah Aras',
  'hr.approval.action.up': 'Naik',
  'hr.approval.action.down': 'Turun',
  'hr.approval.action.remove': 'Buang aras',
  'hr.approval.action.suspend': 'Gantung aras',
  'hr.approval.action.resume': 'Aktifkan aras',

  'hr.approval.suspended': 'Digantung',
  'hr.approval.suspended.note':
    'Aras yang digantung dilangkau sepenuhnya — rantaian menjadi lebih pendek, bukan tersekat pada aras yang tiada sesiapa.',

  'hr.approval.blocked': '{count} permohonan sudah separuh melalui rantaian ini',
  'hr.approval.blocked.note':
    'Permohonan yang sudah ditandatangani sebahagian tidak boleh dialih arasnya. Membuang satu aras akan menjadikannya diluluskan secara retroaktif; menambah satu akan meminta aras menandatangani selepas permohonan sudah melepasinya. Selesaikan atau tolaknya dahulu.',

  'hr.approval.chainLength': 'Rantaian: {count} aras',
  'hr.approval.chainLength.none': 'Rantaian: satu langkah',

  'hr.approval.form.title': 'Aras Kelulusan',
  'hr.approval.form.by': 'Ditandatangani oleh',
  'hr.approval.form.byAccount': 'Seorang pengguna',
  'hr.approval.form.byRole': 'Sesiapa dengan peranan',
  'hr.approval.form.byRole.hint':
    'Aras yang menamakan peranan kekal berfungsi apabila orang bertukar. Aras yang menamakan seseorang lebih tepat tetapi tersekat apabila mereka berhenti.',
  'hr.approval.form.account': 'Pengguna',
  'hr.approval.form.role': 'Peranan',
  'hr.approval.form.note': 'Catatan',
  'hr.approval.form.note.hint': 'Untuk aras yang tujuannya tidak jelas dari namanya.',
  'hr.approval.form.candidates.empty':
    'Tiada pengguna atau peranan mempunyai kebenaran Luluskan untuk modul ini. Berikan kebenaran itu dahulu di Pengurusan Peranan — aras yang menamakan seseorang yang tidak boleh meluluskan akan menyekat setiap permohonan yang sampai kepadanya.',
  'hr.approval.form.override':
    'Pemegang kebenaran Tetapan Modul boleh melangkau susunan ini. Itu jalan pulih apabila seorang pelulus berhenti — tanpanya permohonan tersekat selama-lamanya.',

  'hr.approval.trail.title': 'Sejarah Keputusan',
  'hr.approval.trail.level': 'Aras {level}',
  'hr.approval.trail.approved': 'Diluluskan',
  'hr.approval.trail.rejected': 'Ditolak',
  'hr.approval.trail.empty': 'Belum ada keputusan.',
  'hr.approval.awaiting': 'Menunggu aras {level} ({name})',
  'hr.approval.progress': 'Aras {level} daripada {total}',

  'hr.notify.title': 'Notifikasi',
  'hr.notify.subtitle':
    'Siapa diberitahu tentang keputusan. Saluran itu sendiri — emel, SMS, Telegram — dikonfigurasikan di Tetapan › Integrasi; ini menentukan bila modul ini bercakap.',
  'hr.notify.tab': 'Notifikasi',
  'hr.notify.applicant': 'Beritahu pemohon',
  'hr.notify.applicant.hint': 'Apabila permohonan mereka diluluskan atau ditolak.',
  'hr.notify.approver': 'Beritahu pelulus seterusnya',
  'hr.notify.approver.hint': 'Apabila permohonan sampai ke aras mereka.',
  'hr.notify.everyLevel': 'Beritahu pada setiap aras',
  'hr.notify.everyLevel.hint':
    'Dimatikan secara lalai. Memberitahu seseorang "diluluskan" pada aras 1 daripada 3 memberitahu mereka sesuatu yang tidak benar — permohonan masih menunggu dan masih boleh ditolak.',
  'hr.notify.everyLevel.notApplicable':
    'Tiada kesan sementara modul ini satu langkah. Tambah aras pada Aliran Kelulusan dahulu.',
  'hr.notify.profile': 'Profil emel',
  'hr.notify.profile.hint':
    'Profil mana yang menghantar emel modul ini. Dikonfigurasikan di Tetapan › Integrasi › Emel. Kosong bermakna modul ini tidak menghantar emel sama sekali.',
  'hr.notify.profile.none': 'Tiada — jangan hantar emel',
  'hr.notify.profile.empty':
    'Belum ada profil emel dikonfigurasikan. Cipta satu di Tetapan › Integrasi › Emel dahulu — tanpanya tiada penghantar untuk dinamakan, dan emel tidak boleh dihantar.',
  'hr.notify.profile.inactive': '(tidak aktif)',
  'hr.notify.profile.notSending':
    'Modul ini tidak menghantar emel. SMS dan Telegram masih berfungsi jika salurannya dihidupkan.',

  'hr.template.tab': 'Templat Emel',
  'hr.template.title': 'Templat Emel',
  'hr.template.subtitle':
    'Perkataan yang setiap notifikasi bawa. Disimpan sebagai data, bukan kod — supaya menukar satu ayat bukan satu keluaran.',
  'hr.template.event.submitted': 'Permohonan diterima',
  'hr.template.event.levelApproved': 'Diluluskan pada aras pertengahan',
  'hr.template.event.approved': 'Diluluskan sepenuhnya',
  'hr.template.event.rejected': 'Ditolak',
  'hr.template.event.cancelled': 'Ditarik',
  'hr.template.event.awaitingApprover': 'Menunggu kelulusan anda',

  /*
   * Payroll and KPI raise their own events, not the request six.
   *
   * A payroll period is not applied for and is not refused, and an appraisal is finalised rather
   * than granted. `MODULE_EVENTS` in `hr/email-template.ts` decides which of these the editor
   * offers, so neither screen shows a switch nothing can flip.
   */
  'hr.template.event.payslipReady': 'Slip gaji sedia',
  'hr.template.event.awardApproved': 'Bonus atau komisen diluluskan',
  'hr.template.event.awardCancelled': 'Bonus atau komisen dibatalkan',
  'hr.template.event.lendingApproved': 'Pinjaman atau pendahuluan diluluskan',
  'hr.template.event.reviewAssigned': 'Penilaian ditugaskan kepada penilai',
  'hr.template.event.appraisalFinalised': 'Penilaian dimuktamadkan',
  'hr.template.audience.applicant': 'Kepada pemohon',
  'hr.template.audience.approver': 'Kepada pelulus',
  'hr.template.customised': 'Diubah',
  'hr.template.default': 'Lalai',
  'hr.template.disabled': 'Dimatikan',
  'hr.template.column.event': 'Peristiwa',
  'hr.template.column.subject': 'Subjek',
  'hr.template.column.state': 'Keadaan',
  'hr.template.empty': 'Tiada peristiwa notifikasi untuk modul ini.',
  'hr.template.action.edit': 'Ubah templat',
  'hr.template.action.revert': 'Kembali ke lalai',
  'hr.template.action.preview': 'Pratonton',
  'hr.template.form.subject': 'Subjek',
  'hr.template.form.body': 'Badan emel',
  'hr.template.form.enabled': 'Hantar emel untuk peristiwa ini',
  'hr.template.form.enabled.hint':
    'Bila dimatikan, peristiwa ini tetap berlaku dan direkodkan — cuma tiada emel dihantar untuknya.',
  'hr.template.form.placeholders': 'Medan yang boleh digunakan',
  'hr.template.form.placeholders.hint':
    'Klik untuk menyisip. Medan yang modul ini tidak boleh isi akan ditolak semasa simpan — itu satu-satunya masa kesilapan itu murah.',
  'hr.template.form.unknown': 'Medan tidak dikenali: {names}',
  'hr.template.preview.title': 'Pratonton',
  'hr.template.preview.hint':
    'Dirender di pelayan dengan nilai contoh, melalui penggantian yang sama yang menghantar emel sebenar. Tiada emel dihantar.',
  'hr.template.saved': 'Templat disimpan.',
  'hr.template.reverted': 'Templat dikembalikan ke lalai.',
  'hr.template.note.paragraphs':
    'Baris kosong menjadi perenggan. Tiada pemformatan lain — notis keputusan perlukan perenggan dan tiada yang lain, dan setiap keupayaan tambahan ialah satu lagi cara emel terpapar berbeza dalam Outlook.',

  'hr.notify.cc': 'Salinan kepada',
  'hr.notify.cc.hint': 'Satu alamat disalin pada setiap keputusan. Kosongkan untuk tiada.',
  'hr.notify.saved': 'Tetapan notifikasi disimpan.',
  'hr.notify.channels':
    'Notifikasi adalah kesan sampingan sesuatu yang sudah berjaya, jadi ia tidak pernah menggagalkan keputusan. Tiada outbox — kalau gateway mati ketika keputusan dibuat, mesej itu hilang.',

  // -------------------------------------------------------------------------
  // KPI & Penilaian
  // -------------------------------------------------------------------------
  /**
   * The competency catalogue.
   *
   * Its own screen because the vocabulary is organisation-wide. Free text on each form was what
   * made it necessary: "Komunikasi" became ten spellings of itself, and two questions became
   * unanswerable — what does this competency average across everybody, and which forms ask about it.
   */
  'kpi.competency.title': 'Katalog Kompetensi',
  'kpi.competency.subtitle':
    'Perkataan yang setiap borang penilaian pilih daripadanya. Satu kompetensi, satu ejaan — tanpa katalog, "Komunikasi" ditaip sepuluh kali dengan sepuluh ejaan dan tiada siapa boleh bertanya purata markahnya.',
  'kpi.competency.category.core': 'Teras',
  'kpi.competency.category.functional': 'Fungsian',
  'kpi.competency.category.leadership': 'Kepimpinan',
  'kpi.competency.category.core.hint': 'Dikenakan pada semua staf, apa pun tugasnya.',
  'kpi.competency.category.functional.hint': 'Kerja itu sendiri — prosedur, peralatan, bidang tugas.',
  'kpi.competency.category.leadership.hint':
    'Hanya untuk yang mempertanggungjawabkan orang lain.',
  'kpi.competency.column.name': 'Kompetensi',
  'kpi.competency.column.category': 'Kategori',
  'kpi.competency.column.used': 'Digunakan',
  'kpi.competency.used': '{count} borang',
  'kpi.competency.used.none': 'Belum digunakan',
  'kpi.competency.empty': 'Katalog masih kosong.',
  'kpi.competency.error.load': 'Katalog kompetensi tidak dapat dimuatkan.',
  'kpi.competency.action.new': 'Kompetensi Baharu',
  'kpi.competency.action.edit': 'Ubah kompetensi',
  'kpi.competency.action.delete': 'Buang kompetensi',
  'kpi.competency.action.deactivate': 'Nyahaktifkan',
  'kpi.competency.action.activate': 'Aktifkan semula',
  'kpi.competency.form.title': 'Kompetensi',
  'kpi.competency.form.name': 'Nama',
  'kpi.competency.form.name.hint':
    'Ruang di hujung dan ruang berganda dibuang sebelum disimpan — jika tidak, satu ruang tambahan menghasilkan kompetensi kedua yang membaca serupa.',
  'kpi.competency.form.category': 'Kategori',
  'kpi.competency.form.category.hint':
    'Mengumpulkan senarai pilihan sahaja. Ia tidak mempengaruhi aritmetik: kompetensi kepimpinan pada 10% bernilai sama dengan kompetensi teras pada 10%.',
  'kpi.competency.form.description': 'Keterangan',
  'kpi.competency.form.description.hint':
    'Apa yang penilai patut fikirkan ketika memberi markah baris ini.',
  'kpi.competency.form.active': 'Aktif',
  'kpi.competency.saved': 'Kompetensi disimpan.',
  'kpi.competency.removed': 'Kompetensi dibuang.',
  'kpi.competency.renamed':
    'Dinamakan semula. {count} borang yang bertanya tentangnya turut dikemas kini; penilaian yang sudah dicipta kekal dengan perkataan yang dipersoalkan kepada mereka.',
  'kpi.competency.note.retire':
    'Nyahaktifkan, jangan buang. Kompetensi yang dinyahaktifkan hilang dari senarai pilihan borang baharu tetapi perkataannya kekal pada borang yang sudah menggunakannya — itulah sebab jawapan "borang mana menggunakan ini" masih boleh dijawab tahun hadapan.',
  'kpi.competency.note.inUse':
    'Kompetensi yang sedang digunakan oleh borang tidak boleh dibuang. Nyahaktifkan ia sebagai ganti.',
  'kpi.competency.inactive': 'Tidak aktif',

  'kpi.template.title': 'Borang Penilaian',
  'kpi.template.subtitle':
    'Kompetensi yang ditanya dan pemberat setiap satu. Setiap kompetensi diberi markah 0–100 dan pemberat ialah peratusnya, jadi jumlahnya 100.',
  'kpi.template.column.code': 'Kod',
  'kpi.template.column.name': 'Nama',
  'kpi.template.column.items': 'Kompetensi',
  'kpi.template.column.weight': 'Jumlah Pemberat',
  'kpi.template.column.used': 'Digunakan',
  'kpi.template.empty': 'Tiada borang penilaian.',
  'kpi.template.error.load': 'Senarai borang tidak dapat dimuatkan.',
  'kpi.template.action.new': 'Borang Baharu',
  'kpi.template.action.edit': 'Ubah borang',
  'kpi.template.action.delete': 'Buang borang',
  'kpi.template.action.view': 'Lihat',
  'kpi.template.weightOff': 'Berjumlah {total}, bukan 100',
  /**
   * Why editing a form in use is now allowed.
   *
   * It used to be refused, and the refusal was correct for the model underneath it: scores read
   * their weight through a foreign key, so an edit regraded appraisals somebody had signed. It also
   * meant a typo could never be corrected, so the wrong wording was asked for another year. Each
   * appraisal now takes its own copy of the questions and weights when it is created.
   */
  'kpi.template.note.editable':
    'Borang boleh disunting walaupun sudah digunakan. Setiap penilaian menyimpan salinan soalan dan pemberatnya sendiri ketika dicipta, jadi menyunting borang tidak mengubah penilaian yang sudah ditandatangani — dan salah taip masih boleh dibetulkan.',
  'kpi.template.note.catalogue':
    'Kompetensi dipilih dari katalog di Tetapan KPI, bukan ditaip. Itu yang membolehkan satu kompetensi dibandingkan merentas borang.',
  'kpi.template.retiredItem':
    'Kompetensi ini sudah dinyahaktifkan dalam katalog. Perkataannya kekal di sini; ia tidak boleh dipilih pada borang baharu.',

  'kpi.template.form.title': 'Borang Penilaian',
  'kpi.template.form.code': 'Kod',
  'kpi.template.form.name': 'Nama',
  'kpi.template.form.description': 'Keterangan',
  'kpi.template.form.items': 'Kompetensi',
  'kpi.template.form.item.competency': 'Kompetensi',
  'kpi.template.form.item.competency.placeholder': 'Pilih dari katalog',
  'kpi.template.form.item.weight': 'Pemberat (%)',
  'kpi.template.form.item.add': 'Tambah kompetensi',
  'kpi.template.form.item.remove': 'Buang',
  'kpi.template.form.equalise': 'Pemberat sama rata',
  'kpi.template.form.equalise.hint':
    'Baki dibundarkan pada baris terakhir, jadi jumlahnya tepat 100.',
  'kpi.template.form.total': 'Jumlah: {total}%',
  'kpi.template.form.total.ok': 'Jumlah: {total}% — betul',
  'kpi.template.form.active': 'Aktif',
  'kpi.template.form.catalogueEmpty':
    'Katalog kompetensi masih kosong. Tambah kompetensi di Tetapan KPI › Kompetensi dahulu — borang dibina daripada katalog, bukan daripada teks bebas.',

  /**
   * Form faults, keyed exactly as the server emits them.
   *
   * `auditTemplateItems` returns `{ key, vars }` and the web resolves it here, so the banner is one
   * label rather than a sentence assembled on the screen. The refusal prose on a 409 is longer and
   * lives in the route: a banner names the problem, a refusal explains it.
   */
  'kpi.audit.noItems': 'Borang ini tiada kompetensi, jadi tiada apa untuk diberi markah.',
  'kpi.audit.weightOver':
    'Pemberat berjumlah {total}% — {difference}% terlebih. Dua orang hanya berada pada skala yang sama jika kedua-dua borang dibaca atas jumlah yang sama.',
  'kpi.audit.weightUnder':
    'Pemberat berjumlah {total}% — {difference}% terkurang. Dua orang hanya berada pada skala yang sama jika kedua-dua borang dibaca atas jumlah yang sama.',
  'kpi.audit.duplicateCompetency':
    '"{name}" disenaraikan lebih daripada sekali. Ia akan diberi pemberat dua kali dan terbaca sebagai dua soalan.',

  'kpi.period.title': 'Tempoh Penilaian',
  'kpi.period.subtitle':
    'Tarikh jatuh tempo ialah bila penilaian dijangka, bukan bila tempoh berakhir. Kitaran Januari–Jun biasanya dinilai pada Julai.',
  'kpi.period.status.open': 'Dibuka',
  'kpi.period.status.closed': 'Ditutup',
  'kpi.period.column.code': 'Kod',
  'kpi.period.column.name': 'Nama',
  'kpi.period.column.span': 'Tempoh Dinilai',
  'kpi.period.column.due': 'Jatuh Tempo',
  'kpi.period.column.assignments': 'Penilaian',
  'kpi.period.column.outstanding': 'Belum Hantar',
  'kpi.period.empty': 'Tiada tempoh penilaian.',
  'kpi.period.error.load': 'Senarai tempoh tidak dapat dimuatkan.',
  'kpi.period.action.new': 'Tempoh Baharu',
  'kpi.period.action.close': 'Tutup tempoh',
  'kpi.period.action.delete': 'Buang tempoh',
  /**
   * Why there is no draft state, stated on the screen.
   *
   * There was one, and every period sat in it until somebody remembered to press Open — a state
   * whose only behaviour was to refuse the thing the screen was for.
   */
  'kpi.period.note.forward':
    'Tempoh dicipta terus dibuka, dan bergerak ke hadapan sahaja: dibuka → ditutup. Tiada keadaan draf, kerana tempoh yang tidak boleh ditugaskan ialah baris yang tiada siapa boleh gunakan. Tempoh yang ditutup tidak dibuka semula: gred di dalamnya sudah dibaca, dan mungkin sudah memacu bonus.',
  'kpi.period.close.outstanding':
    '{count} penilaian belum dihantar. Menutup tempoh sekarang meninggalkan mereka tanpa gred secara kekal.',
  'kpi.period.close.confirm': 'Saya faham — tutup juga',
  'kpi.period.delete.hasAssignments':
    'Tempoh ini mengandungi {count} penilaian. Membuangnya akan membuang penilaian itu juga.',
  'kpi.period.form.title': 'Tempoh Penilaian',
  'kpi.period.form.code': 'Kod',
  'kpi.period.form.name': 'Nama',
  'kpi.period.form.from': 'Tempoh dinilai dari',
  'kpi.period.form.to': 'Hingga',
  'kpi.period.form.due': 'Penilaian jatuh tempo',
  'kpi.period.form.due.hint':
    'Selepas hujung tempoh — sebelum itu bermakna menilai kerja yang belum berlaku.',

  'kpi.assignment.title': 'Penugasan KPI',
  'kpi.assignment.subtitle':
    'Siapa dinilai, oleh siapa, atas borang yang mana. Seorang tidak boleh menilai dirinya sendiri, dan satu orang hanya boleh dinilai sekali dalam satu tempoh.',
  'kpi.assignment.status.pending': 'Belum Bermula',
  'kpi.assignment.status.inProgress': 'Sedang Dibuat',
  'kpi.assignment.status.submitted': 'Dihantar',
  'kpi.assignment.status.finalised': 'Dimuktamadkan',
  'kpi.assignment.column.period': 'Tempoh',
  'kpi.assignment.column.staff': 'Dinilai',
  'kpi.assignment.column.template': 'Borang',
  'kpi.assignment.column.progress': 'Kemajuan',
  'kpi.assignment.column.score': 'Markah',
  'kpi.assignment.column.grade': 'Gred',
  'kpi.assignment.progress': '{scored} drpd {total}',
  'kpi.assignment.empty': 'Tiada penugasan.',
  'kpi.assignment.error.load': 'Senarai penugasan tidak dapat dimuatkan.',
  'kpi.assignment.action.new': 'Tugaskan Penilaian',
  'kpi.assignment.action.open': 'Buka borang',
  'kpi.assignment.action.delete': 'Buang penugasan',
  'kpi.assignment.form.title': 'Penugasan KPI',
  'kpi.assignment.form.period': 'Tempoh',
  'kpi.assignment.form.staff': 'Staf dinilai (ID)',
  'kpi.assignment.form.template': 'Borang',
  'kpi.assignment.form.reviewer': 'Penilai',
  /**
   * One reviewer, and why.
   *
   * There was a second, and a level chain behind it, and both were removed. A chain says "anybody
   * holding level 2 may sign this"; the entire claim an appraisal makes is that a particular person
   * who observed the work signed it.
   */
  'kpi.assignment.form.reviewer.hint':
    'Seorang, dinamakan. Penilaian tiada rantaian aras kelulusan: ia disemak oleh orang yang dinamakan di sini, bukan oleh sesiapa yang memegang aras tertentu.',
  'kpi.assignment.note.snapshot':
    'Menugaskan penilaian menyalin soalan dan pemberat borang ke penilaian itu, di situ dan ketika itu. Menyunting borang selepas ini tidak mengubah penilaian yang sudah ditugaskan.',
  'kpi.assignment.note.oneReviewer':
    'Kebenaran skrin membenarkan seseorang mengisi penilaian; ia tidak menetapkan penilaian yang mana. Hanya penilai yang dinamakan pada penugasan boleh mengisi borangnya.',

  'kpi.review.title': 'Semakan Penilaian',
  'kpi.review.subtitle':
    'Setiap kompetensi diberi markah 0–100. Borang boleh disimpan separuh siap; kelengkapan disemak semasa hantar.',
  'kpi.review.filter.mine': 'Hanya penilaian saya',
  'kpi.review.filter.all': 'Semua penilaian',
  'kpi.review.form.title': 'Penilaian — {staffName}',
  'kpi.review.form.item': 'Kompetensi',
  'kpi.review.form.weight': 'Pemberat',
  'kpi.review.form.score': 'Markah (0–100)',
  'kpi.review.form.comment': 'Catatan',
  'kpi.review.form.running': 'Jumlah berpemberat: {total}%',
  'kpi.review.form.running.partial': 'Setakat dijawab: {total}% ({scored} drpd {total_items})',
  /**
   * Why the running total ignores what is not yet answered.
   *
   * Counting an unanswered line as zero would show a reviewer 12% after their first answer of 60 —
   * a figure that is not wrong so much as about a different question.
   */
  'kpi.review.form.running.hint':
    'Dikira atas kompetensi yang sudah dijawab sahaja. Baris yang belum dijawab tidak dikira sebagai sifar — jika tidak, jawapan pertama 60 akan memaparkan 12%.',
  'kpi.review.form.unanswered': 'Belum dijawab',
  'kpi.review.action.save': 'Simpan',
  'kpi.review.action.submit': 'Hantar',
  'kpi.review.action.reopen': 'Buka semula',
  'kpi.review.action.finalise': 'Muktamadkan',
  'kpi.review.saved': 'Markah disimpan.',
  'kpi.review.submitted': 'Dihantar: {total}% — gred {grade}.',
  'kpi.review.finalised': 'Penilaian dimuktamadkan.',
  'kpi.review.reopened': 'Penilaian dibuka semula.',
  'kpi.review.reopen.note': 'Sebab dibuka semula',
  'kpi.review.reopen.hint':
    'Markah dan gred dikosongkan, kerana memaparkan angka bagi penilaian yang sedang diubah akan mengelirukan. Jawapan yang sudah diisi kekal — penilai diminta melihat semula, bukan bermula dari kosong.',
  'kpi.review.note.reviewerOnly':
    'Hanya penilai yang ditugaskan boleh mengisi borang ini. Kebenaran skrin membenarkan mengisi penilaian; ia tidak menetapkan penilaian yang mana.',
  'kpi.review.note.locked': 'Penilaian yang dimuktamadkan tidak boleh diubah — ia rekod gred.',
  'kpi.review.note.snapshot':
    'Soalan dan pemberat pada borang ini ialah salinan yang diambil ketika penilaian ditugaskan. Ia tidak berubah walaupun borang asalnya disunting.',
  'kpi.review.incomplete':
    '{scored} drpd {total} kompetensi diberi markah. Kompetensi yang belum dijawab tercicir dari pengiraan, jadi menghantar sekarang mengira jumlah atas borang yang separuh dibaca.',

  'kpi.result.title': 'Keputusan KPI',
  'kpi.result.subtitle':
    'Gred yang sudah dimuktamadkan sahaja. Skrin berasingan dengan kebenaran berasingan: gred membawa bonus, dan yang boleh membacanya bukan yang boleh membuka semula penilaian di belakangnya.',
  'kpi.result.column.period': 'Tempoh',
  'kpi.result.column.staff': 'Staf',
  'kpi.result.column.department': 'Jabatan',
  'kpi.result.column.score': 'Markah',
  'kpi.result.column.grade': 'Gred',
  'kpi.result.column.bonus': 'Bonus',
  'kpi.result.column.finalised': 'Dimuktamadkan',
  'kpi.result.empty': 'Tiada keputusan dimuktamadkan.',
  'kpi.result.error.load': 'Keputusan tidak dapat dimuatkan.',
  'kpi.result.distribution': 'Sebaran gred',
  'kpi.result.filter.grade': 'Semua gred',
  'kpi.result.filter.period': 'Semua tempoh',
  /**
   * Bonus stated in months, and why it is not an amount.
   *
   * It was `bonusFactor` and the screen showed `1.5`, which states a multiplier without saying of
   * what, over what period. And it stays months here: the bonus is only money once a payroll period
   * freezes it onto a bonus row, so an amount on this screen would be a figure nothing has approved
   * that moves whenever the person's basic salary does.
   */
  'kpi.result.bonusMonths': '{months} bulan gaji asas',
  'kpi.result.bonusNone': 'Tiada bonus',
  'kpi.result.note.bonus':
    'Bonus dinyatakan dalam bulan gaji asas, bukan amaun. Ia menjadi wang hanya apabila tempoh payroll membekukannya ke baris bonus — sampai itu, amaun akan berubah setiap kali gaji asas orang itu berubah.',

  'kpi.grade.title': 'Tetapan KPI',
  'kpi.settings.tab.competencies': 'Kompetensi',
  'kpi.settings.tab.grades': 'Jalur Gred',
  /**
   * There is no approval-flow tab here, unlike the request modules.
   *
   * An appraisal moves through scoring rather than signatures, so no rung is ever waiting and a
   * chain would configure nothing.
   */
  'kpi.settings.note.noChain':
    'Modul ini tiada tab Aliran Kelulusan. Penilaian bergerak melalui pemarkahan, bukan tandatangan — tiada aras yang menunggu, jadi rantaian di sini tidak mengkonfigurasikan apa-apa.',
  'kpi.grade.subtitle':
    'Gred dan jalur markahnya. Jalur mesti melitupi 0–100 tepat sekali — jurang bermakna markah yang tidak mendapat gred sama sekali, dan tindihan bermakna markah sama mendapat gred berbeza bergantung susunan bacaan.',
  'kpi.grade.column.code': 'Gred',
  'kpi.grade.column.name': 'Nama',
  'kpi.grade.column.band': 'Jalur Markah',
  'kpi.grade.column.bonus': 'Bonus',
  'kpi.grade.band': '{min}% – {max}%',
  'kpi.grade.empty': 'Tiada gred dikonfigurasikan.',
  'kpi.grade.error.load': 'Gred tidak dapat dimuatkan.',
  'kpi.grade.action.add': 'Gred Baharu',
  'kpi.grade.action.edit': 'Ubah gred',
  'kpi.grade.action.remove': 'Buang gred',
  'kpi.grade.action.save': 'Simpan set gred',
  'kpi.grade.form.title': 'Jalur Gred',
  'kpi.grade.form.code': 'Kod',
  'kpi.grade.form.name': 'Nama',
  'kpi.grade.form.min': 'Minimum (%)',
  'kpi.grade.form.max': 'Maksimum (%)',
  'kpi.grade.form.bonus': 'Bonus (bulan gaji asas)',
  'kpi.grade.form.bonus.hint':
    'Kosongkan jika gred ini tidak membawa bonus. Siling {max} bulan ialah penjaga tersalah taip, bukan dasar — sifar tersasar menukar satu bulan menjadi sepuluh, dan ia hanya kelihatan selepas penyata gaji dijana.',
  'kpi.grade.form.color': 'Warna',
  'kpi.grade.form.color.hint':
    'Warna cip di belakang huruf gred. Gred dipandang sekilas, bukan dibaca — satu lajur A/B/C/D/E dalam satu warna memaksa seseorang mengiranya.',
  'kpi.grade.bonusMonths': '{months} bulan',
  'kpi.grade.bonusNone': 'Tiada',
  'kpi.grade.covered': 'Jalur melitupi 0–100 tanpa jurang atau tindihan.',
  'kpi.grade.saved': 'Gred disimpan.',
  'kpi.grade.faults': 'Jalur gred bermasalah',
  'kpi.grade.note.set':
    'Gred disimpan sebagai satu set kerana jalur hanya sah bersama. Menyimpan satu gred sahaja boleh meninggalkan jurang yang tidak kelihatan sampai seseorang cuba menghantar penilaian.',
  'kpi.grade.note.history':
    'Gred pada penilaian yang dimuktamadkan disimpan sebagai kod, bukan rujukan. Membuang gred tidak mengubah penilaian lampau — ia kekal menamakan gred yang diberikan kepadanya.',
  'kpi.grade.note.boundary':
    'Gred dicari dengan jalur tertinggi yang markahnya mencapai lantainya. Markah tepat pada sempadan mendapat gred yang lebih baik — jawapan yang sama pada setiap skrin, dan jawapan yang boleh dipertahankan dengan lisan.',

  /**
   * Band faults, keyed exactly as the server emits them.
   *
   * `auditBands` returns every fault rather than the first, because a banner that reveals its
   * second problem only after you fix the first is a banner that gets ignored.
   */
  'kpi.refuse.noBands': 'Sekurang-kurangnya satu jalur gred diperlukan.',
  'kpi.refuse.badBand': 'Gred {code} mempunyai nombor tidak sah.',
  'kpi.refuse.bandOrder': 'Gred {code}: markah minimum melebihi maksimum.',
  'kpi.refuse.bandRange': 'Gred {code} berada di luar 0–100.',
  'kpi.refuse.bandDuplicate': 'Kod gred "{code}" digunakan lebih daripada sekali.',
  'kpi.refuse.bandStart':
    'Jalur terendah bermula pada {lowest}%, bukan 0. Markah di bawah itu tidak mendapat gred sama sekali.',
  'kpi.refuse.bandEnd':
    'Jalur tertinggi berakhir pada {highest}%, bukan 100. Markah di atas itu tiada jalur yang memilikinya.',
  'kpi.refuse.bandOverlap':
    'Gred {first} dan {second} bertindih. Markah yang sama akan mendapat gred berbeza bergantung susunan bacaan.',
  'kpi.refuse.bandGap':
    'Jurang antara gred {first} dan {second}: markah {from}% hingga {to}% tidak mendapat gred.',

  // -------------------------------------------------------------------------
  // Pengambilan
  // -------------------------------------------------------------------------
  'recruit.posting.title': 'Iklan Jawatan',
  'recruit.posting.subtitle':
    'Iklan dicipta sebagai draf. Menerbitkan ialah tindakan berasingan, dan menutup bukan membuang — pemohon masih perlu menamakan iklan yang mereka pohon.',
  'recruit.posting.tab.list': 'Iklan',

  'recruit.posting.status.draft': 'Draf',
  'recruit.posting.status.published': 'Diterbitkan',
  'recruit.posting.status.closed': 'Ditutup',

  'recruit.posting.column.code': 'Kod',
  'recruit.posting.column.title': 'Jawatan',
  'recruit.posting.column.department': 'Jabatan',
  'recruit.posting.column.positions': 'Kekosongan',
  'recruit.posting.column.applicants': 'Pemohon',
  'recruit.posting.column.opened': 'Dibuka',
  'recruit.posting.column.closes': 'Tutup',

  'recruit.posting.filled': '{hired} drpd {positions}',
  'recruit.posting.empty': 'Tiada iklan jawatan.',
  'recruit.posting.error.load': 'Senarai iklan tidak dapat dimuatkan.',

  'recruit.posting.action.new': 'Iklan Baharu',
  'recruit.posting.action.publish': 'Terbitkan',
  'recruit.posting.action.close': 'Tutup iklan',
  'recruit.posting.action.edit': 'Ubah iklan',
  'recruit.posting.action.delete': 'Buang iklan',
  'recruit.posting.action.view': 'Lihat',

  'recruit.posting.note.forward':
    'Kitaran hayat iklan bergerak ke hadapan sahaja: draf → diterbitkan → ditutup. Iklan yang ditutup tidak dibuka semula, kerana itu akan memanjangkan tarikh tutup yang sebahagian calon sudah diberitahu telah berlalu.',
  'recruit.posting.note.locked':
    'Iklan yang ditutup tidak boleh disunting — calon memohon berdasarkan apa yang tertulis padanya.',

  'recruit.posting.form.title': 'Iklan Jawatan',
  'recruit.posting.form.code': 'Kod iklan',
  'recruit.posting.form.code.hint': 'Pendek dan tetap — ini yang calon sebut di telefon.',
  'recruit.posting.form.jobTitle': 'Jawatan',
  'recruit.posting.form.department': 'Jabatan',
  'recruit.posting.form.location': 'Lokasi',
  'recruit.posting.form.positions': 'Bilangan kekosongan',
  'recruit.posting.form.employmentType': 'Jenis pekerjaan',
  'recruit.posting.form.salaryMin': 'Gaji minimum (RM)',
  'recruit.posting.form.salaryMax': 'Gaji maksimum (RM)',
  'recruit.posting.form.salary.hint': 'Kosongkan kedua-duanya jika julat tidak diiklankan.',
  'recruit.posting.form.openedOn': 'Tarikh buka',
  'recruit.posting.form.closesOn': 'Tarikh tutup',
  'recruit.posting.form.closesOn.hint': 'Kosongkan untuk iklan tanpa tarikh tutup.',
  'recruit.posting.form.summary': 'Ringkasan tugas',
  'recruit.posting.form.requirements': 'Kelayakan',

  'recruit.employment.permanent': 'Tetap',
  'recruit.employment.contract': 'Kontrak',
  'recruit.employment.temporary': 'Sementara',
  'recruit.employment.internship': 'Latihan Industri',

  'recruit.applicant.title': 'Pemohon',
  'recruit.applicant.subtitle':
    'Calon ialah orang luar, bukan staf — mereka tiada no. pekerja, jabatan atau kehadiran. Mengambil seorang mencipta rekod staf daripada data yang sudah ada di sini.',

  'recruit.applicant.status.new': 'Baharu',
  'recruit.applicant.status.screening': 'Saringan',
  'recruit.applicant.status.interview': 'Temuduga',
  'recruit.applicant.status.offered': 'Ditawarkan',
  'recruit.applicant.status.hired': 'Diambil',
  'recruit.applicant.status.rejected': 'Tidak Berjaya',
  'recruit.applicant.status.withdrawn': 'Tarik Diri',

  'recruit.applicant.column.applicantNo': 'No. Pemohon',
  'recruit.applicant.column.name': 'Nama',
  'recruit.applicant.column.posting': 'Iklan',
  'recruit.applicant.column.contact': 'Hubungan',
  'recruit.applicant.column.interview': 'Temuduga',
  'recruit.applicant.column.staff': 'Rekod Staf',

  'recruit.applicant.empty': 'Tiada pemohon.',
  'recruit.applicant.error.load': 'Senarai pemohon tidak dapat dimuatkan.',
  'recruit.applicant.action.new': 'Rekod Pemohon',
  'recruit.applicant.action.advance': 'Gerakkan peringkat',
  'recruit.applicant.action.hire': 'Ambil sebagai staf',
  'recruit.applicant.action.delete': 'Buang pemohon',
  'recruit.applicant.action.view': 'Lihat',

  'recruit.applicant.note.offer':
    'Tawaran dibuat melalui aliran kelulusan, bukan dengan menukar peringkat. Sehingga aras terakhir menandatangani, calon kekal pada peringkat temuduga — memberitahu mereka "ditawarkan" sebelum itu ialah tawaran yang belum dibuat.',
  'recruit.applicant.note.delete':
    'Membuang pemohon memadamkan data peribadi orang luar terus, bersama jejak keputusannya. Ia tidak boleh dibatalkan.',
  'recruit.applicant.note.hired':
    'Rekod staf dicipta sebagai TIDAK AKTIF. Aktifkannya selepas mendaftarkan biometrik pada terminal — staf aktif yang tidak boleh scan dilaporkan tidak hadir dari hari pertama.',

  'recruit.applicant.form.title': 'Rekod Pemohon',
  'recruit.applicant.form.posting': 'Iklan',
  'recruit.applicant.form.posting.hint': 'Hanya iklan yang diterbitkan menerima permohonan.',
  'recruit.applicant.form.fullName': 'Nama penuh',
  'recruit.applicant.form.icNo': 'No. kad pengenalan',
  'recruit.applicant.form.icNo.hint': 'Tidak wajib semasa memohon, tetapi wajib sebelum diambil.',
  'recruit.applicant.form.email': 'Emel',
  'recruit.applicant.form.phone': 'Telefon',
  'recruit.applicant.form.coverNote': 'Nota permohonan',

  'recruit.advance.title': 'Gerakkan {applicantNo}',
  'recruit.advance.description':
    'Hanya peringkat yang saluran benarkan dipaparkan. Ditolak dan tarik diri adalah keadaan akhir.',
  'recruit.advance.status': 'Peringkat baharu',
  'recruit.advance.interviewAt': 'Tarikh dan masa temuduga',
  'recruit.advance.note': 'Catatan',
  'recruit.advance.note.required': 'Penolakan memerlukan sebab bertulis.',

  'recruit.decide.title': 'Keputusan tawaran — {applicantNo}',
  'recruit.decide.description':
    'Meluluskan bermakna menawarkan jawatan. Kekosongan disemak dahulu, kerana menawarkan jawatan yang sudah penuh ialah janji yang seseorang perlu tarik balik.',
  'recruit.decide.approve': 'Luluskan tawaran',
  'recruit.decide.reject': 'Tolak',

  'recruit.hire.title': 'Ambil {name} sebagai staf',
  'recruit.hire.description':
    'Nama, no. KP, emel dan telefon dibawa dari permohonan. No. pekerja anda bekalkan — ia kunci ke setiap terminal dan mesti sepadan dengan penomboran organisasi.',
  'recruit.hire.employeeNo': 'No. pekerja',
  'recruit.hire.hireDate': 'Tarikh mula kerja',
  'recruit.hire.position': 'Jawatan',
  'recruit.hire.position.hint': 'Kosongkan untuk menggunakan tajuk iklan.',
  'recruit.hire.department': 'Jabatan',
  'recruit.hire.location': 'Lokasi',
  'recruit.hire.submit': 'Cipta rekod staf',
  'recruit.hire.done': '{name} dicipta sebagai staf {employeeNo}, tidak aktif.',

  'recruit.archive.title': 'Arkib Pengambilan',
  'recruit.archive.subtitle':
    'Iklan yang sudah ditutup berserta pemohonnya, disimpan berasingan supaya senarai aktif kekal boleh dibaca.',
  'recruit.archive.tab.postings': 'Iklan Ditutup',
  'recruit.archive.tab.applicants': 'Pemohon',

  /**
   * Headings for the four request-module settings screens.
   *
   * Each says who signs and who is told, because that is what all four hold beyond their own
   * master data — and it is the sentence that distinguishes this screen from the list it was
   * split out of.
   */
  'leave.settings.title': 'Tetapan Cuti',
  'leave.settings.subtitle':
    'Jenis cuti, siapa meluluskan permohonan, dan siapa diberitahu keputusannya.',
  'claim.settings.title': 'Tetapan Tuntutan',
  'claim.settings.subtitle':
    'Jenis tuntutan, siapa meluluskannya, dan siapa diberitahu keputusannya.',
  'overtime.settings.title': 'Tetapan Lebih Masa',
  'overtime.settings.subtitle':
    'Kadar yang mengalikan jam bekerja, siapa meluluskan permohonan, dan siapa diberitahu keputusannya.',
  'expense.settings.title': 'Tetapan Perbelanjaan',
  'expense.settings.subtitle':
    'Kategori perbelanjaan, siapa meluluskannya, dan siapa diberitahu keputusannya.',

  'recruit.settings.title': 'Tetapan Pengambilan',
  'recruit.settings.subtitle':
    'Siapa menandatangani tawaran, dan apa yang calon diberitahu. Perkataannya penting di sini — penerima ialah orang luar, bukan staf.',

  // -------------------------------------------------------------------------
  // Permohonan › Perbelanjaan
  // -------------------------------------------------------------------------
  'expense.title': 'Permohonan Perbelanjaan',
  'expense.subtitle':
    'Wang yang staf keluarkan sendiri dan tuntut balik. Tiada kadar di sini — resit itulah asas jumlahnya, jadi ia tidak pernah pilihan.',

  'expense.tab.requests': 'Perbelanjaan',
  'expense.tab.categories': 'Kategori',

  'expense.column.requestNo': 'No. Permohonan',
  'expense.column.payee': 'Dibayar Kepada',
  'expense.column.category': 'Kategori',

  'expense.empty': 'Tiada permohonan perbelanjaan dalam julat ini.',
  'expense.error.load': 'Senarai perbelanjaan tidak dapat dimuatkan.',
  'expense.action.new': 'Rekod Perbelanjaan',

  'expense.note.receipt':
    'Perbelanjaan tidak boleh diluluskan tanpa resit. Ia boleh difailkan dahulu, kemudian resit dilampirkan — muat naik yang gagal tidak patut membuang segala yang sudah ditaip.',

  'expense.new.title': 'Rekod Perbelanjaan',
  'expense.new.description': 'Jumlah diambil dari resit. Lampirkan resit selepas dihantar.',
  'expense.new.category': 'Kategori',
  'expense.new.payee': 'Dibayar kepada',
  'expense.new.payee.hint': 'Resit tanpa nama penerima sukar disemak terhadap penyata bank.',

  'expense.decide.noReceipt':
    'Tiada resit dilampirkan. Perbelanjaan tidak boleh diluluskan tanpanya — resit itulah asas jumlahnya.',

  'expense.categories.title': 'Kategori Perbelanjaan',
  'expense.categories.subtitle':
    'Had per permohonan sahaja. Tiada kadar — kategori perbelanjaan mengelaskan kos, ia tidak menetapkan harganya.',
  'expense.categories.empty': 'Tiada kategori dikonfigurasikan.',
  'expense.categories.action.new': 'Tambah Kategori',
  'expense.categories.form.title': 'Kategori Perbelanjaan',

  // -------------------------------------------------------------------------
  // Permohonan › Tuntutan
  // -------------------------------------------------------------------------
  'claim.title': 'Permohonan Tuntutan',
  'claim.subtitle':
    'Kategori berkadar mengira jumlahnya sendiri daripada kuantiti — kadar itulah kawalannya. Kategori rata mengambil angka dari resit.',

  'claim.tab.requests': 'Tuntutan',
  'claim.tab.types': 'Jenis Tuntutan',

  'claim.status.pending': 'Menunggu',
  'claim.status.approved': 'Diluluskan',
  'claim.status.rejected': 'Ditolak',
  'claim.status.cancelled': 'Ditarik',

  'claim.column.requestNo': 'No. Tuntutan',
  'claim.column.staff': 'Staf',
  'claim.column.type': 'Jenis',
  'claim.column.incurredOn': 'Tarikh Kos',
  'claim.column.amount': 'Dituntut',
  'claim.column.approved': 'Diluluskan',
  'claim.column.receipt': 'Resit',
  'claim.column.items': 'Baris',

  'claim.empty': 'Tiada tuntutan dalam julat ini.',
  'claim.error.load': 'Senarai tuntutan tidak dapat dimuatkan.',

  'claim.action.new': 'Rekod Tuntutan',
  'claim.action.view': 'Lihat',
  'claim.action.cancel': 'Tarik',

  'claim.receipt.present': 'Ada',
  'claim.receipt.missing': 'Tiada',
  /*
    Kiraan, bukan pautan. Resit kini bergantung pada baris, jadi satu sel tidak boleh membuka "resit
    itu" — dan apa yang pelulus perlukan dari lajur itu ialah sama ada ada lagi yang tertunggak.
  */
  'claim.receipt.allPresent': '{count} resit',
  'claim.receipt.someMissing': '{missing} daripada {count} tiada resit',
  'claim.receipt.removed': 'Resit baris itu dibuang.',
  /*
    Tiada `claim.receipt.required` lagi. Ia teks lencana ambar dalam lajur Resit jadual jenis, di
    mana "wajib" menyerlah dan "tidak wajib" hilang jadi sembilan baris terbaca sebagai satu nilai
    dan lapan kosong. Lajur itu kini `BoolMark`, dan faktanya hidup dalam `claim.types.receipt.yes`
    yang menyatakan sepenuhnya: 'Resit diperlukan pada setiap baris'.
  */
  'claim.receipt.open': 'Buka resit',
  'claim.receipt.upload': 'Muat naik resit',
  'claim.receipt.remove': 'Buang resit',
  'claim.receipt.hint':
    'PDF, PNG, JPEG atau WEBP, maksimum 4 MB. Jenis fail ditentukan dari baitnya, bukan dari namanya.',
  'claim.receipt.locked':
    'Resit tidak boleh ditukar selepas keputusan — ia bukti yang keputusan itu dibuat terhadapnya.',
  'claim.receipt.uploaded': 'Resit dimuat naik.',

  'claim.note.receipt':
    'Kategori yang memerlukan resit tidak boleh diluluskan tanpa satu. Tuntutan boleh difailkan dahulu, kemudian resit dilampirkan — muat naik yang gagal tidak patut membuang segala yang sudah ditaip.',
  'claim.note.notPaid':
    'Diluluskan bukan bermakna dibayar. Tiada apa dalam sistem ini membayar lagi.',

  'claim.new.title': 'Rekod Tuntutan',
  'claim.new.description':
    'Pilih jenis dahulu — kategori berkadar akan meminta kuantiti, bukan jumlah.',
  'claim.new.staff': 'Staf (ID)',
  'claim.new.type': 'Jenis tuntutan',
  'claim.new.incurredOn': 'Tarikh kos ditanggung',
  'claim.new.quantity': 'Kuantiti ({unit})',
  'claim.new.quantity.hint': 'Jumlah dikira: {amount}',
  'claim.new.amount': 'Jumlah (RM)',
  'claim.new.detail': 'Keterangan',
  'claim.new.detail.hint': 'Untuk apa tuntutan ini secara keseluruhan. Setiap baris menerangkan dirinya sendiri.',
  'claim.new.staff.hint': 'Taip nama atau no. staf. Senarai ditapis di pelayan.',
  'claim.new.incurredOn.hint': 'Tarikh tuntutan difailkan. Setiap baris membawa tarikh kosnya sendiri.',
  'claim.new.remarks.hint': 'Butiran praktikal — no. pesanan, nama projek. Pilihan.',

  /*
    Satu tuntutan, beberapa baris, satu hantar.
    Seminggu perjalanan ialah empat tol, dua parkir dan satu hotel — setiap satu tarikh berbeza dan
    kertas berbeza. Memfailkannya sebagai tuntutan berasingan bermakna empat nombor permohonan dan
    empat pusingan rantaian kelulusan untuk satu perjalanan.
  */
  'claim.new.items': 'Baris Tuntutan',
  'claim.new.items.hint': 'Satu baris satu kos. Tambah seberapa banyak yang perlu, sehingga 50.',
  'claim.new.items.receiptHint':
    'Satu baris satu kos, dan kategori ini memerlukan resit pada SETIAP baris sebelum tuntutan boleh diluluskan.',
  'claim.new.items.add': 'Tambah Baris',
  'claim.new.items.row': 'Baris {index}',
  'claim.new.items.remove': 'Buang baris ini',
  'claim.new.items.lastRow': 'Tuntutan perlukan sekurang-kurangnya satu baris',
  'claim.new.items.date': 'Tarikh',
  'claim.new.items.description': 'Keterangan baris',
  'claim.new.items.description.placeholder': 'cth. Tol Kanowit–Sibu',
  'claim.new.items.category': 'Kategori',
  'claim.new.items.category.placeholder': 'Pilihan',
  /*
    Resit dipilih semasa menaip, dimuat naik selepas baris itu wujud.

    Input fail memegang pemegang kepada sesuatu pada cakera pengguna, bukan nilai dalam borang — jadi
    ia tidak boleh dihantar bersama JSON tuntutan. Borang menyimpan fail itu, menghantar tuntutan,
    kemudian memuat naik satu per baris. Perkataan di sini mesti menyatakan urutan itu, sebab
    'Lampirkan' yang tidak memuat naik apa-apa sampai Hantar ditekan adalah kawalan yang menipu.
  */
  'claim.new.items.receipt': 'Resit',
  'claim.new.items.receipt.attach': 'Pilih fail resit',
  'claim.new.items.receipt.replace': 'Tukar fail',
  'claim.new.items.receipt.clear': 'Buang fail yang dipilih',
  'claim.new.items.receipt.none': 'Belum ada fail dipilih',
  'claim.new.items.receipt.pending': 'Akan dimuat naik selepas hantar',
  'claim.new.items.receipt.formats': 'PDF, PNG, JPEG atau WEBP, maksimum 4 MB.',
  'claim.new.items.receipt.tooBig': '{name} melebihi 4 MB. Pilih fail yang lebih kecil.',
  'claim.new.uploaded': '{count} resit dilampirkan.',
  'claim.new.uploadFailed':
    '{count} resit gagal dimuat naik. Tuntutan sudah direkodkan — lampirkan semula dari senarai.',

  'claim.new.total': 'Jumlah Keseluruhan',
  'claim.new.total.overCap':
    'Melebihi had kategori {cap}. Had itu dikenakan pada jumlah tuntutan, bukan setiap baris — pelayan akan menolaknya.',
  'claim.new.submit': 'Hantar',
  'claim.new.cap': 'Had kategori ini: {cap}',
  'claim.new.receiptNext':
    'Selepas dihantar, lampirkan resit pada baris tuntutan itu. Tanpa resit ia tidak boleh diluluskan.',

  'claim.decide.title': 'Putuskan {requestNo}',
  'claim.decide.description':
    'Meluluskan boleh dengan jumlah yang lebih rendah — resit melebihi had kategori diluluskan pada had itu.',
  'claim.decide.claimed': 'Dituntut',
  'claim.decide.approvedAmount': 'Jumlah diluluskan (RM)',
  'claim.decide.approvedAmount.hint':
    'Biarkan sama untuk meluluskan penuh. Lebih rendah bermakna sebahagian tidak dibenarkan, dan catatan patut menyatakan sebabnya.',
  'claim.decide.note': 'Catatan',
  'claim.decide.noteRequired': 'Penolakan memerlukan sebab bertulis.',
  'claim.decide.approve': 'Luluskan',
  'claim.decide.reject': 'Tolak',
  'claim.decide.noReceipt':
    'Kategori ini memerlukan resit dan tiada resit dilampirkan. Kelulusan akan ditolak.',

  /*
    Kiraan dalam tajuk, sama bentuk dengan '6 jenis cuti'.
    `claim.types.title` dibuang: tab di atasnya sudah bernama Jenis Tuntutan.
  */
  'claim.types.count': '{count} jenis tuntutan',
  'claim.types.subtitle':
    'Kadar per unit menjadikan kategori itu berkadar: pemohon memasukkan kuantiti dan pelayan mengira jumlahnya. Biarkan kosong untuk kategori yang mengambil angka dari resit.',
  'claim.types.column.code': 'Kod',
  'claim.types.column.name': 'Nama',
  'claim.types.column.rate': 'Kadar',
  'claim.types.column.cap': 'Had',
  'claim.types.column.receipt': 'Resit',
  'claim.types.column.approval': 'Perlu kelulusan',

  /*
    Nama bagi tanda, bukan perkataan dalam sel. Setiap satu menyebut lajur mana yang dijawab —
    sel yang melaporkan 'tidak' bersendirian tidak memberitahu apa yang dinafikan.
  */
  'claim.types.receipt.yes': 'Resit diperlukan pada setiap baris',
  'claim.types.receipt.no': 'Resit tidak diperlukan',
  'claim.types.approval.yes': 'Perlukan kelulusan',
  'claim.types.approval.auto': 'Direkod lulus semasa dihantar',
  'claim.types.column.used': 'Digunakan',
  'claim.types.flat': 'Rata',
  'claim.types.empty': 'Tiada jenis tuntutan dikonfigurasikan.',
  'claim.types.action.new': 'Tambah Jenis',
  'claim.types.form.title': 'Jenis Tuntutan',
  'claim.types.form.code': 'Kod',
  'claim.types.form.name': 'Nama',
  'claim.types.form.description': 'Keterangan',
  'claim.types.form.rate': 'Kadar per unit (RM)',
  'claim.types.form.rate.hint': 'Kosongkan untuk kategori rata.',
  'claim.types.form.unit': 'Nama unit',
  'claim.types.form.unit.hint': 'km, hari, malam. Wajib apabila ada kadar.',
  'claim.types.form.cap': 'Had per tuntutan (RM)',
  'claim.types.form.cap.hint': 'Kosongkan untuk tiada had.',
  'claim.types.form.description.hint':
    'Dipaparkan kepada staf pada borang tuntutan, dan di bawah nama dalam senarai ini.',
  'claim.types.form.requiresReceipt': 'Perlukan resit',
  'claim.types.form.requiresReceipt.hint':
    'Tuntutan tanpa resit tidak boleh diluluskan. Disemak semasa kelulusan, bukan semasa dihantar — supaya borang boleh disimpan dahulu dan resit dilampirkan kemudian.',
  'claim.types.form.requiresApproval': 'Perlukan kelulusan',
  'claim.types.form.requiresApproval.hint':
    'Jika dimatikan, tuntutan direkodkan sebagai lulus semasa dihantar. Ia tetap BELUM dibayar — pembayaran direkodkan berasingan sama ada cara pun.',
  'claim.types.form.active': 'Aktif',

  // -------------------------------------------------------------------------
  // Permohonan › Lebih Masa
  // -------------------------------------------------------------------------
  'overtime.title': 'Permohonan Lebih Masa',
  'overtime.subtitle':
    'Jam datang dari scan yang enjin kehadiran sudah ukur, bukan dari nombor yang ditaip. Soalan yang penyemak jawab ialah sama ada ia dibenarkan, bukan sama ada ia berlaku.',

  'overtime.tab.requests': 'Permohonan',
  'overtime.tab.rates': 'Kadar',

  'overtime.dayType.weekday': 'Hari bekerja biasa',
  'overtime.dayType.restDay': 'Hari rehat',
  'overtime.dayType.holiday': 'Kelepasan am',
  'overtime.dayType.holidayRestDay': 'Kelepasan am pada hari rehat',

  'overtime.status.pending': 'Menunggu',
  'overtime.status.approved': 'Diluluskan',
  'overtime.status.rejected': 'Ditolak',
  'overtime.status.cancelled': 'Ditarik',

  'overtime.column.requestNo': 'No. Permohonan',
  'overtime.column.staff': 'Staf',
  'overtime.column.workDate': 'Tarikh Kerja',
  'overtime.column.dayType': 'Jenis Hari',
  'overtime.column.hours': 'Jam',
  'overtime.column.rate': 'Kadar',
  'overtime.column.amount': 'Jumlah',

  /** The claimed figure beside what the engine measured, so the gap is readable. */
  'overtime.hours.claimed': '{claimed} drpd {measured}',
  'overtime.hours.measuredNote': 'Diukur dari scan: {hours} jam',

  'overtime.empty': 'Tiada permohonan lebih masa dalam julat ini.',
  'overtime.error.load': 'Senarai permohonan lebih masa tidak dapat dimuatkan.',

  'overtime.action.new': 'Rekod Lebih Masa',
  'overtime.action.cancel': 'Tarik',
  'overtime.action.view': 'Lihat',

  'overtime.note.notPaid':
    'Diluluskan bukan bermakna dibayar. Tiada apa dalam sistem ini membayar lagi, jadi pembayaran direkodkan di luar dan tempoh payroll akan memakan permohonan yang diluluskan apabila ia dibina.',
  'overtime.note.cap':
    'Lebih masa dihadkan 104 jam sebulan di bawah Peraturan Kerja (Pembatasan Kerja Lebih Masa) 1980. Permohonan yang menunggu dikira terhadap had itu, jika tidak sedozen permohonan berasingan akan melepasinya satu demi satu.',

  // Dialog: rekod baharu
  'overtime.new.title': 'Rekod Lebih Masa',
  'overtime.new.description':
    'Pilih staf dan tarikh dahulu. Jam yang boleh dituntut datang dari ukuran enjin untuk hari itu.',
  'overtime.new.staff': 'Staf',
  'overtime.new.staffPlaceholder': 'Cari nama atau no. pekerja',
  'overtime.new.workDate': 'Tarikh kerja',
  'overtime.new.minutes': 'Minit dituntut',
  'overtime.new.minutesHint':
    'Boleh kurang daripada yang diukur apabila hanya sebahagian dibenarkan. Tidak boleh lebih.',
  'overtime.new.task': 'Tugas atau projek',
  'overtime.new.reason': 'Sebab',
  'overtime.new.submit': 'Hantar',

  'overtime.quote.heading': 'Hari itu',
  'overtime.quote.measured': 'Diukur dari scan',
  'overtime.quote.hourlyRate': 'Kadar sejam',
  'overtime.quote.hourlyRateHint': 'Gaji bulanan ÷ 26 ÷ 8, seperti s.60I Akta Kerja 1955.',
  'overtime.quote.multiplier': 'Pengganda',
  'overtime.quote.estimate': 'Anggaran',
  'overtime.quote.estimateHint': 'Anggaran sahaja. Penyemak yang mengesahkan kadar.',
  'overtime.quote.monthUsed': 'Bulan ini',
  'overtime.quote.monthUsedValue': '{used} drpd {cap} jam',
  'overtime.quote.noneMeasured':
    'Tiada lebih masa diukur pada tarikh itu, jadi tiada apa untuk dituntut.',
  'overtime.quote.noSalary':
    'Staf ini tiada gaji bulanan direkodkan. Kadar sejam dikira daripadanya, jadi permohonan tidak boleh dihargakan.',
  'overtime.quote.statutoryFloor':
    'Tiada kadar dikonfigurasikan untuk jenis hari itu, jadi minimum statutori digunakan sementara.',
  'overtime.quote.holiday': 'Kelepasan am: {name}',

  // Dialog: keputusan
  'overtime.decide.title': 'Putuskan {requestNo}',
  'overtime.decide.description':
    'Meluluskan menetapkan jumlah yang perlu dibayar, kerana meluluskan ialah bila kadar dipilih.',
  'overtime.decide.ratePlaceholder': 'Pilih kadar',
  'overtime.decide.note': 'Catatan',
  'overtime.decide.noteRequired': 'Penolakan memerlukan sebab bertulis.',
  'overtime.decide.approve': 'Luluskan',
  'overtime.decide.reject': 'Tolak',
  'overtime.decide.willPay': 'Akan dibayar: {amount}',
  'overtime.decide.mismatch':
    'Kadar yang dipilih bukan untuk jenis hari itu. Ia dibenarkan, tetapi patut disengajakan.',

  // Tab kadar
  'overtime.rates.title': 'Kadar Lebih Masa',
  'overtime.rates.subtitle':
    'Satu kadar per jenis hari memberi jawapan lalai. Jenis hari bukan hiasan — kadar dicari dengannya, jadi kadar tanpa jenis hari yang betul akan senyap membayar hari kelepasan pada kadar hari biasa.',
  'overtime.rates.column.code': 'Kod',
  'overtime.rates.column.name': 'Nama',
  'overtime.rates.column.dayType': 'Jenis Hari',
  'overtime.rates.column.multiplier': 'Pengganda',
  'overtime.rates.column.used': 'Digunakan',
  'overtime.rates.default': 'Lalai',
  'overtime.rates.empty': 'Tiada kadar dikonfigurasikan.',
  'overtime.rates.shortfall': '{actual}× di bawah minimum {floor}×',
  'overtime.rates.shortfallNote':
    'Kadar di bawah minimum Akta Kerja dinyatakan dan tidak dihalang. Organisasi yang benar-benar membayar kurang mesti boleh merekodkan apa yang dibayarnya — skrin yang berdiam ialah cara kekurangan itu sampai ke penyata gaji.',
  'overtime.rates.action.new': 'Tambah Kadar',
  'overtime.rates.form.title': 'Kadar Lebih Masa',
  'overtime.rates.form.code': 'Kod',
  'overtime.rates.form.name': 'Nama',
  'overtime.rates.form.description': 'Keterangan',
  'overtime.rates.form.dayType': 'Jenis hari',
  'overtime.rates.form.multiplier': 'Pengganda',
  'overtime.rates.form.isDefault': 'Kadar lalai untuk jenis hari ini',
  'overtime.rates.form.active': 'Aktif',
  'overtime.rates.form.floorHint': 'Minimum statutori untuk jenis hari ini ialah {floor}×.',

  // -------------------------------------------------------------------------
  // Tetapan › Peranan
  // -------------------------------------------------------------------------
  'roles.title': 'Pengurusan Peranan',
  'roles.subtitle': 'Urus peranan pengguna dan kebenaran aksesnya.',
  'roles.section.title': 'Peranan',
  'roles.section.subtitle':
    'Setiap akaun memegang satu peranan. Peranan itulah yang menentukan apa boleh dilihat dan apa boleh diubah.',
  'roles.action.new': 'Peranan Baharu',

  /** Shown as a chip and as a row badge; one label because it is the same state. */

  'roles.search': 'Cari nama atau keterangan peranan…',
  'roles.empty': 'Tiada peranan sepadan dengan penapis ini.',
  'roles.error.load': 'Gagal memuatkan peranan',
  'roles.error.remove': 'Gagal membuang peranan',
  'roles.notice.removed': 'Peranan "{name}" dibuang.',

  /**
   * The lead clause is bold, so it arrives as a var holding a node rather than as a
   * separate label. Split in two, a translator cannot move the emphasis to whichever
   * clause carries the weight in their language.
   */
  'roles.note.immutable':
    '{emphasis} Tiada peranan — termasuk Super Admin — boleh diberi kebenaran mengubahnya. Ia adalah bukti apabila rekod kehadiran dipertikaikan, jadi keupayaan itu tidak wujud dalam sistem.',
  'roles.note.immutable.emphasis': 'Log Scan Mentah dan Log Audit hanya boleh dibaca.',

  'roles.column.name': 'Nama peranan',
  'roles.column.description': 'Keterangan',
  'roles.column.accounts': 'Pengguna',
  'roles.column.permissions': 'Kebenaran',

  'roles.badge.system': 'Sistem',
  'roles.row.view': 'Lihat matrix kebenaran',
  'roles.row.edit': 'Ubah peranan',
  'roles.row.remove': 'Buang peranan',
  'roles.row.locked': '{count} akaun masih menggunakannya',
  'roles.row.expand': 'ringkasan kebenaran',
  'roles.coverage.aria': '{granted} daripada {total} kebenaran diberikan',

  'roles.detail.systemRole': 'Peranan sistem',
  'roles.detail.systemRole.yes': 'Ya',
  'roles.detail.systemRole.no': 'Tidak',
  'roles.detail.accounts': 'Akaun memegangnya',
  'roles.detail.permissions': 'Kebenaran',
  'roles.detail.permissions.value': '{granted} daripada {total}',
  'roles.detail.updated': 'Dikemas kini',
  'roles.detail.id': 'ID peranan',
  'roles.detail.coverage': 'Liputan per seksyen',
  'roles.viewOnly.heading': 'Boleh lihat tetapi tidak boleh ubah ({count})',

  'roles.remove.title': 'Buang peranan "{name}"?',
  'roles.remove.blocked':
    '{count} akaun masih menggunakan peranan ini. Permintaan akan ditolak — tukar akaun tersebut ke peranan lain dahulu.',
  'roles.remove.safe': 'Tiada akaun menggunakan peranan ini, jadi ia selamat dibuang.',

  // -------------------------------------------------------------------------
  // Tetapan › Peranan › Editor matrix
  // -------------------------------------------------------------------------
  'roles.editor.heading.view': 'Kebenaran: {name}',
  'roles.editor.heading.edit': 'Ubah Peranan: {name}',
  'roles.editor.subtitle.view': 'Paparan sahaja. Gunakan ikon pensel pada senarai untuk mengubah.',
  'roles.editor.subtitle.edit': 'Tetapkan nama peranan dan matrix kebenarannya.',
  'roles.editor.error.notFound': 'Peranan tidak dijumpai.',
  'roles.editor.error.load': 'Gagal memuatkan matrix',
  'roles.editor.error.save': 'Gagal menyimpan peranan',
  'roles.editor.back': 'Kembali',
  'roles.editor.back.aria': 'Kembali ke senarai peranan',

  'roles.editor.clearAll': 'Kosongkan Semua',
  'roles.editor.selectAll': 'Pilih Semua',
  'roles.editor.save': 'Simpan Peranan',

  'roles.editor.details': 'Butiran peranan',
  'roles.editor.affected': '{count} akaun terjejas',
  'roles.editor.name': 'Nama peranan *',
  'roles.editor.name.placeholder': 'cth. Kerani Wad, Penyelia HR',
  'roles.editor.name.locked':
    'Nama peranan sistem tidak boleh ditukar — proses lain merujuknya.',
  'roles.editor.description': 'Keterangan (pilihan)',
  'roles.editor.description.placeholder': 'Ringkasan pendek peranan ini',
  'roles.editor.status': 'Status',
  'roles.editor.status.warning': 'Akaun yang memegang peranan ini tidak akan boleh log masuk.',

  'roles.editor.matrix.title': 'Matrix Kebenaran',
  'roles.editor.matrix.subtitle':
    'Tanda kebenaran bagi setiap skrin. — bermaksud tindakan itu tidak berkenaan. Lajur selepas pembahagi adalah tindakan khusus skrin.',
  'roles.editor.matrix.granted': '{granted} / {total} diberikan',
  'roles.editor.matrix.caption':
    'Matrix kebenaran: satu baris setiap skrin, satu lajur setiap tindakan',
  'roles.editor.matrix.column.screen': 'Skrin',
  'roles.editor.matrix.column.others': 'Lain-lain',
  'roles.editor.matrix.column.fullRow': 'Baris penuh',

  'roles.editor.section.clear': 'Kosongkan seksyen',
  'roles.editor.section.select': 'Pilih seksyen',
  'roles.editor.section.progress': '({granted}/{total})',
  'roles.editor.screen.planned': 'Belum dibina',
  /** Ticked by action and by screen, so the checkbox has to name both. */
  'roles.editor.checkbox.aria': '{action} — {screen}',
  'roles.editor.notApplicable': 'Tidak berkenaan',
  'roles.editor.noCustom': 'Tiada tindakan khusus',
  'roles.editor.row.clear': 'Kosongkan',
  'roles.editor.row.all': 'Semua',

  'roles.editor.fullAccess':
    'Peranan ini akan mempunyai akses penuh, sama seperti Super Admin. Setiap akaun yang memegangnya boleh mengubah kehadiran dan gaji ribuan orang.',
  'roles.editor.hint':
    'Kebenaran dikuatkuasakan pada pelayan bagi setiap permintaan, bukan hanya dengan menyembunyikan menu.',

  // -------------------------------------------------------------------------
  // Tetapan › Konfigurasi Umum
  // -------------------------------------------------------------------------
  'settings.title': 'Konfigurasi Umum',
  'settings.subtitle':
    'Tetapan yang boleh diubah semasa sistem berjalan. Nilai yang ditetapkan semasa pemasangan dipaparkan sebagai baca-sahaja.',
  'settings.tabs.aria': 'Kumpulan tetapan',
  'settings.tab.general': 'Umum',
  'settings.translation.title': 'Alih Bahasa',
  'settings.tab.backup': 'Backup & Restore',
  'settings.tab.maintenance': 'Maintenance & Cache',

  'settings.error.load': 'Gagal memuatkan tetapan',
  'settings.notice.saved': 'Tetapan disimpan.',
  'settings.save': 'Simpan',

  'settings.general.title': 'Umum',
  'settings.general.subtitle':
    'Nama, format dan identiti visual yang muncul pada skrin, laporan dan export payroll.',

  'settings.org.group': 'Organisasi',
  'settings.org.name': 'Nama organisasi',
  'settings.org.name.hint': 'Muncul pada setiap laporan dan pada tajuk export payroll.',
  'settings.org.name.placeholder': 'Hospital Sibu',
  'settings.dedup.label': 'Tetingkap scan berulang',
  'settings.dedup.hint':
    'Scan kedua dalam tempoh ini tidak dikira dua kali. Orang kerap scan semula bila terminal berbunyi lambat.',
  'settings.dedup.unit': 'detik',

  'settings.datetime.group': 'Tarikh & Masa',
  'settings.datetime.subtitle': 'Bagaimana tarikh dan jam ditulis di seluruh aplikasi.',
  /** Live summary in the group head: the format string, then which clock. */
  'settings.datetime.summary': '{format} · {clock}',
  'settings.datetime.clock24': '24 jam',
  'settings.datetime.clock12': '12 jam',
  'settings.datetime.note':
    'Zon waktu pengiraan datang dari fail persekitaran dan dipapar di bawah. Yang di sini hanya menentukan cara nilai ditulis, bukan hari mana satu scan dikira jatuh pada.',

  'settings.dateFormat.label': 'Format tarikh',
  /** The pattern is not translated; the worked example beside it shows what it produces. */
  'settings.dateFormat.option': '{pattern} ({sample})',
  'settings.timeFormat.label': 'Format masa',
  'settings.timeFormat.hint': 'Jadual tugas biasanya ditulis dalam 24 jam, jadi itu yang lalai.',
  'settings.timeFormat.option': '{clock} ({sample})',
  'settings.timeFormat.note':
    'Berkuat kuasa serta-merta selepas disimpan. Tarikh kalendar seperti tarikh cuti tidak terjejas — ia tiada masa di dalamnya.',
  'settings.weekStart.label': 'Minggu bermula',

  'settings.branding.group': 'Logo & Favicon',
  'settings.branding.subtitle': 'Dimuat naik ke pemasangan ini, bukan dirujuk dari CDN luar.',
  'settings.branding.logo': 'Logo organisasi',
  'settings.branding.logo.hint':
    'Muncul pada skrin log masuk dan pada laporan. PNG atau JPEG, tinggi lebih kurang 64px.',
  'settings.branding.favicon': 'Favicon',
  'settings.branding.favicon.hint': 'Ikon tab penyemak imbas. PNG atau ICO, 32×32 atau 48×48.',
  'settings.branding.formats':
    'PNG, JPEG, WEBP atau ICO, sehingga {limit}. Jenis fail ditentukan daripada bait pertamanya, bukan daripada namanya. {refusal} — ia dokumen XML yang boleh membawa skrip, dan ia akan dihidangkan dari origin yang sama dengan aplikasi ini.',
  'settings.branding.formats.refusal': 'SVG tidak diterima',
  'settings.branding.offline':
    'Muat naik disimpan pada pelayan ini. Pemasangan LAN mungkin tiada akses internet, dan logo yang tidak dimuat menjadikan laporan kelihatan rosak.',

  'settings.upload.busy': 'Memuat naik',
  'settings.upload.empty': 'Belum dimuat naik',
  'settings.upload.replace': 'Ganti',
  'settings.upload.choose': 'Pilih fail',
  'settings.upload.currentAlt': '{label} semasa',
  'settings.upload.tooLarge': 'Fail {size} melebihi had {limit}.',
  'settings.upload.error': 'Muat naik gagal',

  'settings.env.group': 'Ditetapkan Semasa Pemasangan',
  'settings.env.subtitle': 'Datang dari fail persekitaran dan memerlukan restart untuk ditukar.',
  'settings.env.connectorMode': 'Mod sambungan',
  'settings.env.connectorMode.direct': 'direct (LAN)',
  'settings.env.connectorMode.agent': 'agent (cloud)',
  'settings.env.timezone': 'Zon waktu organisasi',
  'settings.env.driftWarn': 'Ambang amaran jam',
  'settings.env.syncInterval': 'Selang sync terminal',
  'settings.env.seconds': '{count}s',
  'settings.env.require2fa': '2FA admin',
  'settings.env.require2fa.on': 'diwajibkan',
  'settings.env.require2fa.off': 'tidak diwajibkan',
  'settings.env.ingestPath': 'Laluan ingest',
  'settings.env.no2fa':
    '2FA admin dimatikan. Satu akaun admin boleh mengubah rekod kehadiran ribuan orang — hidupkan {flag} sebelum sistem digunakan secara sebenar.',

  'settings.general.hint': 'Logo dan favicon disimpan sebaik dimuat naik, bukan dengan butang ini.',

  // -------------------------------------------------------------------------
  // Tetapan › Backup & Restore
  //
  // Two of these are held by `routes/backup.ts` and arrive as keys rather than words —
  // the route builds the restore command from the live connection details, so the warning
  // beside it belongs there, but the words still have to resolve per reader.
  // -------------------------------------------------------------------------
  'backup.subtitle': 'Di mana dump disimpan, bila ia diambil, dan berapa lama ia disimpan.',
  'backup.run.action': 'Backup Sekarang',
  'backup.run.busy': 'Sedang backup…',

  'backup.error.load': 'Gagal membaca senarai backup',
  'backup.error.savePolicy': 'Gagal menyimpan jadual',
  'backup.error.run': 'Backup gagal',
  'backup.error.remove': 'Gagal membuang fail',
  'backup.notice.removed': '{name} dibuang.',

  /**
   * Three complete sentences joined with a space, not one sentence with holes.
   *
   * The pruning clause only appears when files were actually pruned. Written as a slot in
   * a single label it would leave a stray gap on every run that pruned nothing.
   */
  'backup.run.result': '{name} ({size}) siap dalam {seconds}s.',
  'backup.run.pruned': '{count} fail lama dibuang mengikut had simpanan.',
  'backup.run.note':
    'Salin fail ini ke luar mesin ini. Backup yang duduk pada cakera yang sama tidak menolong bila cakera itu yang gagal.',

  'backup.tool.missing':
    '{tool} tidak dijumpai pada pelayan ini. Pasang MySQL client tools, atau jadualkan backup di luar aplikasi — sampai itu, tiada backup boleh diambil dari skrin ini, termasuk yang berjadual.',
  'backup.empty.warning':
    'Belum ada backup. Pangkalan data ini satu-satunya tempat sejarah kehadiran wujud, dan ia yang mengira gaji.',
  'backup.stale.warning':
    'Backup terbaharu berumur {days} hari. Kalau pangkalan data hilang hari ini, itulah jumlah kerja yang hilang bersamanya.',

  'backup.auto.group': 'Backup Automatik',
  'backup.auto.subtitle': 'Satu dump sehari, disemak setiap jam.',
  'backup.auto.summary.on': 'Setiap hari {time}',
  'backup.auto.summary.off': 'Dimatikan',
  'backup.auto.note':
    'Disemak setiap jam dan dibandingkan dengan larian terakhir, bukan pemasa ke waktu tertentu — jadi ia bertahan melalui restart pelayan. Kalau pelayan mati sepanjang jam yang dipilih, dump hari itu dilangkau, bukan dikejar.',

  'backup.schedule.label': 'Jadual',
  'backup.schedule.hint':
    'Dimatikan secara lalai. Pemasangan yang belum membuat keputusan backup tidak dipenuhi dump dengan sendiri.',
  'backup.schedule.switch': 'Ambil satu dump setiap hari',
  'backup.hour.label': 'Waktu',
  'backup.hour.hint': 'Pilih waktu tiada orang scan. Waktu tempatan pelayan.',
  'backup.hour.aria': 'Waktu backup',
  'backup.keep.label': 'Simpan berapa fail',
  'backup.keep.hint':
    'Fail paling lama dibuang selepas dump baharu berjaya, bukan sebelum — dump yang gagal tidak boleh mengurangkan bilangan salinan yang ada.',
  'backup.keep.aria': 'Bilangan fail disimpan',
  'backup.keep.unit': 'fail',
  'backup.keep.minimum': 'Minimum 2',
  'backup.policy.save': 'Simpan jadual',

  'backup.destination.group': 'Destinasi Simpanan',
  'backup.destination.summary': 'cakera setempat',
  'backup.destination.directory': 'Direktori',
  'backup.destination.fileCount': 'Jumlah fail',
  'backup.destination.spaceUsed': 'Ruang digunakan',
  'backup.destination.last': 'Backup terakhir',
  'backup.destination.never': 'Belum pernah',
  'backup.destination.warning':
    'Dump disimpan pada {sameDisk} dengan pangkalan data. Tolakan automatik ke FTP, SFTP atau storan awan belum dibina: fail ini mengandungi setiap rekod kehadiran dan setiap hash kata laluan, jadi menghantarnya ke host luar tanpa pengawasan memerlukan kredensial host itu disimpan di sini dan menambah satu lagi cara kerja pukul 2 pagi boleh gagal. Sampai itu dibina dengan betul, muat turun fail ke luar mesin ini secara berkala.',
  'backup.destination.warning.sameDisk': 'cakera yang sama',

  'backup.files.title': 'Fail Backup',
  'backup.files.subtitle':
    'Terbaharu di atas. Muat turun ke luar mesin ini — backup pada cakera yang gagal tidak menolong.',
  'backup.files.empty': 'Belum ada fail backup.',
  'backup.column.file': 'Fail',
  'backup.column.size': 'Saiz',
  'backup.row.newest': 'Terbaharu',
  'backup.row.download': 'Muat turun {name}',
  'backup.row.remove': 'Buang {name}',
  'backup.row.onlyCopy': 'Ini satu-satunya backup — jalankan yang baharu dahulu',

  'backup.restore.title': 'Restore',
  'backup.restore.subtitle': 'Tidak dijalankan dari skrin ini dengan sengaja.',
  'backup.restore.warning':
    'Restore menulis ganti data semasa. Hentikan pelayan dahulu, jika tidak scan yang masuk semasa restore akan hilang tanpa jejak.',
  'backup.restore.lead': 'Jalankan arahan ini pada pelayan selepas menghentikan aplikasi:',
  'backup.restore.note':
    'Butang restore dalam skrin web ialah satu klik yang menulis ganti setiap rekod kehadiran, dicapai oleh sesiapa yang sampai ke skrin ini. Mencetak arahannya mengekalkan keputusan itu pada orang yang menjalankannya.',

  'backup.remove.title': 'Buang fail backup?',
  'backup.remove.body':
    '{name} akan dibuang dari cakera. Kalau anda belum ada salinan di luar mesin ini, ia hilang terus.',

  // -------------------------------------------------------------------------
  // Tetapan › Maintenance & Cache
  // -------------------------------------------------------------------------
  'maintenance.subtitle': 'Mod penyelenggaraan, log, cache dan keadaan sistem.',
  'maintenance.state.under': 'Dalam penyelenggaraan',
  'maintenance.state.operating': 'Beroperasi',

  'maintenance.mode.group': 'Mod Penyelenggaraan',
  'maintenance.mode.subtitle': 'Menolak skrin operator sementara kerja dijalankan.',
  'maintenance.mode.on': 'Aktif',
  'maintenance.mode.off': 'Tidak aktif',
  'maintenance.mode.ingestNote':
    'Push terminal {never} ditolak, walaupun mod ini aktif. Scan yang tidak dapat dihantar tidak dicuba semula oleh peranti — ia keluar dari log dalamannya dan hilang. Perekodan kehadiran terus berjalan sepanjang penyelenggaraan.',
  'maintenance.mode.ingestNote.never': 'tidak pernah',
  'maintenance.mode.enable': 'Hidupkan mod',
  'maintenance.mode.enable.hint':
    'Berkuat kuasa serta-merta selepas disimpan. Semakan itu sendiri di-cache 15 saat, jadi perubahan yang dibuat terus dalam pangkalan data mengambil masa itu.',
  'maintenance.mode.enable.switch': 'Tolak permintaan operator',
  'maintenance.mode.message': 'Mesej',
  'maintenance.mode.message.hint':
    'Dipaparkan kepada sesiapa yang cuba menggunakan sistem semasa mod ini aktif.',
  'maintenance.mode.message.placeholder':
    'Sistem sedang diselenggara. Perekodan kehadiran di terminal tidak terjejas.',
  'maintenance.mode.allowIps': 'Alamat dibenarkan',
  'maintenance.mode.allowIps.hint':
    'Dipisahkan dengan koma. Alamat tepat, CIDR, atau hujung bertanda bintang seperti 192.168.1.*',
  'maintenance.mode.allowIps.loopback':
    'Loopback dipadan dalam kedua-dua bentuk, jadi {ipv4} merangkumi {ipv6} juga.',
  'maintenance.mode.lockoutWarning':
    'Alamat anda sendiri mesti ada dalam senarai ini sebelum mod boleh dihidupkan — kalau tidak anda mengunci diri sendiri keluar, dan jalan balik hanya melalui pangkalan data. Pelayan menolak simpanan yang akan menyebabkannya.',

  'maintenance.log.group': 'Debug & Log',
  'maintenance.log.subtitle': 'Apa yang ditulis ke Log Aktiviti, dan berapa lama ia disimpan.',
  'maintenance.log.summary': '{level} · {days} hari',
  'maintenance.log.level': 'Aras minimum',
  'maintenance.log.level.hint':
    'Entri di bawah aras ini tidak ditulis sama sekali, jadi aras yang sunyi memang lebih murah.',
  'maintenance.log.level.aria': 'Aras log minimum',
  'maintenance.log.level.debug': 'DEBUG — semuanya',
  'maintenance.log.level.info': 'INFO — lalai',
  'maintenance.log.level.warn': 'WARN — hanya yang perlu perhatian',
  'maintenance.log.floorNote':
    'Tiada pilihan yang boleh membuang {warn} atau {error}. Itu entri yang menjawab “siapa membuang sebulan scan”, dan kawalan yang boleh melupuskannya bukan kawalan verbositi.',
  'maintenance.log.retention': 'Simpanan log aktiviti',
  'maintenance.log.retention.hint':
    'Entri lebih lama daripada ini dibuang semasa pas pembersihan harian.',
  'maintenance.log.retention.unit': 'hari',
  'maintenance.log.retention.minimum': 'Minimum 7',
  'maintenance.log.auditNote':
    '{emphasis} Dua jadual dengan sengaja: Log Aktiviti ialah ulasan berjalan yang membesar tanpa had, Log Audit ialah rekod apa yang berubah dan ia disimpan.',
  'maintenance.log.auditNote.emphasis': 'Log Audit tidak dipotong.',

  'maintenance.save': 'Simpan tetapan',
  'maintenance.save.hint':
    'Menyimpan dengan mod dihidupkan akan menolak setiap skrin operator serta-merta.',

  'maintenance.cache.title': 'Pengurusan Cache',
  'maintenance.cache.subtitle': 'Tindakan diagnostik, bukan pembaikan.',
  'maintenance.cache.leftAlone':
    'Tiga cache lain dibiarkan sengaja: kiraan had kadar API (mengosongkannya membenarkan pemanggil menetapkan semula hadnya sendiri), simpanan nonce Digest (membuka semula tingkap main-semula pada laluan ingest), dan peta kerja import pukal (import yang sedang berjalan akan hilang kedudukannya).',
  'maintenance.cache.config': 'Cache konfigurasi',
  'maintenance.cache.config.detail':
    'Konfigurasi API, dasar keselamatan, mod penyelenggaraan dan aras log. Semuanya luput sendiri dalam 1–30 saat, jadi ini hanya memendekkan tempoh itu.',
  'maintenance.cache.devices': 'Klien terminal',
  'maintenance.cache.devices.detail':
    'Memaksa setiap terminal berjabat tangan semula. Ini yang benar-benar menolong selepas terminal di-reboot atau kredensialnya ditukar.',
  'maintenance.cache.all': 'Kosongkan semua',
  'maintenance.cache.all.detail': 'Kedua-dua di atas dalam satu tindakan.',
  'maintenance.cache.action': 'Kosongkan',
  'maintenance.cache.error': 'Gagal mengosongkan cache',
  'maintenance.cache.result': 'Dikosongkan: {items}.',

  /** What `POST /api/maintenance/cache` reports it released, named by the server as keys. */
  'maintenance.cache.item.apiConfig': 'konfigurasi API',
  'maintenance.cache.item.securityPolicy': 'dasar keselamatan',
  'maintenance.cache.item.maintenanceMode': 'mod penyelenggaraan',
  'maintenance.cache.item.logLevel': 'aras log',
  'maintenance.cache.item.deviceClients': 'klien terminal',
  'maintenance.cache.note.config':
    'Cache konfigurasi luput sendiri dalam 1–30 saat, jadi ini hanya memendekkan tempoh itu.',
  'maintenance.cache.note.devices':
    'Klien terminal akan berjabat tangan semula pada permintaan seterusnya.',

  'maintenance.recompute.title': 'Kira Semula Kehadiran',
  'maintenance.recompute.subtitle': 'Membina semula rekod kehadiran daripada log scan mentah.',
  'maintenance.recompute.note':
    'Inilah sebabnya log scan disimpan tanpa boleh diubah: selepas jam terminal dibetulkan, peraturan shift berubah, atau pemetaan ID diperbetulkan, rekod boleh dijana semula tanpa data asal hilang. Menjalankannya dua kali memberi keputusan yang sama.',
  'maintenance.recompute.action': 'Kira semula',
  'maintenance.recompute.result':
    '{records} rekod dibina semula untuk {staff} staf, {exceptions} pengecualian dikemukakan.',
  'maintenance.recompute.error': 'Kira semula gagal',
  'maintenance.recompute.futureNote':
    'Tarikh masa depan diabaikan — hari yang belum berlaku tidak boleh menjadi ketidakhadiran.',

  'maintenance.retention.title': 'Simpanan Data & Pembersihan Automatik',
  'maintenance.retention.subtitle': 'Berapa lama log scan disimpan, dan bila yang lapuk dibuang.',
  'maintenance.retention.purge': 'Bersihkan sekarang',
  'maintenance.retention.purge.busy': 'Sedang membersihkan…',
  'maintenance.retention.error.load': 'Gagal membaca polisi simpanan',
  'maintenance.retention.error.purge': 'Pembersihan gagal',
  'maintenance.retention.error.trim': 'Gagal memotong log',

  'maintenance.retention.policy.group': 'Polisi Simpanan',
  'maintenance.retention.policy.summary': '{months} bulan · {schedule}',
  'maintenance.retention.policy.summary.auto': 'auto {time}',
  'maintenance.retention.policy.summary.manual': 'manual',
  'maintenance.retention.raw': 'Simpan log scan mentah',
  'maintenance.retention.raw.hint': 'Log ini adalah bukti bagi gaji yang sudah dibayar.',
  'maintenance.retention.months': 'bulan',
  'maintenance.retention.raw.floor':
    'Minimum {months} bulan — bulan yang dibuang tidak boleh dikira semula',
  'maintenance.retention.pictures': 'Kosongkan rujukan gambar selepas',
  'maintenance.retention.pictures.hint':
    'Gambar tinggal pada terminal, bukan pada pelayan ini. Terminal menulis gantinya sendiri, jadi ini hanya membuang pautan yang sudah pasti gagal.',
  'maintenance.retention.auto': 'Pembersihan automatik',
  'maintenance.retention.auto.hint':
    'Dimatikan secara lalai. Selagi ia mati, tiada apa dibuang walaupun tempoh simpanan sudah lepas.',
  'maintenance.retention.auto.switch': 'Jalankan pembersihan setiap hari',
  'maintenance.retention.hour': 'Jam ia berjalan',
  'maintenance.retention.hour.hint':
    'Pembersihan berjalan dalam batch dan berhenti selepas seminit, jadi ia tidak menahan pangkalan data — baki disambung pas berikutnya. Log aktiviti dipotong dalam pas yang sama.',
  'maintenance.retention.hour.aria': 'Jam pembersihan',
  'maintenance.retention.policy.save': 'Simpan polisi',

  'maintenance.retention.preview.group': 'Apa Yang Akan Dibuang Sekarang',
  'maintenance.retention.preview.subtitle':
    'Dikira terhadap data sebenar, sebelum apa-apa dibuang.',
  'maintenance.retention.preview.total': 'Jumlah log scan disimpan',
  'maintenance.retention.preview.oldest': 'Rekod tertua',
  'maintenance.retention.preview.cutoff': 'Tarikh potong',
  'maintenance.retention.preview.lastPurge': 'Pembersihan terakhir',
  'maintenance.retention.preview.never': 'Belum pernah',
  'maintenance.retention.due':
    '{scans} akan dibuang secara kekal, dan {pictures} rujukan gambar dikosongkan.{punches}',
  'maintenance.retention.due.scans': '{count} log scan',
  'maintenance.retention.due.punches':
    ' {count} punch akan kehilangan pautan buktinya — rekod kehadiran itu sendiri kekal, tetapi bulan tersebut tidak lagi boleh dikira semula.',
  'maintenance.retention.nothingDue':
    'Tiada data melebihi tempoh simpanan. Tiada apa yang akan dibuang.',
  'maintenance.retention.auditNote':
    'Setiap pembersihan direkodkan dalam Log Aktiviti dan Log Audit dengan tarikh potong dan jumlahnya, supaya jurang dalam log scan boleh dijelaskan kemudian.',

  'maintenance.retention.trim': 'Potong log aktiviti sekarang',
  'maintenance.retention.trim.hint':
    'Menggunakan tempoh simpanan yang ditetapkan di atas. Log Audit tidak disentuh.',
  'maintenance.retention.trim.result':
    '{count} entri log aktiviti sebelum {cutoff} dibuang.',
  'maintenance.retention.trim.note':
    'Log Audit tidak disentuh — ia rekod kekal bagi apa yang berubah.',
  'maintenance.retention.purge.result':
    '{scans} log scan dibuang, {pictures} rujukan gambar dikosongkan, {links} pautan pengecualian dilepaskan dalam {seconds}s.',
  /** A whole sentence of its own, appended only when a pass ran out of time. */
  'maintenance.retention.purge.incomplete':
    'Had masa satu pas dicapai. Jalankan lagi untuk meneruskan bakinya.',

  'maintenance.retention.confirm.title': 'Buang data lapuk secara kekal?',
  'maintenance.retention.confirm.body':
    '{count} log scan sebelum {cutoff} akan dibuang. Ini tidak boleh dibatalkan dan tiada backup automatik diambil dahulu.',
  'maintenance.retention.confirm.note':
    'Jalankan backup dahulu jika anda belum pasti. Selepas ini, pertikaian gaji bagi bulan tersebut tidak lagi boleh dijawab daripada log terminal.',
  'maintenance.retention.confirm.submit': 'Ya, buang',

  'maintenance.recentLogs.title': 'Log Sistem Terkini',
  'maintenance.recentLogs.subtitle': '25 entri terakhir. Penapis penuh ada di Tetapan › Log.',
  'maintenance.recentLogs.empty': 'Tiada entri.',

  'maintenance.health.title': 'Kesihatan Sistem',
  'maintenance.health.subtitle': 'Diukur, bukan dibaca dari konfigurasi.',
  'maintenance.health.error': 'Gagal membaca kesihatan sistem',
  'maintenance.health.database': 'Pangkalan data',
  'maintenance.health.database.ok': 'Bersambung · {latency}ms',
  'maintenance.health.database.fail': 'Gagal',
  'maintenance.health.storage': 'Storan fail',
  'maintenance.health.storage.ok': 'Boleh ditulis',
  'maintenance.health.storage.fail': 'Tidak boleh ditulis',
  'maintenance.health.mode': 'Mod penyelenggaraan',
  'maintenance.health.backup': 'Backup',
  'maintenance.health.backup.value': '{count} fail · {days} hari lalu',
  'maintenance.health.backup.scheduled': 'Berjadual',
  'maintenance.health.backup.unscheduled': 'Tiada jadual',
  'maintenance.health.email': 'Emel (SMTP)',
  'maintenance.health.email.value': '{count} profil aktif',
  'maintenance.health.logs': 'Log aktiviti',
  'maintenance.health.logs.value': '{count} entri',
  'maintenance.health.logs.detail': 'Audit {audit} · simpanan {days} hari',
  'maintenance.health.memory': 'Memori',
  'maintenance.health.memory.value': '{used} / {total}',
  'maintenance.health.memory.detail': 'RSS {rss} · Node {version}',
  'maintenance.health.uptime': 'Masa hidup proses',
  'maintenance.health.orphans': 'Fail branding tidak dirujuk',
  'maintenance.health.orphans.detail': 'Tinggal dari muat naik terdahulu',

  /** Uptime, written in the largest two units that apply. */
  'maintenance.uptime.days': '{days}h {hours}j',
  'maintenance.uptime.hours': '{hours}j {minutes}m',
  'maintenance.uptime.minutes': '{minutes}m',

  // -------------------------------------------------------------------------
  // Tetapan › Pengurusan Pengguna
  //
  // These three are held by `routes/settings.ts` and returned as keys. A newly issued
  // credential is shown once, so the sentence saying so has to arrive with it.
  // -------------------------------------------------------------------------
  'users.create.needs2fa': 'Akaun admin perlu menyiapkan 2FA sebelum boleh log masuk.',
  'users.apps.secret.issued':
    'Rekod secret ini sekarang — ia disimpan sebagai hash dan tidak boleh dipaparkan lagi.',
  'users.apps.secret.rotated': 'Secret lama sudah tidak sah. Rekod yang baharu ini sekarang.',

  // -------------------------------------------------------------------------
  // Tetapan › Konfigurasi Umum › Alih Bahasa
  //
  // The screen that manages this registry is in it, like every other screen. Its own tab
  // label is `settings.translation.title`, which sits with the other tab labels.
  //
  // Group *names* — `LABEL_GROUPS` above — are deliberately not registered. They are the
  // headings of the editor that translates labels, so a translated heading would have to be
  // read from the very table being edited.
  // -------------------------------------------------------------------------
  'translation.subtitle': 'Bahasa yang antara muka boleh dipaparkan dalamnya.',
  'translation.action.add': 'Tambah Bahasa',
  'translation.empty': 'Tiada bahasa.',

  'translation.error.load': 'Gagal memuatkan senarai bahasa',
  'translation.error.status': 'Gagal menukar status',
  'translation.error.default': 'Gagal menukar bahasa lalai',
  'translation.error.remove': 'Gagal membuang bahasa',

  'translation.notice.enabled': '{name} dihidupkan.',
  'translation.notice.disabled': '{name} dimatikan. Antara muka kembali ke bahasa sumber.',
  'translation.notice.default':
    '{name} kini bahasa lalai — inilah bahasa yang setiap pengguna buka.',
  'translation.notice.added': '{name} ditambah. Ia tidak aktif sampai anda menghidupkannya.',
  /** Two whole sentences: the count clause sits inside, so a slot would leave a gap. */
  'translation.notice.removed': '{name} dibuang.',
  'translation.notice.removed.withTranslations': '{name} dibuang bersama {count} terjemahan.',

  'translation.numbers.show': 'Tunjuk Label',
  'translation.numbers.hide': 'Sembunyi Label',
  'translation.numbers.legend':
    'Nombor label sedang dipaparkan di seluruh antara muka. Yang {source} ambar bermakna masih perkataan sumber, yang {translated} hijau bermakna sudah diterjemah, dan {unregistered} bermakna label itu belum didaftarkan. Mod ini mati sendiri apabila tab pelayar ditutup.',

  'translation.column.language': 'Bahasa',
  'translation.column.code': 'Kod',
  'translation.column.translated': 'Label diterjemah',
  'translation.column.default': 'Lalai',

  'translation.row.isSource': 'Bahasa sumber — perkataannya datang dari kod aplikasi',
  'translation.row.all': 'Semua ({count})',
  'translation.row.progress': '{translated} / {total}',
  'translation.row.incomplete': 'belum lengkap',
  'translation.row.default': 'Lalai',

  'translation.row.viewSource': 'Lihat label — bahasa sumber tidak boleh disunting',
  'translation.row.edit': 'Sunting terjemahan {name}',
  'translation.row.alreadyDefault': '{name} sudah menjadi bahasa lalai',
  'translation.row.needsActive':
    'Hidupkan bahasa ini dahulu — bahasa lalai adalah yang dibuka oleh setiap pengguna',
  'translation.row.makeDefault': 'Jadikan {name} bahasa lalai',
  'translation.row.sourceNameLocked': 'Nama bahasa sumber tidak boleh ditukar',
  'translation.row.rename': 'Tukar nama bahasa',
  'translation.row.sourceAlwaysActive': 'Bahasa sumber sentiasa aktif',
  'translation.row.defaultLocked': 'Ini bahasa lalai — jadikan bahasa lain lalai dahulu',
  'translation.row.disable': 'Matikan bahasa',
  'translation.row.enable': 'Hidupkan bahasa',
  'translation.row.sourceUndeletable':
    'Bahasa sumber tidak boleh dibuang — label ditulis dalam bahasa ini',
  'translation.row.remove': 'Buang {name}',

  'translation.note.addedInactive':
    'Bahasa baharu ditambah dalam keadaan {inactive}. Bahasa yang separuh diterjemah lalu dihidupkan akan memaparkan skrin yang separuh satu bahasa dan separuh yang lain, yang terbaca sebagai skrin rosak dan bukan sebagai terjemahan yang belum siap.',
  'translation.note.addedInactive.inactive': 'tidak aktif',
  'translation.note.fallback':
    'Terjemahan yang kosong bermakna label itu jatuh kembali ke bahasa sumber. Tiada label yang akan kosong pada skrin kerana belum diterjemah.',

  'translation.add.title': 'Tambah bahasa',
  'translation.add.description':
    'Bahasa ditambah dalam keadaan tidak aktif sampai terjemahannya siap.',
  'translation.add.submit': 'Tambah',
  'translation.add.error': 'Gagal menambah bahasa',

  'translation.field.name': 'Nama bahasa',
  'translation.field.name.hint': 'Seperti yang akan dipaparkan dalam senarai.',
  'translation.field.name.placeholder': 'English',
  'translation.field.code': 'Kod bahasa',
  'translation.field.code.hint':
    'Dua huruf, atau dua huruf dengan varian seperti zh-Hans. Ia menjadi bahagian URL, jadi ia tidak boleh ditukar selepas ini.',
  'translation.field.code.placeholder': 'en',
  'translation.field.code.short': 'Kod',
  'translation.field.code.locked': 'Tidak boleh ditukar.',

  'translation.rename.title': 'Tukar nama "{name}"',
  'translation.rename.error': 'Gagal menukar nama',

  'translation.remove.title': 'Buang bahasa "{name}"?',
  'translation.remove.withTranslations':
    '{count} terjemahan yang sudah ditulis akan dibuang bersamanya.',
  'translation.remove.empty': 'Belum ada terjemahan ditulis untuk bahasa ini.',
  'translation.remove.hint':
    'Kalau anda hanya mahu berhenti menawarkannya, matikan bahasa itu sebaliknya — terjemahannya kekal.',

  'translation.editor.error.load': 'Gagal memuatkan label',
  'translation.editor.saved': '{count} terjemahan disimpan.',
  'translation.editor.saved.cleared': '{count} terjemahan disimpan, {cleared} dikosongkan.',
  'translation.editor.subtitle': 'Perkataan Bahasa Melayu di kiri, terjemahan di kanan.',
  'translation.editor.subtitle.source':
    'Bahasa sumber. Perkataannya datang dari kod aplikasi dan tidak disunting di sini.',
  'translation.editor.progress': '{done} / {total}',
  'translation.editor.back': 'Senarai bahasa',
  'translation.editor.sourceWarning':
    'Ini bahasa sumber. Perkataannya ditulis dalam kod aplikasi, jadi ia tidak boleh disunting di sini — satu salinan tersimpan akan menjadi tempat kedua perkataan itu ditetapkan, dan salinan itu akan menang atas setiap pembetulan yang dibuat kemudian dalam kod.',
  'translation.editor.group': 'Label',
  'translation.editor.group.subtitle':
    'Nombor di sebelah setiap label ialah ID-nya, dan ia tidak berubah.',
  'translation.editor.labelCount': '{count} label',
  'translation.editor.hint':
    'Biarkan kosong untuk menggunakan perkataan Bahasa Melayu. Label yang belum diterjemah tidak akan kosong pada skrin.',
  'translation.editor.dirty': 'Ada perubahan belum disimpan.',
  'translation.editor.clean': 'Tiada perubahan.',
  'translation.editor.save': 'Simpan terjemahan',
  'translation.editor.row.aria': 'Terjemahan untuk {source}',

  // -------------------------------------------------------------------------
  // Tetapan › Senarai Peranti
  //
  // The four status words are `device.status.*`, up with the dashboard badges that share
  // them. Everything below is this screen's own.
  // -------------------------------------------------------------------------
  'device.title': 'Senarai Peranti',
  'device.subtitle':
    'Terminal kehadiran, cara ia dihubungi, dan keadaan jamnya. Terminal tidak boleh dibuang kerana sejarah scan merujuk kepadanya.',
  'device.tabs.aria': 'Tetapan peranti',
  'device.tab.list': 'Senarai',
  'device.tab.connection': 'Mod Sambungan',
  'device.tab.health': 'Kesihatan & Jam',

  /**
   * Why the terminal's data should not be trusted, raised by the probe in
   * `devices/health.ts` and arriving as a key with its measurements.
   */
  'device.warning.drift':
    'Jam tersasar {seconds}s dari pelayan. Rekod yang direkod sekarang mewarisi kesilapan ini.',
  'device.warning.manualClock': 'timeMode ialah manual, jadi sasaran jam akan terus bertambah.',
  'device.warning.capacity':
    'Kapasiti hampir penuh: {enrolled}/{capacity}. Pendaftaran seterusnya berisiko gagal.',
  /**
   * A callback terminal with no serial number recorded yet.
   *
   * Its own class of fault: the record looks complete, but every TA Push request identifies
   * itself by serial and nothing else, so scans from this unit are rejected as coming from an
   * unregistered terminal.
   */
  'device.warning.noSerial':
    'Nombor siri belum direkodkan. Terminal ini mengenalkan dirinya dengan nombor siri sahaja, jadi scan daripadanya tidak dapat dipadankan ke rekod ini dan akan ditolak sehingga ia menghubungi pelayan sekali.',
  'device.warning.faceAtTerminal':
    'Firmware ini tidak menerima muat naik wajah. Wajah mesti didaftarkan di terminal itu sendiri — staf perlu berdiri di depan mesin.',

  'device.warning.remoteCheck':
    'Pengesahan jauh aktif melalui "{channel}". Setiap scan menunggu {timeout}s.',

  'device.list.count': '{count} terminal',
  'device.list.subtitle':
    'Push mempercepatkan kemasukan tetapi bukan sumber kebenaran — tarikan berkala tetap berjalan sebagai jaring keselamatan.',
  'device.list.add': 'Tambah Terminal',
  'device.list.search': 'Cari nama atau alamat terminal…',
  'device.list.empty': 'Belum ada terminal berdaftar.',
  'device.error.load': 'Gagal memuatkan terminal',
  'device.error.sync': 'Sync gagal',
  'device.error.import': 'Import gagal',

  'device.sync.done': '{name}: {stored} event baharu, {duplicates} sudah ada.',
  'device.sync.failed': '{name}: {error}',
  'device.import.done':
    '{name}: {users} pengguna dibaca, {mapped} dipadan, {review} perlu semakan di Pemetaan ID Terminal.',

  'device.column.name': 'Nama',
  'device.column.address': 'Alamat',
  'device.column.clock': 'Jam',
  'device.column.enrolled': 'Didaftar',
  'device.column.serial': 'Serial',
  'device.column.seen': 'Dilihat',

  'device.row.unknownModel': 'model tidak diketahui',
  'device.row.neverSeen': 'belum pernah',
  'device.row.edit': 'Ubah tetapan terminal',
  'device.row.sync': 'Sync sekarang',
  'device.row.importUsers': 'Baca senarai pengguna dari terminal',
  'device.row.expand': 'butiran terminal',

  'device.detail.model': 'Model',
  'device.detail.firmware': 'Firmware',
  'device.detail.serial': 'No. siri',
  'device.detail.mac': 'MAC',
  'device.detail.location': 'Lokasi',
  'device.detail.clockMode': 'Mod jam',
  'device.detail.lastSync': 'Sync terakhir',
  'device.detail.lastPush': 'Push terakhir',
  'device.detail.recovered': 'Dipulihkan oleh pull',
  'device.detail.recoveredNote':
    '{count} event ditemui oleh tarikan berkala yang push tidak pernah hantar. Angka yang terus menaik bermaksud push tidak boleh diharap pada terminal ini — kehadiran masih betul, cuma lambat sampai.',
  'device.detail.driftWarning':
    'Jam tersasar {drift}. Setiap scan yang direkod sekarang mewarisi kesilapan ini. Betulkan di tab Kesihatan & Jam.',

  /**
   * Adding only.
   *
   * The edit wording moved to `device.editor.*` when editing became its own page. The
   * add-and-edit pair that used to live here is gone rather than kept "just in case": an
   * unused key is a string a translator is asked to translate for a screen that no longer
   * renders it.
   */
  'device.dialog.add': 'Tambah terminal',
  'device.dialog.description': 'Terminal akan diperiksa serta-merta selepas disimpan.',
  'device.dialog.name': 'Nama',
  'device.dialog.name.placeholder': 'cth. Pintu Utama',
  'device.dialog.host': 'IP / hostname',
  'device.dialog.port': 'Port',
  'device.dialog.vendor': 'Jenama',
  'device.dialog.protocol': 'Protokol',

  /**
   * Which side opens the connection, stated when a terminal is added.
   *
   * This is the sentence that decides whether a remote site needs a VPN, so it belongs on the
   * form rather than in documentation somebody reads afterwards.
   */
  'device.dialog.reach.inbound':
    'Pelayan menghubungi terminal ini. Untuk tapak jauh, pelayan mesti dapat mencapai alamatnya — biasanya melalui VPN tapak-ke-tapak.',
  'device.dialog.reach.outbound':
    'Terminal ini menghubungi pelayan, bukan sebaliknya. Tiada capaian masuk diperlukan, jadi tapak jauh tidak perlukan VPN — cuma sambungan keluar ke pelayan ini.',

  'device.dialog.https': 'Guna HTTPS',
  'device.dialog.username': 'Pengguna',
  'device.dialog.password': 'Kata laluan',
  'device.dialog.location': 'Lokasi',
  'device.dialog.location.none': 'Tiada',
  'device.dialog.credentialNote':
    'Kata laluan disulitkan sebelum disimpan dan tidak pernah dipulangkan semula. Terminal diperiksa serta-merta supaya kesilapan alamat atau kredensial muncul sekarang, bukan sebagai kehadiran yang hilang esok.',
  'device.dialog.probing': 'Memeriksa…',
  'device.dialog.submit.add': 'Tambah dan periksa',

  /**
   * Saved, then probed — two outcomes, each a whole sentence.
   *
   * The warning count is a clause of its own for the same reason as everywhere else: on a
   * clean probe there is nothing to put in the slot.
   */
  'device.saved.added': '{name} ditambah dan diperiksa.',
  'device.saved.added.warnings': '{name} ditambah dan diperiksa — {count} amaran.',
  'device.saved.added.unreachable': '{name} ditambah tetapi tidak dapat dihubungi: {error}',

  'device.connection.title': 'Mod sambungan',
  'device.connection.subtitle':
    'Ditetapkan semasa pemasangan. Menukarnya mengubah lokasi pangkalan data dan pelayan, bukan sekadar satu tetapan.',
  'device.connection.error.load': 'Gagal memuatkan',
  'device.connection.direct': 'Direct',
  'device.connection.direct.body':
    'Pelayan berada dalam LAN yang sama dengan terminal. Terminal push ke pelayan, dan pelayan menarik terus dari terminal.',
  'device.connection.agent': 'Agent',
  'device.connection.agent.body':
    'Pelayan di cloud. Connector on-site dail keluar ke pelayan, jadi tiada port masuk perlu dibuka pada rangkaian hospital.',
  'device.connection.active': 'aktif',
  'device.connection.fixed': 'Mod ditetapkan melalui {env} dan tidak boleh ditukar dari skrin ini.',

  'device.ingest.title': 'Endpoint ingest',
  'device.ingest.subtitle': 'Tempat terminal menghantar event, dan sejauh mana ia berjaya.',
  'device.ingest.pushed': 'Event via push',
  'device.ingest.pulled': 'Event via pull',
  'device.ingest.heartbeats': 'Heartbeat',
  'device.ingest.undecodable': 'Gagal dibaca',
  'device.ingest.path': 'Laluan ingest',
  'device.ingest.auth': 'Kaedah auth',
  'device.ingest.lastContact': 'Hubungan terakhir',
  'device.ingest.rejected': 'Penolakan auth',
  'device.ingest.ignored': 'Tiada event',
  'device.ingest.ignored.note':
    '{count} penghantaran dibaca tetapi tidak mengandungi event yang boleh difailkan. Ini biasanya bermakna firmware menukar nama medan: terminal nampak berfungsi, dan tiada scan masuk.',
  'device.ingest.undecodable.note':
    '{count} penghantaran sampai tetapi tidak dapat dibaca. Terminal menghubungi kita dan kita membuang muatannya — ini lebih buruk daripada terminal yang tidak dapat dihubungi, kerana ia kelihatan seperti berfungsi.',

  'device.push.title': 'Arahkan terminal ke pelayan ini',
  'device.push.subtitle':
    'Alamat pelayan seperti yang dilihat dari terminal, bukan seperti yang dilihat dari komputer anda.',
  'device.push.host': 'IP pelayan (dilihat dari terminal)',
  'device.push.error': 'Gagal mengkonfigurasi push',
  'device.push.done':
    '{name} kini menghantar ke {target}. Tunggu ~30 detik untuk heartbeat pertama, kemudian muat semula tab ini.',
  'device.push.note':
    'Push mempercepatkan kemasukan tetapi bukan sumber kebenaran: firmware tidak menyimpan baris gilir dan tidak mencuba semula, jadi tarikan berkala tetap berjalan sebagai jaring keselamatan.',

  'device.health.title': 'Kesihatan terminal',
  'device.health.subtitle':
    'Jam terminal adalah satu-satunya kerosakan yang merosakkan setiap rekod tanpa menghasilkan ralat.',
  'device.health.recheck': 'Periksa semula',
  'device.health.error.load': 'Gagal memeriksa terminal',
  'device.health.silentNote':
    'Terminal terus berfungsi, scan terus masuk, dan cap masa cuma salah. Tiada apa dalam antara muka Hikvision melaporkannya.{drifting}',
  'device.health.silentNote.drifting': ' {count} terminal tersasar melebihi 30 detik sekarang.',
  'device.health.ntp': 'Sumber NTP',
  'device.health.ntp.hint':
    'Gateway LAN lebih tahan daripada NTP awam — jam kekal tersinkron walaupun internet terputus.',
  'device.health.empty': 'Tiada terminal untuk diperiksa.',
  'device.health.column.terminal': 'Terminal',
  'device.health.column.capacity': 'Kapasiti',
  'device.health.column.warnings': 'Amaran',
  'device.health.noWarnings': 'Tiada amaran',
  'device.health.warningCount': '{count} amaran — buka untuk melihat',
  'device.health.row.fixClock': 'Betulkan jam melalui NTP',
  'device.health.row.disableRemote': 'Matikan pengesahan jauh',
  'device.health.row.expand': 'butiran kesihatan',
  'device.health.detail.driftTarget': 'Sasaran jam',
  'device.health.detail.unmeasured': 'Tidak diukur',
  'device.health.detail.lastSeen': 'Dilihat terakhir',
  'device.health.pastRecords':
    'Membetulkan jam tidak mengubah cap masa yang sudah direkod. Rekod lampau kekal dengan kesilapannya, dan sasaran yang diukur ketika itu disimpan bersama setiap baris supaya ia masih boleh dinilai kemudian.',
  'device.health.ntp.done':
    '{name}: timeMode={mode} drift={drift}s. Terminal mungkin restart servis seketika selepas tetapan masa ditukar, jadi pemeriksaan sejurus selepas ini boleh gagal sementara.',
  'device.health.ntp.error': 'Gagal menetapkan NTP',
  'device.health.remoteOff': '{name}: pengesahan jauh dimatikan.',
  'device.health.remoteOff.error': 'Gagal mematikan',

  // -------------------------------------------------------------------------
  // Tetapan › Senarai Peranti › Editor Peranti
  //
  // The per-terminal editor at /tetapan/peranti/:id. Grouped under `device.editor.*`
  // rather than folded into `device.*` because a translator opening this works on one
  // screen with seven tabs, and mixing it with the fleet list would put two screens'
  // worth of strings in one place.
  //
  // The division that shapes the wording: the first tab saves into this database, and the
  // rest read and write the terminal itself. Those two need to read differently, or an
  // operator cannot tell which kind of change they just made.
  // -------------------------------------------------------------------------
  'device.editor.back.aria': 'Kembali ke senarai peranti',
  'device.editor.recheck': 'Periksa',
  'device.editor.notFound': 'Terminal tidak dijumpai.',
  'device.editor.error.load': 'Gagal memuatkan terminal',
  'device.editor.error.check': 'Gagal memeriksa terminal',
  'device.editor.unknownModel': 'Model belum dibaca',
  'device.editor.save': 'Simpan',
  'device.editor.enrolled': '{enrolled}/{capacity} didaftar',
  'device.editor.passwordStored': 'Kata laluan tersimpan',

  'device.editor.tabs.aria': 'Bahagian tetapan terminal',
  'device.editor.tab.connection': 'Sambungan',
  'device.editor.tab.identity': 'Identiti',
  'device.editor.tab.clock': 'Jam',
  'device.editor.tab.attendance': 'Kehadiran',
  'device.editor.tab.door': 'Pintu',
  'device.editor.tab.push': 'Push',
  'device.editor.tab.diagnostics': 'Diagnostik',

  /**
   * Shared by every live tab.
   *
   * The read time is on screen because six tabs show device state that changes without
   * this page knowing — the same reason the record tables carry a generated-at stamp.
   */
  'device.editor.live.readAt': 'Dibaca dari terminal {time}',
  /**
   * Worded differently from a live reading, because it is not one.
   *
   * For a terminal behind a connector these values came from the connector's last sweep, which may
   * be minutes old. Presenting that as `Dibaca dari terminal` would make a ten-minute-old setting
   * look current — and somebody who changes the verification mode at the keypad would find this
   * screen confidently wrong with a fresh-looking timestamp beside it. Includes the date, because
   * a connector that stopped reporting yesterday must not read as "this morning".
   */
  'device.editor.live.snapshotAt': 'Laporan connector {time}',
  'device.editor.live.reading': 'Sedang membaca…',
  'device.editor.live.reload': 'Baca semula',
  'device.editor.live.unsupported': 'Firmware terminal ini tidak melaporkan tetapan ini.',

  /**
   * One label for all four writable tabs, with the grant named as a var.
   *
   * Shared because it is the same sentence about a different action, and because a
   * disabled control without a reason teaches the operator that the screen is broken
   * rather than that they lack a grant. The action is named so whoever they ask knows
   * which box to tick — the grants are per-action, so "no permission" alone is not
   * actionable.
   */
  'device.editor.readOnly':
    'Tab ini baca-sahaja kerana peranan anda tiada kebenaran {action} pada Senarai Peranti. Mintanya di Tetapan › Pengurusan Peranan.',

  // Tab Sambungan
  'device.editor.connection.title': 'Sambungan',
  'device.editor.connection.subtitle':
    'Disimpan dalam pangkalan data ini, bukan pada terminal. Boleh disunting walaupun unit tidak dapat dihubungi.',
  'device.editor.connection.hint':
    'Menyimpan melepaskan sambungan yang di-cache dan memeriksa terminal semula. Sejarah scan tidak disentuh — ia kekal terikat pada terminal ini.',
  'device.editor.group.address': 'Alamat',
  'device.editor.group.credentials': 'Kredensial',

  /**
   * Replaces the credentials card on a protocol that has none.
   *
   * A separate card rather than the same one greyed out: a disabled password field reads as a
   * control somebody lacks permission for, and sends them looking for the permission instead
   * of telling them the protocol has no password to store.
   */
  'device.editor.group.identification': 'Pengenalan',
  'device.editor.field.serialIdentity': 'Nombor siri',
  'device.editor.field.serialIdentity.hint':
    'Protokol ini tidak menggunakan nama pengguna atau kata laluan. Terminal mengenalkan dirinya dengan nombor siri pada setiap permintaan, jadi nombor inilah satu-satunya yang memadankan scan yang masuk kepada rekod ini.',
  'device.editor.field.serialIdentity.missing':
    'Nombor siri belum diketahui. Ia diisi apabila terminal menghubungi pelayan untuk kali pertama — sebelum itu, scan daripadanya tidak dapat dipadankan kepada rekod ini dan akan ditolak.',

  'device.editor.group.placement': 'Penempatan',

  'device.editor.field.name': 'Nama',
  'device.editor.field.name.placeholder': 'cth. Pintu Utama',
  'device.editor.field.host': 'Alamat',
  'device.editor.field.host.caption': 'IP / hostname',
  'device.editor.field.host.hint':
    'Terminal menerima kedua-duanya. Alamat ini juga menjadi sasaran notifikasi push.',
  'device.editor.field.port': 'Port',
  'device.editor.field.tls': 'Pengangkutan',
  'device.editor.field.tls.hint':
    'Terminal dihantar dengan sijil self-signed, jadi pengesahan sijil dimatikan secara lalai dan dihidupkan per peranti.',
  'device.editor.field.https': 'Guna HTTPS',
  'device.editor.field.vendor': 'Jenama dan protokol',
  'device.editor.field.vendor.hint':
    'Tidak boleh ditukar selepas peranti dicipta. Setiap event mentah dan pemetaan ID pada rekod ini milik semantik protokol itu, jadi menukarnya akan menafsir semula sejarah dan bukan menukar sambungan. Untuk terminal jenama lain, tambah rekod baharu dan nyahaktifkan yang lama.',

  'device.editor.field.verifyTls': 'Sahkan sijil',
  'device.editor.field.username': 'Pengguna',
  'device.editor.field.password': 'Kata laluan',
  'device.editor.field.password.hint':
    'Biarkan kosong untuk kekalkan yang tersimpan. Ia disulitkan dan tidak pernah dipulangkan, jadi kosong tidak boleh bermakna "buang".',
  'device.editor.field.location': 'Lokasi',
  'device.editor.field.location.caption': 'Lokasi organisasi',
  'device.editor.field.location.none': 'Tiada',
  'device.editor.field.doorNo': 'No. pintu',
  'device.editor.field.doorNo.hint': 'Ditulis ke hak pintu setiap staf yang diagihkan ke sini.',
  'device.editor.field.active': 'Aktif',
  'device.editor.field.active.hint':
    'Terminal tidak aktif dilangkau oleh pemeriksaan berjadual dan tolakan roster. Nyahaktifkan unit yang sudah ditanggalkan — kalau tidak ia melaporkan offline selama-lamanya, dan amaran itu menjadi amaran yang orang berhenti membaca.',

  'device.editor.saved': '{name} disimpan dan diperiksa.',
  'device.editor.saved.warnings': '{name} disimpan dan diperiksa — {count} amaran.',
  'device.editor.saved.unreachable': '{name} disimpan tetapi tidak dapat dihubungi: {error}',
  'device.editor.saved.noProbe': '{name} disimpan. Tidak diperiksa kerana ia tidak aktif.',

  // Tab Identiti
  'device.editor.identity.title': 'Identiti terminal',
  'device.editor.identity.subtitle':
    'Apa yang unit ini lapor tentang dirinya, dan apa yang ia sedang pegang.',
  'device.editor.identity.group.unit': 'Unit',
  'device.editor.identity.group.credentials': 'Kredensial di terminal',
  'device.editor.identity.group.library': 'Pustaka muka',
  'device.editor.identity.model': 'Model',
  'device.editor.identity.model.caption': 'Model',
  'device.editor.identity.deviceName': 'Nama di terminal',
  'device.editor.identity.firmware': 'Firmware',
  'device.editor.identity.firmware.caption': 'Versi',
  'device.editor.identity.serial': 'Nombor siri',
  'device.editor.identity.serial.live': 'Dibaca sekarang',
  'device.editor.identity.serial.hint':
    'Dibandingkan dengan yang tersimpan pada rekod. Setiap pemetaan ID pada rekod ini milik siri yang kami lihat pertama kali.',
  'device.editor.identity.mac': 'Alamat MAC',
  'device.editor.identity.serialMismatch':
    'Alamat ini menjawab dengan siri {live}, tetapi rekod menyimpan {stored}. Unit mungkin sudah ditukar, atau dua rekod menuding ke satu terminal. Setiap pemetaan ID pada rekod ini milik siri yang tersimpan.',
  'device.editor.identity.users': 'Orang di terminal',
  'device.editor.identity.users.caption': 'Jumlah',
  'device.editor.identity.users.hint':
    'Pecahan ini menjawab siapa yang wujud pada unit tetapi tidak boleh scan.',
  'device.editor.identity.withFace': 'Ada muka',
  'device.editor.identity.withFingerprint': 'Ada cap jari',
  'device.editor.identity.withCard': 'Ada kad',
  'device.editor.identity.noCredentials':
    '{count} orang wujud pada terminal ini tanpa muka, cap jari mahupun kad. Mereka tidak boleh scan sama sekali, dan terminal tidak melaporkan ralat apabila mereka mencuba.',
  'device.editor.identity.libraries': 'Pustaka',
  'device.editor.identity.libraries.caption': 'FDID:jenis',
  'device.editor.identity.libraries.hint':
    'Pendaftaran menulis ke pustaka blackFD. infraredFD bukan untuk pendaftaran.',
  'device.editor.identity.capacity': 'Kapasiti dilapor',
  'device.editor.identity.noLibrary':
    'Terminal tidak melaporkan sebarang pustaka muka. Pendaftaran muka tidak akan berjaya sehingga ini diselesaikan.',

  // Tab Jam
  'device.editor.clock.title': 'Jam dan zon waktu',
  'device.editor.clock.subtitle':
    'Diukur, bukan diandaikan. Jam yang salah adalah satu-satunya kerosakan yang merosakkan setiap rekod sambil unit kekal berfungsi sepenuhnya.',
  'device.editor.clock.silentNote':
    'Scan terus masuk, tiada apa yang ralat, dan cap masa cuma salah. Tiada apa dalam antara muka Hikvision melaporkannya.',
  'device.editor.clock.group.state': 'Keadaan sekarang',
  'device.editor.clock.group.ntp': 'Sumber NTP',
  'device.editor.clock.group.ntp.subtitle':
    'Menulis pelayan sahaja tidak cukup — timeMode kekal manual dan terminal terus mengabaikannya. Kedua-duanya ditulis bersama.',
  'device.editor.clock.group.manual': 'Set masa secara manual',
  'device.editor.clock.group.manual.subtitle': 'Hanya untuk tapak tanpa hos NTP yang boleh dihubungi.',
  'device.editor.clock.drift': 'Sasaran jam',
  'device.editor.clock.drift.caption': 'Sasaran',
  'device.editor.clock.drift.hint':
    'Positif bermakna terminal mendahului pelayan. Diukur pada titik tengah tetingkap permintaan supaya latensi rangkaian tidak dikira sebagai kesilapan jam.',
  'device.editor.clock.deviceTime': 'Masa terminal',
  'device.editor.clock.serverTime': 'Masa pelayan',
  'device.editor.clock.slots': 'Slot NTP terminal',
  'device.editor.clock.slots.hint':
    'Seperti yang terminal simpan sekarang. Kotak kosong di sebelah konfigurasi yang berfungsi menjemput ia ditulis ganti.',
  'device.editor.clock.slots.none': 'Terminal tidak melaporkan sebarang slot NTP.',
  'device.editor.clock.slots.placeholder':
    'Satu slot masih pada placeholder kilang 192.0.0.64. Ia tidak akan menyinkron.',
  'device.editor.clock.ntpHost': 'Hos NTP',
  'device.editor.clock.ntpHost.caption': 'IP / hostname',
  'device.editor.clock.ntpHost.hint':
    'Gateway LAN lebih tahan daripada NTP awam — jam kekal tersinkron walaupun internet terputus.',
  'device.editor.clock.ntpPort': 'Port',
  'device.editor.clock.ntpInterval': 'Selang',
  'device.editor.clock.ntpInterval.hint': 'Minit',
  'device.editor.clock.timeZone': 'Zon waktu terminal',
  'device.editor.clock.timeZone.caption': 'Notasi Hikvision',
  'device.editor.clock.timeZone.hint':
    'Notasi POSIX terbalik: CST-8:00:00 bermaksud UTC+8. Zon organisasi dipaparkan di sebelah sebagai rujukan.',
  'device.editor.clock.orgTimeZone': 'Zon organisasi',
  'device.editor.clock.apply': 'Serahkan jam kepada NTP',
  'device.editor.clock.applied':
    'timeMode={mode}, sasaran={drift}s. Terminal mungkin restart servis seketika selepas masa ditukar, jadi pemeriksaan sejurus selepas ini boleh gagal sementara.',
  'device.editor.clock.hint':
    'Membetulkan jam tidak mengubah cap masa yang sudah direkod. Rekod lampau kekal dengan kesilapannya, dan sasaran yang diukur ketika itu disimpan bersama setiap baris.',
  'device.editor.clock.manual.note':
    'Jam yang diset manual mula tersasar semula serta-merta dan tiada apa yang membetulkannya. Guna ini hanya apabila tiada hos NTP boleh dihubungi, dan kembali ke NTP sebaik ada.',
  'device.editor.clock.manual.action': 'Set ke masa pelayan',
  'device.editor.clock.manual.action.hint':
    'Menulis masa pelayan ini sekarang, dengan zon waktu di atas.',
  'device.editor.clock.manual.apply': 'Set masa sekarang',
  'device.editor.clock.manual.applied': 'Masa diset secara manual. Sasaran sekarang {drift}s.',

  // Tab Kehadiran
  'device.editor.attendance.title': 'Mod kehadiran',
  'device.editor.attendance.subtitle':
    'Bagaimana terminal melabel setiap scan sebagai masuk atau keluar.',
  'device.editor.attendance.group.mode': 'Mod',
  'device.editor.attendance.mode': 'Mod kehadiran',
  'device.editor.attendance.mode.hint':
    'Ini menentukan sama ada terminal menghantar attendanceStatus bersama setiap peristiwa.',
  'device.editor.attendance.mode.disable': 'Mati',
  'device.editor.attendance.mode.disable.hint':
    'Terminal tidak menghantar status. Masuk dan keluar diterbitkan daripada susunan scan oleh enjin — ini keadaan unit ujian.',
  'device.editor.attendance.mode.manual': 'Manual',
  'device.editor.attendance.mode.manual.hint': 'Orang menekan MASUK atau KELUAR pada skrin terminal.',
  'device.editor.attendance.mode.auto': 'Auto',
  'device.editor.attendance.mode.auto.hint':
    'Terminal memilih sendiri mengikut jadualnya, yang berasingan daripada jadual shift dalam sistem ini.',
  'device.editor.attendance.mode.manualAndAuto': 'Manual + Auto',
  'device.editor.attendance.mode.manualAndAuto.hint':
    'Terminal memilih, tetapi orang boleh mengatasinya.',
  'device.editor.attendance.derived': 'Dibaca, tidak ditulis',
  'device.editor.attendance.derived.hint':
    'Terminal mengurusnya sebagai bahagian definisi mod itu sendiri, dan tiada apa dalam sistem ini membacanya. Kawalan yang menulis tetapan yang tiada sesiapa baca ialah kawalan yang kelihatan berfungsi dan tidak berbuat apa-apa.',
  'device.editor.attendance.statusTime': 'Tempoh paparan status',
  'device.editor.attendance.reqStatus': 'Wajib pilih status',
  'device.editor.attendance.apply': 'Simpan ke terminal',
  'device.editor.attendance.saved': 'Mod kehadiran ditulis ke terminal.',
  'device.editor.attendance.note':
    'Menukar ini menukar cara scan dilabel mulai sekarang. Rekod lampau tidak berubah — enjin menerbitkannya semula daripada punch, jadi jalankan kira semula kalau labelnya perlu berubah juga.',
  'device.editor.attendance.hint':
    'Ditulis terus ke terminal. Satu baris audit direkodkan dengan nama anda.',

  // Tab Pintu
  'device.editor.door.title': 'Pintu dan pengesahan',
  'device.editor.door.subtitle': 'Bagaimana pintu ini memutuskan untuk terbuka.',

  'device.editor.door.group.verify': 'Mod pengesahan',
  'device.editor.door.group.verify.subtitle':
    'Senarai pilihan dibaca dari terminal, bukan dikodkan dalam sistem ini — firmware berbeza menyokong set berbeza.',
  'device.editor.door.verifyMode': 'Cara dibenarkan masuk',
  'device.editor.door.verifyMode.hint':
    'Terminal memadan secara setempat. Mod yang memerlukan dua faktor menolak scan yang hanya memberi satu.',
  'device.editor.door.verifyMode.unpublished':
    'Terminal tidak menerbitkan senarai mod yang ia terima, jadi senarai di atas adalah yang didokumenkan dan belum disahkan terhadap unit ini. Nilai yang ditolak akan gagal dengan mesej dari terminal, bukan disimpan secara senyap. Lihat tab Diagnostik untuk dokumen keupayaannya.',
  'device.editor.door.modules': 'Modul aktif',
  'device.editor.door.modules.hint':
    'Modul kredensial yang pembaca hidupkan. Dibaca sahaja — mematikan satu di sini akan menghentikan setiap orang yang hanya mendaftar dengan modul itu.',
  'device.editor.door.thresholds': 'Ambang padanan',
  'device.editor.door.thresholds.hint':
    'Ambang lebih tinggi menolak lebih banyak padanan hampir: lebih sedikit padanan palsu, lebih banyak scan yang perlu diulang.',
  'device.editor.door.faceThreshold': 'Ambang muka',
  'device.editor.door.faceThreshold.hint': '0–100',
  'device.editor.door.group.liveness': 'Pengesanan hidup',
  'device.editor.door.liveness': 'Pengesanan hidup',
  'device.editor.door.liveness.hint':
    'Menyaring gambar, video dan topeng. Tanpanya, muka yang dipadan hanyalah imej yang cukup serupa.',
  'device.editor.door.liveness.offWarning':
    'Pengesanan hidup dimatikan pada terminal ini. Gambar seseorang yang dipegang di depan pembaca boleh membuka pintu dan direkod sebagai kehadiran mereka.',
  'device.editor.door.livenessLevel': 'Aras pengesanan',
  'device.editor.door.livenessLevel.caption': 'Aras',
  'device.editor.door.livenessLevel.hint':
    'Aras lebih ketat menolak lebih banyak percubaan tetapi juga menolak lebih banyak muka tulen dalam cahaya yang lemah.',
  'device.editor.door.disabledOpenDuration': 'Tempoh lanjutan',
  'device.editor.door.disabledOpenDuration.hint': 'Saat, untuk yang perlukan lebih masa',
  'device.editor.door.alarmTimeout': 'Amaran terbuka lama',
  'device.editor.door.alarmTimeout.hint': 'Saat, 0 mematikannya',
  'device.editor.door.sensors': 'Sensor',
  'device.editor.door.sensors.hint':
    'Keadaan rehat sensor magnet dan butang keluar. Butang keluar didawai pada perkakasan, jadi ia dipaparkan sahaja.',
  'device.editor.door.exitButton': 'Butang keluar',
  'device.editor.door.onScreen': 'Ditunjuk pada skrin',
  'device.editor.door.onScreen.hint':
    'Menunjuk nama berguna semasa menyelesaikan pemetaan ID: skrin terminal menamakan orang yang ia fikir baru scan.',
  'device.editor.door.showName': 'Nama',
  'device.editor.door.showEmployeeNo': 'No. staf',
  'device.editor.door.showPicture': 'Gambar',
  'device.editor.door.masking': 'Penyamaran',
  'device.editor.door.masking.hint':
    'Dipaparkan sahaja. Mematikannya meletakkan nama penuh dan nombor staf pada skrin di koridor awam, jadi ia patut menjadi keputusan yang direkodkan dan bukan suis pada tab tetapan.',
  'device.editor.door.masking.on': 'Disamarkan',
  'device.editor.door.masking.off': 'Dipaparkan penuh',
  'device.editor.door.masking.unknown': 'Tidak dilaporkan',
  'device.editor.door.reader.unsupported':
    'Firmware ini tidak mendedahkan konfigurasi pembaca, jadi mod pengesahan mesti ditetapkan pada terminal itu sendiri.',
  'device.editor.door.fingerprintLevel': 'Aras cap jari',
  /**
   * Not a 1-5 scale, and the hint says so.
   *
   * V4.38.0 accepts 3, 5, 6, 12 and 13. The control is built from the terminal's own
   * capability list, so the wording must not imply a range the numbers do not form.
   */
  'device.editor.door.fingerprintLevel.hint': 'Nilai yang terminal terima',
  'device.editor.door.unchanged': 'Kekalkan',
  'device.editor.door.group.remote': 'Pengesahan jauh',
  'device.editor.door.remote.on': 'Hidup',
  'device.editor.door.remote.off': 'Mati',
  'device.editor.door.remoteCheck': 'Perlukan kelulusan pelayan',
  'device.editor.door.remoteCheck.hint':
    'Bila hidup dengan saluran yang tidak dapat dihubungi, setiap pengesahan menunggu sepanjang timeout sebelum pintu terbuka.',
  'device.editor.door.remoteDetail': 'Butiran saluran',
  'device.editor.door.channel': 'Saluran',
  'device.editor.door.timeout': 'Timeout (saat)',
  'device.editor.door.remoteWarning':
    'Pengesahan jauh sedang hidup. Kalau salurannya tidak menjawab, timeout itu ditambah pada setiap scan — yang dirasai sebagai barisan di pintu setiap pagi.',
  'device.editor.door.group.behaviour': 'Kelakuan pintu',
  'device.editor.door.doorNo': 'Pintu {doorNo}',
  'device.editor.door.timing': 'Masa dan sensor',
  'device.editor.door.timing.hint':
    'Ditulis dengan baca-ubah-tulis: terminal mengurus ini sebagai satu objek penuh, jadi menghantar satu medan sahaja akan mengosongkan yang lain.',
  'device.editor.door.openDuration': 'Tempoh terbuka',
  'device.editor.door.openDuration.hint': 'Saat',
  'device.editor.door.magneticType': 'Sensor magnet',
  'device.editor.door.magneticType.alwaysClose': 'Biasanya tertutup',
  'device.editor.door.magneticType.alwaysOpen': 'Biasanya terbuka',
  'device.editor.door.param.unsupported':
    'Firmware ini tidak mendedahkan parameter pintu, jadi tempoh terbuka dan sensor mesti ditetapkan pada terminal itu sendiri.',
  'device.editor.door.remoteOpen': 'Buka pintu dari jauh',
  'device.editor.door.remoteOpen.hint':
    'Melepaskan kunci sekali, tanpa sesiapa memberikan kredensial. Satu baris audit direkodkan dengan nama anda.',
  'device.editor.door.open': 'Buka pintu sekarang',
  'device.editor.door.open.error': 'Gagal membuka pintu',
  'device.editor.door.opened': 'Pintu {doorNo} dibuka.',
  'device.editor.door.open.confirm.title': 'Buka pintu sekarang?',
  'device.editor.door.open.confirm.description': 'Terminal {name} akan melepaskan kuncinya.',
  'device.editor.door.open.confirm.body':
    'Ini membuka pintu fizikal tanpa sesiapa memberikan kredensial. Terminal merekod peristiwa pintu tetapi bukan siapa yang memintanya dari pelayar — baris audit sistem ini satu-satunya rekod itu.',
  'device.editor.door.group.display': 'Paparan dan bunyi',
  'device.editor.door.voicePrompt': 'Gesaan suara',
  'device.editor.door.voicePrompt.hint': 'Terminal bersuara pada setiap pengesahan.',
  'device.editor.door.apply': 'Simpan ke terminal',
  'device.editor.door.saved': '{count} tetapan ditulis ke terminal.',
  'device.editor.door.partial':
    '{applied} tetapan ditulis, tetapi sebahagian gagal: {failed}',
  'device.editor.door.hint':
    'Tiga kumpulan ditulis secara berasingan kepada tiga endpoint, jadi satu boleh berjaya sementara yang lain ditolak. Setiap perubahan direkodkan dalam log audit.',

  /**
   * Authentication modes we have words for.
   *
   * Partial on purpose. The option list comes from the terminal, so a firmware offering a
   * mode absent here still shows it using the device's own token — worse to read, but
   * truthful. Inventing wording for a mode nobody has seen would be worse.
   */
  'device.editor.verify.face': 'Muka sahaja',
  'device.editor.verify.face.hint': 'Paling laju, dan cukup untuk kebanyakan pintu dalaman.',
  'device.editor.verify.faceOrFp': 'Muka atau cap jari',
  'device.editor.verify.faceOrCard': 'Muka atau kad',
  'device.editor.verify.faceOrPw': 'Muka atau PIN',
  'device.editor.verify.faceOrFpOrCard': 'Muka, cap jari atau kad',
  'device.editor.verify.faceOrFpOrCardOrPw': 'Mana-mana satu: muka, cap jari, kad atau PIN',
  'device.editor.verify.faceOrFpOrCardOrPw.hint':
    'Paling longgar. Ini tetapan unit ujian — sesiapa yang tahu PIN boleh masuk tanpa biometrik.',
  'device.editor.verify.faceAndFp': 'Muka dan cap jari',
  'device.editor.verify.faceAndCard': 'Muka dan kad',
  'device.editor.verify.faceAndPw': 'Muka dan PIN',
  'device.editor.verify.cardAndPw': 'Kad dan PIN',
  'device.editor.verify.faceAndPw.hint':
    'Dua faktor. Menambah beberapa saat pada setiap kemasukan, jadi pertimbangkan barisan waktu pertukaran shift.',
  'device.editor.verify.card': 'Kad sahaja',
  'device.editor.verify.fp': 'Cap jari sahaja',
  'device.editor.verify.pw': 'PIN sahaja',
  'device.editor.verify.pw.hint':
    'Tiada biometrik. PIN boleh dikongsi, jadi kehadiran yang direkod hanya membuktikan nombor itu diketahui.',
  'device.editor.verify.cardOrPw': 'Kad atau PIN',

  // Tab Push
  'device.editor.push.title': 'Push dan ingest',
  'device.editor.push.subtitle':
    'Ke mana terminal menghantar peristiwa. Firmware ini ada tepat dua slot.',
  'device.editor.push.slot': 'Slot {slot}',
  'device.editor.push.set': 'Menjawab',
  'device.editor.push.empty': 'Kosong',
  'device.editor.push.empty.detail': 'Slot ini tidak dikonfigur. Di sini pelayan kedua akan duduk.',
  'device.editor.push.target': 'Sasaran',
  'device.editor.push.url': 'URL',
  'device.editor.push.format': 'Format',
  'device.editor.push.auth': 'Pengesahan',
  'device.editor.push.auth.hint':
    'Kata laluan tidak pernah dipulangkan dari terminal, jadi hanya kaedah dan nama pengguna dipaparkan.',
  'device.editor.push.auth.method': 'Kaedah',
  'device.editor.push.auth.user': 'Pengguna',
  'device.editor.push.heartbeat': 'Heartbeat',
  'device.editor.push.noAuth':
    'Slot ini menghantar tanpa pengesahan. Sesiapa yang boleh menghubungi endpoint ingest boleh menghantar punch palsu. Konfigur semula untuk membetulkannya.',
  'device.editor.push.release': 'Lepaskan slot',
  'device.editor.push.release.hint':
    'Terminal yang dipindahkan antara pelayan terus menghantar ke yang lama sehingga slotnya dilepaskan.',
  'device.editor.push.clear': 'Kosongkan slot',
  'device.editor.push.cleared': 'Slot {slot} dikosongkan.',
  'device.editor.push.group.configure': 'Konfigur slot',
  'device.editor.push.group.configure.subtitle':
    'Pengesahan sentiasa ditetapkan dari kredensial ingest pelayan — firmware lalai kepada tiada.',
  'device.editor.push.destination': 'Destinasi',
  'device.editor.push.destination.hint':
    'Alamat pelayan ini seperti yang terminal boleh menghubunginya, bukan localhost.',
  'device.editor.push.host': 'Hos',
  'device.editor.push.port': 'Port',
  'device.editor.push.slotCaption': 'Slot',
  'device.editor.push.path': 'Laluan ingest',
  'device.editor.push.path.hint': 'Mesti sepadan dengan laluan ingest pelayan ini.',
  'device.editor.push.configure': 'Tulis ke terminal',
  'device.editor.push.configured': 'Terminal kini menghantar ke {target}.',
  'device.editor.push.hint':
    'Push mempercepatkan kemasukan tetapi bukan sumber kebenaran: firmware tidak menyimpan baris gilir dan tidak mencuba semula, jadi tarikan berkala tetap berjalan sebagai jaring keselamatan.',

  // Tab Diagnostik
  'device.editor.diag.title': 'Diagnostik',
  'device.editor.diag.subtitle':
    'Apa yang terminal kata tentang dirinya, tanpa ditapis. Ini yang menjawab mengapa satu kawalan pada tab lain dimatikan.',
  'device.editor.diag.group.cursor': 'Kursor dan penghantaran',
  'device.editor.diag.cursor': 'Kedudukan kursor',
  'device.editor.diag.cursor.hint':
    'Berpaut pada nombor siri, bukan cap masa — siri bertahan selepas jam dibetulkan, dan membetulkan jam ini memang dijangka.',
  'device.editor.diag.lastSerial': 'Siri terakhir',
  'device.editor.diag.lastSync': 'Tarikan terakhir',
  'device.editor.diag.lastPush': 'Push terakhir',
  'device.editor.diag.recovered': 'Dipulih tarikan',
  'device.editor.diag.recoveredNote':
    'Tarikan menemui {count} peristiwa yang push tidak pernah hantar. Nombor yang meningkat bermakna notifikasi push sedang hilang — peristiwa masih sampai, cuma lewat.',
  'device.editor.diag.group.acs': 'AcsCfg penuh',
  'device.editor.diag.group.acs.subtitle':
    'Pemeriksaan kesihatan membaca objek ini dan menyimpan satu bendera daripadanya. Selebihnya dipaparkan di sini supaya perubahan firmware boleh didiagnos tanpa lawatan tapak.',
  'device.editor.diag.group.capabilities': 'Dokumen keupayaan',
  'device.editor.diag.group.capabilities.subtitle':
    'Senarai pilihan pada tab lain dibina daripada dokumen ini. Entri kosong menerangkan mengapa kawalan berkaitan dimatikan.',
  'device.editor.diag.none': 'Tidak dilaporkan.',
  'device.editor.diag.unsupported': 'Tidak disokong pada firmware ini.',
  'device.editor.diag.noCapabilities': 'Terminal tidak menjawab sebarang dokumen keupayaan.',

  /**
   * Restart.
   *
   * Last group on the last tab. The wording carries both halves of what somebody needs
   * before pressing it: the door stops working for a minute or two, and no attendance is
   * lost. Only stating the first would make it read as dangerous in a way it is not, and
   * only stating the second would hide the part that matters at shift change.
   */
  'device.editor.reboot.group': 'Restart terminal',
  'device.editor.reboot.group.subtitle':
    'Satu-satunya kawalan di skrin ini yang mengeluarkan pintu dari perkhidmatan.',
  'device.editor.reboot.disruptive': 'Mengganggu',
  'device.editor.reboot.action': 'Restart dari jauh',
  'device.editor.reboot.action.hint':
    'Guna ini selepas menukar tetapan yang terminal abaikan, atau bila unit menjawab tetapi berkelakuan pelik. Satu baris audit direkodkan dengan nama anda.',
  'device.editor.reboot': 'Restart terminal',
  'device.editor.reboot.sent':
    '{name} sedang restart. Ia tidak akan menjawab selama satu hingga dua minit — tekan Periksa selepas itu untuk mengesahkan ia kembali.',
  'device.editor.reboot.error': 'Gagal menghantar arahan restart',
  'device.editor.reboot.confirm.title': 'Restart {name}?',
  'device.editor.reboot.confirm.description':
    'Terminal akan berhenti menjawab sepenuhnya sementara ia dihidupkan semula.',
  'device.editor.reboot.confirm.consequence':
    'Pintu ini tidak akan mengesahkan sesiapa selama satu hingga dua minit. Sesiapa yang berdiri di depannya dalam tempoh itu tidak boleh masuk dan scan mereka tidak akan direkod. Jangan lakukan ini pada waktu pertukaran shift.',
  'device.editor.reboot.confirm.safe':
    'Kehadiran yang sudah direkod tidak hilang. Peristiwa disimpan pada terminal terhadap nombor siri yang menaik, dan tarikan berkala mengambil semula apa-apa yang push terlepas semasa ia mati.',
  'device.editor.reboot.confirm.submit': 'Ya, restart sekarang',

  /**
   * Why a terminal behind a connector shows no live readings.
   *
   * One note, and deliberately not an error. The editor used to fire each tab's read anyway, get
   * a 409 back, and render it through `Feedback` — so a healthy site read as six red strips, one
   * per tab, all saying the same structural thing. Nothing had failed, and red on six tabs sends
   * somebody looking for a hardware fault.
   *
   * It names where the values actually are, because the operator came here to see them.
   */
  /**
   * Rewritten once the connector began reporting.
   *
   * It used to say these values could not be shown at all, which was true when nothing collected
   * them. Leaving that wording after the data arrived would have been worse than the original
   * problem: a screen full of real settings with a note above it saying they are unavailable.
   */
  'device.editor.viaAgent.read':
    'Terminal ini dilayan oleh connector "{agent}", jadi nilai di bawah datang dari sapuan terakhir connector dan bukan bacaan langsung. Cap masa di atas menyatakan bila ia diambil.',
  'device.editor.viaAgent.write':
    'Perubahan dibariskan dan bukan dipakai serta-merta — connector mengutipnya pada tinjauan berikutnya, jadi skrin berkata "dibariskan" dan bukan "siap".',
  /** Shown when the values are real but have stopped refreshing, which is its own state. */
  'device.editor.viaAgent.stale':
    'Sapuan terbaharu gagal: {reason}. Nilai di bawah ialah yang terakhir berjaya dibaca, jadi ia mungkin sudah tidak sepadan dengan terminal.',
  /*
   * `device.editor.viaAgent.disabled` was here, and is gone.
   *
   * It was the tooltip on controls this screen disabled wholesale for a connector terminal. Those
   * controls now work: reads answer from the connector's report and writes are queued. The three
   * that genuinely stay refused — setting the clock by hand, releasing the door, setting the push
   * target — carry their own reason from `DriverCapabilities.unavailable`, written per operation in
   * `agent-proxy.ts`, which is more specific than one shared sentence could be.
   *
   * Per-operation disabling of those three is not built: pressing them answers 409 with that
   * reason. Worth doing, and named here so the next person knows it is a gap rather than an
   * oversight.
   */

  /**
   * Who reaches this terminal, chosen per device.
   *
   * `CONNECTOR_MODE` looks like it answers this and does not: one installation serves a direct
   * site and several connector sites at once, so a global switch would be wrong for most of the
   * terminals it governed. It survives only as the default for newly added devices.
   */
  'device.editor.field.agent': 'Dicapai melalui',
  'device.editor.field.agent.direct': 'Pelayan ini terus (LAN)',
  'device.editor.field.agent.hint':
    'Pilih connector untuk terminal yang pelayan ini tidak boleh hubungi terus. Bacaan langsung berhenti berfungsi selepas itu — status dan jam datang dari laporan connector — dan tulisan dibariskan dan bukan serta-merta.',
  /**
   * Said on the form rather than discovered at the site.
   *
   * The agent's `buildDriver` refuses a non-ISAPI terminal with a log line nobody at the cloud
   * reads, so assigning one here would be accepted and then ignored: a site that looks configured
   * and records nothing.
   */
  'device.editor.field.agent.isapiOnly':
    'Connector memandu Hikvision ISAPI sahaja, jadi terminal ini mesti dicapai terus oleh pelayan.',

  // -------------------------------------------------------------------------
  // Tetapan › Senarai Peranti › Connector
  //
  // The machines that reach terminals this server cannot route to. A separate group from
  // `device.*` because the subject is different: one is a clock and a face library, the other is
  // a firewall rule and an installer command.
  // -------------------------------------------------------------------------
  'agent.tab': 'Connector',
  'agent.count': '{count} connector',
  'agent.subtitle':
    'Mesin di tapak yang menghubungi pelayan ini. Semuanya dimulakan oleh connector — tapak menerbitkan satu peraturan firewall keluar dan tiada satu pun masuk.',
  'agent.add': 'Tambah Connector',
  'agent.search': 'Cari nama connector…',
  'agent.empty':
    'Belum ada connector. Tambah satu untuk tapak yang pelayan ini tidak boleh hubungi terus.',
  'agent.error.load': 'Gagal memuatkan connector',
  'agent.error.create': 'Gagal mencipta connector',
  'agent.error.reissue': 'Gagal menjana token pendaftaran',
  'agent.error.revoke': 'Gagal menarik kredensial',

  /**
   * Stated on the screen, not only in a steering document.
   *
   * A non-ISAPI terminal assigned to a connector is accepted by the cloud and refused by the
   * agent's `buildDriver`, so the site looks configured and records nothing. That failure is
   * invisible from here unless the screen says so before somebody assigns one.
   */
  'agent.note.isapiOnly':
    'Connector memandu Hikvision ISAPI sahaja. Terminal jenama lain boleh ditugaskan kepadanya di sini dan akan diabaikan di tapak, jadi tapak itu kelihatan sihat sambil merekod sifar.',

  'agent.column.name': 'Nama tapak',
  'agent.column.devices': 'Terminal',
  'agent.column.queued': 'Dalam giliran',
  'agent.column.version': 'Binaan',
  'agent.column.address': 'Alamat LAN',
  'agent.column.seen': 'Dilihat',

  /**
   * Three states, not a boolean.
   *
   * An install nobody finished and a credential somebody withdrew need different actions from
   * whoever reads this, and neither is the same as working.
   */
  'agent.status.pending': 'BELUM DAFTAR',
  'agent.status.active': 'AKTIF',
  'agent.status.revoked': 'DIBATALKAN',

  'agent.row.neverSeen': 'belum pernah',
  'agent.row.noAddress': 'belum dilaporkan',
  'agent.row.reissue': 'Jana token pendaftaran baharu',
  'agent.row.revoke': 'Tarik kredensial connector',
  'agent.row.revokeBlocked':
    'Tidak boleh ditarik: {count} terminal masih ditugaskan. Pindahkan ke connector lain atau ke mod LAN dahulu.',
  'agent.row.delete': 'Buang connector',
  /**
   * Two reasons, not one, because they call for different actions.
   *
   * Terminals attached means move them; still active means withdraw the credential first. A
   * single "cannot be deleted" would leave the operator guessing which of the two applies.
   */
  'agent.row.deleteBlocked.devices':
    'Tidak boleh dibuang: {count} terminal masih ditugaskan. Pindahkan ke connector lain atau ke mod LAN dahulu.',
  'agent.row.deleteBlocked.active':
    'Tarik kredensial dahulu. Connector yang masih aktif bermakna ada mesin di tapak yang sedang menghubungi pelayan ini.',

  /**
   * The distinction this screen exists to make.
   *
   * A terminal behind a connector that never enrolled is not a broken terminal, but it reports
   * exactly like one — offline, nothing arriving. Without this line somebody drives to a hospital
   * to inspect a unit that is working perfectly.
   */
  'agent.pending.note':
    'Connector yang belum mendaftar bermakna pemasang belum pernah dijalankan di tapak itu. Terminal yang ditugaskan kepadanya tidak akan melaporkan apa-apa sampai ia mendaftar — itu bukan terminal rosak.',

  'agent.dialog.new': 'Connector baharu',
  'agent.dialog.new.description':
    'Mencipta connector dan mengeluarkan token pendaftarannya. Token itu dipaparkan sekali sahaja.',
  'agent.dialog.name': 'Nama tapak',
  'agent.dialog.name.hint':
    'Tempat mesin ini dipasang — hospital, klinik, atau blok. Nama ini muncul dalam setiap baris log bagi tapak itu, jadi dua nama yang berbeza satu aksara ialah cara terminal ditugaskan ke tapak yang salah.',
  'agent.dialog.submit': 'Cipta & jana token',
  'agent.created': 'Connector "{name}" dicipta.',

  'agent.reveal.title': 'Arahan pemasangan connector',
  'agent.reveal.label': 'Jalankan ini sebagai root pada mesin di tapak',
  /**
   * Two facts in one strip, and both change what the reader does next.
   *
   * Single-use because it is pasted into a shell command, which puts it in the history of a
   * machine that may sit in a corridor; expiring because a token found there next week must
   * already be worthless.
   */
  'agent.reveal.note':
    'Ini satu-satunya kali token ini dipaparkan. Ia sekali guna dan luput dalam {minutes} minit — kalau terlepas, jana yang baharu dari senarai.',
  'agent.reveal.hint':
    'Pemasang menukar token ini dengan kredensial kerja semasa pendaftaran. Kredensial itu ditulis ke {path} pada mesin tapak dan tidak pernah dipaparkan di sini.',

  'agent.reissue.title': 'Token pendaftaran baharu',
  /**
   * Says what is *not* happening, because that is the part that would stop a site collecting.
   *
   * Reissuing does not clear the working credential, so the connector already on site keeps
   * reporting attendance for however long it takes somebody to drive there.
   */
  'agent.reissue.note':
    'Connector yang sedang berjalan di tapak itu terus melaporkan kehadiran sampai pemasangan baharu mendaftar. Tiada apa dibatalkan sekarang.',

  'agent.revoke.title': 'Tarik kredensial connector?',
  'agent.revoke.description':
    'Connector itu berhenti dapat menghantar kehadiran serta-merta. Pelayan ini tidak akan menghubungi terminal di tapak itu sendiri, jadi tapak itu berhenti merekod sampai connector dipasang semula.',
  'agent.revoke.submit': 'Ya, tarik kredensial',
  'agent.revoked': 'Kredensial "{name}" ditarik.',

  'agent.delete.title': 'Buang connector?',
  /**
   * States what is lost, and it is little — which is the useful thing to say.
   *
   * A terminal cannot be deleted because scan history references it. A connector holds no
   * history: it is transport, and once no terminal points at it the row records nothing that
   * anything else needs. Saying so stops somebody keeping dead rows out of caution.
   */
  'agent.delete.description':
    'Baris ini tidak memegang sejarah — connector ialah pengangkut, dan tiada kehadiran merujuk kepadanya. Yang hilang ialah namanya dan bila ia terakhir dilihat. Untuk memasang tapak itu semula, cipta connector baharu.',
  'agent.delete.submit': 'Ya, buang',
  'agent.deleted': 'Connector "{name}" dibuang.',
  'agent.error.delete': 'Gagal membuang connector',

  // -------------------------------------------------------------------------
  // Tetapan › Integrasi › Token API
  // -------------------------------------------------------------------------
  'token.title': 'Token API',
  'token.subtitle':
    'Satu token untuk satu integrasi. Nilainya dipaparkan sekali sahaja semasa dikeluarkan.',
  'token.action.new': 'Token Baharu',
  'token.search': 'Cari nama atau prefiks…',
  'token.empty': 'Tiada token. Keluarkan satu bila ada integrasi yang perlu membaca data ini.',

  'token.error.load': 'Gagal memuatkan token',
  'token.error.revoke': 'Gagal membatalkan token',
  'token.error.rotate': 'Gagal memutar token',
  'token.error.remove': 'Gagal membuang token',
  'token.error.create': 'Gagal mencipta token',
  'token.notice.revoked': '{prefix} dibatalkan. Permintaan seterusnya dengan token itu ditolak.',
  'token.notice.removed': '{prefix} dibuang.',

  'token.hashNote':
    'Disimpan sebagai hash SHA-256, jadi dump pangkalan data tidak menyerahkan akses API dan nilainya tidak boleh dibaca semula walaupun oleh administrator. Kalau satu token hilang, {rotate} — itu sebabnya putaran ada sebagai tindakan sendiri.',
  'token.hashNote.rotate': 'putarkannya',

  'token.column.name': 'Nama',
  'token.column.scopes': 'Skop',
  'token.column.lastUsed': 'Guna terakhir',
  'token.column.expires': 'Luput',
  'token.row.neverUsed': 'Belum digunakan',
  'token.row.noExpiry': 'Tanpa luput',
  'token.row.view': 'Lihat butiran',
  'token.row.rotate': 'Putar token — ganti baharu, yang lama sah dalam tempoh rahmat',
  'token.row.rotate.blocked': 'Hanya token aktif boleh diputar',
  'token.row.revoke': 'Batalkan token — berkuat kuasa serta-merta',
  'token.row.revoke.done': 'Token ini sudah dibatalkan',
  'token.row.remove': 'Buang baris token',
  'token.row.remove.blocked': 'Batalkan dahulu sebelum boleh dibuang',
  'token.row.expand': 'butiran token',

  'token.detail.prefix': 'Prefiks',
  'token.detail.value': 'Nilai token',
  'token.detail.value.hashed': 'Disimpan sebagai hash — tidak boleh dipapar',
  'token.detail.requests': 'Jumlah permintaan',
  'token.detail.lastIp': 'Alamat terakhir',
  'token.detail.rate': 'Kadar minit ini',
  'token.detail.rate.none': 'Tiada permintaan',
  'token.detail.rate.count': '{count} permintaan',
  'token.detail.rotatedAt': 'Diputar pada',
  'token.detail.rotatedTo': 'Diganti oleh',
  'token.detail.graceEnds': 'Tempoh rahmat tamat',
  'token.detail.revokedAt': 'Dibatalkan',
  'token.detail.scopes': 'Skop',

  'token.reveal.new': 'Token API baharu',
  'token.reveal.rotated': 'Token pengganti',
  'token.reveal.label': 'Token',
  'token.reveal.note.new':
    'Ini satu-satunya kali nilai ini dipaparkan. Tiada endpoint memulangkannya semula.',
  'token.reveal.note.rotated':
    'Token lama masih sah dalam tempoh rahmat. Kemas kini integrasi anda sebelum ia tamat.',
  'token.reveal.note.rotated.until':
    'Token lama masih sah sehingga {until}. Kemas kini integrasi anda sebelum masa itu — selepas itu ia ditolak.',
  'token.reveal.hint': 'Hantar sebagai {bearer} atau {apiKey}.',

  'token.remove.title': 'Buang token "{name}"?',
  'token.remove.body':
    'Token ini sudah dibatalkan, jadi tiada integrasi yang masih boleh menggunakannya. Membuang barisnya menghilangkan rekod apa yang dibenarkannya, sedangkan log aktiviti masih merujuk prefiks {prefix}.',

  'token.create.title': 'Token API baharu',
  'token.create.description': 'Skop hanya baca. Tiada skop tulis ditawarkan.',
  'token.create.submit': 'Keluarkan token',
  'token.create.name': 'Nama',
  'token.create.name.hint':
    'Untuk siapa token ini. Nama yang jelas adalah satu-satunya cara mengetahui apa yang rosak bila anda membatalkannya.',
  'token.create.name.placeholder': 'cth. Portal HR — bacaan kehadiran',
  'token.create.name.aria': 'Nama token',
  'token.create.validity': 'Tempoh sah',
  'token.create.validity.hint':
    'Token tanpa luput kekal sah sampai ia dibatalkan secara manual, termasuk selepas orang yang mengeluarkannya bertukar tugas.',
  'token.create.days.aria': 'Bilangan hari',
  'token.create.days.unit': 'hari',
  'token.create.neverExpires': 'Tanpa tarikh luput',
  'token.create.scopes.chosen': '{count} dipilih',
  'token.create.scopes.note':
    'Hanya {view} dan {export} ditawarkan. Skop tulis akan membenarkan token mengubah kehadiran tanpa seorang pun dilampirkan pada perubahan itu, dan jejak audit dibina atas sentiasa ada seorang.',
  /** The scope catalogue arrives as a screen key plus a bare action; the dash is here. */
  'token.scope.label': '{screen} — {action}',

  'token.policy.note':
    'Putaran {notAutomatic}. Memutar kredensial statik pada pemasa akan memutuskan setiap integrasi yang memegangnya, secara senyap, pada waktu pemasa itu berbunyi. Sebaliknya: tekan putar, token baharu dikeluarkan, dan yang lama kekal sah selama {hours} jam supaya deployment boleh mengambil nilai baharu mengikut jadualnya sendiri. Tempoh itu ditetapkan dalam tab Keselamatan.',
  'token.policy.note.notAutomatic': 'tidak automatik',

  // -------------------------------------------------------------------------
  // Tetapan › Integrasi
  // -------------------------------------------------------------------------
  'integration.title': 'Integrasi',
  'integration.subtitle':
    'Saluran keluar untuk notifikasi dan akses luar. Kredensial disulitkan sebelum disimpan dan tidak pernah dipaparkan semula.',
  'integration.tabs.aria': 'Saluran integrasi',
  'integration.tab.email': 'Emel',
  'integration.tab.sms': 'SMS',
  'integration.tab.telegram': 'Telegram',
  'integration.tab.api': 'API & Webhook',
  'integration.tab.security': 'Keselamatan',
  'integration.tab.holidays': 'Cuti Umum',
  'integration.notice.saved': 'Tetapan integrasi disimpan.',

  /** Stated once above the tabs: it is a property of the deployment, not of a channel. */
  'integration.lan.note':
    '{emphasis} Semua saluran di bawah memerlukan internet. Pemasangan LAN direka supaya kehadiran terus berfungsi bila talian terputus — anggap saluran ini sebagai tambahan, bukan sesuatu yang boleh diharapkan. Perekodan kehadiran sendiri tidak bergantung padanya.',
  'integration.lan.note.emphasis': 'Mod semasa: direct (LAN).',

  'integration.holiday.title': 'Cuti Umum',
  'integration.holiday.subtitle':
    'Cuti kebangsaan dan negeri yang digunakan oleh pengiraan cuti, serta tarikh khusus organisasi.',
  'integration.holiday.group': 'Sumber Cuti',
  'integration.holiday.never': 'Belum pernah disync',
  'integration.holiday.enabled': 'Aktifkan cuti umum',
  'integration.holiday.enabled.hint':
    'Bila dimatikan, cuti umum tidak lagi dianggap hari cuti dalam pengiraan cuti. Hari rehat mingguan tetap terpakai.',
  'integration.holiday.autoSync': 'Auto-sync',
  'integration.holiday.autoSync.hint':
    'Menyegarkan senarai mengikut selang di bawah. Mematikannya membiarkan senarai sebagaimana adanya — ia tidak sama dengan mematikan cuti umum.',
  'integration.holiday.year': 'Tahun sync berjadual',
  'integration.holiday.year.hint':
    'Tahun yang auto-sync akan tarik. Butang Sync di bawah menggunakan tahun yang sedang dipapar, bukan yang ini.',
  'integration.holiday.cache': 'Segarkan setiap',
  'integration.holiday.cache.hint': 'Minit. 1440 bersamaan sehari. Sifar bermaksud setiap kali.',

  'integration.holiday.offices': 'Negeri tempat organisasi beroperasi',
  'integration.holiday.offices.count': '{count} daripada 16 dipilih',
  'integration.holiday.offices.note':
    'Tandakan setiap negeri yang organisasi ini ada pejabat. Sync menarik senarai bagi negeri-negeri ini dalam satu pusingan, dan hari yang disambut di lebih satu negeri disenaraikan sebagai kebangsaan.',
  'integration.holiday.offices.warning':
    'Hanya hari yang digazet oleh negeri yang ditanda akan ditulis. Ini penting: senarai "kebangsaan" pustaka itu termasuk Deepavali dan Hari Nuzul Al-Quran, yang Sarawak tidak gazet — menulisnya akan menjadikan dua hari bekerja setahun berhenti dikira sebagai hari bekerja dalam jadual yang dibahagi oleh payroll.',

  'integration.holiday.managed':
    'Cuti khusus organisasi — hari tutup, hari ganti — ditambah di {link}. Sync tidak sekali-kali menyentuhnya.',
  'integration.holiday.managed.link': 'Jadual › Cuti Umum',

  /*
    No year in it. The year dropdown sits immediately to the left of this button and is the year it
    syncs, so the number would be said twice — and a wrapped two-line button label reads as broken.
  */
  'integration.holiday.sync': 'Sync',
  'integration.holiday.synced': '{count} hari cuti disync untuk {year}.',
  'integration.holiday.dirty':
    'Simpan senarai negeri dahulu. Sync menyimpan cuti terhadap senarai yang disimpan, bukan tanda pada skrin.',
  'integration.holiday.error.list': 'Gagal memuatkan senarai cuti',
  'integration.holiday.error.sync': 'Sync cuti gagal',

  'integration.holiday.list.title': 'Cuti dalam {year} — {count} hari',
  'integration.holiday.list.hidden':
    '{count} lagi hari milik negeri yang tiada pejabat di sini, disembunyikan.',
  'integration.holiday.list.empty': 'Tiada cuti untuk tahun ini. Tekan Sync untuk menariknya.',
  'integration.holiday.list.year': 'Tahun dipapar',
  'integration.holiday.list.scope': 'Skop senarai',
  'integration.holiday.list.scope.offices': 'Pejabat kita',
  'integration.holiday.list.scope.all': 'Semua negeri',

  'integration.holiday.column.date': 'Tarikh',
  'integration.holiday.column.day': 'Hari',
  'integration.holiday.column.name': 'Cuti',
  'integration.holiday.column.type': 'Jenis',
  'integration.holiday.column.states': 'Negeri',
  'integration.holiday.type.national': 'Kebangsaan',
  'integration.holiday.type.state': 'Negeri',
  'integration.holiday.type.company': 'Organisasi',
  'integration.holiday.allStates': 'Semua pejabat',

  'integration.holiday.timezone': 'Zon waktu pengiraan: {timezone}',

  // -------------------------------------------------------------------------
  // Tetapan › Integrasi › API & Webhook
  // -------------------------------------------------------------------------
  'api.subtitle': 'Peraturan akses untuk API awam, dan langganan webhook keluar.',
  'api.error.load': 'Gagal memuatkan konfigurasi API',
  'api.state.on': 'Dihidupkan',
  'api.state.off': 'Dimatikan',
  'api.notice.saved.on': 'Konfigurasi disimpan. API awam kini menjawab permintaan.',
  'api.notice.saved.off':
    'Konfigurasi disimpan. API awam dimatikan — setiap endpointnya menjawab 404.',

  'api.wideOpen':
    'Gabungan ini {emphasis}: dihidupkan, tiada token diperlukan, dan tiada senarai putih IP bermakna keseluruhan direktori staf terbuka kepada apa-apa yang boleh menghubungi port ini. Hidupkan “Perlukan token”, atau hadkan kepada alamat tertentu.',
  'api.wideOpen.emphasis': 'tidak akan disimpan',

  'api.access.group': 'Akses',
  'api.access.answering': 'Menjawab',
  'api.access.silent': '404',
  'api.access.note':
    'Bila dimatikan, setiap endpoint menjawab {code} dan bukan 403. Endpoint yang mengaku ia wujud adalah endpoint yang berbaloi dicuba lagi dengan senarai perkataan yang lebih panjang.',
  'api.requireToken': 'Perlukan token',
  'api.requireToken.hint':
    'Tanpa ini sesiapa yang boleh menghubungi port ini boleh membaca. Hanya berpatutan di belakang senarai putih IP pada VLAN terpencil.',
  'api.requireToken.switch': 'Setiap permintaan mesti membawa token',
  'api.logRequests': 'Log setiap permintaan',
  'api.logRequests.hint':
    'Penolakan sentiasa dilog walaupun ini dimatikan — tetapan ini hanya mengawal bunyi trafik yang berjaya.',
  'api.logRequests.switch': 'Rekod permintaan yang berjaya',
  'api.baseUrl': 'Alamat asas',
  'api.baseUrl.hint': 'Laluan yang pemanggil patut tuju.',

  'api.endpoints.group': 'Endpoint Tersedia',
  'api.endpoints.subtitle': 'Baca-sahaja, dan kecil dengan sengaja.',
  'api.endpoints.count': '{count} endpoint',
  'api.endpoints.privacy':
    'Nombor kad pengenalan, telefon, emel dan sebab cuti tidak dihantar: itu data peribadi tanpa tujuan yang dinyatakan di sini.',
  /**
   * One endpoint's requirement is prose rather than a scope name, so the route sends this
   * key beside the literal scopes. The others are stored values an operator matches
   * character for character and are not translated.
   */
  'api.scope.anyToken': 'mana-mana token sah',

  'api.rate.group': 'Had Kadar & Penapis IP',
  'api.rate.subtitle': 'Dikira per token di mana ada token, per alamat kalau tidak.',
  'api.rate.summary.limited': '{count}/min',
  'api.rate.summary.unlimited': 'tiada had',
  'api.rate.summary.whitelist': ' · {count} alamat dibenarkan',
  'api.rate.enable': 'Hadkan kadar permintaan',
  'api.rate.perMinute': 'Permintaan per minit',
  'api.rate.perMinute.hint':
    'Satu integrasi yang bising tidak boleh menghabiskan peruntukan yang lain, sebab kiraan diikat pada token dan bukan pada alamat.',
  'api.rate.perMinute.unit': 'per minit',
  'api.whitelist': 'Senarai putih IP',
  'api.whitelist.hint':
    'Satu alamat atau CIDR per baris, IPv4 atau IPv6. Kosong bermakna tiada sekatan alamat.',
  'api.whitelist.empty': 'Kosong: mana-mana alamat boleh mencuba.',
  'api.whitelist.count':
    '{count} entri. Alamat di luar senarai ini menerima 404, bukan 403 — alamat yang tidak dibenarkan tidak patut belajar endpoint itu wujud.',

  'api.cors.group': 'CORS',
  'api.cors.subtitle': 'Origin yang dibenarkan memanggil dari dalam penyemak imbas.',
  'api.cors.summary.all': 'semua origin',
  'api.cors.summary.listed': '{count} disenaraikan',
  'api.cors.note':
    'CORS dikuatkuasakan oleh {browser}, bukan oleh pelayan ini. Ia menyekat halaman yang berjalan dalam penyemak imbas seseorang dan tidak melakukan apa-apa kepada pemanggil pelayan-ke-pelayan. Ini {notAccessControl} — token dan senarai putih IP di atas itulah kawalannya.',
  'api.cors.note.browser': 'penyemak imbas',
  'api.cors.note.notAccessControl': 'bukan kawalan akses',
  'api.cors.allowAll': 'Benarkan semua origin',
  'api.cors.allowAll.hint': 'Menghantar Access-Control-Allow-Origin: *',
  'api.cors.origins': 'Origin dibenarkan',
  'api.cors.origins.hint':
    'Satu per baris, skema dan host tanpa laluan. Contoh: https://portal.hospital.local',

  'api.install.group': 'Pemasangan',
  'api.install.mode': 'Mod sambungan',
  'api.install.mode.hint': 'Ditetapkan dalam fail persekitaran, bukan di sini.',
  'api.install.mode.lanNote':
    'Pada pemasangan LAN, API ini hanya boleh dicapai dari dalam rangkaian hospital untuk bermula dengan. Itu mengubah nilai setiap tetapan di atas, jadi ia dinyatakan dan bukan diandaikan.',

  'api.save': 'Simpan konfigurasi',
  'api.save.hint.on': 'Berkuat kuasa dalam satu saat. Token yang sudah dikeluarkan tidak berubah.',
  'api.save.hint.off':
    'API dimatikan: tetapan disimpan tetapi setiap endpoint awam menjawab 404.',

  // -------------------------------------------------------------------------
  // Pencetus notifikasi
  //
  // `server/notify/triggers.ts` holds these keys. Only events this system actually raises
  // are listed — a switch for something that never fires reads as a broken feature rather
  // than an absent one.
  //
  // `triggerLabel()` resolves the source wording for the message body a dispatch writes.
  // That goes out over SMS or Telegram, which has no reader whose language is known.
  // -------------------------------------------------------------------------
  'trigger.leave.requested': 'Permohonan cuti baharu',
  'trigger.leave.requested.detail':
    'Nama pemohon, jenis cuti, tempoh dan bilangan hari bekerja yang dicaj.',
  'trigger.leave.approved': 'Cuti diluluskan',
  'trigger.leave.approved.detail':
    'Siapa yang diluluskan, oleh siapa, dan berapa hari kalendar ditulis ke roster.',
  'trigger.leave.rejected': 'Cuti ditolak',
  'trigger.leave.rejected.detail':
    'Sebab penolakan disertakan — itu satu-satunya perkara pemohon boleh tindak.',
  'trigger.leave.cancelled': 'Cuti dibatalkan',
  'trigger.leave.cancelled.detail': 'Termasuk peringatan bahawa shift asal tidak dipulihkan.',
  'trigger.overtime.approved': 'Lebih masa diluluskan',
  'trigger.overtime.approved.detail':
    'Kadar yang dipilih dan jumlah yang perlu dibayar. Kelulusan pada aras pertengahan berkata masih menunggu, bukan diluluskan.',
  'trigger.overtime.rejected': 'Lebih masa ditolak',
  'trigger.overtime.rejected.detail': 'Sebab penolakan disertakan.',
  'trigger.claim.approved': 'Tuntutan diluluskan',
  'trigger.claim.approved.detail':
    'Jumlah yang diluluskan, yang boleh kurang daripada yang dituntut apabila had kategori dikenakan.',
  'trigger.claim.rejected': 'Tuntutan ditolak',
  'trigger.claim.rejected.detail': 'Sebab penolakan disertakan.',
  'trigger.expense.approved': 'Perbelanjaan diluluskan',
  'trigger.expense.approved.detail':
    'Termasuk nama penerima, supaya bayaran boleh disemak terhadap penyata bank.',
  'trigger.expense.rejected': 'Perbelanjaan ditolak',
  'trigger.expense.rejected.detail': 'Sebab penolakan disertakan.',
  'trigger.applicant.offered': 'Tawaran jawatan diluluskan',
  'trigger.applicant.offered.detail':
    'Dihantar kepada calon, bukan staf. Kelulusan aras pertengahan berkata masih menunggu — tawaran yang belum penuh diluluskan belum dibuat.',
  'trigger.applicant.rejected': 'Permohonan jawatan tidak berjaya',
  'trigger.applicant.rejected.detail': 'Perkataannya penting: penerima ialah orang luar.',
  'trigger.attendance.exception': 'Pengecualian kehadiran',
  'trigger.attendance.exception.detail':
    'Hari yang enjin tidak dapat selesaikan. Berisiko bising — satu terminal yang rosak boleh menjana beratus dalam sehari.',
  'trigger.device.offline': 'Terminal hilang sambungan',
  'trigger.device.offline.detail': 'Scan semasa tidak diterima sehingga sambungan kembali.',
  'trigger.device.clockDrift': 'Jam terminal tersasar',
  'trigger.device.clockDrift.detail':
    'Satu-satunya kerosakan yang merosakkan setiap rekod tanpa menghasilkan ralat di mana-mana. Patut dihidupkan.',
  'trigger.payroll.exported': 'Export payroll dijana',
  'trigger.payroll.exported.detail':
    'Siapa yang menjananya, tempoh mana, dan berapa pengecualian belum selesai.',

  'trigger.payroll.paid': 'Gaji dibayar',
  'trigger.payroll.paid.detail':
    'Satu mesej kepada setiap orang yang dibayar, dengan gaji bersih dan nombor slip. Dibangkitkan apabila tempoh ditanda dibayar, bukan apabila diluluskan — kelulusan tidak menggerakkan wang.',
  'trigger.payroll.awardDecided': 'Bonus atau komisen diputuskan',
  'trigger.payroll.awardDecided.detail':
    'Amaun, tempoh yang akan membayarnya, dan catatan keputusan.',
  'trigger.payroll.lendingApproved': 'Pinjaman atau pendahuluan diluluskan',
  'trigger.payroll.lendingApproved.detail':
    'Ansuran bulanan dan tarikh potongan pertama — potongan yang muncul tanpa amaran terbaca sebagai kesilapan.',
  'trigger.kpi.reviewAssigned': 'Penilaian ditugaskan',
  'trigger.kpi.reviewAssigned.detail':
    'Kepada penilai: siapa yang perlu dinilai, templat mana, dan tarikh jatuh tempo.',
  'trigger.kpi.finalised': 'Penilaian dimuktamadkan',
  'trigger.kpi.finalised.detail': 'Kepada orang yang dinilai: markah, gred, dan nama penilai.',
  'trigger.justification.decided': 'Justifikasi kehadiran diputuskan',
  'trigger.justification.decided.detail':
    'Kepada staf yang menghantar sebab: diluluskan, ditolak, atau dihantar semula untuk diperbaiki. Tiada notifikasi bagi penghantaran — penyelia melihat kiraan hidup pada menu, dan satu mesej per penghantaran akan sampai berpuluh serentak pada awal bulan.',
  'trigger.notWired': 'belum disambung',

  // -------------------------------------------------------------------------
  // Primitif borang saluran
  //
  // Shared by every integration tab, so they sit here rather than under whichever channel
  // happened to need them first.
  // -------------------------------------------------------------------------
  'channel.on': 'Dihidupkan',
  'channel.off': 'Dimatikan',
  'channel.toggle': 'Hidupkan saluran',
  'channel.test.never': 'Belum diuji.',
  'channel.test.ok': 'Berjaya',
  'channel.test.failed': 'Gagal',

  // -------------------------------------------------------------------------
  // Payroll & Pampasan
  //
  // Seven screens under `pay.*`, kept apart from `payroll.*` — that group is the attendance
  // export a payroll clerk consumes, this one is the module that pays people.
  // -------------------------------------------------------------------------

  /**
   * The statuses, as the vocabulary the records are written in.
   *
   * `pay.status.*` is the period's own progression; `pay.state.*` is what a payslip or an
   * award is. Kept apart because they read differently: a period is "diluluskan" as a batch,
   * a loan is "aktif" as a standing arrangement, and the same word in both places would be
   * wrong in one of them.
   */
  'pay.status.draft': 'Draf',
  'pay.status.processing': 'Diproses',
  'pay.status.approved': 'Diluluskan',
  'pay.status.paid': 'Dibayar',
  'pay.status.closed': 'Ditutup',

  'pay.state.draft': 'Draf',
  'pay.state.pending': 'Menunggu',
  'pay.state.approved': 'Diluluskan',
  'pay.state.active': 'Aktif',
  'pay.state.completed': 'Selesai',
  'pay.state.paid': 'Dibayar',
  'pay.state.cancelled': 'Dibatalkan',

  /** Kinds of award, and how money left the building. */
  'pay.bonusType.performance': 'Prestasi',
  'pay.bonusType.annual': 'Tahunan',
  'pay.bonusType.festival': 'Perayaan',
  'pay.bonusType.project': 'Projek',
  'pay.bonusType.attendance': 'Kehadiran',
  'pay.bonusType.other': 'Lain-lain',

  'pay.commissionType.sales': 'Jualan',
  'pay.commissionType.project': 'Projek',
  'pay.commissionType.referral': 'Rujukan',
  'pay.commissionType.other': 'Lain-lain',

  'pay.method.bank_transfer': 'Pindahan bank',
  'pay.method.cash': 'Tunai',
  'pay.method.cheque': 'Cek',

  /** How an allowance is worked out. Two words that change what a number means. */
  'pay.calcMode.fixed': 'Amaun tetap (RM)',
  'pay.calcMode.percentOfBasic': 'Peratus gaji asas (%)',

  // ── Refusals the engine names, resolved on screen ──
  'pay.settings.fault.percent': 'Kadar mesti antara 0 dan 100.',
  'pay.settings.fault.amount': 'Amaun mesti antara 0 dan 1,000,000.',
  'pay.settings.fault.payDay': 'Hari bayaran mesti hari dalam bulan, 1 hingga 31.',
  'pay.settings.fault.step':
    'Kadar majikan di atas ambang tidak boleh melebihi kadar di bawahnya. Langkah statutori pada ambang itu turun, bukan naik.',
  'pay.period.fault.status': 'Status tempoh tidak dikenali.',
  'pay.period.fault.transition':
    'Urutan status adalah draf → proses → lulus → bayar → tutup, tanpa jalan balik.',
  'pay.payslip.fault.gross': 'Baris pendapatan tidak berjumlah kepada gaji kasar.',
  'pay.payslip.fault.deductions': 'Baris potongan tidak berjumlah kepada jumlah potongan.',
  'pay.payslip.fault.net': 'Gaji kasar tolak potongan tidak sama dengan gaji bersih.',

  // -------------------------------------------------------------------------
  // Payroll › Tempoh Payroll
  // -------------------------------------------------------------------------
  'pay.period.title': 'Tempoh Payroll',
  'pay.period.subtitle':
    'Satu pusingan gaji, dan sejauh mana ia sudah bergerak. Jam datang daripada Export Payroll — tempoh ini tidak mengira jam sendiri, kerana dua enjin yang mengira jam yang sama menghasilkan dua jawapan yang tiada siapa rekonsil.',
  'pay.period.tab.periods': 'Tempoh',
  'pay.period.tab.payslips': 'Slip Gaji',

  'pay.period.action.add': 'Tempoh baharu',
  'pay.period.action.process': 'Proses',
  'pay.period.action.approve': 'Luluskan',
  'pay.period.action.pay': 'Tanda dibayar',
  'pay.period.action.close': 'Tutup',
  'pay.period.action.export': 'Export CSV',
  'pay.period.action.remove': 'Buang tempoh',

  'pay.period.column.code': 'Kod',
  'pay.period.column.range': 'Julat',
  'pay.period.column.payment': 'Tarikh bayar',
  'pay.period.column.staff': 'Slip',
  'pay.period.column.gross': 'Kasar (RM)',
  'pay.period.column.deductions': 'Potongan (RM)',
  'pay.period.column.net': 'Bersih (RM)',

  'pay.period.empty': 'Tiada tempoh payroll. Cipta satu untuk mula.',
  'pay.period.error.load': 'Senarai tempoh tidak dapat dimuatkan.',
  'pay.period.range': '{from} hingga {to}',
  'pay.period.filter.year': 'Semua tahun',

  'pay.period.stat.periods': 'Tempoh',
  'pay.period.stat.periods.hint': '{draft} masih draf',
  'pay.period.stat.gross': 'Kasar tahun ini',
  'pay.period.stat.gross.hint': 'jumlah semua tempoh dipaparkan',
  'pay.period.stat.net': 'Bersih tahun ini',
  'pay.period.stat.net.hint': 'selepas potongan pekerja',
  'pay.period.stat.employer': 'Kos majikan',
  'pay.period.stat.employer.hint': 'KWSP, PERKESO dan SIP bahagian majikan',

  'pay.period.note.oneWay':
    'Urutannya satu hala: draf → proses → lulus → bayar → tutup. Draf boleh diproses semula seberapa kali — itu yang membolehkan jam terminal yang dibetulkan atau pemetaan identiti yang diperbaiki masuk semula. Selepas diluluskan, angka itu ialah rekod, dan kesilapan dibetulkan sebagai pelarasan dalam tempoh berikutnya.',
  'pay.period.note.unreviewed':
    'Kadar statutori (KWSP, PERKESO, SIP) belum disahkan terhadap jadual semasa. Setiap potongan dikira daripada nilai lalai. Sahkan di Tetapan Payroll sebelum tempoh dibayar.',
  'pay.period.note.reviewLink': 'Buka Tetapan Payroll',

  'pay.period.form.title': 'Tempoh payroll baharu',
  'pay.period.form.edit': 'Sunting tempoh',
  'pay.period.form.name': 'Nama tempoh',
  'pay.period.form.name.hint': 'Apa yang orang panggil pusingan ini, cth. "Gaji Ogos 2026".',
  'pay.period.form.year': 'Tahun',
  'pay.period.form.month': 'Bulan',
  'pay.period.form.month.hint':
    'Menamakan pusingan dan menyusun senarai. Ia bukan sempadan tempoh — julat di bawah itu yang menentukan hari mana dibayar.',
  'pay.period.form.from': 'Dari tarikh',
  'pay.period.form.to': 'Hingga tarikh',
  'pay.period.form.range.hint':
    'Pusingan 26 hingga 25 adalah biasa, jadi julat ini bebas daripada bulan di atas.',
  'pay.period.form.payment': 'Tarikh bayaran',
  'pay.period.form.note': 'Nota',
  'pay.period.form.submit': 'Cipta tempoh',

  'pay.period.process.title': 'Proses tempoh {code}',
  'pay.period.process.body':
    'Ini membina semula setiap slip gaji dalam tempoh ini. Slip daripada larian sebelumnya dibuang, dan ansuran pinjaman serta pendahuluan yang dipotong oleh larian itu dipulangkan dahulu supaya ia tidak dipotong dua kali.',
  'pay.period.process.submit': 'Proses sekarang',
  'pay.period.process.done':
    '{staff} slip gaji dibina. Kasar RM{gross}, potongan RM{deductions}, bersih RM{net}.',
  'pay.period.process.skipped':
    '{count} staf aktif tiada gaji asas dan dilangkau. Mereka tidak akan mendapat slip sampai gaji asas direkodkan pada rekod staf.',

  'pay.period.approve.title': 'Luluskan tempoh {code}',
  'pay.period.approve.body':
    'Setiap slip disemak supaya barisnya berjumlah kepada angka bersihnya sebelum apa-apa diluluskan. Selepas ini angka itu ialah rekod — tiada jalan balik, dan pembetulan dibuat sebagai pelarasan dalam tempoh berikutnya.',
  'pay.period.approve.submit': 'Luluskan tempoh',
  'pay.period.approve.done': '{count} slip gaji diluluskan.',

  'pay.period.pay.title': 'Tanda tempoh {code} dibayar',
  'pay.period.pay.body':
    'Rujukan di bawah ialah apa yang merekonsil pindahan pukal dengan slip yang ia liputi, jadi ia disimpan pada lajurnya sendiri dan bukan di dalam nota.',
  'pay.period.pay.method': 'Cara bayaran',
  'pay.period.pay.reference': 'Rujukan bayaran',
  'pay.period.pay.reference.placeholder': 'cth. no. batch pindahan bank',
  'pay.period.pay.submit': 'Tanda dibayar',

  'pay.period.close.title': 'Tutup tempoh {code}',
  'pay.period.close.body':
    'Tempoh yang ditutup dikunci untuk audit. Tiada tulisan diterima selepas ini — bukan pada tempoh, dan bukan pada mana-mana slip di dalamnya.',
  'pay.period.close.submit': 'Tutup tempoh',

  'pay.period.remove.title': 'Buang tempoh {code}',
  'pay.period.remove.body':
    'Hanya draf boleh dibuang, dan draf tiada slip yang berbaloi disimpan. Selebihnya adalah rekod gaji yang sudah dikira.',

  'pay.period.note.processFirst': 'Proses tempoh dahulu — tiada slip gaji untuk diluluskan.',
  'pay.period.note.notDraft': 'Hanya draf boleh diproses semula atau dibuang.',

  // -------------------------------------------------------------------------
  // Payroll › Slip Gaji
  // -------------------------------------------------------------------------
  'pay.payslip.title': 'Slip Gaji',
  'pay.payslip.subtitle':
    'Satu baris setiap orang, untuk tempoh yang dipilih. Setiap angka disimpan sebagaimana ia dikira — kadar statutori berubah dengan pengumuman kerajaan, jadi slip yang dikira semula tahun depan tidak akan sepadan dengan yang dibayar.',
  'pay.payslip.filter.period': 'Pilih tempoh',
  'pay.payslip.filter.department': 'Semua jabatan',
  'pay.payslip.empty': 'Tiada slip gaji. Proses tempoh untuk menjananya.',
  'pay.payslip.error.load': 'Slip gaji tidak dapat dimuatkan.',
  'pay.payslip.selectPeriod': 'Pilih tempoh payroll untuk melihat slipnya.',

  'pay.payslip.column.no': 'No. Slip',
  'pay.payslip.column.staff': 'Staf',
  'pay.payslip.column.department': 'Jabatan',
  'pay.payslip.column.basic': 'Asas',
  'pay.payslip.column.allowance': 'Elaun',
  'pay.payslip.column.overtime': 'Lebih masa',
  'pay.payslip.column.gross': 'Kasar',
  'pay.payslip.column.deductions': 'Potongan',
  'pay.payslip.column.net': 'Bersih',

  'pay.payslip.action.open': 'Buka slip',
  'pay.payslip.detail.title': 'Slip {no}',
  'pay.payslip.detail.earnings': 'Pendapatan',
  'pay.payslip.detail.deductions': 'Potongan',
  'pay.payslip.detail.employer': 'Bahagian majikan',
  'pay.payslip.detail.attendance': 'Kehadiran dalam tempoh',
  'pay.payslip.detail.gross': 'Gaji kasar',
  'pay.payslip.detail.totalDeductions': 'Jumlah potongan',
  'pay.payslip.detail.net': 'Gaji bersih',
  'pay.payslip.detail.epfWages': 'Upah bercarum KWSP',
  'pay.payslip.detail.contributoryWages': 'Upah bulanan biasa',
  'pay.payslip.detail.wages.hint':
    'Lebih masa tiada dalam kedua-duanya. PERKESO dan SIP dikenakan atas upah bulanan biasa sahaja.',
  'pay.payslip.detail.scheduledDays': 'Hari dijadualkan',
  'pay.payslip.detail.presentDays': 'Hari hadir',
  'pay.payslip.detail.absentDays': 'Hari tidak hadir',
  'pay.payslip.detail.leaveDays': 'Hari bercuti',
  'pay.payslip.detail.overtimeHours': 'Jam lebih masa diluluskan',
  'pay.payslip.detail.attendance.hint':
    'Disimpan pada slip ini, bukan dibaca semula. Selepas roster berubah, slip masih boleh disemak terhadap dirinya sendiri.',
  'pay.payslip.detail.balanceFault':
    'Slip ini tidak seimbang: {reason} Proses tempoh semula sebelum meluluskan.',
  'pay.payslip.form.tax': 'PCB (RM)',
  'pay.payslip.form.tax.hint':
    'Sistem tidak mengira PCB. Ia bergantung pada pelepasan yang diisytiharkan, status perkahwinan dan tanggungan di bawah jadual LHDN — angka yang diteka memotong kurang dan pekerja yang menerima bilnya.',
  'pay.payslip.form.other': 'Potongan lain (RM)',
  'pay.payslip.form.other.hint': 'Sebarang potongan sekali sahaja yang tiada barisnya sendiri.',
  'pay.payslip.form.note': 'Nota',

  // -------------------------------------------------------------------------
  // Payroll › Elaun
  // -------------------------------------------------------------------------
  'pay.allowance.title': 'Elaun',
  'pay.allowance.subtitle':
    'Elaun tetap, dan katalog jenis yang menentukan cara setiap satu dikira. Katalog dan bukan lajur tetap: jenis elaun kelima sepatutnya satu baris, bukan satu keluaran.',
  'pay.allowance.tab.staff': 'Elaun Staf',
  'pay.allowance.tab.types': 'Jenis Elaun',

  'pay.allowance.type.section': 'Katalog jenis elaun',
  'pay.allowance.type.subtitle':
    'Apa yang organisasi bayar, dan sama ada ia menyumbang kepada upah bercarum KWSP. Bayaran balik perjalanan bukan upah; elaun rumah adalah.',
  'pay.allowance.type.action.add': 'Jenis baharu',
  'pay.allowance.type.column.code': 'Kod',
  'pay.allowance.type.column.name': 'Nama',
  'pay.allowance.type.column.mode': 'Cara kiraan',
  'pay.allowance.type.column.default': 'Lalai',
  'pay.allowance.type.column.epf': 'KWSP',
  'pay.allowance.type.column.used': 'Digunakan',
  'pay.allowance.type.empty': 'Tiada jenis elaun. Cipta satu sebelum menetapkan elaun staf.',
  'pay.allowance.type.error.load': 'Katalog jenis elaun tidak dapat dimuatkan.',
  'pay.allowance.type.epf.yes': 'Bercarum',
  'pay.allowance.type.epf.no': 'Dikecualikan',
  'pay.allowance.type.usage': '{count} staf',
  'pay.allowance.type.inUse':
    'Digunakan oleh {count} elaun staf — cara kiraan dan status KWSP dibekukan.',

  'pay.allowance.type.form.title': 'Jenis elaun baharu',
  'pay.allowance.type.form.edit': 'Sunting jenis elaun',
  'pay.allowance.type.form.code': 'Kod',
  'pay.allowance.type.form.name': 'Nama',
  'pay.allowance.type.form.description': 'Keterangan',
  'pay.allowance.type.form.mode': 'Cara kiraan',
  'pay.allowance.type.form.mode.hint':
    'Peratus dikira atas gaji asas sahaja, bukan atas elaun lain — jika tidak, susunan bacaan akan menukar amaun yang dibayar.',
  'pay.allowance.type.form.default': 'Amaun lalai',
  'pay.allowance.type.form.default.hint': 'Ditawarkan pada borang. Baris per-staf boleh berbeza.',
  'pay.allowance.type.form.epf': 'Menyumbang kepada upah KWSP',
  'pay.allowance.type.form.epf.hint':
    'Dihidupkan secara lalai, arah yang lebih berhati-hati: menyumbang kurang adalah masalah yang pekerja temui bertahun kemudian.',
  'pay.allowance.type.form.taxable': 'Tertakluk cukai',
  'pay.allowance.type.form.active': 'Aktif',
  'pay.allowance.type.form.frozen':
    'Jenis ini sudah digunakan. Cara kiraan dan status KWSP tidak boleh diubah — ia akan menukar amaun yang sudah dibayar. Nyahaktifkan dan cipta yang baharu.',

  'pay.allowance.section': 'Elaun staf',
  'pay.allowance.section.subtitle':
    'Berulang secara sifatnya, jadi tiada pautan tempoh: setiap larian mengambil baris yang aktif dan yang tarikh mulanya sudah sampai.',
  'pay.allowance.action.add': 'Tetapkan elaun',
  'pay.allowance.column.staff': 'Staf',
  'pay.allowance.column.type': 'Jenis',
  'pay.allowance.column.value': 'Nilai',
  'pay.allowance.column.resolved': 'Dibayar (RM)',
  'pay.allowance.column.window': 'Berkuat kuasa',
  'pay.allowance.empty': 'Tiada elaun staf ditetapkan.',
  'pay.allowance.error.load': 'Senarai elaun tidak dapat dimuatkan.',
  'pay.allowance.window.open': 'dari {from}',
  'pay.allowance.window.closed': '{from} – {to}',
  'pay.allowance.percentOf': '{percent}% asas',

  'pay.allowance.form.title': 'Tetapkan elaun',
  'pay.allowance.form.edit': 'Sunting elaun',
  'pay.allowance.form.staff': 'Staf',
  'pay.allowance.form.type': 'Jenis elaun',
  'pay.allowance.form.value': 'Nilai',
  'pay.allowance.form.value.fixed': 'Amaun sebulan dalam RM.',
  'pay.allowance.form.value.percent': 'Peratus gaji asas. Tidak boleh melebihi 100.',
  'pay.allowance.form.from': 'Berkuat kuasa dari',
  'pay.allowance.form.from.hint':
    'Dibandingkan dengan tempoh. Elaun bertarikh kuarter depan tidak akan dibayar sebelum tarikh itu.',
  'pay.allowance.form.to': 'Berkuat kuasa hingga',
  'pay.allowance.form.to.hint': 'Biarkan kosong untuk elaun yang berterusan.',
  'pay.allowance.form.active': 'Aktif',
  'pay.allowance.form.note': 'Nota',

  'pay.allowance.remove.title': 'Buang elaun',
  'pay.allowance.remove.body':
    'Ini membuang pengaturan ke hadapan sahaja. Slip gaji yang sudah membayar elaun ini kekal seperti dibayar — angkanya disimpan pada slip itu.',

  // -------------------------------------------------------------------------
  // Payroll › Bonus dan Komisen
  //
  // One set of labels for both screens would need the words to be interchangeable, and
  // "bonus" and "komisen" are not. Separate keys, same structure.
  // -------------------------------------------------------------------------
  'pay.bonus.title': 'Bonus',
  'pay.bonus.subtitle':
    'Bayaran sekali, terikat pada tempoh yang membayarnya. Bonus yang diluluskan tanpa tempoh tidak akan dibayar — larian membaca rekod mengikut tempoh.',
  'pay.bonus.action.add': 'Bonus baharu',
  'pay.bonus.action.generate': 'Jana daripada KPI',
  'pay.bonus.column.reference': 'Rujukan',
  'pay.bonus.column.staff': 'Staf',
  'pay.bonus.column.kind': 'Jenis',
  'pay.bonus.column.name': 'Keterangan',
  'pay.bonus.column.amount': 'Amaun (RM)',
  'pay.bonus.column.date': 'Tarikh',
  'pay.bonus.column.period': 'Tempoh',
  'pay.bonus.empty': 'Tiada bonus direkodkan.',
  'pay.bonus.error.load': 'Senarai bonus tidak dapat dimuatkan.',
  'pay.bonus.fromAppraisal': 'daripada penilaian',
  'pay.bonus.noPeriod': 'tiada tempoh',

  'pay.bonus.form.title': 'Bonus baharu',
  'pay.bonus.form.edit': 'Sunting bonus',
  'pay.bonus.form.staff': 'Staf',
  'pay.bonus.form.kind': 'Jenis bonus',
  'pay.bonus.form.name': 'Keterangan',
  'pay.bonus.form.amount': 'Amaun (RM)',
  'pay.bonus.form.date': 'Tarikh dianugerahkan',
  'pay.bonus.form.period': 'Tempoh payroll',
  'pay.bonus.form.period.hint':
    'Tempoh yang akan membayarnya. Boleh dibiarkan kosong sementara, tetapi kelulusan memerlukannya.',
  'pay.bonus.form.note': 'Nota',

  'pay.bonus.generate.title': 'Jana bonus daripada gred KPI',
  'pay.bonus.generate.body':
    'Setiap penilaian yang dimuktamadkan dalam tempoh KPI yang dipilih menghasilkan satu baris bonus yang masih perlu diluluskan. Gred membawa faktor, baris membawa amaun — itu bezanya antara bonus yang HR boleh tahan atau jadualkan semula dan bonus yang muncul entah dari mana pada hari gaji.',
  'pay.bonus.generate.kpiPeriod': 'Tempoh KPI',
  'pay.bonus.generate.period': 'Tempoh payroll',
  'pay.bonus.generate.submit': 'Jana bonus',
  'pay.bonus.generate.done':
    '{created} bonus dijana sebagai menunggu kelulusan. {existing} sudah ada, {noGrade} tiada faktor gred, {noSalary} tiada gaji asas.',

  'pay.commission.title': 'Komisen',
  'pay.commission.subtitle':
    'Bayaran sekali, terikat pada tempoh yang membayarnya. Berasingan daripada bonus kerana ia diberi oleh orang berbeza atas sebab berbeza, dan registri kebenaran memisahkannya.',
  'pay.commission.action.add': 'Komisen baharu',
  'pay.commission.column.reference': 'Rujukan',
  'pay.commission.column.staff': 'Staf',
  'pay.commission.column.kind': 'Jenis',
  'pay.commission.column.name': 'Keterangan',
  'pay.commission.column.amount': 'Amaun (RM)',
  'pay.commission.column.date': 'Tarikh',
  'pay.commission.column.period': 'Tempoh',
  'pay.commission.empty': 'Tiada komisen direkodkan.',
  'pay.commission.error.load': 'Senarai komisen tidak dapat dimuatkan.',

  'pay.commission.form.title': 'Komisen baharu',
  'pay.commission.form.edit': 'Sunting komisen',
  'pay.commission.form.staff': 'Staf',
  'pay.commission.form.kind': 'Jenis komisen',
  'pay.commission.form.name': 'Keterangan',
  'pay.commission.form.amount': 'Amaun (RM)',
  'pay.commission.form.date': 'Tarikh diperoleh',
  'pay.commission.form.period': 'Tempoh payroll',
  'pay.commission.form.note': 'Nota',

  /** The decision dialog, shared by both award screens: the act is identical. */
  'pay.award.approve.title': 'Luluskan {reference}',
  'pay.award.approve.body':
    'Kelulusan menjadikan ini boleh dibayar oleh tempoh yang dinamakan. Amaun tidak boleh diubah selepas ini — ia mungkin sudah berada pada slip gaji.',
  'pay.award.approve.submit': 'Luluskan',
  'pay.award.cancel.title': 'Batalkan {reference}',
  'pay.award.cancel.body':
    'Membatalkan menghalangnya daripada dibayar. Yang sudah dibayar tidak boleh dibatalkan — buat pelarasan dalam tempoh berikutnya supaya ada jejaknya.',
  'pay.award.cancel.submit': 'Batalkan',
  'pay.award.note': 'Nota keputusan',
  'pay.award.remove.title': 'Buang {reference}',
  'pay.award.remove.body':
    'Hanya rekod yang menunggu atau dibatalkan boleh dibuang. Membuang barisan yang diluluskan menghilangkan rekod apa yang diluluskan.',
  'pay.award.locked': 'Hanya rekod yang menunggu keputusan boleh disunting.',

  // -------------------------------------------------------------------------
  // Payroll › Pinjaman dan Pendahuluan Gaji
  // -------------------------------------------------------------------------
  'pay.loan.title': 'Pinjaman',
  'pay.loan.subtitle':
    'Pinjaman yang dibayar balik melalui ansuran daripada gaji. Baki dipindahkan oleh larian payroll di dalam transaksi yang sama dengan slip yang memotongnya — di luar itu, baki dan slip boleh bercanggah, dan yang orang percaya ialah baki.',
  'pay.loan.action.add': 'Pinjaman baharu',
  'pay.loan.column.reference': 'Rujukan',
  'pay.loan.column.staff': 'Staf',
  'pay.loan.column.principal': 'Pokok (RM)',
  'pay.loan.column.instalment': 'Ansuran (RM)',
  'pay.loan.column.progress': 'Kemajuan',
  'pay.loan.column.balance': 'Baki (RM)',
  'pay.loan.column.startsOn': 'Mula potong',
  'pay.loan.empty': 'Tiada pinjaman direkodkan.',
  'pay.loan.error.load': 'Senarai pinjaman tidak dapat dimuatkan.',
  'pay.loan.progress': '{paid} daripada {total}',

  'pay.loan.form.title': 'Pinjaman baharu',
  'pay.loan.form.staff': 'Staf',
  'pay.loan.form.principal': 'Jumlah pinjaman (RM)',
  'pay.loan.form.instalment': 'Ansuran bulanan (RM)',
  'pay.loan.form.instalment.hint':
    'Ansuran yang dipersetujui. Ansuran terakhir mengambil baki yang tinggal, bukan angka penuh — memotong penuh atas baki RM40 akan mengutip lebih daripada yang terhutang.',
  'pay.loan.form.months': 'Bilangan ansuran',
  'pay.loan.form.issuedOn': 'Tarikh dikeluarkan',
  'pay.loan.form.startsOn': 'Potongan bermula',
  'pay.loan.form.startsOn.hint':
    'Dibandingkan dengan tempoh payroll. Pinjaman yang bermula bulan depan tidak akan dipotong dalam larian bulan ini.',
  'pay.loan.form.purpose': 'Tujuan',
  'pay.loan.form.note': 'Nota',

  'pay.advance.title': 'Pendahuluan Gaji',
  'pay.advance.subtitle':
    'Pendahuluan yang dipungut balik dalam bilangan bulan yang dipilih. Bezanya daripada pinjaman hanya di mana ansuran datang: pinjaman membawa ansuran yang dipersetujui, pendahuluan membahagi amaun dengan bulan.',
  'pay.advance.action.add': 'Pendahuluan baharu',
  'pay.advance.column.reference': 'Rujukan',
  'pay.advance.column.staff': 'Staf',
  'pay.advance.column.principal': 'Amaun (RM)',
  'pay.advance.column.instalment': 'Potongan (RM)',
  'pay.advance.column.progress': 'Kemajuan',
  'pay.advance.column.balance': 'Baki (RM)',
  'pay.advance.column.startsOn': 'Mula potong',
  'pay.advance.empty': 'Tiada pendahuluan direkodkan.',
  'pay.advance.error.load': 'Senarai pendahuluan tidak dapat dimuatkan.',
  'pay.advance.progress': '{paid} daripada {total} bulan',

  'pay.advance.form.title': 'Pendahuluan baharu',
  'pay.advance.form.staff': 'Staf',
  'pay.advance.form.principal': 'Amaun pendahuluan (RM)',
  'pay.advance.form.months': 'Bulan pembayaran balik',
  'pay.advance.form.months.hint': 'Potongan bulanan dikira daripada amaun dibahagi bulan.',
  'pay.advance.form.preview': 'Potongan bulanan: RM{amount}',
  'pay.advance.form.issuedOn': 'Tarikh diberi',
  'pay.advance.form.startsOn': 'Potongan bermula',
  'pay.advance.form.reason': 'Sebab',
  'pay.advance.form.note': 'Nota',

  /** The decision and delete dialogs, shared by loans and advances. */
  'pay.lending.approve.title': 'Luluskan {reference}',
  'pay.lending.approve.body':
    'Kelulusan menjadikannya aktif, dan larian payroll berikutnya akan mula memotong ansuran daripada gaji.',
  'pay.lending.approve.submit': 'Luluskan',
  'pay.lending.cancel.title': 'Batalkan {reference}',
  'pay.lending.cancel.body':
    'Hanya boleh dibatalkan selagi tiada ansuran dipotong. Selepas gaji dipotong, pembatalan akan meninggalkan wang yang diambil tanpa apa-apa yang merekodkan sebabnya — buat bayaran balik sebagai pelarasan.',
  'pay.lending.cancel.submit': 'Batalkan',
  'pay.lending.locked': 'Ansuran sudah dipotong daripada gaji — rekod ini tidak boleh dibuang.',
  'pay.lending.remove.title': 'Buang {reference}',
  'pay.lending.remove.body':
    'Hanya rekod yang belum diluluskan dan tiada sejarah potongan boleh dibuang. Slip gaji yang memotongnya merujuk rekod ini.',

  // -------------------------------------------------------------------------
  // Payroll › Tetapan Payroll
  // -------------------------------------------------------------------------
  'pay.settings.title': 'Tetapan Payroll',
  'pay.settings.subtitle':
    'Kadar statutori, notifikasi dan wording emel. Kadar adalah data yang boleh disunting, bukan pemalar dalam kod: siling SIP sudah berubah dua kali melalui pengumuman kerajaan, dan kadar di dalam fail sumber bermakna satu keluaran untuk mematuhi undang-undang.',
  /**
   * The statutory tab, named separately from the screen.
   *
   * There is no approval tab here, unlike the request modules. A payroll period has no rung
   * anybody is on and no rejection, so a chain would be a screen of rungs nothing consults —
   * the reference built exactly that and had to remove the permission rows again.
   */
  'pay.settings.tab.rates': 'Kadar Statutori',

  'pay.settings.group.epf': 'KWSP',
  'pay.settings.group.socso': 'PERKESO',
  'pay.settings.group.eis': 'SIP',
  'pay.settings.group.cycle': 'Pusingan gaji',
  'pay.settings.group.review': 'Pengesahan kadar',

  'pay.settings.epfEmployeeRate': 'Kadar pekerja (%)',
  'pay.settings.epfEmployerRate': 'Kadar majikan pada atau bawah ambang (%)',
  'pay.settings.epfEmployerRateHigh': 'Kadar majikan di atas ambang (%)',
  'pay.settings.epfEmployerRateHigh.hint':
    'Langkah statutori pada ambang itu turun, bukan naik. Dimasukkan terbalik ia menyumbang lebih bagi setiap pekerja senior, setiap bulan.',
  'pay.settings.epfWageThreshold': 'Ambang upah (RM)',
  'pay.settings.epfIncludeBonus': 'Kira bonus dan komisen sebagai upah KWSP',
  'pay.settings.epfIncludeBonus.hint':
    'Ia memang upah KWSP. Togol ini ada kerana sesebuah organisasi mungkin berbeza.',
  'pay.settings.epf.note':
    'Lebih masa tiada dalam asas KWSP. Bayaran lebih masa bukan upah bercarum.',

  'pay.settings.socsoEmployeeRate': 'Kadar pekerja (%)',
  'pay.settings.socsoEmployerRate': 'Kadar majikan (%)',
  'pay.settings.socsoWageCeiling': 'Siling upah (RM)',
  'pay.settings.socsoWageCeiling.hint': '0 bermakna tiada siling.',
  'pay.settings.eisEmployeeRate': 'Kadar pekerja (%)',
  'pay.settings.eisEmployerRate': 'Kadar majikan (%)',
  'pay.settings.eisWageCeiling': 'Siling upah (RM)',

  'pay.settings.payDay': 'Hari bayaran',
  'pay.settings.payDay.hint': 'Hari dalam bulan, ditawarkan sebagai lalai pada tempoh baharu.',

  'pay.settings.ratesReviewed': 'Kadar sudah disemak dan disahkan',
  'pay.settings.ratesReviewed.hint':
    'Tandakan hanya selepas bahagian kewangan membandingkan setiap kadar di atas dengan jadual KWSP dan PERKESO yang berkuat kuasa. Sehingga itu, setiap skrin dan setiap fail export membawa amaran.',
  'pay.settings.action.save': 'Simpan tetapan',
  'pay.settings.saved': 'Tetapan payroll disimpan.',
  'pay.settings.error.load': 'Tetapan payroll tidak dapat dimuatkan.',

  /**
   * The caveats, sent from the server as keys.
   *
   * From the server rather than written into the page so a caveat cannot be true of the
   * engine and absent from the interface. These are approximations somebody has to know
   * about before signing a period off, not footnotes.
   */
  'pay.settings.caveat.unverified':
    'Nilai lalai di sini BELUM disahkan terhadap jadual statutori semasa. Ia titik permulaan supaya skrin boleh digunakan; bahagian kewangan mesti mengesahkannya sebelum mana-mana tempoh dibayar.',
  'pay.settings.caveat.socsoBands':
    'PERKESO dan SIP dikira sebagai peratusan bersiling. Caruman sebenar ialah jadual jalur upah dengan amaun sen tetap, kira-kira tiga puluh baris. Angka di sini hampir tetapi tidak tepat, jadi penyata tidak akan sepadan sen-ke-sen dengan PERKESO.',
  'pay.settings.caveat.pcb':
    'PCB tidak dikira sama sekali. Ia bergantung pada pelepasan yang diisytiharkan, status perkahwinan dan tanggungan di bawah jadual LHDN — angka yang diteka memotong kurang dan pekerja yang menerima bilnya pada taksiran. Ia dimasukkan sendiri pada setiap slip.',
  'pay.settings.caveat.heading': 'Yang perlu diketahui sebelum menandakan ini disemak',

  /**
   * Shared by every form on these seven screens.
   *
   * One label rather than seven: it is the same control asking the same question, and seven
   * copies would be translated seven times and could disagree on the same screen.
   */
  'pay.form.staffPlaceholder': 'Nombor staf, cth. 1001',
  'pay.form.periodNone': 'Tiada tempoh',
  'pay.chip.all': 'Semua',
  'pay.filter.period': 'Semua tempoh',
  'pay.filter.type': 'Semua jenis',
  'pay.action.decide': 'Luluskan atau batalkan',
  'pay.action.edit': 'Sunting',
  'pay.action.remove': 'Buang',

  // -------------------------------------------------------------------------
  // Integrasi › SMS melalui Infobip
  // -------------------------------------------------------------------------
  'sms.title': 'SMS melalui Infobip',
  'sms.subtitle': 'Menghantar notifikasi SMS automatik melalui akaun Infobip hospital.',
  'sms.error.load': 'Gagal memuatkan tetapan SMS',
  'sms.error.clear': 'Gagal membuang kunci',
  'sms.error.test': 'Gagal menjalankan ujian',
  'sms.saved': 'Tetapan SMS disimpan.',
  'sms.cleared':
    'Kunci API dibuang. Saluran dimatikan sekali — ia tidak boleh menghantar tanpa kunci.',
  'sms.test.sent': 'SMS ujian dihantar.',
  'sms.test.failed': 'Ujian gagal.',

  'sms.group.credentials': 'Kredensial Infobip',
  'sms.keySet': 'KUNCI TERSIMPAN',
  'sms.keyMissing': 'TIADA KUNCI',
  'sms.hint':
    'Dapatkan kunci API dari portal Infobip: Account Settings › API Keys, dengan skop {scope}. Base URL adalah unik untuk akaun anda — ia bukan {wrongHost}.',

  'sms.apiKey': 'Kunci API',
  'sms.apiKey.hint': 'Disulitkan sebelum disimpan dan tidak pernah dipulangkan ke pelayar.',
  'sms.apiKey.aria': 'Kunci API Infobip',
  'sms.apiKey.stored': 'Tersimpan — biarkan kosong untuk kekalkan',
  'sms.apiKey.clear': 'Buang kunci tersimpan',

  'sms.baseUrl': 'Base URL',
  'sms.baseUrl.hint': 'Host API Infobip yang unik untuk akaun anda.',
  'sms.senderId': 'Sender ID',
  'sms.senderId.hint':
    'Pengirim berdaftar dengan Infobip — nombor pendek atau alfanumerik. Semasa percubaan, gunakan ServiceSMS.',
  /**
   * The failure mode with no error anywhere.
   *
   * An unregistered sender is accepted by the API and then dropped by the carrier, so nothing in
   * any log says the message never arrived. Stated on the screen because there is no other way to
   * find out.
   */
  'sms.senderId.note':
    'Sender ID yang tidak berdaftar diterima oleh API dan kemudian dijatuhkan oleh pembawa — tiada ralat di mana-mana. Sahkan ia berdaftar pada akaun Infobip anda.',

  'sms.group.triggers': 'Pencetus Notifikasi',
  'sms.group.triggers.subtitle':
    'Peristiwa sistem yang menghantar SMS kepada nombor telefon staf berkenaan.',
  'sms.triggers.count': '{count} dipilih',
  'sms.disabled.hint':
    'Saluran dimatikan: tetapan disimpan tetapi tiada SMS dihantar, termasuk oleh pencetus di atas.',
  'sms.action.save': 'Simpan tetapan',

  'sms.group.test': 'Hantar SMS Ujian',
  'sms.group.test.subtitle':
    'Menghantar mesej sebenar melalui Infobip. Ia dibil seperti mana-mana SMS lain.',
  'sms.test.usesStored': 'menggunakan kredensial tersimpan',
  'sms.test.lastResult': 'Keputusan terakhir',
  'sms.test.phone': 'Nombor telefon',
  'sms.test.phone.hint': 'Sertakan kod negara. 012… ditukar kepada 6012… secara automatik.',
  'sms.test.phone.aria': 'Nombor telefon ujian',
  'sms.test.message': 'Mesej',
  'sms.test.message.aria': 'Mesej ujian',
  'sms.test.default': 'Ini SMS ujian dari Sistem Kehadiran Hospital Sibu.',
  'sms.test.submit': 'Hantar ujian',
  /**
   * Segments, not characters.
   *
   * One character outside GSM 03.38 drops the limit from 160 to 70 and turns one message into
   * three. That is a tripled bill rather than an error, so it has to be visible while typing.
   */
  'sms.segments.characters': '{count}/{limit} aksara',
  'sms.segments.billed': '{count} segmen dibil',
  'sms.segments.unicode': 'mengandungi aksara bukan-GSM, jadi had turun ke 70',
  'sms.test.mustEnable':
    'Hidupkan saluran dan simpan sebelum menguji — ujian yang lulus terhadap saluran yang dimatikan mengesahkan sesuatu yang tetap tidak akan menghantar.',

  // -------------------------------------------------------------------------
  // Integrasi › Telegram
  // -------------------------------------------------------------------------
  'telegram.title': 'Notifikasi Telegram',
  'telegram.subtitle':
    'Menghantar notifikasi automatik ke satu channel Telegram melalui bot.',
  'telegram.error.load': 'Gagal memuatkan tetapan Telegram',
  'telegram.error.clear': 'Gagal membuang token',
  'telegram.error.verify': 'Gagal menyahkan token',
  'telegram.error.test': 'Gagal menjalankan ujian',
  'telegram.saved.unverified':
    'Tetapan disimpan. Nama bot belum dapat dibaca — sahkan token untuk mendapatkannya.',
  'telegram.saved.withBot': 'Tetapan disimpan. Bot: @{username}',
  'telegram.cleared':
    'Token bot dibuang. Saluran dimatikan sekali — ia tidak boleh menghantar tanpa token.',
  'telegram.verify.ok': 'Token sah. Bot: {name}',
  'telegram.verify.failed': 'Token tidak dapat disahkan.',
  'telegram.test.sent': 'Mesej ujian dihantar.',
  'telegram.test.failed': 'Ujian gagal.',

  'telegram.group.bot': 'Konfigurasi Bot',
  'telegram.unverified': 'BELUM DISAHKAN',
  'telegram.hint':
    'Mesej {botFather} untuk mencipta bot dan mendapatkan tokennya. Tambah bot itu ke channel anda sebagai administrator, kemudian gunakan nama channel ({channelName}) atau ID numeriknya ({channelId}).',

  'telegram.botToken': 'Token bot',
  'telegram.botToken.hint':
    'Disulitkan sebelum disimpan. Sesiapa yang memilikinya boleh menghantar sebagai bot ini.',
  'telegram.botToken.stored': 'Tersimpan — biarkan kosong untuk kekalkan',
  'telegram.botToken.clear': 'Buang token tersimpan',

  'telegram.botUsername': 'Nama pengguna bot',
  'telegram.botUsername.hint': 'Dibaca dari Telegram apabila token disahkan, bukan ditaip.',
  'telegram.botUsername.none': '— belum disahkan —',

  'telegram.chatId': 'Channel ID',
  'telegram.chatId.hint':
    'Di mana mesej disiarkan. Bot mesti menjadi administrator channel itu.',
  'telegram.ownerUserId': 'ID pengguna pemilik',
  'telegram.ownerUserId.hint':
    'Pilihan. ID numerik Telegram untuk makluman terus. Bot tidak boleh memulakan perbualan sehingga orang itu menghantar /start kepadanya.',
  'telegram.ownerUsername': 'Nama pengguna pemilik',
  'telegram.ownerUsername.hint': 'Pilihan. Untuk rujukan sahaja.',

  'telegram.group.triggers': 'Pencetus Notifikasi',
  'telegram.group.triggers.subtitle':
    'Peristiwa sistem yang menyiarkan mesej ke channel Telegram.',
  'telegram.triggers.count': '{count} dipilih',
  'telegram.disabled.hint':
    'Saluran dimatikan: tetapan disimpan tetapi tiada mesej dihantar, termasuk oleh pencetus di atas.',
  'telegram.action.save': 'Simpan tetapan',

  'telegram.group.test': 'Uji Sambungan',
  'telegram.group.test.subtitle':
    'Sahkan token dahulu, kemudian hantar mesej sebenar ke channel.',
  'telegram.test.lastResult': 'Keputusan terakhir',
  'telegram.action.verify': 'Sahkan token bot',
  'telegram.action.send': 'Hantar ke channel',
  /**
   * The two buttons answer different questions.
   *
   * Saying so is what stops somebody retyping a perfectly good token because the channel post
   * failed. A token that verifies but cannot post means the bot was never made an administrator,
   * and no amount of retyping fixes that.
   */
  'telegram.test.note':
    '{verify} hanya membuktikan token itu sah — ia tidak menghantar apa-apa. {send} membuktikan bot itu benar-benar dibenarkan menyiarkan di sana. Token yang sah tetapi gagal menyiarkan bermakna bot belum dijadikan administrator channel.',
  'telegram.test.note.verify': 'Sahkan token',
  'telegram.test.note.send': 'Hantar ke channel',
  'telegram.test.usesStored':
    'Ujian menggunakan kredensial {emphasis}, bukan apa yang ada dalam borang. Simpan dahulu jika anda baru menukar token.',
  'telegram.test.usesStored.emphasis': 'tersimpan',

  // -------------------------------------------------------------------------
  // Tetapan › Keselamatan
  // -------------------------------------------------------------------------
  'security.title': 'Keselamatan',
  'security.subtitle':
    'Dasar pengesahan yang dikuatkuasakan oleh pelayan, dan keadaan semasa sistem.',
  'security.error.load': 'Gagal memuatkan tetapan keselamatan',
  'security.saved': 'Dasar keselamatan disimpan. Berkuat kuasa dalam beberapa saat.',

  'security.group.posture': 'Keadaan Semasa',
  'security.group.posture.subtitle':
    'Dibaca terus dari pangkalan data setiap kali skrin ini dibuka.',
  'security.posture.locked': 'Akaun dikunci sekarang',
  'security.posture.failed': 'Log masuk gagal (24 jam)',
  'security.posture.tokens': 'Token API aktif',
  'security.posture.expiring': 'Token luput dalam 14 hari',
  'security.posture.webhooks': 'Webhook sedang gagal',

  'security.group.login': 'Log Masuk & Kata Laluan',
  'security.group.login.subtitle':
    'Dibaca pada setiap percubaan log masuk dan setiap penukaran kata laluan.',
  'security.group.login.summary':
    '{attempts} percubaan · {minutes} minit · {characters} aksara',
  'security.group.login.hint':
    'Nilai ini dahulunya dikodkan tetap dalam pelayan. Ia kini dibaca dari pangkalan data pada setiap percubaan, jadi menukarnya di sini benar-benar menukar tingkah laku — tiada pelayan perlu dimulakan semula.',

  'security.maxFailedLogins': 'Percubaan sebelum dikunci',
  'security.maxFailedLogins.hint':
    'Minimum 3. Satu percubaan akan mengunci seseorang keluar dari akaun sendiri kerana satu salah taip.',
  'security.lockoutMinutes': 'Tempoh kunci',
  'security.lockoutMinutes.hint':
    'Berapa lama akaun ditolak selepas had percubaan dicapai. Kunci luput sendiri; tiada siapa perlu membukanya.',
  'security.passwordMinLength': 'Panjang minimum kata laluan',
  'security.passwordMinLength.hint':
    'Dikuatkuasakan pada penciptaan akaun dan pada setiap penukaran kata laluan, termasuk oleh administrator.',
  'security.passwordMinLength.note':
    'Panjang minimum tidak menyemak kata laluan lama. Ia berkuat kuasa pada penukaran seterusnya — memaksa 5000 orang menukar serta-merta akan menghasilkan lima ribu kata laluan yang ditulis pada nota melekat.',

  'security.group.tokens': 'Token API',
  'security.group.tokens.subtitle':
    'Nilai lalai untuk token yang dikeluarkan dalam tab API & Webhook.',
  'security.group.tokens.summary': '{validity} · rahmat {grace} jam',
  'security.tokenDefaultDays': 'Tempoh sah lalai',
  'security.tokenDefaultDays.hint':
    'Nilai yang dicadangkan bila token baharu dikeluarkan. Sifar bermakna tanpa luput.',
  'security.rotationGraceHours': 'Tempoh rahmat putaran',
  'security.rotationGraceHours.hint':
    'Berapa lama token lama kekal sah selepas diputar, supaya deployment boleh mengambil nilai baharu tanpa tingkap kegagalan.',
  /**
   * Why there is no rotate-on-a-timer switch.
   *
   * Rotating a static credential on a schedule breaks every integration holding it, silently, at
   * whatever hour the timer fires. The grace period exists for a rotation somebody pressed.
   */
  'security.rotation.note':
    'Tiada putaran automatik, dan itu keputusan yang disengajakan. Memutar kredensial statik pada pemasa memutuskan setiap integrasi yang memegangnya tanpa sesiapa diberitahu. Tempoh rahmat ini adalah untuk putaran yang {emphasis}, yang bermakna ada orang yang tahu ia berlaku dan boleh mengemas kini penerima.',
  'security.rotation.note.emphasis': 'seseorang tekan',

  'security.group.env': 'Ditetapkan Semasa Deploy',
  'security.group.env.subtitle':
    'Dibaca dari fail persekitaran pada permulaan pelayan. Dipapar di sini, tidak boleh disunting di sini.',
  'security.env.require2fa': '2FA wajib untuk admin',
  'security.env.yes': 'YA',
  'security.env.no': 'TIDAK',
  'security.env.sessionTtl': 'Tempoh sesi',
  'security.env.sessionTtl.value': '{hours} jam',
  'security.env.connectorMode': 'Mod sambungan',
  'security.env.nodeEnv': 'Persekitaran',
  /**
   * A switch here would be a lie.
   *
   * These are read once at boot, so flipping a database row would leave the screen disagreeing
   * with the running server — worse than having no control at all.
   */
  'security.env.note':
    'Nilai ini dibaca sekali semasa pelayan dimulakan. Menjadikannya boleh disunting di sini akan menghasilkan kawalan yang senyap tidak berbuat apa-apa — skrin akan berkata satu perkara dan pelayan yang sedang berjalan akan berkata yang lain. Tukar dalam fail {envFile}, kemudian mulakan semula.',
  'security.env.no2fa':
    '{emphasis} Itu sesuai untuk pembangunan dan tidak sesuai untuk produksi: satu kata laluan yang terbocor sudah cukup untuk mendapatkan akses penuh, termasuk kuasa mengeluarkan token API. Hidupkan sebelum sistem ini digunakan sebenar.',
  'security.env.no2fa.emphasis': 'REQUIRE_ADMIN_2FA dimatikan.',

  'security.dirty': 'Ada perubahan belum disimpan.',
  'security.clean': 'Tiada perubahan. Nilai di atas adalah yang sedang dikuatkuasakan.',
  'security.action.save': 'Simpan dasar',
  'security.action.reset': 'Kembali ke nilai lalai',
  'security.unit.attempts': 'percubaan',
  'security.unit.minutes': 'minit',
  'security.unit.characters': 'aksara',
  'security.unit.hours': 'jam',
  'security.unit.days': 'hari',
  'security.unit.daysNoExpiry': 'hari (tanpa luput)',
  'security.noExpiry': 'tanpa luput',
  'security.validity.days': '{count} hari',
  'security.default': 'lalai {value}',

  // -------------------------------------------------------------------------
  // Profil Saya
  //
  // The organising idea is two cards: what the person owns and what the organisation owns.
  // The read-only card states WHY each field is read-only, because without that it reads as
  // fields somebody forgot to make editable.
  // -------------------------------------------------------------------------
  'profile.title': 'Profil Saya',
  'profile.subtitle':
    'Butiran anda sendiri. Yang diuruskan oleh HR dipaparkan tetapi tidak boleh disunting di sini.',
  'profile.error.load': 'Gagal memuatkan profil',
  'profile.saved': 'Profil dikemas kini.',
  'profile.header.subtitle': '{employeeNo} · {roleName}',
  'profile.twoFactor.on': '2FA AKTIF',
  'profile.twoFactor.off': '2FA TIDAK AKTIF',

  'profile.group.photo': 'Foto Profil',
  'profile.photo.label': 'Gambar',
  'profile.photo.hint':
    'PNG, JPEG atau WEBP sehingga {kilobytes} KB. Jenis fail ditentukan daripada bait pertamanya, bukan namanya.',
  'profile.photo.uploading': 'Memuat naik',
  'profile.photo.alt': 'Foto profil semasa',
  'profile.photo.replace': 'Ganti gambar',
  'profile.photo.choose': 'Pilih gambar',
  'profile.photo.size': '{kilobytes} KB',
  'profile.photo.tooLarge': 'Fail {size} KB melebihi had {limit} KB.',
  'profile.photo.error.upload': 'Muat naik gagal',
  'profile.photo.error.remove': 'Gagal membuang foto',
  /**
   * Saved on selection, not on the save button.
   *
   * A file input holds a handle to something on the user's disk rather than a value in the form,
   * and carrying it through a save that might fail on another field is how a silent non-upload
   * happens. Stated under the control.
   */
  'profile.photo.savedImmediately': 'Disimpan sebaik dipilih, bukan dengan butang simpan di bawah.',

  'profile.group.basic': 'Maklumat Asas',
  'profile.group.basic.subtitle':
    'Nombor telefon dan emel di sini adalah untuk dihubungi, bukan untuk log masuk.',
  'profile.position': 'Jawatan',
  /**
   * Registered even though it is an example, because it carries prose.
   *
   * `cth.` is a Malay abbreviation and the job title after it is Malay too. The masks that stay
   * unregistered are the ones with no words in them at all — `1.0.0`, `96000`, `smtp.host.local`.
   */
  'profile.position.placeholder': 'cth. Jururawat Masyarakat U29',
  'profile.position.hint':
    'Ditaip sendiri. Tiada senarai pilihan — jawatan di sini terlalu pelbagai untuk satu senarai yang tidak akan lengkap.',
  'profile.phone': 'No. telefon',
  'profile.phone.hint': 'Untuk notifikasi SMS jika saluran itu dihidupkan.',
  'profile.contactEmail': 'Emel untuk dihubungi',
  'profile.contactEmail.hint':
    'Pilihan, dan berasingan dari emel log masuk. Menukarnya tidak menukar cara anda log masuk.',

  'profile.group.address': 'Alamat',
  'profile.group.address.subtitle': 'Semua ditaip. Tiada senarai negeri, bandar atau poskod.',
  'profile.address1': 'Alamat baris 1',
  'profile.address2': 'Alamat baris 2',
  'profile.city': 'Bandar',
  'profile.state': 'Negeri',
  'profile.postcode': 'Poskod',
  'profile.country': 'Negara',

  /*
   * Bahasa per akaun, bukan per pemasangan.
   *
   * Lalai sistem menetapkan bahasa yang setiap orang buka; ini mengatasinya untuk satu orang
   * sahaja. Disimpan pada akaun dan bukan dalam `localStorage` supaya pilihan itu mengikut
   * orang ke mana-mana peranti — seseorang yang memilih English pada komputer kaunter tidak
   * patut mendapat Melayu semula apabila membuka telefon.
   */
  'profile.group.language': 'Bahasa',
  'profile.group.language.subtitle':
    'Bahasa yang anda membaca antara muka ini. Pilihan anda sendiri, bukan tetapan organisasi.',
  'profile.language': 'Bahasa antara muka',
  'profile.language.hint':
    'Hanya bahasa yang sudah ditawarkan disenaraikan. Label yang belum diterjemah dipaparkan dalam Bahasa Melayu, jadi skrin tidak pernah kosong.',
  'profile.language.followDefault': 'Ikut lalai sistem ({name})',
  /** Bila tiada lalai boleh dibaca — pemasangan baharu, atau lalai dimatikan. */
  'profile.language.followDefault.unknown': 'Ikut lalai sistem',
  'profile.language.option.source': '{name} — bahasa asal',
  /*
   * Klausa terakhir itu sebab nota ini ada.
   *
   * Pengepala CSV dan badan emel ditulis dalam perkataan sumber kerana ia dijana tanpa
   * pembaca yang bahasanya boleh dirujuk — pemasa, cron, dan fail yang dibuka di tempat lain.
   * Tanpa dinyatakan, orang yang menukar bahasa lalu membuka export menganggap terjemahan itu
   * rosak.
   */
  'profile.language.note':
    'Hanya skrin anda sendiri berubah. Rakan sekerja terus melihat bahasa mereka, dan {emphasis} — kedua-duanya dijana tanpa pembaca yang bahasanya boleh dirujuk.',
  'profile.language.note.emphasis': 'pengepala fail export dan emel notifikasi tidak berubah',
  'profile.language.appliesOnSave': 'Berkuat kuasa selepas anda tekan simpan di bawah.',
  /*
   * Satu bahasa sahaja ditawarkan: kawalan itu tiada apa untuk dipilih.
   *
   * Dinyatakan dan bukan disembunyikan. Kotak pilihan dengan satu pilihan terbaca sebagai
   * senarai yang gagal dimuatkan, dan menyembunyikan seksyen itu terus meninggalkan orang
   * yang diberitahu bahasa boleh ditukar tanpa tempat untuk menukarnya.
   */
  'profile.language.onlyOne':
    'Hanya satu bahasa ditawarkan pada pemasangan ini, jadi tiada apa untuk dipilih. Bahasa ditambah di Tetapan › Konfigurasi Umum › Alih Bahasa.',

  'profile.group.managed': 'Diuruskan oleh HR',
  'profile.group.managed.subtitle': 'Hubungi HR jika ada yang salah di sini.',
  'profile.group.managed.readOnly': 'baca-sahaja',
  'profile.managed.employeeNo': 'No. pekerja',
  'profile.managed.fullName': 'Nama penuh',
  'profile.managed.icNo': 'No. kad pengenalan',
  'profile.managed.department': 'Jabatan',
  'profile.managed.location': 'Lokasi',
  'profile.managed.hireDate': 'Tarikh mula kerja',
  'profile.managed.basicSalary': 'Gaji bulanan',
  'profile.managed.loginEmail': 'Emel log masuk',
  'profile.managed.roleName': 'Peranan',
  'profile.managed.lastLogin': 'Log masuk terakhir',
  /**
   * Why the two most dangerous fields are not a form.
   *
   * `employeeNo` is the join key to every terminal and every attendance row; `department` drives
   * payroll subtotals. Somebody retyping their own department would move money between cost
   * centres with nobody approving it.
   */
  'profile.managed.note':
    '{employeeNo} ialah kunci antara sistem ini dan setiap terminal, dan {department} menyuap subtotal laporan payroll. Kalau kedua-duanya boleh ditaip semula di sini, angka gaji satu jabatan boleh berubah tanpa sesiapa meluluskannya — sebab itu ia bukan borang.',
  'profile.managed.note.employeeNo': 'No. pekerja',
  'profile.managed.note.department': 'jabatan',
  'profile.managed.salaryNote':
    '{salary} ialah satu-satunya input kadar sejam lebih masa anda — gaji ÷ 26 ÷ 8, seperti s.60I Akta Kerja 1955. Menyuntingnya di sini bermakna mengharga semula tuntutan lebih masa sendiri, jadi ia dipapar dan bukan ditaip.',
  'profile.managed.salaryNote.emphasis': 'Gaji bulanan',

  'profile.group.credentials': 'Kredensial Terminal',
  'profile.group.credentials.subtitle': 'Apa yang didaftarkan pada peranti, bukan foto di atas.',
  'profile.credentials.count': '{count} didaftar',
  'profile.credentials.face': 'Muka',
  'profile.credentials.fingerprint': 'Cap jari',
  'profile.credentials.card': 'Kad',
  /**
   * The distinction that stops somebody changing their avatar believing they re-enrolled their
   * face — or an operator deleting a photo and removing a person's ability to clock in.
   */
  'profile.credentials.note':
    'Foto profil di atas {emphasis} templat muka anda. Templat itu tinggal pada terminal dan itulah yang anda scan dengannya; foto profil hanya gambar di sebelah nama pada skrin. Menukar satu tidak menukar yang lain.',
  'profile.credentials.note.emphasis': 'bukan',
  'profile.credentials.none':
    'Anda tiada kredensial pada mana-mana terminal, jadi anda tidak boleh scan sama sekali. Hubungi HR untuk pendaftaran.',

  'profile.dirty': 'Ada perubahan belum disimpan.',
  'profile.clean': 'Tiada perubahan.',
  'profile.action.save': 'Kemas kini profil',
  'profile.action.cancel': 'Batal',

  'profile.password.title': 'Tukar Kata Laluan',
  'profile.password.subtitle':
    'Ketiga-tiga medan diperlukan. Abaikan seksyen ini kalau anda tidak mahu menukarnya.',
  'profile.password.group': 'Kata Laluan',
  'profile.password.hint':
    'Minimum {count} aksara, seperti yang ditetapkan dalam dasar keselamatan sistem.',
  'profile.password.current': 'Kata laluan semasa',
  'profile.password.current.hint':
    'Diperlukan. Sesi yang terbuka pada mesin tidak berkunci tidak sepatutnya cukup untuk mengunci pemiliknya keluar.',
  'profile.password.new': 'Kata laluan baharu',
  'profile.password.confirm': 'Sahkan kata laluan baharu',
  'profile.password.tooShort': 'Sekurang-kurangnya {min} aksara ({current} sekarang)',
  'profile.password.mismatch': 'Kedua-duanya tidak sama',
  /**
   * Stated before the button, not discovered after.
   *
   * Somebody changing their password on a shared workstation should know their phone is about to
   * be signed out. This session survives on purpose: being logged out by your own successful
   * change reads as the change having failed.
   */
  'profile.password.otherSessions':
    'Menukar kata laluan mengeluarkan {emphasis} yang log masuk dengan yang lama. Sesi ini kekal — anda tidak dikeluarkan oleh tindakan anda sendiri.',
  'profile.password.otherSessions.emphasis': 'setiap peranti lain',
  'profile.password.error': 'Gagal menukar kata laluan',
  'profile.password.action': 'Tukar kata laluan',

  // -------------------------------------------------------------------------
  // Integrasi › Webhook
  // -------------------------------------------------------------------------
  'webhook.title': 'Webhook',
  'webhook.subtitle':
    'Peristiwa ditolak keluar ke URL anda, ditandatangan supaya penerima boleh membuktikan ia datang dari sini.',
  'webhook.action.add': 'Webhook Baharu',
  'webhook.error.load': 'Gagal memuatkan webhook',
  'webhook.error.test': 'Gagal menjalankan ujian',
  'webhook.error.status': 'Gagal menukar status',
  'webhook.error.regenerate': 'Gagal menjana kunci baharu',
  'webhook.error.remove': 'Gagal membuang webhook',
  'webhook.error.save': 'Gagal menyimpan webhook',
  'webhook.error.deliveries': 'Gagal memuatkan log',

  'webhook.chip.active': 'AKTIF',
  'webhook.chip.off': 'DIMATIKAN',
  'webhook.chip.broken': 'DIHENTIKAN AUTO',
  'webhook.search': 'Cari nama atau URL…',

  /**
   * The signature, explained where it is configured.
   *
   * The timestamp is inside the signed material, which is the part worth stating: a signature over
   * the body alone is still valid when replayed a month later.
   */
  'webhook.signature':
    'Setiap permintaan membawa {header} dalam bentuk {format}, iaitu HMAC-SHA256 atas {payload}. Cap masa ada di dalam bahan yang ditandatangan, jadi permintaan yang dirakam luput selepas {seconds} saat — tandatangan atas badan sahaja masih betul bila dimainkan semula sebulan kemudian. Bandingkan dalam masa tetap.',

  'webhook.empty':
    'Tiada webhook. Tambah satu bila ada sistem luar yang perlu tahu bila sesuatu berlaku di sini.',
  'webhook.column.name': 'Nama',
  'webhook.column.events': 'Peristiwa',
  'webhook.column.lastSent': 'Hantar terakhir',
  'webhook.status.autoOff': 'DIHENTIKAN AUTO',
  'webhook.status.active': 'AKTIF',
  'webhook.status.off': 'DIMATIKAN',
  'webhook.failures': '{count} kegagalan berturut-turut',
  'webhook.never': 'Belum pernah',

  'webhook.action.test': 'Hantar peristiwa ujian bertandatangan',
  'webhook.action.edit': 'Sunting webhook',
  'webhook.action.regenerate': 'Jana kunci tandatangan baharu — kunci lama terus tidak sah',
  'webhook.action.disable': 'Matikan webhook',
  'webhook.action.enable': 'Hidupkan semula webhook',
  'webhook.action.remove': 'Buang webhook',
  'webhook.expand': 'log penghantaran',

  'webhook.test.ok': '{name}: penerima menjawab HTTP {status} dalam {duration}ms.',
  'webhook.test.failed': '{name}: gagal pada cubaan {attempt} — {reason}',
  'webhook.test.unknownReason': 'sebab tidak diketahui',
  'webhook.enabled': '{name} dihidupkan. Kiraan kegagalan dikosongkan.',
  'webhook.disabled': '{name} dimatikan. Tiada peristiwa dihantar kepadanya.',
  'webhook.removed': '{name} dibuang.',

  /**
   * The retry policy, stated where somebody decides whether a failing webhook is their problem.
   *
   * A receiver answering 4xx understood the request and refused it; sending it three more times
   * only produces three more entries in their log.
   */
  'webhook.retry.note':
    'Balasan {noRetry} — penerima faham permintaan itu dan menolaknya, jadi menghantarnya tiga kali lagi hanya menghasilkan tiga lagi entri dalam log mereka. {retried} Selepas 20 kegagalan berturut-turut langganan dimatikan sendiri: gelung cuba semula tanpa henti terhadap host yang sudah seminggu hilang tidak dapat dibezakan daripada imbasan keluar, dan firewall penerima yang perasan dahulu.',
  'webhook.retry.note.noRetry': '4xx tidak diulang',
  'webhook.retry.note.retried': '5xx dan kegagalan rangkaian diulang tiga kali.',

  'webhook.secret.titleNew': 'Kunci tandatangan webhook',
  'webhook.secret.titleRegenerated': 'Kunci tandatangan baharu',
  'webhook.secret.label': 'Signing secret',
  'webhook.secret.noteNew':
    'Ini satu-satunya kali kunci ini dipaparkan. Penerima memerlukannya untuk mengesahkan tandatangan; kalau hilang, jana yang baharu.',
  'webhook.secret.noteRegenerated':
    'Kunci lama sudah tidak sah. Penerima anda akan menolak setiap penghantaran sehingga ia dikemas kini dengan nilai ini.',
  'webhook.secret.hint':
    'Simpan pada penerima anda, bukan di sini. Ia disulitkan sebelum disimpan dan tidak dipulangkan oleh mana-mana endpoint.',

  'webhook.remove.title': 'Buang webhook "{name}"?',
  'webhook.remove.body':
    'Log penghantarannya dibuang sekali. Kalau anda hanya mahu menghentikannya sementara, matikan langganan itu — log kekal dan kunci tandatangan tidak berubah.',

  'webhook.detail.subscribed': 'Dilanggan kepada',
  'webhook.detail.recent': 'Penghantaran terkini',
  'webhook.detail.loading': 'Memuatkan…',
  'webhook.detail.none': 'Belum ada penghantaran.',
  'webhook.detail.error': 'RALAT',
  'webhook.detail.attempt': 'cubaan {count}',
  'webhook.detail.duration': '{ms}ms',

  'webhook.form.titleNew': 'Webhook baharu',
  'webhook.form.titleEdit': 'Sunting "{name}"',
  'webhook.form.description':
    'URL disemak sebelum disimpan, dan disemak semula pada setiap penghantaran.',
  'webhook.form.name': 'Nama',
  'webhook.form.name.hint': 'Sistem mana yang menerima ini.',
  'webhook.form.name.aria': 'Nama webhook',
  'webhook.form.name.placeholder': 'cth. Portal HR — kemas kini cuti',
  'webhook.form.url': 'URL penerima',
  'webhook.form.url.hint':
    'https wajib untuk alamat awam. http hanya dibenarkan ke julat persendirian, di mana trafik tidak keluar dari tapak.',
  'webhook.form.active': 'Aktif',
  'webhook.form.active.hint': 'Bila dimatikan, langganan kekal tetapi tiada dihantar.',
  'webhook.form.active.switch': 'Webhook aktif',
  /**
   * Why the target is resolved through DNS rather than matched as text.
   *
   * A check over the URL string is bypassed by any name pointing at the cloud metadata endpoint,
   * which hands out instance credentials to anybody who asks, unauthenticated.
   */
  'webhook.form.ssrf':
    'Nama host diselesaikan melalui DNS sebelum diterima, bukan dipadankan sebagai teks. Semakan atas teks URL boleh dipintas oleh mana-mana nama yang menunjuk ke {address} — endpoint metadata awan yang memberikan kredensial instance kepada sesiapa yang bertanya, tanpa pengesahan.',
  'webhook.form.events': 'Peristiwa',
  'webhook.form.events.count': '{count} dipilih',
  'webhook.form.submitNew': 'Cipta webhook',

  // -------------------------------------------------------------------------
  // Integrasi › Profil Emel
  //
  // Several named senders rather than one relay: a payroll notice comes from Accounting and a
  // leave decision from HR, and one shared address means a recipient cannot tell which — and a
  // reply lands in whoever owns that mailbox.
  // -------------------------------------------------------------------------
  'emailProfile.title': 'Pengurusan Profil Emel',
  'emailProfile.subtitle':
    'Profil SMTP yang digunakan untuk emel sistem. Setiap notifikasi menghantar melalui profil yang sepadan dengannya — makluman HR dari HR, tiket bantuan dari Support.',
  'emailProfile.error.load': 'Gagal memuatkan profil emel',
  'emailProfile.error.save': 'Gagal menyimpan profil',
  'emailProfile.error.remove': 'Gagal membuang profil',
  'emailProfile.error.test': 'Gagal menjalankan ujian',
  'emailProfile.created': 'Profil "{name}" dicipta. Hantar ujian untuk mengesahkan ia berfungsi.',
  'emailProfile.saved': 'Profil "{name}" disimpan.',
  'emailProfile.removed': 'Profil "{name}" dibuang.',
  'emailProfile.test.sent': 'Emel ujian dihantar ke {recipient}.',
  'emailProfile.test.failed': 'Ujian gagal.',

  'emailProfile.select': 'Pilih profil:',
  'emailProfile.action.add': 'Baharu',
  'emailProfile.action.add.aria': 'Tambah profil emel',
  'emailProfile.none':
    'Belum ada profil emel. Tekan {newButton} untuk menambah yang pertama. Sehingga satu profil dikonfigurasikan dan diuji, tiada emel sistem yang boleh dihantar.',

  'emailProfile.group.sender': 'Profil & Pengirim',
  'emailProfile.group.sender.new': 'Profil baharu — belum disimpan.',
  /**
   * The key is what code selects a profile by, never the row id.
   *
   * Fixed once saved: renaming it would silently detach every notification that names it, and the
   * failure is mail that stops going out rather than an error anybody sees.
   */
  'emailProfile.key': 'Kunci profil',
  'emailProfile.key.hintNew':
    'Digunakan dalam kod untuk memilih profil ini. Tidak boleh diubah selepas disimpan.',
  'emailProfile.key.hint': 'Digunakan dalam kod untuk memilih profil ini. Tidak boleh diubah.',
  'emailProfile.name': 'Nama profil',
  'emailProfile.fromName': 'Nama pengirim',
  'emailProfile.fromName.hint': 'Nama yang penerima lihat.',
  'emailProfile.fromEmail': 'Emel pengirim',
  'emailProfile.replyTo': 'Reply-to',
  'emailProfile.replyTo.hint':
    'Pilihan. Ke mana balasan patut pergi jika bukan alamat pengirim.',
  'emailProfile.status': 'Status',
  'emailProfile.status.hint':
    'Profil tidak aktif dilangkau, dan apa-apa yang memerlukannya berhenti menghantar.',
  'emailProfile.status.switch': 'Profil ini aktif',
  'emailProfile.action.remove': 'Buang',

  'emailProfile.group.smtp': 'Pelayan SMTP',
  'emailProfile.provider': 'Penyedia',
  'emailProfile.provider.hint':
    'Memilih penyedia akan mengisi host, port dan penyulitan di bawah.',
  'emailProfile.host': 'Host',
  'emailProfile.port': 'Port',
  'emailProfile.port.hint': '587 untuk TLS, 465 untuk SSL, 25 untuk tiada.',
  'emailProfile.encryption': 'Penyulitan',
  /**
   * Stored explicitly rather than guessed from the port.
   *
   * Relays genuinely are configured on non-standard ports, and a guess produces a handshake error
   * nobody can read.
   */
  'emailProfile.encryption.hint':
    'Disimpan secara jelas dan bukan diteka dari port — relay memang dikonfigurasikan pada port bukan standard, dan tekaan menghasilkan ralat jabat tangan yang tiada sesiapa boleh baca.',
  'emailProfile.timeout': 'Timeout',
  'emailProfile.timeout.hint': 'Saat untuk menunggu pelayan menjawab.',
  'emailProfile.maxRetries': 'Cubaan maksimum',
  'emailProfile.maxRetries.hint':
    'Hanya kegagalan sementara diulang. Kata laluan yang ditolak akan ditolak sama pada setiap cubaan.',

  'emailProfile.group.auth': 'Pengesahan',
  'emailProfile.auth.none': 'TIADA',
  'emailProfile.auth.stored': 'KATA LALUAN TERSIMPAN',
  'emailProfile.auth.needed': 'PERLU KATA LALUAN',
  'emailProfile.authenticate': 'Sahkan',
  'emailProfile.authenticate.hint':
    'Matikan untuk relay dalaman yang membenarkan berdasarkan alamat sumber.',
  'emailProfile.authenticate.switch': 'Log masuk ke pelayan SMTP',
  'emailProfile.username': 'Nama pengguna',
  'emailProfile.password': 'Kata laluan',
  'emailProfile.password.hint':
    'Disulitkan sebelum disimpan dan tidak pernah dipulangkan ke pelayar.',
  'emailProfile.password.stored': 'Tersimpan — biarkan kosong untuk kekalkan',

  'emailProfile.action.create': 'Cipta profil',
  'emailProfile.action.save': 'Simpan tetapan',
  'emailProfile.saveFirst':
    'Profil disimpan dahulu, kemudian diuji. Ujian menghantar emel sebenar melalui relay ini.',

  'emailProfile.group.test': 'Uji Profil Ini',
  /**
   * The test sends a real message, and the reason is in the subtitle.
   *
   * Verifying credentials does not prove the relay will accept this sender address, and that is
   * what actually fails in practice.
   */
  'emailProfile.group.test.subtitle':
    'Menghantar emel sebenar. Mengesahkan kredensial sahaja tidak membuktikan relay akan menerima alamat pengirim ini — itu yang benar-benar gagal dalam praktik.',
  'emailProfile.test.lastResult': 'Keputusan terakhir',
  'emailProfile.test.never': 'Belum diuji.',
  'emailProfile.test.ok': 'Berjaya',
  'emailProfile.test.bad': 'Gagal',
  'emailProfile.test.recipient': 'Penerima',
  'emailProfile.test.recipient.hint': 'Biarkan kosong untuk menghantar ke {address}.',
  'emailProfile.test.recipient.aria': 'Penerima ujian',
  'emailProfile.test.submit': 'Hantar ujian',
  'emailProfile.test.inactive':
    'Profil ini tidak aktif, jadi ujian dimatikan. Hidupkan status di atas dan simpan sebelum menguji — kalau tidak ujian akan lulus terhadap sesuatu yang tetap tidak akan menghantar.',
  'emailProfile.test.usesStored':
    'Ujian menggunakan kredensial yang {emphasis}, bukan apa yang ada dalam borang. Simpan dahulu jika anda baru menukarnya.',
  'emailProfile.test.usesStored.emphasis': 'tersimpan',

  'emailProfile.remove.title': 'Buang profil "{name}"?',
  'emailProfile.remove.description': 'Kunci: {key}',
  /** Silently, which is the part worth saying: nothing errors, mail just stops. */
  'emailProfile.remove.body':
    'Apa-apa notifikasi yang memilih {key} akan berhenti menghantar, dan ia berhenti secara senyap. Jika anda hanya mahu menghentikannya sementara, matikan statusnya sebaliknya.',
  'emailProfile.remove.submit': 'Buang profil',

  // -------------------------------------------------------------------------
  // Tetapan › Pengurusan Pengguna
  //
  // Split by what the account is FOR rather than by permission level: an administrator login and
  // a staff app login are the same table row and completely different operational concerns, and
  // mixing a dozen administrators into five thousand app logins makes neither usable.
  // -------------------------------------------------------------------------
  'users.title': 'Pengurusan Pengguna',
  'users.subtitle': 'Urus akaun sistem dan peranan yang diberikan kepadanya.',
  'users.tabs.label': 'Jenis akaun',
  'users.tab.admin': 'Administrator',
  'users.tab.staff': 'Staf',
  'users.tab.apps': 'Apps',

  'users.error.load': 'Gagal memuatkan akaun',
  'users.error.status': 'Gagal menukar status',
  'users.error.remove': 'Gagal membuang akaun',
  'users.error.create': 'Gagal mencipta akaun',
  'users.error.update': 'Gagal mengemas kini akaun',
  'users.error.password': 'Gagal menetapkan kata laluan',

  'users.section.admin': 'Akaun Administrator',
  'users.section.admin.subtitle':
    'Log masuk panel admin. Apa yang setiap satu boleh buat datang dari peranan yang diberikan.',
  'users.section.staff': 'Akaun Staf',
  'users.section.staff.subtitle':
    'Log masuk layan-diri untuk staf. Data peribadi diuruskan di bawah Direktori Staf.',
  'users.action.newAdmin': 'Administrator Baharu',
  'users.action.newStaff': 'Akaun Staf Baharu',
  'users.search': 'Cari emel, nama staf atau no. staf…',
  'users.filter.roles': 'Semua peranan',

  /**
   * Why an app account starts pending and cannot check in.
   *
   * A token proves possession of a token, not physical presence. Stated on the screen because
   * enabling it is a decision somebody makes about what counts as attendance.
   */
  'users.staff.note':
    'Akaun staf dicipta dalam keadaan {pending} dan hanya boleh digunakan selepas orang itu menuntutnya dari telefon. Check-in melalui app dimatikan secara lalai: ia hanya membuktikan pemilikan token, bukan kehadiran fizikal.',
  'users.staff.note.pending': 'Menunggu',

  'users.empty.admin': 'Tiada akaun administrator sepadan dengan penapis ini.',
  'users.empty.staff':
    'Tiada akaun staf sepadan. Cipta akaun untuk staf yang perlu menggunakan app check-in.',

  'users.column.email': 'Emel',
  'users.column.role': 'Peranan',
  'users.column.twoFactor': '2FA',
  'users.column.lastLogin': 'Log masuk terakhir',
  'users.column.staff': 'Staf',
  'users.column.device': 'Peranti',

  'users.locked': 'Dikunci',
  'users.twoFactor.on': 'Aktif',
  'users.twoFactor.off': 'Belum disiapkan',
  'users.noDepartment': 'Tiada jabatan',
  'users.staffInactive': ' · staf tidak aktif',
  'users.device.unclaimed': 'Belum dituntut',
  'users.never': 'Belum pernah',

  'users.action.view': 'Lihat butiran',
  'users.action.edit': 'Ubah peranan dan status',
  'users.action.reset': 'Set semula kata laluan',
  'users.action.reactivate': 'Aktifkan semula akaun',
  'users.action.suspend': 'Gantung akaun',
  'users.action.remove': 'Buang akaun',
  'users.action.suspendFirst': 'Gantung dahulu sebelum boleh dibuang',
  'users.expand': 'butiran akaun',

  'users.suspended': '{email} digantung. Sesi yang sedang berjalan telah ditamatkan.',
  'users.reactivated': '{email} diaktifkan semula.',
  'users.removed': 'Akaun {email} dibuang.',

  'users.detail.staffName': 'Nama staf',
  'users.detail.employeeNo': 'No. staf',
  'users.detail.department': 'Jabatan',
  'users.detail.role': 'Peranan',
  'users.detail.accountType': 'Jenis akaun',
  'users.detail.created': 'Dicipta',
  'users.detail.appCheckIn': 'Check-in app',
  'users.detail.appCheckIn.allowed': 'Dibenarkan',
  'users.detail.appCheckIn.denied': 'Tidak dibenarkan',
  'users.detail.boundDevice': 'Peranti terikat',
  'users.detail.boundDevice.value': '{id} ({when})',
  'users.detail.failedLogins': 'Kegagalan log masuk',
  'users.detail.failedLogins.none': 'Tiada',
  'users.detail.failedLogins.count': '{count} percubaan gagal',
  'users.detail.lockedUntil': 'Dikunci sehingga',
  'users.detail.accountId': 'ID akaun',
  'users.detail.staffInactiveWarning':
    'Rekod staf ini sudah tidak aktif tetapi akaunnya masih boleh log masuk. Gantung akaun ini juga.',

  'users.remove.title': 'Buang akaun {email}?',
  /** Two steps on purpose: suspend, then delete. Neither is reversible on its own. */
  'users.remove.suspended':
    'Akaun ini sudah digantung, jadi ia selamat dibuang. Jejak audit kekal — nama pelaku disimpan sebagai teks pada setiap entri lampau.',
  'users.remove.active':
    'Akaun ini masih aktif. Permintaan akan ditolak: gantung ia dahulu supaya pembuangan menjadi dua langkah yang disengajakan.',

  // ── Klien App ──
  'users.apps.title': 'Klien App',
  'users.apps.subtitle':
    'Satu binaan aplikasi, bukan seorang pengguna. Tokennya bertindak atas nama satu staf dan terhad pada rekod orang itu.',
  'users.apps.action.add': 'Klien App Baharu',
  'users.apps.error.load': 'Gagal memuatkan klien app',
  'users.apps.error.rotate': 'Gagal memutar secret',
  'users.apps.error.remove': 'Gagal membuang klien',
  'users.apps.error.create': 'Gagal mencipta klien',
  'users.apps.search': 'Cari nama atau client ID…',
  'users.apps.chip.active': 'AKTIF',
  'users.apps.chip.suspended': 'DIGANTUNG',
  'users.apps.status.active': 'AKTIF',
  'users.apps.status.suspended': 'DIGANTUNG',
  /** Hashed like a password, so a leak is answered by rotation rather than by reinstalling. */
  'users.apps.note':
    'Secret dipaparkan sekali sahaja semasa dicipta — ia disimpan sebagai hash, sama seperti kata laluan. Jika ia terbocor, gantung klien atau putar secretnya; jangan tunggu setiap telefon dipasang semula.',
  'users.apps.empty': 'Tiada klien app. Cipta satu bila app check-in siap dibina.',
  'users.apps.column.name': 'Nama',
  'users.apps.column.platform': 'Platform',
  'users.apps.column.minVersion': 'Versi minimum',
  'users.apps.noLimit': 'Tiada had',
  'users.apps.action.rotate': 'Putar secret',
  'users.apps.action.reactivate': 'Aktifkan semula klien',
  'users.apps.action.suspend': 'Gantung klien',
  'users.apps.action.remove': 'Buang klien',
  'users.apps.expand': 'butiran klien',
  'users.apps.suspended': '{name} digantung. Token yang sudah dikeluarkan tidak lagi diterima.',
  'users.apps.reactivated': '{name} diaktifkan semula.',
  'users.apps.removed': '{name} dibuang.',
  'users.apps.rotated': 'Secret lama sudah tidak sah.',
  'users.apps.detail.clientId': 'Client ID',
  'users.apps.detail.updated': 'Dikemas kini',
  'users.apps.detail.secret': 'Secret',
  'users.apps.detail.secret.value': 'Disimpan sebagai hash — tidak boleh dipapar',
  'users.apps.remove.title': 'Buang klien "{name}"?',
  'users.apps.remove.body':
    'Klien ini sudah digantung, jadi tiada telefon yang masih bergantung padanya. Client ID tidak boleh digunakan semula.',

  // ── Dialog ──
  'users.create.admin': 'Administrator baharu',
  'users.create.staff': 'Akaun staf baharu',
  'users.create.description': 'Pilih staf dahulu. Satu orang hanya boleh ada satu akaun.',
  'users.create.searchStaff': 'Cari staf',
  'users.create.searchStaff.placeholder': 'Nama, no. staf atau emel',
  'users.create.searching': 'Mencari',
  'users.create.noMatch': 'Tiada staf sepadan.',
  'users.create.taken': 'Sudah ada akaun: {email}',
  'users.create.change': 'Tukar',
  'users.create.email': 'Emel log masuk',
  'users.create.role': 'Peranan',
  'users.create.role.option': '{name} ({granted}/{total})',
  'users.create.password': 'Kata laluan awal',
  'users.create.password.hint': 'Minimum 12 aksara.',
  'users.create.password.short': '{count} aksara lagi diperlukan',
  'users.create.allowAppCheckIn': 'Benarkan check-in melalui app',
  'users.create.allowAppCheckIn.hint':
    'Hanya berkenaan bila lokasi staf ini sudah ada koordinat dan radius geofence. Tanpa itu tiada apa yang boleh mengesahkan kedudukan.',
  'users.create.adminWarning':
    'Akaun administrator boleh mengubah rekod kehadiran ribuan orang. Berikannya hanya kepada orang yang memang perlu.',
  'users.create.submit': 'Cipta akaun',
  'users.created': 'Akaun untuk {name} dicipta.',

  'users.edit.status': 'Status',
  'users.edit.status.active': 'Aktif',
  'users.edit.status.pending': 'Menunggu',
  'users.edit.status.suspended': 'Digantung',
  'users.edit.status.warning': 'Sesi yang sedang berjalan akan ditamatkan serta-merta.',
  'users.edit.resetBinding': 'Lepaskan ikatan peranti',
  /** Two bindings for one person is a shared login, which is what the limit is for. */
  'users.edit.resetBinding.hint':
    'Perlu bila telefon ditukar atau hilang. Satu akaun hanya boleh terikat pada satu peranti — dua ikatan bagi seorang adalah tanda log masuk dikongsi.',
  'users.updated': 'Akaun {email} dikemas kini.',

  'users.reset.title': 'Set semula kata laluan',
  'users.reset.description': '{email} · {name}',
  'users.reset.password': 'Kata laluan baharu',
  'users.reset.password.hint':
    'Minimum 12 aksara. Sampaikan melalui saluran yang berbeza daripada emel akaun ini.',
  'users.reset.warning':
    'Semua sesi akaun ini akan ditamatkan dan kuncinya dibuka. Nilai kata laluan tidak pernah direkodkan dalam log audit — hanya hakikat bahawa ia ditukar.',
  'users.reset.submit': 'Set semula',
  'users.reset.done':
    'Kata laluan {email} ditetapkan semula. Semua sesinya telah ditamatkan.',

  'users.apps.create.title': 'Klien app baharu',
  'users.apps.create.name': 'Nama',
  'users.apps.create.name.placeholder': 'cth. Hospital Sibu Check-In (Android)',
  'users.apps.create.platform': 'Platform',
  'users.apps.create.minVersion': 'Versi minimum',
  'users.apps.create.minVersion.hint':
    'Binaan lebih lama daripada ini ditolak. Cara paling ringan memaksa kemas kini bila peraturan check-in berubah.',
  'users.apps.create.submit': 'Cipta',

  'users.apps.secret.title': 'Secret klien app',
  'users.apps.secret.clientId': 'Client ID',
  'users.apps.secret.secret': 'Client secret',
  'users.apps.secret.copy': 'Salin kedua-duanya',
  'users.apps.secret.copied': 'Disalin',
  /** The close button is an acknowledgement, not a dismissal: this is the only viewing. */
  'users.apps.secret.close': 'Saya sudah rekod',
} as const;

export type LabelKey = keyof typeof LABELS;

/** The group a key belongs to, from its first segment. */
export function labelGroup(key: string): string {
  return key.split('.')[0] ?? 'lain';
}

/** Registry entries in the shape the server stores them. */
export function labelEntries(): Array<{ key: string; groupKey: string; sourceText: string }> {
  return Object.entries(LABELS).map(([key, sourceText]) => ({
    key,
    groupKey: labelGroup(key),
    sourceText,
  }));
}
