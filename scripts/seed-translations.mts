/**
 * Loads a translation file into `translation_values`.
 *
 * Re-runnable. The file is the source of truth for the locale it names, so a run overwrites whatever
 * is stored — including edits made in the Alih Bahasa screen. That is the trade being made: the
 * translation lives in version control where it can be reviewed and restored, and the screen becomes
 * a way to try wording rather than the only place it exists.
 *
 * Keys are matched by text key, never by label id. Ids are assigned by insertion order and differ
 * between installations, so a file keyed on them would silently write the wrong words on a second
 * database.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-translations.mts en
 *
 * The source locale is refused, for the same reason `PUT /api/translations/ms/labels` answers 409:
 * Malay lives in `packages/shared/src/labels.ts`, and a stored copy would win over a later correction
 * made in the code.
 */
import { db, disconnectDb } from '../apps/server/src/db.js';
import {
  EN_LABELS,
  EN_LABELS_API,
  EN_LABELS_ATTENDANCE,
  EN_LABELS_BUILDER,
  EN_LABELS_CHANNELS,
  EN_LABELS_CLAIM_LINES,
  EN_LABELS_AGENT,
  EN_LABELS_DEVICE,
  EN_LABELS_DEVICE_CLOCK,
  EN_LABELS_DEVICE_DIAG,
  EN_LABELS_DEVICE_DOOR,
  EN_LABELS_DEVICE_HEALTH,
  EN_LABELS_DEVICE_VENDOR_HOLIDAY,
  EN_LABELS_ENROLMENT,
  EN_LABELS_HR,
  EN_LABELS_KPI,
  EN_LABELS_KPI_SETTINGS,
  EN_LABELS_LEAVE_POLICY,
  EN_LABELS_NAV_DRIVERS,
  EN_LABELS_PAY,
  EN_LABELS_PAY_AWARDS,
  EN_LABELS_PAY_LENDING,
  EN_LABELS_PAY_SLIPS,
  EN_LABELS_PAYROLL,
  EN_LABELS_MAINTENANCE,
  EN_LABELS_PERMISSIONS,
  EN_LABELS_RECRUIT,
  EN_LABELS_REQUESTS,
  EN_LABELS_ROLES,
  EN_LABELS_SCHEDULE,
  EN_LABELS_SETTINGS,
  EN_LABELS_STAFF,
  EN_LABELS_TRANSLATION,
  EN_LABELS_USERS,
  EN_LABELS_WEBHOOK,
} from './translations/en.js';

const DICTIONARIES: Record<string, Record<string, string>> = {
  // Flattened from the per-batch objects. Batches exist so a block can be reviewed as a unit and a
  // regression traced to one of them; nothing downstream needs to know they were separate.
  en: {
    ...EN_LABELS,
    ...EN_LABELS_ATTENDANCE,
    ...EN_LABELS_STAFF,
    ...EN_LABELS_ENROLMENT,
    ...EN_LABELS_SCHEDULE,
    ...EN_LABELS_REQUESTS,
    ...EN_LABELS_PERMISSIONS,
    ...EN_LABELS_ROLES,
    ...EN_LABELS_USERS,
    ...EN_LABELS_SETTINGS,
    ...EN_LABELS_MAINTENANCE,
    ...EN_LABELS_CHANNELS,
    ...EN_LABELS_API,
    ...EN_LABELS_WEBHOOK,
    ...EN_LABELS_RECRUIT,
    ...EN_LABELS_HR,
    ...EN_LABELS_BUILDER,
    ...EN_LABELS_TRANSLATION,
    ...EN_LABELS_PAYROLL,
    ...EN_LABELS_KPI,
    ...EN_LABELS_KPI_SETTINGS,
    ...EN_LABELS_PAY,
    ...EN_LABELS_PAY_SLIPS,
    ...EN_LABELS_PAY_AWARDS,
    ...EN_LABELS_PAY_LENDING,
    ...EN_LABELS_DEVICE,
    ...EN_LABELS_DEVICE_HEALTH,
    ...EN_LABELS_DEVICE_CLOCK,
    ...EN_LABELS_DEVICE_DOOR,
    ...EN_LABELS_DEVICE_DIAG,
    ...EN_LABELS_NAV_DRIVERS,
    ...EN_LABELS_LEAVE_POLICY,
    ...EN_LABELS_CLAIM_LINES,
    ...EN_LABELS_DEVICE_VENDOR_HOLIDAY,
    ...EN_LABELS_AGENT,
  },
};

const locale = process.argv[2] ?? 'en';
const dictionary = DICTIONARIES[locale];

if (dictionary === undefined) {
  console.error(`Tiada kamus untuk "${locale}". Ada: ${Object.keys(DICTIONARIES).join(', ')}`);
  process.exit(1);
}

const prisma = db();

const row = await prisma.translationLocale.findUnique({ where: { code: locale } });
if (row === null) {
  console.error(`Bahasa "${locale}" belum dicipta. Tambahnya di Tetapan › Alih Bahasa dahulu.`);
  await disconnectDb();
  process.exit(1);
}
if (row.isSource) {
  console.error(
    `"${locale}" ialah bahasa sumber. Perkataannya datang dari packages/shared/src/labels.ts.`,
  );
  await disconnectDb();
  process.exit(1);
}

/** Any active account will do for the audit column; the file is the real author. */
const actor = await prisma.userAccount.findFirst({
  where: { accountType: 'admin', status: 'active' },
  select: { id: true },
});

const labels = await prisma.translationLabel.findMany({
  where: { retiredAt: null },
  select: { id: true, key: true },
});
const byKey = new Map(labels.map((label) => [label.key, label.id]));

const entries = Object.entries(dictionary);
const missing: string[] = [];
let written = 0;

for (const [key, text] of entries) {
  const labelId = byKey.get(key);
  if (labelId === undefined) {
    /*
     * A key in the file that the database has never heard of.
     *
     * Reported rather than ignored: it means the registry moved and this file did not, and the
     * screen it belongs to will fall back to Malay without anything saying why.
     */
    missing.push(key);
    continue;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) continue;

  await prisma.translationValue.upsert({
    where: { labelId_locale: { labelId, locale } },
    create: { labelId, locale, text: trimmed, updatedBy: actor?.id ?? null },
    update: { text: trimmed, updatedBy: actor?.id ?? null },
  });
  written += 1;
}

/*
 * Counted against LIVE labels only.
 *
 * A plain `count({ where: { locale } })` includes values attached to labels that have since been
 * retired, and a retired label is never rendered — so that figure printed 4130 / 4112 and a coverage
 * of 100.4%. A percentage that can exceed one hundred is not a coverage figure, and the number it
 * replaced was the one somebody reads to decide whether there is work left.
 */
const stored = await prisma.translationValue.count({
  where: { locale, label: { retiredAt: null } },
});
const orphaned = await prisma.translationValue.count({
  where: { locale, label: { retiredAt: { not: null } } },
});

console.log(`\n${row.name} (${locale})`);
console.log(`  dalam fail   : ${String(entries.length)}`);
console.log(`  ditulis      : ${String(written)}`);
console.log(`  dalam DB     : ${String(stored)} / ${String(labels.length)} label`);
console.log(`  liputan      : ${((stored / Math.max(1, labels.length)) * 100).toFixed(1)}%`);

if (orphaned > 0) {
  /*
   * Reported, not deleted. The label kept its id when it was retired, so if the key returns the wording
   * returns with it — and a translation nothing renders costs nothing to keep.
   */
  console.log(`  label bersara: ${String(orphaned)} terjemahan pada label yang sudah bersara`);
}

if (missing.length > 0) {
  console.log(`\n  ${String(missing.length)} kunci dalam fail TIADA dalam DB:`);
  for (const key of missing.slice(0, 20)) console.log(`    ${key}`);
  if (missing.length > 20) console.log(`    … dan ${String(missing.length - 20)} lagi`);
}

/*
 * What is still untranslated, by group.
 *
 * The number that decides what to do next, and the reason this prints rather than just a total: a
 * group at 0% is a screen nobody can read, and a group at 90% is a screen with a few stray Malay
 * words in it. Those need different attention.
 */
const remaining = await prisma.translationLabel.groupBy({
  by: ['groupKey'],
  where: { retiredAt: null, values: { none: { locale } } },
  _count: { _all: true },
  orderBy: { _count: { id: 'desc' } },
});

if (remaining.length > 0) {
  console.log(`\n  Belum diterjemah, mengikut kumpulan:`);
  for (const group of remaining) {
    console.log(`    ${group.groupKey.padEnd(16)} ${String(group._count._all)}`);
  }
} else {
  console.log(`\n  Setiap label diterjemah.`);
}

console.log('');
await disconnectDb();
