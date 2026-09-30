import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Pencil,
  Plus,
  Star,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  ChipBar,
  CodePill,
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
  RowAction,
  RowActions,
} from '../components/RecordPanel';
import { StaffPicker, type PickedStaff } from '../components/StaffPicker';
import { Badge, Button, CheckCard, Field, SelectField, TextArea } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { signedNotice, type ApprovalTrailEntry } from '../lib/hr-api';
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

const SCREEN = 'hr.overtime';

/**
 * Overtime claims, and the rates they are paid at.
 *
 * The same shape as Leave and Claims, on purpose: an operator who has learned one request module
 * has learned all of them. The queue lives here; the rates and the three configuration panels
 * live on the settings screen beside it in the sidebar.
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
  const [pendingTotal, setPendingTotal] = useState(0);
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
      setPendingTotal(result.pendingTotal);
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
      {/*
        The queue's size in the heading, the way the leave list heads its own — counted across
        every date, not inside the 60-day window the table opens on, because a claim filed before
        that window is still waiting for somebody. The subtitle that used to sit here rendered
        "Diukur dari scan: — jam" on every visit: a per-row fact with no row to belong to.
      */}
      <PanelSection
        title={
          pendingTotal === 0 ? (
            <T k="hr.queue.none" />
          ) : (
            <T k="hr.queue.pending" vars={{ count: pendingTotal }} />
          )
        }
        action={
          can(SCREEN, 'create') ? (
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
        framed
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
          { header: <T k="panel.column.actions" />, width: 'w-32', align: 'right' },
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
            onChanged={async (message) => {
              setNotice(message);
              await load();
            }}
            onError={setError}
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
  onChanged,
  onError,
}: {
  row: OvertimeRequestRow;
  chainLength: number;
  expanded: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  onChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
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
          {/* Uppercased by the badge's class: a translated word cannot be upper-cased safely. */}
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
            className="uppercase"
          >
            <T k={OVERTIME_STATUS_LABELS[row.status]} />
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
            {waiting && can(SCREEN, 'approve') && (
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
            {/*
              Amber, not rose. Withdrawing changes the request's state — it is still there,
              marked withdrawn — and rose is for the action that makes something go away.
            */}
            {waiting && can(SCREEN, 'edit') && (
              <RowAction
                icon={<X className="size-4" aria-hidden />}
                label={t('overtime.action.cancel')}
                tone="warn"
                onClick={async () => {
                  try {
                    await overtimeApi.cancel(row.id);
                    await onChanged(t('hr.request.withdrawn', { number: row.requestNo }));
                  } catch (cause) {
                    onError(cause instanceof Error ? cause.message : t('app.error.save'));
                  }
                }}
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
                value={
                  <T k="overtime.hours.value" vars={{ hours: formatHours(row.measuredMinutes) }} />
                }
              />
              <Detail
                label={<T k="overtime.new.minutes" />}
                value={
                  <T k="overtime.hours.value" vars={{ hours: formatHours(row.requestedMinutes) }} />
                }
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
  const [staff, setStaff] = useState<PickedStaff | null>(null);
  const [workDate, setWorkDate] = useState(todayIso());
  const [minutes, setMinutes] = useState('');
  const [task, setTask] = useState('');
  const [reason, setReason] = useState('');
  const [quote, setQuote] = useState<OvertimeQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const staffId = staff?.id ?? null;

  /*
   * The quote is fetched as soon as both halves of the key exist, because the measured
   * minutes are the ceiling on what can be claimed. Without showing them first, somebody
   * types a figure, submits, and is refused against a number they were never shown.
   */
  useEffect(() => {
    if (staffId === null || workDate === '') {
      setQuote(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await overtimeApi.quote(staffId, workDate);
        if (!cancelled) {
          setQuote(result);
          setError(null);
          /*
           * Default to the whole measured window; trimming it is the exception. Only into an empty
           * field — a figure somebody typed while the quote was loading is theirs, and replacing it
           * with a larger one would file more than they meant to claim.
           */
          setMinutes((current) => (current === '' ? String(result.measuredMinutes) : current));
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
    if (staff === null) return;
    setBusy(true);
    try {
      const created = await overtimeApi.create({
        staffId: staff.id,
        workDate,
        requestedMinutes: Number(minutes),
        task: task.trim(),
        reason: reason.trim(),
      });
      await onDone(t('hr.record.created', { number: created.requestNo }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  const measured = quote?.measuredMinutes ?? 0;
  const claimed = Number(minutes);

  const blocked =
    staff === null ||
    quote === null ||
    !quote.hasSalary ||
    measured <= 0 ||
    minutes === '' ||
    claimed <= 0 ||
    // The server refuses more than was measured, so the button says so first.
    claimed > measured ||
    task.trim() === '' ||
    reason.trim() === '';

  return (
    <Dialog
      title={<T k="overtime.new.title" />}
      titleText={t('overtime.new.title')}
      description={<T k="overtime.new.description" />}
      width="2xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/*
          Name first, then the form — the same two stages as the leave and claim forms. The rest
          of this form is about one person's day, and none of it can be shown before there is a
          person to read it for.
        */}
        <StaffPicker
          value={staff}
          onChange={(next) => {
            setStaff(next);
            setQuote(null);
            setMinutes('');
          }}
          search={overtimeApi.searchStaff}
          hint={<T k="overtime.new.staff.hint" />}
        />

        {staff !== null && (
          <>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field
                label={<T k="overtime.new.workDate" />}
                type="date"
                value={workDate}
                max={todayIso()}
                onChange={(event) => {
                  /*
                    A different day is a different measurement. The previous day's quote would
                    otherwise keep the submit live against its figure until the new one arrived,
                    and its minutes would stand in for a day they were never measured on.
                  */
                  setWorkDate(event.target.value);
                  setQuote(null);
                  setMinutes('');
                }}
              />
              <Field
                label={<T k="overtime.new.minutes" />}
                hint={<T k="overtime.new.minutesHint" />}
                inputMode="numeric"
                value={minutes}
                onChange={(event) => setMinutes(event.target.value.replace(/\D/g, ''))}
              />
            </div>

            {quote !== null && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
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
                    value={
                      <T
                        k="overtime.hours.value"
                        vars={{ hours: formatHours(quote.measuredMinutes) }}
                      />
                    }
                  />
                  <Detail
                    label={<T k="overtime.column.dayType" />}
                    value={
                      <TEnum
                        k={OVERTIME_DAY_TYPE_LABELS[quote.dayType]}
                        fallback={quote.dayType}
                      />
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
                  <PanelNote
                    tone="danger"
                    icon={<TriangleAlert className="size-3.5" aria-hidden />}
                  >
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

                {/*
                  Where the hourly rate came from, and that the figure is an estimate, beside the
                  figures they qualify. One note rather than two: both are about the same row of
                  numbers, and a stack of notes is read as none of them.
                */}
                <PanelNote>
                  <T k="overtime.quote.hourlyRateHint" /> <T k="overtime.quote.estimateHint" />
                </PanelNote>
              </div>
            )}

            {/* The last block before the footer, so it carries the `pb-2`. */}
            <div className="grid gap-4 pb-2 sm:grid-cols-2">
              <TextArea
                label={<T k="overtime.new.task" />}
                rows={3}
                value={task}
                maxLength={190}
                onChange={(event) => setTask(event.target.value)}
              />
              <TextArea
                label={<T k="overtime.new.reason" />}
                rows={3}
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>

            <DialogFooter
              onClose={onClose}
              onSubmit={() => void submit()}
              busy={busy}
              disabled={blocked}
              submitLabel={<T k="overtime.new.submit" />}
            />
          </>
        )}
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
        ? t('hr.decision.rejected', { number: target.requestNo })
        : result.finalized
          ? t('hr.decision.approved', {
              number: target.requestNo,
              amount: formatRinggit(result.amount),
            })
          : signedNotice(t, target.requestNo, result);
      await onDone(result.warning === null ? base : `${base} ${result.warning}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
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
            value={
              <T k="overtime.hours.value" vars={{ hours: formatHours(target.requestedMinutes) }} />
            }
          />
          <Detail
            label={<T k="overtime.quote.hourlyRate" />}
            value={formatRinggit(target.hourlyRate)}
          />
        </DetailGrid>

        {/*
          The rate picker only exists on the approving path. Rejecting decides nothing
          about money, and offering the choice there would suggest otherwise.

          A form select with a visible label, not a facet. `FacetSelect` inserts an empty option
          that reads as "no filter"; here the empty option is a prompt, and submitting is
          disabled until a rate is chosen.
        */}
        {approve && (
          <SelectField
            label={<T k="overtime.column.rate" />}
            value={rateId}
            onChange={(event) => setRateId(event.target.value)}
          >
            <option value="">{t('overtime.decide.ratePlaceholder')}</option>
            {rates.map((rate) => (
              <option key={rate.id} value={String(rate.id)}>
                {`${rate.name} — ${rate.multiplier}×`}
              </option>
            ))}
          </SelectField>
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
          wrapperClassName="pb-2"
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
 * Shaped after the leave types tab, which is the reference for every table of master data.
 */
export function OvertimeRatesPanel(): ReactNode {
  const [rows, setRows] = useState<OvertimeRate[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<OvertimeRate | 'new' | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();
  // The settings screen is open to anybody who can view the module; writing needs `configure`.
  const configurable = can(SCREEN, 'configure');

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

  async function remove(row: OvertimeRate): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await overtimeApi.deleteRate(row.id);
      setNotice(t('overtime.rates.removed', { code: row.code }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.remove'));
    }
  }

  const needle = search.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      needle.length === 0 ||
      row.code.toLowerCase().includes(needle) ||
      row.name.toLowerCase().includes(needle),
  );
  const shortfalls = rows.some((row) => row.shortfall !== null);

  return (
    <>
      {/* Count in the title, the way the leave types tab heads its list. */}
      <PanelSection
        title={<T k="overtime.rates.count" vars={{ count: rows.length }} />}
        subtitle={<T k="overtime.rates.subtitle" />}
        action={
          configurable ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden />
              <T k="overtime.rates.action.new" />
            </Button>
          ) : undefined
        }
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('app.search.codeName')}
        dirty={search.length > 0}
        onReset={() => setSearch('')}
      />

      {/*
        The shortfall note only when a row is short. It explains the rose rows — that the rate is
        reported rather than refused — and on a table with none of them it is a paragraph of policy
        above eight rows somebody opened to scan.
      */}
      {(error !== null || notice !== null || shortfalls) && (
        <PanelBody className="space-y-2 pb-0">
          <Feedback error={error} notice={notice} />
          {shortfalls && (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="overtime.rates.shortfallNote" />
            </PanelNote>
          )}
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={filtered.length}
        empty={<T k="overtime.rates.empty" />}
        columns={[
          { header: <T k="overtime.rates.column.code" />, width: 'w-20' },
          { header: <T k="overtime.rates.column.name" /> },
          { header: <T k="overtime.rates.column.dayType" />, width: 'w-56' },
          { header: <T k="overtime.rates.column.multiplier" />, width: 'w-24', align: 'right' },
          { header: <T k="overtime.rates.column.used" />, width: 'w-24', align: 'right' },
          { header: <T k="panel.column.status" />, width: 'w-24' },
          { header: <T k="panel.column.actions" />, width: 'w-24', align: 'right' },
        ]}
      >
        {filtered.map((row) => (
          <tr
            key={row.id}
            className={cn(
              'border-b border-slate-100 hover:bg-slate-50/70',
              row.shortfall !== null ? 'bg-rose-50/40' : !row.active && 'bg-slate-50/60',
            )}
          >
            <td className="px-5 py-2.5">
              <CodePill code={row.code} />
            </td>
            <td className="px-2 py-2.5">
              <span
                className={cn('block font-medium', row.active ? 'text-slate-800' : 'text-slate-400')}
              >
                {row.name}
              </span>
              {row.description !== null && row.description.length > 0 && (
                <span className="mt-0.5 block text-xs text-slate-500">{row.description}</span>
              )}
              {row.shortfall !== null && (
                <span className="mt-0.5 block text-[11px] text-rose-600">
                  <T
                    k="overtime.rates.shortfall"
                    vars={{ actual: row.shortfall.actual, floor: row.shortfall.floor }}
                  />
                </span>
              )}
            </td>
            <td className="px-2 py-2.5 text-xs text-slate-600">
              <TEnum k={OVERTIME_DAY_TYPE_LABELS[row.dayType]} fallback={row.dayType} />
              {row.isDefault && (
                <Badge tone="info" className="ml-2 uppercase">
                  <T k="overtime.rates.default" />
                </Badge>
              )}
            </td>
            <td className="px-2 py-2.5 text-right text-xs tabular-nums text-slate-700">
              {row.multiplier}×
            </td>
            <td className="px-2 py-2.5 text-right text-xs tabular-nums text-slate-500">
              {row.requestCount}
            </td>
            <td className="px-2 py-2.5">
              <Badge tone={row.active ? 'success' : 'neutral'}>
                <T k={row.active ? 'app.status.active' : 'app.status.inactive'} />
              </Badge>
            </td>
            <td className="px-2 py-2.5 pr-4">
              {configurable && (
                <RowActions>
                  <RowAction
                    icon={<Pencil className="size-4" aria-hidden />}
                    label={t('overtime.rates.row.edit')}
                    tone="edit"
                    onClick={() => setEditing(row)}
                  />
                  {/*
                    Disabled with the count in the tooltip rather than live and refused: a decided
                    claim still has to name the rate it was paid at.
                  */}
                  <RowAction
                    icon={<Trash2 className="size-4" aria-hidden />}
                    label={
                      row.requestCount > 0
                        ? t(row.active ? 'hr.row.locked' : 'hr.row.locked.inactive', {
                            count: row.requestCount,
                          })
                        : t('overtime.rates.row.remove')
                    }
                    tone="danger"
                    disabled={row.requestCount > 0}
                    onClick={() => void remove(row)}
                  />
                </RowActions>
              )}
            </td>
          </tr>
        ))}
      </RecordTable>

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
    setError(null);
    try {
      const body = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        /*
          Sent even when empty, because empty is what clears it. The route reads `''` as "none"
          and an absent key as "leave as it was", so omitting it made a cleared box a no-op.
        */
        description: description.trim(),
        dayType,
        multiplier: Number(multiplier),
        isDefault,
        active,
      };
      if (target === null) await overtimeApi.createRate(body);
      else await overtimeApi.updateRate(target.id, body);
      await onDone(t('overtime.rates.saved', { code: body.code }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  const titleKey = target === null ? 'overtime.rates.form.create' : 'overtime.rates.form.edit';
  // A fallback rate that cannot be used is not a fallback, so the route refuses the pair.
  const inactiveDefault = isDefault && !active;

  return (
    <Dialog title={<T k={titleKey} />} titleText={t(titleKey)} width="2xl" onClose={onClose}>
      <div className="space-y-4">
        <Feedback error={error} />

        {/* Identity first: the code somebody types, then the name they read. */}
        <div className="grid gap-4 sm:grid-cols-[7rem_1fr]">
          <Field
            label={<T k="overtime.rates.form.code" />}
            value={code}
            maxLength={16}
            autoFocus
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <Field
            label={<T k="overtime.rates.form.name" />}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <TextArea
          label={<T k="overtime.rates.form.description" />}
          hint={<T k="app.description.hint" />}
          rows={2}
          value={description}
          maxLength={255}
          onChange={(event) => setDescription(event.target.value)}
        />

        {/*
          The picked values on one row, every label one line so the inputs share a baseline. The
          day type is widest because each option carries its statutory floor, which is the figure
          the multiplier beside it is checked against.
        */}
        <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
          <SelectField
            label={<T k="overtime.rates.form.dayType" />}
            value={dayType}
            onChange={(event) => setDayType(event.target.value as OvertimeDayType)}
          >
            {DAY_TYPES.map((value) => (
              <option key={value} value={value}>
                {t('overtime.rates.form.dayType.option', {
                  dayType: t(OVERTIME_DAY_TYPE_LABELS[value]),
                  floor: FLOOR[value],
                })}
              </option>
            ))}
          </SelectField>
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
          <SelectField
            label={<T k="panel.column.status" />}
            value={active ? 'active' : 'inactive'}
            onChange={(event) => setActive(event.target.value === 'active')}
          >
            <option value="active">{t('app.status.active')}</option>
            <option value="inactive">{t('app.status.inactive')}</option>
          </SelectField>
        </div>

        <div className="space-y-2 pb-2">
          <CheckCard
            checked={isDefault}
            onChange={setIsDefault}
            icon={<Star className="size-4" aria-hidden />}
            title={<T k="overtime.rates.form.isDefault" />}
            hint={<T k="overtime.rates.form.isDefault.hint" />}
          />
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={
            code.trim() === '' ||
            name.trim() === '' ||
            multiplier === '' ||
            !(Number(multiplier) > 0) ||
            inactiveDefault
          }
          // The server refuses an inactive default; the button says why before the round trip.
          {...(inactiveDefault ? { submitTitle: t('overtime.rates.form.inactiveDefault') } : {})}
          submitLabel={<T k="dialog.save" />}
        />
      </div>
    </Dialog>
  );
}
