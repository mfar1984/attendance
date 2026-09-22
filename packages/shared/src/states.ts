/**
 * Malaysian states and federal territories.
 *
 * Shared because three things read them: the holiday sync, the state picker on the holiday
 * settings tab, and the holiday list that has to name which states a day is observed in.
 *
 * ## Two code systems, and why only one of them is canonical
 *
 * `date-holidays` identifies Malaysian states by **number**. Asked directly, it answers:
 *
 *     new Holidays().getStates('MY')
 *     → { "01": "Johor", …, "10": "Selangor", "13": "Sarawak", "14": "Kuala Lumpur", … }
 *
 * and it accepts nothing else. `new Holidays('MY', 'swk')` does not throw — it silently falls
 * back to the national list. So a sync given letter codes returns seventeen federal days and
 * not one state day, and the only symptom is a list that looks short.
 *
 * Letter codes are what this application stores, because `swk` is readable in a database row,
 * in a URL and in a log line, and cannot be mistaken for a count the way `13` can. The numeric
 * form exists in exactly one place: `libraryStateCode()`, at the boundary where the library is
 * called. Nothing else may use it.
 *
 * This layout is taken from a system that learned it the hard way — it had the letter codes in
 * its settings screen and numeric codes in its holiday rows, the two never met, and ticking a
 * state stopped matching any holiday from that moment on.
 */

export type StateCode =
  | 'jhr'
  | 'kdh'
  | 'ktn'
  | 'kul'
  | 'lbn'
  | 'mlk'
  | 'nsn'
  | 'phg'
  | 'png'
  | 'prk'
  | 'pls'
  | 'pjy'
  | 'sbh'
  | 'swk'
  | 'sgr'
  | 'trg';

/**
 * In the order they are shown, which is alphabetical by name rather than by code.
 *
 * The picker is sixteen checkboxes somebody scans for their own state, so it is ordered the way
 * they would look for it. `LIBRARY_NUMERIC` keeps the library's own ordering separately.
 */
export const STATES: ReadonlyArray<{ code: StateCode; label: string }> = [
  { code: 'jhr', label: 'Johor' },
  { code: 'kdh', label: 'Kedah' },
  { code: 'ktn', label: 'Kelantan' },
  { code: 'kul', label: 'Kuala Lumpur' },
  { code: 'lbn', label: 'Labuan' },
  { code: 'mlk', label: 'Melaka' },
  { code: 'nsn', label: 'Negeri Sembilan' },
  { code: 'phg', label: 'Pahang' },
  { code: 'png', label: 'Pulau Pinang' },
  { code: 'prk', label: 'Perak' },
  { code: 'pls', label: 'Perlis' },
  { code: 'pjy', label: 'Putrajaya' },
  { code: 'sbh', label: 'Sabah' },
  { code: 'swk', label: 'Sarawak' },
  { code: 'sgr', label: 'Selangor' },
  { code: 'trg', label: 'Terengganu' },
];

export const STATE_LABEL: Readonly<Record<string, string>> = Object.fromEntries(
  STATES.map((state) => [state.code, state.label]),
);

export const STATE_CODES: readonly string[] = STATES.map((state) => state.code);

/**
 * The numbers `date-holidays` uses, and what each one means.
 *
 * Verified against `new Holidays().getStates('MY')` rather than transcribed from documentation.
 * The numbering is the library's own alphabetical order, where `01` is Johor — note that it puts
 * Melaka at `04` under the spelling "Malacca", so this map is also where that spelling stops.
 */
export const LIBRARY_NUMERIC: Readonly<Record<string, StateCode>> = {
  '01': 'jhr',
  '02': 'kdh',
  '03': 'ktn',
  '04': 'mlk',
  '05': 'nsn',
  '06': 'phg',
  '07': 'png',
  '08': 'prk',
  '09': 'pls',
  '10': 'sgr',
  '11': 'trg',
  '12': 'sbh',
  '13': 'swk',
  '14': 'kul',
  '15': 'lbn',
  '16': 'pjy',
};

const TO_LIBRARY: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(LIBRARY_NUMERIC).map(([numeric, code]) => [code, numeric]),
);

/**
 * Turns anything that might identify a state into a letter code, or null.
 *
 * Accepts a letter code or one of the library's numbers, in any casing. Deliberately does not
 * accept written names: nothing in this application stores a state as prose, and matching names
 * would invite somebody to start.
 */
export function normaliseStateCode(value: unknown): StateCode | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw.length === 0) return null;

  if (STATE_CODES.includes(raw)) return raw as StateCode;

  // `4` and `04` both mean Melaka to the library, so both are accepted here.
  const digits = raw.replace(/\D/g, '');
  if (digits.length > 0) return LIBRARY_NUMERIC[digits.padStart(2, '0')] ?? null;

  return null;
}

/**
 * The code to hand to `date-holidays`, or null for anything unrecognised.
 *
 * The single place the numeric form is allowed to appear. A caller that reaches for
 * `LIBRARY_NUMERIC` directly is rebuilding this and will get the fallback-to-national bug.
 */
export function libraryStateCode(value: unknown): string | null {
  const code = normaliseStateCode(value);
  return code === null ? null : TO_LIBRARY[code] ?? null;
}

/** Label for one code; the raw value when it is not a state this knows. */
export function stateLabel(value: unknown): string {
  const code = normaliseStateCode(value);
  return code === null ? String(value ?? '').trim() : STATE_LABEL[code] ?? String(value);
}

/**
 * Parses a stored list of state codes.
 *
 * Tolerates a JSON array and a comma-separated string, because a setting written by one endpoint
 * and read by another has historically been both. Unrecognised entries are dropped rather than
 * passed through: a bad code in the list would be handed to the sync, which would answer with the
 * national list and look like it worked.
 */
export function parseStateCodes(value: unknown): StateCode[] {
  if (value === null || value === undefined || value === '') return [];

  let items: unknown[] = [];
  if (Array.isArray(value)) {
    items = value;
  } else if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      items = Array.isArray(parsed) ? parsed : [value];
    } catch {
      items = value.split(',');
    }
  }

  const out: StateCode[] = [];
  for (const item of items) {
    const code = normaliseStateCode(item);
    if (code !== null && !out.includes(code)) out.push(code);
  }
  return out;
}
