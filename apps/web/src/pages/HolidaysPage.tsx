import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { LabelKey } from '@attendance/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  ChipBar,
  FacetSelect,
  FilterRow,
  FormGrid,
  PanelBody,
  PanelCard,
  PanelFooter,
  PanelNote,
  PanelSection,
  RecordTable,
  RowAction,
  RowActions,
} from '../components/RecordPanel';
import { Button, Field } from '../components/ui';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { formatDateOnly } from '../lib/operations-api';
import { T, useLabels } from '../lib/translation';

/**
 * Registry keys indexed by `getUTCDay`, because a holiday is a calendar date and not an
 * instant. Keys rather than words so the day names go through the registry like anything else.
 */
const WEEKDAYS: LabelKey[] = [
  'weekday.0',
  'weekday.1',
  'weekday.2',
  'weekday.3',
  'weekday.4',
  'weekday.5',
  'weekday.6',
];

interface Holiday {
  id: number;
  name: string;
  date: string;
  stateCode: string | null;
  /** True for days the organisation declared itself. */
  companyDeclared: boolean;
}

/**
 * Malaysian state codes, for holidays that are not nationwide.
 *
 * The state names are proper nouns and stay as they are — Johor is Johor in any language.
 * Only "nationwide" is wording, and that one is registered.
 */
const STATES = [
  { code: '', label: null },
  { code: 'JHR', label: 'Johor' },
  { code: 'KDH', label: 'Kedah' },
  { code: 'KTN', label: 'Kelantan' },
  { code: 'MLK', label: 'Melaka' },
  { code: 'NSN', label: 'Negeri Sembilan' },
  { code: 'PHG', label: 'Pahang' },
  { code: 'PNG', label: 'Pulau Pinang' },
  { code: 'PRK', label: 'Perak' },
  { code: 'PLS', label: 'Perlis' },
  { code: 'SBH', label: 'Sabah' },
  { code: 'SWK', label: 'Sarawak' },
  { code: 'SGR', label: 'Selangor' },
  { code: 'TRG', label: 'Terengganu' },
  { code: 'KUL', label: 'Kuala Lumpur' },
  { code: 'LBN', label: 'Labuan' },
  { code: 'PJY', label: 'Putrajaya' },
];

/** `null` means nationwide, which is the one entry that needs translating. */
function stateLabel(code: string | null, nationwide: string): string {
  if (code === null) return nationwide;
  return STATES.find((state) => state.code === code)?.label ?? code;
}

/**
 * Public and company holidays.
 *
 * Held here rather than under Integrasi because most organisations add days no public
 * source will ever return: a company shutdown, a local celebration. If the calendar
 * lived behind an integration, adding one by hand would be the awkward path.
 */
export function HolidaysPage(): ReactNode {
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<Holiday[]>([]);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<string | undefined>(undefined);
  const [stateFilter, setStateFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<Holiday | null>(null);
  const { t } = useLabels();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<{ year: number; rows: Holiday[] }>(
        `/api/holidays?year=${String(year)}`,
      );
      setRows(result.rows);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('holidays.error.load'));
    } finally {
      setLoading(false);
    }
  }, [year, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: Holiday): Promise<void> {
    setConfirming(null);
    setError(null);
    setNotice(null);
    try {
      await api.delete(`/api/holidays/${String(row.id)}`);
      setNotice(
        t('holidays.removed', { name: row.name, date: formatDateOnly(row.date) }),
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('holidays.error.remove'));
    }
  }

  const needle = search.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (scope === 'company' && !row.companyDeclared) return false;
    if (scope === 'public' && row.companyDeclared) return false;
    if (stateFilter.length > 0 && (row.stateCode ?? '') !== stateFilter) return false;
    return needle.length === 0 || row.name.toLowerCase().includes(needle);
  });

  const company = rows.filter((row) => row.companyDeclared).length;

  return (
    <PanelCard title={<T k="holidays.title" />} subtitle={<T k="holidays.subtitle" />}>
      <PanelSection
        title={<T k="holidays.count" vars={{ count: rows.length, year }} />}
        subtitle={<T k="holidays.section.subtitle" />}
        action={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setYear((value) => value - 1)}
                aria-label={t('holidays.year.previous')}
                className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <span className="px-1 text-sm font-medium tabular-nums text-slate-700">{year}</span>
              <button
                type="button"
                onClick={() => setYear((value) => value + 1)}
                aria-label={t('holidays.year.next')}
                className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
            <Button onClick={() => setAdding(true)}>
              <CalendarPlus className="size-4" aria-hidden />
              <T k="holidays.add" />
            </Button>
          </div>
        }
      />

      <ChipBar
        active={scope}
        onChange={setScope}
        chips={[
          {
            id: 'public',
            label: <T k="holidays.chip.public" />,
            count: rows.length - company,
            dot: 'bg-sky-500',
          },
          {
            id: 'company',
            label: <T k="holidays.chip.company" />,
            count: company,
            dot: 'bg-violet-500',
          },
        ]}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('holidays.search')}
        dirty={search.length > 0 || scope !== undefined || stateFilter.length > 0}
        onReset={() => {
          setSearch('');
          setScope(undefined);
          setStateFilter('');
        }}
      >
        <FacetSelect
          label={t('holidays.filter.allScopes')}
          value={stateFilter}
          onChange={setStateFilter}
          options={STATES.filter((state) => state.label !== null).map((state) => ({
            value: state.code,
            label: state.label!,
          }))}
        />
      </FilterRow>

      <PanelBody className="space-y-3 pb-0">
        <Feedback error={error} notice={notice} />
        <PanelNote icon={<RefreshCw className="size-3.5" aria-hidden />}>
          <T k="holidays.recomputeNote" />
        </PanelNote>
      </PanelBody>

      <div className="mt-3">
        <RecordTable
          loading={loading}
          rowCount={filtered.length}
          empty={<T k="holidays.empty" vars={{ year }} />}
          columns={[
            { header: <T k="holidays.column.date" />, width: 'w-32' },
            { header: <T k="holidays.column.day" />, width: 'w-28' },
            { header: <T k="holidays.column.name" /> },
            { header: <T k="holidays.column.scope" />, width: 'w-44' },
            { header: <T k="holidays.column.kind" />, width: 'w-32' },
            { header: <T k="panel.column.actions" />, width: 'w-24', align: 'right' },
          ]}
        >
          {filtered.map((row) => {
            // A holiday is a calendar date, so its weekday has to be read in UTC —
            // the zone the value is stored in. Reading it locally moves the day.
            const weekday = new Date(row.date).getUTCDay();
            const weekend = weekday === 0 || weekday === 6;
            return (
              <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/70">
                <td className="px-5 py-2.5 font-mono text-xs tabular-nums text-slate-600">
                  {formatDateOnly(row.date)}
                </td>
                <td className="px-2 py-2.5 text-xs text-slate-600">
                  <T k={WEEKDAYS[weekday]!} />
                  {/* A holiday that lands on a rest day changes nothing for most staff,
                      but still matters for anyone rostered that day. */}
                  {weekend && (
                    <span className="ml-1 text-[10px] text-slate-400">
                      <T k="holidays.weekend" />
                    </span>
                  )}
                </td>
                <td className="px-2 py-2.5 font-medium text-slate-800">{row.name}</td>
                <td className="px-2 py-2.5 text-xs text-slate-600">
                  {stateLabel(row.stateCode, t('holidays.scope.nationwide'))}
                </td>
                <td className="px-2 py-2.5">
                  <span
                    className={cn(
                      'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
                      row.companyDeclared
                        ? 'bg-violet-50 text-violet-700'
                        : 'bg-sky-50 text-sky-700',
                    )}
                  >
                    <span className="uppercase">
                      <T
                        k={
                          row.companyDeclared ? 'holidays.kind.company' : 'holidays.kind.public'
                        }
                      />
                    </span>
                  </span>
                </td>
                <td className="px-2 py-2.5 pr-4">
                  <RowActions>
                    <RowAction
                      icon={<Trash2 className="size-4" aria-hidden />}
                      label={t('holidays.row.remove')}
                      tone="danger"
                      onClick={() => setConfirming(row)}
                    />
                  </RowActions>
                </td>
              </tr>
            );
          })}
        </RecordTable>
      </div>

      <PanelFooter
        shown={filtered.length}
        total={rows.length}
        page={1}
        pageSize={Math.max(1, rows.length)}
        pageSizes={[Math.max(1, rows.length)]}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => void load()}
      />

      {adding && (
        <AddHolidayDialog
          year={year}
          onClose={() => setAdding(false)}
          onSaved={async (message) => {
            setAdding(false);
            setNotice(message);
            await load();
          }}
        />
      )}

      {confirming !== null && (
        <Dialog
          title={<T k="holidays.remove.title" vars={{ name: confirming.name }} />}
          titleText={t('holidays.remove.title', { name: confirming.name })}
          onClose={() => setConfirming(null)}
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <T
                k="holidays.remove.body"
                vars={{ date: formatDateOnly(confirming.date) }}
              />
            </p>
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="holidays.remove.warning" />
            </PanelNote>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                <T k="dialog.cancel" />
              </Button>
              <Button
                onClick={() => void remove(confirming)}
                className="bg-rose-600 hover:bg-rose-500"
              >
                <T k="app.remove" />
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </PanelCard>
  );
}

function AddHolidayDialog({
  year,
  onClose,
  onSaved,
}: {
  year: number;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState('');
  const [date, setDate] = useState(`${String(year)}-01-01`);
  const [stateCode, setStateCode] = useState('');
  const [companyDeclared, setCompanyDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/holidays', {
        name: name.trim(),
        date,
        stateCode,
        companyDeclared,
      });
      await onSaved(
        t('holidays.added', { name: name.trim(), date: formatDateOnly(date) }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('holidays.error.add'));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={<T k="holidays.dialog.title" />}
      titleText={t('holidays.dialog.title')}
      description={<T k="holidays.dialog.description" />}
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <Field
          label={<T k="holidays.column.name" />}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('holidays.dialog.name.placeholder')}
          autoFocus
        />

        <FormGrid>
          <Field
            label={<T k="holidays.column.date" />}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <div>
            <label htmlFor="holiday-state" className="block text-sm font-medium text-slate-700">
              <T k="holidays.column.scope" />
            </label>
            <select
              id="holiday-state"
              value={stateCode}
              onChange={(event) => setStateCode(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {STATES.map((state) => (
                <option key={state.code} value={state.code}>
                  {state.label ?? t('holidays.scope.nationwide')}
                </option>
              ))}
            </select>
          </div>
        </FormGrid>

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={companyDeclared}
            onChange={(event) => setCompanyDeclared(event.target.checked)}
            className="mt-0.5"
          />
          <span>
            <T k="holidays.dialog.company" />
            <span className="mt-0.5 block text-xs text-slate-500">
              <T k="holidays.dialog.company.hint" />
            </span>
          </span>
        </label>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={name.trim().length === 0 || date === ''}
          submitLabel={<T k="holidays.dialog.submit" />}
        />
      </div>
    </Dialog>
  );
}
