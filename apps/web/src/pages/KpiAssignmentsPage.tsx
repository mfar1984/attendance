import { CircleAlert, Plus, SquarePen, Trash2, UserCheck } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
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
} from '../components/RecordPanel';
import { Badge, Button, Field } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import {
  ASSIGNMENT_STATUS_LABELS,
  formatScore,
  kpiApi,
  type AssignmentStatus,
  type KpiAssignmentPage,
  type KpiPeriod,
  type KpiTemplate,
} from '../lib/kpi-api';
import { formatDateOnly } from '../lib/operations-api';
import { T, useLabels } from '../lib/translation';

const STATUS_DOT: Record<AssignmentStatus, string> = {
  pending: 'bg-slate-400',
  inProgress: 'bg-sky-500',
  submitted: 'bg-amber-500',
  finalised: 'bg-emerald-600',
};

const STATUS_TONE: Record<AssignmentStatus, 'neutral' | 'warning' | 'success'> = {
  pending: 'neutral',
  inProgress: 'neutral',
  submitted: 'warning',
  finalised: 'success',
};

const SCREEN = 'hr.kpiAssignments';

/**
 * Who is reviewed, by whom, against which template.
 *
 * The template and its scale are frozen onto the assignment when it is created, so editing a
 * template later cannot change what somebody was assessed against.
 */
export function KpiAssignmentsPage(): ReactNode {
  const [data, setData] = useState<KpiAssignmentPage | null>(null);
  const [periods, setPeriods] = useState<KpiPeriod[]>([]);
  const [templates, setTemplates] = useState<KpiTemplate[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [status, setStatus] = useState<AssignmentStatus | undefined>(undefined);
  const [periodId, setPeriodId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { t } = useLabels();
  const { can } = useAuth();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await kpiApi.assignments({
          page,
          pageSize,
          ...(status === undefined ? {} : { status }),
          ...(periodId === '' ? {} : { periodId: Number(periodId) }),
        }),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('kpi.assignment.error.load'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, periodId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const [periodList, templateList] = await Promise.all([kpiApi.periods(), kpiApi.templates()]);
        setPeriods(periodList);
        setTemplates(templateList.filter((row) => row.active));
      } catch {
        // The create dialog states it when there is nothing to assign against.
      }
    })();
  }, []);

  const rows = data?.rows ?? [];

  return (
    <PanelCard title={<T k="kpi.assignment.title" />} subtitle={<T k="kpi.assignment.subtitle" />}>
      <PanelSection
        icon={<UserCheck className="size-4" aria-hidden />}
        title={<T k="kpi.assignment.title" />}
        action={
          can(SCREEN, 'create') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              <T k="kpi.assignment.action.new" />
            </Button>
          ) : undefined
        }
      />

      <ChipBar
        active={status}
        onChange={(id) => {
          setStatus(id as AssignmentStatus | undefined);
          setPage(1);
        }}
        chips={(
          ['pending', 'inProgress', 'submitted', 'finalised'] as AssignmentStatus[]
        ).map((key) => ({
          id: key,
          label: <T k={ASSIGNMENT_STATUS_LABELS[key]} />,
          count: data?.counts[key] ?? 0,
          dot: STATUS_DOT[key],
        }))}
      />

      <FilterRow
        dirty={status !== undefined || periodId !== ''}
        onReset={() => {
          setStatus(undefined);
          setPeriodId('');
          setPage(1);
        }}
      >
        <FacetSelect
          label={t('kpi.assignment.form.period')}
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

      <PanelBody className="space-y-2 pb-0">
        <Feedback error={error} notice={notice} />
        {/*
          Assigning takes a copy. Stated here because it is what makes the form editable later, and
          because somebody comparing an appraisal against its form will find them different.
        */}
        <PanelNote icon={<CircleAlert className="size-3.5" aria-hidden />}>
          <T k="kpi.assignment.note.snapshot" />
        </PanelNote>
        <PanelNote>
          <T k="kpi.assignment.note.oneReviewer" />
        </PanelNote>
      </PanelBody>

      <RecordTable
        loading={loading}
        rowCount={rows.length}
        empty={<T k="kpi.assignment.empty" />}
        columns={[
          { header: <T k="kpi.assignment.column.period" />, width: 'w-36' },
          { header: <T k="kpi.assignment.column.staff" /> },
          { header: <T k="kpi.assignment.column.template" />, width: 'w-40' },
          { header: <T k="kpi.assignment.column.progress" />, width: 'w-28', align: 'right' },
          { header: <T k="kpi.period.column.due" />, width: 'w-28' },
          { header: <T k="kpi.assignment.column.score" />, width: 'w-24', align: 'right' },
          { header: <T k="kpi.assignment.column.grade" />, width: 'w-20' },
          { header: <T k="panel.column.status" />, width: 'w-32' },
          { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
        ]}
      >
        {rows.map((row) => {
          const complete = row.scoredCount >= row.itemCount;
          return (
            <tr
              key={row.id}
              className={cn(
                'border-b border-slate-100 hover:bg-slate-50/70',
                row.status === 'submitted' && 'bg-amber-50/40',
              )}
            >
              <td className="px-5 py-2 font-mono text-xs text-slate-700">{row.periodCode}</td>
              <td className="px-2 py-2">
                <span className="block text-slate-800">{row.staffName}</span>
                <span className="block font-mono text-[11px] text-slate-400">{row.employeeNo}</span>
              </td>
              <td className="px-2 py-2 text-xs text-slate-600">
                <span className="block">{row.templateName}</span>
                <span className="block font-mono text-[11px] text-slate-400">
                  {row.templateCode}
                </span>
              </td>
              <td className="px-2 py-2 text-right text-xs tabular-nums">
                <span className={complete ? 'text-slate-700' : 'text-amber-700'}>
                  <T
                    k="kpi.assignment.progress"
                    vars={{ scored: row.scoredCount, total: row.itemCount }}
                  />
                </span>
              </td>
              <td className="px-2 py-2 text-xs whitespace-nowrap tabular-nums text-slate-600">
                {formatDateOnly(row.dueOn)}
              </td>
              <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-700">
                {formatScore(row.totalScore)}
              </td>
              <td className="px-2 py-2 text-xs font-medium text-slate-700">
                {row.gradeCode ?? '—'}
              </td>
              <td className="px-2 py-2">
                <Badge tone={STATUS_TONE[row.status]}>
                  <span className="uppercase">
                    <T k={ASSIGNMENT_STATUS_LABELS[row.status]} />
                  </span>
                </Badge>
              </td>
              <td className="px-2 py-2 pr-4">
                <RowActions>
                  <RowAction
                    icon={<SquarePen className="size-4" aria-hidden />}
                    label={t('kpi.assignment.action.open')}
                    onClick={() => void navigate('/hr/kpi/semakan')}
                  />
                  {can(SCREEN, 'delete') && row.status !== 'finalised' && (
                    <RowAction
                      icon={<Trash2 className="size-4" aria-hidden />}
                      label={t('kpi.assignment.action.delete')}
                      tone="danger"
                      onClick={async () => {
                        try {
                          await kpiApi.deleteAssignment(row.id);
                          setNotice(`Penilaian ${row.staffName} dibuang.`);
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
        onPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onRefresh={() => void load()}
      />

      {creating && (
        <AssignmentDialog
          periods={periods.filter((row) => row.status !== 'closed')}
          templates={templates}
          onClose={() => setCreating(false)}
          onDone={async (message) => {
            setCreating(false);
            setNotice(message);
            await load();
          }}
        />
      )}
    </PanelCard>
  );
}

function AssignmentDialog({
  periods,
  templates,
  onClose,
  onDone,
}: {
  periods: KpiPeriod[];
  templates: KpiTemplate[];
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [periodId, setPeriodId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [reviewerAccountId, setReviewerAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await kpiApi.createAssignment({
        periodId: Number(periodId),
        staffId: Number(staffId),
        templateId: Number(templateId),
        reviewerAccountId: Number(reviewerAccountId),
      });
      await onDone('Penilaian ditugaskan.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="kpi.assignment.form.title" />}
      titleText={t('kpi.assignment.form.title')}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <FacetSelect
          label={t('kpi.assignment.form.period')}
          value={periodId}
          onChange={setPeriodId}
          options={periods.map((row) => ({
            value: String(row.id),
            label: `${row.code} — ${row.name}`,
          }))}
        />

        <FacetSelect
          label={t('kpi.assignment.form.template')}
          value={templateId}
          onChange={setTemplateId}
          options={templates.map((row) => ({
            value: String(row.id),
            label: `${row.code} — ${row.name}`,
          }))}
        />

        <Field
          label={<T k="kpi.assignment.form.staff" />}
          type="number"
          inputMode="numeric"
          value={staffId}
          onChange={(event) => setStaffId(event.target.value)}
        />

        <Field
          label={<T k="kpi.assignment.form.reviewer" />}
          hint={<T k="kpi.assignment.form.reviewer.hint" />}
          type="number"
          inputMode="numeric"
          value={reviewerAccountId}
          onChange={(event) => setReviewerAccountId(event.target.value)}
        />

        <PanelNote>
          <T k="kpi.assignment.note.snapshot" />
        </PanelNote>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={
            periodId === '' || templateId === '' || staffId === '' || reviewerAccountId === ''
          }
          submitLabel={<T k="dialog.save" />}
        />
      </div>
    </Dialog>
  );
}
