import { Eraser, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Feedback } from '../components/Dialog';
import {
  DateBox,
  FacetSelect,
  FilterRow,
  PanelBody,
  PanelCard,
  PanelFooter,
  PanelSection,
  TableFrame,
} from '../components/RecordPanel';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { lookupsApi, todayIso, type Lookups } from '../lib/operations-api';
import type { RosterEntry, RosterStaffRow } from '../lib/reports-api';
import { intlLocale, T, useLabels } from '../lib/translation';

const SCREEN = 'schedule.roster';

/** The marker an approved leave request writes on its days — see `LEAVE_NOTE_PREFIX` on the server. */
const LEAVE_NOTE_PREFIX = 'Cuti #';

interface ShiftOption {
  id: number;
  code: string;
  name: string;
  colour: string | null;
  active: boolean;
}

/** A cell the operator has selected, keyed so lookups stay cheap. */
type CellKey = `${number}:${string}`;

/** A day written by an approved leave request. The calendar shows it and leaves it alone. */
function fromLeaveRequest(entry: RosterEntry | undefined): boolean {
  return entry?.entryType === 'leave' && (entry.notes ?? '').startsWith(LEAVE_NOTE_PREFIX);
}

/** Groups selected cells by person, so one request covers a whole row rather than one per cell. */
function byStaff(selected: Set<CellKey>): Map<number, string[]> {
  const groups = new Map<number, string[]>();
  for (const key of selected) {
    const [staffPart, datePart] = key.split(':');
    const staffId = Number(staffPart);
    const list = groups.get(staffId) ?? [];
    list.push(datePart!);
    groups.set(staffId, list);
  }
  return groups;
}

/**
 * Monthly roster grid.
 *
 * Assignment is a two-step selection: pick cells, then apply a shift. A per-cell dropdown would
 * mean one request per day per person, and filling a month for a ward of forty means well over a
 * thousand interactions.
 */
export function RosterPage(): ReactNode {
  const thisMonth = todayIso().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [rows, setRows] = useState<RosterStaffRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [shifts, setShifts] = useState<ShiftOption[]>([]);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [departmentId, setDepartmentId] = useState('');
  const [selected, setSelected] = useState<Set<CellKey>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { t, locale } = useLabels();
  const { can } = useAuth();
  const mayAssign = can(SCREEN, 'edit');
  const mayClear = can(SCREEN, 'delete');
  const maySelect = mayAssign || mayClear;

  const pageSize = 25;

  // Calendar arithmetic in UTC: these are dates, not instants, and the grid must not shift a day
  // for somebody whose browser sits in another zone.
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const days = useMemo(() => {
    const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return Array.from({ length: count }, (_, index) => index + 1);
  }, [year, monthNumber]);

  const dateKey = useCallback(
    (day: number): string => `${month}-${String(day).padStart(2, '0')}`,
    [month],
  );

  const range = useMemo(
    () => ({ from: dateKey(1), to: dateKey(days.length) }),
    [dateKey, days.length],
  );

  useEffect(() => {
    void lookupsApi
      .load()
      .then(setLookups)
      .catch(() => undefined);
    // The calendar's own list: `/api/shifts` belongs to the shift screen's grant.
    void api
      .get<ShiftOption[]>('/api/roster/shifts')
      .then(setShifts)
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: range.from,
        to: range.to,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (departmentId) params.set('departmentId', departmentId);
      if (search.trim()) params.set('search', search.trim());

      const result = await api.get<{ total: number; rows: RosterStaffRow[] }>(
        `/api/roster?${params.toString()}`,
      );
      setRows(result.rows);
      setTotal(result.total);
      setLoadedAt(new Date().toISOString());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('roster.error.load'));
    } finally {
      setLoading(false);
    }
  }, [range, page, departmentId, search, t]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const shiftById = useMemo(() => new Map(shifts.map((shift) => [shift.id, shift])), [shifts]);
  // Inactive shifts still paint the days that carry them; only active ones are handed out.
  const assignable = shifts.filter((shift) => shift.active);

  function entryFor(row: RosterStaffRow, day: number): RosterEntry | undefined {
    const prefix = dateKey(day);
    return row.rosters.find((entry) => entry.workDate.startsWith(prefix));
  }

  /*
   * A selection belongs to the month and the people on screen. Keys carry full dates, so a
   * selection left behind when the month changed was applied to cells nobody could see.
   */
  function resetSelection(): void {
    setSelected(new Set());
  }

  function toggle(staffId: number, day: number): void {
    const key: CellKey = `${staffId}:${dateKey(day)}`;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectRow(row: RosterStaffRow): void {
    setSelected((current) => {
      const next = new Set(current);
      for (const day of days) {
        if (fromLeaveRequest(entryFor(row, day))) continue;
        next.add(`${row.id}:${dateKey(day)}`);
      }
      return next;
    });
  }

  /** The sentence for what a write did, plus the leave days it was not allowed to touch. */
  function summary(done: string, kept: number): string {
    return [done, kept > 0 ? t('roster.kept', { count: kept }) : '']
      .filter((part) => part.length > 0)
      .join(' ');
  }

  async function apply(shiftId: number | null, entryType: 'work' | 'rest'): Promise<void> {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    let written = 0;
    let kept = 0;
    try {
      for (const [staffId, dates] of byStaff(selected)) {
        const result = await api.post<{ written: number; kept: number }>('/api/roster', {
          staffIds: [staffId],
          dates,
          shiftId,
          entryType,
        });
        written += result.written;
        kept += result.kept;
      }
      setNotice(summary(t('roster.saved', { count: written }), kept));
      resetSelection();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('roster.error.save'));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function clearSelection(): Promise<void> {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    let removed = 0;
    let kept = 0;
    try {
      for (const [staffId, dates] of byStaff(selected)) {
        const result = await api.deleteWithBody<{ removed: number; kept: number }>('/api/roster', {
          staffIds: [staffId],
          dates,
        });
        removed += result.removed;
        kept += result.kept;
      }
      setNotice(summary(t('roster.cleared', { count: removed }), kept));
      resetSelection();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('roster.error.clear'));
      await load();
    } finally {
      setBusy(false);
    }
  }

  const intl = intlLocale(locale);
  // From `Intl`, so already in the reader's language — not a label.
  const monthName = new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString(intl, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const restLetter = t('roster.cell.rest.short');
  const leaveLetter = t('roster.cell.leave.short');
  const workLetter = t('roster.cell.work.short');

  return (
    <PanelCard title={<T k="roster.title" />} subtitle={<T k="roster.subtitle" />}>
      <PanelSection
        title={
          <T k="roster.count" vars={{ count: new Intl.NumberFormat(intl).format(total) }} />
        }
        subtitle={monthName}
      />

      <FilterRow
        search={search}
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
          resetSelection();
        }}
        placeholder={t('roster.search')}
        dirty={search.length > 0 || departmentId.length > 0 || month !== thisMonth}
        onReset={() => {
          setSearch('');
          setDepartmentId('');
          setMonth(thisMonth);
          setPage(1);
          resetSelection();
        }}
      >
        <FacetSelect
          label={t('staff.filter.allDepartments')}
          value={departmentId}
          onChange={(value) => {
            setDepartmentId(value);
            setPage(1);
            resetSelection();
          }}
          options={(lookups?.departments ?? []).map((row) => ({
            value: String(row.id),
            label: row.name,
          }))}
        />
        <DateBox
          type="month"
          label={t('roster.month')}
          value={month}
          onChange={(value) => {
            // A cleared month box would leave the grid with no month at all.
            if (/^\d{4}-\d{2}$/.test(value)) {
              setMonth(value);
              setPage(1);
              resetSelection();
            }
          }}
        />
      </FilterRow>

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      {/*
        The action bar appears only with a selection, so the primary surface stays the grid itself
        rather than a permanent toolbar.
      */}
      {selected.size > 0 && (
        <div className="border-brand-500 bg-brand-100 sticky top-0 z-10 mt-3 flex flex-wrap items-center gap-2 border-y px-5 py-2.5">
          <span className="text-sm font-medium text-slate-700">
            <T k="roster.selected" vars={{ count: selected.size }} />
          </span>
          {mayAssign &&
            assignable.map((shift) => (
              <button
                key={shift.id}
                type="button"
                disabled={busy}
                onClick={() => void apply(shift.id, 'work')}
                title={shift.name}
                aria-label={t('roster.apply.shift', { code: shift.code, name: shift.name })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {shift.colour !== null && (
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: shift.colour }}
                    aria-hidden
                  />
                )}
                {shift.code}
              </button>
            ))}
          {mayAssign && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void apply(null, 'rest')}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <T k="roster.apply.rest" />
            </button>
          )}
          {mayClear && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void clearSelection()}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
            >
              <Eraser className="size-3.5" aria-hidden />
              <T k="roster.apply.clear" />
            </button>
          )}
          {busy && (
            <Loader2 className="size-4 animate-spin text-slate-500" aria-label={t('app.loading')} />
          )}
          <button
            type="button"
            onClick={resetSelection}
            className="ml-auto text-xs text-slate-600 hover:underline"
          >
            <T k="roster.selection.drop" />
          </button>
        </div>
      )}

      <TableFrame>
        {loading && rows.length === 0 ? (
          <div className="flex min-h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('app.loading')} />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-500">
            <T k="roster.empty" />
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs">
              <caption className="sr-only">{t('roster.caption')}</caption>
              <thead className="bg-slate-50/70">
                <tr className="border-b border-slate-200">
                  <th
                    scope="col"
                    className="sticky left-0 bg-slate-50 px-5 py-2 text-left text-[11px] font-medium tracking-wide text-slate-500 uppercase"
                  >
                    <T k="roster.column.staff" />
                  </th>
                  {days.map((day) => {
                    const date = new Date(Date.UTC(year, monthNumber - 1, day));
                    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
                    return (
                      <th
                        key={day}
                        scope="col"
                        className={cn(
                          'w-8 py-2 text-center font-medium',
                          weekend ? 'text-rose-500' : 'text-slate-500',
                        )}
                      >
                        {day}
                        <span className="sr-only">
                          {date.toLocaleDateString(intl, { weekday: 'long', timeZone: 'UTC' })}
                        </span>
                      </th>
                    );
                  })}
                  <th scope="col" className="w-3" aria-hidden />
                </tr>
              </thead>
              <tbody className="[&>tr:last-child]:border-0">
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100">
                    <th
                      scope="row"
                      className="sticky left-0 bg-white py-1.5 pr-3 pl-5 text-left font-normal"
                    >
                      {maySelect ? (
                        <button
                          type="button"
                          onClick={() => selectRow(row)}
                          className="max-w-48 truncate text-left hover:underline"
                          title={t('roster.selectMonth', { name: row.fullName })}
                        >
                          <span className="font-medium text-slate-700">{row.fullName}</span>
                          <span className="ml-1.5 font-mono text-[10px] text-slate-500">
                            {row.employeeNo}
                          </span>
                        </button>
                      ) : (
                        <span className="block max-w-48 truncate">
                          <span className="font-medium text-slate-700">{row.fullName}</span>
                          <span className="ml-1.5 font-mono text-[10px] text-slate-500">
                            {row.employeeNo}
                          </span>
                        </span>
                      )}
                    </th>

                    {days.map((day) => {
                      const entry = entryFor(row, day);
                      const key: CellKey = `${row.id}:${dateKey(day)}`;
                      const isSelected = selected.has(key);
                      const held = fromLeaveRequest(entry);
                      const shift =
                        entry?.shiftId === null || entry?.shiftId === undefined
                          ? null
                          : (shiftById.get(entry.shiftId) ?? null);

                      const state =
                        entry === undefined
                          ? t('roster.cell.unscheduled')
                          : entry.entryType === 'rest'
                            ? t('roster.cell.rest')
                            : entry.entryType === 'leave'
                              ? t('roster.cell.leave')
                              : shift !== null
                                ? `${shift.code} · ${shift.name}`
                                : t('roster.cell.work');

                      return (
                        <td key={day} className="p-0.5">
                          <button
                            type="button"
                            onClick={() => toggle(row.id, day)}
                            // Not selectable when nothing here could act on it, or when the day
                            // belongs to an approved leave request.
                            disabled={!maySelect || held}
                            aria-pressed={isSelected}
                            title={
                              held
                                ? t('roster.cell.held', {
                                    ref: (entry?.notes ?? '').replace(LEAVE_NOTE_PREFIX, '#'),
                                  })
                                : state
                            }
                            aria-label={t('roster.cell.aria', {
                              name: row.fullName,
                              day,
                              month: monthName,
                              state,
                            })}
                            className={cn(
                              'flex size-7 items-center justify-center rounded text-[10px] font-semibold disabled:cursor-default',
                              isSelected && 'ring-brand-600 ring-2 ring-offset-1',
                              entry === undefined && 'bg-slate-100 text-slate-400',
                              entry?.entryType === 'rest' && 'bg-slate-200 text-slate-600',
                              entry?.entryType === 'leave' && 'bg-amber-100 text-amber-800',
                              entry?.entryType === 'work' &&
                                !shift?.colour &&
                                'bg-slate-300 text-slate-700',
                            )}
                            style={
                              entry?.entryType === 'work' && shift?.colour
                                ? { backgroundColor: shift.colour, color: '#fff' }
                                : undefined
                            }
                          >
                            {entry === undefined
                              ? '·'
                              : entry.entryType === 'rest'
                                ? restLetter
                                : entry.entryType === 'leave'
                                  ? leaveLetter
                                  : (shift?.code.slice(0, 2) ?? workLetter)}
                          </button>
                        </td>
                      );
                    })}
                    <td aria-hidden />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableFrame>

      {/* The key to the letters in the cells. The shift codes are their own key. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="grid size-5 place-items-center rounded bg-slate-200 text-[10px] font-semibold text-slate-600">
            {restLetter}
          </span>
          <T k="roster.entry.rest" />
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="grid size-5 place-items-center rounded bg-amber-100 text-[10px] font-semibold text-amber-800">
            {leaveLetter}
          </span>
          <T k="roster.entry.leave" />
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="grid size-5 place-items-center rounded bg-slate-100 text-[10px] font-semibold text-slate-400">
            ·
          </span>
          <T k="roster.legend.unscheduled" />
        </span>
      </div>

      <PanelFooter
        shown={rows.length}
        total={total}
        page={page}
        pageSize={pageSize}
        pageSizes={[pageSize]}
        generatedAt={loadedAt}
        loading={loading}
        onPage={(next) => {
          setPage(next);
          resetSelection();
        }}
        onPageSize={() => undefined}
        onRefresh={() => void load()}
      />
    </PanelCard>
  );
}
