import type { LabelKey } from '@attendance/shared';
import { Gift, Pencil, Plus, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { kpiApi, type KpiPeriod } from '../lib/kpi-api';
import { formatDateOnly, todayIso } from '../lib/operations-api';
import {
  BONUS_TYPE_LABELS,
  COMMISSION_TYPE_LABELS,
  RECORD_STATE_LABELS,
  payrollApi,
  type AwardPage,
  type AwardRow,
  type PayrollPeriod,
} from '../lib/payroll-api';
import { T, TEnum, useLabels } from '../lib/translation';
import { SelectControl } from './ChannelForm';
import { Dialog, DialogFooter, Feedback } from './Dialog';
import {
  ChipBar,
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
} from './RecordPanel';
import { Badge, Button, Field } from './ui';

/**
 * Bonuses and commissions, which are the same screen with different words on it.
 *
 * Shared as a component rather than merged into one route: they carry separate permission keys,
 * because they are granted by different people for different reasons. A single screen would have
 * to pick one key to check, and whichever it picked would hand over the other for free.
 *
 * The wording is passed in as label keys, so the two screens cannot drift into saying "bonus"
 * where the other says "komisen".
 */
export interface AwardCopy {
  kind: 'bonuses' | 'commissions';
  screen: 'hr.bonuses' | 'hr.commissions';
  title: LabelKey;
  subtitle: LabelKey;
  add: LabelKey;
  empty: LabelKey;
  errorLoad: LabelKey;
  formTitle: LabelKey;
  formEdit: LabelKey;
  formStaff: LabelKey;
  formKind: LabelKey;
  formName: LabelKey;
  formAmount: LabelKey;
  formDate: LabelKey;
  formPeriod: LabelKey;
  formNote: LabelKey;
  columnReference: LabelKey;
  columnStaff: LabelKey;
  columnKind: LabelKey;
  columnName: LabelKey;
  columnAmount: LabelKey;
  columnDate: LabelKey;
  columnPeriod: LabelKey;
  kinds: readonly string[];
  kindLabels: Record<string, LabelKey>;
  /** Only bonuses can be generated from appraisals, so this is optional. */
  generate?: boolean;
}

export const BONUS_COPY: AwardCopy = {
  kind: 'bonuses',
  screen: 'hr.bonuses',
  title: 'pay.bonus.title',
  subtitle: 'pay.bonus.subtitle',
  add: 'pay.bonus.action.add',
  empty: 'pay.bonus.empty',
  errorLoad: 'pay.bonus.error.load',
  formTitle: 'pay.bonus.form.title',
  formEdit: 'pay.bonus.form.edit',
  formStaff: 'pay.bonus.form.staff',
  formKind: 'pay.bonus.form.kind',
  formName: 'pay.bonus.form.name',
  formAmount: 'pay.bonus.form.amount',
  formDate: 'pay.bonus.form.date',
  formPeriod: 'pay.bonus.form.period',
  formNote: 'pay.bonus.form.note',
  columnReference: 'pay.bonus.column.reference',
  columnStaff: 'pay.bonus.column.staff',
  columnKind: 'pay.bonus.column.kind',
  columnName: 'pay.bonus.column.name',
  columnAmount: 'pay.bonus.column.amount',
  columnDate: 'pay.bonus.column.date',
  columnPeriod: 'pay.bonus.column.period',
  kinds: ['performance', 'annual', 'festival', 'project', 'attendance', 'other'],
  kindLabels: BONUS_TYPE_LABELS,
  generate: true,
};

export const COMMISSION_COPY: AwardCopy = {
  kind: 'commissions',
  screen: 'hr.commissions',
  title: 'pay.commission.title',
  subtitle: 'pay.commission.subtitle',
  add: 'pay.commission.action.add',
  empty: 'pay.commission.empty',
  errorLoad: 'pay.commission.error.load',
  formTitle: 'pay.commission.form.title',
  formEdit: 'pay.commission.form.edit',
  formStaff: 'pay.commission.form.staff',
  formKind: 'pay.commission.form.kind',
  formName: 'pay.commission.form.name',
  formAmount: 'pay.commission.form.amount',
  formDate: 'pay.commission.form.date',
  formPeriod: 'pay.commission.form.period',
  formNote: 'pay.commission.form.note',
  columnReference: 'pay.commission.column.reference',
  columnStaff: 'pay.commission.column.staff',
  columnKind: 'pay.commission.column.kind',
  columnName: 'pay.commission.column.name',
  columnAmount: 'pay.commission.column.amount',
  columnDate: 'pay.commission.column.date',
  columnPeriod: 'pay.commission.column.period',
  kinds: ['sales', 'project', 'referral', 'other'],
  kindLabels: COMMISSION_TYPE_LABELS,
};

export function AwardsPanel({ copy }: { copy: AwardCopy }): ReactNode {
  const [data, setData] = useState<AwardPage | null>(null);
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AwardRow | null>(null);
  const [deciding, setDeciding] = useState<{ row: AwardRow; action: 'approve' | 'cancel' } | null>(
    null,
  );
  const [removing, setRemoving] = useState<AwardRow | null>(null);
  const [generating, setGenerating] = useState(false);
  const { t } = useLabels();
  const { can } = useAuth();

  useEffect(() => {
    void payrollApi
      .periods()
      .then((result) => setPeriods(result.rows))
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await payrollApi.awards(copy.kind, {
          page,
          pageSize,
          search: search === '' ? undefined : search,
          status: status === '' ? undefined : status,
          periodId: periodId === '' ? undefined : Number(periodId),
        }),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(copy.errorLoad));
    } finally {
      setLoading(false);
    }
  }, [copy.kind, copy.errorLoad, page, pageSize, search, status, periodId, t]);

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
        id: 'approved',
        label: <T k="pay.state.approved" />,
        count: counts.approved ?? 0,
        dot: 'bg-sky-400',
      },
      {
        id: 'paid',
        label: <T k="pay.state.paid" />,
        count: counts.paid ?? 0,
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
        icon={<Gift className="size-4" aria-hidden />}
        title={<T k={copy.title} />}
        action={
          can(copy.screen, 'create') ? (
            <div className="flex gap-2">
              {copy.generate === true && (
                <Button variant="ghost" onClick={() => setGenerating(true)}>
                  <Sparkles className="size-4" aria-hidden />
                  <T k="pay.bonus.action.generate" />
                </Button>
              )}
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden />
                <T k={copy.add} />
              </Button>
            </div>
          ) : undefined
        }
      />

      <PanelBody className="pb-0">
        <Feedback error={error} notice={notice} />
      </PanelBody>

      <ChipBar chips={chips} active={status} onChange={(id) => { setStatus(id ?? ''); setPage(1); }} />

      <FilterRow
        search={search}
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        dirty={search !== '' || status !== '' || periodId !== ''}
        onReset={() => {
          setSearch('');
          setStatus('');
          setPeriodId('');
          setPage(1);
        }}
      >
        <FacetSelect
          label={t('pay.filter.period')}
          value={periodId}
          onChange={(value) => {
            setPeriodId(value);
            setPage(1);
          }}
          options={periods.map((row) => ({
            value: String(row.id),
            label: `${row.code} — ${row.name}`,
          }))}
        />
      </FilterRow>

      <RecordTable
        loading={loading}
        rowCount={rows.length}
        empty={<T k={copy.empty} />}
        columns={[
          { header: <T k={copy.columnReference} />, width: 'w-36' },
          { header: <T k={copy.columnStaff} /> },
          { header: <T k={copy.columnKind} />, width: 'w-28' },
          { header: <T k={copy.columnName} /> },
          { header: <T k={copy.columnAmount} />, width: 'w-28', align: 'right' },
          { header: <T k={copy.columnDate} />, width: 'w-28' },
          { header: <T k={copy.columnPeriod} />, width: 'w-28' },
          { header: <T k="panel.column.status" />, width: 'w-24' },
          { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <tr
            key={row.id}
            className={cn(
              'border-b border-slate-100 hover:bg-slate-50/70',
              row.status === 'cancelled' && 'text-slate-400',
              // Approved with no period is money nobody will pay: the run reads by period.
              row.status === 'approved' && row.periodId === null && 'bg-rose-50/40',
              row.status === 'pending' && 'bg-amber-50/40',
            )}
          >
            <td className="px-5 py-2 font-mono text-xs text-slate-700">{row.reference}</td>
            <td className="px-2 py-2">
              <p className="text-slate-800">{row.fullName}</p>
              <p className="text-xs text-slate-500">{row.employeeNo}</p>
            </td>
            <td className="px-2 py-2 text-xs text-slate-600">
              <TEnum k={copy.kindLabels[row.kind]} fallback={row.kind} />
            </td>
            <td className="px-2 py-2 text-sm text-slate-700">
              {row.name}
              {row.fromAppraisal && (
                <span className="ml-2 text-xs text-slate-500">
                  <T k="pay.bonus.fromAppraisal" />
                </span>
              )}
            </td>
            <td className="px-2 py-2 text-right text-xs font-medium tabular-nums text-slate-800">
              {row.amount.toFixed(2)}
            </td>
            <td className="px-2 py-2 text-xs whitespace-nowrap tabular-nums text-slate-600">
              {formatDateOnly(row.onDate)}
            </td>
            <td className="px-2 py-2 font-mono text-xs text-slate-600">
              {row.periodCode ?? (
                <span className="font-sans text-rose-600">
                  <T k="pay.bonus.noPeriod" />
                </span>
              )}
            </td>
            <td className="px-2 py-2">
              <Badge
                tone={
                  row.status === 'paid'
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
                {can(copy.screen, 'approve') && row.status === 'pending' && (
                  <RowAction
                    icon={<Sparkles className="size-4" aria-hidden />}
                    label={t('pay.action.decide')}
                    tone="success"
                    onClick={() => setDeciding({ row, action: 'approve' })}
                  />
                )}
                {can(copy.screen, 'edit') && (
                  <RowAction
                    icon={<Pencil className="size-4" aria-hidden />}
                    label={row.status === 'pending' ? t('pay.action.edit') : t('pay.award.locked')}
                    tone="edit"
                    disabled={row.status !== 'pending'}
                    onClick={() => setEditing(row)}
                  />
                )}
                {can(copy.screen, 'delete') && (
                  <RowAction
                    icon={<Trash2 className="size-4" aria-hidden />}
                    label={
                      row.status === 'pending' || row.status === 'cancelled'
                        ? t('pay.action.remove')
                        : t('pay.award.remove.body')
                    }
                    tone="danger"
                    disabled={row.status !== 'pending' && row.status !== 'cancelled'}
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

      {(creating || editing !== null) && (
        <AwardDialog
          copy={copy}
          periods={periods}
          target={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onDone={async (message) => {
            setCreating(false);
            setEditing(null);
            setNotice(message);
            await load();
          }}
        />
      )}

      {deciding !== null && (
        <DecisionDialog
          copy={copy}
          row={deciding.row}
          action={deciding.action}
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

      {generating && (
        <GenerateDialog
          periods={periods}
          onClose={() => setGenerating(false)}
          onDone={async (message) => {
            setGenerating(false);
            setNotice(message);
            await load();
          }}
        />
      )}
    </PanelCard>
  );
}

function AwardDialog({
  copy,
  periods,
  target,
  onClose,
  onDone,
}: {
  copy: AwardCopy;
  periods: PayrollPeriod[];
  target?: AwardRow;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  // Only periods still open to change can take an award: past that, the run that would have
  // collected it has already happened.
  const open = periods.filter((row) => row.status === 'draft' || row.status === 'processing');
  const [staffId, setStaffId] = useState(target === undefined ? '' : String(target.staffId));
  const [kind, setKind] = useState(target?.kind ?? copy.kinds[0] ?? 'other');
  const [name, setName] = useState(target?.name ?? '');
  const [amount, setAmount] = useState(target === undefined ? '' : String(target.amount));
  const [onDate, setOnDate] = useState(target?.onDate ?? todayIso());
  const [periodId, setPeriodId] = useState(
    target?.periodId === null || target?.periodId === undefined ? '' : String(target.periodId),
  );
  const [note, setNote] = useState(target?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const input = {
        kind,
        name,
        amount: Number(amount),
        onDate,
        periodId: periodId === '' ? null : Number(periodId),
        note,
      };
      if (target === undefined) {
        await payrollApi.createAward(copy.kind, { ...input, staffId: Number(staffId) });
      } else {
        await payrollApi.updateAward(copy.kind, target.id, input);
      }
      await onDone(`${name} disimpan.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  const titleKey = target === undefined ? copy.formTitle : copy.formEdit;

  return (
    <Dialog title={<T k={titleKey} />} titleText={t(titleKey)} width="lg" onClose={onClose}>
      <div className="space-y-4">
        <Feedback error={error} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k={copy.formStaff} />}
            type="number"
            inputMode="numeric"
            value={staffId}
            disabled={target !== undefined}
            placeholder={t('pay.form.staffPlaceholder')}
            onChange={(event) => setStaffId(event.target.value)}
          />
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-700">
              <T k={copy.formKind} />
            </p>
            <SelectControl
              label={t(copy.formKind)}
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              {copy.kinds.map((value) => {
                const label = copy.kindLabels[value];
                return (
                  <option key={value} value={value}>
                    {label === undefined ? value : t(label)}
                  </option>
                );
              })}
            </SelectControl>
          </div>
        </div>

        <Field
          label={<T k={copy.formName} />}
          value={name}
          maxLength={190}
          onChange={(event) => setName(event.target.value)}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k={copy.formAmount} />}
            type="number"
            step="0.01"
            min={0}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <Field
            label={<T k={copy.formDate} />}
            type="date"
            value={onDate}
            onChange={(event) => setOnDate(event.target.value)}
          />
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-700">
            <T k={copy.formPeriod} />
          </p>
          <SelectControl
            label={t(copy.formPeriod)}
            value={periodId}
            onChange={(event) => setPeriodId(event.target.value)}
          >
            <option value="">{t('pay.form.periodNone')}</option>
            {open.map((row) => (
              <option key={row.id} value={String(row.id)}>
                {`${row.code} — ${row.name}`}
              </option>
            ))}
          </SelectControl>
          <p className="text-xs text-slate-500">
            <T k="pay.bonus.form.period.hint" />
          </p>
        </div>

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
            (target === undefined && staffId.trim() === '') ||
            name.trim() === '' ||
            amount.trim() === '' ||
            onDate === ''
          }
          submitLabel={<T k="dialog.save" />}
        />
      </div>
    </Dialog>
  );
}

/**
 * Approve or cancel.
 *
 * One dialog with two modes, because the act is symmetrical and the consequence is not: approval
 * makes the figure payable and freezes it, cancellation stops it being paid at all.
 */
function DecisionDialog({
  copy,
  row,
  action,
  onClose,
  onDone,
}: {
  copy: AwardCopy;
  row: AwardRow;
  action: 'approve' | 'cancel';
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [choice, setChoice] = useState<'approve' | 'cancel'>(action);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const titleKey: LabelKey =
    choice === 'approve' ? 'pay.award.approve.title' : 'pay.award.cancel.title';
  const bodyKey: LabelKey =
    choice === 'approve' ? 'pay.award.approve.body' : 'pay.award.cancel.body';
  const submitKey: LabelKey =
    choice === 'approve' ? 'pay.award.approve.submit' : 'pay.award.cancel.submit';

  return (
    <Dialog
      title={<T k={titleKey} vars={{ reference: row.reference }} />}
      titleText={`${t(titleKey)} ${row.reference}`}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <div className="flex gap-2">
          <Button
            variant={choice === 'approve' ? 'primary' : 'ghost'}
            onClick={() => setChoice('approve')}
          >
            <T k="pay.award.approve.submit" />
          </Button>
          <Button
            variant={choice === 'cancel' ? 'primary' : 'ghost'}
            onClick={() => setChoice('cancel')}
          >
            <T k="pay.award.cancel.submit" />
          </Button>
        </div>

        <PanelNote
          tone={choice === 'cancel' ? 'danger' : 'info'}
          icon={<TriangleAlert className="size-3.5" aria-hidden />}
        >
          <T k={bodyKey} />
        </PanelNote>

        <Field
          label={<T k="pay.award.note" />}
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />

        <DialogFooter
          onClose={onClose}
          busy={busy}
          onSubmit={() => {
            setBusy(true);
            void payrollApi
              .decideAward(copy.kind, row.id, { action: choice, note })
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
  copy: AwardCopy;
  row: AwardRow;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  return (
    <Dialog
      title={<T k="pay.award.remove.title" vars={{ reference: row.reference }} />}
      titleText={`${t('pay.award.remove.title')} ${row.reference}`}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />
        <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
          <T k="pay.award.remove.body" />
        </PanelNote>
        <DialogFooter
          onClose={onClose}
          busy={busy}
          onSubmit={() => {
            setBusy(true);
            void payrollApi
              .removeAward(copy.kind, row.id)
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

/**
 * Turns finalised appraisals into pending bonus rows.
 *
 * Pending, not approved. A KPI grade carrying a bonus factor produces a row somebody still has to
 * sign, which is the difference between a bonus HR can withhold or reschedule and a figure that
 * appears from nowhere on payday.
 */
function GenerateDialog({
  periods,
  onClose,
  onDone,
}: {
  periods: PayrollPeriod[];
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const open = periods.filter((row) => row.status === 'draft' || row.status === 'processing');
  const [kpiPeriods, setKpiPeriods] = useState<KpiPeriod[]>([]);
  const [kpiPeriodId, setKpiPeriodId] = useState('');
  const [periodId, setPeriodId] = useState(open[0] === undefined ? '' : String(open[0].id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  useEffect(() => {
    void kpiApi
      .periods()
      .then((rows) => {
        // Only closed cycles: an open one is still being scored, so a bonus from it would be
        // generated against grades that have not settled.
        const closed = rows.filter((row) => row.status === 'closed');
        setKpiPeriods(closed);
        const first = closed[0];
        if (first !== undefined) setKpiPeriodId(String(first.id));
      })
      .catch(() => undefined);
  }, []);

  return (
    <Dialog
      title={<T k="pay.bonus.generate.title" />}
      titleText={t('pay.bonus.generate.title')}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <PanelNote icon={<Sparkles className="size-3.5" aria-hidden />}>
          <T k="pay.bonus.generate.body" />
        </PanelNote>

        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-700">
            <T k="pay.bonus.generate.kpiPeriod" />
          </p>
          <SelectControl
            label={t('pay.bonus.generate.kpiPeriod')}
            value={kpiPeriodId}
            onChange={(event) => setKpiPeriodId(event.target.value)}
          >
            {kpiPeriods.map((row) => (
              <option key={row.id} value={String(row.id)}>
                {`${row.code} — ${row.name}`}
              </option>
            ))}
          </SelectControl>
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-700">
            <T k="pay.bonus.generate.period" />
          </p>
          <SelectControl
            label={t('pay.bonus.generate.period')}
            value={periodId}
            onChange={(event) => setPeriodId(event.target.value)}
          >
            {open.map((row) => (
              <option key={row.id} value={String(row.id)}>
                {`${row.code} — ${row.name}`}
              </option>
            ))}
          </SelectControl>
        </div>

        <DialogFooter
          onClose={onClose}
          busy={busy}
          disabled={kpiPeriodId === '' || periodId === ''}
          onSubmit={() => {
            setBusy(true);
            void payrollApi
              .generateFromAppraisals({
                kpiPeriodId: Number(kpiPeriodId),
                periodId: Number(periodId),
              })
              .then((result) =>
                onDone(
                  t('pay.bonus.generate.done', {
                    created: result.created,
                    existing: result.skippedExisting,
                    noGrade: result.skippedNoGrade,
                    noSalary: result.skippedNoSalary,
                  }),
                ),
              )
              .catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : null);
                setBusy(false);
              });
          }}
          submitLabel={<T k="pay.bonus.generate.submit" />}
        />
      </div>
    </Dialog>
  );
}
