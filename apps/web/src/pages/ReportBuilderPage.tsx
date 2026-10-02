import type { LabelKey } from '@attendance/shared';
import { Columns3, Download, Loader2, Play, Table2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Feedback } from '../components/Dialog';
import {
  DateBox,
  FacetSelect,
  FilterRow,
  PanelActions,
  PanelBody,
  PanelCard,
  PanelFooter,
  PanelNote,
  PanelSection,
  PanelTabs,
  RecordTable,
} from '../components/RecordPanel';
import { Button } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { STATUS_LABELS, daysAgoIso, lookupsApi, todayIso, type Lookups } from '../lib/operations-api';
import {
  LEAVE_STATUS_LABELS,
  downloadBuilderCsv,
  reportsApi,
  type BuilderRequest,
  type BuilderResult,
  type ReportDataset,
} from '../lib/reports-api';
import { intlLocale, T, useLabels } from '../lib/translation';

const SCREEN = 'reports.builder';

/** The controls in the picker strip, matching the filter row beneath it. */
const CONTROL = 'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700';

/**
 * Report builder.
 *
 * Deliberately not a query language. The datasets, their columns, and the ways they can be grouped
 * all come from the server, so nothing here can ask for a figure the server does not already know
 * how to produce. A report that computes its own arithmetic is a second payroll engine, and nobody
 * reconciles the second one against the first.
 *
 * Runs on a button rather than on every change to the picker. Ticking a column would otherwise
 * fire a query across a month of records for five thousand staff, and the screen would spend its
 * life cancelling requests nobody asked for.
 */
export function ReportBuilderPage(): ReactNode {
  const { can } = useAuth();
  const { t, tEnum, locale } = useLabels();
  const [datasets, setDatasets] = useState<ReportDataset[]>([]);
  const [dataset, setDataset] = useState<BuilderRequest['dataset']>('attendance');
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [lookups, setLookups] = useState<Lookups | null>(null);

  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(200);

  const [result, setResult] = useState<BuilderResult | null>(null);
  const [ranWith, setRanWith] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void lookupsApi
      .load()
      .then(setLookups)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void reportsApi
      .fields()
      .then((payload) => {
        setDatasets(payload.datasets);
        setSelections(
          Object.fromEntries(payload.datasets.map((entry) => [entry.key, defaultSelection(entry)])),
        );
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : t('builder.error.fields'));
      });
  }, [t]);

  const active = datasets.find((entry) => entry.key === dataset) ?? null;
  const selection = selections[dataset] ?? { columns: [], groupBy: 'none' };

  const request = useMemo<BuilderRequest>(
    () => ({
      dataset,
      from,
      to,
      columns: selection.columns,
      groupBy: selection.groupBy,
      departmentId: departmentId === '' ? undefined : Number(departmentId),
      status: status === '' ? undefined : status,
      search: search.trim() === '' ? undefined : search.trim(),
      limit,
    }),
    [dataset, from, to, selection.columns, selection.groupBy, departmentId, status, search, limit],
  );

  /** Serialised request, used only to tell a shown table from a stale one. */
  const signature = JSON.stringify(request);
  const stale = ranWith !== null && ranWith !== signature;
  const noColumns = selection.columns.length === 0;

  const run = useCallback(async () => {
    if (request.columns.length === 0) return;
    setRunning(true);
    try {
      setResult(await reportsApi.run(request));
      setRanWith(JSON.stringify(request));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('builder.error.run'));
    } finally {
      setRunning(false);
    }
  }, [request, t]);

  const exportCsv = async (): Promise<void> => {
    setExporting(true);
    try {
      // Omits `limit` so the server's export cap applies instead of the preview cap: the preview
      // is a sample, the file is the answer.
      const { limit: _preview, ...rest } = request;
      await downloadBuilderCsv(rest);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('builder.error.export'));
    } finally {
      setExporting(false);
    }
  };

  const setSelection = (patch: Partial<Selection>): void => {
    setSelections((current) => ({
      ...current,
      [dataset]: { ...(current[dataset] ?? { columns: [], groupBy: 'none' }), ...patch },
    }));
  };

  const toggleColumn = (key: string): void => {
    const held = selection.columns.includes(key);
    if (held) {
      setSelection({ columns: selection.columns.filter((entry) => entry !== key) });
      return;
    }
    // Capped at the server's own limit, so the picker cannot compose a request the server will
    // reject with a validation error nobody can act on.
    if (selection.columns.length >= MAX_COLUMNS) return;
    setSelection({ columns: [...selection.columns, key] });
  };

  const grouped = selection.groupBy !== 'none';
  const numericSelected = selection.columns.filter((key) => NUMERIC_FIELDS.has(key));
  const number = new Intl.NumberFormat(intlLocale(locale));
  const rowCount = result?.rows.length ?? 0;

  return (
    <PanelCard title={<T k="builder.title" />} subtitle={<T k="builder.subtitle" />}>
      <PanelTabs
        label={t('builder.tabs.aria')}
        active={dataset}
        onChange={(id) => {
          setDataset(id as BuilderRequest['dataset']);
          setStatus('');
          setSearch('');
          setResult(null);
          setRanWith(null);
        }}
        tabs={
          datasets.length > 0
            ? datasets.map((entry) => ({
                id: entry.key,
                label: <T k={entry.labelKey} />,
                labelText: t(entry.labelKey),
                icon: <Table2 className="size-4" aria-hidden />,
              }))
            : /* Before the catalogue arrives, one placeholder tab so the strip is not empty. */
              [
                {
                  id: 'attendance',
                  label: <T k="records.title" />,
                  labelText: t('records.title'),
                  icon: <Table2 className="size-4" aria-hidden />,
                },
              ]
        }
      />

      <PanelSection
        // The count of what is on screen. A truncated result says so in the heading itself, so a
        // subtotal is never read as a total even while another note is showing.
        title={
          result === null ? (
            <T k="builder.count.notRun" />
          ) : (
            <T
              k={result.truncated ? 'builder.count.truncated' : 'builder.count'}
              vars={{ count: number.format(rowCount) }}
            />
          )
        }
        subtitle={active === null ? <T k="app.loading" /> : <T k={active.noteKey} />}
        action={
          <Button
            onClick={() => void run()}
            disabled={running || noColumns}
            {...(noColumns ? { title: t('builder.needColumn') } : {})}
          >
            {running ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
            <T k="builder.run" />
          </Button>
        }
      />

      {/* What the report is made of: its columns, and how the rows are folded. */}
      <PanelBody className="space-y-3 border-b border-slate-200">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-slate-500 uppercase">
            <Columns3 className="size-3.5" aria-hidden />
            <T k="builder.columns" />
            <span className="text-slate-400 tabular-nums">
              {selection.columns.length}/{MAX_COLUMNS}
            </span>
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(active?.fields ?? []).map((field) => {
              const held = selection.columns.includes(field.key);
              const full = !held && selection.columns.length >= MAX_COLUMNS;
              return (
                <label
                  key={field.key}
                  title={full ? t('builder.columns.full', { max: MAX_COLUMNS }) : undefined}
                  className={cn(
                    'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                    /*
                      `brand-500` and `brand-100`, the steps that exist. This used `brand-300` and
                      `brand-50`, which the palette does not have — Tailwind emitted nothing, so every
                      ticked column drew a black outline.
                    */
                    held
                      ? 'border-brand-500 bg-brand-100/60 text-brand-700 font-medium'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
                    full && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-3.5"
                    checked={held}
                    disabled={full}
                    onChange={() => toggleColumn(field.key)}
                  />
                  <T k={field.labelKey} />
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <T k="builder.groupBy" />
            <select
              value={selection.groupBy}
              onChange={(event) => setSelection({ groupBy: event.target.value })}
              className={CONTROL}
            >
              {/* `<option>` cannot hold a node, so these resolve to plain text. */}
              {(active?.groupBy ?? [{ key: 'none', labelKey: 'builder.groupBy.none' as const }]).map(
                (entry) => (
                  <option key={entry.key} value={entry.key}>
                    {t(entry.labelKey)}
                  </option>
                ),
              )}
            </select>
          </label>

          <label className="flex items-center gap-2 text-xs text-slate-600">
            <T k="builder.limit" />
            <select
              value={String(limit)}
              onChange={(event) => setLimit(Number(event.target.value))}
              className={CONTROL}
            >
              {[200, 500, 1000, 2000, 5000].map((size) => (
                <option key={size} value={String(size)}>
                  {t('builder.limit.rows', { count: number.format(size) })}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/*
          What grouping does, as the hint of the control that turns it on. Said here rather than left
          to be inferred from a table that suddenly has three columns.
        */}
        {grouped && (
          <p className="text-xs text-slate-500">
            {/*
              The middle clause swaps between two sentences rather than being assembled from
              fragments, because the two say different things and their punctuation differs.
            */}
            <T
              k="builder.grouped.note"
              vars={{
                totals:
                  numericSelected.length > 0 ? (
                    <T k="builder.grouped.withTotals" vars={{ count: numericSelected.length }} />
                  ) : (
                    <T k="builder.grouped.noNumeric" />
                  ),
              }}
            />
          </p>
        )}
      </PanelBody>

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t(dataset === 'exceptions' ? 'builder.search.exceptions' : 'staff.search')}
        dirty={
          departmentId !== '' ||
          status !== '' ||
          search !== '' ||
          from !== daysAgoIso(30) ||
          to !== todayIso()
        }
        onReset={() => {
          setFrom(daysAgoIso(30));
          setTo(todayIso());
          setDepartmentId('');
          setStatus('');
          setSearch('');
        }}
      >
        <DateBox label={t('payroll.filter.fromDate')} value={from} onChange={setFrom} />
        <span className="text-xs text-slate-400">
          <T k="payroll.filter.between" />
        </span>
        <DateBox label={t('payroll.filter.toDate')} value={to} onChange={setTo} />
        {dataset !== 'exceptions' && (
          <FacetSelect
            label={t('staff.filter.allDepartments')}
            value={departmentId}
            onChange={setDepartmentId}
            options={(lookups?.departments ?? []).map((row) => ({
              value: String(row.id),
              label: row.name,
            }))}
          />
        )}
        <FacetSelect
          label={t('builder.filter.allStatuses')}
          value={status}
          onChange={setStatus}
          options={statusOptions(dataset, tEnum)}
        />
      </FilterRow>

      {/*
        One note, the one that decides whether the table below can be read: nothing to run, a table
        that no longer matches the picker, or a table that is only part of the answer.
      */}
      {(error !== null || noColumns || stale || result?.truncated === true) && (
        <PanelBody className="space-y-2 pb-0">
          <Feedback error={error} />
          {noColumns ? (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="builder.needColumn" />
            </PanelNote>
          ) : stale ? (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="builder.stale" />
            </PanelNote>
          ) : result?.truncated === true ? (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T
                k="builder.truncated"
                vars={{
                  limit: number.format(result.limit),
                  grouped: grouped ? <T k="builder.truncated.grouped" /> : '',
                }}
              />
            </PanelNote>
          ) : null}
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={running}
        rowCount={rowCount}
        empty={<T k={result === null ? 'builder.empty.notRun' : 'builder.empty.noMatch'} />}
        columns={(result?.columns ?? []).map((column) => ({
          header: <T k={column.labelKey} />,
          align: NUMERIC_FIELDS.has(column.key) || column.key === 'count' ? 'right' : 'left',
        }))}
      >
        {(result?.rows ?? []).map((row, index) => (
          <tr
            key={index}
            className={cn('border-b border-slate-100 hover:bg-slate-50/70', stale && 'opacity-60')}
          >
            {(result?.columns ?? []).map((column, position) => {
              const numeric = NUMERIC_FIELDS.has(column.key) || column.key === 'count';
              return (
                <td
                  key={column.key}
                  className={cn(
                    'py-2.5 text-xs text-slate-700',
                    position === 0 ? 'px-5 font-medium text-slate-800' : 'px-2',
                    numeric && 'text-right font-mono tabular-nums',
                  )}
                >
                  {row[column.key] === undefined || row[column.key] === '' ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    row[column.key]
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </RecordTable>

      <PanelFooter
        shown={rowCount}
        total={rowCount}
        page={1}
        pageSize={Math.max(1, rowCount)}
        pageSizes={[Math.max(1, rowCount)]}
        generatedAt={result?.generatedAt ?? null}
        loading={running}
        onPage={() => undefined}
        onPageSize={() => undefined}
        // Runs the query again as it stands, the same act as the button above.
        onRefresh={() => void run()}
      />

      {/* Running a preview and producing a file are separate grants. */}
      {can(SCREEN, 'export') && (
        <PanelActions hint={<T k="builder.export.hint" />}>
          <Button
            variant="ghost"
            onClick={() => void exportCsv()}
            disabled={exporting || noColumns}
            {...(noColumns ? { title: t('builder.needColumn') } : {})}
          >
            {exporting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Download className="size-4" aria-hidden />
            )}
            <T k="builder.export" />
          </Button>
        </PanelActions>
      )}
    </PanelCard>
  );
}

interface Selection {
  columns: string[];
  groupBy: string;
}

/** Matches the server's `columns` bound, so the picker cannot build a rejected request. */
const MAX_COLUMNS = 20;

/** The fields the server sums when grouping; everything else is only counted. */
const NUMERIC_FIELDS = new Set([
  'lateMinutes',
  'earlyLeaveMinutes',
  'workedMinutes',
  'overtimeMinutes',
  'days',
]);

/**
 * Opens with the first few columns ticked.
 *
 * An empty picker on arrival makes the screen look broken; a sensible default makes the first run
 * produce something recognisable.
 */
function defaultSelection(dataset: ReportDataset): Selection {
  return { columns: dataset.fields.slice(0, 6).map((field) => field.key), groupBy: 'none' };
}

/**
 * Status values per dataset.
 *
 * Exceptions filter on open or resolved rather than a stored status column, which is what the
 * server accepts for that dataset.
 */
function statusOptions(
  dataset: BuilderRequest['dataset'],
  /** Passed in because this is a plain function and hooks cannot be called from one. */
  tEnum: (key: LabelKey | undefined, fallback: string) => string,
): Array<{ value: string; label: string }> {
  if (dataset === 'exceptions') {
    return [
      { value: 'open', label: tEnum('builder.status.open', 'open') },
      { value: 'resolved', label: tEnum('builder.status.resolved', 'resolved') },
    ];
  }
  // `<option>` cannot hold a node, so these resolve to plain text.
  if (dataset === 'leave') {
    return Object.entries(LEAVE_STATUS_LABELS).map(([value, key]) => ({
      value,
      label: tEnum(key, value),
    }));
  }
  return Object.entries(STATUS_LABELS).map(([value, key]) => ({
    value,
    label: tEnum(key, value),
  }));
}
