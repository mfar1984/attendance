import type { LabelKey } from '@attendance/shared';
import { CircleCheck, Landmark, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { formatDateOnly, todayIso } from '../lib/operations-api';
import {
  RECORD_STATE_LABELS,
  payrollApi,
  type LendingPage,
  type LendingRow,
} from '../lib/payroll-api';
import { T, TEnum, useLabels } from '../lib/translation';
import { Dialog, DialogFooter, Feedback } from './Dialog';
import {
  ChipBar,
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
import { Badge, Button, Field } from './ui';

/**
 * Loans and advances, which differ only in where the instalment comes from.
 *
 * A loan carries an agreed instalment that need not divide the principal evenly — the last one is
 * whatever is left. An advance divides the amount by the months chosen, so entering both would
 * allow a figure that never clears the balance.
 *
 * Separate screens and separate permission keys: an advance is a favour a supervisor arranges, a
 * loan is a contract, and somebody preparing one has no reason to read the other.
 */
export interface LendingCopy {
  kind: 'loans' | 'advances';
  screen: 'hr.loans' | 'hr.advances';
  title: LabelKey;
  subtitle: LabelKey;
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
  previewLabel?: LabelKey;
}

export const LOAN_COPY: LendingCopy = {
  kind: 'loans',
  screen: 'hr.loans',
  title: 'pay.loan.title',
  subtitle: 'pay.loan.subtitle',
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
};

export const ADVANCE_COPY: LendingCopy = {
  kind: 'advances',
  screen: 'hr.advances',
  title: 'pay.advance.title',
  subtitle: 'pay.advance.subtitle',
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

export function LendingPanel({ copy }: { copy: LendingCopy }): ReactNode {
  const [data, setData] = useState<LendingPage | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<LendingRow | null>(null);
  const [removing, setRemoving] = useState<LendingRow | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await payrollApi.lending(copy.kind, {
          page,
          pageSize,
          search: search === '' ? undefined : search,
          status: status === '' ? undefined : status,
        }),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(copy.errorLoad));
    } finally {
      setLoading(false);
    }
  }, [copy.kind, copy.errorLoad, page, pageSize, search, status, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];
  const counts = data?.counts ?? {};

  const chips = useMemo(
    () => [
      {
        id: '',
        label: <T k="pay.chip.all" />,
        count: Object.values(counts).reduce((sum, value) => sum + value, 0),
        dot: 'bg-slate-300',
      },
      {
        id: 'pending',
        label: <T k="pay.state.pending" />,
        count: counts.pending ?? 0,
        dot: 'bg-amber-400',
      },
      {
        id: 'active',
        label: <T k="pay.state.active" />,
        count: counts.active ?? 0,
        dot: 'bg-sky-400',
      },
      {
        id: 'completed',
        label: <T k="pay.state.completed" />,
        count: counts.completed ?? 0,
        dot: 'bg-emerald-400',
      },
      {
        id: 'cancelled',
        label: <T k="pay.state.cancelled" />,
        count: counts.cancelled ?? 0,
        dot: 'bg-slate-400',
      },
    ],
    [counts],
  );

  return (
    <PanelCard title={<T k={copy.title} />} subtitle={<T k={copy.subtitle} />}>
      <PanelSection
        icon={<Landmark className="size-4" aria-hidden />}
        title={<T k={copy.title} />}
        action={
          can(copy.screen, 'create') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              <T k={copy.add} />
            </Button>
          ) : undefined
        }
      />

      <PanelBody className="pb-0">
        <Feedback error={error} notice={notice} />
      </PanelBody>

      <ChipBar
        chips={chips}
        active={status}
        onChange={(id) => {
          setStatus(id ?? '');
          setPage(1);
        }}
      />

      <FilterRow
        search={search}
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        dirty={search !== '' || status !== ''}
        onReset={() => {
          setSearch('');
          setStatus('');
          setPage(1);
        }}
      />

      <RecordTable
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
          { header: <T k="panel.column.status" />, width: 'w-24' },
          { header: <T k="panel.column.actions" />, width: 'w-24', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <tr
            key={row.id}
            className={cn(
              'border-b border-slate-100 hover:bg-slate-50/70',
              (row.status === 'cancelled' || row.status === 'completed') && 'text-slate-400',
              row.status === 'pending' && 'bg-amber-50/40',
            )}
          >
            <td className="px-5 py-2 font-mono text-xs text-slate-700">{row.reference}</td>
            <td className="px-2 py-2">
              <p className="text-slate-800">{row.fullName}</p>
              <p className="text-xs text-slate-500">{row.employeeNo}</p>
              {row.reason !== null && <p className="text-xs text-slate-500">{row.reason}</p>}
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
                className={row.remainingBalance > 0 ? 'text-rose-700' : 'text-emerald-700'}
              >
                {row.remainingBalance.toFixed(2)}
              </span>
            </td>
            <td className="px-2 py-2 text-xs whitespace-nowrap tabular-nums text-slate-600">
              {formatDateOnly(row.startsOn)}
            </td>
            <td className="px-2 py-2">
              <Badge
                tone={
                  row.status === 'completed'
                    ? 'success'
                    : row.status === 'pending'
                      ? 'warning'
                      : 'neutral'
                }
              >
                <span className="uppercase">
                  <TEnum k={RECORD_STATE_LABELS[row.status]} fallback={row.status} />
                </span>
              </Badge>
            </td>
            <td className="px-2 py-2 pr-4">
              <RowActions>
                {can(copy.screen, 'approve') &&
                  (row.status === 'pending' || row.status === 'active') && (
                    <RowAction
                      icon={<CircleCheck className="size-4" aria-hidden />}
                      label={t('pay.action.decide')}
                      tone="success"
                      onClick={() => setDeciding(row)}
                    />
                  )}
                {can(copy.screen, 'delete') && (
                  <RowAction
                    icon={<Trash2 className="size-4" aria-hidden />}
                    // Anything with a repayment history stays: the payslips that deducted it
                    // point here, and removing the row leaves those lines naming nothing.
                    label={
                      row.paidInstalments > 0 ||
                      row.status === 'active' ||
                      row.status === 'completed'
                        ? t('pay.lending.locked')
                        : t('pay.action.remove')
                    }
                    tone="danger"
                    disabled={
                      row.paidInstalments > 0 ||
                      row.status === 'active' ||
                      row.status === 'completed'
                    }
                    onClick={() => setRemoving(row)}
                  />
                )}
              </RowActions>
            </td>
          </tr>
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
        onPageSize={(value) => {
          setPageSize(value);
          setPage(1);
        }}
        onRefresh={() => void load()}
      />

      {creating && (
        <LendingDialog
          copy={copy}
          onClose={() => setCreating(false)}
          onDone={async (message) => {
            setCreating(false);
            setNotice(message);
            await load();
          }}
        />
      )}

      {deciding !== null && (
        <DecisionDialog
          copy={copy}
          row={deciding}
          onClose={() => setDeciding(null)}
          onDone={async (message) => {
            setDeciding(null);
            setNotice(message);
            await load();
          }}
        />
      )}

      {removing !== null && (
        <RemoveDialog
          copy={copy}
          row={removing}
          onClose={() => setRemoving(null)}
          onDone={async (message) => {
            setRemoving(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </PanelCard>
  );
}

function LendingDialog({
  copy,
  onClose,
  onDone,
}: {
  copy: LendingCopy;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [staffId, setStaffId] = useState('');
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

  /*
   * The derived instalment, shown before saving.
   *
   * An advance's monthly recovery is the amount over the months, and seeing it before committing
   * is what stops somebody choosing three months for a figure they meant to spread over twelve.
   */
  const derived = (() => {
    const amount = Number(principal);
    const count = Number(months);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (!Number.isInteger(count) || count < 1) return null;
    return Math.round((amount / count) * 100) / 100;
  })();

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const created = await payrollApi.createLending(copy.kind, {
        staffId: Number(staffId),
        principal: Number(principal),
        ...(copy.instalmentField !== undefined && instalment !== ''
          ? { monthlyInstalment: Number(instalment) }
          : {}),
        months: Number(months),
        issuedOn,
        startsOn,
        reason,
        note,
      });
      await onDone(`Ansuran RM${created.instalment.toFixed(2)} disimpan.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k={copy.formTitle} />}
      titleText={t(copy.formTitle)}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <Field
          label={<T k={copy.formStaff} />}
          type="number"
          inputMode="numeric"
          value={staffId}
          placeholder={t('pay.form.staffPlaceholder')}
          onChange={(event) => setStaffId(event.target.value)}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k={copy.formPrincipal} />}
            type="number"
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
        </div>

        {copy.instalmentField !== undefined && (
          <Field
            label={<T k={copy.instalmentField.label} />}
            hint={<T k={copy.instalmentField.hint} />}
            type="number"
            step="0.01"
            min={0}
            value={instalment}
            onChange={(event) => setInstalment(event.target.value)}
          />
        )}

        {copy.previewLabel !== undefined && derived !== null && (
          <PanelNote>
            <T k={copy.previewLabel} vars={{ amount: derived.toFixed(2) }} />
          </PanelNote>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k={copy.formIssuedOn} />}
            type="date"
            value={issuedOn}
            onChange={(event) => setIssuedOn(event.target.value)}
          />
          <Field
            label={<T k={copy.formStartsOn} />}
            hint={copy.formStartsOnHint === undefined ? undefined : <T k={copy.formStartsOnHint} />}
            type="date"
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
          />
        </div>

        <Field
          label={<T k={copy.formReason} />}
          value={reason}
          maxLength={190}
          onChange={(event) => setReason(event.target.value)}
        />

        <Field
          label={<T k={copy.formNote} />}
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={
            staffId.trim() === '' ||
            principal.trim() === '' ||
            months.trim() === '' ||
            issuedOn === '' ||
            startsOn === ''
          }
          submitLabel={<T k="dialog.save" />}
        />
      </div>
    </Dialog>
  );
}

function DecisionDialog({
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
  const [choice, setChoice] = useState<'approve' | 'cancel'>(
    row.status === 'pending' ? 'approve' : 'cancel',
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const titleKey: LabelKey =
    choice === 'approve' ? 'pay.lending.approve.title' : 'pay.lending.cancel.title';
  const bodyKey: LabelKey =
    choice === 'approve' ? 'pay.lending.approve.body' : 'pay.lending.cancel.body';
  const submitKey: LabelKey =
    choice === 'approve' ? 'pay.lending.approve.submit' : 'pay.lending.cancel.submit';

  return (
    <Dialog
      title={<T k={titleKey} vars={{ reference: row.reference }} />}
      titleText={`${t(titleKey)} ${row.reference}`}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {row.status === 'pending' && (
          <div className="flex gap-2">
            <Button
              variant={choice === 'approve' ? 'primary' : 'ghost'}
              onClick={() => setChoice('approve')}
            >
              <T k="pay.lending.approve.submit" />
            </Button>
            <Button
              variant={choice === 'cancel' ? 'primary' : 'ghost'}
              onClick={() => setChoice('cancel')}
            >
              <T k="pay.lending.cancel.submit" />
            </Button>
          </div>
        )}

        <PanelNote
          tone={choice === 'cancel' ? 'danger' : 'info'}
          icon={<TriangleAlert className="size-3.5" aria-hidden />}
        >
          <T k={bodyKey} />
        </PanelNote>

        {row.paidInstalments > 0 && choice === 'cancel' && (
          <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="pay.lending.locked" />
          </PanelNote>
        )}

        <Field
          label={<T k="pay.award.note" />}
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />

        <DialogFooter
          onClose={onClose}
          busy={busy}
          disabled={choice === 'cancel' && row.paidInstalments > 0}
          onSubmit={() => {
            setBusy(true);
            void payrollApi
              .decideLending(copy.kind, row.id, { action: choice, note })
              .then((result) => onDone(`${row.reference}: ${result.status}.`))
              .catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : null);
                setBusy(false);
              });
          }}
          submitLabel={<T k={submitKey} />}
        />
      </div>
    </Dialog>
  );
}

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

  return (
    <Dialog
      title={<T k="pay.lending.remove.title" vars={{ reference: row.reference }} />}
      titleText={`${t('pay.lending.remove.title')} ${row.reference}`}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />
        <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
          <T k="pay.lending.remove.body" />
        </PanelNote>
        <DialogFooter
          onClose={onClose}
          busy={busy}
          onSubmit={() => {
            setBusy(true);
            void payrollApi
              .removeLending(copy.kind, row.id)
              .then(() => onDone(`${row.reference} dibuang.`))
              .catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : null);
                setBusy(false);
              });
          }}
          submitLabel={<T k="app.remove" />}
        />
      </div>
    </Dialog>
  );
}
