import { STATES, stateLabel, type LabelKey } from '@attendance/shared';
import { Building2, CalendarPlus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { SelectControl } from '../components/ChannelForm';
import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  ChipBar,
  FacetSelect,
  FilterRow,
  PanelBody,
  PanelCard,
  PanelFooter,
  PanelSection,
  RecordTable,
  RowAction,
  RowActions,
} from '../components/RecordPanel';
import { RemoveDialog } from '../components/RemoveDialog';
import { Badge, Button, CheckCard, Field, SelectField } from '../components/ui';
import { useAuth } from '../lib/auth';
import { formatDateOnly } from '../lib/operations-api';
import { holidayApi, type HolidayListPayload, type HolidayRow } from '../lib/settings-api';
import { T, useLabels } from '../lib/translation';

const SCREEN = 'schedule.holidays';

/**
 * Registry keys indexed by `getUTCDay`, because a holiday is a calendar date and not an instant.
 * Keys rather than words so the day names go through the registry like anything else.
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

type Kind = 'company' | 'public';

/** What kind of day a line is, with the same words and tones as the holiday list under Integrasi. */
function kindOf(row: HolidayRow): { key: LabelKey; tone: 'warning' | 'success' | 'info' } {
  if (row.companyDeclared) return { key: 'integration.holiday.type.company', tone: 'warning' };
  if (row.allOffices) return { key: 'integration.holiday.type.national', tone: 'success' };
  return { key: 'integration.holiday.type.state', tone: 'info' };
}

/** Weekday of a calendar date, read in UTC — the zone the value is stored in. */
function weekdayOf(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** Five years back for history, two forward for planning. */
function yearOptions(): number[] {
  const now = new Date().getFullYear();
  const out: number[] = [];
  for (let year = now - 5; year <= now + 2; year += 1) out.push(year);
  return out;
}

/**
 * Public and company holidays.
 *
 * Held here rather than under Integrasi because most organisations add days no public source will
 * ever return: a company shutdown, a local celebration. If the calendar lived behind an
 * integration, adding one by hand would be the awkward path.
 *
 * Reads the same grouped list the Integrasi tab does. It used to read the endpoint as if it still
 * returned one row per state with a `stateCode` — a field the grouped reply does not have — so the
 * coverage column was blank and choosing a state in the filter emptied the table.
 */
export function HolidaysPage(): ReactNode {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [showAll, setShowAll] = useState(false);
  const [data, setData] = useState<HolidayListPayload | null>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<Kind | undefined>(undefined);
  const [stateFilter, setStateFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<HolidayRow | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();
  const mayRemove = can(SCREEN, 'delete');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await holidayApi.list(year, showAll ? 'all' : 'offices'));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('holidays.error.load'));
    } finally {
      setLoading(false);
    }
  }, [year, showAll, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];
  const needle = search.trim().toLowerCase();

  const matchesState = (row: HolidayRow): boolean =>
    stateFilter.length === 0 || row.allOffices || row.states.includes(stateFilter);
  const matchesSearch = (row: HolidayRow): boolean =>
    needle.length === 0 || row.name.toLowerCase().includes(needle);
  const kindOfRow = (row: HolidayRow): Kind => (row.companyDeclared ? 'company' : 'public');

  // Chip counts respect every filter but their own, so choosing one does not zero the other.
  const beforeKind = rows.filter((row) => matchesState(row) && matchesSearch(row));
  const counts: Record<Kind, number> = { public: 0, company: 0 };
  for (const row of beforeKind) counts[kindOfRow(row)] += 1;
  const filtered = kind === undefined ? beforeKind : beforeKind.filter((row) => kindOfRow(row) === kind);

  // Only the states some line actually names: a filter that can only empty the table is no filter.
  const presentStates = STATES.filter((state) => rows.some((row) => row.states.includes(state.code)));

  const done = async (message: string): Promise<void> => {
    setAdding(false);
    setRemoving(null);
    setError(null);
    setNotice(message);
    await load();
  };

  return (
    <PanelCard title={<T k="holidays.title" />} subtitle={<T k="holidays.subtitle" />}>
      <PanelSection
        title={<T k="holidays.count" vars={{ count: rows.length, year }} />}
        subtitle={
          (data?.hidden ?? 0) > 0 ? (
            <T k="integration.holiday.list.hidden" vars={{ count: data?.hidden ?? 0 }} />
          ) : (
            <T k="holidays.section.subtitle" />
          )
        }
        action={
          can(SCREEN, 'create') ? (
            <Button onClick={() => setAdding(true)}>
              <CalendarPlus className="size-4" aria-hidden />
              <T k="holidays.add" />
            </Button>
          ) : undefined
        }
      />

      <ChipBar
        active={kind}
        onChange={(id) => setKind(id as Kind | undefined)}
        chips={[
          {
            id: 'public',
            label: <T k="holidays.chip.public" />,
            count: counts.public,
            dot: 'bg-sky-500',
          },
          {
            id: 'company',
            label: <T k="holidays.chip.company" />,
            count: counts.company,
            dot: 'bg-amber-500',
          },
        ]}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('holidays.search')}
        dirty={
          search.length > 0 ||
          kind !== undefined ||
          stateFilter.length > 0 ||
          showAll ||
          year !== thisYear
        }
        onReset={() => {
          setSearch('');
          setKind(undefined);
          setStateFilter('');
          setShowAll(false);
          setYear(thisYear);
        }}
      >
        {presentStates.length > 0 && (
          <FacetSelect
            label={t('holidays.filter.allScopes')}
            value={stateFilter}
            onChange={setStateFilter}
            options={presentStates.map((state) => ({ value: state.code, label: state.label }))}
          />
        )}
        {/* Both always hold a value, so they are not facets: a blank option would break the list. */}
        <SelectControl
          label={t('integration.holiday.list.scope')}
          value={showAll ? 'all' : 'offices'}
          onChange={(event) => {
            setShowAll(event.target.value === 'all');
            setStateFilter('');
          }}
        >
          <option value="offices">{t('integration.holiday.list.scope.offices')}</option>
          <option value="all">{t('integration.holiday.list.scope.all')}</option>
        </SelectControl>
        <SelectControl
          label={t('integration.holiday.list.year')}
          value={String(year)}
          onChange={(event) => {
            setYear(Number(event.target.value));
            setStateFilter('');
          }}
        >
          {yearOptions().map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </SelectControl>
      </FilterRow>

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={filtered.length}
        empty={<T k="holidays.empty" vars={{ year }} />}
        columns={[
          { header: <T k="holidays.column.date" />, width: 'w-32' },
          { header: <T k="holidays.column.day" />, width: 'w-36' },
          { header: <T k="holidays.column.name" /> },
          { header: <T k="holidays.column.scope" />, width: 'w-56' },
          { header: <T k="holidays.column.kind" />, width: 'w-32' },
          { header: <T k="panel.column.actions" />, width: 'w-20', align: 'right' },
        ]}
      >
        {filtered.map((row) => {
          const weekday = weekdayOf(row.date);
          const weekend = weekday === 0 || weekday === 6;
          const type = kindOf(row);
          return (
            <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/70">
              {/* `formatDateOnly`, not `formatDate`: these are calendar dates with no zone. */}
              <td className="px-5 py-2.5 font-mono text-xs text-slate-600 tabular-nums">
                {formatDateOnly(row.date)}
              </td>
              <td className="px-2 py-2.5 text-xs text-slate-600">
                <T k={WEEKDAYS[weekday]!} />
                {/* A holiday on a rest day changes nothing for most staff, but still matters for
                    anyone rostered that day. */}
                {weekend && (
                  <span className="ml-1 text-[10px] text-slate-400">
                    <T k="holidays.weekend" />
                  </span>
                )}
              </td>
              <td className="px-2 py-2.5 font-medium text-slate-800">{row.name}</td>
              <td className="px-2 py-2.5 text-xs text-slate-600">
                {row.allOffices ? (
                  <T k="integration.holiday.allStates" />
                ) : (
                  row.states.map((code) => stateLabel(code)).join(', ')
                )}
              </td>
              <td className="px-2 py-2.5">
                <Badge tone={type.tone} className="uppercase">
                  <T k={type.key} />
                </Badge>
              </td>
              <td className="px-2 py-2.5 pr-4">
                <RowActions>
                  {mayRemove && (
                    <RowAction
                      icon={<Trash2 className="size-4" aria-hidden />}
                      label={t('holidays.row.remove')}
                      tone="danger"
                      onClick={() => setRemoving(row)}
                    />
                  )}
                </RowActions>
              </td>
            </tr>
          );
        })}
      </RecordTable>

      <PanelFooter
        shown={filtered.length}
        total={rows.length}
        page={1}
        pageSize={Math.max(1, rows.length)}
        pageSizes={[Math.max(1, rows.length)]}
        generatedAt={data?.generatedAt ?? null}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => void load()}
      />

      {adding && (
        <AddHolidayDialog year={year} onClose={() => setAdding(false)} onSaved={done} />
      )}

      {removing !== null && (
        <RemoveDialog
          title={<T k="holidays.remove.title" vars={{ name: removing.name }} />}
          titleText={t('holidays.remove.title', { name: removing.name })}
          description={
            <>
              <T k="holidays.remove.body" vars={{ date: formatDateOnly(removing.date) }} />
              {/* A gazetted day comes back on the next sync, which is worth knowing before removing it. */}
              {!removing.companyDeclared && (
                <>
                  {' '}
                  <T k="holidays.remove.gazetted" />
                </>
              )}
            </>
          }
          onConfirm={async () => {
            const result = await holidayApi.remove(removing.ids);
            await done(
              [
                t('holidays.removed', { name: removing.name }),
                result.recomputeNeeded
                  ? t('holidays.recompute', { date: formatDateOnly(removing.date) })
                  : '',
              ]
                .filter((part) => part.length > 0)
                .join(' '),
            );
          }}
          onClose={() => setRemoving(null)}
        />
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
      const result = await holidayApi.add({ name: name.trim(), date, stateCode, companyDeclared });
      await onSaved(
        [
          t('holidays.added', { name: name.trim(), date: formatDateOnly(date) }),
          result.recomputeNeeded ? t('holidays.recompute', { date: formatDateOnly(date) }) : '',
        ]
          .filter((part) => part.length > 0)
          .join(' '),
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
      width="lg"
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

        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field
            label={<T k="holidays.column.date" />}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          {/* "Every office" is a real choice, so the empty option is written out rather than a facet's. */}
          <SelectField
            label={<T k="holidays.column.scope" />}
            value={stateCode}
            onChange={(event) => setStateCode(event.target.value)}
          >
            <option value="">{t('integration.holiday.allStates')}</option>
            {STATES.map((state) => (
              <option key={state.code} value={state.code}>
                {state.label}
              </option>
            ))}
          </SelectField>
        </div>

        {/* The last block before the footer, so it carries the `pb-2`. The hint says what leaving it
            unticked does, because that is the case that loses the day. */}
        <div className="pb-2">
          <CheckCard
            checked={companyDeclared}
            onChange={setCompanyDeclared}
            icon={<Building2 className="size-4" aria-hidden />}
            title={<T k="holidays.dialog.company" />}
            hint={
              companyDeclared ? (
                <T k="holidays.dialog.company.hint" />
              ) : (
                <T k="holidays.dialog.company.hint.off" vars={{ year: date.slice(0, 4) }} />
              )
            }
          />
        </div>

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

