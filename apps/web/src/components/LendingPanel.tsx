import type { LabelKey } from '@attendance/shared';
import { CircleCheck, CircleX, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { formatDateOnly, todayIso } from '../lib/operations-api';
import {
  RECORD_STATE_LABELS,
  payrollApi,
  type LendingPage,
  type LendingRow,
  type RecordState,
} from '../lib/payroll-api';
import { T, TEnum, useLabels } from '../lib/translation';
import { Dialog, DialogFooter, Feedback } from './Dialog';
import {
  ChipBar,
  Detail,
  DetailGrid,
  FilterRow,
  PanelBody,
  PanelCard,
  PanelFooter,
  PanelNote,
  PanelSection,
  RecordTable,
  RowAction,
  RowActions,
} from './RecordPanel';
import { StaffPicker, type PickedStaff } from './StaffPicker';
import { Badge, Button, Field, TextArea } from './ui';

/**
 * Loans and advances, which differ only in where the instalment comes from.
 *
 * A loan carries an agreed instalment that need not divide the principal evenly — the last one is
 * whatever is left. An advance divides the amount by the months chosen, so entering both would
 * allow a figure that never clears the balance.
 *
 * Separate screens and separate permission keys: an advance is a favour a supervisor arranges, a
 * loan is a contract, and somebody preparing one has no reason to read the other. The borrower is
 * picked through this kind's own staff search for the same reason.
 */
export interface LendingCopy {
  kind: 'loans' | 'advances';
  screen: 'hr.loans' | 'hr.advances';
  title: LabelKey;
  subtitle: LabelKey;
  /** The section heading: a count, as on every list. */
  count: LabelKey;
  add: LabelKey;
  empty: LabelKey;
  errorLoad: LabelKey;
  progress: LabelKey;
  formTitle: LabelKey;
  formStaff: LabelKey;
  formPrincipal: LabelKey;
  formMonths: LabelKey;
  formMonthsHint?: LabelKey;
  formIssuedOn: LabelKey;
  formStartsOn: LabelKey;
  formStartsOnHint?: LabelKey;
  formReason: LabelKey;
  formNote: LabelKey;
  columnReference: LabelKey;
  columnStaff: LabelKey;
  columnPrincipal: LabelKey;
  columnInstalment: LabelKey;
  columnProgress: LabelKey;
  columnBalance: LabelKey;
  columnStartsOn: LabelKey;
  /** Loans ask for the instalment; advances derive it. */
  instalmentField?: { label: LabelKey; hint: LabelKey };
  /** The monthly figure on the summary strip, worded for this kind. */
  previewLabel: LabelKey;
}

export const LOAN_COPY: LendingCopy = {
  kind: 'loans',
  screen: 'hr.loans',
  title: 'pay.loan.title',
  subtitle: 'pay.loan.subtitle',
  count: 'pay.loan.count',
  add: 'pay.loan.action.add',
  empty: 'pay.loan.empty',
  errorLoad: 'pay.loan.error.load',
  progress: 'pay.loan.progress',
  formTitle: 'pay.loan.form.title',
  formStaff: 'pay.loan.form.staff',
  formPrincipal: 'pay.loan.form.principal',
  formMonths: 'pay.loan.form.months',
  formIssuedOn: 'pay.loan.form.issuedOn',
  formStartsOn: 'pay.loan.form.startsOn',
  formStartsOnHint: 'pay.loan.form.startsOn.hint',
  formReason: 'pay.loan.form.purpose',
  formNote: 'pay.loan.form.note',
  columnReference: 'pay.loan.column.reference',
  columnStaff: 'pay.loan.column.staff',
  columnPrincipal: 'pay.loan.column.principal',
  columnInstalment: 'pay.loan.column.instalment',
  columnProgress: 'pay.loan.column.progress',
  columnBalance: 'pay.loan.column.balance',
  columnStartsOn: 'pay.loan.column.startsOn',
  instalmentField: { label: 'pay.loan.form.instalment', hint: 'pay.loan.form.instalment.hint' },
  previewLabel: 'pay.loan.form.preview',
};

export const ADVANCE_COPY: LendingCopy = {
  kind: 'advances',
  screen: 'hr.advances',
  title: 'pay.advance.title',
  subtitle: 'pay.advance.subtitle',
  count: 'pay.advance.count',
  add: 'pay.advance.action.add',
  empty: 'pay.advance.empty',
  errorLoad: 'pay.advance.error.load',
  progress: 'pay.advance.progress',
  formTitle: 'pay.advance.form.title',
  formStaff: 'pay.advance.form.staff',
  formPrincipal: 'pay.advance.form.principal',
  formMonths: 'pay.advance.form.months',
  formMonthsHint: 'pay.advance.form.months.hint',
  formIssuedOn: 'pay.advance.form.issuedOn',
  formStartsOn: 'pay.advance.form.startsOn',
  formReason: 'pay.advance.form.reason',
  formNote: 'pay.advance.form.note',
  columnReference: 'pay.advance.column.reference',
  columnStaff: 'pay.advance.column.staff',
  columnPrincipal: 'pay.advance.column.principal',
  columnInstalment: 'pay.advance.column.instalment',
  columnProgress: 'pay.advance.column.progress',
  columnBalance: 'pay.advance.column.balance',
  columnStartsOn: 'pay.advance.column.startsOn',
  previewLabel: 'pay.advance.form.preview',
};

type LendingState = Extract<RecordState, 'pending' | 'active' | 'completed' | 'cancelled'>;

const STATES: LendingState[] = ['pending', 'active', 'completed', 'cancelled'];

const STATE_DOT: Record<LendingState, string> = {
  pending: 'bg-amber-500',
  active: 'bg-sky-500',
  completed: 'bg-emerald-600',
  cancelled: 'bg-slate-400',
};

/** Register for active, verdict for the rest: active is a standing arrangement, not a fault. */
const STATE_TONE: Record<string, 'neutral' | 'warning' | 'success' | 'info'> = {
  pending: 'warning',
  active: 'info',
  completed: 'success',
  cancelled: 'neutral',
};

/** Money to the sen, the way the server rounds an instalment. */
function toSen(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The monthly recovery the server derives: the amount over the months, rounded **up** to the sen
 * so the months chosen clear it. Mirrors `monthlyRecovery` in `apps/server/src/hr/payroll.ts`,
 * including the epsilon that keeps an exact division exact.
 */
function recovery(amount: number, months: number): number {
  return toSen(Math.ceil((amount / months) * 100 - 1e-6) / 100);
}

export function LendingPanel({ copy }: { copy: LendingCopy }): ReactNode {
  const [data, setData] = useState<LendingPage | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<LendingState | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<{ row: LendingRow; action: 'approve' | 'cancel' } | null>(
    null,
  );
  const [removing, setRemoving] = useState<LendingRow | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();
  // Which load is the latest, so a search answered out of order cannot replace the current rows.
  const latest = useRef(0);

  // One request per pause in typing, not one per key — the same debounce as the request lists.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    try {
      const result = await payrollApi.lending(copy.kind, {
        page,
        pageSize,
        ...(debounced === '' ? {} : { search: debounced }),
        ...(status === undefined ? {} : { status }),
      });
      if (mine !== latest.current) return;
      setData(result);
      setError(null);
    } catch (cause) {
      if (mine !== latest.current) return;
      setError(cause instanceof Error ? cause.message : t(copy.errorLoad));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [copy.kind, copy.errorLoad, page, pageSize, debounced, status, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const done = async (message: string): Promise<void> => {
    setCreating(false);
    setDeciding(null);
    setRemoving(null);
    setNotice(message);
    await load();
  };

  const rows = data?.rows ?? [];
  const counts = data?.counts ?? {};
  // The heading counts every status, so choosing a chip does not make it shrink with the table.
  const count = Object.values(counts).reduce((sum, value) => sum + value, 0);

  return (
    <PanelCard title={<T k={copy.title} />} subtitle={<T k={copy.subtitle} />}>
      <PanelSection
        title={<T k={copy.count} vars={{ count }} />}
        action={
          can(copy.screen, 'create') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              <T k={copy.add} />
            </Button>
          ) : undefined
        }
      />

      <ChipBar
        active={status}
        onChange={(id) => {
          setStatus(id as LendingState | undefined);
          setPage(1);
        }}
        chips={STATES.map((key) => ({
          id: key,
          label: <T k={RECORD_STATE_LABELS[key]} />,
          count: counts[key] ?? 0,
          dot: STATE_DOT[key],
        }))}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('pay.lending.search')}
        dirty={search.length > 0 || status !== undefined}
        onReset={() => {
          setSearch('');
          setStatus(undefined);
          setPage(1);
        }}
      />

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={rows.length}
        empty={<T k={copy.empty} />}
        columns={[
          { header: <T k={copy.columnReference} />, width: 'w-36' },
          { header: <T k={copy.columnStaff} /> },
          { header: <T k={copy.columnPrincipal} />, width: 'w-28', align: 'right' },
          { header: <T k={copy.columnInstalment} />, width: 'w-28', align: 'right' },
          { header: <T k={copy.columnProgress} />, width: 'w-32' },
          { header: <T k={copy.columnBalance} />, width: 'w-28', align: 'right' },
          { header: <T k={copy.columnStartsOn} />, width: 'w-28' },
          { header: <T k="panel.column.status" />, width: 'w-28' },
          { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
        ]}
      >
        {rows.map((row) => {
          const pending = row.status === 'pending';
          const active = row.status === 'active';
          const repaid = row.paidInstalments > 0;
          // Anything with a repayment history stays: the payslips that deducted it point here.
          const removable = (pending || row.status === 'cancelled') && !repaid;
          return (
            <tr
              key={row.id}
              className={cn(
                'border-b border-slate-100 hover:bg-slate-50/70',
                (row.status === 'cancelled' || row.status === 'completed') && 'text-slate-400',
                pending && 'bg-amber-50/40',
              )}
            >
              <td className="px-5 py-2 font-mono text-xs text-slate-700">{row.reference}</td>
              <td className="px-2 py-2">
                <span className="block text-slate-800">{row.fullName}</span>
                <span className="block font-mono text-[11px] text-slate-400">{row.employeeNo}</span>
                {row.reason !== null && (
                  <span className="block text-[11px] text-slate-500">{row.reason}</span>
                )}
              </td>
              <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-700">
                {row.principal.toFixed(2)}
              </td>
              <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-700">
                {row.instalment.toFixed(2)}
              </td>
              <td className="px-2 py-2 text-xs text-slate-600">
                <T
                  k={copy.progress}
                  vars={{ paid: row.paidInstalments, total: row.totalInstalments }}
                />
              </td>
              <td className="px-2 py-2 text-right text-xs font-medium tabular-nums">
                <span
                  className={
                    row.remainingBalance > 0 && active ? 'text-rose-700' : 'text-slate-500'
                  }
                >
                  {row.remainingBalance.toFixed(2)}
                </span>
              </td>
              <td className="px-2 py-2 text-xs whitespace-nowrap tabular-nums text-slate-600">
                {formatDateOnly(row.startsOn)}
              </td>
              <td className="px-2 py-2">
                {/* Uppercased by the badge's class: a translated word cannot be upper-cased safely. */}
                <Badge tone={STATE_TONE[row.status] ?? 'neutral'} className="uppercase">
                  <TEnum k={RECORD_STATE_LABELS[row.status]} fallback={row.status} />
                </Badge>
              </td>
              <td className="px-2 py-2 pr-4">
                <RowActions>
                  {can(copy.screen, 'approve') && pending && (
                    <RowAction
                      icon={<CircleCheck className="size-4" aria-hidden />}
                      label={t('pay.lending.row.approve')}
                      tone="success"
                      onClick={() => setDeciding({ row, action: 'approve' })}
                    />
                  )}
                  {/*
                    Cancelling is refused once wages have been deducted against it, so the control
                    is greyed with the count rather than live and then a 409.
                  */}
                  {can(copy.screen, 'approve') && (pending || active) && (
                    <RowAction
                      icon={<CircleX className="size-4" aria-hidden />}
                      label={
                        repaid
                          ? t('pay.lending.cancel.locked', { count: row.paidInstalments })
                          : t('pay.lending.row.cancel')
                      }
                      tone="danger"
                      disabled={repaid}
                      onClick={() => setDeciding({ row, action: 'cancel' })}
                    />
                  )}
                  {can(copy.screen, 'delete') && (
                    <RowAction
                      icon={<Trash2 className="size-4" aria-hidden />}
                      label={
                        removable
                          ? t('pay.action.remove')
                          : active && !repaid
                            ? t('pay.lending.remove.locked.active')
                            : t('pay.lending.locked')
                      }
                      tone="danger"
                      disabled={!removable}
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
        shown={rows.length}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        generatedAt={data?.generatedAt}
        loading={loading}
        onPage={setPage}
        onPageSize={(value) => {
          setPageSize(value);
          setPage(1);
        }}
        onRefresh={() => void load()}
      />

      {creating && (
        <LendingDialog copy={copy} onClose={() => setCreating(false)} onDone={done} />
      )}

      {deciding !== null && (
        <DecisionDialog
          copy={copy}
          row={deciding.row}
          action={deciding.action}
          onClose={() => setDeciding(null)}
          onDone={done}
        />
      )}

      {removing !== null && (
        <RemoveDialog copy={copy} row={removing} onClose={() => setRemoving(null)} onDone={done} />
      )}
    </PanelCard>
  );
}

/**
 * A new loan or advance.
 *
 * The borrower is picked by name through the shared picker. This used to be a number field with a
 * staff-number example that sent the directory's internal row id, so typing somebody's staff number
 * recorded the debt against whoever held that row id — and the instalments came out of their pay.
 *
 * The monthly figure and what it adds up to close the form, on the strip read last before saving:
 * that is what stops somebody choosing three months for a figure they meant to spread over twelve.
 */
function LendingDialog({
  copy,
  onClose,
  onDone,
}: {
  copy: LendingCopy;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [staff, setStaff] = useState<PickedStaff | null>(null);
  const [principal, setPrincipal] = useState('');
  const [instalment, setInstalment] = useState('');
  const [months, setMonths] = useState('');
  const [issuedOn, setIssuedOn] = useState(todayIso());
  const [startsOn, setStartsOn] = useState(todayIso());
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const amount = Number(principal);
  const count = Number(months);
  const valid = Number.isFinite(amount) && amount > 0 && Number.isInteger(count) && count >= 1;

  /*
   * The instalment the server will store: the agreed one for a loan when typed, otherwise the
   * amount over the months — the same `monthlyRecovery` rule, rounded up so it clears.
   */
  const typed = copy.instalmentField !== undefined && instalment.trim() !== '';
  const monthly = !valid ? null : typed ? toSen(Number(instalment)) : recovery(amount, count);
  // What the months collect at most; the last deduction takes only what is left.
  const repaid = monthly === null ? null : Math.min(toSen(monthly * count), toSen(amount));
  /*
   * The server refuses an instalment that cannot clear the principal within the term. Checked on
   * whatever instalment applies, typed or derived, the same way the route checks it — a derived
   * one always clears now, but the check is the server's and should not depend on which it was.
   */
  const shortfall = monthly !== null && toSen(monthly * count) < toSen(amount) - 0.01;
  const startsEarly = issuedOn !== '' && startsOn !== '' && startsOn < issuedOn;

  const submit = async (): Promise<void> => {
    if (staff === null) return;
    setBusy(true);
    setError(null);
    try {
      const created = await payrollApi.createLending(copy.kind, {
        staffId: staff.id,
        principal: amount,
        ...(typed ? { monthlyInstalment: Number(instalment) } : {}),
        months: count,
        issuedOn,
        startsOn,
        reason: reason.trim(),
        note: note.trim(),
      });
      await onDone(
        t('pay.lending.notice.created', {
          staff: staff.fullName,
          amount: created.instalment.toFixed(2),
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k={copy.formTitle} />}
      titleText={t(copy.formTitle)}
      width="2xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <StaffPicker
          value={staff}
          onChange={setStaff}
          search={(query) => payrollApi.searchLendingStaff(copy.kind, query)}
          hint={<T k="pay.lending.form.staff.hint" />}
        />

        {staff !== null && (
          <>
            <div
              className={cn(
                'grid items-start gap-4',
                copy.instalmentField === undefined ? 'sm:grid-cols-2' : 'sm:grid-cols-3',
              )}
            >
              <Field
                label={<T k={copy.formPrincipal} />}
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                value={principal}
                onChange={(event) => setPrincipal(event.target.value)}
              />
              <Field
                label={<T k={copy.formMonths} />}
                hint={copy.formMonthsHint === undefined ? undefined : <T k={copy.formMonthsHint} />}
                type="number"
                inputMode="numeric"
                min={1}
                max={120}
                value={months}
                onChange={(event) => setMonths(event.target.value)}
              />
              {copy.instalmentField !== undefined && (
                <Field
                  label={<T k={copy.instalmentField.label} />}
                  hint={<T k={copy.instalmentField.hint} />}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  value={instalment}
                  onChange={(event) => setInstalment(event.target.value)}
                />
              )}
            </div>

            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field
                label={<T k={copy.formIssuedOn} />}
                type="date"
                value={issuedOn}
                onChange={(event) => setIssuedOn(event.target.value)}
              />
              <Field
                label={<T k={copy.formStartsOn} />}
                hint={
                  startsEarly ? (
                    <T k="pay.lending.form.startsEarly" />
                  ) : copy.formStartsOnHint === undefined ? undefined : (
                    <T k={copy.formStartsOnHint} />
                  )
                }
                type="date"
                value={startsOn}
                min={issuedOn === '' ? undefined : issuedOn}
                onChange={(event) => setStartsOn(event.target.value)}
              />
            </div>

            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field
                label={<T k={copy.formReason} />}
                value={reason}
                maxLength={190}
                onChange={(event) => setReason(event.target.value)}
              />
              <TextArea
                label={<T k={copy.formNote} />}
                rows={2}
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>

            {/*
              The last block before the footer, so it carries the `pb-2`.

              The monthly deduction on a tinted strip, because it is the figure that leaves
              somebody's pay every month. Rose when an agreed instalment cannot clear the
              principal in the term — the server refuses that, so saying it here saves a round trip.
            */}
            <div className="pb-2">
              <div
                className={cn(
                  'flex flex-wrap items-baseline justify-between gap-2 rounded-lg border px-3 py-2.5',
                  monthly === null
                    ? 'border-slate-200 bg-slate-50 text-slate-600'
                    : shortfall
                      ? 'border-rose-300 bg-rose-50 text-rose-900'
                      : 'border-emerald-200 bg-emerald-50/70 text-emerald-900',
                )}
              >
                <span className="text-sm font-medium">
                  {monthly === null ? (
                    <T k="pay.lending.form.previewPending" />
                  ) : (
                    <T k={copy.previewLabel} vars={{ amount: monthly.toFixed(2) }} />
                  )}
                </span>
                {repaid !== null && (
                  <span className="text-xs tabular-nums">
                    <T
                      k="pay.lending.form.total"
                      vars={{ total: repaid.toFixed(2), months: count }}
                    />
                  </span>
                )}
                {shortfall && repaid !== null && monthly !== null && (
                  <span className="w-full text-xs">
                    <T
                      k="pay.loan.form.shortfall"
                      vars={{
                        months: count,
                        instalment: monthly.toFixed(2),
                        total: repaid.toFixed(2),
                        principal: toSen(amount).toFixed(2),
                      }}
                    />
                  </span>
                )}
              </div>
            </div>

            <DialogFooter
              onClose={onClose}
              onSubmit={() => void submit()}
              busy={busy}
              disabled={
                !valid ||
                (typed && !(Number(instalment) > 0)) ||
                shortfall ||
                issuedOn === '' ||
                startsOn === '' ||
                startsEarly
              }
              submitLabel={<T k="dialog.save" />}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}

/** Approve or cancel, one decision per dialog — the row says which before it opens. */
function DecisionDialog({
  copy,
  row,
  action,
  onClose,
  onDone,
}: {
  copy: LendingCopy;
  row: LendingRow;
  action: 'approve' | 'cancel';
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();
  const approve = action === 'approve';

  const titleKey: LabelKey = approve ? 'pay.lending.approve.title' : 'pay.lending.cancel.title';

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const trimmed = note.trim();
      await payrollApi.decideLending(copy.kind, row.id, {
        action,
        ...(trimmed === '' ? {} : { note: trimmed }),
      });
      await onDone(
        approve
          ? t('pay.lending.notice.approved', {
              reference: row.reference,
              date: formatDateOnly(row.startsOn),
            })
          : t('pay.lending.notice.cancelled', { reference: row.reference }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k={titleKey} vars={{ reference: row.reference }} />}
      titleText={t(titleKey, { reference: row.reference })}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <DetailGrid>
          <Detail label={<T k={copy.columnStaff} />} value={row.fullName} />
          <Detail label={<T k={copy.columnPrincipal} />} value={row.principal.toFixed(2)} />
          <Detail label={<T k={copy.columnInstalment} />} value={row.instalment.toFixed(2)} />
          <Detail label={<T k={copy.columnStartsOn} />} value={formatDateOnly(row.startsOn)} />
        </DetailGrid>

        {/* The consequence, said at the moment of deciding. */}
        <PanelNote
          tone={approve ? 'warn' : 'danger'}
          icon={<TriangleAlert className="size-3.5" aria-hidden />}
        >
          <T k={approve ? 'pay.lending.approve.body' : 'pay.lending.cancel.body'} />
        </PanelNote>

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="pb-2">
          <TextArea
            label={<T k="pay.award.note" />}
            rows={2}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel={
            <T k={approve ? 'pay.lending.approve.submit' : 'pay.lending.cancel.submit'} />
          }
        />
      </div>
    </Dialog>
  );
}

/** The second step of removing a record nothing has been deducted against. */
function RemoveDialog({
  copy,
  row,
  onClose,
  onDone,
}: {
  copy: LendingCopy;
  row: LendingRow;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await payrollApi.removeLending(copy.kind, row.id);
      await onDone(t('pay.lending.notice.removed', { reference: row.reference }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.remove'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="pay.lending.remove.title" vars={{ reference: row.reference }} />}
      titleText={t('pay.lending.remove.title', { reference: row.reference })}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <DetailGrid>
          <Detail label={<T k={copy.columnStaff} />} value={row.fullName} />
          <Detail label={<T k={copy.columnPrincipal} />} value={row.principal.toFixed(2)} />
          <Detail
            label={<T k="panel.column.status" />}
            value={<TEnum k={RECORD_STATE_LABELS[row.status]} fallback={row.status} />}
          />
        </DetailGrid>

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="pb-2">
          <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="pay.lending.remove.confirm" vars={{ reference: row.reference }} />
          </PanelNote>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel={<T k="app.remove" />}
        />
      </div>
    </Dialog>
  );
}
