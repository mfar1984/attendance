import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { LABELS, type LabelKey } from '@attendance/shared';

import { api } from './api';
import { useAuth } from './auth';

/**
 * Interface wording, and the diagnostic that makes it findable.
 *
 * Every translatable string goes through `<T>`, which does two things: it resolves the
 * wording for the current language, and — when label numbers are switched on — it stamps
 * the label's id beside itself.
 *
 * That stamp is the point. A translation screen can list "label #1: Alih Bahasa" all day and
 * still leave somebody hunting through twenty-four screens for where that string appears.
 * Turning the numbers on answers it by putting them on the interface itself.
 *
 * The mode lives in `sessionStorage`, not `localStorage`. It is a diagnostic, and a
 * diagnostic that survives closing the browser is one somebody leaves on and then reports as
 * a rendering bug.
 */

const SHOW_KEY = 'translation.showLabelNumbers';

export interface DictionaryEntry {
  /** Stable, quotable, assigned once per label key. */
  id: number;
  /** The translation where there is one, the source wording otherwise. */
  text: string;
  /** False when this is still the untranslated source. */
  translated: boolean;
}

interface DictionaryPayload {
  locale: string;
  isSource: boolean;
  entries: Record<string, DictionaryEntry>;
}

interface TranslationContextValue {
  locale: string;
  entries: Record<string, DictionaryEntry>;
  /** Whether label ids are being stamped onto the interface. */
  showNumbers: boolean;
  setShowNumbers: (value: boolean) => void;
  /** Re-reads the dictionary, for after a translation is saved. */
  refresh: () => Promise<void>;
  /** How many labels the registry currently covers. */
  count: number;
}

const TranslationContext = createContext<TranslationContextValue | null>(null);

export function TranslationProvider({ children }: { children: ReactNode }): ReactNode {
  /**
   * The language comes from the session, not from here.
   *
   * The server resolves it — the account's own choice where there is one, the deployment
   * default otherwise — so there is one answer and the client cannot hold a different one.
   * Storing the choice in `localStorage` instead was rejected: the preference would stay on
   * one browser, so somebody who picked English at a counter machine would get Malay back on
   * their phone, and an administrator could not see what language a person is actually
   * reading when they report a wording problem.
   */
  const { display, loading: sessionLoading } = useAuth();
  const wanted = display?.locale ?? null;

  const [payload, setPayload] = useState<DictionaryPayload | null>(null);
  const [showNumbers, setShow] = useState(() => {
    try {
      return window.sessionStorage.getItem(SHOW_KEY) === '1';
    } catch {
      return false;
    }
  });

  const refresh = useCallback(async () => {
    try {
      const query = wanted === null ? '' : `?locale=${encodeURIComponent(wanted)}`;
      setPayload(await api.get<DictionaryPayload>(`/api/translations/dictionary${query}`));
    } catch {
      // A dictionary that cannot be read leaves `<T>` on its fallback, which is the source
      // wording passed in at the call site. The interface still renders.
    }
  }, [wanted]);

  /**
   * Held until the session probe lands, then re-run whenever the language changes.
   *
   * Waiting matters on a cold load: firing immediately reads the deployment default, and the
   * account's own choice arrives a moment later — so the interface would render in one
   * language and visibly reflow into another. The dependency on `wanted` is what makes a
   * saved change take effect, because saving calls `refreshDisplay()` and the new code
   * arrives through the same path a fresh login would use.
   */
  useEffect(() => {
    if (sessionLoading) return;
    void refresh();
  }, [sessionLoading, refresh]);

  const setShowNumbers = useCallback((value: boolean) => {
    setShow(value);
    try {
      if (value) window.sessionStorage.setItem(SHOW_KEY, '1');
      else window.sessionStorage.removeItem(SHOW_KEY);
    } catch {
      // Not being able to remember the mode is not worth failing over.
    }
  }, []);

  const value = useMemo<TranslationContextValue>(
    () => ({
      locale: payload?.locale ?? 'ms',
      entries: payload?.entries ?? {},
      showNumbers,
      setShowNumbers,
      refresh,
      count: Object.keys(payload?.entries ?? {}).length,
    }),
    [payload, showNumbers, setShowNumbers, refresh],
  );

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}

export function useTranslation(): TranslationContextValue {
  const context = useContext(TranslationContext);
  if (!context) throw new Error('useTranslation must be used inside <TranslationProvider>');
  return context;
}

/**
 * Values substituted into a label's `{placeholder}` slots.
 *
 * Sentences that carry a value are kept whole rather than split into fragments around it.
 * Fragments assume the value sits in the same position in every language, and it does not —
 * concatenating "terminal" + count + "offline" produces something ungrammatical the moment
 * the clause order differs.
 */
export type LabelVars = Record<string, string | number>;

/** Replaces `{name}` with the supplied value. Unknown slots are left visible on purpose. */
function format(text: string, vars: LabelVars | undefined): string {
  if (vars === undefined) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/**
 * Splits the wording on its `{slot}` tokens and drops the supplied nodes into the gaps.
 *
 * The string form cannot do this: a node has to stay a node all the way to the output, so the
 * substitution happens during render rather than before it.
 */
function interleave(text: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = text.split(/(\{\w+\})/g);

  return parts.map((part, index) => {
    const slot = /^\{(\w+)\}$/.exec(part);
    if (slot === null) return part;

    const name = slot[1]!;
    // An unfilled slot stays visible: a blank gap reads as missing wording, whereas the
    // literal `{name}` says a value was expected and did not arrive.
    if (!(name in vars)) return part;

    return <Fragment key={`${name}-${String(index)}`}>{vars[name]}</Fragment>;
  });
}

/**
 * Resolves one key to the wording that should render.
 *
 * The registry is the fallback, so a call site never repeats the Malay text and the two
 * cannot disagree. It also means a label works the moment it is called, before the server
 * has synced it — during a rollout that is the difference between a screen showing the right
 * words and a screen showing a key.
 */
function resolve(
  entries: Record<string, DictionaryEntry>,
  key: LabelKey,
  vars?: LabelVars,
): string {
  return format(entries[key]?.text ?? LABELS[key], vars);
}

/**
 * The string form, for props that cannot take a node.
 *
 * `placeholder`, `aria-label` and `title` are strings by definition. Those get no label
 * badge, which is correct — a number inside an input's placeholder would be read out as part
 * of the hint.
 */
export function useLabels(): {
  t: (key: LabelKey, vars?: LabelVars) => string;
  tEnum: (key: LabelKey | undefined, fallback: string) => string;
  showNumbers: boolean;
  locale: string;
} {
  const { entries, showNumbers, locale } = useTranslation();

  const t = useCallback(
    (key: LabelKey, vars?: LabelVars) => resolve(entries, key, vars),
    [entries],
  );

  const tEnum = useCallback(
    (key: LabelKey | undefined, fallback: string) =>
      key === undefined ? fallback : resolve(entries, key),
    [entries],
  );

  return { t, tEnum, showNumbers, locale };
}

/**
 * One translatable string, as a node.
 *
 * Takes only the key: the Malay wording lives in the registry, so there is nothing to repeat
 * here and nothing to fall out of step. When label numbers are on, this is what carries the
 * badge.
 */
export function T({
  k,
  vars,
}: {
  k: LabelKey;
  /**
   * Slot values, which may be nodes.
   *
   * Nodes matter for a sentence with an emphasised clause inside it. The alternative is
   * splitting the sentence into three labels around the `<strong>`, which fixes where the
   * emphasis sits — and in another language it does not sit there.
   */
  vars?: Record<string, ReactNode>;
}): ReactNode {
  const { entries, showNumbers } = useTranslation();
  const entry = entries[k];
  const raw = entries[k]?.text ?? LABELS[k];
  const text = vars === undefined ? raw : interleave(raw, vars);

  if (!showNumbers) return <>{text}</>;

  /*
    Centred, not baseline-aligned. The badge is a 10px font inside a padded box, and
    aligning its baseline with 14px text hangs the whole box below the words. Centring the
    boxes is what makes it read as level.

    `flex-wrap` so a long label still wraps: the badge stays on the first line and the text
    flows under it rather than forcing one long unbreakable row.
  */
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <LabelNumber id={entry?.id ?? null} translated={entry?.translated ?? false} />
      {text}
    </span>
  );
}

/**
 * A label looked up from a value-to-key map, falling back to the raw value.
 *
 * The maps in `lib/*-api.ts` turn a stored enum into a registry key. A value with no key is
 * one the server knows about and the interface does not, which happens while the schema grows
 * — showing the raw enum is better than showing nothing, because it is still diagnosable, and
 * the missing-label badge marks it as unregistered.
 */
export function TEnum({
  k,
  fallback,
}: {
  k: LabelKey | undefined;
  fallback: string;
}): ReactNode {
  if (k === undefined) return <>{fallback}</>;
  return <T k={k} />;
}

/**
 * The stamp.
 *
 * Amber for a registered label, slate for one that is not in the registry yet — so turning
 * the mode on also shows what has *not* been wired up, which is the other half of the
 * question somebody is asking when they turn it on.
 *
 * ## These three tooltips are deliberately NOT registered
 *
 * Same exclusion as `LABEL_GROUPS`: they belong to the tool that translates rather than to the
 * interface being translated. Registering them would give the badges that display label numbers
 * their own label numbers to display, and somebody who switches the diagnostic on to hunt an
 * untranslated string would find the diagnostic reporting itself as untranslated. The wording
 * that explains the mechanism cannot be a subject of the mechanism.
 */
function LabelNumber({ id, translated }: { id: number | null; translated: boolean }): ReactNode {
  if (id === null) {
    return (
      <LabelBadge tone="unregistered" title="Belum didaftarkan dalam registry label">
        #–
      </LabelBadge>
    );
  }

  return (
    <LabelBadge
      tone={translated ? 'translated' : 'source'}
      title={
        translated
          ? `Label #${String(id)} — sudah diterjemah`
          : `Label #${String(id)} — masih perkataan sumber`
      }
    >
      #{id}
    </LabelBadge>
  );
}

const BADGE_TONES = {
  source: 'bg-amber-200 text-amber-900',
  translated: 'bg-emerald-200 text-emerald-900',
  unregistered: 'bg-slate-200 text-slate-600',
  /** Neutral, for showing an id where its state is not the point. */
  plain: 'bg-slate-100 text-slate-600',
} as const;

/**
 * The label-number badge.
 *
 * Exported so the legend on the settings screen and the editor rows use the same box rather
 * than each rebuilding it — a legend that has drifted from the thing it explains has stopped
 * explaining it.
 *
 * `leading-none` with symmetric padding is what keeps the height predictable. Without it the
 * box inherits whatever line-height the surrounding heading uses, which is why it sat at a
 * different offset on a tab than in a heading, and why baseline alignment left it hanging
 * below the words.
 *
 * `tabular-nums` keeps `#1` and `#11` the same width so a column of them does not jitter.
 */
export function LabelBadge({
  tone,
  title,
  children,
}: {
  tone: keyof typeof BADGE_TONES;
  title?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <span
      title={title}
      className={[
        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5',
        'font-mono text-[10px] leading-none font-semibold tabular-nums',
        BADGE_TONES[tone],
      ].join(' ')}
    >
      {children}
    </span>
  );
}
