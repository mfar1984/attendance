/**
 * Regression suite for the attendance justification rules. No server and no database.
 *
 * The ones that matter are the guards, because each of them fails by letting something through
 * rather than by breaking:
 *
 *   a claimed kind that does not match what the day actually holds fills the queue with rows a
 *   supervisor has to cross-check by hand
 *
 *   a decided day accepting a new reason quietly reopens something somebody signed
 *
 *   `reverted` behaving like `rejected` leaves a person staring at an outcome they cannot respond to
 */
import {
  BACKDATE_WINDOW_DAYS,
  JUSTIFIABLE_STATUSES,
  JUSTIFICATION_DECISIONS,
  JUSTIFICATION_STATUSES,
  MAX_REASON,
  MIN_REASON,
  checkDecision,
  checkReason,
  checkSubmit,
  daysBetween,
  isJustifiable,
  justificationSettled,
  summariseApproved,
} from '../apps/server/src/hr/justification.js';

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

console.log('\nJenis yang boleh dijustifikasikan');
check('empat jenis', JUSTIFIABLE_STATUSES.length, 4);
check('lewat', isJustifiable('late'), true);
check('keluar awal', isJustifiable('early_leave'), true);
check('tidak lengkap', isJustifiable('incomplete'), true);
check('tidak hadir', isJustifiable('absent'), true);
/*
 * Nothing to explain about these, so they are not offered. Taken from `AttendanceStatus` rather than
 * redefined — the engine already derives the four; what was missing was somewhere to put the reason.
 */
check('tepat masa TIDAK boleh dijustifikasikan', isJustifiable('on_time'), false);
check('cuti TIDAK boleh dijustifikasikan', isJustifiable('on_leave'), false);
check('hari rehat TIDAK boleh dijustifikasikan', isJustifiable('rest_day'), false);
check('cuti umum TIDAK boleh dijustifikasikan', isJustifiable('holiday'), false);
/*
 * The eight technical exception kinds are a different table and a different screen. One of them
 * leaking in here would put "this terminal's clock drifted" into a queue of sick children.
 */
check('jam terminal hanyut BUKAN justifikasi', isJustifiable('clock_drift'), false);
check('muka tidak dikenali BUKAN justifikasi', isJustifiable('unrecognised_face'), false);
check('tiada scan keluar BUKAN justifikasi', isJustifiable('missing_check_out'), false);

console.log('\nJarak hari kalendar');
check('hari sama', daysBetween('2026-08-28', '2026-08-28'), 0);
check('satu hari', daysBetween('2026-08-27', '2026-08-28'), 1);
check('sepuluh hari', daysBetween('2026-08-18', '2026-08-28'), 10);
check('negatif bila hujung sebelum mula', daysBetween('2026-08-28', '2026-08-27'), -1);
// Parsed as UTC midnight, the representation calendar dates are stored in, so 24-hour steps are
// exact and no daylight-saving boundary can shorten one.
check('melintas sempadan bulan', daysBetween('2026-07-31', '2026-08-01'), 1);
check('melintas sempadan tahun', daysBetween('2025-12-31', '2026-01-01'), 1);
check('setahun penuh', daysBetween('2025-08-28', '2026-08-28'), 365);
check('tarikh tidak sah bukan nombor', Number.isNaN(daysBetween('bukan-tarikh', '2026-08-28')), true);

console.log('\nSebab');
check('sebab yang munasabah diterima', checkReason('Anak demam, hantar ke klinik dahulu'), null);
check('had minimum', MIN_REASON, 10);
check('had maksimum', MAX_REASON, 1000);
// "ok" and "-" are not explanations, and a field that accepts them produces a queue of rows a
// supervisor has to open to discover there is nothing in them.
check('sebab kosong ditolak', checkReason('')?.key, 'justify.refuse.reasonEmpty');
check('ruang sahaja ditolak', checkReason('        ')?.key, 'justify.refuse.reasonEmpty');
check('dua perkataan ditolak', checkReason('sakit')?.key, 'justify.refuse.reasonShort');
check('sepuluh aksara tepat diterima', checkReason('anak demam'), null);
check('sembilan aksara ditolak', checkReason('anak dema')?.key, 'justify.refuse.reasonShort');
// Length is measured on the trimmed value, so twenty spaces around two words is still two words.
check(
  'panjang dikira selepas trim',
  checkReason('   sakit   ')?.key,
  'justify.refuse.reasonShort',
);
check(
  'terlalu panjang ditolak',
  checkReason('a'.repeat(MAX_REASON + 1))?.key,
  'justify.refuse.reasonLong',
);

const base = {
  workDate: '2026-08-20',
  today: '2026-08-28',
  recordStatus: 'late',
  existingStatus: null,
  statusKind: 'late',
  reason: 'Anak demam, hantar ke klinik dahulu',
} as const;

console.log('\nPenghantaran');
check('kes asas diterima', checkSubmit(base), null);
check('tarikh tidak sah ditolak', checkSubmit({ ...base, workDate: '20-08-2026' })?.key, 'justify.refuse.badDate');
/*
 * The engine never computes a day that has not happened, so there is no record to attach to — and a
 * justification for next Tuesday is somebody pre-authorising their own absence.
 */
check(
  'hari akan datang ditolak',
  checkSubmit({ ...base, workDate: '2026-08-29' })?.key,
  'justify.refuse.future',
);
check('hari ini diterima', checkSubmit({ ...base, workDate: '2026-08-28' }), null);
check('tingkap ke belakang 90 hari', BACKDATE_WINDOW_DAYS, 90);
check(
  'tepat pada tingkap diterima',
  checkSubmit({ ...base, workDate: '2026-05-30', today: '2026-08-28' }),
  null,
);
check(
  'sehari melebihi tingkap ditolak',
  checkSubmit({ ...base, workDate: '2026-05-29', today: '2026-08-28' })?.key,
  'justify.refuse.tooOld',
);
check(
  'tingkap dinamakan dalam penolakan',
  checkSubmit({ ...base, workDate: '2025-01-01' })?.vars,
  { days: 90 },
);
check(
  'jenis tidak dikenali ditolak',
  checkSubmit({ ...base, statusKind: 'clock_drift', recordStatus: 'clock_drift' })?.key,
  'justify.refuse.badKind',
);
/*
 * No record means no day to explain. A holiday, a rest day, or a day the engine has not reached yet.
 */
check(
  'tiada rekod ditolak',
  checkSubmit({ ...base, recordStatus: null })?.key,
  'justify.refuse.noRecord',
);
/*
 * The claimed kind must be what the day actually holds. Without this somebody could file an absence
 * explanation for a day they were on time, and the queue would fill with rows to cross-check by hand.
 */
check(
  'jenis tidak sepadan rekod ditolak',
  checkSubmit({ ...base, recordStatus: 'on_time' })?.key,
  'justify.refuse.statusMismatch',
);
check(
  'kedua-dua status dinamakan',
  checkSubmit({ ...base, recordStatus: 'absent', statusKind: 'late' })?.vars,
  { claimed: 'late', actual: 'absent' },
);
check(
  'tidak hadir sepadan tidak hadir',
  checkSubmit({ ...base, recordStatus: 'absent', statusKind: 'absent' }),
  null,
);

console.log('\nPenghantaran kedua');
check(
  'sudah menunggu ditolak',
  checkSubmit({ ...base, existingStatus: 'pending' })?.key,
  'justify.refuse.alreadyPending',
);
check(
  'sudah diluluskan ditolak',
  checkSubmit({ ...base, existingStatus: 'approved' })?.key,
  'justify.refuse.alreadyApproved',
);
check(
  'sudah ditolak ditolak',
  checkSubmit({ ...base, existingStatus: 'rejected' })?.key,
  'justify.refuse.alreadyRejected',
);
/*
 * `reverted` is the one existing status that accepts a new reason. That is the whole purpose of
 * having a third outcome: it reopens the day rather than closing it.
 */
check(
  'dihantar semula BOLEH ditulis semula',
  checkSubmit({ ...base, existingStatus: 'reverted' }),
  null,
);
// Order matters: somebody submitting a blank reason for tomorrow is told about tomorrow.
check(
  'tarikh disemak sebelum sebab',
  checkSubmit({ ...base, workDate: '2026-08-29', reason: '' })?.key,
  'justify.refuse.future',
);
check(
  'sebab disemak terakhir',
  checkSubmit({ ...base, reason: 'ok' })?.key,
  'justify.refuse.reasonShort',
);

console.log('\nKeputusan');
check('tiga keputusan', JUSTIFICATION_DECISIONS.length, 3);
check('empat status', JUSTIFICATION_STATUSES.length, 4);
check('luluskan tanpa catatan diterima', checkDecision({ current: 'pending', decision: 'approved', note: null }), null);
check(
  'luluskan dengan catatan diterima',
  checkDecision({ current: 'pending', decision: 'approved', note: 'Diterima' }),
  null,
);
/*
 * Rejecting and reverting need a note; approving does not. Approval is agreement with what the person
 * already wrote. The other two ask somebody to accept an outcome or to try again, and an outcome with
 * no words attached is one they cannot act on or appeal.
 */
check(
  'tolak tanpa catatan ditolak',
  checkDecision({ current: 'pending', decision: 'rejected', note: null })?.key,
  'justify.refuse.noteRequired',
);
check(
  'hantar semula tanpa catatan ditolak',
  checkDecision({ current: 'pending', decision: 'reverted', note: '' })?.key,
  'justify.refuse.noteRequired',
);
check(
  'catatan ruang sahaja ditolak',
  checkDecision({ current: 'pending', decision: 'rejected', note: '   ' })?.key,
  'justify.refuse.noteRequired',
);
check(
  'tolak dengan catatan diterima',
  checkDecision({ current: 'pending', decision: 'rejected', note: 'Tiada bukti' }),
  null,
);
/*
 * A reverted row is still open — it is waiting on the employee. A supervisor who changes their mind
 * before the employee gets to it should not have to wait for a resubmission they no longer want.
 */
check(
  'dihantar semula masih boleh diputuskan',
  checkDecision({ current: 'reverted', decision: 'approved', note: null }),
  null,
);
check(
  'sudah diluluskan tidak boleh diputus semula',
  checkDecision({ current: 'approved', decision: 'rejected', note: 'Tukar fikiran' })?.key,
  'justify.refuse.alreadyDecided',
);
check(
  'sudah ditolak tidak boleh diputus semula',
  checkDecision({ current: 'rejected', decision: 'approved', note: 'Tukar fikiran' })?.key,
  'justify.refuse.alreadyDecided',
);
check(
  'status semasa dinamakan',
  checkDecision({ current: 'approved', decision: 'rejected', note: 'x' })?.vars,
  { status: 'approved' },
);

console.log('\nBila sesuatu justifikasi selesai');
check('diluluskan selesai', justificationSettled('approved'), true);
check('ditolak selesai', justificationSettled('rejected'), true);
check('menunggu belum selesai', justificationSettled('pending'), false);
// Still open: it is waiting on the employee, and stamping it closed would hide work from a list.
check('dihantar semula belum selesai', justificationSettled('reverted'), false);

console.log('\nRingkasan mengira yang DILULUSKAN sahaja');
const rows = [
  { statusKind: 'late', status: 'approved' },
  { statusKind: 'late', status: 'approved' },
  { statusKind: 'late', status: 'pending' },
  { statusKind: 'absent', status: 'approved' },
  { statusKind: 'absent', status: 'rejected' },
  { statusKind: 'early_leave', status: 'reverted' },
  { statusKind: 'incomplete', status: 'approved' },
];
check('dua lewat diluluskan', summariseApproved(rows).late, 2);
check('satu tidak hadir diluluskan', summariseApproved(rows).absent, 1);
check('satu tidak lengkap diluluskan', summariseApproved(rows).incomplete, 1);
/*
 * Pending, rejected and reverted all count zero. Counting a pending explanation would let somebody
 * clear their own late record by writing a sentence about it.
 */
check('keluar awal sifar — hanya dihantar semula', summariseApproved(rows).early_leave, 0);
check('senarai kosong semua sifar', summariseApproved([]), {
  late: 0,
  early_leave: 0,
  incomplete: 0,
  absent: 0,
});
// A technical exception kind reaching this table would not be counted into anything.
check(
  'jenis bukan justifikasi dilangkau',
  summariseApproved([{ statusKind: 'clock_drift', status: 'approved' }]),
  { late: 0, early_leave: 0, incomplete: 0, absent: 0 },
);

console.log(`\n${passed} lulus, ${failed} gagal\n`);
process.exit(failed > 0 ? 1 : 0);
