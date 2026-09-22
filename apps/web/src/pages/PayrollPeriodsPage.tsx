import type { LabelKey } from '@attendance/shared';
import {
  Banknote,
  CircleAlert,
  CircleCheck,
  Download,
  FileText,
  Play,
  Plus,
  SquareCheck,
  Trash2,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import { SelectControl } from '../components/ChannelForm';
import {
  ChipBar,
  Detail,
  DetailGrid,
  FacetSelect,
  FilterRow,
  PanelBody,
  PanelCard,
  PanelFooter,
  PanelNote,
  PanelSection,
  PanelTabs,
  RecordTable,
  RowAction,
  RowActions,
} from '../components/RecordPanel';
import { Badge, Button, Field, StatTile } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { formatRinggit } from '../lib/claims-api';
import { formatDateOnly, lookupsApi, type Lookups } from '../lib/operations-api';
import {
  BALANCE_FAULT_LABELS,
  PAYMENT_METHOD_LABELS,
  PERIOD_STATUS_LABELS,
  RECORD_STATE_LABELS,
  payrollApi,
  type PayrollPeriod,
  type PaymentMethod,
  type PayslipDetail,
  type PayslipPage,
  type PeriodPage,
  type RunResult,
} from '../lib/payroll-api';
import { T, TEnum, useLabels } from '../lib/translation';

const SCREEN = 'hr.payrollPeriods';

/**
 * Payroll periods, and the payslips under them.
 *
 * Two tabs on one screen because they are one subject read two ways: a period is the batch, a
 * payslip is one person's share of it, and separating them into two sidebar entries would ask
 * somebody to know which one holds the number they are after.
 *
 * The status ladder is one way. A draft may be processed as often as needed — that is what makes
 * a corrected terminal clock or a repaired identity mapping reachable — and from `approved`
 * onwards the figures are the record. Stated on the screen, not only enforced in the route.
 */
export function PayrollPeriodsPage(): ReactNode {
  const [tab, setTab] = useState<'periods' | 'payslips'>('periods');
  const { t } = useLabels();

  return (
    <PanelCard title={<T k="pay.period.title" />} subtitle={<T k="pay.period.subtitle" />}>
      <PanelTabs
        label={t('pay.period.title')}
        active={tab}
        onChange={(next) => setTab(next as 'periods' | 'payslips')}
        tabs={[
          {
            id: 'periods',
            label: <T k="pay.period.tab.periods" />,
            labelText: t('pay.period.tab.periods'),
          },
          {
            id: 'payslips',
            label: <T k="pay.period.tab.payslips" />,
            labelText: t('pay.period.tab.payslips'),
          },
        ]}
      />
      {tab === 'periods' ? <PeriodsTab /> : <PayslipsTab />}
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

type Action = 'process' | 'approve' | 'pay' | 'close' | 'remove';

function PeriodsTab(): ReactNode {
  const [data, setData] = useState<PeriodPage | null>(null);
  const [status, setStatus] = useState('');
  const [year, setYear] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PayrollPeriod | null>(null);
  const [acting, setActing] = useState<{ row: PayrollPeriod; action: Action } | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await payrollApi.periods({
          status: status === '' ? undefined : status,
          year: year === '' ? undefined : Number(year),
        }),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('pay.period.error.load'));
    } finally {
      setLoading(false);
    }
  }, [status, year, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];
  const counts = data?.counts ?? {};

  /*
   * Chip counts ignore the status filter.
   *
   * Otherwise picking one chip zeroes every other and the rows that remain look like they went
   * missing. A chip at zero is information; the chip bar disables it rather than hiding it.
   */
  const chips = useMemo(
    () => [
      {
        id: '',
        label: <T k="pay.chip.all" />,
        count: Object.values(counts).reduce((sum, value) => sum + value, 0),
        dot: 'bg-slate-300',
      },
      {
        id: 'draft',
        label: <T k="pay.status.draft" />,
        count: counts.draft ?? 0,
        dot: 'bg-amber-400',
      },
      {
        id: 'processing',
        label: <T k="pay.status.processing" />,
        count: counts.processing ?? 0,
        dot: 'bg-orange-400',
      },
      {
        id: 'approved',
        label: <T k="pay.status.approved" />,
        count: counts.approved ?? 0,
        dot: 'bg-sky-400',
      },
      {
        id: 'paid',
        label: <T k="pay.status.paid" />,
        count: counts.paid ?? 0,
        dot: 'bg-emerald-400',
      },
      {
        id: 'closed',
        label: <T k="pay.status.closed" />,
        count: counts.closed ?? 0,
        dot: 'bg-slate-400',
      },
    ],
    [counts],
  );

  const totals = rows.reduce(
    (running, row) => ({
      gross: running.gross + row.totalGross,
      net: running.net + row.totalNet,
      employer: running.employer + row.totalEmployerCost,
    }),
    { gross: 0, net: 0, employer: 0 },
  );

  const years = useMemo(() => {
    const now = new Date().getFullYear();
    return [now + 1, now, now - 1, now - 2].map((value) => ({
      value: String(value),
      label: String(value),
    }));
  }, []);

  return (
    <>
      <PanelSection
        icon={<Banknote className="size-4" aria-hidden />}
        title={<T k="pay.period.title" />}
        action={
          can(SCREEN, 'create') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              <T k="pay.period.action.add" />
            </Button>
          ) : undefined
        }
      />

      <PanelBody className="grid gap-3 pb-0 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={<T k="pay.period.stat.periods" />}
          value={String(rows.length)}
          hint={<T k="pay.period.stat.periods.hint" vars={{ draft: counts.draft ?? 0 }} />}
        />
        <StatTile
          label={<T k="pay.period.stat.gross" />}
          value={formatRinggit(totals.gross)}
          hint={<T k="pay.period.stat.gross.hint" />}
        />
        <StatTile
          label={<T k="pay.period.stat.net" />}
          value={formatRinggit(totals.net)}
          hint={<T k="pay.period.stat.net.hint" />}
        />
        <StatTile
          label={<T k="pay.period.stat.employer" />}
          value={formatRinggit(totals.employer)}
          hint={<T k="pay.period.stat.employer.hint" />}
        />
      </PanelBody>

      <PanelBody className="space-y-2 pb-0">
        <Feedback error={error} notice={notice} />

        {/*
          The unverified-rates warning, first and in amber.
          Seeded statutory rates look identical to rates finance signed off, and the difference
          is every deduction in the period. It links to where the confirmation happens.
        */}
        {data !== null && !data.ratesReviewed && (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="pay.period.note.unreviewed" />{' '}
            <Link className="font-medium underline" to="/hr/payroll/tetapan">
              <T k="pay.period.note.reviewLink" />
            </Link>
          </PanelNote>
        )}

        <PanelNote icon={<CircleAlert className="size-3.5" aria-hidden />}>
          <T k="pay.period.note.oneWay" />
        </PanelNote>
      </PanelBody>

      <ChipBar chips={chips} active={status} onChange={(id) => setStatus(id ?? '')} />

      <FilterRow dirty={status !== '' || year !== ''} onReset={() => { setStatus(''); setYear(''); }}>
        <FacetSelect
          label={t('pay.period.filter.year')}
          value={year}
          onChange={setYear}
          options={years}
        />
      </FilterRow>

      <RecordTable
        loading={loading}
        rowCount={rows.length}
        empty={<T k="pay.period.empty" />}
        columns={[
          { header: <T k="pay.period.column.code" />, width: 'w-24' },
          { header: <T k="pay.period.form.name" /> },
          { header: <T k="pay.period.column.range" />, width: 'w-48' },
          { header: <T k="pay.period.column.payment" />, width: 'w-28' },
          { header: <T k="pay.period.column.staff" />, width: 'w-16', align: 'right' },
          { header: <T k="pay.period.column.gross" />, width: 'w-28', align: 'right' },
          { header: <T k="pay.period.column.deductions" />, width: 'w-28', align: 'right' },
          { header: <T k="pay.period.column.net" />, width: 'w-28', align: 'right' },
          { header: <T k="panel.column.status" />, width: 'w-28' },
          { header: <T k="panel.column.actions" />, width: 'w-44', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <tr
            key={row.id}
            className={cn(
              'border-b border-slate-100 hover:bg-slate-50/70',
              row.status === 'closed' && 'text-slate-400',
              // A draft is the row somebody still has to act on.
              row.status === 'draft' && 'bg-amber-50/40',
            )}
          >
            <td className="px-5 py-2 font-mono text-xs text-slate-700">{row.code}</td>
            <td className="px-2 py-2 text-slate-800">{row.name}</td>
            <td className="px-2 py-2 text-xs whitespace-nowrap tabular-nums text-slate-600">
              <T
                k="pay.period.range"
                vars={{ from: formatDateOnly(row.fromDate), to: formatDateOnly(row.toDate) }}
              />
            </td>
            <td className="px-2 py-2 text-xs whitespace-nowrap tabular-nums text-slate-600">
              {formatDateOnly(row.paymentDate)}
            </td>
            <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-700">
              {row.payslipCount}
            </td>
            <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-700">
              {row.totalGross.toFixed(2)}
            </td>
            <td className="px-2 py-2 text-right text-xs tabular-nums text-rose-700">
              {row.totalDeductions.toFixed(2)}
            </td>
            <td className="px-2 py-2 text-right text-xs font-medium tabular-nums text-slate-800">
              {row.totalNet.toFixed(2)}
            </td>
            <td className="px-2 py-2">
              <Badge tone={badgeTone(row.status)}>
                <span className="uppercase">
                  <T k={PERIOD_STATUS_LABELS[row.status]} />
                </span>
              </Badge>
            </td>
            <td className="px-2 py-2 pr-4">
              <RowActions>
                {/*
                  Each transition appears only on the status that permits it, and a destructive
                  or irreversible one is disabled with the reason in its tooltip rather than
                  offered and refused by the server.
                */}
                {can(SCREEN, 'approve') && (
                  <>
                    {row.status === 'draft' && (
                      <RowAction
                        icon={<Play className="size-4" aria-hidden />}
                        label={t('pay.period.action.process')}
                        tone="success"
                        onClick={() => setActing({ row, action: 'process' })}
                      />
                    )}
                    {row.status === 'processing' && (
                      <RowAction
                        icon={<SquareCheck className="size-4" aria-hidden />}
                        // Disabled controls carry the reason as their name, so the tooltip
                        // says why rather than repeating an action that will not happen.
                        label={
                          row.payslipCount === 0
                            ? t('pay.period.note.processFirst')
                            : t('pay.period.action.approve')
                        }
                        tone="warn"
                        disabled={row.payslipCount === 0}
                        onClick={() => setActing({ row, action: 'approve' })}
                      />
                    )}
                    {row.status === 'approved' && (
                      <RowAction
                        icon={<Wallet className="size-4" aria-hidden />}
                        label={t('pay.period.action.pay')}
                        tone="warn"
                        onClick={() => setActing({ row, action: 'pay' })}
                      />
                    )}
                    {row.status === 'paid' && (
                      <RowAction
                        icon={<CircleCheck className="size-4" aria-hidden />}
                        label={t('pay.period.action.close')}
                        tone="warn"
                        onClick={() => setActing({ row, action: 'close' })}
                      />
                    )}
                  </>
                )}

                {can(SCREEN, 'export') && row.payslipCount > 0 && (
                  <a
                    className="inline-flex size-7 items-center justify-center rounded-md text-blue-600 hover:bg-blue-50"
                    href={payrollApi.exportUrl(row.id)}
                    title={t('pay.period.action.export')}
                    aria-label={t('pay.period.action.export')}
                  >
                    <Download className="size-4" aria-hidden />
                  </a>
                )}

                {can(SCREEN, 'edit') && row.status === 'draft' && (
                  <RowAction
                    icon={<FileText className="size-4" aria-hidden />}
                    label={t('pay.action.edit')}
                    onClick={() => setEditing(row)}
                  />
                )}

                {can(SCREEN, 'delete') && (
                  <RowAction
                    icon={<Trash2 className="size-4" aria-hidden />}
                    label={
                      row.status === 'draft'
                        ? t('pay.period.action.remove')
                        : t('pay.period.note.notDraft')
                    }
                    tone="danger"
                    disabled={row.status !== 'draft'}
                    onClick={() => setActing({ row, action: 'remove' })}
                  />
                )}
              </RowActions>
            </td>
          </tr>
        ))}
      </RecordTable>

      {/* Not paginated: a payroll cycle is monthly, so a year is twelve rows and the year
          filter is the only narrowing that helps. */}
      <PanelFooter
        shown={rows.length}
        total={rows.length}
        page={1}
        pageSize={rows.length === 0 ? 1 : rows.length}
        generatedAt={data?.generatedAt}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => void load()}
      />

      {creating && (
        <PeriodDialog
          payDay={data?.payDay ?? 25}
          onClose={() => setCreating(false)}
          onDone={async (message) => {
            setCreating(false);
            setNotice(message);
            await load();
          }}
        />
      )}

      {editing !== null && (
        <PeriodDialog
          payDay={data?.payDay ?? 25}
          target={editing}
          onClose={() => setEditing(null)}
          onDone={async (message) => {
            setEditing(null);
            setNotice(message);
            await load();
          }}
        />
      )}

      {acting !== null && (
        <ActionDialog
          row={acting.row}
          action={acting.action}
          onClose={() => setActing(null)}
          onDone={async (message) => {
            setActing(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </>
  );
}

function badgeTone(status: string): 'success' | 'warning' | 'neutral' | 'danger' {
  if (status === 'paid') return 'success';
  if (status === 'draft') return 'warning';
  if (status === 'processing' || status === 'approved') return 'warning';
  return 'neutral';
}

/**
 * Create or edit a period.
 *
 * The month and the range are separate fields on purpose. The month names the cycle and sorts
 * the list; the range decides which days are paid. A 26th-to-25th cycle is ordinary, and deriving
 * the range from the month would pay the wrong days for everybody on one.
 */
function PeriodDialog({
  payDay,
  target,
  onClose,
  onDone,
}: {
  payDay: number;
  target?: PayrollPeriod;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const now = new Date();
  const [name, setName] = useState(target?.name ?? '');
  const [periodYear, setPeriodYear] = useState(String(target?.periodYear ?? now.getFullYear()));
  const [periodMonth, setPeriodMonth] = useState(
    String(target?.periodMonth ?? now.getMonth() + 1),
  );
  const [fromDate, setFromDate] = useState(target?.fromDate ?? '');
  const [toDate, setToDate] = useState(target?.toDate ?? '');
  const [paymentDate, setPaymentDate] = useState(target?.paymentDate ?? '');
  const [note, setNote] = useState(target?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  /*
   * Defaults the calendar month and the configured pay day.
   *
   * A suggestion, not a constraint: the fields stay editable, because the whole reason the range
   * is separate from the month is that not every cycle follows one.
   */
  useEffect(() => {
    if (target !== undefined) return;
    const year = Number(periodYear);
    const month = Number(periodMonth);
    if (!Number.isInteger(year) || !Number.isInteger(month)) return;
    const pad = (value: number): string => String(value).padStart(2, '0');
    const last = new Date(year, month, 0).getDate();
    setFromDate(`${String(year)}-${pad(month)}-01`);
    setToDate(`${String(year)}-${pad(month)}-${pad(last)}`);
    setPaymentDate(`${String(year)}-${pad(month)}-${pad(Math.min(payDay, last))}`);
  }, [periodYear, periodMonth, payDay, target]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const input = {
        name,
        periodYear: Number(periodYear),
        periodMonth: Number(periodMonth),
        fromDate,
        toDate,
        paymentDate,
        note,
      };
      if (target === undefined) {
        const created = await payrollApi.createPeriod(input);
        await onDone(`${created.code} disimpan.`);
      } else {
        await payrollApi.updatePeriod(target.id, input);
        await onDone(`${target.code} dikemas kini.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  const titleKey: LabelKey =
    target === undefined ? 'pay.period.form.title' : 'pay.period.form.edit';

  return (
    <Dialog
      title={<T k={titleKey} />}
      titleText={t(titleKey)}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <Field
          label={<T k="pay.period.form.name" />}
          hint={<T k="pay.period.form.name.hint" />}
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k="pay.period.form.year" />}
            type="number"
            inputMode="numeric"
            value={periodYear}
            onChange={(event) => setPeriodYear(event.target.value)}
          />
          <Field
            label={<T k="pay.period.form.month" />}
            hint={<T k="pay.period.form.month.hint" />}
            type="number"
            inputMode="numeric"
            min={1}
            max={12}
            value={periodMonth}
            onChange={(event) => setPeriodMonth(event.target.value)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k="pay.period.form.from" />}
            hint={<T k="pay.period.form.range.hint" />}
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
          <Field
            label={<T k="pay.period.form.to" />}
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </div>

        <Field
          label={<T k="pay.period.form.payment" />}
          type="date"
          value={paymentDate}
          onChange={(event) => setPaymentDate(event.target.value)}
        />

        <Field
          label={<T k="pay.period.form.note" />}
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={name.trim() === '' || fromDate === '' || toDate === '' || paymentDate === ''}
          submitLabel={
            target === undefined ? <T k="pay.period.form.submit" /> : <T k="dialog.save" />
          }
        />
      </div>
    </Dialog>
  );
}

/**
 * A balance fault in words.
 *
 * Falls back to the server's own string for a fault this build has no label for, rather than
 * showing nothing — an unbalanced payslip with a blank explanation is the worst of both.
 */
function faultWords(fault: string, t: (key: LabelKey) => string): string {
  const key = BALANCE_FAULT_LABELS[fault];
  return key === undefined ? fault : t(key);
}

/**
 * Wording per transition, as registry keys.
 *
 * Typed `LabelKey` so a key that does not exist is a compile error rather than a heading that
 * renders as the key itself — which `tsc` cannot otherwise catch, since both are strings.
 */
const ACTION_COPY: Record<Action, { title: LabelKey; body: LabelKey; submit: LabelKey }> = {
  process: {
    title: 'pay.period.process.title',
    body: 'pay.period.process.body',
    submit: 'pay.period.process.submit',
  },
  approve: {
    title: 'pay.period.approve.title',
    body: 'pay.period.approve.body',
    submit: 'pay.period.approve.submit',
  },
  pay: {
    title: 'pay.period.pay.title',
    body: 'pay.period.pay.body',
    submit: 'pay.period.pay.submit',
  },
  close: {
    title: 'pay.period.close.title',
    body: 'pay.period.close.body',
    submit: 'pay.period.close.submit',
  },
  remove: {
    title: 'pay.period.remove.title',
    body: 'pay.period.remove.body',
    submit: 'app.remove',
  },
};

/**
 * One dialog for all five transitions.
 *
 * Each one states what it does and what it cannot undo, because the ladder is one way and the
 * difference between "process" and "approve" is precisely whether the numbers can still change.
 */
function ActionDialog({
  row,
  action,
  onClose,
  onDone,
}: {
  row: PayrollPeriod;
  action: Action;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [result, setResult] = useState<RunResult | null>(null);
  const { t } = useLabels();

  const copy = ACTION_COPY[action];

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      if (action === 'process') {
        const run = await payrollApi.process(row.id);
        /*
         * The run reports, then closes.
         *
         * The skipped count is the part somebody has to see: staff with no basic salary get no
         * payslip at all, and they would not otherwise notice until payday.
         */
        if (run.withoutSalary > 0) {
          setResult(run);
          setBusy(false);
          return;
        }
        await onDone(
          `${String(run.staffCount)} slip dibina. Bersih RM${run.totalNet.toFixed(2)}.`,
        );
        return;
      }
      if (action === 'approve') {
        const done = await payrollApi.approvePeriod(row.id, note);
        await onDone(t('pay.period.approve.done', { count: done.payslipCount }));
        return;
      }
      if (action === 'pay') {
        await payrollApi.payPeriod(row.id, {
          paymentMethod: method,
          paymentReference: reference,
          note,
        });
        await onDone(`${row.code} ditanda dibayar.`);
        return;
      }
      if (action === 'close') {
        await payrollApi.closePeriod(row.id, note);
        await onDone(`${row.code} ditutup.`);
        return;
      }
      await payrollApi.removePeriod(row.id);
      await onDone(`${row.code} dibuang.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k={copy.title} vars={{ code: row.code }} />}
      titleText={`${t(copy.title)} ${row.code}`}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {result === null ? (
          <>
            <PanelNote
              tone={action === 'remove' ? 'danger' : 'info'}
              icon={<CircleAlert className="size-3.5" aria-hidden />}
            >
              <T k={copy.body} />
            </PanelNote>

            {action === 'pay' && (
              <>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-700">
                    <T k="pay.period.pay.method" />
                  </p>
                  <SelectControl
                    label={t('pay.period.pay.method')}
                    value={method}
                    onChange={(event) => setMethod(event.target.value as PaymentMethod)}
                  >
                    {(['bank_transfer', 'cash', 'cheque'] as const).map((value) => (
                      <option key={value} value={value}>
                        {t(PAYMENT_METHOD_LABELS[value])}
                      </option>
                    ))}
                  </SelectControl>
                </div>
                <Field
                  label={<T k="pay.period.pay.reference" />}
                  value={reference}
                  maxLength={120}
                  placeholder={t('pay.period.pay.reference.placeholder')}
                  onChange={(event) => setReference(event.target.value)}
                />
              </>
            )}

            {action !== 'remove' && action !== 'process' && (
              <Field
                label={<T k="pay.period.form.note" />}
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
              />
            )}

            <DialogFooter
              onClose={onClose}
              onSubmit={() => void submit()}
              busy={busy}
              disabled={action === 'pay' && reference.trim() === ''}
              submitLabel={<T k={copy.submit} />}
            />
          </>
        ) : (
          <>
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="pay.period.process.skipped" vars={{ count: result.withoutSalary }} />
            </PanelNote>
            <PanelNote>
              <T
                k="pay.period.process.done"
                vars={{
                  staff: result.staffCount,
                  gross: result.totalGross.toFixed(2),
                  deductions: result.totalDeductions.toFixed(2),
                  net: result.totalNet.toFixed(2),
                }}
              />
            </PanelNote>
            <DialogFooter
              onClose={() => void onDone(`${row.code} diproses.`)}
              closeLabel={<T k="dialog.close" />}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Payslips
// ---------------------------------------------------------------------------

function PayslipsTab(): ReactNode {
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [periodId, setPeriodId] = useState('');
  const [data, setData] = useState<PayslipPage | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<number | null>(null);
  const { t } = useLabels();

  useEffect(() => {
    void lookupsApi.load().then(setLookups).catch(() => undefined);
  }, []);

  useEffect(() => {
    void payrollApi
      .periods()
      .then((result) => {
        setPeriods(result.rows);
        // Newest first from the server, so the first row is the period somebody most likely wants.
        const first = result.rows[0];
        if (first !== undefined) setPeriodId(String(first.id));
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    if (periodId === '') {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      setData(
        await payrollApi.payslips(Number(periodId), {
          page,
          pageSize,
          search: search === '' ? undefined : search,
          departmentId: departmentId === '' ? undefined : Number(departmentId),
        }),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('pay.payslip.error.load'));
    } finally {
      setLoading(false);
    }
  }, [periodId, page, pageSize, search, departmentId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];

  return (
    <>
      <PanelSection
        icon={<FileText className="size-4" aria-hidden />}
        title={<T k="pay.payslip.title" />}
        subtitle={<T k="pay.payslip.subtitle" />}
      />

      <PanelBody className="pb-0">
        <Feedback error={error} />
      </PanelBody>

      <FilterRow
        search={search}
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        dirty={search !== '' || departmentId !== ''}
        onReset={() => {
          setSearch('');
          setDepartmentId('');
          setPage(1);
        }}
      >
        <FacetSelect
          label={t('pay.payslip.filter.period')}
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
        {/* Five thousand staff in one period is a hundred pages, so the department facet is
            what makes the list usable rather than merely correct. */}
        <FacetSelect
          label={t('pay.payslip.filter.department')}
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

      {periodId === '' ? (
        <PanelBody>
          <p className="py-8 text-center text-sm text-slate-500">
            <T k="pay.payslip.selectPeriod" />
          </p>
        </PanelBody>
      ) : (
        <>
          <RecordTable
            loading={loading}
            rowCount={rows.length}
            empty={<T k="pay.payslip.empty" />}
            columns={[
              { header: <T k="pay.payslip.column.no" />, width: 'w-36' },
              { header: <T k="pay.payslip.column.staff" /> },
              { header: <T k="pay.payslip.column.department" />, width: 'w-36' },
              { header: <T k="pay.payslip.column.basic" />, width: 'w-24', align: 'right' },
              { header: <T k="pay.payslip.column.allowance" />, width: 'w-24', align: 'right' },
              { header: <T k="pay.payslip.column.overtime" />, width: 'w-24', align: 'right' },
              { header: <T k="pay.payslip.column.gross" />, width: 'w-28', align: 'right' },
              { header: <T k="pay.payslip.column.deductions" />, width: 'w-28', align: 'right' },
              { header: <T k="pay.payslip.column.net" />, width: 'w-28', align: 'right' },
              { header: <T k="panel.column.status" />, width: 'w-24' },
              { header: <T k="panel.column.actions" />, width: 'w-16', align: 'right' },
            ]}
          >
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/70">
                <td className="px-5 py-2 font-mono text-xs text-slate-700">{row.payslipNo}</td>
                <td className="px-2 py-2">
                  <p className="text-slate-800">{row.fullName}</p>
                  <p className="text-xs text-slate-500">{row.employeeNo}</p>
                </td>
                <td className="px-2 py-2 text-xs text-slate-600">{row.department ?? '—'}</td>
                <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-700">
                  {row.basicSalary.toFixed(2)}
                </td>
                <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-700">
                  {row.allowanceAmount.toFixed(2)}
                </td>
                <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-700">
                  {row.overtimeAmount.toFixed(2)}
                </td>
                <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-700">
                  {row.gross.toFixed(2)}
                </td>
                <td className="px-2 py-2 text-right text-xs tabular-nums text-rose-700">
                  {row.totalDeductions.toFixed(2)}
                </td>
                <td className="px-2 py-2 text-right text-xs font-medium tabular-nums text-slate-900">
                  {row.netPay.toFixed(2)}
                </td>
                <td className="px-2 py-2">
                  <Badge tone={row.status === 'paid' ? 'success' : 'neutral'}>
                    <span className="uppercase">
                      <TEnum k={RECORD_STATE_LABELS[row.status]} fallback={row.status} />
                    </span>
                  </Badge>
                </td>
                <td className="px-2 py-2 pr-4">
                  <RowActions>
                    <RowAction
                      icon={<FileText className="size-4" aria-hidden />}
                      label={t('pay.payslip.action.open')}
                      onClick={() => setOpened(row.id)}
                    />
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
        </>
      )}

      {opened !== null && (
        <PayslipDialog
          id={opened}
          onClose={() => setOpened(null)}
          onSaved={async () => {
            setOpened(null);
            await load();
          }}
        />
      )}
    </>
  );
}

/**
 * One payslip, its lines, and the two deductions a person enters.
 *
 * The lines are the reason this is not just the totals. "RM540 of allowances" is not an answer to
 * somebody asking why their pay changed; three named rows are.
 */
function PayslipDialog({
  id,
  onClose,
  onSaved,
}: {
  id: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}): ReactNode {
  const [row, setRow] = useState<PayslipDetail | null>(null);
  const [tax, setTax] = useState('');
  const [other, setOther] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  useEffect(() => {
    void payrollApi
      .payslip(id)
      .then((result) => {
        setRow(result);
        setTax(result.taxDeduction.toFixed(2));
        setOther(result.otherDeductions.toFixed(2));
        setNote(result.note ?? '');
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : null);
      });
  }, [id]);

  // Editable only while the period is still open to change. Past that, the payslip is the record.
  const mayEdit =
    can(SCREEN, 'edit') &&
    row !== null &&
    (row.period.status === 'draft' || row.period.status === 'processing');

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await payrollApi.updatePayslip(id, {
        taxDeduction: Number(tax),
        otherDeductions: Number(other),
        note,
      });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  const earnings = (row?.lines ?? []).filter((line) => line.kind === 'earning');
  const deductions = (row?.lines ?? []).filter((line) => line.kind === 'deduction');

  return (
    <Dialog
      title={<T k="pay.payslip.detail.title" vars={{ no: row?.payslipNo ?? '' }} />}
      titleText={`${t('pay.payslip.detail.title')} ${row?.payslipNo ?? ''}`}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {row === null ? (
          <p className="py-8 text-center text-sm text-slate-500">
            <T k="app.loading" />
          </p>
        ) : (
          <>
            {row.balanceFault !== null && (
              <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                {/* The server names the fault as a key; the map turns it into a LabelKey so
                    a key it does not know prints the fault rather than nothing. */}
                <T
                  k="pay.payslip.detail.balanceFault"
                  vars={{ reason: faultWords(row.balanceFault, t) }}
                />
              </PanelNote>
            )}

            <div className="rounded-lg border border-slate-200">
              <p className="border-b border-slate-100 px-3 py-2 text-xs font-medium text-slate-600">
                <T k="pay.payslip.detail.earnings" />
              </p>
              {earnings.map((line) => (
                <div
                  key={line.id}
                  className="flex items-center justify-between border-b border-slate-50 px-3 py-1.5 text-sm last:border-b-0"
                >
                  <span className="text-slate-700">{line.label}</span>
                  <span className="tabular-nums text-slate-800">{line.amount.toFixed(2)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/70 px-3 py-2 text-sm font-medium">
                <span className="text-slate-700">
                  <T k="pay.payslip.detail.gross" />
                </span>
                <span className="tabular-nums text-slate-900">{row.gross.toFixed(2)}</span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200">
              <p className="border-b border-slate-100 px-3 py-2 text-xs font-medium text-slate-600">
                <T k="pay.payslip.detail.deductions" />
              </p>
              {deductions.map((line) => (
                <div
                  key={line.id}
                  className="flex items-center justify-between border-b border-slate-50 px-3 py-1.5 text-sm last:border-b-0"
                >
                  <span className="text-slate-700">{line.label}</span>
                  <span className="tabular-nums text-rose-700">{line.amount.toFixed(2)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/70 px-3 py-2 text-sm font-medium">
                <span className="text-slate-700">
                  <T k="pay.payslip.detail.totalDeductions" />
                </span>
                <span className="tabular-nums text-rose-700">
                  {row.totalDeductions.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-sm font-semibold">
                <span className="text-slate-800">
                  <T k="pay.payslip.detail.net" />
                </span>
                <span className="tabular-nums text-slate-900">{row.netPay.toFixed(2)}</span>
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">
                <T k="pay.payslip.detail.employer" />
              </p>
              <DetailGrid>
                <Detail label="KWSP" value={row.epfEmployer.toFixed(2)} />
                <Detail label="PERKESO" value={row.socsoEmployer.toFixed(2)} />
                <Detail label="SIP" value={row.eisEmployer.toFixed(2)} />
                <Detail
                  label={<T k="pay.payslip.detail.epfWages" />}
                  value={row.epfWages.toFixed(2)}
                />
                <Detail
                  label={<T k="pay.payslip.detail.contributoryWages" />}
                  value={row.contributoryWages.toFixed(2)}
                />
              </DetailGrid>
              <p className="mt-1 text-xs text-slate-500">
                <T k="pay.payslip.detail.wages.hint" />
              </p>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">
                <T k="pay.payslip.detail.attendance" />
              </p>
              <DetailGrid>
                <Detail
                  label={<T k="pay.payslip.detail.scheduledDays" />}
                  value={String(row.scheduledDays)}
                />
                <Detail
                  label={<T k="pay.payslip.detail.presentDays" />}
                  value={String(row.presentDays)}
                />
                <Detail
                  label={<T k="pay.payslip.detail.absentDays" />}
                  value={String(row.absentDays)}
                />
                <Detail
                  label={<T k="pay.payslip.detail.leaveDays" />}
                  value={String(row.leaveDays)}
                />
                <Detail
                  label={<T k="pay.payslip.detail.overtimeHours" />}
                  value={(row.overtimeMinutes / 60).toFixed(2)}
                />
              </DetailGrid>
              <p className="mt-1 text-xs text-slate-500">
                <T k="pay.payslip.detail.attendance.hint" />
              </p>
            </div>

            {mayEdit && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={<T k="pay.payslip.form.tax" />}
                    hint={<T k="pay.payslip.form.tax.hint" />}
                    type="number"
                    step="0.01"
                    min={0}
                    value={tax}
                    onChange={(event) => setTax(event.target.value)}
                  />
                  <Field
                    label={<T k="pay.payslip.form.other" />}
                    hint={<T k="pay.payslip.form.other.hint" />}
                    type="number"
                    step="0.01"
                    min={0}
                    value={other}
                    onChange={(event) => setOther(event.target.value)}
                  />
                </div>
                <Field
                  label={<T k="pay.payslip.form.note" />}
                  value={note}
                  maxLength={500}
                  onChange={(event) => setNote(event.target.value)}
                />
              </>
            )}

            <DialogFooter
              onClose={onClose}
              onSubmit={mayEdit ? () => void submit() : undefined}
              busy={busy}
              submitLabel={<T k="dialog.save" />}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}
