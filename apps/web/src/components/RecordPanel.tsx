import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Minus,
  RotateCcw,
  Search,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { T, useLabels } from '../lib/translation';

/**
 * The record-panel pattern.
 *
 * Every list screen in this application uses the same shell: one card holding a
 * title, tabs, a chip strip, a filter row, a full-bleed table, and a footer stating
 * what is shown out of what. Extracted here rather than copied per page, because a
 * layout repeated by hand across nineteen screens diverges within a release, and the
 * divergence shows up as the application looking half-finished.
 *
 * Padding lives on the cells, not on the table, so the header and footer rules run
 * the full width of the card. That is what makes the card read as one object instead
 * of a table floating inside a box.
 */

export function PanelCard({
  title,
  subtitle,
  children,
}: {
  /** Nodes rather than strings, so a call site can pass `<T>` and carry the label stamp. */
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="px-5 pt-5 pb-4">
        <h1 className="text-lg font-semibold text-slate-800">{title}</h1>
        {subtitle !== undefined && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

export interface PanelTab {
  id: string;
  /**
   * A node rather than a string, so a label can carry its translation stamp.
   *
   * `aria-label` on the button still needs plain text, which is what `labelText` is for.
   */
  label: ReactNode;
  /** Plain text for the accessible name, where `label` is not a bare string. */
  labelText?: string;
  icon?: ReactNode;
  /** Shown as a count pill beside the label. */
  count?: number;
}

/**
 * Tabs flush with the card edge.
 *
 * Inside the card rather than above it, so the panel below reads as belonging to the
 * selected tab rather than floating under all of them.
 */
export function PanelTabs({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: PanelTab[];
  active: string;
  onChange: (id: string) => void;
  label: string;
}): ReactNode {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b border-slate-200 px-5">
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={tab.labelText}
            onClick={() => onChange(tab.id)}
            className={cn(
              '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium',
              selected
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                  selected ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-slate-500',
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Sub-header for the selected tab.
 *
 * Carries the primary action, because what "add" means differs per tab: a new
 * administrator and a new app client are not the same act, and one button at the top
 * of the card would have to guess which.
 */
export function PanelSection({
  title,
  subtitle,
  icon,
  action,
}: {
  /** A node rather than a string, so a heading can carry its translation stamp. */
  title: ReactNode;
  subtitle?: ReactNode;
  /**
   * Optional, and only for the heading that opens a tab.
   *
   * Repeating it on every sub-header would make the column of icons the thing being read
   * instead of the titles.
   */
  icon?: ReactNode;
  action?: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon !== undefined && (
          <span className="bg-brand-100 text-brand-700 mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {subtitle !== undefined && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export interface Chip {
  id: string;
  /** A node, so the chip can carry its label stamp. */
  label: ReactNode;
  count: number;
  /** Tailwind background for the leading dot. */
  dot: string;
}

/**
 * Toggle chips above the table.
 *
 * Counts must be computed ignoring this filter, so selecting one does not zero the
 * others and make the remaining rows look like they vanished. A chip at zero is shown
 * but not clickable: the zero is information, a button that leads nowhere is a trap.
 */
export function ChipBar({
  chips,
  active,
  onChange,
}: {
  chips: Chip[];
  active: string | undefined;
  onChange: (id: string | undefined) => void;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/60 px-5 py-2.5">
      {chips.map((chip) => {
        const selected = chip.id === active;
        return (
          <button
            key={chip.id}
            type="button"
            aria-pressed={selected}
            disabled={chip.count === 0 && !selected}
            onClick={() => onChange(selected ? undefined : chip.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
              selected
                ? 'border-slate-400 bg-white text-slate-900 shadow-sm'
                : 'border-transparent text-slate-600 hover:border-slate-300 hover:bg-white',
              chip.count === 0 &&
                !selected &&
                'cursor-default opacity-50 hover:border-transparent hover:bg-transparent',
            )}
          >
            <span className={cn('size-1.5 rounded-full', chip.dot)} aria-hidden />
            {/*
              Uppercased here rather than at each call site. Every screen was calling
              `.toUpperCase()` on the wording itself, which bakes a presentation choice into
              the string — and a translated string cannot be uppercased safely in every
              language. CSS is where this belongs.
            */}
            <span className="uppercase">{chip.label}</span>
            <span className="tabular-nums text-slate-500">{chip.count}</span>
          </button>
        );
      })}
    </div>
  );
}

const CONTROL =
  'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700';

export function FilterRow({
  search,
  onSearch,
  placeholder,
  dirty,
  onReset,
  exportUrl,
  children,
}: {
  /**
   * Omitted where the list has no text search.
   *
   * A search box that accepts typing and filters nothing is worse than no box: it
   * teaches the operator the list is broken rather than that it filters differently.
   */
  search?: string;
  onSearch?: (value: string) => void;
  placeholder?: string;
  dirty: boolean;
  onReset: () => void;
  /** Omitted where the list has no export. */
  exportUrl?: string;
  children?: ReactNode;
}): ReactNode {
  const { t } = useLabels();
  const searchable = search !== undefined && onSearch !== undefined;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-5 py-3">
      {searchable ? (
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={placeholder}
            aria-label={placeholder ?? t('panel.search')}
            className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-700"
          />
        </div>
      ) : (
        <span className="flex-1" />
      )}

      {children}

      {/* Disabled when nothing is filtered, so it does not invite a click that
          would change nothing. */}
      <button
        type="button"
        onClick={onReset}
        disabled={!dirty}
        className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 disabled:cursor-default disabled:text-slate-300"
      >
        <RotateCcw className="size-3.5" aria-hidden />
        <T k="panel.reset" />
      </button>

      {exportUrl !== undefined && (
        <a
          href={exportUrl}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <Download className="size-3.5" aria-hidden />
          <T k="panel.export" />
        </a>
      )}
    </div>
  );
}

/** Select whose options carry their own row counts, so it only offers real values. */
export function FacetSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
}): ReactNode {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      className={cn(CONTROL, 'min-w-36', className)}
    >
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function DateBox({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <input
      type="date"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      title={label}
      className={cn(CONTROL, 'w-36')}
    />
  );
}

export interface PanelColumn {
  /**
   * A node, so a column heading can carry its label stamp.
   *
   * Column headings are read, not just decoration — they are what tells somebody which
   * value a cell holds — so they are translatable like any other label.
   */
  header: ReactNode;
  /** Tailwind width utility, or empty for the column that should flex. */
  width?: string;
  align?: 'left' | 'right';
}

/**
 * Table shell.
 *
 * Renders a real `<table>` with scoped headers so the relationship between a cell
 * and its column survives a screen reader, which a grid of divs does not. The trailing
 * column is reserved for the row expander.
 *
 * ## `framed`
 *
 * Full-bleed by default: the cells carry the padding, so the header rule and the footer rule
 * run the full width of the card and the whole panel reads as one object.
 *
 * `framed` sits the table on a tinted field inside its own bordered card instead. It is the
 * same device `SettingsStack` uses, for the same reason — a change of surface is what makes
 * something read as its own object — applied to a table rather than to a run of groups.
 *
 * It exists because full-bleed stops working once a row is mostly whitespace. A table with one
 * flexing column and seven narrow ones puts a cluster of values hard against each edge with a
 * void between them, and with no boundary to measure those positions against the row reads as
 * loose data rather than as a record. The frame is what the eye measures against.
 *
 * Opt-in rather than the default because it is being rolled out one screen at a time, and a
 * half-converted application is worse than either state on its own. Leave types is the
 * reference; every other table is still full-bleed until it is converted deliberately.
 */
export function RecordTable({
  columns,
  loading,
  empty,
  rowCount,
  framed = false,
  children,
}: {
  columns: PanelColumn[];
  loading: boolean;
  empty: ReactNode;
  rowCount: number;
  /** Sit the table in its own bordered card on a tinted field. See the note above. */
  framed?: boolean;
  children: ReactNode;
}): ReactNode {
  const { t } = useLabels();

  /**
   * Wraps whichever state the table is in, rather than only the populated one.
   *
   * A frame that disappears under its own loading spinner or empty message reads as the panel
   * having failed to render, not as a table with nothing in it — and the empty state is exactly
   * when somebody is least sure whether the screen is working.
   */
  const frame = (content: ReactNode): ReactNode =>
    framed ? (
      <div className="bg-slate-50/60 px-4 py-4">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">{content}</div>
      </div>
    ) : (
      content
    );

  if (loading && rowCount === 0) {
    return frame(
      <div className="flex min-h-64 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('app.loading')} />
      </div>,
    );
  }

  if (rowCount === 0) {
    return frame(<p className="py-16 text-center text-sm text-slate-500">{empty}</p>);
  }

  return frame(
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        {/*
          Tinted only when framed. Full-bleed, the rule under the headings is enough, and a band
          would read as a second card edge inside a card that has none.
        */}
        <thead className={cn(framed && 'bg-slate-50/70')}>
          <tr className="border-b border-slate-200 text-left text-[11px] tracking-wide text-slate-500 uppercase">
            {columns.map((column, index) => (
              <th
                /*
                  Index rather than the heading text: the heading is a node now, so it is not
                  a usable key. Column lists are static per screen, so the index is stable.
                */
                key={index}
                scope="col"
                className={cn(
                  'py-2 font-medium',
                  index === 0 ? 'px-5' : 'px-2',
                  column.align === 'right' && 'text-right',
                  column.width,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        {/*
          Framed, the last row's own `border-b` would land directly on the card's bottom edge and
          read as a doubled rule. Dropped here rather than at every call site, because the rows
          are written per screen and this has to hold on all of them.
        */}
        <tbody className={cn(framed && '[&>tr:last-child]:border-0')}>{children}</tbody>
      </table>
    </div>,
  );
}

export function ExpandButton({
  expanded,
  onClick,
  label,
}: {
  expanded: boolean;
  onClick: () => void;
  label: string;
}): ReactNode {
  const { t } = useLabels();

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={t(expanded ? 'panel.expand.close' : 'panel.expand.open', { label })}
      className="rounded-md p-1 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
    >
      <ChevronDown
        className={cn('size-4 transition-transform', expanded && 'rotate-180')}
        aria-hidden
      />
    </button>
  );
}

/**
 * A row action rendered as an icon.
 *
 * Tone carries the consequence: blue reads, amber changes, rose removes. The label is
 * both the tooltip and the accessible name, so an icon-only control is never nameless.
 */
export function RowAction({
  icon,
  label,
  tone = 'neutral',
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  tone?: 'neutral' | 'view' | 'edit' | 'warn' | 'danger' | 'success';
  onClick: () => void;
  disabled?: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'rounded-md border border-transparent p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        tone === 'neutral' && 'text-slate-400 hover:bg-slate-100 hover:text-slate-700',
        tone === 'view' && 'text-sky-500 hover:bg-sky-50 hover:text-sky-700',
        tone === 'edit' && 'text-amber-500 hover:bg-amber-50 hover:text-amber-700',
        tone === 'success' && 'text-emerald-500 hover:bg-emerald-50 hover:text-emerald-700',
        tone === 'warn' && 'text-orange-500 hover:bg-orange-50 hover:text-orange-700',
        tone === 'danger' && 'text-rose-500 hover:bg-rose-50 hover:text-rose-700',
      )}
    >
      {icon}
    </button>
  );
}

/** Groups row actions so the column keeps a stable width as rows differ. */
export function RowActions({ children }: { children: ReactNode }): ReactNode {
  return <div className="flex items-center justify-end gap-0.5">{children}</div>;
}

/**
 * A yes/no cell, as a mark rather than a word.
 *
 * Columns of `ya` / `tidak` / `dibenarkan` read as a dump of field values: every cell is the
 * same weight, so finding the one row that differs means reading all of them. A filled green
 * mark against a hollow grey one is found by looking, which is what a column of eight
 * booleans is actually for.
 *
 * `label` is required and carries the column's meaning for this row — the mark is an image, so
 * without it a screen reader reaches a cell that announces nothing. Same rule as `RowAction`:
 * nothing icon-only is nameless.
 *
 * Deliberately not tone-configurable. True is emerald and false is slate everywhere, because a
 * column where false is sometimes red and sometimes grey invites the reader to work out which
 * kind of false this one is.
 */
export function BoolMark({ value, label }: { value: boolean; label: string }): ReactNode {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-5 items-center justify-center rounded-full',
        value ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400',
      )}
    >
      {value ? (
        <Check className="size-3.5" strokeWidth={3} aria-hidden />
      ) : (
        <Minus className="size-3.5" strokeWidth={3} aria-hidden />
      )}
    </span>
  );
}

/**
 * The identifying code at the head of a row, tinted with the record's own colour.
 *
 * The colour already exists on these records and was previously spent on a 10px dot beside the
 * code. Carrying it on the code itself is the same information given enough area to be found
 * peripherally, which is how somebody picks one row out of thirty without reading codes.
 *
 * `colour` is validated as a hex literal before it reaches the style attribute. It is stored as
 * free text up to sixteen characters, so anything could be in there; an unparseable value falls
 * back to slate rather than emitting a broken `color-mix` and rendering an untinted pill that
 * looks like a bug in the row.
 */
export function CodePill({ code, colour }: { code: string; colour?: string | null }): ReactNode {
  const hex = colour !== null && colour !== undefined && /^#[0-9a-f]{3,8}$/i.test(colour.trim())
    ? colour.trim()
    : null;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-1 font-mono text-[11px] font-semibold',
        hex === null && 'bg-slate-100 text-slate-600',
      )}
      style={
        hex === null
          ? undefined
          : { backgroundColor: `color-mix(in srgb, ${hex} 16%, white)`, color: hex }
      }
    >
      {code}
    </span>
  );
}

/**
 * Footer.
 *
 * States what is shown out of what, and when it was read. These are live tables, and
 * a page open for twenty minutes looks identical to a fresh one without a timestamp.
 */
export function PanelFooter({
  shown,
  total,
  page,
  pageSize,
  pageSizes = [30, 50, 100, 200],
  generatedAt,
  loading,
  onPage,
  onPageSize,
  onRefresh,
}: {
  shown: number;
  total: number;
  page: number;
  pageSize: number;
  pageSizes?: number[];
  generatedAt?: string | null;
  loading: boolean;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
  onRefresh: () => void;
}): ReactNode {
  const { t } = useLabels();
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const number = new Intl.NumberFormat('ms-MY');

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
      <p className="text-xs text-slate-500">
        {t('panel.footer.showing', {
          shown: number.format(shown),
          total: number.format(total),
        })}
        {generatedAt !== null && generatedAt !== undefined && (
          <>
            {' · '}
            <T k="panel.footer.readAt" />{' '}
            <time dateTime={generatedAt}>
              {new Date(generatedAt).toLocaleTimeString('ms-MY', { hour12: false })}
            </time>
          </>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label={t('app.refresh')}
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
        >
          <RotateCcw className={cn('size-3.5', loading && 'animate-spin')} aria-hidden />
        </button>

        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <T k="panel.footer.perPage" />
          <select
            value={String(pageSize)}
            onChange={(event) => onPageSize(Number(event.target.value))}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
          >
            {pageSizes.map((size) => (
              <option key={size} value={String(size)}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <nav aria-label={t('panel.footer.pages')} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
            <T k="panel.footer.previous" />
          </button>
          <span className="px-1.5 text-xs tabular-nums text-slate-600">
            {page} / {lastPage}
          </span>
          <button
            type="button"
            onClick={() => onPage(Math.min(lastPage, page + 1))}
            disabled={page >= lastPage}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <T k="panel.footer.next" />
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        </nav>
      </div>
    </div>
  );
}

/**
 * Padded region for a tab whose content is a form rather than a table.
 *
 * Tables are full-bleed because their cells carry the padding. Forms are not, so the
 * padding lives here instead of being repeated on every field group.
 */
export function PanelBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return <div className={cn('px-5 py-4', className)}>{children}</div>;
}

/** Two-column field grid, collapsing to one on narrow viewports. */
export function FormGrid({ children }: { children: ReactNode }): ReactNode {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

/**
 * The tinted field a run of `SettingsGroup` cards sits on.
 *
 * A configuration tab is a list of separate decisions, not one form. Run flat, the rows
 * blur into a single column of controls and the operator has to read every label to find
 * the one group they came for. Changing the surface under the cards is what makes each of
 * them read as its own object, the same way the app body reads against the sidebar.
 *
 * No border of its own: the change in surface is the boundary, and adding one would double
 * up against the `border-t` of whatever action strip follows.
 */
export function SettingsStack({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return <div className={cn('space-y-3 bg-slate-50/60 px-5 py-4', className)}>{children}</div>;
}

/**
 * One group of settings, boxed.
 *
 * The header carries an icon because these are scanned rather than read — the same reason
 * every sidebar entry has one. `action` holds the group's current state as a summary, so a
 * collapsed glance still says "120/min" or "3 disenaraikan" without opening anything.
 */
export function SettingsGroup({
  title,
  icon,
  subtitle,
  action,
  children,
  className,
}: {
  /** Nodes rather than strings, so these can carry their label stamps. */
  title: ReactNode;
  icon?: ReactNode;
  subtitle?: ReactNode;
  /** A short live summary of what the group is currently set to. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <section
      className={cn('overflow-hidden rounded-lg border border-slate-200 bg-white', className)}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-600 uppercase">
            {icon !== undefined && <span className="text-brand-600">{icon}</span>}
            {title}
          </h3>
          {subtitle !== undefined && (
            <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>
          )}
        </div>
        {action}
      </header>
      {/* The rows carry their own vertical rhythm, so this only keeps them off the edges. */}
      <div className="px-4 py-2">{children}</div>
    </section>
  );
}

const NOTE_TONES = {
  info: 'border-slate-200 bg-slate-50 text-slate-600',
  warn: 'border-amber-300 bg-amber-50 text-amber-900',
  danger: 'border-rose-300 bg-rose-50 text-rose-800',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-800',
} as const;

/**
 * The explanatory strip.
 *
 * Used wherever a control needs a caveat that must not be hidden behind a tooltip. A
 * setting whose consequence only appears on hover is a setting that gets changed
 * without the consequence being read.
 */
export function PanelNote({
  tone = 'info',
  icon,
  children,
  className,
}: {
  tone?: keyof typeof NOTE_TONES;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
        NOTE_TONES[tone],
        className,
      )}
    >
      {icon !== undefined && <span className="mt-0.5 shrink-0">{icon}</span>}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * Action strip closing a form panel.
 *
 * The hint sits beside the button rather than under it, so what the save will and will
 * not do is read at the moment of deciding to press it.
 *
 * ## The button is on the right
 *
 * It used to render first and land on the left, with the hint filling the space to its right. That
 * put the save button of every form tab — Integrasi, Konfigurasi Umum, Keselamatan, Notifikasi — on
 * the opposite side from the save button of every dialog, because `DialogFooter` is `justify-end`.
 * Two strips that close a form in the same application cannot disagree about where its commit
 * control lives; the eye goes to one corner and finds it half the time.
 *
 * The hint takes the free space so the button stays hard against the right edge however long the
 * sentence is.
 */
export function PanelActions({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 px-5 py-3">
      {hint !== undefined && <p className="min-w-0 flex-1 text-xs text-slate-500">{hint}</p>}
      {children}
    </div>
  );
}

/** Read-only key and value rows, for values fixed outside the application. */
export function KeyValueList({ children }: { children: ReactNode }): ReactNode {
  return <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">{children}</dl>;
}

export function KeyValue({
  label,
  value,
  mono = true,
}: {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
}): ReactNode {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-1.5">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className={cn('min-w-0 truncate text-right text-slate-700', mono ? 'font-mono text-xs' : '')}>
        {value}
      </dd>
    </div>
  );
}

/** Label and value pair for the detail shown when a row is expanded. */
export function Detail({
  label,
  value,
  mono,
}: {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
}): ReactNode {
  return (
    <div>
      <dt className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className={cn('mt-0.5 break-all text-slate-700', mono === true && 'font-mono')}>
        {value}
      </dd>
    </div>
  );
}

/** Grid the expanded row places its details in. */
export function DetailGrid({ children }: { children: ReactNode }): ReactNode {
  return (
    <dl className="grid gap-x-8 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">{children}</dl>
  );
}
