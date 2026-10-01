import { Plus, SquareCheck, Trash2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  CodePill,
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
} from '../components/RecordPanel';
import { Badge, Button, Field } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { PERIOD_STATUS_LABELS, kpiApi, type KpiPeriod } from '../lib/kpi-api';
import { formatDateOnly, todayIso } from '../lib/operations-api';
import { T, useLabels } from '../lib/translation';

const SCREEN = 'hr.kpiPeriods';

/**
 * Review cycles.
 *
 * Forward only, and closing is the one irreversible act on this screen: the grades in a closed
 * period have been read, and where the payroll module exists they may already have driven a bonus.
 * That is stated in the dialog that closes one, which is where it is decided.
 */
export function KpiPeriodsPage(): ReactNode {
  const [rows, setRows] = useState<KpiPeriod[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<KpiPeriod | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await kpiApi.periods());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('kpi.period.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const needle = search.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      needle.length === 0 ||
      row.code.toLowerCase().includes(needle) ||
      row.name.toLowerCase().includes(needle),
  );

  const remove = async (row: KpiPeriod): Promise<void> => {
    try {
      await kpiApi.deletePeriod(row.id);
      setNotice(t('kpi.period.notice.removed', { code: row.code }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.remove'));
    }
  };

  return (
    <PanelCard title={<T k="kpi.period.title" />} subtitle={<T k="kpi.period.subtitle" />}>
      <PanelSection
        title={<T k="kpi.period.count" vars={{ count: rows.length }} />}
        action={
          can(SCREEN, 'create') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              <T k="kpi.period.action.new" />
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

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={filtered.length}
        empty={<T k="kpi.period.empty" />}
        columns={[
          { header: <T k="kpi.period.column.code" />, width: 'w-28' },
          { header: <T k="kpi.period.column.name" /> },
          { header: <T k="kpi.period.column.span" />, width: 'w-52' },
          { header: <T k="kpi.period.column.due" />, width: 'w-28' },
          { header: <T k="kpi.period.column.assignments" />, width: 'w-24', align: 'right' },
          { header: <T k="kpi.period.column.outstanding" />, width: 'w-28', align: 'right' },
          { header: <T k="panel.column.status" />, width: 'w-24' },
          { header: <T k="panel.column.actions" />, width: 'w-24', align: 'right' },
        ]}
      >
        {filtered.map((row) => {
          const closed = row.status === 'closed';
          return (
            <tr
              key={row.id}
              className={cn(
                'border-b border-slate-100 hover:bg-slate-50/70',
                // Outstanding reviews on an open period are the thing to act on.
                !closed && row.outstanding > 0 ? 'bg-amber-50/40' : closed && 'bg-slate-50/60',
              )}
            >
              <td className="px-5 py-2.5">
                <CodePill code={row.code} />
              </td>
              <td className="px-2 py-2.5">
                <span className={cn('block font-medium', closed ? 'text-slate-400' : 'text-slate-800')}>
                  {row.name}
                </span>
              </td>
              <td className="px-2 py-2.5 text-xs whitespace-nowrap tabular-nums text-slate-600">
                {formatDateOnly(row.fromDate)} – {formatDateOnly(row.toDate)}
              </td>
              <td className="px-2 py-2.5 text-xs whitespace-nowrap tabular-nums text-slate-600">
                {formatDateOnly(row.dueOn)}
              </td>
              <td className="px-2 py-2.5 text-right text-xs tabular-nums text-slate-700">
                {row.assignmentCount}
              </td>
              <td className="px-2 py-2.5 text-right text-xs tabular-nums">
                <span className={row.outstanding > 0 ? 'font-medium text-amber-700' : 'text-slate-400'}>
                  {row.outstanding}
                </span>
              </td>
              <td className="px-2 py-2.5">
                {/* Uppercased by the badge's class: a translated word cannot be upper-cased safely. */}
                <Badge tone={closed ? 'neutral' : 'success'} className="uppercase">
                  <T k={PERIOD_STATUS_LABELS[row.status]} />
                </Badge>
              </td>
              <td className="px-2 py-2.5 pr-4">
                <RowActions>
                  {/*
                    Amber: closing changes the period's state, it does not remove it. Always a dialog,
                    because it is the one thing on this screen that cannot be undone.
                  */}
                  {!closed && can(SCREEN, 'edit') && (
                    <RowAction
                      icon={<SquareCheck className="size-4" aria-hidden />}
                      label={t('kpi.period.action.close')}
                      tone="warn"
                      onClick={() => setClosing(row)}
                    />
                  )}
                  {/*
                    Disabled with the reason in the label, not enabled and then a 409. Gated on the
                    period being empty, and on it not being closed: an empty period created by
                    mistake is a mistake, a closed one is a record.
                  */}
                  {can(SCREEN, 'delete') && (
                    <RowAction
                      icon={<Trash2 className="size-4" aria-hidden />}
                      label={
                        row.assignmentCount > 0
                          ? t('kpi.period.delete.hasAssignments', { count: row.assignmentCount })
                          : closed
                            ? t('kpi.period.delete.closed')
                            : t('kpi.period.action.delete')
                      }
                      disabled={row.assignmentCount > 0 || closed}
                      tone="danger"
                      onClick={() => void remove(row)}
                    />
                  )}
                </RowActions>
              </td>
            </tr>
          );
        })}
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

      {creating && (
        <PeriodDialog
          onClose={() => setCreating(false)}
          onDone={async (message) => {
            setCreating(false);
            setNotice(message);
            await load();
          }}
        />
      )}

      {closing !== null && (
        <CloseDialog
          target={closing}
          onClose={() => setClosing(null)}
          onDone={async (message) => {
            setClosing(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </PanelCard>
  );
}

function PeriodDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dueOn, setDueOn] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const body = { code: code.trim().toUpperCase(), name: name.trim(), fromDate, toDate, dueOn };
      await kpiApi.createPeriod(body);
      await onDone(t('kpi.period.notice.saved', { code: body.code }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="kpi.period.form.create" />}
      titleText={t('kpi.period.form.create')}
      // Why there is no draft state, said where the period is made rather than under the list.
      description={<T k="kpi.period.form.create.description" />}
      width="2xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/* Identity first: the code somebody types, then the name they read. */}
        <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
          <Field
            label={<T k="kpi.period.form.code" />}
            value={code}
            maxLength={24}
            autoFocus
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <Field
            label={<T k="kpi.period.form.name" />}
            value={name}
            maxLength={190}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="grid items-start gap-4 pb-2 sm:grid-cols-3">
          <Field
            label={<T k="kpi.period.form.from" />}
            type="date"
            value={fromDate}
            onChange={(event) => {
              setFromDate(event.target.value);
              if (toDate !== '' && toDate < event.target.value) setToDate(event.target.value);
            }}
          />
          <Field
            label={<T k="kpi.period.form.to" />}
            type="date"
            value={toDate}
            min={fromDate === '' ? undefined : fromDate}
            onChange={(event) => setToDate(event.target.value)}
          />
          <Field
            label={<T k="kpi.period.form.due" />}
            hint={<T k="kpi.period.form.due.hint" />}
            type="date"
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
          />
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={
            code.trim() === '' ||
            name.trim() === '' ||
            fromDate === '' ||
            toDate === '' ||
            dueOn === ''
          }
          submitLabel={<T k="dialog.save" />}
        />
      </div>
    </Dialog>
  );
}

/**
 * Confirms closing a period.
 *
 * Always asked, because a closed period does not reopen. When reviews are still unsubmitted the
 * count is named and the button says so: closing leaves those people ungraded permanently, and the
 * number is what makes that concrete. The server requires the same acknowledgement.
 */
function CloseDialog({
  target,
  onClose,
  onDone,
}: {
  target: KpiPeriod;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();
  const outstanding = target.outstanding > 0;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await kpiApi.setPeriodStatus(target.id, 'closed', outstanding ? true : undefined);
      await onDone(t('kpi.period.notice.closed', { code: target.code }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="kpi.period.close.title" vars={{ code: target.code }} />}
      titleText={t('kpi.period.close.title', { code: target.code })}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <DetailGrid>
          <Detail
            label={<T k="kpi.period.column.span" />}
            value={`${formatDateOnly(target.fromDate)} – ${formatDateOnly(target.toDate)}`}
          />
          <Detail
            label={<T k="kpi.period.column.assignments" />}
            value={String(target.assignmentCount)}
          />
          <Detail
            label={<T k="kpi.period.column.outstanding" />}
            value={String(target.outstanding)}
          />
        </DetailGrid>

        {/*
          One note: what this leaves behind, if anything, then why it cannot be undone. The last
          block before the footer, so it carries the `pb-2`.
        */}
        <div className="pb-2">
          <PanelNote
            tone={outstanding ? 'danger' : 'warn'}
            icon={<TriangleAlert className="size-3.5" aria-hidden />}
          >
            {outstanding && (
              <>
                <T k="kpi.period.close.outstanding" vars={{ count: target.outstanding }} />{' '}
              </>
            )}
            <T k="kpi.period.close.final" />
          </PanelNote>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel={
            outstanding ? <T k="kpi.period.close.confirm" /> : <T k="kpi.period.action.close" />
          }
        />
      </div>
    </Dialog>
  );
}
