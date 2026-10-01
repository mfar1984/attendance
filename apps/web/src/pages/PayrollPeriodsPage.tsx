import type { LabelKey } from '@attendance/shared';
import {
  Banknote,
  CircleCheck,
  Download,
  Eye,
  FileText,
  Pencil,
  Play,
  Plus,
  SquareCheck,
  Trash2,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  ChipBar,
  CodePill,
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
import { Badge, Field, SelectField, StatTile, TextArea, Button } from '../components/ui';
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
  type PeriodStatus,
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
 * onwards the figures are the record. Each transition says so in the dialog that makes it.
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
            icon: <Banknote className="size-4" aria-hidden />,
          },
          {
            id: 'payslips',
            label: <T k="pay.period.tab.payslips" />,
            labelText: t('pay.period.tab.payslips'),
            icon: <FileText className="size-4" aria-hidden />,
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

const STATUSES: PeriodStatus[] = ['draft', 'processing', 'approved', 'paid', 'closed'];

const STATUS_DOT: Record<PeriodStatus, string> = {
  draft: 'bg-amber-500',
  processing: 'bg-orange-500',
  approved: 'bg-sky-500',
  paid: 'bg-emerald-600',
  closed: 'bg-slate-400',
};

/** Amber while the figures can still change, blue once signed, green once money has moved. */
const STATUS_TONE: Record<PeriodStatus, 'warning' | 'info' | 'success' | 'neutral'> = {
  draft: 'warning',
  processing: 'warning',
  approved: 'info',
  paid: 'success',
  closed: 'neutral',
};

/** The export link wears the row action's blue, since it reads rather than changes anything. */
const EXPORT_LINK =
  'rounded-md border border-transparent p-1.5 text-sky-500 transition-colors hover:bg-sky-50 hover:text-sky-700';

function PeriodsTab(): ReactNode {
  const [data, setData] = useState<PeriodPage | null>(null);
  const [status, setStatus] = useState<PeriodStatus | undefined>(undefined);
  const [year, setYear] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<PayrollPeriod | 'new' | null>(null);
  const [acting, setActing] = useState<{ row: PayrollPeriod; action: Action } | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await payrollApi.periods({
          ...(status === undefined ? {} : { status }),
          ...(year === '' ? {} : { year: Number(year) }),
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

  const done = async (message: string): Promise<void> => {
    setEditing(null);
    setActing(null);
    setNotice(message);
    await load();
  };

  const rows = data?.rows ?? [];
  const counts = data?.counts ?? {};
  // Counts every status for the year, so choosing a chip does not make the heading shrink.
  const count = Object.values(counts).reduce((sum, value) => sum + value, 0);

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
        title={<T k="pay.period.count" vars={{ count }} />}
        action={
          can(SCREEN, 'create') ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden />
              <T k="pay.period.action.add" />
            </Button>
          ) : undefined
        }
      />

      <ChipBar
        active={status}
        onChange={(id) => setStatus(id as PeriodStatus | undefined)}
        chips={STATUSES.map((key) => ({
          id: key,
          label: <T k={PERIOD_STATUS_LABELS[key]} />,
          count: counts[key] ?? 0,
          dot: STATUS_DOT[key],
        }))}
      />

      <FilterRow
        dirty={status !== undefined || year !== ''}
        onReset={() => {
          setStatus(undefined);
          setYear('');
        }}
      >
        <FacetSelect
          label={t('pay.period.filter.year')}
          value={year}
          onChange={setYear}
          options={years}
        />
      </FilterRow>

      {(error !== null || notice !== null || (data !== null && !data.ratesReviewed)) && (
        <PanelBody className="space-y-2 pb-0">
          <Feedback error={error} notice={notice} />
          {/*
            The unverified-rates warning, in amber and actionable: seeded statutory rates look
            identical to rates finance signed off, and the difference is every deduction in the
            period. It links to where the confirmation happens.
          */}
          {data !== null && !data.ratesReviewed && (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="pay.period.note.unreviewed" />{' '}
              <Link className="font-medium underline" to="/hr/payroll/tetapan">
                <T k="pay.period.note.reviewLink" />
              </Link>
            </PanelNote>
          )}
        </PanelBody>
      )}

      {/* The totals of the rows shown, so a year filter reads as that year's cost. */}
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

      <RecordTable
        framed
        loading={loading}
        rowCount={rows.length}
        empty={<T k="pay.period.empty" />}
        columns={[
          { header: <T k="pay.period.column.code" />, width: 'w-28' },
          { header: <T k="pay.period.form.name" /> },
          { header: <T k="pay.period.column.range" />, width: 'w-52' },
          { header: <T k="pay.period.column.payment" />, width: 'w-28' },
          { header: <T k="pay.period.column.staff" />, width: 'w-16', align: 'right' },
          { header: <T k="pay.period.column.gross" />, width: 'w-28', align: 'right' },
          { header: <T k="pay.period.column.deductions" />, width: 'w-28', align: 'right' },
          { header: <T k="pay.period.column.net" />, width: 'w-28', align: 'right' },
          { header: <T k="panel.column.status" />, width: 'w-28' },
          { header: <T k="panel.column.actions" />, width: 'w-36', align: 'right' },
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
            <td className="px-5 py-2">
              <CodePill code={row.code} />
            </td>
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
              {/* Uppercased by the badge's class: a translated word cannot be upper-cased safely. */}
              <Badge tone={STATUS_TONE[row.status]} className="uppercase">
                <T k={PERIOD_STATUS_LABELS[row.status]} />
              </Badge>
            </td>
            <td className="px-2 py-2 pr-4">
              <RowActions>
                {/*
                  Each transition appears only on the status that permits it, and one the server
                  would refuse is disabled with the reason in its tooltip rather than offered.
                */}
                {can(SCREEN, 'approve') && row.status === 'draft' && (
                  <RowAction
                    icon={<Play className="size-4" aria-hidden />}
                    label={t('pay.period.action.process')}
                    tone="success"
                    onClick={() => setActing({ row, action: 'process' })}
                  />
                )}
                {can(SCREEN, 'approve') && row.status === 'processing' && (
                  <RowAction
                    icon={<SquareCheck className="size-4" aria-hidden />}
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
                {can(SCREEN, 'approve') && row.status === 'approved' && (
                  <RowAction
                    icon={<Wallet className="size-4" aria-hidden />}
                    label={t('pay.period.action.pay')}
                    tone="warn"
                    onClick={() => setActing({ row, action: 'pay' })}
                  />
                )}
                {can(SCREEN, 'approve') && row.status === 'paid' && (
                  <RowAction
                    icon={<CircleCheck className="size-4" aria-hidden />}
                    label={t('pay.period.action.close')}
                    tone="warn"
                    onClick={() => setActing({ row, action: 'close' })}
                  />
                )}

                {/* Hidden without the grant: an export that answers 403 teaches that it is broken. */}
                {can(SCREEN, 'export') && row.payslipCount > 0 && (
                  <a
                    className={EXPORT_LINK}
                    href={payrollApi.exportUrl(row.id)}
                    title={t('pay.period.action.export')}
                    aria-label={t('pay.period.action.export')}
                  >
                    <Download className="size-4" aria-hidden />
                  </a>
                )}

                {can(SCREEN, 'edit') && row.status === 'draft' && (
                  <RowAction
                    icon={<Pencil className="size-4" aria-hidden />}
                    label={t('pay.action.edit')}
                    tone="edit"
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

      {/* Not paginated: a payroll cycle is monthly, so a year is twelve rows and the year filter
          is the only narrowing that helps. */}
      <PanelFooter
        shown={rows.length}
        total={rows.length}
        page={1}
        pageSize={Math.max(1, rows.length)}
        pageSizes={[Math.max(1, rows.length)]}
        generatedAt={data?.generatedAt}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => void load()}
      />

      {editing !== null && (
        <PeriodDialog
          payDay={data?.payDay ?? 25}
          target={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={done}
        />
      )}

      {acting !== null && (
        <ActionDialog
          row={acting.row}
          action={acting.action}
          onClose={() => setActing(null)}
          onDone={done}
        />
      )}
    </>
  );
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
  target: PayrollPeriod | null;
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
    if (target !== null) return;
    const year = Number(periodYear);
    const month = Number(periodMonth);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return;
    const pad = (value: number): string => String(value).padStart(2, '0');
    const last = new Date(year, month, 0).getDate();
    setFromDate(`${String(year)}-${pad(month)}-01`);
    setToDate(`${String(year)}-${pad(month)}-${pad(last)}`);
    setPaymentDate(`${String(year)}-${pad(month)}-${pad(Math.min(payDay, last))}`);
  }, [periodYear, periodMonth, payDay, target]);

  const endsEarly = fromDate !== '' && toDate !== '' && toDate < fromDate;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const input = {
        name: name.trim(),
        periodYear: Number(periodYear),
        periodMonth: Number(periodMonth),
        fromDate,
        toDate,
        paymentDate,
        note: note.trim(),
      };
      if (target === null) {
        const created = await payrollApi.createPeriod(input);
        await onDone(t('pay.period.notice.saved', { code: created.code }));
      } else {
        await payrollApi.updatePeriod(target.id, input);
        await onDone(t('pay.period.notice.saved', { code: target.code }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  const titleKey: LabelKey = target === null ? 'pay.period.form.title' : 'pay.period.form.edit';

  return (
    <Dialog
      title={<T k={titleKey} />}
      titleText={t(titleKey)}
      // The one-way ladder, said where a period is made rather than as a strip over the list.
      description={<T k="pay.period.note.oneWay" />}
      width="2xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/* Identity first: what people call the cycle, then the month it sorts under. */}
        <Field
          label={<T k="pay.period.form.name" />}
          hint={<T k="pay.period.form.name.hint" />}
          value={name}
          maxLength={120}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />

        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field
            label={<T k="pay.period.form.year" />}
            type="number"
            inputMode="numeric"
            min={2000}
            max={2100}
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

        <div className="grid items-start gap-4 sm:grid-cols-3">
          <Field
            label={<T k="pay.period.form.from" />}
            hint={<T k="pay.period.form.range.hint" />}
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
          <Field
            label={<T k="pay.period.form.to" />}
            {...(endsEarly ? { error: t('pay.form.endBeforeStart') } : {})}
            type="date"
            value={toDate}
            min={fromDate === '' ? undefined : fromDate}
            onChange={(event) => setToDate(event.target.value)}
          />
          <Field
            label={<T k="pay.period.form.payment" />}
            type="date"
            value={paymentDate}
            onChange={(event) => setPaymentDate(event.target.value)}
          />
        </div>

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="pb-2">
          <TextArea
            label={<T k="pay.period.form.note" />}
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
          disabled={
            name.trim() === '' ||
            fromDate === '' ||
            toDate === '' ||
            paymentDate === '' ||
            endsEarly
          }
          submitLabel={
            target === null ? <T k="pay.period.form.submit" /> : <T k="dialog.save" />
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
  const processed = (run: RunResult): string =>
    t('pay.period.notice.processed', {
      code: row.code,
      count: run.staffCount,
      net: run.totalNet.toFixed(2),
    });

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const trimmed = note.trim();
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
        await onDone(processed(run));
        return;
      }
      if (action === 'approve') {
        const approved = await payrollApi.approvePeriod(row.id, trimmed === '' ? undefined : trimmed);
        await onDone(t('pay.period.approve.done', { count: approved.payslipCount }));
        return;
      }
      if (action === 'pay') {
        await payrollApi.payPeriod(row.id, {
          paymentMethod: method,
          paymentReference: reference.trim(),
          ...(trimmed === '' ? {} : { note: trimmed }),
        });
        await onDone(t('pay.period.notice.paid', { code: row.code }));
        return;
      }
      if (action === 'close') {
        await payrollApi.closePeriod(row.id, trimmed === '' ? undefined : trimmed);
        await onDone(t('pay.period.notice.closed', { code: row.code }));
        return;
      }
      await payrollApi.removePeriod(row.id);
      await onDone(t('pay.period.notice.removed', { code: row.code }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  const takesNote = action === 'approve' || action === 'pay' || action === 'close';

  return (
    <Dialog
      title={<T k={copy.title} vars={{ code: row.code }} />}
      titleText={t(copy.title, { code: row.code })}
      width={action === 'pay' ? 'lg' : 'md'}
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {result === null ? (
          <>
            <DetailGrid>
              <Detail
                label={<T k="pay.period.column.range" />}
                value={
                  <T
                    k="pay.period.range"
                    vars={{ from: formatDateOnly(row.fromDate), to: formatDateOnly(row.toDate) }}
                  />
                }
              />
              <Detail label={<T k="pay.period.column.staff" />} value={String(row.payslipCount)} />
              <Detail label={<T k="pay.period.column.net" />} value={row.totalNet.toFixed(2)} />
            </DetailGrid>

            {/* What this does and what it cannot undo, at the moment of deciding. */}
            <div className={cn(!takesNote && 'pb-2')}>
              <PanelNote
                tone={action === 'remove' ? 'danger' : 'warn'}
                icon={<TriangleAlert className="size-3.5" aria-hidden />}
              >
                <T k={copy.body} />
              </PanelNote>
            </div>

            {action === 'pay' && (
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <SelectField
                  label={<T k="pay.period.pay.method" />}
                  value={method}
                  onChange={(event) => setMethod(event.target.value as PaymentMethod)}
                >
                  {(['bank_transfer', 'cash', 'cheque'] as const).map((value) => (
                    <option key={value} value={value}>
                      {t(PAYMENT_METHOD_LABELS[value])}
                    </option>
                  ))}
                </SelectField>
                <Field
                  label={<T k="pay.period.pay.reference" />}
                  value={reference}
                  maxLength={120}
                  placeholder={t('pay.period.pay.reference.placeholder')}
                  onChange={(event) => setReference(event.target.value)}
                />
              </div>
            )}

            {takesNote && (
              // The last block before the footer, so it carries the `pb-2`.
              <div className="pb-2">
                <TextArea
                  label={<T k="pay.period.form.note" />}
                  rows={2}
                  value={note}
                  maxLength={500}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
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
            {/* The last block before the footer, so it carries the `pb-2`. */}
            <div className="pb-2">
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
            </div>
            <DialogFooter
              onClose={() => void onDone(processed(result))}
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
  const [periods, setPeriods] = useState<PayrollPeriod[] | null>(null);
  const [periodId, setPeriodId] = useState('');
  const [data, setData] = useState<PayslipPage | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opened, setOpened] = useState<number | null>(null);
  const { t } = useLabels();
  // Which load is the latest, so a search answered out of order cannot replace the current rows.
  const latest = useRef(0);

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
      .catch(() => setPeriods([]));
  }, []);

  // One request per pause in typing, not one per key — the same debounce as the request lists.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    if (periodId === '') {
      setData(null);
      return;
    }
    const mine = ++latest.current;
    setLoading(true);
    try {
      const result = await payrollApi.payslips(Number(periodId), {
        page,
        pageSize,
        ...(debounced === '' ? {} : { search: debounced }),
        ...(departmentId === '' ? {} : { departmentId: Number(departmentId) }),
      });
      if (mine !== latest.current) return;
      setData(result);
      setError(null);
    } catch (cause) {
      if (mine !== latest.current) return;
      setError(cause instanceof Error ? cause.message : t('pay.payslip.error.load'));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [periodId, page, pageSize, debounced, departmentId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];

  return (
    <>
      <PanelSection
        title={<T k="pay.payslip.count" vars={{ count: data?.total ?? 0 }} />}
        subtitle={<T k="pay.payslip.subtitle" />}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('pay.payslip.search')}
        dirty={search.length > 0 || departmentId !== ''}
        onReset={() => {
          setSearch('');
          setDepartmentId('');
          setPage(1);
        }}
      >
        {/*
          Not a facet: there is always a period, because a payslip list across every cycle would
          mix figures nobody adds together. A facet's empty option would be a choice that empties
          the table.
        */}
        <select
          aria-label={t('pay.payslip.filter.period')}
          value={periodId}
          disabled={periods === null || periods.length === 0}
          onChange={(event) => {
            setPeriodId(event.target.value);
            setPage(1);
          }}
          className="min-w-44 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700"
        >
          {(periods ?? []).length === 0 && <option value="">{t('pay.payslip.filter.period')}</option>}
          {(periods ?? []).map((row) => (
            <option key={row.id} value={String(row.id)}>
              {`${row.code} — ${row.name}`}
            </option>
          ))}
        </select>
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

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      {periodId === '' ? (
        <PanelBody>
          <p className="py-8 text-center text-sm text-slate-500">
            <T k="pay.payslip.selectPeriod" />
          </p>
        </PanelBody>
      ) : (
        <>
          <RecordTable
            framed
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
              { header: <T k="panel.column.status" />, width: 'w-28' },
              { header: <T k="panel.column.actions" />, width: 'w-16', align: 'right' },
            ]}
          >
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/70">
                <td className="px-5 py-2 font-mono text-xs text-slate-700">{row.payslipNo}</td>
                <td className="px-2 py-2">
                  <span className="block text-slate-800">{row.fullName}</span>
                  <span className="block font-mono text-[11px] text-slate-400">
                    {row.employeeNo}
                  </span>
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
                  {/* Uppercased by the badge's class: a translated word cannot be upper-cased safely. */}
                  <Badge tone={row.status === 'paid' ? 'success' : 'neutral'} className="uppercase">
                    <TEnum k={RECORD_STATE_LABELS[row.status]} fallback={row.status} />
                  </Badge>
                </td>
                <td className="px-2 py-2 pr-4">
                  <RowActions>
                    <RowAction
                      icon={<Eye className="size-4" aria-hidden />}
                      label={t('pay.payslip.action.open')}
                      tone="view"
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
          onSaved={async (message) => {
            setOpened(null);
            setNotice(message);
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
 * somebody asking why their pay changed; three named rows are. Earnings and deductions sit side
 * by side so a line can be read against the one it offsets.
 */
function PayslipDialog({
  id,
  onClose,
  onSaved,
}: {
  id: number;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
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
        setError(cause instanceof Error ? cause.message : t('pay.payslip.error.load'));
      });
  }, [id, t]);

  // Editable only while the period is still open to change. Past that, the payslip is the record.
  const mayEdit =
    can(SCREEN, 'edit') &&
    row !== null &&
    (row.period.status === 'draft' || row.period.status === 'processing');

  const submit = async (): Promise<void> => {
    if (row === null) return;
    setBusy(true);
    setError(null);
    try {
      await payrollApi.updatePayslip(id, {
        taxDeduction: Number(tax),
        otherDeductions: Number(other),
        note: note.trim(),
      });
      await onSaved(t('pay.payslip.notice.saved', { no: row.payslipNo }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  const earnings = (row?.lines ?? []).filter((line) => line.kind === 'earning');
  const deductions = (row?.lines ?? []).filter((line) => line.kind === 'deduction');
  const titleVars = { no: row?.payslipNo ?? '' };

  return (
    <Dialog
      title={<T k="pay.payslip.detail.title" vars={titleVars} />}
      titleText={t('pay.payslip.detail.title', titleVars)}
      width="2xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {row === null ? (
          error === null && (
            <p className="py-8 text-center text-sm text-slate-500">
              <T k="app.loading" />
            </p>
          )
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

            <div className="grid items-start gap-4 sm:grid-cols-2">
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <p className="border-b border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                  <T k="pay.payslip.detail.earnings" />
                </p>
                {earnings.map((line) => (
                  <div
                    key={line.id}
                    className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5 text-sm"
                  >
                    <span className="text-slate-700">{line.label}</span>
                    <span className="tabular-nums text-slate-800">{line.amount.toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-2 text-sm font-medium">
                  <span className="text-slate-700">
                    <T k="pay.payslip.detail.gross" />
                  </span>
                  <span className="tabular-nums text-slate-900">{row.gross.toFixed(2)}</span>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-slate-200">
                <p className="border-b border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                  <T k="pay.payslip.detail.deductions" />
                </p>
                {deductions.map((line) => (
                  <div
                    key={line.id}
                    className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5 text-sm"
                  >
                    <span className="text-slate-700">{line.label}</span>
                    <span className="tabular-nums text-rose-700">{line.amount.toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-2 text-sm font-medium">
                  <span className="text-slate-700">
                    <T k="pay.payslip.detail.totalDeductions" />
                  </span>
                  <span className="tabular-nums text-rose-700">
                    {row.totalDeductions.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* The figure that is paid, on a tinted strip of its own. */}
            <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 text-emerald-900">
              <span className="text-sm font-medium">
                <T k="pay.payslip.detail.net" />
              </span>
              <span className="text-lg font-semibold tabular-nums">{row.netPay.toFixed(2)}</span>
            </div>

            <div className="grid items-start gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                  <T k="pay.payslip.detail.employer" />
                </p>
                <DetailGrid>
                  <Detail
                    label={<T k="pay.payslip.detail.epfEmployer" />}
                    value={row.epfEmployer.toFixed(2)}
                  />
                  <Detail
                    label={<T k="pay.payslip.detail.socsoEmployer" />}
                    value={row.socsoEmployer.toFixed(2)}
                  />
                  <Detail
                    label={<T k="pay.payslip.detail.eisEmployer" />}
                    value={row.eisEmployer.toFixed(2)}
                  />
                  <Detail
                    label={<T k="pay.payslip.detail.epfWages" />}
                    value={row.epfWages.toFixed(2)}
                  />
                  <Detail
                    label={<T k="pay.payslip.detail.contributoryWages" />}
                    value={row.contributoryWages.toFixed(2)}
                  />
                </DetailGrid>
                <p className="text-xs text-slate-500">
                  <T k="pay.payslip.detail.wages.hint" />
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
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
                <p className="text-xs text-slate-500">
                  <T k="pay.payslip.detail.attendance.hint" />
                </p>
              </div>
            </div>

            {mayEdit && (
              // The last block before the footer, so it carries the `pb-2`.
              <div className="grid items-start gap-4 border-t border-slate-200 pt-4 pb-2 sm:grid-cols-3">
                <Field
                  label={<T k="pay.payslip.form.tax" />}
                  hint={<T k="pay.payslip.form.tax.hint" />}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  value={tax}
                  onChange={(event) => setTax(event.target.value)}
                />
                <Field
                  label={<T k="pay.payslip.form.other" />}
                  hint={<T k="pay.payslip.form.other.hint" />}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  value={other}
                  onChange={(event) => setOther(event.target.value)}
                />
                <TextArea
                  label={<T k="pay.payslip.form.note" />}
                  rows={2}
                  value={note}
                  maxLength={500}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
            )}

            {mayEdit ? (
              <DialogFooter
                onClose={onClose}
                onSubmit={() => void submit()}
                busy={busy}
                disabled={!(Number(tax) >= 0) || !(Number(other) >= 0)}
                submitLabel={<T k="dialog.save" />}
              />
            ) : (
              <DialogFooter onClose={onClose} closeLabel={<T k="dialog.close" />} />
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
