/**
 * Verifies the Alih Bahasa tab: the language list, and one language's wording.
 *
 * The check this file exists for is the label id. It has to survive labels being added,
 * because the number is meant to be written down and quoted — if it is derived from read
 * order, "label 1" is a different string tomorrow and the number is worthless.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-translation.mts <password>
 */
import { generateSync } from 'otplib';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-translation.mts <adminPassword>');
  process.exit(2);
}

let cookie = '';
let failures = 0;

const { db } = await import('../apps/server/src/db.js');

await warmUpPrisma();
await login();
check('logged in', cookie.length > 0);

/** Removed at the end whether or not the run succeeds. */
const TEST_CODE = 'zz';

await call('DELETE', `/api/translations/locales/${TEST_CODE}`).catch(() => undefined);

// ---------------------------------------------------------------------------
console.log('\n=== The language list ===');
// ---------------------------------------------------------------------------

const list = await call('GET', '/api/translations');
check('the list responds', list.status === 200);
check('with a label total a language has to cover', typeof list.body['labelCount'] === 'number');

const locales = (list.body['locales'] ?? []) as Array<Record<string, unknown>>;
check('and at least one language', locales.length > 0);

const source = locales.find((locale) => locale['isSource'] === true);
/**
 * Created on read rather than in the seed, so the list is never empty on a fresh install
 * and nobody has to remember to seed it.
 */
check('Bahasa Melayu exists as the source language', source?.['code'] === 'ms');
check('and is active', source?.['active'] === true);
check('and every row reports whether it is the default', locales.every((locale) => 'isDefault' in locale));
/**
 * Complete by definition: its wording *is* the label. Reporting it as 0 of N would be
 * reporting a job that does not exist.
 */
check('and counts as fully translated', source?.['translated'] === list.body['labelCount']);
show('bahasa', locales.map((locale) => `${String(locale['name'])} (${String(locale['code'])})`).join(', '));
show('label', String(list.body['labelCount']));

// ---------------------------------------------------------------------------
console.log('\n=== Adding a language ===');
// ---------------------------------------------------------------------------

const added = await call('POST', '/api/translations/locales', { code: TEST_CODE, name: 'Ujian' });
check('a language can be added', added.status === 200);

const afterAdd = ((await call('GET', '/api/translations')).body['locales'] ?? []) as Array<Record<string, unknown>>;
const fresh = afterAdd.find((locale) => locale['code'] === TEST_CODE);
check('it appears in the list', fresh !== undefined);
/**
 * Off by default. A half-translated language switched on shows a screen that is partly one
 * language and partly another, which reads as broken rather than as unfinished.
 */
check('and starts inactive', fresh?.['active'] === false);
check('with nothing translated', fresh?.['translated'] === 0);
check('and is not the source', fresh?.['isSource'] === false);

const dup = await call('POST', '/api/translations/locales', { code: TEST_CODE, name: 'Ujian Lagi' });
check('a duplicate code is refused', dup.status === 409);
show('message', String(dup.body['error']));

for (const [label, code] of [
  ['a single letter', 'z'],
  ['a code with digits', 'e1'],
  ['a code with spaces', 'en gb'],
  ['an over-long code', 'englishlang'],
] as const) {
  const bad = await call('POST', '/api/translations/locales', { code, name: 'Ujian' });
  check(`${label} is refused`, bad.status === 400);
}

// ---------------------------------------------------------------------------
console.log('\n=== The label id is stable ===');
// ---------------------------------------------------------------------------

const labels = await call('GET', `/api/translations/${TEST_CODE}/labels`);
check('labels respond', labels.status === 200);

const rows = (labels.body['labels'] ?? []) as Array<Record<string, unknown>>;
check('with at least the first label', rows.length > 0);
check(
  'each carries what the row renders',
  rows.every((row) => ['id', 'key', 'groupKey', 'sourceText', 'context', 'text'].every((key) => key in row)),
);

const first = rows[0];
check('the first label is the tab title itself', first?.['key'] === 'settings.translation.title');
check('with the Malay wording as its source', first?.['sourceText'] === 'Alih Bahasa');
check('and nothing translated yet', first?.['text'] === '');
show('label', `#${String(first?.['id'])} · ${String(first?.['key'])} · "${String(first?.['sourceText'])}"`);
show('konteks', String(first?.['context']));

/**
 * The property the whole numbering scheme rests on.
 *
 * A label inserted directly, then removed, must not move the id of anything else. Read-time
 * numbering would renumber every label after it.
 */
const before = rows.map((row) => `${String(row['id'])}:${String(row['key'])}`);

const injected = await db().translationLabel.create({
  data: {
    key: 'zz.test.injected',
    groupKey: 'settings',
    sourceText: 'Label ujian',
    context: 'Disuntik oleh verify-translation',
  },
});

const afterInsert = ((await call('GET', `/api/translations/${TEST_CODE}/labels`)).body['labels'] ??
  []) as Array<Record<string, unknown>>;

// The registry sync retires it on the same read, because the key is not in the code — which
// is itself the behaviour worth checking.
const stillThere = afterInsert.map((row) => `${String(row['id'])}:${String(row['key'])}`);
check(
  'adding a label leaves every other id where it was',
  before.every((entry) => stillThere.includes(entry)),
);

const retired = await db().translationLabel.findUnique({ where: { id: injected.id } });
/**
 * Marked, not deleted. The id may already have been written down, and deleting the row
 * would take any translations with it — which is what you want back if the label returns.
 */
check('a key absent from the code registry is retired rather than deleted', retired !== null);
check('and carries a retirement date', retired?.retiredAt !== null);
check('so it drops out of the editor', !afterInsert.some((row) => row['key'] === 'zz.test.injected'));

await db().translationLabel.delete({ where: { id: injected.id } });

// ---------------------------------------------------------------------------
console.log('\n=== Writing a translation ===');
// ---------------------------------------------------------------------------

const labelId = Number(first?.['id']);

const saved = await call('PUT', `/api/translations/${TEST_CODE}/labels`, {
  values: [{ id: labelId, text: 'Translation' }],
});
check('a translation saves', saved.status === 200);
check('and reports how many were written', saved.body['written'] === 1);

const readBack = ((await call('GET', `/api/translations/${TEST_CODE}/labels`)).body['labels'] ??
  []) as Array<Record<string, unknown>>;
check('it reads back on the label', readBack[0]?.['text'] === 'Translation');
check('while the Malay source is unchanged', readBack[0]?.['sourceText'] === 'Alih Bahasa');
show('terjemahan', `#${String(labelId)} "Alih Bahasa" → "${String(readBack[0]?.['text'])}"`);

const counted = ((await call('GET', '/api/translations')).body['locales'] ?? []) as Array<Record<string, unknown>>;
check(
  'and the language now counts one translated label',
  counted.find((locale) => locale['code'] === TEST_CODE)?.['translated'] === 1,
);

/**
 * Blank removes the row rather than storing an empty string, so "not translated" has one
 * representation and the label falls back to the source instead of rendering empty.
 */
const clearedSave = await call('PUT', `/api/translations/${TEST_CODE}/labels`, {
  values: [{ id: labelId, text: '   ' }],
});
check('a blank translation is cleared, not stored as empty', clearedSave.body['cleared'] === 1);

const rowsLeft = await db().translationValue.count({ where: { locale: TEST_CODE } });
check('and leaves no row behind', rowsLeft === 0);

const unknownLabel = await call('PUT', `/api/translations/${TEST_CODE}/labels`, {
  values: [{ id: 999_999, text: 'X' }],
});
check('an unknown label id is refused', unknownLabel.status === 409);
check('and the refusal names it', String(unknownLabel.body['error']).includes('999999'));

const extraKey = await call('PUT', `/api/translations/${TEST_CODE}/labels`, {
  values: [{ id: labelId, text: 'X', locale: 'hack' }],
});
// Strict, so a key the endpoint does not own fails loudly rather than being stripped.
check('an unrecognised key in the body is refused', extraKey.status === 400);

// ---------------------------------------------------------------------------
console.log('\n=== The source language is not editable ===');
// ---------------------------------------------------------------------------

const sourceEdit = await call('PUT', '/api/translations/ms/labels', {
  values: [{ id: labelId, text: 'Sesuatu Yang Lain' }],
});
/**
 * The Malay wording lives in the code. A stored copy would be a second place it is defined,
 * and the copy would win over any later correction made in the source.
 */
check('the source language refuses an edit', sourceEdit.status === 409);
check('and says where its wording comes from', String(sourceEdit.body['error']).includes('kod aplikasi'));
show('message', String(sourceEdit.body['error']));

const sourceOff = await call('PATCH', '/api/translations/locales/ms', { active: false });
check('the source language cannot be switched off', sourceOff.status === 409);

const sourceDelete = await call('DELETE', '/api/translations/locales/ms');
check('nor deleted', sourceDelete.status === 409);
show('message', String(sourceDelete.body['error']));

const sourceStillThere = await db().translationLocale.findUnique({ where: { code: 'ms' } });
check('and it is still there afterwards', sourceStillThere?.isSource === true);

// ---------------------------------------------------------------------------
console.log('\n=== Activating and renaming ===');
// ---------------------------------------------------------------------------

const activated = await call('PATCH', `/api/translations/locales/${TEST_CODE}`, { active: true });
check('a language can be switched on', activated.status === 200);

const renamed = await call('PATCH', `/api/translations/locales/${TEST_CODE}`, { name: 'Ujian Baharu' });
check('and renamed', renamed.status === 200);

const afterRename = ((await call('GET', '/api/translations')).body['locales'] ?? []) as Array<Record<string, unknown>>;
const target = afterRename.find((locale) => locale['code'] === TEST_CODE);
check('the new name reads back', target?.['name'] === 'Ujian Baharu');
check('and it is active', target?.['active'] === true);

const codeChange = await call('PATCH', `/api/translations/locales/${TEST_CODE}`, { code: 'yy' });
// The code is the primary key and part of the URL, so it is not editable.
check('the code cannot be changed', codeChange.status === 400);

// ---------------------------------------------------------------------------
console.log('\n=== The default language ===');
// ---------------------------------------------------------------------------

const withDefault = ((await call('GET', '/api/translations')).body['locales'] ?? []) as Array<
  Record<string, unknown>
>;
const defaults = withDefault.filter((locale) => locale['isDefault'] === true);
/**
 * There is always exactly one. "No default" would mean the interface has no language to open
 * in and every screen would have to invent its own fallback.
 */
check('exactly one language is the default', defaults.length === 1);
show('lalai', `${String(defaults[0]?.['name'])} (${String(defaults[0]?.['code'])})`);

const previous = String(defaults[0]?.['code']);

// Already active from the section above.
const moved = await call('PATCH', `/api/translations/locales/${TEST_CODE}`, { isDefault: true });
check('the default can be moved with one call', moved.status === 200);

const afterMove = ((await call('GET', '/api/translations')).body['locales'] ?? []) as Array<
  Record<string, unknown>
>;
check(
  'the new holder has it',
  afterMove.find((locale) => locale['code'] === TEST_CODE)?.['isDefault'] === true,
);
// Cleared in the same transaction, so there is never a moment with two.
check(
  'and the previous holder lost it',
  afterMove.find((locale) => locale['code'] === previous)?.['isDefault'] === false,
);
check('still exactly one', afterMove.filter((locale) => locale['isDefault'] === true).length === 1);

/**
 * The default is what every user opens, so it cannot point at a language nobody has
 * finished — that is the same half-and-half screen `active` exists to prevent, shown to
 * everybody instead of to whoever chose it.
 */
const offAndDefault = await call('PATCH', `/api/translations/locales/${TEST_CODE}`, { active: false });
check('the default language cannot be switched off', offAndDefault.status === 409);
show('message', String(offAndDefault.body['error']).slice(0, 120));

const deleteDefault = await call('DELETE', `/api/translations/locales/${TEST_CODE}`);
// Refused rather than silently handing the default back to the source: that would change
// what every user opens as a side effect of a delete, and nobody would connect the two.
check('nor deleted while it holds the default', deleteDefault.status === 409);

// Move it back so the language can be cleaned up.
await call('PATCH', `/api/translations/locales/${previous}`, { isDefault: true });
check(
  'moving it away frees the language',
  (await call('PATCH', `/api/translations/locales/${TEST_CODE}`, { active: false })).status === 200,
);

const inactiveDefault = await call('PATCH', `/api/translations/locales/${TEST_CODE}`, {
  isDefault: true,
});
check('an inactive language cannot become the default', inactiveDefault.status === 409);
check('and the refusal says to switch it on first', String(inactiveDefault.body['error']).includes('Hidupkan'));

const clearDefault = await call('PATCH', `/api/translations/locales/${previous}`, {
  isDefault: false,
});
// Only ever `true`. Clearing it would leave no default at all.
check('the default cannot be cleared, only moved', clearDefault.status === 400);

// ---------------------------------------------------------------------------
console.log('\n=== The dictionary the interface renders from ===');
// ---------------------------------------------------------------------------

const dictionary = await call('GET', '/api/translations/dictionary');
check('the dictionary responds', dictionary.status === 200);
check('naming the locale it resolved', typeof dictionary.body['locale'] === 'string');

const entries = (dictionary.body['entries'] ?? {}) as Record<string, Record<string, unknown>>;
const tabLabel = entries['settings.translation.title'];

/*
 * The source asked for by name, not by assuming it holds the default.
 *
 * The fallback assertions below are about what the source locale returns, and reaching it through the
 * default made them depend on a setting an administrator is allowed to change. Setting English as the
 * default is a supported configuration, and under it the unqualified call correctly returns the English
 * wording — so the checks failed while nothing was wrong.
 */
const asSource = await call('GET', '/api/translations/dictionary?locale=ms');
const sourceEntries = (asSource.body['entries'] ?? {}) as Record<string, Record<string, unknown>>;
const sourceLabel = sourceEntries['settings.translation.title'];
check('the source locale can be asked for by name', asSource.body['isSource'] === true);
check('the tab label is in it', tabLabel !== undefined);
/**
 * The id travels with the entry. That is what lets the interface stamp the numbers onto
 * itself, which is how somebody finds which string `#1` refers to without hunting screens.
 */
check('carrying its id', typeof tabLabel?.['id'] === 'number');
check('its text', typeof tabLabel?.['text'] === 'string');
check('and whether that text is a translation or the source', typeof tabLabel?.['translated'] === 'boolean');
show('kamus', `${String(dictionary.body['locale'])} · #${String(tabLabel?.['id'])} → "${String(tabLabel?.['text'])}"`);

// Nothing is stored for the source, so every entry falls back to the Malay wording in the code.
check('the source locale reports its text as untranslated', sourceLabel?.['translated'] === false);
check('and the text is the Malay source', sourceLabel?.['text'] === 'Alih Bahasa');

// Asked for a specific locale, the translation wins.
await call('PATCH', `/api/translations/locales/${TEST_CODE}`, { active: true });
await call('PUT', `/api/translations/${TEST_CODE}/labels`, {
  values: [{ id: labelId, text: 'Translation' }],
});

const asTest = await call('GET', `/api/translations/dictionary?locale=${TEST_CODE}`);
const testEntry = ((asTest.body['entries'] ?? {}) as Record<string, Record<string, unknown>>)[
  'settings.translation.title'
];
check('a translated locale returns the translation', testEntry?.['text'] === 'Translation');
check('marked as translated', testEntry?.['translated'] === true);
// The id is the same whichever language is asked for: it belongs to the label, not to a
// language's copy of it.
check('with the same id as the source', testEntry?.['id'] === tabLabel?.['id']);

const unknownLocale = await call('GET', '/api/translations/dictionary?locale=qq');
// Falls back rather than failing: a screen must render even if somebody asks for a language
// that has been deleted.
check('an unknown locale falls back to the default', unknownLocale.status === 200);
show('fallback', String(unknownLocale.body['locale']));

// The dictionary is the interface text, so it needs a session but no permission — a clerk
// must not see a different language from an administrator.
const anonymousDictionary = await fetch(`${BASE}/api/translations/dictionary`);
check('the dictionary needs a session', anonymousDictionary.status === 401);

// ---------------------------------------------------------------------------
console.log('\n=== The session carries the language it resolved ===');
// ---------------------------------------------------------------------------

const me = await call('GET', '/api/auth/me');
const display = (me.body['display'] ?? {}) as Record<string, unknown>;
const account = (me.body['user'] ?? {}) as Record<string, unknown>;
/**
 * Delivered on the session so the resolved language is a value the client holds, not a flag
 * only the settings screen can see.
 */
check('the session reports a locale', typeof display['locale'] === 'string');

/**
 * Resolved against the account's own choice first, and the deployment default only where the
 * account made none — which is the order `displayPreferences` documents and implements.
 *
 * This used to assert the default unconditionally. That passes only while whoever runs the
 * script has never picked a language, so it failed the moment this account was set to `en`
 * while the deployment default stayed `ms` — reporting a per-user preference working
 * correctly as a broken session. A check that a real setting turns red is worse than no
 * check, because the next person reads the whole file as noise.
 */
const chosen = typeof account['locale'] === 'string' ? String(account['locale']) : null;
check('and it resolves the account choice where there is one, the default otherwise',
  display['locale'] === (chosen ?? previous));
show('sesi', `${String(display['locale'])} (pilihan akaun: ${chosen ?? '∅'}, lalai: ${previous})`);

// ---------------------------------------------------------------------------
console.log('\n=== Permission ===');
// ---------------------------------------------------------------------------

const { PERMISSION_SECTIONS } = await import('../apps/server/src/auth/permissions.js');
const screens = PERMISSION_SECTIONS.flatMap((section) => section.screens);
const screen = screens.find((entry) => entry.key === 'settings.translation');

check('the screen is in the permission registry', screen !== undefined);
// Rewording the interface is a different job from naming the organisation.
check('separate from settings.general', screen !== screens.find((entry) => entry.key === 'settings.general'));
check(
  'offering view and edit only, because there is no record to create',
  JSON.stringify(screen?.actions) === JSON.stringify(['view', 'edit']),
);
show('skrin', String(screen?.label));

const anonymous = await fetch(`${BASE}/api/translations`);
check('the list needs a session', anonymous.status === 401);

await finish();

// ---------------------------------------------------------------------------

async function finish(): Promise<never> {
  console.log('\n=== Cleanup ===');

  // The default has to move off the test language before it can be deleted, which is the
  // rule this script just verified.
  await call('PATCH', '/api/translations/locales/ms', { isDefault: true }).catch(() => undefined);

  const removed = await call('DELETE', `/api/translations/locales/${TEST_CODE}`);
  check('the test language is removed', removed.status === 200 || removed.status === 404);

  const left = await db().translationLocale.count({ where: { code: TEST_CODE } });
  check('and leaves nothing behind', left === 0);

  const values = await db().translationValue.count({ where: { locale: TEST_CODE } });
  check('nor any of its translations', values === 0);

  const injected = await db().translationLabel.count({ where: { key: 'zz.test.injected' } });
  check('and the injected label is gone', injected === 0);

  const source = await db().translationLocale.findUnique({ where: { code: 'ms' } });
  check('the source language survived the run', source?.isSource === true && source.active);

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

async function warmUpPrisma(): Promise<void> {
  await db().translationLabel.count();
  await waitForServer();
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 60_000;
  let restarted = false;

  for (let tick = 0; Date.now() < deadline; tick += 1) {
    const up = await fetch(`${BASE}/api/health`)
      .then((response) => response.ok)
      .catch(() => false);

    if (up && (restarted || tick >= 3)) {
      if (restarted) console.log('  pelayan dimulakan semula, sambung');
      return;
    }
    if (!up) restarted = true;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  console.error('Pelayan tidak menjawab. Pastikan `npm run dev` berjalan dalam apps/server.');
  process.exit(2);
}

async function login(): Promise<void> {
  cookie = '';
  await call('POST', '/api/auth/login', {
    email,
    password,
    ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
  });
}

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  for (const entry of response.headers.getSetCookie()) {
    const pair = entry.split(';')[0];
    if (pair?.startsWith('attendance_session=')) cookie = pair;
  }

  const text = await response.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = (JSON.parse(text) ?? {}) as Record<string, unknown>;
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }

  return { status: response.status, body: parsed };
}

function show(label: string, value: string): void {
  console.log(`         ${label}: ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
