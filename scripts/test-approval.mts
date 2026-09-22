/**
 * Regression suite for the approval chain arithmetic. No server and no database.
 *
 * These are the rules the reference implementation broke twice, both times silently:
 * a rejection recorded at rung 1 while the request stayed at rung 0, and a chain whose
 * length disagreed with its highest rung so nothing could reach the last one.
 */
import {
  APPROVAL_MODULES,
  MODULE_SETTING_DEFAULTS,
  NOTIFY_MODULES,
  isApprovalModule,
  isNotifyModule,
  resolveOutcome,
  settingIsOn,
  shouldNotifyApplicant,
  type ApprovalOutcome,
  type ModuleSettings,
} from '../apps/server/src/hr/approval.js';

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

console.log('\nTiada rantaian dikonfigurasikan — kelakuan sebelum enjin ini');
check('satu kelulusan menyelesaikannya', resolveOutcome({ action: 'approve', currentLevel: 0, chainLength: 0 }), {
  status: 'approved',
  level: 1,
  finalized: true,
  awaitingLevel: null,
});
/*
 * The rung recorded must never be 0. A settled request at rung 0 reads as unsigned to
 * `checkApproverTurn`, which is exactly the state the reference produced for its
 * chain-less modules.
 */
check('aras yang direkod bukan sifar', resolveOutcome({ action: 'approve', currentLevel: 0, chainLength: 0 }).level, 1);

console.log('\nRantaian satu aras');
check('aras 1 daripada 1 selesai', resolveOutcome({ action: 'approve', currentLevel: 0, chainLength: 1 }), {
  status: 'approved',
  level: 1,
  finalized: true,
  awaitingLevel: null,
});

console.log('\nRantaian tiga aras');
check('aras 1 daripada 3 masih menunggu', resolveOutcome({ action: 'approve', currentLevel: 0, chainLength: 3 }), {
  status: 'pending',
  level: 1,
  finalized: false,
  awaitingLevel: 2,
});
check('aras 2 daripada 3 masih menunggu', resolveOutcome({ action: 'approve', currentLevel: 1, chainLength: 3 }), {
  status: 'pending',
  level: 2,
  finalized: false,
  awaitingLevel: 3,
});
check('aras 3 daripada 3 selesai', resolveOutcome({ action: 'approve', currentLevel: 2, chainLength: 3 }), {
  status: 'approved',
  level: 3,
  finalized: true,
  awaitingLevel: null,
});
// Only the last rung writes `approved`. An intermediate rung that wrote it would let a
// payroll read pick up a request two more people had yet to see.
check(
  'hanya aras terakhir menulis diluluskan',
  [0, 1, 2].map((level) => resolveOutcome({ action: 'approve', currentLevel: level, chainLength: 3 }).status),
  ['pending', 'pending', 'approved'],
);

console.log('\nPenolakan adalah terminal pada mana-mana aras');
check('ditolak sebelum sesiapa tandatangan', resolveOutcome({ action: 'reject', currentLevel: 0, chainLength: 3 }), {
  status: 'rejected',
  level: 1,
  finalized: true,
  awaitingLevel: null,
});
check('ditolak pada aras 2', resolveOutcome({ action: 'reject', currentLevel: 2, chainLength: 3 }), {
  status: 'rejected',
  level: 2,
  finalized: true,
  awaitingLevel: null,
});
check(
  'penolakan tanpa rantaian juga terminal',
  resolveOutcome({ action: 'reject', currentLevel: 0, chainLength: 0 }).finalized,
  true,
);

console.log('\nTetapan modul');
const defaults: ModuleSettings = { ...MODULE_SETTING_DEFAULTS };
check('notifyApplicant hidup secara lalai', settingIsOn(defaults, 'notifyApplicant'), true);
check('notifyEveryLevel mati secara lalai', settingIsOn(defaults, 'notifyEveryLevel'), false);
check('ccEmail kosong secara lalai', defaults.ccEmail, '');

const settled: ApprovalOutcome = {
  status: 'approved',
  level: 3,
  totalLevels: 3,
  finalized: true,
  awaitingLevel: null,
  awaitingLabel: null,
};
const midway: ApprovalOutcome = {
  status: 'pending',
  level: 1,
  totalLevels: 3,
  finalized: false,
  awaitingLevel: 2,
  awaitingLabel: 'Ketua Jabatan',
};

check('pemohon diberitahu bila selesai', shouldNotifyApplicant(defaults, settled), true);
/*
 * The reason `notifyEveryLevel` defaults off: telling somebody "approved" at rung 1 of 3
 * tells them something untrue. The request is still pending and can still be refused.
 */
check('senyap pada aras pertengahan secara lalai', shouldNotifyApplicant(defaults, midway), false);
check(
  'aras pertengahan diberitahu bila dihidupkan',
  shouldNotifyApplicant({ ...defaults, notifyEveryLevel: '1' }, midway),
  true,
);
check(
  'notifyApplicant mati mengalahkan segalanya',
  shouldNotifyApplicant({ ...defaults, notifyApplicant: '0', notifyEveryLevel: '1' }, settled),
  false,
);

// ---------------------------------------------------------------------------
console.log('\nModul yang menghantar emel lebih luas daripada modul berantai');
// ---------------------------------------------------------------------------

/*
 * Two registries, and the gap between them is the whole point.
 *
 * A chain is `pending → approved | rejected` with a rung somebody is currently on. A payroll period
 * is `draft → processing → approved → paid → closed` with no rung and no rejection, and a KPI
 * assignment moves through scoring rather than signatures. Admitting either to `APPROVAL_MODULES`
 * would give it a screen of rungs no decision ever climbs — the reference did exactly that for
 * payroll and had to delete the permission rows again.
 *
 * `routes/hr-settings.ts` keeps two `:module` guards on the strength of this split, so if the two
 * lists ever collapse into one the chain endpoints quietly start accepting payroll.
 */
check('lima modul berantai', APPROVAL_MODULES.length, 5);
check('lapan modul menghantar emel', NOTIFY_MODULES.length, 8);

check('cuti ada rantaian', isApprovalModule('leave'), true);
check('cuti menghantar emel', isNotifyModule('leave'), true);

check('payroll TIADA rantaian', isApprovalModule('payroll'), false);
check('payroll menghantar emel', isNotifyModule('payroll'), true);
check('kpi TIADA rantaian', isApprovalModule('kpi'), false);
check('kpi menghantar emel', isNotifyModule('kpi'), true);
/*
 * Justification is the third chainless module, and the clearest case of the split.
 *
 * One submission, one named decision, three possible outcomes — and nothing above the supervisor who
 * decides it. Giving it a chain would mean a nurse's explanation for being late climbed two rungs
 * before anybody could accept it.
 */
check('justifikasi TIADA rantaian', isApprovalModule('justification'), false);
check('justifikasi menghantar emel', isNotifyModule('justification'), true);

check('modul palsu tiada rantaian', isApprovalModule('tiada'), false);
check('modul palsu tidak menghantar emel', isNotifyModule('tiada'), false);

// Every module with a chain must also be able to send mail about its decisions. The reverse does
// not hold, and that asymmetry is what the two lists express.
check(
  'setiap modul berantai juga menghantar emel',
  APPROVAL_MODULES.filter((module) => !isNotifyModule(module)),
  [],
);

console.log(`\n${passed} lulus, ${failed} gagal\n`);
process.exit(failed > 0 ? 1 : 0);
