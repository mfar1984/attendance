import { CalendarDays, ChevronLeft, ChevronRight, Eraser, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Feedback } from '../components/Dialog';
import {
  FacetSelect,
  FilterRow,
  PanelBody,
  PanelCard,
  PanelFooter,
  PanelNote,
  PanelSection,
} from '../components/RecordPanel';
import { Button } from '../components/ui';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { attendanceApi, lookupsApi, type Lookups } from '../lib/operations-api';
import type { RosterEntry, RosterStaffRow } from '../lib/reports-api';
import { T, useLabels } from '../lib/translation';

interface ShiftOption {
  id: number;
  code: string;
  name: string;
  colour: string | null;
}

/** A cell the operator has selected, keyed so lookups stay cheap. */
type CellKey = `${number}:${string}`;

/**
 * Monthly roster grid.
 *
 * Assignment is a two-step selection: pick cells, then apply a shift. A per-cell
 * dropdown would mean one request per day per person, and filling a month for a
 * ward of forty means well over a thousand interactions.
 */
export function RosterPage(): ReactNode {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const [rows, setRows] = useState<RosterStaffRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [shifts, setShifts] = useState<ShiftOption[]>([]);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [departmentId, setDepartmentId] = useState('');
  const [selected, setSelected] = useState<Set<CellKey>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { t } = useLabels();

  const pageSize = 25;

  const days = useMemo(() => {
    const count = new Date(month.year, month.month + 1, 0).getDate();
    return Array.from({ length: count }, (_, index) => index + 1);
  }, [month]);

  const range = useMemo(() => {
    const pad = (value: number) => String(value).padStart(2, '0');
    return {
      from: `${month.year}-${pad(month.month + 1)}-01`,
      to: `${month.year}-${pad(month.month + 1)}-${pad(days.length)}`,
    };
  }, [month, days.length]);

  useEffect(() => {
    void lookupsApi.load().then(setLookups).catch(() => undefined);
    void api.get<ShiftOption[]>('/api/shifts').then(setShifts).catch(() => undefined);
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

      const result = await api.get<{ total: number; rows: RosterStaffRow[] }>(
        `/api/roster?${params.toString()}`,
      );
      setRows(result.rows);
      setTotal(result.total);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('roster.error.load'));
    } finally {
      setLoading(false);
    }
  }, [range, page, departmentId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const shiftById = useMemo(
    () => new Map(shifts.map((shift) => [shift.id, shift])),
    [shifts],
  );

  function entryFor(row: RosterStaffRow, day: number): RosterEntry | undefined {
    const pad = String(day).padStart(2, '0');
    const prefix = `${month.year}-${String(month.month + 1).padStart(2, '0')}-${pad}`;
    return row.rosters.find((entry) => entry.workDate.startsWith(prefix));
  }

  function toggle(staffId: number, day: number): void {
    const pad = String(day).padStart(2, '0');
    const key: CellKey = `${staffId}:${month.year}-${String(month.month + 1).padStart(2, '0')}-${pad}`;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectRow(staffId: number): void {
    setSelected((current) => {
      const next = new Set(current);
      for (const day of days) {
        const pad = String(day).padStart(2, '0');
        next.add(`${staffId}:${month.year}-${String(month.month + 1).padStart(2, '0')}-${pad}`);
      }
      return next;
    });
  }

  async function apply(shiftId: number | null, entryType: 'work' | 'rest' | 'leave'): Promise<void> {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);

    // Grouped by staff so one request covers a whole row rather than one per cell.
    const byStaff = new Map<number, string[]>();
    for (const key of selected) {
      const [staffPart, datePart] = key.split(':');
      const staffId = Number(staffPart);
      const list = byStaff.get(staffId) ?? [];
      list.push(datePart!);
      byStaff.set(staffId, list);
    }

    try {
      for (const [staffId, dates] of byStaff) {
        await api.post('/api/roster', { staffIds: [staffId], dates, shiftId, entryType });
      }
      setNotice(t('roster.saved', { count: selected.size }));
      setSelected(new Set());
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('roster.error.save'));
    } finally {
      setBusy(false);
    }
  }

  async function clearSelection(): Promise<void> {
    if (selected.size === 0) return;
    setBusy(true);
    const byStaff = new Map<number, string[]>();
    for (const key of selected) {
      const [staffPart, datePart] = key.split(':');
      const staffId = Number(staffPart);
      const list = byStaff.get(staffId) ?? [];
      list.push(datePart!);
      byStaff.set(staffId, list);
    }

    try {
      for (const [staffId, dates] of byStaff) {
        await api.deleteWithBody('/api/roster', { staffIds: [staffId], dates });
      }
      setNotice(t('roster.cleared', { count: selected.size }));
      setSelected(new Set());
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('roster.error.clear'));
    } finally {
      setBusy(false);
    }
  }

  async function recompute(): Promise<void> {
    setBusy(true);
    try {
      const result = await attendanceApi.recompute(range.from, range.to);
      setNotice(t('roster.recomputed', { count: result.recordsWritten }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('roster.error.recompute'));
    } finally {
      setBusy(false);
    }
  }

  const monthName = new Date(month.year, month.month, 1).toLocaleDateString('ms-MY', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <PanelCard title={<T k="roster.title" />} subtitle={<T k="roster.subtitle" />}>
      <PanelSection
        // The month name comes from `Intl`, so it is already in the reader's language and
        // is not a label.
        title={monthName}
        subtitle={
          <T k="roster.count" vars={{ count: new Intl.NumberFormat('ms-MY').format(total) }} />
        }
        action={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  setMonth(({ year, month: current }) =>
                    current === 0 ? { year: year - 1, month: 11 } : { year, month: current - 1 },
                  )
                }
                aria-label={t('roster.month.previous')}
                className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() =>
                  setMonth(({ year, month: current }) =>
                    current === 11 ? { year: year + 1, month: 0 } : { year, month: current + 1 },
                  )
                }
                aria-label={t('roster.month.next')}
                className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
            <Button variant="ghost" onClick={() => void recompute()} disabled={busy}>
              <CalendarDays className="size-4" aria-hidden />
              <T k="roster.recompute" />
            </Button>
          </div>
        }
      />

      <FilterRow
        dirty={departmentId.length > 0}
        onReset={() => {
          setDepartmentId('');
          setPage(1);
        }}
      >
        <FacetSelect
          label={t('staff.filter.allDepartments')}
          value={departmentId}
          onChange={(value) => {
            setDepartmentId(value);
            setPage(1);
          }}
          options={(lookups?.departments ?? []).map((row) => ({
            value: String(row.id),
            label: row.name,
          }))}
        />
      </FilterRow>

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      {/*
        The action bar appears only with a selection, so the primary surface stays the
        grid itself rather than a permanent toolbar.
      */}
      {selected.size > 0 && (
        <div className="border-brand-500 bg-brand-100 sticky top-0 z-10 flex flex-wrap items-center gap-2 border-y px-5 py-2.5">
          <span className="text-sm font-medium text-slate-700">
            <T k="roster.selected" vars={{ count: selected.size }} />
          </span>
          {shifts.map((shift) => (
            <button
              key={shift.id}
              type="button"
              disabled={busy}
              onClick={() => void apply(shift.id, 'work')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {shift.colour !== null && (
                <span className="size-2.5 rounded-full" style={{ backgroundColor: shift.colour }} aria-hidden />
              )}
              {shift.code}
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply(null, 'rest')}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <T k="roster.apply.rest" />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply(null, 'leave')}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <T k="roster.apply.leave" />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void clearSelection()}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Eraser className="size-3.5" aria-hidden />
            <T k="roster.apply.clear" />
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-slate-600 hover:underline"
          >
            <T k="roster.selection.drop" />
          </button>
        </div>
      )}

      <div className="mt-3">
        {loading && rows.length === 0 ? (
          <div className="flex min-h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('app.loading')} />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-500">
            <T k="roster.empty" />
          </p>
        ) : (
          <div className="overflow-x-auto px-5">
            <table className="text-xs">
              <caption className="sr-only">{t('roster.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 bg-white py-2 pr-3 text-left font-medium text-slate-500">
                    <T k="roster.column.staff" />
                  </th>
                  {days.map((day) => {
                    const date = new Date(month.year, month.month, day);
                    const weekend = date.getDay() === 0 || date.getDay() === 6;
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
                          {date.toLocaleDateString('ms-MY', { weekday: 'long' })}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <th scope="row" className="sticky left-0 bg-white py-1.5 pr-3 text-left font-normal">
                      <button
                        type="button"
                        onClick={() => selectRow(row.id)}
                        className="max-w-44 truncate text-left hover:underline"
                        title={t('roster.selectMonth', { name: row.fullName })}
                      >
                        <span className="font-medium text-slate-700">{row.fullName}</span>
                        <span className="ml-1.5 font-mono text-[10px] text-slate-500">
                          {row.employeeNo}
                        </span>
                      </button>
                    </th>

                    {days.map((day) => {
                      const entry = entryFor(row, day);
                      const pad = String(day).padStart(2, '0');
                      const key: CellKey = `${row.id}:${month.year}-${String(month.month + 1).padStart(2, '0')}-${pad}`;
                      const isSelected = selected.has(key);
                      const shift = entry?.shiftId === null || entry?.shiftId === undefined
                        ? null
                        : (shiftById.get(entry.shiftId) ?? null);

                      return (
                        <td key={day} className="p-0.5">
                          <button
                            type="button"
                            onClick={() => toggle(row.id, day)}
                            aria-pressed={isSelected}
                            aria-label={t('roster.cell.aria', {
                              name: row.fullName,
                              day,
                              month: monthName,
                              /*
                                The state used to fall through to `entry.entryType` for rest
                                and leave, which read out the raw enum. Each case now names
                                itself.
                              */
                              state:
                                entry === undefined
                                  ? t('roster.cell.unscheduled')
                                  : entry.entryType === 'rest'
                                    ? t('roster.apply.rest')
                                    : entry.entryType === 'leave'
                                      ? t('roster.apply.leave')
                                      : (shift?.code ?? t('roster.cell.work')),
                            })}
                            className={cn(
                              'flex size-7 items-center justify-center rounded text-[10px] font-semibold',
                              isSelected && 'ring-2 ring-brand-600 ring-offset-1',
                              entry === undefined && 'bg-slate-100 text-slate-400',
                              entry?.entryType === 'rest' && 'bg-slate-200 text-slate-600',
                              entry?.entryType === 'leave' && 'bg-amber-100 text-amber-800',
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
                                ? 'R'
                                : entry.entryType === 'leave'
                                  ? 'C'
                                  : (shift?.code.slice(0, 2) ?? 'K')}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </div>

      <PanelBody className="pt-4 pb-0">
        <PanelNote>
          <T k="roster.note" />
        </PanelNote>
      </PanelBody>

      <PanelFooter
        shown={rows.length}
        total={total}
        page={page}
        pageSize={pageSize}
        pageSizes={[pageSize]}
        loading={loading}
        onPage={setPage}
        onPageSize={() => undefined}
        onRefresh={() => void load()}
      />
    </PanelCard>
  );
}
