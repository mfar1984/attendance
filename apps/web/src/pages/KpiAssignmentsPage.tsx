import { FileCheck, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  ChipBar,
  CodePill,
  DetailGrid,
  Detail,
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
import { StaffPicker, type PickedStaff } from '../components/StaffPicker';
import { Badge, Button, SelectField } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import {
  ASSIGNMENT_STATUS_LABELS,
  formatScore,
  kpiApi,
  type AssignmentStatus,
  type KpiAssignmentOptions,
  type KpiAssignmentPage,
  type KpiAssignmentRow,
  type KpiReviewerOption,
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

const STATUSES: AssignmentStatus[] = ['pending', 'inProgress', 'submitted', 'finalised'];

const SCREEN = 'hr.kpiAssignments';

/**
 * Who is reviewed, by whom, against which template.
 *
 * The template and its scale are frozen onto the assignment when it is created, so editing a
 * template later cannot change what somebody was assessed against. That is stated on the dialog
 * that creates one, which is the moment it matters.
 */
export function KpiAssignmentsPage(): ReactNode {
  const [data, setData] = useState<KpiAssignmentPage | null>(null);
  const [options, setOptions] = useState<KpiAssignmentOptions | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [status, setStatus] = useState<AssignmentStatus | undefined>(undefined);
  const [periodId, setPeriodId] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<KpiAssignmentRow | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();
  const navigate = useNavigate();
  // Which load is the latest, so a search answered out of order cannot replace the current rows.
  const latest = useRef(0);

  // Same debounce as the leave list: one request per pause in typing, not one per key.
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
      const result = await kpiApi.assignments({
        page,
        pageSize,
        ...(status === undefined ? {} : { status }),
        ...(periodId === '' ? {} : { periodId: Number(periodId) }),
        ...(debounced === '' ? {} : { search: debounced }),
      });
      if (mine !== latest.current) return;
      setData(result);
      setError(null);
    } catch (cause) {
      if (mine !== latest.current) return;
      setError(cause instanceof Error ? cause.message : t('kpi.assignment.error.load'));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [page, pageSize, status, periodId, debounced, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Periods and forms from this screen's own endpoint. They used to come from the period and form
   * lists, behind other screens' permissions, and a refusal there was swallowed — so a role that
   * could assign but not manage cycles saw an empty filter and was told to create periods first.
   */
  useEffect(() => {
    void (async () => {
      try {
        setOptions(await kpiApi.assignmentOptions());
      } catch (cause) {
        setOptions({ periods: [], templates: [] });
        setError(cause instanceof Error ? cause.message : t('kpi.assignment.error.load'));
      }
    })();
  }, [t]);

  const periods = options?.periods ?? [];
  const templates = options?.templates ?? [];

  const remove = async (row: KpiAssignmentRow): Promise<void> => {
    try {
      await kpiApi.deleteAssignment(row.id);
      setNotice(t('kpi.assignment.notice.removed', { name: row.staffName }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.remove'));
    }
  };

  const rows = data?.rows ?? [];
  // The heading counts every status, so choosing a chip does not make it shrink with the table.
  const count = Object.values(data?.counts ?? {}).reduce((sum, value) => sum + (value ?? 0), 0);

  return (
    <PanelCard title={<T k="kpi.assignment.title" />} subtitle={<T k="kpi.assignment.subtitle" />}>
      <PanelSection
        title={<T k="kpi.assignment.count" vars={{ count }} />}
        action={
          can(SCREEN, 'create') ? (
            // Held until the options arrive, so the dialog never opens on lists still loading.
            <Button onClick={() => setCreating(true)} disabled={options === null}>
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
        chips={STATUSES.map((key) => ({
          id: key,
          label: <T k={ASSIGNMENT_STATUS_LABELS[key]} />,
          count: data?.counts[key] ?? 0,
          dot: STATUS_DOT[key],
        }))}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('kpi.assignment.search')}
        dirty={status !== undefined || periodId !== '' || search.length > 0}
        onReset={() => {
          setStatus(undefined);
          setPeriodId('');
          setSearch('');
          setPage(1);
        }}
      >
        <FacetSelect
          label={t('kpi.assignment.filter.allPeriods')}
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

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={rows.length}
        empty={<T k="kpi.assignment.empty" />}
        columns={[
          { header: <T k="kpi.assignment.column.period" />, width: 'w-32' },
          { header: <T k="kpi.assignment.column.staff" /> },
          { header: <T k="kpi.assignment.column.template" />, width: 'w-44' },
          { header: <T k="kpi.assignment.column.reviewer" />, width: 'w-44' },
          { header: <T k="kpi.assignment.column.progress" />, width: 'w-28', align: 'right' },
          { header: <T k="kpi.period.column.due" />, width: 'w-28' },
          { header: <T k="kpi.assignment.column.score" />, width: 'w-24', align: 'right' },
          { header: <T k="kpi.assignment.column.grade" />, width: 'w-20' },
          { header: <T k="panel.column.status" />, width: 'w-32' },
          { header: <T k="panel.column.actions" />, width: 'w-24', align: 'right' },
        ]}
      >
        {rows.map((row) => {
          const complete = row.scoredCount >= row.itemCount;
          const finalised = row.status === 'finalised';
          return (
            <tr
              key={row.id}
              className={cn(
                'border-b border-slate-100 hover:bg-slate-50/70',
                // Submitted and waiting for the reviewer's sign-off is the thing to act on.
                row.status === 'submitted' && 'bg-amber-50/40',
              )}
            >
              <td className="px-5 py-2">
                <CodePill code={row.periodCode} />
              </td>
              <td className="px-2 py-2">
                <span className="block text-slate-800">{row.staffName}</span>
                <span className="block font-mono text-[11px] text-slate-400">
                  {row.employeeNo}
                  {row.departmentName !== null && ` · ${row.departmentName}`}
                </span>
              </td>
              <td className="px-2 py-2 text-xs text-slate-600">
                <span className="block">{row.templateName}</span>
                <span className="block font-mono text-[11px] text-slate-400">
                  {row.templateCode}
                </span>
              </td>
              <td className="px-2 py-2 text-xs text-slate-600">{row.reviewerName ?? '—'}</td>
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
                {/* Uppercased by the badge's class: a translated word cannot be upper-cased safely. */}
                <Badge tone={STATUS_TONE[row.status]} className="uppercase">
                  <T k={ASSIGNMENT_STATUS_LABELS[row.status]} />
                </Badge>
              </td>
              <td className="px-2 py-2 pr-4">
                <RowActions>
                  <RowAction
                    icon={<FileCheck className="size-4" aria-hidden />}
                    label={t('kpi.assignment.action.open')}
                    tone="view"
                    onClick={() => void navigate('/hr/kpi/semakan')}
                  />
                  {/*
                    Disabled with the reason rather than hidden once finalised: a finalised appraisal
                    is a grade on record. One with scores in it asks first, because deleting it
                    discards a reviewer's work.
                  */}
                  {can(SCREEN, 'delete') && (
                    <RowAction
                      icon={<Trash2 className="size-4" aria-hidden />}
                      label={
                        finalised
                          ? t('kpi.assignment.delete.finalised')
                          : t('kpi.assignment.action.delete')
                      }
                      tone="danger"
                      disabled={finalised}
                      onClick={() => {
                        if (row.scoredCount > 0) setRemoving(row);
                        else void remove(row);
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

      {removing !== null && (
        <RemoveDialog
          target={removing}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const target = removing;
            setRemoving(null);
            await remove(target);
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
  periods: KpiAssignmentOptions['periods'];
  templates: KpiAssignmentOptions['templates'];
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [staff, setStaff] = useState<PickedStaff | null>(null);
  const [periodId, setPeriodId] = useState(periods.length === 1 ? String(periods[0]?.id) : '');
  const [templateId, setTemplateId] = useState('');
  const [reviewers, setReviewers] = useState<KpiReviewerOption[] | null>(null);
  const [reviewerAccountId, setReviewerAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  useEffect(() => {
    void (async () => {
      try {
        setReviewers(await kpiApi.reviewers());
      } catch (cause) {
        setReviewers([]);
        setError(cause instanceof Error ? cause.message : null);
      }
    })();
  }, []);

  /*
   * Nobody reviews themselves. Offered but not selectable rather than removed, so the list does not
   * change shape under somebody who picked the person first.
   */
  const reviewer = reviewers?.find((row) => String(row.id) === reviewerAccountId) ?? null;
  const selfReview = staff !== null && reviewer !== null && reviewer.staffId === staff.id;

  const submit = async (): Promise<void> => {
    if (staff === null || reviewer === null) return;
    setBusy(true);
    try {
      await kpiApi.createAssignment({
        periodId: Number(periodId),
        staffId: staff.id,
        templateId: Number(templateId),
        reviewerAccountId: reviewer.id,
      });
      await onDone(
        t('kpi.assignment.notice.created', { name: staff.fullName, reviewer: reviewer.label }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  const nothingToAssign = periods.length === 0 || templates.length === 0;

  return (
    <Dialog
      title={<T k="kpi.assignment.form.create" />}
      titleText={t('kpi.assignment.form.create')}
      description={<T k="kpi.assignment.note.snapshot" />}
      width="2xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {nothingToAssign && (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="kpi.assignment.form.nothingToAssign" />
          </PanelNote>
        )}

        {/* Name first, then the form — the same two stages as every request form. */}
        <StaffPicker
          value={staff}
          onChange={setStaff}
          search={kpiApi.searchStaff}
          hint={<T k="kpi.assignment.form.staff.hint" />}
        />

        {staff !== null && (
          <>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <SelectField
                label={<T k="kpi.assignment.form.period" />}
                value={periodId}
                onChange={(event) => setPeriodId(event.target.value)}
              >
                {/* A prompt, not a choice: saving stays disabled until a period is picked. */}
                <option value="">{t('kpi.assignment.form.period')}</option>
                {periods.map((row) => (
                  <option key={row.id} value={String(row.id)}>
                    {`${row.code} — ${row.name}`}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label={<T k="kpi.assignment.form.template" />}
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
              >
                <option value="">{t('kpi.assignment.form.template')}</option>
                {templates.map((row) => (
                  <option key={row.id} value={String(row.id)}>
                    {`${row.code} — ${row.name}`}
                  </option>
                ))}
              </SelectField>
            </div>

            {/* The last block before the footer, so it carries the `pb-2`. */}
            <div className="space-y-2 pb-2">
              <SelectField
                label={<T k="kpi.assignment.form.reviewer" />}
                hint={
                  reviewers !== null && reviewers.length === 0 ? (
                    <T k="kpi.assignment.form.reviewer.none" />
                  ) : (
                    <T k="kpi.assignment.form.reviewer.hint" />
                  )
                }
                value={reviewerAccountId}
                onChange={(event) => setReviewerAccountId(event.target.value)}
                disabled={reviewers === null || reviewers.length === 0}
              >
                <option value="">{t('kpi.assignment.form.reviewer')}</option>
                {(reviewers ?? []).map((row) => (
                  <option key={row.id} value={String(row.id)} disabled={row.staffId === staff.id}>
                    {`${row.label} — ${row.roleName}`}
                  </option>
                ))}
              </SelectField>

              {selfReview && (
                <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                  <T k="kpi.assignment.form.selfReview" />
                </PanelNote>
              )}
            </div>

            <DialogFooter
              onClose={onClose}
              onSubmit={() => void submit()}
              busy={busy}
              disabled={
                periodId === '' || templateId === '' || reviewerAccountId === '' || selfReview
              }
              submitLabel={<T k="kpi.assignment.action.new" />}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}

/**
 * The second step of removing an appraisal that already has scores in it.
 *
 * Its questions go with it, and so does whatever the reviewer has answered; nothing restores that.
 * An appraisal nobody has started is removed at once — there is nothing in it to lose.
 */
function RemoveDialog({
  target,
  onClose,
  onConfirm,
}: {
  target: KpiAssignmentRow;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const { t } = useLabels();

  return (
    <Dialog
      title={<T k="kpi.assignment.remove.title" vars={{ name: target.staffName }} />}
      titleText={t('kpi.assignment.remove.title', { name: target.staffName })}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <DetailGrid>
          <Detail label={<T k="kpi.assignment.column.period" />} value={target.periodCode} />
          <Detail label={<T k="kpi.assignment.column.template" />} value={target.templateCode} />
          <Detail
            label={<T k="kpi.assignment.column.progress" />}
            value={
              <T
                k="kpi.assignment.progress"
                vars={{ scored: target.scoredCount, total: target.itemCount }}
              />
            }
          />
        </DetailGrid>

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="pb-2">
          <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="kpi.assignment.remove.body" vars={{ count: target.scoredCount }} />
          </PanelNote>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => {
            setBusy(true);
            void onConfirm();
          }}
          busy={busy}
          submitLabel={<T k="app.remove" />}
        />
      </div>
    </Dialog>
  );
}
