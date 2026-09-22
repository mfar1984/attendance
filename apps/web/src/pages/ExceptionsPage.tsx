import { CircleAlert, CircleCheck } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  ChipBar,
  DateBox,
  Detail,
  DetailGrid,
  ExpandButton,
  FacetSelect,
  FilterRow,
  PanelBody,
  PanelCard,
  PanelFooter,
  PanelNote,
  PanelSection,
  RecordTable,
  RowAction,
  RowActions,
} from '../components/RecordPanel';
import { cn } from '../lib/cn';
import {
  EXCEPTION_LABELS,
  daysAgoIso,
  exceptionsApi,
  formatDateOnly,
  formatDateTime,
  todayIso,
  type ExceptionRow,
} from '../lib/operations-api';
import { T, TEnum, useLabels } from '../lib/translation';

/**
 * The queue of things the engine could not resolve on its own.
 *
 * This is the screen an HR clerk opens every morning. It is a first-class page rather
 * than a filter on the attendance table, because a hidden filter is exactly how these
 * get missed until payroll day.
 */
export function ExceptionsPage(): ReactNode {
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [openByKind, setOpenByKind] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [kind, setKind] = useState<string | undefined>(undefined);
  const [resolved, setResolved] = useState<'open' | 'resolved' | 'all'>('open');
  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [active, setActive] = useState<ExceptionRow | null>(null);
  const { t } = useLabels();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await exceptionsApi.list({
        page,
        pageSize,
        ...(kind !== undefined ? { kind } : {}),
        ...(resolved === 'all' ? {} : { resolved: resolved === 'resolved' }),
        from,
        to,
      });
      setRows(result.rows);
      setTotal(result.total);
      setOpenByKind(result.openByKind);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('exceptions.error.load'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, kind, resolved, from, to, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const outstanding = Object.values(openByKind).reduce((running, value) => running + value, 0);

  return (
    <PanelCard title={<T k="exceptions.title" />} subtitle={<T k="exceptions.subtitle" />}>
      <PanelSection
        title={
          outstanding === 0 ? (
            <T k="exceptions.none" />
          ) : (
            <T k="exceptions.outstanding" vars={{ count: outstanding }} />
          )
        }
        subtitle={<T k="exceptions.section.subtitle" />}
      />

      {/*
        Counts are of open items regardless of the resolved filter, so the queue size
        stays visible while browsing what has already been closed.
      */}
      <ChipBar
        active={kind}
        onChange={(id) => {
          setKind(id);
          setPage(1);
        }}
        chips={Object.entries(openByKind)
          .sort((left, right) => right[1] - left[1])
          .map(([key, count]) => ({
            id: key,
            label: <TEnum k={EXCEPTION_LABELS[key]} fallback={key} />,
            count,
            dot: KIND_DOT[key] ?? 'bg-slate-400',
          }))}
      />

      <FilterRow
        dirty={kind !== undefined || resolved !== 'open'}
        onReset={() => {
          setKind(undefined);
          setResolved('open');
          setPage(1);
        }}
      >
        {/* `FacetSelect` and `DateBox` labels land in `<option>` and `aria-label`, which are
            strings by definition, so these go through `t()` rather than `<T>`. */}
        <FacetSelect
          label={t('exceptions.filter.allStatuses')}
          value={resolved === 'all' ? '' : resolved}
          onChange={(value) => {
            setResolved(value === '' ? 'all' : (value as 'open' | 'resolved'));
            setPage(1);
          }}
          options={[
            { value: 'open', label: t('exceptions.filter.open') },
            { value: 'resolved', label: t('exceptions.filter.resolved') },
          ]}
        />
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
        loading={loading}
        rowCount={rows.length}
        empty={<T k="exceptions.empty" />}
        columns={[
          { header: <T k="exceptions.column.kind" />, width: 'w-52' },
          { header: <T k="exceptions.column.staff" /> },
          { header: <T k="exceptions.column.terminal" />, width: 'w-32' },
          { header: <T k="exceptions.column.occurred" />, width: 'w-44' },
          { header: <T k="exceptions.column.detail" /> },
          { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <ExceptionRowView
            key={row.id}
            row={row}
            expanded={open === row.id}
            onToggle={() => setOpen(open === row.id ? null : row.id)}
            onResolve={() => setActive(row)}
          />
        ))}
      </RecordTable>

      <PanelFooter
        shown={rows.length}
        total={total}
        page={page}
        pageSize={pageSize}
        loading={loading}
        onPage={setPage}
        onPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onRefresh={() => void load()}
      />

      {active !== null && (
        <ResolveDialog
          target={active}
          onClose={() => setActive(null)}
          onDone={async (message) => {
            setActive(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </PanelCard>
  );
}

const KIND_DOT: Record<string, string> = {
  missing_check_out: 'bg-amber-500',
  missing_check_in: 'bg-amber-500',
  duplicate_scan: 'bg-slate-400',
  unrecognised_face: 'bg-orange-500',
  unknown_employee: 'bg-rose-500',
  outside_roster: 'bg-violet-500',
  clock_drift: 'bg-rose-500',
  outside_geofence: 'bg-orange-500',
};

function ExceptionRowView({
  row,
  expanded,
  onToggle,
  onResolve,
}: {
  row: ExceptionRow;
  expanded: boolean;
  onToggle: () => void;
  onResolve: () => void;
}): ReactNode {
  const { t } = useLabels();
  const outstanding = row.resolvedAt === null;

  return (
    <>
      <tr
        className={cn(
          'border-b border-slate-100',
          expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
          outstanding && !expanded && 'bg-amber-50/40',
        )}
      >
        <td className="px-5 py-2">
          <span className="inline-flex items-center gap-1.5">
            {outstanding ? (
              <CircleAlert className="size-4 shrink-0 text-amber-500" aria-hidden />
            ) : (
              <CircleCheck className="size-4 shrink-0 text-emerald-600" aria-hidden />
            )}
            <span className="text-xs font-medium text-slate-700">
              <TEnum k={EXCEPTION_LABELS[row.kind]} fallback={row.kind} />
            </span>
          </span>
        </td>
        <td className="px-2 py-2">
          {row.staff === null ? (
            <span className="text-xs text-slate-400 italic">
              <T k="exceptions.row.unmapped" />
            </span>
          ) : (
            <>
              <span className="block text-slate-800">{row.staff.fullName}</span>
              <span className="block font-mono text-[11px] text-slate-400">
                {row.staff.employeeNo}
              </span>
            </>
          )}
        </td>
        <td className="px-2 py-2 text-xs text-slate-600">{row.deviceName ?? '—'}</td>
        <td className="px-2 py-2 text-xs whitespace-nowrap tabular-nums text-slate-600">
          {formatDateTime(row.occurredAt)}
        </td>
        <td className="px-2 py-2 text-xs text-slate-500">
          <span className="line-clamp-1">{row.detail ?? '—'}</span>
        </td>
        <td className="px-2 py-2 pr-4">
          <RowActions>
            {outstanding ? (
              <RowAction
                icon={<CircleCheck className="size-4" aria-hidden />}
                label={t('exceptions.row.resolve')}
                tone="success"
                onClick={onResolve}
              />
            ) : (
              <span className="pr-1 text-[10px] font-semibold tracking-wide text-emerald-700">
                <T k="exceptions.row.done" />
              </span>
            )}
            <ExpandButton
              expanded={expanded}
              onClick={onToggle}
              label={t('exceptions.row.expand')}
            />
          </RowActions>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={6} className="px-5 py-3">
            <DetailGrid>
              <Detail
                label={<T k="exceptions.detail.kind" />}
                value={<TEnum k={EXCEPTION_LABELS[row.kind]} fallback={row.kind} />}
              />
              <Detail label={<T k="exceptions.detail.internalCode" />} value={row.kind} mono />
              <Detail
                label={<T k="exceptions.detail.workDate" />}
                value={formatDateOnly(row.workDate)}
              />
              <Detail
                label={<T k="exceptions.detail.occurred" />}
                value={formatDateTime(row.occurredAt)}
              />
              <Detail
                label={<T k="exceptions.detail.terminal" />}
                value={row.deviceName ?? '—'}
              />
              <Detail
                label={<T k="exceptions.detail.rawEvent" />}
                value={
                  row.rawEventId === null ? (
                    <T k="exceptions.detail.rawEvent.none" />
                  ) : (
                    `#${row.rawEventId}`
                  )
                }
                mono
              />
            </DetailGrid>

            {row.detail !== null && (
              <div className="mt-3 border-t border-slate-200 pt-2">
                <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                  <T k="exceptions.detail.heading" />
                </p>
                <p className="mt-1 text-sm break-words text-slate-700">{row.detail}</p>
              </div>
            )}

            {row.resolvedAt !== null && (
              <PanelNote tone="success" className="mt-3">
                <T
                  k="exceptions.detail.resolvedAt"
                  vars={{
                    when: formatDateTime(row.resolvedAt),
                    note: row.resolutionNote ?? t('exceptions.detail.noReason'),
                  }}
                />
              </PanelNote>
            )}

            {row.kind === 'unknown_employee' && outstanding && (
              <PanelNote tone="warn" className="mt-3">
                <T k="exceptions.detail.unmappedWarning" />
              </PanelNote>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Closes an exception with a written reason.
 *
 * The note is mandatory. An exception closed without one leaves no trace of why, and
 * these rows are what settle a dispute over somebody's pay months later.
 */
function ResolveDialog({
  target,
  onClose,
  onDone,
}: {
  target: ExceptionRow;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t, tEnum } = useLabels();

  const kindText = tEnum(EXCEPTION_LABELS[target.kind], target.kind);

  const presets = [
    t('exceptions.resolve.preset.forgotOut'),
    t('exceptions.resolve.preset.fieldWork'),
    t('exceptions.resolve.preset.notStaff'),
    t('exceptions.resolve.preset.fixedManually'),
  ];

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await exceptionsApi.resolve(target.id, note.trim());
      await onDone(t('exceptions.resolve.done', { kind: kindText }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('exceptions.resolve.error'));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={<TEnum k={EXCEPTION_LABELS[target.kind]} fallback={target.kind} />}
      titleText={kindText}
      description={`${target.staff?.fullName ?? target.deviceName ?? '—'} · ${formatDateTime(target.occurredAt)}`}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-3">
        <Feedback error={error} />

        {target.detail !== null && <PanelNote>{target.detail}</PanelNote>}

        <div>
          <label htmlFor="resolve-note" className="block text-sm font-medium text-slate-700">
            <T k="exceptions.resolve.note" />
          </label>
          <textarea
            id="resolve-note"
            autoFocus
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t('exceptions.resolve.placeholder')}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setNote(preset)}
                className="rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={note.trim().length < 3}
          submitLabel={<T k="exceptions.resolve.submit" />}
        />
      </div>
    </Dialog>
  );
}
