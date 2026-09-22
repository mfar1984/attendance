/**
 * Lists every registry key with no English wording, with its Malay source.
 *
 * Reads the registry and the translation file directly rather than the database, so it answers the
 * question "what is left to write" rather than "what happens to be stored" — the two differ whenever
 * the file has moved ahead of a seed run, which is exactly when this is needed.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/missing-en.mts
 */
import { LABELS } from '../packages/shared/src/labels.js';
import * as EN from './translations/en.js';

const english = new Map<string, string>();
for (const value of Object.values(EN)) {
  if (typeof value !== 'object' || value === null) continue;
  for (const [key, text] of Object.entries(value as Record<string, string>)) {
    if (typeof text === 'string' && text.trim().length > 0) english.set(key, text);
  }
}

const registry = new Set(Object.keys(LABELS));
const missing = Object.entries(LABELS).filter(([key]) => !english.has(key));
/*
 * Keys in the file the registry has never heard of.
 *
 * `Partial<Record<LabelKey, string>>` is supposed to make these a compile error, but `tsx` strips types
 * without checking them — so a key removed from the registry can sit in this file indefinitely, doing
 * nothing, until `tsc` is run against it.
 */
const stale = [...english.keys()].filter((key) => !registry.has(key));

/*
 * Placeholders that do not match the source.
 *
 * `format()` substitutes `{count}`, `{cap}`, `{name}` at render time. A renamed or dropped one does not
 * error — it renders an em dash where a number was meant to be, which reads as "not applicable" rather
 * than as a fault. An extra one renders a dash too, so both directions are reported.
 */
const names = (text: string): string =>
  [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1] ?? '').sort().join(',');

const drifted: Array<{ key: string; source: string; target: string }> = [];
for (const [key, source] of Object.entries(LABELS)) {
  const target = english.get(key);
  if (target === undefined) continue;
  const want = names(String(source));
  const got = names(target);
  if (want !== got) drifted.push({ key, source: want, target: got });
}

console.log(
  `registry=${String(registry.size)} english=${String(english.size)} ` +
    `missing=${String(missing.length)} stale=${String(stale.length)} ` +
    `placeholderDrift=${String(drifted.length)}`,
);
console.log('');
for (const [key, source] of missing) {
  console.log(`MISSING ${key} :: ${String(source)}`);
}
for (const key of stale) {
  console.log(`STALE   ${key}`);
}
for (const entry of drifted) {
  console.log(`DRIFT   ${entry.key} :: source{${entry.source}} vs en{${entry.target}}`);
}

process.exit(missing.length + stale.length + drifted.length === 0 ? 0 : 1);
