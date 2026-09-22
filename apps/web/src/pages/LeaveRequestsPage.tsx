import {
  ArrowRight,
  Banknote,
  CalendarClock,
  CircleCheck,
  CircleX,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Undo2,
  UserRound,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  BoolMark,
  ChipBar,
  CodePill,
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
import { Badge, Button, CheckCard, Field, SelectField, TextArea } from '../components/ui';
import { cn } from '../lib/cn';
import { formatDate, formatDateOnly, formatDateTime, todayIso } from '../lib/operations-api';
import {
  LEAVE_STATUS_BADGE,
  LEAVE_STATUS_DOT,
  LEAVE_STATUS_LABELS,
  leaveApi,
  type LeaveBalance,
  type LeaveQuote,
  type LeaveRequestPage,
  type LeaveRequestRow,
  type LeaveStatus,
  type LeaveType,
} from '../lib/reports-api';
import type { StaffRef } from '../lib/operations-api';
import type { LabelKey } from '@attendance/shared';
import { T, TEnum, useLabels } from '../lib/translation';

/**
 * Leave applications.
 *
 * Approving a request is the only action on this screen that touches attendance: it
 * writes `leave` days onto the roster and recomputes them, so the person stops being
 * reported absent. That effect is stated on the approval dialog, because an approver
 * needs to know they are changing payroll and not just clearing a queue.
 */
export function LeaveRequestsPage(): ReactNode {
  /*
    One view, so no tab bar.

    This screen used to carry five tabs: the applications, the leave types, and the three
    configuration panels. Four of those moved to `/jadual/permohonan/tetapan`, which is a sibling
    entry in the sidebar — deciding an application and deciding who signs for one are different
    jobs held by different people, and the permission model already said so with a separate
    `configure` action.

    A one-tab tab bar is a control that cannot do anything, so it is gone rather than left
    showing a single option.
  */
  return (
    <PanelCard title={<T k="leave.title" />} subtitle={<T k="leave.subtitle" />}>
      <RequestsPanel />
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * `onChanged` is optional because its only consumer was the tab bar's pending count.
 *
 * The tab bar is gone — the settings half of this screen moved to its own route — so nothing
 * outside this panel needs to hear about a decision. Left in the signature rather than removed,
 * because a caller that does want to react to one should not have to add the hook back.
 */
function RequestsPanel({ onChanged }: { onChanged?: () => void }): ReactNode {
  const [data, setData] = useState<LeaveRequestPage | null>(null);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [status, setStatus] = useState<LeaveStatus | undefined>('pending');
  const [typeId, setTypeId] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<{ row: LeaveRequestRow; approve: boolean } | null>(null);
  const [cancelling, setCancelling] = useState<LeaveRequestRow | null>(null);
  const { t } = useLabels();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await leaveApi.list({
          status,
          leaveTypeId: typeId ? Number(typeId) : undefined,
          search: debounced.length > 0 ? debounced : undefined,
          from: from.length > 0 ? from : undefined,
          to: to.length > 0 ? to : undefined,
          page,
          pageSize,
        }),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('leave.request.error.load'));
    } finally {
      setLoading(false);
    }
  }, [status, typeId, debounced, from, to, page, pageSize, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void leaveApi
      .types()
      .then(setTypes)
      .catch(() => setTypes([]));
  }, []);

  const refresh = useCallback(() => {
    void load();
    onChanged?.();
  }, [load, onChanged]);

  const rows = data?.rows ?? [];

  return (
    <>
      <PanelSection
        title={
          (data?.statuses.pending ?? 0) === 0 ? (
            <T k="leave.request.none" />
          ) : (
            <T k="leave.request.pending" vars={{ count: data?.statuses.pending ?? 0 }} />
          )
        }
        subtitle={<T k="leave.request.subtitle" />}
        action={
          <Button onClick={() => setCreating(true)} disabled={types.length === 0}>
            <Plus className="size-4" aria-hidden />
            <T k="leave.request.add" />
          </Button>
        }
      />

      <ChipBar
        active={status}
        onChange={(id) => {
          setStatus(id as LeaveStatus | undefined);
          setPage(1);
        }}
        chips={(['pending', 'approved', 'rejected', 'cancelled'] as LeaveStatus[]).map((key) => ({
          id: key,
          label: <T k={LEAVE_STATUS_LABELS[key]} />,
          count: data?.statuses[key] ?? 0,
          dot: LEAVE_STATUS_DOT[key],
        }))}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('leave.request.search')}
        dirty={
          search.length > 0 ||
          status !== 'pending' ||
          typeId.length > 0 ||
          from.length > 0 ||
          to.length > 0
        }
        onReset={() => {
          setSearch('');
          setStatus('pending');
          setTypeId('');
          setFrom('');
          setTo('');
          setPage(1);
        }}
      >
        <FacetSelect
          label={t('leave.filter.allTypes')}
          value={typeId}
          onChange={(value) => {
            setTypeId(value);
            setPage(1);
          }}
          options={(data?.types ?? []).map((row) => ({
            value: String(row.id),
            label: `${row.code} — ${row.name} (${String(row.count)})`,
          }))}
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
        framed
        loading={loading}
        rowCount={rows.length}
        empty={<T k="leave.request.empty" />}
        columns={[
          { header: <T k="leave.column.staff" /> },
          { header: <T k="leave.column.type" />, width: 'w-44' },
          { header: <T k="leave.column.period" />, width: 'w-48' },
          { header: <T k="leave.column.days" />, width: 'w-20' },
          { header: <T k="leave.column.status" />, width: 'w-32' },
          { header: <T k="leave.column.appliedAt" />, width: 'w-32' },
          { header: <T k="panel.column.actions" />, width: 'w-32', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <RequestRow
            key={row.id}
            row={row}
            expanded={open === row.id}
            onToggle={() => setOpen(open === row.id ? null : row.id)}
            onApprove={() => setDeciding({ row, approve: true })}
            onReject={() => setDeciding({ row, approve: false })}
            onCancel={() => setCancelling(row)}
          />
        ))}
      </RecordTable>

      <PanelFooter
        shown={rows.length}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        generatedAt={data?.generatedAt}
        loading={loading}
        onPage={setPage}
        onPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onRefresh={refresh}
      />

      {creating && (
        <RequestDialog
          types={types.filter((type) => type.active)}
          onClose={() => setCreating(false)}
          onSaved={(message) => {
            setCreating(false);
            setNotice(message);
            refresh();
          }}
        />
      )}

      {deciding !== null && (
        <DecisionDialog
          target={deciding.row}
          approve={deciding.approve}
          onClose={() => setDeciding(null)}
          onDone={(message) => {
            setDeciding(null);
            setNotice(message);
            refresh();
          }}
        />
      )}

      {cancelling !== null && (
        <CancelDialog
          target={cancelling}
          onClose={() => setCancelling(null)}
          onDone={(message) => {
            setCancelling(null);
            setNotice(message);
            refresh();
          }}
        />
      )}
    </>
  );
}

function RequestRow({
  row,
  expanded,
  onToggle,
  onApprove,
  onReject,
  onCancel,
}: {
  row: LeaveRequestRow;
  expanded: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
}): ReactNode {
  const { t } = useLabels();
  const pending = row.status === 'pending';
  const live = pending || row.status === 'approved';

  return (
    <>
      <tr
        className={cn(
          'border-b border-slate-100',
          expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
          pending && !expanded && 'bg-amber-50/40',
        )}
      >
        <td className="px-5 py-2.5">
          <span className="block font-medium text-slate-800">{row.staff.fullName}</span>
          <span className="block font-mono text-[11px] text-slate-400">
            {row.staff.employeeNo}
            {row.staff.department !== null && ` · ${row.staff.department.name}`}
          </span>
        </td>
        <td className="px-2 py-2.5">
          <span className="inline-flex items-center gap-1.5">
            {row.leaveType.colour !== null && (
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: row.leaveType.colour }}
                aria-hidden
              />
            )}
            <span className="text-xs text-slate-700">
              {row.leaveType.code}
              {!row.leaveType.paid && (
                <span className="ml-1 text-[10px] text-slate-400">
                  <T k="leave.row.unpaid" />
                </span>
              )}
            </span>
          </span>
        </td>
        <td className="px-2 py-2.5 text-xs whitespace-nowrap tabular-nums text-slate-600">
          {formatDateOnly(row.fromDate)} – {formatDateOnly(row.toDate)}
        </td>
        <td className="px-2 py-2.5 text-xs tabular-nums text-slate-700">{row.days}</td>
        <td className="px-2 py-2.5">
          <span
            className={cn(
              'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
              LEAVE_STATUS_BADGE[row.status],
            )}
          >
            {/* Uppercased in CSS: a translated word cannot be upper-cased safely in every
                language. */}
            <span className="uppercase">
              <T k={LEAVE_STATUS_LABELS[row.status]} />
            </span>
          </span>
        </td>
        <td className="px-2 py-2.5 text-xs whitespace-nowrap text-slate-500">
          {formatDate(row.createdAt)}
        </td>
        <td className="px-2 py-2.5 pr-4">
          <RowActions>
            {pending && (
              <>
                <RowAction
                  icon={<CircleCheck className="size-4" aria-hidden />}
                  label={t('leave.row.approve')}
                  tone="success"
                  onClick={onApprove}
                />
                <RowAction
                  icon={<CircleX className="size-4" aria-hidden />}
                  label={t('leave.row.reject')}
                  tone="danger"
                  onClick={onReject}
                />
              </>
            )}
            {live && !pending && (
              <RowAction
                icon={<Undo2 className="size-4" aria-hidden />}
                label={t('leave.row.cancelApproved')}
                tone="warn"
                onClick={onCancel}
              />
            )}
            {pending && (
              <RowAction
                icon={<Undo2 className="size-4" aria-hidden />}
                label={t('leave.row.cancelPending')}
                tone="neutral"
                onClick={onCancel}
              />
            )}
            <ExpandButton expanded={expanded} onClick={onToggle} label={t('leave.row.expand')} />
          </RowActions>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={7} className="px-5 py-3">
            <DetailGrid>
              <Detail
                label={<T k="leave.column.staff" />}
                value={`${row.staff.fullName} (${row.staff.employeeNo})`}
              />
              <Detail
                label={<T k="leave.column.type" />}
                value={`${row.leaveType.code} — ${row.leaveType.name}`}
              />
              <Detail
                label={<T k="leave.detail.paid" />}
                value={
                  <T k={row.leaveType.paid ? 'leave.detail.paid.yes' : 'leave.detail.paid.no'} />
                }
              />
              <Detail
                label={<T k="leave.column.period" />}
                value={
                  <T
                    k="leave.detail.period"
                    vars={{
                      from: formatDateOnly(row.fromDate),
                      to: formatDateOnly(row.toDate),
                    }}
                  />
                }
              />
              <Detail label={<T k="leave.detail.workingDays" />} value={String(row.days)} />
              <Detail
                label={<T k="leave.column.appliedAt" />}
                value={formatDateTime(row.createdAt)}
              />
              <Detail
                label={<T k="leave.detail.decidedAt" />}
                value={
                  row.decidedAt === null ? (
                    <T k="leave.detail.decidedAt.pending" />
                  ) : (
                    formatDateTime(row.decidedAt)
                  )
                }
              />
              <Detail label={<T k="leave.detail.requestId" />} value={String(row.id)} mono />
            </DetailGrid>

            {row.remarks !== null && (
              <div className="mt-3 border-t border-slate-200 pt-2">
                <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                  <T k="leave.new.remarks" />
                </p>
                <p className="mt-1 text-sm break-words text-slate-700">{row.remarks}</p>
              </div>
            )}

            {row.reason !== null && (
              <div className="mt-3 border-t border-slate-200 pt-2">
                <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                  <T k="leave.detail.reasonHeading" />
                </p>
                <p className="mt-1 text-sm break-words text-slate-700">{row.reason}</p>
              </div>
            )}

            {row.decisionNote !== null && (
              <PanelNote
                tone={row.status === 'approved' ? 'success' : 'warn'}
                className="mt-3"
              >
                <T k="leave.detail.decisionNote" vars={{ note: row.decisionNote }} />
              </PanelNote>
            )}

            {row.status === 'approved' && row.replacedRoster && (
              <PanelNote
                tone="warn"
                className="mt-3"
                icon={<TriangleAlert className="size-3.5" aria-hidden />}
              >
                <T
                  k="leave.detail.replacedRoster"
                  vars={{
                    emphasis: (
                      <strong>
                        <T k="leave.detail.notRestored" />
                      </strong>
                    ),
                  }}
                />
              </PanelNote>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// New request
// ---------------------------------------------------------------------------

function RequestDialog({
  types,
  onClose,
  onSaved,
}: {
  types: LeaveType[];
  onClose: () => void;
  onSaved: (message: string) => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Array<StaffRef & { department: { name: string } | null }>>([]);
  const [searching, setSearching] = useState(false);
  const [staff, setStaff] = useState<StaffRef | null>(null);
  const [typeId, setTypeId] = useState(String(types[0]?.id ?? ''));
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [quote, setQuote] = useState<LeaveQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The chosen person's own entitlement per type, loaded the moment they are chosen.
   *
   * This is the whole reason the employee field sits at the top of the form. A graded type gives a
   * new joiner fewer days than somebody with six years in, and a carry-forward type adds last year's
   * unused remainder — so `LeaveType.annualDays` is not a figure that means anything until a person
   * is named. Labelling the type list from the type table would show everybody the same number and
   * be wrong for most of them.
   */
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const { t } = useLabels();

  useEffect(() => {
    if (staff !== null) return;
    setSearching(true);
    const timer = setTimeout(() => {
      void leaveApi
        .searchStaff(query)
        .then(setCandidates)
        .catch(() => setCandidates([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, staff]);

  // Reloaded per person, not per type: one call answers for every type at once.
  useEffect(() => {
    if (staff === null) {
      setBalance(null);
      return;
    }
    void leaveApi
      .balance(staff.id, new Date().getFullYear())
      .then(setBalance)
      .catch(() => setBalance(null));
  }, [staff]);

  // The cost is quoted as the dates change, so an applicant with three days left finds
  // out here rather than from a rejection.
  useEffect(() => {
    if (staff === null || typeId === '' || from === '' || to === '') {
      setQuote(null);
      return;
    }
    const timer = setTimeout(() => {
      void leaveApi
        .quote({ staffId: staff.id, leaveTypeId: Number(typeId), from, to })
        .then(setQuote)
        .catch(() => setQuote(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [staff, typeId, from, to]);

  async function submit(): Promise<void> {
    if (staff === null) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await leaveApi.create({
        staffId: staff.id,
        leaveTypeId: Number(typeId),
        fromDate: from,
        toDate: to,
        reason: reason.trim(),
        remarks: remarks.trim(),
      });
      onSaved(
        outcome.applied
          ? t('leave.new.saved.applied', {
              days: outcome.days,
              name: staff.fullName,
              status: outcome.status,
              roster: outcome.applied.rosterWritten,
            })
          : t('leave.new.saved', {
              days: outcome.days,
              name: staff.fullName,
              status: outcome.status,
            }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('leave.new.error'));
      setBusy(false);
    }
  }

  const type = types.find((row) => String(row.id) === typeId);

  /** Undefined until both a person and a type are chosen — which is what the Balance row says. */
  const selectedBalance = balance?.balances.find((entry) => String(entry.type.id) === typeId);

  return (
    <Dialog
      title={<T k="leave.new.title" />}
      titleText={t('leave.new.title')}
      description={<T k="leave.new.description" />}
      width="2xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/*
          Two stages, not one, and deliberately against the reference here.

          The reference picks the employee from a plain `<select>`. This directory holds five
          thousand staff — a select of five thousand options is a quarter of a megabyte of DOM with
          no way to search it, so the picker is a filtered list instead. Everything after it is one
          form, which is the part that matters: the balance, the day count and the refusals all
          appear against the person without a second screen.
        */}
        {staff === null ? (
          <div>
            <Field
              label={<T k="leave.new.searchStaff" />}
              hint={<T k="leave.new.searchStaff.hint" />}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('leave.new.searchStaff.placeholder')}
              autoFocus
            />

            <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-slate-200">
              {searching && candidates.length === 0 ? (
                <div className="flex min-h-24 items-center justify-center">
                  <Loader2
                    className="size-4 animate-spin text-slate-400"
                    aria-label={t('leave.new.searching')}
                  />
                </div>
              ) : candidates.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-slate-500">
                  <T k="leave.new.noMatch" />
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {candidates.map((candidate) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        onClick={() => setStaff(candidate)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
                      >
                        <UserRound className="size-4 shrink-0 text-slate-400" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-800">
                            {candidate.fullName}
                          </span>
                          <span className="block truncate font-mono text-xs text-slate-500">
                            {candidate.employeeNo}
                            {candidate.department !== null && ` · ${candidate.department.name}`}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <UserRound className="size-4 text-slate-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{staff.fullName}</p>
                <p className="font-mono text-xs text-slate-500">{staff.employeeNo}</p>
              </div>
              <Button variant="ghost" onClick={() => setStaff(null)}>
                <T k="leave.new.change" />
              </Button>
            </div>

            {/*
              Each option carries THIS person's entitlement, read from the balance call above — not
              the type's `annualDays`. With graded types and carry-forward, the type table's figure
              is right for a new joiner and wrong for everybody else.
            */}
            <SelectField
              label={<T k="leave.new.type" />}
              value={typeId}
              onChange={(event) => setTypeId(event.target.value)}
              hint={
                type !== undefined && !type.allowBackdated ? (
                  <T k="leave.new.noBackdated" />
                ) : undefined
              }
            >
              {types.map((row) => {
                const owed = balance?.balances.find((entry) => entry.type.id === row.id);
                const days = owed?.annualDays ?? row.annualDays;
                return (
                  /* `<option>` cannot hold a node, so the whole line resolves to text. */
                  <option key={row.id} value={row.id}>
                    {t(days > 0 ? 'leave.new.type.annual' : 'leave.new.type.unlimited', {
                      code: row.code,
                      name: row.name,
                      days,
                    })}
                    {row.paid ? '' : t('leave.new.type.unpaidSuffix')}
                  </option>
                );
              })}
            </SelectField>

            {/*
              The balance stands on its own row rather than waiting for a date range, because it is
              the answer to "can this person take this leave at all" and that question comes before
              picking dates. Until both are chosen it says so, instead of showing a zero that reads
              as "none left".
            */}
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5">
              <span className="text-sm font-medium text-slate-700">
                <T k="leave.new.balance" />
              </span>
              {selectedBalance === undefined ? (
                <span className="text-xs text-slate-500">
                  <T k="leave.new.balance.waiting" />
                </span>
              ) : selectedBalance.remaining === null ? (
                <span className="text-xs text-slate-600">
                  <T k="leave.new.balance.unlimited" />
                </span>
              ) : (
                <>
                  <span className="text-sm font-semibold tabular-nums text-slate-800">
                    <T k="leave.new.balance.remaining" vars={{ days: selectedBalance.remaining }} />
                  </span>
                  <span className="text-xs text-slate-500 tabular-nums">
                    <T
                      k="leave.new.balance.breakdown"
                      vars={{
                        entitled: selectedBalance.annualDays,
                        taken: selectedBalance.taken,
                        pending: selectedBalance.pending,
                      }}
                    />
                  </span>
                  {selectedBalance.carriedIn > 0 && (
                    <Badge tone="info">
                      <T k="leave.new.balance.carried" vars={{ days: selectedBalance.carriedIn }} />
                    </Badge>
                  )}
                </>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={<T k="filter.from" />}
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  if (to < event.target.value) setTo(event.target.value);
                }}
              />
              <Field
                label={<T k="filter.to" />}
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>

            {quote !== null && <QuoteSummary quote={quote} />}

            <div className="grid gap-4 sm:grid-cols-2">
              {/*
                Required on the form and optional on the route. The mobile client and the public API
                post to the same endpoint, and tightening the field server-side would reject every
                caller that has been working.
              */}
              <TextArea
                label={<T k="leave.new.reason" />}
                hint={<T k="leave.new.reason.hint" />}
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t('leave.new.reason.placeholder')}
                maxLength={500}
              />
              <TextArea
                label={<T k="leave.new.remarks" />}
                hint={<T k="leave.new.remarks.hint" />}
                rows={3}
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
                placeholder={t('leave.new.remarks.placeholder')}
                maxLength={500}
              />
            </div>

            <DialogFooter
              onClose={onClose}
              onSubmit={() => void submit()}
              busy={busy}
              disabled={
                quote === null ||
                quote.days === 0 ||
                quote.overlaps.length > 0 ||
                reason.trim().length === 0
              }
              submitLabel={<T k="leave.new.submit" />}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}

/** What the range costs, and anything that will refuse it. */
function QuoteSummary({ quote }: { quote: LeaveQuote }): ReactNode {
  const { t } = useLabels();

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <DetailGrid>
        <Detail label={<T k="leave.quote.workingDays" />} value={String(quote.days)} />
        <Detail label={<T k="leave.quote.restDays" />} value={String(quote.restDays)} />
        <Detail label={<T k="leave.quote.holidays" />} value={String(quote.holidays)} />
        <Detail
          label={<T k="leave.quote.entitlement" />}
          value={
            quote.annualDays === 0 ? (
              <T k="leave.quote.unlimited" />
            ) : (
              <T k="leave.quote.perYear" vars={{ days: quote.annualDays }} />
            )
          }
        />
        <Detail label={<T k="leave.quote.taken" />} value={String(quote.taken)} />
        <Detail
          label={<T k="leave.quote.remaining" />}
          value={
            quote.remaining === null ? (
              <T k="leave.quote.unlimited" />
            ) : (
              String(quote.remaining - quote.days)
            )
          }
        />
      </DetailGrid>

      {quote.days === 0 && (
        <PanelNote tone="warn">
          <T k="leave.quote.noWorkingDays" />
        </PanelNote>
      )}

      {quote.overlaps.length > 0 && (
        <PanelNote tone="danger">
          {/* The overlapping request's status is domain vocabulary, so it resolves through
              the shared map rather than printing the raw enum. */}
          <T
            k="leave.quote.overlap"
            vars={{ status: t(LEAVE_STATUS_LABELS[quote.overlaps[0]!.status]) }}
          />
        </PanelNote>
      )}

      {quote.wouldExceed && quote.overlaps.length === 0 && (
        <PanelNote tone="warn">
          <T k="leave.quote.wouldExceed" />
        </PanelNote>
      )}

      {quote.backdated && !quote.allowBackdated && (
        <PanelNote tone="danger">
          <T k="leave.quote.backdated" />
        </PanelNote>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

function DecisionDialog({
  target,
  approve,
  onClose,
  onDone,
}: {
  target: LeaveRequestRow;
  approve: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}): ReactNode {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const outcome = await leaveApi.decide(
        target.id,
        approve ? 'approved' : 'rejected',
        note.trim(),
      );
      onDone(
        approve
          ? /*
               Assembled from separate labels because the middle clauses are conditional.
               One sentence with empty slots would leave its punctuation stranded when a
               clause does not apply.
            */
            t('leave.decision.approved', {
              name: target.staff.fullName,
              roster: outcome.applied?.rosterWritten ?? 0,
            }) +
            ((outcome.applied?.rosterReplaced ?? 0) > 0
              ? t('leave.decision.approved.replaced', {
                  count: outcome.applied?.rosterReplaced ?? 0,
                })
              : '') +
            ((outcome.applied?.rosterSkipped ?? 0) > 0
              ? t('leave.decision.approved.skipped', {
                  count: outcome.applied?.rosterSkipped ?? 0,
                })
              : '') +
            t('leave.decision.approved.recomputed', {
              count: outcome.applied?.recordsWritten ?? 0,
            })
          : t('leave.decision.rejected', { name: target.staff.fullName }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('leave.decision.error'));
      setBusy(false);
    }
  }

  const titleKey = approve ? 'leave.decision.approve.title' : 'leave.decision.reject.title';

  return (
    <Dialog
      title={<T k={titleKey} />}
      titleText={t(titleKey)}
      description={
        <T
          k="leave.decision.description"
          vars={{
            name: target.staff.fullName,
            code: target.leaveType.code,
            days: target.days,
          }}
        />
      }
      onClose={onClose}
    >
      <div className="space-y-3">
        <Feedback error={error} />

        <DetailGrid>
          <Detail
            label={<T k="leave.column.period" />}
            value={`${formatDateOnly(target.fromDate)} – ${formatDateOnly(target.toDate)}`}
          />
          <Detail label={<T k="leave.quote.workingDays" />} value={String(target.days)} />
          <Detail
            label={<T k="leave.detail.paid" />}
            value={
              <T k={target.leaveType.paid ? 'leave.detail.paid.yes' : 'leave.detail.paid.no'} />
            }
          />
        </DetailGrid>

        {target.reason !== null && (
          <PanelNote>
            <T k="leave.decision.applicantReason" vars={{ reason: target.reason }} />
          </PanelNote>
        )}

        {/*
          The consequence is stated at the moment of approving. An approver clearing a
          queue needs to know this rewrites the roster and recomputes attendance, not
          just that it changes a status.
        */}
        {approve ? (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="leave.decision.approveWarning" vars={{ days: target.days }} />
          </PanelNote>
        ) : (
          <PanelNote tone="danger">
            <T k="leave.decision.rejectWarning" />
          </PanelNote>
        )}

        <div>
          <label htmlFor="decision-note" className="block text-sm font-medium text-slate-700">
            <T
              k={approve ? 'leave.decision.note.approve' : 'leave.decision.note.reject'}
            />
          </label>
          <textarea
            id="decision-note"
            rows={3}
            autoFocus
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t(
              approve
                ? 'leave.decision.note.approve.placeholder'
                : 'leave.decision.note.reject.placeholder',
            )}
          />
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={!approve && note.trim().length < 3}
          submitLabel={
            <T
              k={approve ? 'leave.decision.submit.approve' : 'leave.decision.submit.reject'}
            />
          }
        />
      </div>
    </Dialog>
  );
}

function CancelDialog({
  target,
  onClose,
  onDone,
}: {
  target: LeaveRequestRow;
  onClose: () => void;
  onDone: (message: string) => void;
}): ReactNode {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();
  const wasApproved = target.status === 'approved';

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const outcome = await leaveApi.cancel(target.id, note.trim());
      onDone(
        outcome.rosterRemoved > 0
          ? t('leave.cancel.done.removed', {
              name: target.staff.fullName,
              count: outcome.rosterRemoved,
            })
          : t('leave.cancel.done', { name: target.staff.fullName }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('leave.cancel.error'));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={<T k="leave.cancel.title" />}
      titleText={t('leave.cancel.title')}
      description={
        <T
          k="leave.decision.description"
          vars={{
            name: target.staff.fullName,
            code: target.leaveType.code,
            days: target.days,
          }}
        />
      }
      onClose={onClose}
    >
      <div className="space-y-3">
        <Feedback error={error} />

        {wasApproved ? (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T
              k="leave.cancel.approvedWarning"
              vars={{
                emphasis: (
                  <strong>
                    <T k="leave.cancel.notRestored" />
                  </strong>
                ),
              }}
            />
          </PanelNote>
        ) : (
          <PanelNote>
            <T k="leave.cancel.pendingNote" />
          </PanelNote>
        )}

        <div>
          <label htmlFor="cancel-note" className="block text-sm font-medium text-slate-700">
            <T k="leave.cancel.note" />
          </label>
          <textarea
            id="cancel-note"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel={<T k="leave.cancel.submit" />}
        />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Leave types
// ---------------------------------------------------------------------------

/**
 * Leave types, hosted by the leave settings screen.
 *
 * Exported and left in this file rather than moved. It was written here, its dialog and its
 * validation sit beside it, and relocating four hundred lines to satisfy a naming instinct is a
 * change with real risk and no behaviour attached to it. The settings screen imports it.
 */
/**
 * Maps hold `LabelKey`, never the words.
 *
 * Built once at import, so translated text here would freeze whichever language was current then
 * and the table would keep it for the life of the tab.
 */
const ELIGIBILITY_LABELS: Record<string, LabelKey> = {
  all: 'leave.type.eligibility.all',
  male: 'leave.type.eligibility.male',
  female: 'leave.type.eligibility.female',
};

/** Register, not severity — a restricted category is not a fault. See `TONES` in `ui.tsx`. */
const ELIGIBILITY_TONES: Record<string, 'neutral' | 'info' | 'accent'> = {
  all: 'neutral',
  male: 'info',
  female: 'accent',
};

const COUNTED_IN_LABELS: Record<string, LabelKey> = {
  working: 'leave.type.countedIn.working',
  calendar: 'leave.type.countedIn.calendar',
};

export function LeaveTypesPanel({ onChanged }: { onChanged?: () => void }): ReactNode {
  const [rows, setRows] = useState<LeaveType[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null);
  const { t } = useLabels();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await leaveApi.types());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('leave.type.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: LeaveType): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await leaveApi.removeType(row.id);
      setNotice(t('leave.type.removed', { code: row.code }));
      await load();
      onChanged?.();
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

  return (
    <>
      <PanelSection
        title={<T k="leave.type.count" vars={{ count: rows.length }} />}
        subtitle={<T k="leave.type.subtitle" />}
        action={
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden />
            <T k="leave.type.add" />
          </Button>
        }
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('leave.type.search')}
        dirty={search.length > 0}
        onReset={() => setSearch('')}
      />

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      {/*
        The reference for `framed`. This table is one flexing name column and seven narrow ones,
        which full-bleed renders as a cluster of values against each edge with a void between
        them — the reason the frame exists is documented on `RecordTable`.
      */}
      <RecordTable
        framed
        loading={loading}
        rowCount={filtered.length}
        empty={<T k="leave.type.empty" />}
        /*
          The per-type request count lost its own column when Eligibility, Counted in and Document
          arrived. It was the least scanned value here and it is not gone — it is the reason the
          delete action is disabled, and that tooltip names the number. Twelve columns to keep a
          figure nobody sorts by would have cost the four behaviour marks their width.
        */
        columns={[
          { header: <T k="leave.type.column.code" />, width: 'w-20' },
          { header: <T k="leave.type.column.name" /> },
          { header: <T k="leave.type.column.eligibility" />, width: 'w-28' },
          { header: <T k="leave.type.column.entitlement" />, width: 'w-24' },
          { header: <T k="leave.type.column.countedIn" />, width: 'w-32' },
          { header: <T k="leave.type.column.paid" />, width: 'w-20' },
          { header: <T k="leave.type.column.approval" />, width: 'w-24' },
          { header: <T k="leave.type.column.backdated" />, width: 'w-24' },
          { header: <T k="leave.type.column.document" />, width: 'w-24' },
          { header: <T k="panel.column.status" />, width: 'w-24' },
          { header: <T k="panel.column.actions" />, width: 'w-24', align: 'right' },
        ]}
      >
        {filtered.map((row) => (
          <tr
            key={row.id}
            className={cn('border-b border-slate-100 hover:bg-slate-50/70', !row.active && 'bg-slate-50/60')}
          >
            <td className="px-5 py-2.5">
              <CodePill code={row.code} colour={row.colour} />
            </td>
            {/*
              Name over description. The description is what tells somebody which category they
              are looking at when two names are close — "cuti sakit" against "cuti hospital" is
              decided by the line underneath, not by the name.
            */}
            <td className="px-2 py-2.5">
              <span
                className={cn('block font-medium', row.active ? 'text-slate-800' : 'text-slate-400')}
              >
                {row.name}
              </span>
              {row.description !== null && row.description.length > 0 && (
                <span className="mt-0.5 block text-xs text-slate-500">{row.description}</span>
              )}
            </td>
            {/*
              Tone carries register here, not severity — see `TONES` in `ui.tsx`. A restricted
              category is not a problem to fix, it is a different category, so neither of these
              may use amber or rose.
            */}
            <td className="px-2 py-2.5">
              <Badge tone={ELIGIBILITY_TONES[row.eligibility]}>
                <TEnum k={ELIGIBILITY_LABELS[row.eligibility]} fallback={row.eligibility} />
              </Badge>
            </td>
            {/*
              A graded type shows all three bands, because one number would be a figure that is
              wrong for two thirds of the workforce. The slashes are the statute's own shorthand —
              s.60E annual leave reads 8 / 12 / 16.
            */}
            <td className="px-2 py-2.5 text-xs tabular-nums text-slate-700">
              {row.annualDays === 0 ? (
                <span className="text-slate-400">
                  <T k="leave.type.unlimited" />
                </span>
              ) : row.serviceTiers ? (
                <span title={t('leave.type.tiers.tooltip')}>
                  {[
                    row.annualDays,
                    row.annualDaysTier2 ?? row.annualDays,
                    row.annualDaysTier3 ?? row.annualDaysTier2 ?? row.annualDays,
                  ].join(' / ')}
                </span>
              ) : (
                <T k="leave.type.days" vars={{ days: row.annualDays }} />
              )}
              {row.carryForward && (
                <span className="mt-0.5 block text-[10px] text-slate-400">
                  <T k="leave.type.carry.badge" />
                </span>
              )}
            </td>
            {/*
              Amber for calendar, and that is a verdict rather than a register: a calendar-counted
              type charges rest days and public holidays, so it is the mode somebody should notice
              they are looking at. Working days is the unremarkable one.
            */}
            <td className="px-2 py-2.5">
              <Badge tone={row.countedIn === 'calendar' ? 'warning' : 'neutral'}>
                <TEnum k={COUNTED_IN_LABELS[row.countedIn]} fallback={row.countedIn} />
              </Badge>
            </td>
            <td className="px-2 py-2.5">
              <BoolMark value={row.paid} label={t(row.paid ? 'leave.type.paid.yes' : 'leave.type.paid.no')} />
            </td>
            {/*
              `requiresApproval` false is not a lesser state of true — it means the application is
              granted the moment it is filed. So the mark carries a label that says which of the
              two it is rather than "no", and the amber wording that used to sit here moved into
              that label.
            */}
            <td className="px-2 py-2.5">
              <BoolMark
                value={row.requiresApproval}
                label={t(
                  row.requiresApproval ? 'leave.type.approval.yes' : 'leave.type.approval.auto',
                )}
              />
            </td>
            <td className="px-2 py-2.5">
              <BoolMark
                value={row.allowBackdated}
                label={t(
                  row.allowBackdated ? 'leave.type.backdated.yes' : 'leave.type.backdated.no',
                )}
              />
            </td>
            <td className="px-2 py-2.5">
              <BoolMark
                value={row.requiresDocument}
                label={t(
                  row.requiresDocument ? 'leave.type.document.yes' : 'leave.type.document.no',
                )}
              />
            </td>
            <td className="px-2 py-2.5">
              <Badge tone={row.active ? 'success' : 'neutral'}>
                <T k={row.active ? 'app.status.active' : 'app.status.inactive'} />
              </Badge>
            </td>
            <td className="px-2 py-2.5 pr-4">
              <RowActions>
                <RowAction
                  icon={<Pencil className="size-4" aria-hidden />}
                  label={t('leave.type.row.edit')}
                  tone="edit"
                  onClick={() => setEditing(row)}
                />
                <RowAction
                  icon={<Trash2 className="size-4" aria-hidden />}
                  label={
                    row.requestCount > 0
                      ? t('leave.type.row.locked', { count: row.requestCount })
                      : t('leave.type.row.remove')
                  }
                  tone="danger"
                  disabled={row.requestCount > 0}
                  onClick={() => void remove(row)}
                />
              </RowActions>
            </td>
          </tr>
        ))}
      </RecordTable>

      {/*
        There was a `PanelNote` here explaining why sick and emergency leave allow backdating. It
        is gone: the caveat belongs where the decision is made, and it is already the hint under
        that checkbox in the dialog. Restating it under the table put a paragraph of policy on a
        screen somebody opens to scan eight rows.
      */}

      <PanelFooter
        shown={filtered.length}
        total={rows.length}
        page={1}
        pageSize={Math.max(1, rows.length)}
        pageSizes={[Math.max(1, rows.length)]}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => {
          void load();
          onChanged?.();
        }}
      />

      {editing !== null && (
        <TypeDialog
          target={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            setNotice(message);
            await load();
            onChanged?.();
          }}
        />
      )}
    </>
  );
}

function TypeDialog({
  target,
  onClose,
  onSaved,
}: {
  target: LeaveType | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}): ReactNode {
  const [code, setCode] = useState(target?.code ?? '');
  const [name, setName] = useState(target?.name ?? '');
  const [description, setDescription] = useState(target?.description ?? '');
  const [annualDays, setAnnualDays] = useState(String(target?.annualDays ?? 14));
  const [countedIn, setCountedIn] = useState(target?.countedIn ?? 'working');
  const [eligibility, setEligibility] = useState(target?.eligibility ?? 'all');
  const [requiresDocument, setRequiresDocument] = useState(target?.requiresDocument ?? false);
  const [serviceTiers, setServiceTiers] = useState(target?.serviceTiers ?? false);
  const [tier2, setTier2] = useState(
    target?.annualDaysTier2 === null || target?.annualDaysTier2 === undefined
      ? ''
      : String(target.annualDaysTier2),
  );
  const [tier3, setTier3] = useState(
    target?.annualDaysTier3 === null || target?.annualDaysTier3 === undefined
      ? ''
      : String(target.annualDaysTier3),
  );
  const [carryForward, setCarryForward] = useState(target?.carryForward ?? false);
  const [carryMax, setCarryMax] = useState(
    target?.carryForwardMaxDays === null || target?.carryForwardMaxDays === undefined
      ? ''
      : String(target.carryForwardMaxDays),
  );
  const [paid, setPaid] = useState(target?.paid ?? true);
  const [allowBackdated, setAllowBackdated] = useState(target?.allowBackdated ?? false);
  const [requiresApproval, setRequiresApproval] = useState(target?.requiresApproval ?? true);
  const [colour, setColour] = useState(target?.colour ?? '#2563eb');
  const [active, setActive] = useState(target?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    const payload = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      /*
        Sent even when empty, because empty is what clears it. The route reads `''` as "none" and
        an absent key as "leave as it was", so omitting it would make a cleared box a no-op.
      */
      description: description.trim(),
      annualDays: Number(annualDays),
      countedIn,
      eligibility,
      requiresDocument,
      serviceTiers,
      /*
        `null` when grading is off, so unticking the card clears the bands rather than leaving two
        numbers behind that nothing reads — a later tick would silently restore the old ones.
      */
      annualDaysTier2: serviceTiers && tier2 !== '' ? Number(tier2) : null,
      annualDaysTier3: serviceTiers && tier3 !== '' ? Number(tier3) : null,
      carryForward,
      carryForwardMaxDays: carryForward && carryMax !== '' ? Number(carryMax) : null,
      paid,
      allowBackdated,
      requiresApproval,
      colour,
      active,
    };

    try {
      if (target) {
        await leaveApi.updateType(target.id, payload);
      } else {
        await leaveApi.createType(payload);
      }
      await onSaved(t('leave.type.saved', { code: payload.code }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  }

  const titleKey = target ? 'leave.type.dialog.edit' : 'leave.type.dialog.create';

  return (
    /*
      `2xl`, not the default `md`.
      At 448px the entitlement label wrapped onto two lines and its hint onto four, and even at `xl`
      the label still wrapped — which pushed its input half a line below the four beside it and made
      the whole row read as ragged. The unevenness was the problem, not the density.
    */
    <Dialog title={<T k={titleKey} />} titleText={t(titleKey)} width="2xl" onClose={onClose}>
      <div className="space-y-4">
        <Feedback error={error} />

        {/*
          Identity first: the code somebody types on a form, then the name they read on one.
          `sm:` prefixed so the two collapse to full width on a narrow viewport rather than
          squeezing a 120-character name field into half a phone screen.
        */}
        <div className="grid gap-4 sm:grid-cols-[7rem_1fr]">
          <Field
            label={<T k="leave.type.column.code" />}
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            autoFocus
            hint={<T k="leave.type.dialog.code.hint" />}
          />
          <Field
            label={<T k="leave.type.column.name" />}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <TextArea
          label={<T k="leave.type.dialog.description" />}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t('leave.type.dialog.description.placeholder')}
          hint={<T k="leave.type.dialog.description.hint" />}
          maxLength={300}
          rows={2}
        />

        {/*
          The three values that are picked rather than toggled, on one row. Status is a select and
          not a checkbox in the group below: deactivating a type is not another property of it, it
          is whether the type is in use at all, and it belongs with the fields rather than buried
          at the end of a list of behaviours.
        */}
        {/*
          `items-start` so the five cells hang from one line rather than stretching to match the
          tallest hint. Every label here is kept to one line on purpose — a label that wraps moves
          its own input down and breaks the row's baseline, which is the whole reason this row read
          as untidy before.
        */}
        <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
          <Field
            label={<T k="leave.type.dialog.annualDays" />}
            inputMode="numeric"
            value={annualDays}
            onChange={(event) => setAnnualDays(event.target.value.replace(/\D/g, ''))}
            hint={<T k="leave.type.dialog.annualDays.hint" />}
          />
          <SelectField
            label={<T k="leave.type.column.countedIn" />}
            value={countedIn}
            onChange={(event) =>
              setCountedIn(event.target.value === 'calendar' ? 'calendar' : 'working')
            }
            hint={<T k="leave.type.dialog.countedIn.hint" />}
          >
            <option value="working">{t('leave.type.countedIn.working')}</option>
            <option value="calendar">{t('leave.type.countedIn.calendar')}</option>
          </SelectField>
          {/*
            Not merely a filter on the apply form. The endpoint refuses a restricted category, and
            refuses it too when the person's gender is not recorded — stated in the hint, because
            an operator who restricts a category needs to know it depends on a field on the staff
            record rather than failing open.
          */}
          <SelectField
            label={<T k="leave.type.column.eligibility" />}
            value={eligibility}
            onChange={(event) => {
              const next = event.target.value;
              setEligibility(next === 'male' || next === 'female' ? next : 'all');
            }}
            hint={<T k="leave.type.dialog.eligibility.hint" />}
          >
            <option value="all">{t('leave.type.eligibility.all')}</option>
            <option value="male">{t('leave.type.eligibility.male')}</option>
            <option value="female">{t('leave.type.eligibility.female')}</option>
          </SelectField>
          <SelectField
            label={<T k="panel.column.status" />}
            value={active ? 'active' : 'inactive'}
            onChange={(event) => setActive(event.target.value === 'active')}
          >
            <option value="active">{t('app.status.active')}</option>
            <option value="inactive">{t('app.status.inactive')}</option>
          </SelectField>
          <div className="space-y-1.5">
            <label htmlFor="type-colour" className="block text-sm font-medium text-slate-700">
              <T k="shifts.shift.dialog.colour" />
            </label>
            <div className="flex items-center gap-2">
              <input
                id="type-colour"
                type="color"
                value={colour}
                onChange={(event) => setColour(event.target.value)}
                className="h-[2.375rem] w-16 rounded-lg border border-slate-300"
              />
              <span className="font-mono text-xs text-slate-600">{colour}</span>
            </div>
          </div>
        </div>

        {/*
          `pb-2` so the last card clears the footer. `DialogFooter` is `sticky bottom-0` with
          negative margins cancelling the body padding, so on a form long enough to scroll the
          action bar floats over whatever is beneath it — and the bottom card was landing under it
          with its border hidden, which reads as a card that got cut off.
        */}
        <div className="space-y-2 pb-2">
          {/*
            First, because it changes what the entitlement figure above it means. The two band
            inputs appear only when it is on: three number boxes that do nothing are worse than a
            card that grows, and a disabled pair reads as a feature somebody else has to unlock.
          */}
          <CheckCard
            checked={serviceTiers}
            onChange={setServiceTiers}
            icon={<TrendingUp className="size-4" aria-hidden />}
            title={<T k="leave.type.dialog.serviceTiers" />}
            hint={<T k="leave.type.dialog.serviceTiers.hint" />}
          />
          {serviceTiers && (
            <div className="grid gap-4 pb-1 pl-9 sm:grid-cols-3">
              <Field
                label={<T k="leave.type.dialog.tier1" />}
                value={annualDays}
                readOnly
                hint={<T k="leave.type.dialog.tier1.hint" />}
              />
              <Field
                label={<T k="leave.type.dialog.tier2" />}
                inputMode="numeric"
                value={tier2}
                onChange={(event) => setTier2(event.target.value.replace(/\D/g, ''))}
                placeholder={annualDays}
              />
              <Field
                label={<T k="leave.type.dialog.tier3" />}
                inputMode="numeric"
                value={tier3}
                onChange={(event) => setTier3(event.target.value.replace(/\D/g, ''))}
                placeholder={tier2 === '' ? annualDays : tier2}
              />
            </div>
          )}

          <CheckCard
            checked={carryForward}
            onChange={setCarryForward}
            icon={<ArrowRight className="size-4" aria-hidden />}
            title={<T k="leave.type.dialog.carryForward" />}
            hint={<T k="leave.type.dialog.carryForward.hint" />}
          />
          {carryForward && (
            <div className="grid gap-4 pb-1 pl-9 sm:grid-cols-3">
              <Field
                label={<T k="leave.type.dialog.carryMax" />}
                inputMode="numeric"
                value={carryMax}
                onChange={(event) => setCarryMax(event.target.value.replace(/\D/g, ''))}
                placeholder={t('leave.type.dialog.carryMax.placeholder')}
                hint={<T k="leave.type.dialog.carryMax.hint" />}
              />
            </div>
          )}

          <CheckCard
            checked={paid}
            onChange={setPaid}
            icon={<Banknote className="size-4" aria-hidden />}
            title={<T k="leave.type.dialog.paid" />}
            hint={<T k="leave.type.dialog.paid.hint" />}
          />
          <CheckCard
            checked={requiresApproval}
            onChange={setRequiresApproval}
            icon={<CircleCheck className="size-4" aria-hidden />}
            title={<T k="leave.type.dialog.approval" />}
            hint={<T k="leave.type.dialog.approval.hint" />}
          />
          <CheckCard
            checked={allowBackdated}
            onChange={setAllowBackdated}
            icon={<CalendarClock className="size-4" aria-hidden />}
            title={<T k="leave.type.dialog.backdated" />}
            hint={<T k="leave.type.dialog.backdated.hint" />}
          />
          <CheckCard
            checked={requiresDocument}
            onChange={setRequiresDocument}
            icon={<FileText className="size-4" aria-hidden />}
            title={<T k="leave.type.dialog.document" />}
            hint={<T k="leave.type.dialog.document.hint" />}
          />
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={code.trim().length === 0 || name.trim().length === 0}
        />
      </div>
    </Dialog>
  );
}
