import type { LabelKey } from '@attendance/shared';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Feedback } from '../components/Dialog';
import {
  ChipBar,
  DateBox,
  Detail,
  DetailGrid,
  ExpandButton,
  FilterRow,
  PanelBody,
  PanelCard,
  PanelFooter,
  PanelNote,
  PanelSection,
  RecordTable,
} from '../components/RecordPanel';
import { Badge, Button } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import {
  STATUS_LABELS,
  attendanceApi,
  daysAgoIso,
  formatDateOnly,
  formatDateTime,
  formatMinutes,
  formatTime,
  todayIso,
  type AttendanceRecordRow,
} from '../lib/operations-api';
import { T, TEnum, useLabels } from '../lib/translation';

/**
 * Attendance as the engine computed it.
 *
 * Every row here is derived and replaceable, which is why the recalculate action lives
 * on this page: after a clock correction or a shift rule change these are rebuilt from
 * the immutable raw log rather than edited by hand.
 */
export function AttendanceRecordsPage(): ReactNode {
  const { t } = useLabels();
  const { can } = useAuth();
  // The default window, kept so Reset can return to it and `dirty` can tell when it has moved.
  const [defaults] = useState(() => ({ from: daysAgoIso(7), to: todayIso() }));
  const [rows, setRows] = useState<AttendanceRecordRow[]>([]);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await attendanceApi.records({
        page,
        pageSize,
        from,
        to,
        ...(status !== undefined ? { status } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      });
      setRows(result.rows);
      setTotal(result.total);
      setByStatus(result.byStatus);
      setGeneratedAt(new Date().toISOString());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('records.error.load'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, from, to, status, search, t]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  async function recompute(): Promise<void> {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await attendanceApi.recompute(from, to);
      setNotice(
        t('records.recompute.done', {
          records: result.recordsWritten,
          staff: result.staffProcessed,
          exceptions: result.exceptionsRaised,
        }),
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('records.error.recompute'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PanelCard title={<T k="records.title" />} subtitle={<T k="records.subtitle" />}>
      <PanelSection
        title={
          <T k="records.count" vars={{ count: new Intl.NumberFormat('ms-MY').format(total) }} />
        }
        subtitle={
          <T k="records.range" vars={{ from: formatDateOnly(from), to: formatDateOnly(to) }} />
        }
        action={
          /*
            Hidden without the permission rather than shown and refused. The route is gated on
            `settings.maintenance:recompute`, so a clerk who may read records pressed it and got a
            403 — which reads as recomputing being broken, not as a permission they lack.
          */
          can('settings.maintenance', 'recompute') ? (
            <Button onClick={() => void recompute()} disabled={busy || from === '' || to === ''}>
              <RefreshCw className={cn('size-4', busy && 'animate-spin')} aria-hidden />
              <T k="records.recompute" />
            </Button>
          ) : undefined
        }
      />

      {/*
        Every status, in the same place each time. Chips at zero used to be dropped, so the bar
        changed length as the range moved and a status vanished exactly when somebody looked for
        it. A zero chip is information; the bar disables it rather than hiding it.
      */}
      <ChipBar
        active={status}
        onChange={(id) => {
          setStatus(id);
          setPage(1);
        }}
        chips={STATUS_ORDER.map((key) => ({
          id: key,
          label: <TEnum k={STATUS_LABELS[key]} fallback={key} />,
          count: byStatus[key] ?? 0,
          dot: STATUS_DOT[key] ?? 'bg-slate-400',
        }))}
      />

      <FilterRow
        search={search}
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        placeholder={t('records.search')}
        dirty={
          search.length > 0 || status !== undefined || from !== defaults.from || to !== defaults.to
        }
        onReset={() => {
          setSearch('');
          setStatus(undefined);
          setFrom(defaults.from);
          setTo(defaults.to);
          setPage(1);
        }}
      >
        <DateBox
          label={t('filter.from')}
          value={from}
          onChange={(value) => {
            setFrom(value);
            setPage(1);
          }}
        />
        <DateBox
          label={t('filter.to')}
          value={to}
          onChange={(value) => {
            setTo(value);
            setPage(1);
          }}
        />
      </FilterRow>

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={rows.length}
        empty={<T k="records.empty" />}
        columns={[
          { header: <T k="records.column.date" />, width: 'w-28' },
          { header: <T k="records.column.staff" /> },
          { header: <T k="records.column.shift" />, width: 'w-20' },
          { header: <T k="records.column.scheduled" />, width: 'w-32' },
          { header: <T k="records.column.in" />, width: 'w-24' },
          { header: <T k="records.column.out" />, width: 'w-24' },
          { header: <T k="records.column.late" />, width: 'w-20' },
          { header: <T k="records.column.worked" />, width: 'w-24' },
          { header: <T k="records.column.status" />, width: 'w-32' },
          // The expander column has no heading: the control names itself.
          { header: '', width: 'w-12' },
        ]}
      >
        {rows.map((row) => (
          <RecordRow
            key={row.id}
            row={row}
            expanded={open === row.id}
            onToggle={() => setOpen(open === row.id ? null : row.id)}
          />
        ))}
      </RecordTable>

      <PanelFooter
        shown={rows.length}
        total={total}
        page={page}
        pageSize={pageSize}
        generatedAt={generatedAt}
        loading={loading}
        onPage={setPage}
        onPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onRefresh={() => void load()}
      />
    </PanelCard>
  );
}

/** Chip order, worst first: the rows an operator came here to act on. */
const STATUS_ORDER = [
  'absent',
  'incomplete',
  'late',
  'early_leave',
  'on_time',
  'on_leave',
  'rest_day',
  'holiday',
];

const STATUS_DOT: Record<string, string> = {
  on_time: 'bg-emerald-500',
  late: 'bg-amber-500',
  early_leave: 'bg-amber-500',
  incomplete: 'bg-orange-500',
  absent: 'bg-rose-500',
  on_leave: 'bg-sky-500',
  rest_day: 'bg-slate-400',
  holiday: 'bg-fuchsia-500',
};

/**
 * Verdict tones for the faults, register tones for the rest.
 *
 * Leave and public holidays are categories, not problems, so they take `info` and `accent`
 * rather than a colour that reads as a judgement.
 */
const STATUS_TONES: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'neutral'> = {
  on_time: 'success',
  late: 'warning',
  early_leave: 'warning',
  incomplete: 'warning',
  absent: 'danger',
  on_leave: 'info',
  rest_day: 'neutral',
  holiday: 'accent',
};

/** `auto` is the engine's; the other two say a person changed it, which is the point of the field. */
const ORIGIN_LABELS: Record<string, LabelKey> = {
  auto: 'records.origin.auto',
  manual: 'records.origin.manual',
  adjusted: 'records.origin.adjusted',
};

function RecordRow({
  row,
  expanded,
  onToggle,
}: {
  row: AttendanceRecordRow;
  expanded: boolean;
  onToggle: () => void;
}): ReactNode {
  const { t } = useLabels();
  const problem = row.status === 'absent' || row.status === 'incomplete';

  return (
    <>
      <tr
        className={cn(
          'border-b border-slate-100',
          expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
          problem && !expanded && 'bg-rose-50/40',
        )}
      >
        <td className="px-5 py-2.5 text-xs whitespace-nowrap tabular-nums text-slate-600">
          {formatDateOnly(row.workDate)}
        </td>
        <td className="px-2 py-2.5">
          <span className="block font-medium text-slate-800">{row.staff.fullName}</span>
          <span className="block font-mono text-[11px] text-slate-400">{row.staff.employeeNo}</span>
        </td>
        <td className="px-2 py-2.5 text-xs text-slate-600">
          {row.shift?.code ?? (
            <span className="text-slate-400">
              <T k="records.row.defaultShift" />
            </span>
          )}
        </td>
        <td className="px-2 py-2.5 font-mono text-xs tabular-nums text-slate-500">
          {row.scheduledStart === null
            ? '—'
            : `${formatTime(row.scheduledStart)}–${formatTime(row.scheduledEnd)}`}
        </td>
        <td className="px-2 py-2.5 font-mono text-xs tabular-nums text-slate-700">
          {formatTime(row.checkInAt)}
        </td>
        <td className="px-2 py-2.5 font-mono text-xs tabular-nums text-slate-700">
          {formatTime(row.checkOutAt)}
        </td>
        <td className="px-2 py-2.5 font-mono text-xs tabular-nums">
          {row.lateMinutes > 0 ? (
            <span className="text-amber-700">{formatMinutes(row.lateMinutes)}</span>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </td>
        <td className="px-2 py-2.5 font-mono text-xs tabular-nums text-slate-700">
          {formatMinutes(row.workedMinutes)}
          {row.overtimeMinutes > 0 && (
            <span className="ml-1 text-emerald-700">+{formatMinutes(row.overtimeMinutes)}</span>
          )}
        </td>
        <td className="px-2 py-2.5">
          {/* Uppercased by the badge's class: a translated word cannot be upper-cased safely. */}
          <Badge tone={STATUS_TONES[row.status] ?? 'neutral'} className="uppercase">
            <TEnum k={STATUS_LABELS[row.status]} fallback={row.status} />
          </Badge>
          {/* A day with more than one worked interval cannot be read from the single
              in/out pair, so it is flagged in the row and detailed in the expansion. */}
          {row.blocks.length > 1 && (
            <span className="mt-0.5 block text-[10px] text-slate-500">
              <T k="records.row.blocks" vars={{ count: row.blocks.length }} />
            </span>
          )}
        </td>
        <td className="px-2 py-2.5 pr-4">
          <ExpandButton expanded={expanded} onClick={onToggle} label={t('records.row.expand')} />
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={10} className="px-5 py-3">
            <DetailGrid>
              <Detail
                label={<T k="records.detail.shift" />}
                value={
                  row.shift ? (
                    `${row.shift.code} · ${row.shift.name}`
                  ) : (
                    <T k="records.detail.defaultPattern" />
                  )
                }
              />
              <Detail
                label={<T k="records.detail.earlyLeave" />}
                value={formatMinutes(row.earlyLeaveMinutes)}
              />
              <Detail
                label={<T k="records.detail.overtime" />}
                value={formatMinutes(row.overtimeMinutes)}
              />
              <Detail
                label={<T k="records.detail.origin" />}
                value={<TEnum k={ORIGIN_LABELS[row.origin]} fallback={row.origin} />}
              />
              <Detail
                label={<T k="records.detail.calculatedAt" />}
                value={formatDateTime(row.calculatedAt)}
              />
              <Detail label={<T k="records.detail.recordId" />} value={String(row.id)} mono />
            </DetailGrid>

            {/*
              Split shifts, and hospital night shifts that cross midnight. A single
              check-in and check-out pair cannot represent those, and leaving them out
              would understate hours worked.
            */}
            {row.blocks.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left tracking-wide text-slate-500 uppercase">
                      <th scope="col" className="px-3 py-1.5 font-medium">
                        <T k="records.block.column.block" />
                      </th>
                      <th scope="col" className="px-3 py-1.5 font-medium">
                        <T k="records.block.column.scheduled" />
                      </th>
                      <th scope="col" className="px-3 py-1.5 font-medium">
                        <T k="records.block.column.in" />
                      </th>
                      <th scope="col" className="px-3 py-1.5 font-medium">
                        <T k="records.block.column.out" />
                      </th>
                      <th scope="col" className="px-3 py-1.5 font-medium">
                        <T k="records.block.column.late" />
                      </th>
                      <th scope="col" className="px-3 py-1.5 font-medium">
                        <T k="records.block.column.worked" />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.blocks.map((block) => (
                      <tr key={block.id} className="border-b border-slate-100 last:border-0">
                        <th scope="row" className="px-3 py-1.5 text-left font-medium text-slate-600">
                          B{block.blockOrder}
                        </th>
                        <td className="px-3 py-1.5 font-mono tabular-nums text-slate-500">
                          {block.scheduledStart === null
                            ? '—'
                            : `${formatTime(block.scheduledStart)}–${formatTime(block.scheduledEnd)}`}
                        </td>
                        <td className="px-3 py-1.5 font-mono tabular-nums text-slate-700">
                          {formatTime(block.checkInAt)}
                        </td>
                        <td className="px-3 py-1.5 font-mono tabular-nums text-slate-700">
                          {formatTime(block.checkOutAt)}
                        </td>
                        <td className="px-3 py-1.5 font-mono tabular-nums text-amber-700">
                          {formatMinutes(block.lateMinutes)}
                        </td>
                        <td className="px-3 py-1.5 font-mono tabular-nums text-slate-700">
                          {formatMinutes(block.workedMinutes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {row.status === 'incomplete' && (
              <PanelNote
                tone="warn"
                className="mt-3"
                icon={<TriangleAlert className="size-3.5" aria-hidden />}
              >
                <T k="records.incomplete.note" />
              </PanelNote>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
