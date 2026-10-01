import type { LabelKey } from '@attendance/shared';
import { CircleCheck, Eye, Pencil, TriangleAlert, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

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
  RecordTable,
  RowAction,
  RowActions,
} from '../components/RecordPanel';
import { Badge, Button, Field, TextArea } from '../components/ui';
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

const STATUS_TONE: Record<AssignmentStatus, 'neutral' | 'warning' | 'success'> = {
  pending: 'neutral',
  inProgress: 'neutral',
  submitted: 'warning',
  finalised: 'success',
};

const STATUSES: AssignmentStatus[] = ['pending', 'inProgress', 'submitted', 'finalised'];

const SCREEN = 'hr.kpiReviews';

type Scope = 'mine' | 'all';

/**
 * The review queue, and the form behind each row.
 *
 * Read from `/api/kpi-reviews`, behind this screen's own permission. It used to read the assignment
 * list, which is behind `hr.kpiAssignments`, so a reviewer whose role could fill in reviews but not
 * manage assignments was refused the list of the reviews they had been named on.
 *
 * "Only my appraisals" is the default and, for most roles, the only view: a reviewer is here to
 * fill in their own. Every reviewer's is offered only to a role that can finalise, because the
 * server refuses it to anybody else — a choice that answers 403 is a trap, not a filter.
 */
export function KpiReviewsPage(): ReactNode {
  const [data, setData] = useState<KpiAssignmentPage | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [status, setStatus] = useState<AssignmentStatus | undefined>(undefined);
  const [scope, setScope] = useState<Scope>('mine');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opening, setOpening] = useState<KpiAssignmentRow | null>(null);
  const [finalising, setFinalising] = useState<KpiAssignmentRow | null>(null);
  const [reopening, setReopening] = useState<KpiAssignmentRow | null>(null);
  const { t } = useLabels();
  const { can, session } = useAuth();
  const canFinalise = can(SCREEN, 'approve');
  const accountId = session?.accountId ?? null;
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
      const result = await kpiApi.reviews({
        page,
        pageSize,
        scope,
        ...(status === undefined ? {} : { status }),
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
  }, [page, pageSize, scope, status, debounced, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const done = async (message: string): Promise<void> => {
    setOpening(null);
    setFinalising(null);
    setReopening(null);
    setNotice(message);
    await load();
  };

  const rows = data?.rows ?? [];
  // The heading counts every status, so choosing a chip does not make it shrink with the table.
  const count = Object.values(data?.counts ?? {}).reduce((sum, value) => sum + (value ?? 0), 0);
  // Somebody else's reviews only appear when every reviewer's are listed, and then the name matters.
  const showReviewer = scope === 'all';

  return (
    <PanelCard title={<T k="kpi.review.title" />} subtitle={<T k="kpi.review.subtitle" />}>
      <PanelSection title={<T k="kpi.assignment.count" vars={{ count }} />} />

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
        dirty={status !== undefined || scope !== 'mine' || search.length > 0}
        onReset={() => {
          setStatus(undefined);
          setScope('mine');
          setSearch('');
          setPage(1);
        }}
      >
        {/*
          A facet whose empty option means "every reviewer's", which is what empty means on every
          other facet. The earlier select labelled its empty option "only mine" while meaning all.
        */}
        {canFinalise && (
          <FacetSelect
            label={t('kpi.review.filter.all')}
            value={scope === 'mine' ? 'mine' : ''}
            onChange={(value) => {
              setScope(value === 'mine' ? 'mine' : 'all');
              setPage(1);
            }}
            options={[{ value: 'mine', label: t('kpi.review.filter.mine') }]}
          />
        )}
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
          ...(showReviewer
            ? [{ header: <T k="kpi.assignment.column.reviewer" />, width: 'w-44' }]
            : []),
          { header: <T k="kpi.assignment.column.progress" />, width: 'w-28', align: 'right' as const },
          { header: <T k="kpi.period.column.due" />, width: 'w-28' },
          { header: <T k="kpi.assignment.column.score" />, width: 'w-24', align: 'right' as const },
          { header: <T k="kpi.assignment.column.grade" />, width: 'w-20' },
          { header: <T k="panel.column.status" />, width: 'w-32' },
          { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' as const },
        ]}
      >
        {rows.map((row) => {
          const fillable = accountId !== null && reviewLock(row, accountId, can(SCREEN, 'edit')) === null;
          const decidable = row.status === 'submitted' && canFinalise;
          return (
            <tr
              key={row.id}
              className={cn(
                'border-b border-slate-100 hover:bg-slate-50/70',
                // Submitted and waiting for sign-off is the thing to act on.
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
              {showReviewer && (
                <td className="px-2 py-2 text-xs text-slate-600">{row.reviewerName ?? '—'}</td>
              )}
              <td className="px-2 py-2 text-right text-xs tabular-nums">
                <span
                  className={row.scoredCount >= row.itemCount ? 'text-slate-700' : 'text-amber-700'}
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
                {/* Uppercased by the badge's class: a translated word cannot be upper-cased safely. */}
                <Badge tone={STATUS_TONE[row.status]} className="uppercase">
                  <T k={ASSIGNMENT_STATUS_LABELS[row.status]} />
                </Badge>
              </td>
              <td className="px-2 py-2 pr-4">
                <RowActions>
                  {/*
                    One control, two readings: amber to fill in when this account can write to it,
                    blue to read when it cannot. The dialog states which reason applies.
                  */}
                  <RowAction
                    icon={
                      fillable ? (
                        <Pencil className="size-4" aria-hidden />
                      ) : (
                        <Eye className="size-4" aria-hidden />
                      )
                    }
                    label={fillable ? t('kpi.review.action.fill') : t('kpi.review.action.view')}
                    tone={fillable ? 'edit' : 'view'}
                    onClick={() => setOpening(row)}
                  />
                  {decidable && (
                    <>
                      <RowAction
                        icon={<CircleCheck className="size-4" aria-hidden />}
                        label={t('kpi.review.action.finalise')}
                        tone="success"
                        onClick={() => setFinalising(row)}
                      />
                      {/*
                        Not in a closed period: scoring is refused there, so a review sent back
                        could never be answered. Greyed with the reason, as the server refuses it.
                      */}
                      <RowAction
                        icon={<Undo2 className="size-4" aria-hidden />}
                        label={
                          row.periodStatus === 'open'
                            ? t('kpi.review.action.reopen')
                            : t('kpi.review.reopen.closed')
                        }
                        tone="warn"
                        disabled={row.periodStatus !== 'open'}
                        onClick={() => setReopening(row)}
                      />
                    </>
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

      {opening !== null && accountId !== null && (
        <ReviewDialog
          target={opening}
          accountId={accountId}
          canEdit={can(SCREEN, 'edit')}
          onClose={() => setOpening(null)}
          onDone={done}
          onChanged={() => void load()}
        />
      )}

      {finalising !== null && (
        <FinaliseDialog target={finalising} onClose={() => setFinalising(null)} onDone={done} />
      )}

      {reopening !== null && (
        <ReopenDialog target={reopening} onClose={() => setReopening(null)} onDone={done} />
      )}
    </PanelCard>
  );
}

/**
 * Why this account cannot write to this appraisal, or null when it can.
 *
 * The same order the server checks in, so the reason on the screen is the reason a save would have
 * been refused with. Read from the row on the list and from the form in the dialog — both carry the
 * four facts it needs.
 */
function reviewLock(
  row: Pick<KpiAssignmentRow, 'status' | 'periodStatus' | 'reviewerAccountId'>,
  accountId: number,
  canEdit: boolean,
): LabelKey | null {
  if (row.status === 'finalised') return 'kpi.review.note.locked';
  if (row.periodStatus !== 'open') return 'kpi.review.note.periodClosed';
  // Submission froze the total and the grade; changing it is what reopening is for.
  if (row.status === 'submitted') return 'kpi.review.note.submitted';
  if (row.reviewerAccountId !== accountId) return 'kpi.review.note.reviewerOnly';
  if (!canEdit) return 'kpi.review.note.noEdit';
  return null;
}

/** A typed score is usable when it is blank or a number inside the scale. */
function scoreFault(raw: string): boolean {
  if (raw.trim() === '') return false;
  const value = Number(raw);
  return !Number.isFinite(value) || value < 0 || value > SCORE_MAX;
}

/**
 * The scoring form.
 *
 * Saved partially and submitted whole. A reviewer works through this over more than one sitting,
 * and completeness is only checked at submission — which is the point where an omission would
 * become permanent, because a missing competency drops out of the total.
 *
 * Read-only for anybody who cannot write to it, with the reason as the one note on the form. The
 * person who finalises opens it here to read the answers before signing.
 */
function ReviewDialog({
  target,
  accountId,
  canEdit,
  onClose,
  onDone,
  onChanged,
}: {
  target: KpiAssignmentRow;
  accountId: number;
  canEdit: boolean;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
  /** Something was stored without the dialog finishing, so the list behind it is stale. */
  onChanged: () => void;
}): ReactNode {
  const [form, setForm] = useState<ReviewForm | null>(null);
  const [scores, setScores] = useState<Record<number, string>>({});
  const [comments, setComments] = useState<Record<number, string>>({});
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  useEffect(() => {
    void (async () => {
      try {
        const result = await kpiApi.review(target.id);
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
        setError(cause instanceof Error ? cause.message : t('kpi.assignment.error.load'));
      }
    })();
  }, [target.id, t]);

  const lock = form === null ? null : reviewLock(form, accountId, canEdit);
  const editable = form !== null && lock === null;

  const items = form?.items ?? [];
  const answered = items.filter((item) => (scores[item.scoreId] ?? '').trim() !== '');
  const scored = answered.length;
  const complete = items.length > 0 && scored === items.length;
  const invalid = items.some((item) => scoreFault(scores[item.scoreId] ?? ''));

  /*
   * The running total, computed the same way the server will.
   *
   * Over answered lines only. Counting an unanswered line as zero would show a reviewer 12% after
   * their first answer of 60 — a figure that is not wrong so much as about a different question. The
   * strip says so while the form is partial, because a percentage that ignores part of the form has
   * to explain itself.
   */
  const runningTotal = runningScore(
    items.map((item) => {
      const raw = (scores[item.scoreId] ?? '').trim();
      const parsed = Number(raw);
      return {
        score: raw === '' || !Number.isFinite(parsed) ? null : parsed,
        weight: item.weight,
      };
    }),
  );
  // Once submitted the stored figure is the record; before that, the live one is.
  const shownTotal = editable ? runningTotal : (form?.totalScore ?? runningTotal);

  /*
   * Every line, not only the answered ones.
   *
   * A blank sends `null`, which clears what was stored, and a comment travels even on a line not
   * yet scored. Sending answered lines only meant an emptied score came back on reopening and a
   * comment on an unanswered line was dropped, while the notice counted both as saved.
   */
  const payload = (): Array<{ scoreId: number; score: number | null; comment?: string }> =>
    items.map((item) => {
      const raw = (scores[item.scoreId] ?? '').trim();
      const comment = (comments[item.scoreId] ?? '').trim();
      return {
        scoreId: item.scoreId,
        score: raw === '' ? null : Number(raw),
        ...(comment === '' ? {} : { comment }),
      };
    });

  const save = async (): Promise<void> => {
    if (form === null) return;
    setBusy(true);
    setError(null);
    try {
      await kpiApi.saveScores(target.id, payload());
      await onDone(
        t('kpi.review.notice.saved', { name: form.staffName, scored, total: items.length }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  const submit = async (): Promise<void> => {
    if (form === null) return;
    setBusy(true);
    setError(null);
    let stored = false;
    try {
      // Saved first: submission validates what is stored, not what is on screen.
      await kpiApi.saveScores(target.id, payload());
      stored = true;
      const result = await kpiApi.submitReview(target.id);
      await onDone(
        t('kpi.review.notice.submitted', {
          name: form.staffName,
          total: result.totalScore.toFixed(2),
          grade: result.gradeCode,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
      /*
       * The answers were stored even though the submission was refused (a band fault, say), and
       * the first save moves a review out of "not started". Reload the list behind the dialog so
       * the row says what is now true.
       */
      if (stored) onChanged();
    }
  };

  const titleVars = { staffName: form?.staffName ?? target.staffName };

  return (
    <Dialog
      title={<T k="kpi.review.form.title" vars={titleVars} />}
      titleText={t('kpi.review.form.title', titleVars)}
      // A caveat about the form itself: somebody comparing it against the template will find the
      // two different once the template has moved on, and that is the design rather than a fault.
      description={<T k="kpi.review.note.snapshot" />}
      width="2xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {form === null ? (
          error === null && (
            <p className="text-sm text-slate-500">
              <T k="app.loading" />
            </p>
          )
        ) : (
          <>
            <DetailGrid>
              <Detail
                label={<T k="kpi.assignment.column.period" />}
                value={`${form.periodCode} — ${form.periodName}`}
              />
              <Detail
                label={<T k="kpi.assignment.column.template" />}
                value={`${form.templateCode} — ${form.templateName}`}
              />
              <Detail label={<T k="kpi.period.column.due" />} value={formatDateOnly(form.dueOn)} />
            </DetailGrid>

            {/* At most one reason, and only when this account cannot write. */}
            {lock !== null && (
              <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                <T k={lock} vars={{ code: form.periodCode }} />
              </PanelNote>
            )}

            {/*
              The note written when the review was sent back, or when it was finalised. The reviewer
              looking again needs to read why before changing anything.
            */}
            {form.decisionNote !== null && (
              <PanelNote tone={form.status === 'finalised' ? 'info' : 'warn'}>
                <T
                  k={
                    form.status === 'finalised'
                      ? 'kpi.review.form.decisionNote'
                      : 'kpi.review.form.reopenedBecause'
                  }
                  vars={{ note: form.decisionNote }}
                />
              </PanelNote>
            )}

            {/* ── The competencies ── */}
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">
                  <T k="kpi.review.form.item" />
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  <T k="kpi.review.form.items.hint" />
                </p>
              </div>
              <span
                className={cn(
                  'shrink-0 text-xs tabular-nums',
                  complete ? 'text-slate-600' : 'text-amber-700',
                )}
              >
                <T k="kpi.assignment.progress" vars={{ scored, total: items.length }} />
              </span>
            </div>

            <div className="space-y-3">
              {items.map((item) => {
                const raw = scores[item.scoreId] ?? '';
                return (
                  <div
                    key={item.scoreId}
                    className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-3"
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{item.competencyName}</p>
                        {item.description !== null && (
                          <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-slate-600">
                        <T k="kpi.review.form.weightOf" vars={{ weight: item.weight.toFixed(2) }} />
                      </span>
                    </div>

                    {editable ? (
                      <div className="grid items-start gap-3 sm:grid-cols-[9rem_1fr]">
                        <Field
                          label={<T k="kpi.review.form.score" />}
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min={0}
                          max={SCORE_MAX}
                          value={raw}
                          {...(scoreFault(raw)
                            ? { error: t('kpi.review.form.score.range', { max: SCORE_MAX }) }
                            : {})}
                          onChange={(event) => {
                            setTouched(true);
                            setScores((current) => ({
                              ...current,
                              [item.scoreId]: event.target.value,
                            }));
                          }}
                        />
                        <Field
                          label={<T k="kpi.review.form.comment" />}
                          value={comments[item.scoreId] ?? ''}
                          maxLength={500}
                          onChange={(event) => {
                            setTouched(true);
                            setComments((current) => ({
                              ...current,
                              [item.scoreId]: event.target.value,
                            }));
                          }}
                        />
                      </div>
                    ) : (
                      <DetailGrid>
                        <Detail
                          label={<T k="kpi.review.form.score" />}
                          value={
                            item.score === null ? (
                              <T k="kpi.review.form.unanswered" />
                            ) : (
                              item.score.toFixed(2)
                            )
                          }
                        />
                        <Detail
                          label={<T k="kpi.review.form.comment" />}
                          value={item.comment ?? '—'}
                        />
                      </DetailGrid>
                    )}
                  </div>
                );
              })}
            </div>

            {/*
              The last block before the footer, so it carries the `pb-2`.

              The total on a tinted strip, because it is the figure that becomes a grade and it should
              be the last thing read before submitting. Green once every line is answered.
            */}
            <div className="pb-2">
              <div
                className={cn(
                  'flex flex-wrap items-baseline justify-between gap-2 rounded-lg border px-3 py-2.5',
                  complete
                    ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
                    : 'border-slate-200 bg-slate-50 text-slate-700',
                )}
              >
                <span className="text-sm font-medium">
                  <T k="kpi.review.form.total" />
                </span>
                <span className="text-lg font-semibold tabular-nums">
                  {shownTotal === null ? (
                    <T k="kpi.review.form.unanswered" />
                  ) : (
                    formatScore(shownTotal)
                  )}
                </span>
                {form.gradeCode !== null ? (
                  <span className="w-full text-xs">
                    <T k="kpi.review.form.gradeFrozen" vars={{ grade: form.gradeCode }} />
                  </span>
                ) : (
                  scored > 0 &&
                  !complete && (
                    <span className="w-full text-xs">
                      <T k="kpi.review.form.running.hint" />
                    </span>
                  )
                )}
              </div>
            </div>

            {editable ? (
              <DialogFooter
                onClose={onClose}
                onSubmit={() => void submit()}
                busy={busy}
                disabled={!complete || invalid}
                /*
                 * Disabled with the reason on the button, not enabled and then a 409. The count is
                 * the answer, and it is the same sentence the refusal would have used.
                 */
                {...(complete
                  ? {}
                  : { submitTitle: t('kpi.review.incomplete', { scored, total: items.length }) })}
                submitLabel={<T k="kpi.review.action.submit" />}
                secondary={
                  <Button
                    variant="ghost"
                    disabled={busy || invalid || !touched}
                    onClick={() => void save()}
                  >
                    <T k="kpi.review.action.save" />
                  </Button>
                }
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

/**
 * Finalising: the grade becomes a record.
 *
 * Its own step rather than a click on the row. After this nothing reopens or removes the appraisal,
 * and the person assessed is told — so the score and grade being signed are shown, and the note
 * that goes with them is written here.
 */
function FinaliseDialog({
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
    setError(null);
    try {
      const trimmed = note.trim();
      await kpiApi.finaliseReview(target.id, trimmed === '' ? undefined : trimmed);
      await onDone(
        t('kpi.review.notice.finalised', {
          name: target.staffName,
          grade: target.gradeCode ?? '—',
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="kpi.review.finalise.title" vars={{ name: target.staffName }} />}
      titleText={t('kpi.review.finalise.title', { name: target.staffName })}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <DetailGrid>
          <Detail label={<T k="kpi.assignment.column.period" />} value={target.periodCode} />
          <Detail
            label={<T k="kpi.assignment.column.score" />}
            value={formatScore(target.totalScore)}
          />
          <Detail label={<T k="kpi.assignment.column.grade" />} value={target.gradeCode ?? '—'} />
        </DetailGrid>

        <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
          <T k="kpi.review.finalise.warning" />
        </PanelNote>

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="pb-2">
          <TextArea
            label={<T k="kpi.review.finalise.note" />}
            hint={<T k="kpi.review.finalise.note.hint" />}
            rows={2}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel={<T k="kpi.review.action.finalise" />}
        />
      </div>
    </Dialog>
  );
}

/**
 * Sending a submitted review back to its reviewer.
 *
 * The reason is required and the reviewer reads it on the form, because "look again" with nothing
 * to look for is a review that comes back unchanged.
 */
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
    setError(null);
    try {
      await kpiApi.reopenReview(target.id, note.trim());
      await onDone(t('kpi.review.notice.reopened', { name: target.staffName }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="kpi.review.reopen.title" vars={{ name: target.staffName }} />}
      titleText={t('kpi.review.reopen.title', { name: target.staffName })}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <DetailGrid>
          <Detail label={<T k="kpi.assignment.column.period" />} value={target.periodCode} />
          <Detail
            label={<T k="kpi.assignment.column.score" />}
            value={formatScore(target.totalScore)}
          />
          <Detail label={<T k="kpi.assignment.column.grade" />} value={target.gradeCode ?? '—'} />
        </DetailGrid>

        <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
          <T k="kpi.review.reopen.hint" />
        </PanelNote>

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="pb-2">
          <TextArea
            label={<T k="kpi.review.reopen.note" />}
            hint={<T k="kpi.review.reopen.note.hint" />}
            rows={2}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

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
