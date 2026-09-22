import {
  CalendarRange,
  Columns3,
  Download,
  Loader2,
  Play,
  Table2,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Feedback } from '../components/Dialog';
import {
  DateBox,
  FacetSelect,
  FilterRow,
  PanelActions,
  PanelBody,
  PanelCard,
  PanelNote,
  PanelSection,
  PanelTabs,
  RecordTable,
} from '../components/RecordPanel';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import {
  LEAVE_STATUS_LABELS,
  downloadBuilderCsv,
  reportsApi,
  type BuilderRequest,
  type BuilderResult,
  type ReportDataset,
} from '../lib/reports-api';
import { STATUS_LABELS, daysAgoIso, lookupsApi, todayIso, type Lookups } from '../lib/operations-api';
import { T, useLabels } from '../lib/translation';
import type { LabelKey } from '@attendance/shared';

/**
 * Report builder.
 *
 * Deliberately not a query language. The datasets, their columns, and the ways they can
 * be grouped all come from the server, so nothing here can ask for a figure the server
 * does not already know how to produce. A report that computes its own arithmetic is a
 * second payroll engine, and nobody reconciles the second one against the first.
 *
 * Runs on a button rather than on every change to the picker. Ticking a column would
 * otherwise fire a query across a month of records for five thousand staff, and the
 * screen would spend its life cancelling requests nobody asked for.
 */
export function ReportBuilderPage(): ReactNode {
  const { can } = useAuth();
  const { t, tEnum } = useLabels();
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
          Object.fromEntries(
            payload.datasets.map((entry) => [entry.key, defaultSelection(entry)]),
          ),
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

  const run = useCallback(async () => {
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
      // Omits `limit` so the server's export cap applies instead of the preview cap:
      // the preview is a sample, the file is the answer.
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
    // Capped at the server's own limit, so the picker cannot compose a request the
    // server will reject with a validation error nobody can act on.
    if (selection.columns.length >= MAX_COLUMNS) return;
    setSelection({ columns: [...selection.columns, key] });
  };

  const grouped = selection.groupBy !== 'none';
  const numericSelected = selection.columns.filter((key) => NUMERIC_FIELDS.has(key));
  const number = new Intl.NumberFormat('ms-MY');

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
                count: entry.fields.length,
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
        title={active === null ? <T k="monthly.loading" /> : <T k={active.labelKey} />}
        subtitle={active === null ? undefined : <T k={active.noteKey} />}
        action={
          <button
            type="button"
            onClick={() => void run()}
            disabled={running || selection.columns.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Play className="size-3.5" aria-hidden />
            )}
            <T k="builder.run" />
          </button>
        }
      />

      <PanelBody className="space-y-4">
        <Feedback error={error} />

        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-slate-500 uppercase">
            <Columns3 className="size-3.5" aria-hidden />
            <T k="builder.columns" />
            <span className="tabular-nums text-slate-400">
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
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                    held
                      ? 'border-brand-300 bg-brand-50 font-medium text-brand-700'
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
            <CalendarRange className="size-3.5 text-slate-400" aria-hidden />
            <T k="builder.groupBy" />
            <select
              value={selection.groupBy}
              onChange={(event) => setSelection({ groupBy: event.target.value })}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700"
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
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700"
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
          Grouping sums the numeric columns and counts the rest. Said here rather than
          left to be inferred from a table that suddenly has three columns.
        */}
        {grouped && (
          <PanelNote>
            {/*
              The middle clause swaps between two sentences rather than being assembled from
              fragments, because the two say different things and their punctuation differs.
            */}
            <T
              k="builder.grouped.note"
              vars={{
                totals:
                  numericSelected.length > 0 ? (
                    <T
                      k="builder.grouped.withTotals"
                      vars={{ count: numericSelected.length }}
                    />
                  ) : (
                    <T k="builder.grouped.noNumeric" />
                  ),
              }}
            />
          </PanelNote>
        )}

        {selection.columns.length === 0 && (
          <PanelNote tone="warn">
            <T k="builder.needColumn" />
          </PanelNote>
        )}
      </PanelBody>

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t(dataset === 'exceptions' ? 'builder.search.exceptions' : 'staff.search')}
        dirty={
          departmentId !== '' || status !== '' || search !== '' || from !== daysAgoIso(30) || to !== todayIso()
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

      {stale && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2.5">
          <p className="flex items-center gap-2 text-xs text-amber-900">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            <T k="builder.stale" />
          </p>
        </div>
      )}

      <RecordTable
        loading={running}
        rowCount={result?.rows.length ?? 0}
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

      {result?.truncated === true && (
        <div className="border-t border-amber-200 bg-amber-50 px-5 py-2.5">
          <p className="flex items-start gap-2 text-xs text-amber-900">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            <span>
              <T
                k="builder.truncated"
                vars={{
                  limit: number.format(result.limit),
                  grouped: grouped ? <T k="builder.truncated.grouped" /> : '',
                }}
              />
            </span>
          </p>
        </div>
      )}

      <PanelActions
        hint={
          result === null ? (
            <T k="builder.hint.notRun" />
          ) : (
            <T
              k="builder.hint.shown"
              vars={{
                count: number.format(result.rows.length),
                // Carries its own parentheses, so an untruncated run leaves nothing stranded.
                cap: result.truncated ? (
                  <T k="builder.hint.cap" vars={{ limit: number.format(result.limit) }} />
                ) : (
                  ''
                ),
                time: (
                  <time dateTime={result.generatedAt}>
                    {new Date(result.generatedAt).toLocaleTimeString('ms-MY', { hour12: false })}
                  </time>
                ),
              }}
            />
          )
        }
      >
        {/* Running a preview and producing a file are separate grants. */}
        {can('reports.builder', 'export') && (
          <button
            type="button"
            onClick={() => void exportCsv()}
            disabled={exporting || selection.columns.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Download className="size-4" aria-hidden />
            )}
            <T k="builder.export" />
          </button>
        )}
      </PanelActions>
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
 * An empty picker on arrival makes the screen look broken; a sensible default makes
 * the first Jana produce something recognisable.
 */
function defaultSelection(dataset: ReportDataset): Selection {
  return { columns: dataset.fields.slice(0, 6).map((field) => field.key), groupBy: 'none' };
}

/**
 * Status values per dataset.
 *
 * Exceptions filter on open or resolved rather than a stored status column, which is
 * what the server accepts for that dataset.
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
