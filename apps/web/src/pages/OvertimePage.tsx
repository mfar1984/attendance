import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Percent,
  Plus,
  TriangleAlert,
  X,
} from 'lucide-react';
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
import { Badge, Button, Field } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import type { ApprovalTrailEntry } from '../lib/hr-api';
import { daysAgoIso, formatDateOnly, formatDateTime, todayIso } from '../lib/operations-api';
import {
  OVERTIME_DAY_TYPE_LABELS,
  OVERTIME_STATUS_LABELS,
  formatHours,
  formatRinggit,
  overtimeApi,
  type OvertimeDayType,
  type OvertimeQuote,
  type OvertimeRate,
  type OvertimeRequestRow,
  type OvertimeStatus,
} from '../lib/overtime-api';
import { T, TEnum, useLabels } from '../lib/translation';

const STATUS_DOT: Record<OvertimeStatus, string> = {
  pending: 'bg-amber-500',
  approved: 'bg-emerald-600',
  rejected: 'bg-rose-500',
  cancelled: 'bg-slate-400',
};

const DAY_TYPES: OvertimeDayType[] = ['weekday', 'restDay', 'holiday', 'holidayRestDay'];

/** The statutory floor per day type, mirrored for the form hint. */
const FLOOR: Record<OvertimeDayType, number> = {
  weekday: 1.5,
  restDay: 2,
  holiday: 3,
  holidayRestDay: 3,
};

/**
 * Overtime claims, and the rates they are paid at.
 *
 * One entry in the rail, two tabs, following `Konfigurasi Umum` and `Integrasi`: the
 * queue somebody works from, and the rules it is decided by. Deciding a claim and
 * changing the multiplier it is paid at are different jobs, so the second tab is gated
 * on its own action.
 */
export function OvertimePage(): ReactNode {
  /*
    One view, so no tab bar. The rates and the three configuration panels moved to
    `/hr/permohonan/lebih-masa/tetapan`, a sibling entry in the sidebar.

    The settings screen is still reachable by anybody who can view this module — the write
    controls inside it are gated on `configure` separately. Hiding the whole screen would leave an
    approver unable to see who signs after them, which is a question they legitimately have while
    deciding.
  */
  return (
    <PanelCard title={<T k="overtime.title" />} subtitle={<T k="overtime.subtitle" />}>
      <RequestsTab />
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

function RequestsTab(): ReactNode {
  const [rows, setRows] = useState<OvertimeRequestRow[]>([]);
  const [counts, setCounts] = useState<Partial<Record<OvertimeStatus, number>>>({});
  const [total, setTotal] = useState(0);
  const [chainLength, setChainLength] = useState(0);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [status, setStatus] = useState<OvertimeStatus | undefined>(undefined);
  const [from, setFrom] = useState(daysAgoIso(60));
  const [to, setTo] = useState(todayIso());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [deciding, setDeciding] = useState<{ row: OvertimeRequestRow; approve: boolean } | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const { t } = useLabels();
  const { can } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await overtimeApi.list({
        page,
        pageSize,
        ...(status === undefined ? {} : { status }),
        from,
        to,
      });
      setRows(result.rows);
      setCounts(result.counts);
      setTotal(result.total);
      setChainLength(result.chainLength);
      setGeneratedAt(result.generatedAt);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('overtime.error.load'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, from, to, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = status !== undefined || from !== daysAgoIso(60) || to !== todayIso();

  return (
    <>
      <PanelSection
        title={<T k="overtime.tab.requests" />}
        subtitle={<T k="overtime.hours.measuredNote" vars={{ hours: '—' }} />}
        action={
          can('hr.overtime', 'create') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              <T k="overtime.action.new" />
            </Button>
          ) : undefined
        }
      />

      <ChipBar
        active={status}
        onChange={(id) => {
          setStatus(id as OvertimeStatus | undefined);
          setPage(1);
        }}
        chips={(['pending', 'approved', 'rejected', 'cancelled'] as OvertimeStatus[]).map(
          (key) => ({
            id: key,
            label: <T k={OVERTIME_STATUS_LABELS[key]} />,
            count: counts[key] ?? 0,
            dot: STATUS_DOT[key],
          }),
        )}
      />

      <FilterRow
        dirty={dirty}
        onReset={() => {
          setStatus(undefined);
          setFrom(daysAgoIso(60));
          setTo(todayIso());
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

      <PanelBody className="space-y-2 pb-0">
        <Feedback error={error} notice={notice} />
        <PanelNote icon={<CircleAlert className="size-3.5" aria-hidden />}>
          <T k="overtime.note.notPaid" />
        </PanelNote>
        <PanelNote>
          <T k="overtime.note.cap" />
        </PanelNote>
      </PanelBody>

      <RecordTable
        loading={loading}
        rowCount={rows.length}
        empty={<T k="overtime.empty" />}
        columns={[
          { header: <T k="overtime.column.requestNo" />, width: 'w-36' },
          { header: <T k="overtime.column.staff" /> },
          { header: <T k="overtime.column.workDate" />, width: 'w-28' },
          { header: <T k="overtime.column.dayType" />, width: 'w-40' },
          { header: <T k="overtime.column.hours" />, width: 'w-28', align: 'right' },
          { header: <T k="overtime.column.amount" />, width: 'w-28', align: 'right' },
          { header: <T k="panel.column.status" />, width: 'w-24' },
          { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <RequestRowView
            key={row.id}
            row={row}
            chainLength={chainLength}
            expanded={open === row.id}
            onToggle={() => setOpen(open === row.id ? null : row.id)}
            onApprove={() => setDeciding({ row, approve: true })}
            onReject={() => setDeciding({ row, approve: false })}
            onCancel={async () => {
              await overtimeApi.cancel(row.id);
              setNotice(`${row.requestNo} ditarik.`);
              await load();
            }}
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

      {creating && (
        <NewRequestDialog
          onClose={() => setCreating(false)}
          onDone={async (message) => {
            setCreating(false);
            setNotice(message);
            await load();
          }}
        />
      )}

      {deciding !== null && (
        <DecideDialog
          target={deciding.row}
          approve={deciding.approve}
          onClose={() => setDeciding(null)}
          onDone={async (message) => {
            setDeciding(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </>
  );
}

function RequestRowView({
  row,
  chainLength,
  expanded,
  onToggle,
  onApprove,
  onReject,
  onCancel,
}: {
  row: OvertimeRequestRow;
  chainLength: number;
  expanded: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
}): ReactNode {
  const [trail, setTrail] = useState<ApprovalTrailEntry[] | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();
  const waiting = row.status === 'pending';
  // Claimed less than measured is a judgement somebody made, and worth seeing at a glance.
  const partial = row.requestedMinutes < row.measuredMinutes;

  /*
   * Loaded on expand rather than with the list.
   *
   * A page of thirty rows would otherwise carry thirty histories nobody asked for, and the
   * trail is only readable once a row is open anyway.
   */
  useEffect(() => {
    if (!expanded || trail !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const detail = await overtimeApi.detail(row.id);
        if (!cancelled) setTrail(detail.trail);
      } catch {
        // A missing history is not worth failing the row over; the detail grid still renders.
        if (!cancelled) setTrail([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, trail, row.id]);

  return (
    <>
      <tr
        className={cn(
          'border-b border-slate-100',
          expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
          waiting && !expanded && 'bg-amber-50/40',
        )}
      >
        <td className="px-5 py-2 font-mono text-xs text-slate-700">{row.requestNo}</td>
        <td className="px-2 py-2">
          <span className="block text-slate-800">{row.staffName ?? '—'}</span>
          <span className="block font-mono text-[11px] text-slate-400">
            {row.employeeNo ?? '—'}
          </span>
        </td>
        <td className="px-2 py-2 text-xs whitespace-nowrap tabular-nums text-slate-600">
          {formatDateOnly(row.workDate)}
        </td>
        <td className="px-2 py-2 text-xs text-slate-600">
          <TEnum k={OVERTIME_DAY_TYPE_LABELS[row.dayType]} fallback={row.dayType} />
        </td>
        <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-700">
          {partial ? (
            <T
              k="overtime.hours.claimed"
              vars={{
                claimed: formatHours(row.requestedMinutes),
                measured: formatHours(row.measuredMinutes),
              }}
            />
          ) : (
            formatHours(row.requestedMinutes)
          )}
        </td>
        <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-700">
          {row.status === 'approved' ? formatRinggit(row.amount) : '—'}
        </td>
        <td className="px-2 py-2">
          <Badge
            tone={
              row.status === 'approved'
                ? 'success'
                : row.status === 'pending'
                  ? 'warning'
                  : row.status === 'rejected'
                    ? 'danger'
                    : 'neutral'
            }
          >
            <span className="uppercase">
              <T k={OVERTIME_STATUS_LABELS[row.status]} />
            </span>
          </Badge>
          {/*
            Chain progress, only where a chain exists. A request signed twice out of three
            times looks identical to an untouched one without this, and an approver cannot
            tell whether it is waiting for them.
          */}
          {chainLength > 1 && waiting && row.currentLevel > 0 && (
            <span className="mt-0.5 block text-[10px] text-slate-500">
              <T
                k="hr.approval.progress"
                vars={{ level: row.currentLevel, total: chainLength }}
              />
            </span>
          )}
        </td>
        <td className="px-2 py-2 pr-4">
          <RowActions>
            {waiting && can('hr.overtime', 'approve') && (
              <>
                <RowAction
                  icon={<CircleCheck className="size-4" aria-hidden />}
                  label={t('overtime.decide.approve')}
                  tone="success"
                  onClick={onApprove}
                />
                <RowAction
                  icon={<CircleX className="size-4" aria-hidden />}
                  label={t('overtime.decide.reject')}
                  tone="danger"
                  onClick={onReject}
                />
              </>
            )}
            {waiting && can('hr.overtime', 'edit') && (
              <RowAction
                icon={<X className="size-4" aria-hidden />}
                label={t('overtime.action.cancel')}
                tone="danger"
                onClick={onCancel}
              />
            )}
            <ExpandButton expanded={expanded} onClick={onToggle} label={t('overtime.action.view')} />
          </RowActions>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={8} className="px-5 py-3">
            <DetailGrid>
              <Detail
                label={<T k="overtime.quote.measured" />}
                value={`${formatHours(row.measuredMinutes)} jam`}
              />
              <Detail
                label={<T k="overtime.new.minutes" />}
                value={`${formatHours(row.requestedMinutes)} jam`}
              />
              <Detail
                label={<T k="overtime.quote.hourlyRate" />}
                value={formatRinggit(row.hourlyRate)}
              />
              <Detail
                label={<T k="overtime.quote.multiplier" />}
                value={row.multiplier === null ? '—' : `${row.multiplier}×`}
              />
              <Detail label={<T k="overtime.column.rate" />} value={row.rateName ?? '—'} />
              <Detail label={<T k="overtime.new.task" />} value={row.task} />
              <Detail label={<T k="overtime.new.reason" />} value={row.reason} />
              <Detail
                label={<T k="overtime.decide.note" />}
                value={row.decisionNote ?? '—'}
              />
            </DetailGrid>

            <div className="mt-3 border-t border-slate-200 pt-3">
              <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                <T k="hr.approval.trail.title" />
              </p>
              {trail === null ? (
                <p className="mt-1 text-xs text-slate-400">
                  <T k="app.loading" />
                </p>
              ) : trail.length === 0 ? (
                <p className="mt-1 text-xs text-slate-400">
                  <T k="hr.approval.trail.empty" />
                </p>
              ) : (
                <ol className="mt-1.5 space-y-1">
                  {trail.map((entry) => (
                    <li key={entry.id} className="flex flex-wrap items-baseline gap-2 text-xs">
                      <span className="font-medium text-slate-600">
                        <T k="hr.approval.trail.level" vars={{ level: entry.level }} />
                      </span>
                      <span
                        className={cn(
                          'font-medium',
                          entry.action === 'approved' ? 'text-emerald-700' : 'text-rose-700',
                        )}
                      >
                        <T
                          k={
                            entry.action === 'approved'
                              ? 'hr.approval.trail.approved'
                              : 'hr.approval.trail.rejected'
                          }
                        />
                      </span>
                      <span className="text-slate-600">{entry.actorLabel}</span>
                      <span className="text-slate-400">{formatDateTime(entry.createdAt)}</span>
                      {entry.remarks !== null && (
                        <span className="text-slate-500 italic">{entry.remarks}</span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// New claim
// ---------------------------------------------------------------------------

function NewRequestDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [staffId, setStaffId] = useState('');
  const [workDate, setWorkDate] = useState(todayIso());
  const [minutes, setMinutes] = useState('');
  const [task, setTask] = useState('');
  const [reason, setReason] = useState('');
  const [quote, setQuote] = useState<OvertimeQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  /*
   * The quote is fetched as soon as both halves of the key exist, because the measured
   * minutes are the ceiling on what can be claimed. Without showing them first, somebody
   * types a figure, submits, and is refused against a number they were never shown.
   */
  useEffect(() => {
    const id = Number(staffId);
    if (!Number.isInteger(id) || id < 1 || workDate === '') {
      setQuote(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await overtimeApi.quote(id, workDate);
        if (!cancelled) {
          setQuote(result);
          setError(null);
          // Default to the whole measured window; trimming it is the exception.
          setMinutes(String(result.measuredMinutes));
        }
      } catch (cause) {
        if (!cancelled) {
          setQuote(null);
          setError(cause instanceof Error ? cause.message : null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [staffId, workDate]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const created = await overtimeApi.create({
        staffId: Number(staffId),
        workDate,
        requestedMinutes: Number(minutes),
        task,
        reason,
      });
      await onDone(`${created.requestNo} direkodkan.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Permohonan tidak dapat direkodkan.');
    } finally {
      setBusy(false);
    }
  };

  const blocked =
    quote === null ||
    !quote.hasSalary ||
    quote.measuredMinutes <= 0 ||
    Number(minutes) <= 0 ||
    task.trim() === '' ||
    reason.trim() === '';

  return (
    <Dialog
      title={<T k="overtime.new.title" />}
      titleText={t('overtime.new.title')}
      description={<T k="overtime.new.description" />}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k="overtime.new.staff" />}
            type="number"
            inputMode="numeric"
            value={staffId}
            placeholder={t('overtime.new.staffPlaceholder')}
            onChange={(event) => setStaffId(event.target.value)}
          />
          <Field
            label={<T k="overtime.new.workDate" />}
            type="date"
            value={workDate}
            max={todayIso()}
            onChange={(event) => setWorkDate(event.target.value)}
          />
        </div>

        {quote !== null && (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <p className="text-xs font-medium text-slate-600">
              <T k="overtime.quote.heading" />
              {quote.holidayName !== null && (
                <span className="ml-2 font-normal text-slate-500">
                  <T k="overtime.quote.holiday" vars={{ name: quote.holidayName }} />
                </span>
              )}
            </p>
            <DetailGrid>
              <Detail
                label={<T k="overtime.quote.measured" />}
                value={`${formatHours(quote.measuredMinutes)} jam`}
              />
              <Detail
                label={<T k="overtime.column.dayType" />}
                value={
                  <TEnum k={OVERTIME_DAY_TYPE_LABELS[quote.dayType]} fallback={quote.dayType} />
                }
              />
              <Detail
                label={<T k="overtime.quote.hourlyRate" />}
                value={formatRinggit(quote.hourlyRate)}
              />
              <Detail
                label={<T k="overtime.quote.multiplier" />}
                value={`${quote.multiplier}×`}
              />
              <Detail
                label={<T k="overtime.quote.estimate" />}
                value={formatRinggit(quote.estimate)}
              />
              <Detail
                label={<T k="overtime.quote.monthUsed" />}
                value={
                  <T
                    k="overtime.quote.monthUsedValue"
                    vars={{
                      used: formatHours(quote.monthMinutes),
                      cap: formatHours(quote.monthCapMinutes),
                    }}
                  />
                }
              />
            </DetailGrid>

            {!quote.hasSalary && (
              <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                <T k="overtime.quote.noSalary" />
              </PanelNote>
            )}
            {quote.hasSalary && quote.measuredMinutes <= 0 && (
              <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                <T k="overtime.quote.noneMeasured" />
              </PanelNote>
            )}
            {quote.usingStatutoryFloor && (
              <PanelNote tone="warn">
                <T k="overtime.quote.statutoryFloor" />
              </PanelNote>
            )}

            {/* Where the hourly rate came from, beside the figure it produced. */}
            <PanelNote>
              <T k="overtime.quote.hourlyRateHint" />
            </PanelNote>
          </div>
        )}

        <Field
          label={<T k="overtime.new.minutes" />}
          hint={<T k="overtime.new.minutesHint" />}
          type="number"
          inputMode="numeric"
          min={1}
          max={quote?.measuredMinutes ?? undefined}
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
        />

        <Field
          label={<T k="overtime.new.task" />}
          value={task}
          maxLength={190}
          onChange={(event) => setTask(event.target.value)}
        />
        <Field
          label={<T k="overtime.new.reason" />}
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
        />

        <PanelNote>
          <T k="overtime.quote.estimateHint" />
        </PanelNote>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={blocked}
          submitLabel={<T k="overtime.new.submit" />}
        />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

function DecideDialog({
  target,
  approve,
  onClose,
  onDone,
}: {
  target: OvertimeRequestRow;
  approve: boolean;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [rates, setRates] = useState<OvertimeRate[]>([]);
  const [rateId, setRateId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  useEffect(() => {
    void (async () => {
      try {
        const list = await overtimeApi.rates();
        setRates(list.filter((rate) => rate.active));
        // Preselect the rate for the day this actually was, so the common case is one click.
        const match = list.find(
          (rate) => rate.active && rate.dayType === target.dayType && rate.isDefault,
        );
        if (match) setRateId(String(match.id));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : null);
      }
    })();
  }, [target.dayType]);

  const chosen = rates.find((rate) => String(rate.id) === rateId) ?? null;
  const willPay =
    chosen === null
      ? null
      : Math.round(target.hourlyRate * chosen.multiplier * (target.requestedMinutes / 60) * 100) /
        100;
  const mismatch = chosen !== null && chosen.dayType !== target.dayType;

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await overtimeApi.decide(target.id, {
        decision: approve ? 'approved' : 'rejected',
        ...(approve ? { overtimeRateId: Number(rateId) } : {}),
        ...(note.trim() === '' ? {} : { note }),
      });
      /*
       * A signature that did not settle the request must not read as one that did.
       * "Approved — RM 45.00" on rung 1 of 3 tells the approver money is owed when two more
       * people have yet to see it.
       */
      const base = !approve
        ? `${target.requestNo} ditolak.`
        : result.finalized
          ? `${target.requestNo} diluluskan — ${formatRinggit(result.amount)}.`
          : `${target.requestNo}: ${t('hr.approval.progress', {
              level: result.level,
              total: result.totalLevels,
            })}. ${
              result.awaitingLabel === null
                ? ''
                : t('hr.approval.awaiting', {
                    level: result.awaitingLevel ?? 0,
                    name: result.awaitingLabel,
                  })
            }`.trim();
      await onDone(result.warning === null ? base : `${base} ${result.warning}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Keputusan tidak dapat disimpan.');
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="overtime.decide.title" vars={{ requestNo: target.requestNo }} />}
      titleText={t('overtime.decide.title', { requestNo: target.requestNo })}
      description={<T k="overtime.decide.description" />}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <DetailGrid>
          <Detail label={<T k="overtime.column.staff" />} value={target.staffName ?? '—'} />
          <Detail
            label={<T k="overtime.column.workDate" />}
            value={formatDateOnly(target.workDate)}
          />
          <Detail
            label={<T k="overtime.column.dayType" />}
            value={
              <TEnum k={OVERTIME_DAY_TYPE_LABELS[target.dayType]} fallback={target.dayType} />
            }
          />
          <Detail
            label={<T k="overtime.column.hours" />}
            value={`${formatHours(target.requestedMinutes)} jam`}
          />
          <Detail
            label={<T k="overtime.quote.hourlyRate" />}
            value={formatRinggit(target.hourlyRate)}
          />
        </DetailGrid>

        {/*
          The rate picker only exists on the approving path. Rejecting decides nothing
          about money, and offering the choice there would suggest otherwise.
        */}
        {approve && (
          <FacetSelect
            label={t('overtime.decide.ratePlaceholder')}
            value={rateId}
            onChange={setRateId}
            options={rates.map((rate) => ({
              value: String(rate.id),
              label: `${rate.name} — ${rate.multiplier}×`,
            }))}
          />
        )}

        {approve && willPay !== null && (
          <PanelNote tone="info">
            <T k="overtime.decide.willPay" vars={{ amount: formatRinggit(willPay) }} />
          </PanelNote>
        )}

        {approve && mismatch && (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="overtime.decide.mismatch" />
          </PanelNote>
        )}

        {approve && chosen?.shortfall != null && (
          <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T
              k="overtime.rates.shortfall"
              vars={{ actual: chosen.shortfall.actual, floor: chosen.shortfall.floor }}
            />
          </PanelNote>
        )}

        <Field
          label={<T k="overtime.decide.note" />}
          {...(approve ? {} : { hint: <T k="overtime.decide.noteRequired" /> })}
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          // A rejection with no reason leaves the applicant nothing to act on.
          disabled={approve ? rateId === '' : note.trim().length < 3}
          submitLabel={<T k={approve ? 'overtime.decide.approve' : 'overtime.decide.reject'} />}
        />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

/**
 * Overtime rates, hosted by the overtime settings screen.
 *
 * Exported and left in this file rather than moved: it was written here with its dialog beside it.
 */
export function OvertimeRatesPanel(): ReactNode {
  const [rows, setRows] = useState<OvertimeRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<OvertimeRate | 'new' | null>(null);
  const { t } = useLabels();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await overtimeApi.rates());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('overtime.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PanelSection
        title={<T k="overtime.rates.title" />}
        subtitle={<T k="overtime.rates.subtitle" />}
        action={
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden />
            <T k="overtime.rates.action.new" />
          </Button>
        }
      />

      <PanelBody className="space-y-2 pb-0">
        <Feedback error={error} notice={notice} />
        <PanelNote icon={<CircleAlert className="size-3.5" aria-hidden />}>
          <T k="overtime.rates.shortfallNote" />
        </PanelNote>
      </PanelBody>

      <RecordTable
        loading={loading}
        rowCount={rows.length}
        empty={<T k="overtime.rates.empty" />}
        columns={[
          { header: <T k="overtime.rates.column.code" />, width: 'w-36' },
          { header: <T k="overtime.rates.column.name" /> },
          { header: <T k="overtime.rates.column.dayType" />, width: 'w-48' },
          { header: <T k="overtime.rates.column.multiplier" />, width: 'w-28', align: 'right' },
          { header: <T k="overtime.rates.column.used" />, width: 'w-24', align: 'right' },
          { header: <T k="panel.column.actions" />, width: 'w-24', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <tr
            key={row.id}
            className={cn(
              'border-b border-slate-100 hover:bg-slate-50/70',
              row.shortfall !== null && 'bg-rose-50/40',
            )}
          >
            <td className="px-5 py-2 font-mono text-xs text-slate-700">{row.code}</td>
            <td className="px-2 py-2">
              <span className="block text-slate-800">{row.name}</span>
              {row.shortfall !== null && (
                <span className="block text-[11px] text-rose-600">
                  <T
                    k="overtime.rates.shortfall"
                    vars={{ actual: row.shortfall.actual, floor: row.shortfall.floor }}
                  />
                </span>
              )}
            </td>
            <td className="px-2 py-2 text-xs text-slate-600">
              <TEnum k={OVERTIME_DAY_TYPE_LABELS[row.dayType]} fallback={row.dayType} />
              {row.isDefault && (
                <span className="ml-2">
                  <Badge tone="neutral">
                    <span className="uppercase">
                      <T k="overtime.rates.default" />
                    </span>
                  </Badge>
                </span>
              )}
            </td>
            <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-700">
              {row.multiplier}×
            </td>
            <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-500">
              {row.requestCount}
            </td>
            <td className="px-2 py-2 pr-4">
              <RowActions>
                <RowAction
                  icon={<Percent className="size-4" aria-hidden />}
                  label={t('action.edit')}
                  onClick={() => setEditing(row)}
                />
              </RowActions>
            </td>
          </tr>
        ))}
      </RecordTable>

      {editing !== null && (
        <RateDialog
          target={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={async (message) => {
            setEditing(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </>
  );
}

function RateDialog({
  target,
  onClose,
  onDone,
}: {
  target: OvertimeRate | null;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [code, setCode] = useState(target?.code ?? '');
  const [name, setName] = useState(target?.name ?? '');
  const [description, setDescription] = useState(target?.description ?? '');
  const [dayType, setDayType] = useState<OvertimeDayType>(target?.dayType ?? 'weekday');
  const [multiplier, setMultiplier] = useState(String(target?.multiplier ?? 1.5));
  const [isDefault, setIsDefault] = useState(target?.isDefault ?? false);
  const [active, setActive] = useState(target?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const body = {
        code,
        name,
        ...(description === '' ? {} : { description }),
        dayType,
        multiplier: Number(multiplier),
        isDefault,
        active,
      };
      if (target === null) await overtimeApi.createRate(body);
      else await overtimeApi.updateRate(target.id, body);
      await onDone(`Kadar ${code.toUpperCase()} disimpan.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kadar tidak dapat disimpan.');
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="overtime.rates.form.title" />}
      titleText={t('overtime.rates.form.title')}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k="overtime.rates.form.code" />}
            value={code}
            maxLength={16}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <Field
            label={<T k="overtime.rates.form.multiplier" />}
            hint={<T k="overtime.rates.form.floorHint" vars={{ floor: FLOOR[dayType] }} />}
            type="number"
            step="0.05"
            min={0.05}
            max={10}
            value={multiplier}
            onChange={(event) => setMultiplier(event.target.value)}
          />
        </div>

        <Field
          label={<T k="overtime.rates.form.name" />}
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
        />
        <Field
          label={<T k="overtime.rates.form.description" />}
          value={description}
          maxLength={255}
          onChange={(event) => setDescription(event.target.value)}
        />

        <FacetSelect
          label={t('overtime.rates.form.dayType')}
          value={dayType}
          onChange={(value) => setDayType(value as OvertimeDayType)}
          options={DAY_TYPES.map((value) => ({
            value,
            label: `${t(OVERTIME_DAY_TYPE_LABELS[value])} (min ${FLOOR[value]}×)`,
          }))}
        />

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(event) => setIsDefault(event.target.checked)}
            />
            <T k="overtime.rates.form.isDefault" />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            <T k="overtime.rates.form.active" />
          </label>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={code.trim() === '' || name.trim() === '' || Number(multiplier) <= 0}
          submitLabel={<T k="dialog.save" />}
        />
      </div>
    </Dialog>
  );
}
