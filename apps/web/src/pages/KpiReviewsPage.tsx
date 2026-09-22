import {
  CircleAlert,
  MessageSquareCheck,
  RotateCcw,
  Save,
  Send,
  SquareCheck,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

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
  SCORE_MAX,
  formatScore,
  kpiApi,
  runningScore,
  type AssignmentStatus,
  type KpiAssignmentPage,
  type KpiAssignmentRow,
  type ReviewForm,
} from '../lib/kpi-api';
import { formatDateOnly } from '../lib/operations-api';
import { T, useLabels } from '../lib/translation';

const STATUS_DOT: Record<AssignmentStatus, string> = {
  pending: 'bg-slate-400',
  inProgress: 'bg-sky-500',
  submitted: 'bg-amber-500',
  finalised: 'bg-emerald-600',
};

const SCREEN = 'hr.kpiReviews';

/**
 * The review queue, and the form behind each row.
 *
 * `Hanya penilaian saya` defaults on. A reviewer opening this screen is here to fill in their own
 * assessments, and a list of everybody's is a list they have to filter before it is useful.
 */
export function KpiReviewsPage(): ReactNode {
  const [data, setData] = useState<KpiAssignmentPage | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [status, setStatus] = useState<AssignmentStatus | undefined>(undefined);
  const [mine, setMine] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filling, setFilling] = useState<KpiAssignmentRow | null>(null);
  const [reopening, setReopening] = useState<KpiAssignmentRow | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await kpiApi.assignments({
          page,
          pageSize,
          mine,
          ...(status === undefined ? {} : { status }),
        }),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('kpi.assignment.error.load'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, mine, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];

  return (
    <PanelCard title={<T k="kpi.review.title" />} subtitle={<T k="kpi.review.subtitle" />}>
      <PanelSection
        icon={<MessageSquareCheck className="size-4" aria-hidden />}
        title={<T k="kpi.review.title" />}
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
        dirty={status !== undefined || !mine}
        onReset={() => {
          setStatus(undefined);
          setMine(true);
          setPage(1);
        }}
      >
        <FacetSelect
          label={t('kpi.review.filter.mine')}
          value={mine ? 'mine' : 'all'}
          onChange={(value) => {
            setMine(value === 'mine');
            setPage(1);
          }}
          options={[
            { value: 'mine', label: t('kpi.review.filter.mine') },
            { value: 'all', label: t('kpi.review.filter.all') },
          ]}
        />
      </FilterRow>

      <PanelBody className="space-y-2 pb-0">
        <Feedback error={error} notice={notice} />
        <PanelNote icon={<CircleAlert className="size-3.5" aria-hidden />}>
          <T k="kpi.review.note.reviewerOnly" />
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
          { header: <T k="panel.column.actions" />, width: 'w-32', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <tr
            key={row.id}
            className={cn(
              'border-b border-slate-100 hover:bg-slate-50/70',
              row.status === 'submitted' && 'bg-amber-50/40',
              row.status === 'finalised' && 'text-slate-400',
            )}
          >
            <td className="px-5 py-2 font-mono text-xs text-slate-700">{row.periodCode}</td>
            <td className="px-2 py-2">
              <span className="block text-slate-800">{row.staffName}</span>
              <span className="block font-mono text-[11px] text-slate-400">{row.employeeNo}</span>
            </td>
            <td className="px-2 py-2 text-xs text-slate-600">{row.templateName}</td>
            <td className="px-2 py-2 text-right text-xs tabular-nums">
              <span
                className={
                  row.scoredCount >= row.itemCount ? 'text-slate-700' : 'text-amber-700'
                }
              >
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
              <Badge
                tone={
                  row.status === 'finalised'
                    ? 'success'
                    : row.status === 'submitted'
                      ? 'warning'
                      : 'neutral'
                }
              >
                <span className="uppercase">
                  <T k={ASSIGNMENT_STATUS_LABELS[row.status]} />
                </span>
              </Badge>
            </td>
            <td className="px-2 py-2 pr-4">
              <RowActions>
                <RowAction
                  icon={<Save className="size-4" aria-hidden />}
                  label={t('kpi.assignment.action.open')}
                  onClick={() => setFilling(row)}
                />
                {row.status === 'submitted' && can(SCREEN, 'approve') && (
                  <>
                    <RowAction
                      icon={<SquareCheck className="size-4" aria-hidden />}
                      label={t('kpi.review.action.finalise')}
                      tone="success"
                      onClick={async () => {
                        try {
                          await kpiApi.finaliseReview(row.id);
                          setNotice(t('kpi.review.finalised'));
                          await load();
                        } catch (cause) {
                          setError(cause instanceof Error ? cause.message : '');
                        }
                      }}
                    />
                    <RowAction
                      icon={<RotateCcw className="size-4" aria-hidden />}
                      label={t('kpi.review.action.reopen')}
                      tone="warn"
                      onClick={() => setReopening(row)}
                    />
                  </>
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
        onPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onRefresh={() => void load()}
      />

      {filling !== null && (
        <ReviewDialog
          assignmentId={filling.id}
          onClose={() => setFilling(null)}
          onDone={async (message) => {
            setFilling(null);
            setNotice(message);
            await load();
          }}
        />
      )}

      {reopening !== null && (
        <ReopenDialog
          target={reopening}
          onClose={() => setReopening(null)}
          onDone={async (message) => {
            setReopening(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </PanelCard>
  );
}

/**
 * The scoring form.
 *
 * Saved partially and submitted whole. A reviewer works through this over more than one sitting,
 * and completeness is only checked at submission — which is the point where an omission would
 * become permanent, because a missing competency scores zero.
 */
function ReviewDialog({
  assignmentId,
  onClose,
  onDone,
}: {
  assignmentId: number;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [form, setForm] = useState<ReviewForm | null>(null);
  const [scores, setScores] = useState<Record<number, string>>({});
  const [comments, setComments] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  useEffect(() => {
    void (async () => {
      try {
        const result = await kpiApi.review(assignmentId);
        setForm(result);
        setScores(
          Object.fromEntries(
            result.items.map((item) => [item.scoreId, item.score === null ? '' : String(item.score)]),
          ),
        );
        setComments(
          Object.fromEntries(result.items.map((item) => [item.scoreId, item.comment ?? ''])),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : null);
      }
    })();
  }, [assignmentId]);

  const locked = form?.status === 'finalised' || form?.periodStatus !== 'open';

  const scored = form === null ? 0 : form.items.filter((item) => scores[item.scoreId] !== '').length;

  /*
   * The running total, computed the same way the server will.
   *
   * Shown while scoring so the figure is not a surprise at submission. Partial while items are
   * unscored, and labelled as partial — a percentage that silently treats unscored items as zero
   * would read as a finished result.
   */
  const runningTotal =
    form === null
      ? null
      : runningScore(
          form.items.map((item) => {
            const raw = scores[item.scoreId] ?? '';
            const parsed = Number(raw);
            return {
              score: raw === '' || !Number.isFinite(parsed) ? null : parsed,
              weight: item.weight,
            };
          }),
        );

  const save = async (): Promise<void> => {
    if (form === null) return;
    setBusy(true);
    try {
      const payload = form.items
        .filter((item) => scores[item.scoreId] !== '' && scores[item.scoreId] !== undefined)
        .map((item) => ({
          scoreId: item.scoreId,
          score: Number(scores[item.scoreId]),
          ...(comments[item.scoreId] ? { comment: comments[item.scoreId] as string } : {}),
        }));

      await kpiApi.saveScores(assignmentId, payload);
      await onDone(t('kpi.review.saved'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  const submit = async (): Promise<void> => {
    if (form === null) return;
    setBusy(true);
    try {
      // Saved first: submission validates what is stored, not what is on screen.
      const payload = form.items
        .filter((item) => scores[item.scoreId] !== '' && scores[item.scoreId] !== undefined)
        .map((item) => ({
          scoreId: item.scoreId,
          score: Number(scores[item.scoreId]),
          ...(comments[item.scoreId] ? { comment: comments[item.scoreId] as string } : {}),
        }));
      await kpiApi.saveScores(assignmentId, payload);

      const result = await kpiApi.submitReview(assignmentId);
      await onDone(
        t('kpi.review.submitted', {
          total: result.totalScore.toFixed(2),
          grade: result.gradeCode,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={
        form === null ? (
          <T k="app.loading" />
        ) : (
          <T k="kpi.review.form.title" vars={{ staffName: form.staffName }} />
        )
      }
      titleText={form === null ? t('app.loading') : t('kpi.review.form.title', { staffName: form.staffName })}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {form !== null && (
          <>
            {locked && (
              <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                <T k="kpi.review.note.locked" />
              </PanelNote>
            )}

            {/*
              These questions are this appraisal's own copy, taken when it was assigned.

              Worth saying on the form: somebody comparing it against the template will find them
              different once the template has moved on, and that is the design rather than a fault.
            */}
            <PanelNote>
              <T k="kpi.review.note.snapshot" />
            </PanelNote>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] tracking-wide text-slate-500 uppercase">
                  <th className="pb-1.5">
                    <T k="kpi.review.form.item" />
                  </th>
                  <th className="w-20 pb-1.5 text-right">
                    <T k="kpi.review.form.weight" />
                  </th>
                  <th className="w-28 pb-1.5">
                    <T k="kpi.review.form.score" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {form.items.map((item) => (
                  <tr key={item.scoreId} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-2">
                      <span className="block text-slate-800">{item.competencyName}</span>
                      {item.description !== null && (
                        <span className="block text-[11px] text-slate-400">{item.description}</span>
                      )}
                      <input
                        value={comments[item.scoreId] ?? ''}
                        disabled={locked}
                        maxLength={500}
                        placeholder={t('kpi.review.form.comment')}
                        onChange={(event) =>
                          setComments((current) => ({
                            ...current,
                            [item.scoreId]: event.target.value,
                          }))
                        }
                        className="mt-1.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="py-2 text-right text-xs tabular-nums text-slate-600">
                      {item.weight.toFixed(2)}%
                    </td>
                    <td className="py-2">
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        max={SCORE_MAX}
                        value={scores[item.scoreId] ?? ''}
                        disabled={locked}
                        onChange={(event) =>
                          setScores((current) => ({
                            ...current,
                            [item.scoreId]: event.target.value,
                          }))
                        }
                        className="w-full rounded border border-slate-300 px-2 py-1 text-sm tabular-nums"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/*
              The running total, over answered lines only.

              Counting an unanswered line as zero would show a reviewer 12% after their first answer
              of 60 — a figure that is not wrong so much as about a different question. The hint says
              so, because a percentage that ignores part of the form has to explain itself.
            */}
            <PanelNote tone={scored === form.items.length ? 'success' : 'info'}>
              {runningTotal === null ? (
                <T k="kpi.review.form.unanswered" />
              ) : scored === form.items.length ? (
                <T k="kpi.review.form.running" vars={{ total: runningTotal.toFixed(2) }} />
              ) : (
                <T
                  k="kpi.review.form.running.partial"
                  vars={{
                    total: runningTotal.toFixed(2),
                    scored,
                    total_items: form.items.length,
                  }}
                />
              )}
            </PanelNote>
            {scored > 0 && scored < form.items.length && (
              <PanelNote>
                <T k="kpi.review.form.running.hint" />
              </PanelNote>
            )}

            {form.decisionNote !== null && (
              <PanelNote tone="warn">{form.decisionNote}</PanelNote>
            )}

            {!locked && (
              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
                <Button variant="ghost" disabled={busy} onClick={() => void save()}>
                  <Save className="size-4" aria-hidden />
                  <T k="kpi.review.action.save" />
                </Button>
                <Button
                  /*
                   * Disabled with the reason in the title, not enabled and then a 409.
                   *
                   * The server refuses an incomplete submission, and the reviewer looking at a
                   * greyed-out button needs to be told which part is missing — the count is the
                   * answer, and it is the same sentence the refusal would have used.
                   */
                  disabled={busy || scored < form.items.length}
                  title={
                    scored < form.items.length
                      ? t('kpi.review.incomplete', { scored, total: form.items.length })
                      : undefined
                  }
                  onClick={() => void submit()}
                >
                  <Send className="size-4" aria-hidden />
                  <T k="kpi.review.action.submit" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function ReopenDialog({
  target,
  onClose,
  onDone,
}: {
  target: KpiAssignmentRow;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await kpiApi.reopenReview(target.id, note);
      await onDone(t('kpi.review.reopened'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="kpi.review.action.reopen" />}
      titleText={t('kpi.review.action.reopen')}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
          <T k="kpi.review.reopen.hint" />
        </PanelNote>

        <Field
          label={<T k="kpi.review.reopen.note" />}
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={note.trim().length < 3}
          submitLabel={<T k="kpi.review.action.reopen" />}
        />
      </div>
    </Dialog>
  );
}
