import { CalendarRange, CircleAlert, Plus, SquareCheck, Trash2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  PanelBody,
  PanelCard,
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
 */
export function KpiPeriodsPage(): ReactNode {
  const [rows, setRows] = useState<KpiPeriod[]>([]);
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

  return (
    <PanelCard title={<T k="kpi.period.title" />} subtitle={<T k="kpi.period.subtitle" />}>
      <PanelSection
        icon={<CalendarRange className="size-4" aria-hidden />}
        title={<T k="kpi.period.title" />}
        action={
          can(SCREEN, 'create') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              <T k="kpi.period.action.new" />
            </Button>
          ) : undefined
        }
      />

      <PanelBody className="space-y-2 pb-0">
        <Feedback error={error} notice={notice} />
        <PanelNote icon={<CircleAlert className="size-3.5" aria-hidden />}>
          <T k="kpi.period.note.forward" />
        </PanelNote>
      </PanelBody>

      <RecordTable
        loading={loading}
        rowCount={rows.length}
        empty={<T k="kpi.period.empty" />}
        columns={[
          { header: <T k="kpi.period.column.code" />, width: 'w-32' },
          { header: <T k="kpi.period.column.name" /> },
          { header: <T k="kpi.period.column.span" />, width: 'w-52' },
          { header: <T k="kpi.period.column.due" />, width: 'w-28' },
          { header: <T k="kpi.period.column.assignments" />, width: 'w-24', align: 'right' },
          { header: <T k="kpi.period.column.outstanding" />, width: 'w-28', align: 'right' },
          { header: <T k="panel.column.status" />, width: 'w-28' },
          { header: <T k="panel.column.actions" />, width: 'w-32', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <tr
            key={row.id}
            className={cn(
              'border-b border-slate-100 hover:bg-slate-50/70',
              row.status === 'closed' && 'text-slate-400',
              // Outstanding reviews on an open period are the thing to act on.
              row.status === 'open' && row.outstanding > 0 && 'bg-amber-50/40',
            )}
          >
            <td className="px-5 py-2 font-mono text-xs text-slate-700">{row.code}</td>
            <td className="px-2 py-2 text-slate-800">{row.name}</td>
            <td className="px-2 py-2 text-xs whitespace-nowrap tabular-nums text-slate-600">
              {formatDateOnly(row.fromDate)} – {formatDateOnly(row.toDate)}
            </td>
            <td className="px-2 py-2 text-xs whitespace-nowrap tabular-nums text-slate-600">
              {formatDateOnly(row.dueOn)}
            </td>
            <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-700">
              {row.assignmentCount}
            </td>
            <td className="px-2 py-2 text-right text-xs tabular-nums">
              <span className={row.outstanding > 0 ? 'font-medium text-amber-700' : 'text-slate-400'}>
                {row.outstanding}
              </span>
            </td>
            <td className="px-2 py-2">
              <Badge tone={row.status === 'open' ? 'success' : 'neutral'}>
                <span className="uppercase">
                  <T k={PERIOD_STATUS_LABELS[row.status]} />
                </span>
              </Badge>
            </td>
            <td className="px-2 py-2 pr-4">
              <RowActions>
                {row.status === 'open' && can(SCREEN, 'edit') && (
                  <RowAction
                    icon={<SquareCheck className="size-4" aria-hidden />}
                    label={t('kpi.period.action.close')}
                    tone="warn"
                    onClick={async () => {
                      /*
                       * Outstanding reviews get a confirmation rather than a refusal, because
                       * closing anyway is sometimes the right call — but it must be a decision.
                       */
                      if (row.outstanding > 0) {
                        setClosing(row);
                        return;
                      }
                      try {
                        await kpiApi.setPeriodStatus(row.id, 'closed');
                        setNotice(`${row.code} ditutup.`);
                        await load();
                      } catch (cause) {
                        setError(cause instanceof Error ? cause.message : '');
                      }
                    }}
                  />
                )}
                {row.status === 'open' && can(SCREEN, 'delete') && (
                  <RowAction
                    icon={<Trash2 className="size-4" aria-hidden />}
                    /*
                     * Disabled with the reason in the label, not enabled and then a 409.
                     *
                     * Gated on the period being empty rather than on a status: the old rule was
                     * "only a draft may be deleted", which stopped meaning anything when `draft`
                     * was removed. What matters is whether deleting would take appraisals with it.
                     */
                    label={
                      row.assignmentCount > 0
                        ? t('kpi.period.delete.hasAssignments', { count: row.assignmentCount })
                        : t('kpi.period.action.delete')
                    }
                    disabled={row.assignmentCount > 0}
                    tone="danger"
                    onClick={async () => {
                      try {
                        await kpiApi.deletePeriod(row.id);
                        setNotice(`${row.code} dibuang.`);
                        await load();
                      } catch (cause) {
                        setError(cause instanceof Error ? cause.message : '');
                      }
                    }}
                  />
                )}
              </RowActions>
            </td>
          </tr>
        ))}
      </RecordTable>

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
    try {
      await kpiApi.createPeriod({ code, name, fromDate, toDate, dueOn });
      await onDone(`${code.toUpperCase()} disimpan.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="kpi.period.form.title" />}
      titleText={t('kpi.period.form.title')}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k="kpi.period.form.code" />}
            value={code}
            maxLength={24}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <Field
            label={<T k="kpi.period.form.name" />}
            value={name}
            maxLength={190}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k="kpi.period.form.from" />}
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
          <Field
            label={<T k="kpi.period.form.to" />}
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </div>

        <Field
          label={<T k="kpi.period.form.due" />}
          hint={<T k="kpi.period.form.due.hint" />}
          type="date"
          value={dueOn}
          onChange={(event) => setDueOn(event.target.value)}
        />

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
 * Confirms closing a period that still has unsubmitted reviews.
 *
 * A dialog rather than a `window.confirm`, and the count is named: closing leaves those people
 * ungraded permanently, and the number is what makes that concrete.
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

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await kpiApi.setPeriodStatus(target.id, 'closed', true);
      await onDone(`${target.code} ditutup.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="kpi.period.action.close" />}
      titleText={t('kpi.period.action.close')}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
          <T k="kpi.period.close.outstanding" vars={{ count: target.outstanding }} />
        </PanelNote>

        <PanelNote>
          <T k="kpi.period.note.forward" />
        </PanelNote>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel={<T k="kpi.period.close.confirm" />}
        />
      </div>
    </Dialog>
  );
}
