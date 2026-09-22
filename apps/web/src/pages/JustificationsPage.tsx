import { CircleAlert, Eye, MessageSquareWarning, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
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
  RecordTable,
  RowAction,
  RowActions,
} from '../components/RecordPanel';
import { Button, Field } from '../components/ui';
import { useAuth } from '../lib/auth';
import { formatDate, formatDateOnly } from '../lib/operations-api';
import { api } from '../lib/api';
import {
  JUSTIFICATION_STATUS_LABELS,
  JUSTIFICATION_STATUS_ORDER,
  JUSTIFICATION_TONES,
  KIND_LABELS,
  KIND_ORDER,
  clockTime,
  formatMinutes,
  justificationApi,
  type JustificationDecision,
  type JustificationStatus,
  type QueuePage,
  type QueueRow,
} from '../lib/justification-api';
import { T, useLabels } from '../lib/translation';

const SCREEN = 'attendance.justifications';

/**
 * Deciding the explanations staff have filed for their own attendance.
 *
 * Separate from Pengecualian, and the separation is the point. Exceptions are the eight conditions the
 * engine could not resolve — an unmatched face, a terminal whose clock drifted — and resolving one
 * corrects data. This is the four states the engine resolved with confidence and that somebody wants
 * to account for; deciding one changes no attendance figure anywhere.
 *
 * One screen for both would ask the same person to decide "this terminal's clock drifted by eight
 * minutes" and "Siti was late because her child was ill" through the same form.
 */
export function JustificationsPage(): ReactNode {
  const [data, setData] = useState<QueuePage | null>(null);
  // Shaped locally: the departments endpoint returns more than a facet needs, and OrgPage holds
  // the full type. A facet only ever reads an id and a name.
  const [departments, setDepartments] = useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [target, setTarget] = useState<QueueRow | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const mayApprove = can(SCREEN, 'approve');

  useEffect(() => {
    void (async () => {
      try {
        setDepartments(await api.get<Array<{ id: number; name: string }>>('/api/departments'));
      } catch {
        // The department facet falls back to all departments, which is the default anyway.
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await justificationApi.list({
        dari: from || undefined,
        hingga: to || undefined,
        departmentId: departmentId === '' ? undefined : Number(departmentId),
        status: status as JustificationStatus | undefined,
        jenis: kind === '' ? undefined : (kind as (typeof KIND_ORDER)[number]),
        page,
        pageSize,
      });
      setData(result);
      /*
       * The pickers are seeded from the range the server read, not from a default computed here.
       *
       * Only on the first load, while they are still blank — after that they are what the operator
       * chose, and overwriting them would fight the person typing. Doing it this way also removed a
       * back-office screen's dependency on `/api/saya/tetapan`, which was the wrong way round.
       */
      setFrom((current) => (current === '' ? result.from : current));
      setTo((current) => (current === '' ? result.to : current));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('justify.error.load'));
    } finally {
      setLoading(false);
    }
  }, [from, to, departmentId, status, kind, page, pageSize, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];

  /*
   * Chip counts come from the server's tally with the status filter removed.
   *
   * Choosing one chip must not zero the others: the remaining chips would read as "there are none of
   * those" when what happened is that the list is filtered.
   */
  const chips = useMemo(
    () =>
      JUSTIFICATION_STATUS_ORDER.map((value) => ({
        id: value,
        label: <T k={JUSTIFICATION_STATUS_LABELS[value]} />,
        count: data?.counts[value] ?? 0,
        dot:
          value === 'approved'
            ? 'bg-emerald-500'
            : value === 'rejected'
              ? 'bg-rose-500'
              : value === 'reverted'
                ? 'bg-amber-500'
                : 'bg-slate-400',
      })),
    [data],
  );

  const dirty = departmentId !== '' || kind !== '' || status !== undefined;

  return (
    <PanelCard title={<T k="justify.title" />} subtitle={<T k="justify.subtitle" />}>
      <PanelSection
        icon={<MessageSquareWarning className="size-4" aria-hidden />}
        title={<T k="justify.title" />}
      />

      <ChipBar chips={chips} active={status} onChange={setStatus} />

      <FilterRow
        dirty={dirty}
        onReset={() => {
          setDepartmentId('');
          setKind('');
          setStatus(undefined);
          setPage(1);
        }}
      >
        <FacetSelect
          label={t('justify.filter.department')}
          value={departmentId}
          onChange={(value) => {
            setDepartmentId(value);
            setPage(1);
          }}
          options={departments.map((row) => ({ value: String(row.id), label: row.name }))}
        />
        <FacetSelect
          label={t('justify.filter.kind')}
          value={kind}
          onChange={(value) => {
            setKind(value);
            setPage(1);
          }}
          options={KIND_ORDER.map((value) => ({ value, label: t(KIND_LABELS[value]) }))}
        />
      </FilterRow>

      <PanelBody className="space-y-3 pb-0">
        <Feedback error={error} notice={notice} />

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Field
              label={<T k="justify.filter.from" />}
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="w-40">
            <Field
              label={<T k="justify.filter.to" />}
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>

        {/*
          Stated on the screen rather than left implicit: somebody deciding here is not correcting
          data, and somebody looking for the terminal faults is on the wrong screen.
        */}
        <PanelNote icon={<CircleAlert className="size-3.5" aria-hidden />}>
          <T k="justify.note.notExceptions" />
        </PanelNote>
        <PanelNote>
          <T k="justify.note.noChain" />
        </PanelNote>
      </PanelBody>

      <RecordTable
        loading={loading}
        rowCount={rows.length}
        empty={<T k="justify.empty" />}
        columns={[
          { header: <T k="justify.column.staff" /> },
          { header: <T k="justify.column.date" />, width: 'w-28' },
          { header: <T k="justify.column.kind" />, width: 'w-32' },
          { header: <T k="justify.column.record" />, width: 'w-44' },
          { header: <T k="justify.column.reason" /> },
          { header: <T k="panel.column.status" />, width: 'w-32' },
          { header: <T k="justify.column.decided" />, width: 'w-40' },
          { header: <T k="panel.column.actions" />, width: 'w-20', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <tr
            key={row.id}
            className={
              row.status === 'pending'
                ? 'border-b border-slate-100 bg-amber-50/40'
                : 'border-b border-slate-100'
            }
          >
            <td className="px-5 py-2">
              <span className="block text-xs text-slate-800">{row.staffName}</span>
              <span className="block font-mono text-[11px] text-slate-400">{row.employeeNo}</span>
              {row.departmentName !== null && (
                <span className="block text-[11px] text-slate-400">{row.departmentName}</span>
              )}
            </td>
            <td className="px-2 py-2 text-xs whitespace-nowrap tabular-nums text-slate-700">
              {formatDateOnly(row.workDate)}
            </td>
            <td className="px-2 py-2 text-xs text-slate-600">
              <T k={KIND_LABELS[row.statusKind]} />
            </td>
            <td className="px-2 py-2 text-xs tabular-nums text-slate-600">
              {row.record === null ? (
                /*
                 * The day has been recomputed into a different shape since. The row still stands as
                 * a record of what was asked and answered, and the gap is shown rather than hidden.
                 */
                <span className="text-[11px] text-amber-700">
                  <T k="justify.decision.recordMissing" />
                </span>
              ) : (
                <>
                  <span className="block">
                    {`${clockTime(row.record.checkInAt)} – ${clockTime(row.record.checkOutAt)}`}
                  </span>
                  {row.record.lateMinutes > 0 && (
                    <span className="block text-[11px] text-amber-700">
                      <T k="justify.record.late" vars={{ minutes: row.record.lateMinutes }} />
                    </span>
                  )}
                  {row.record.earlyLeaveMinutes > 0 && (
                    <span className="block text-[11px] text-amber-700">
                      <T k="justify.record.early" vars={{ minutes: row.record.earlyLeaveMinutes }} />
                    </span>
                  )}
                </>
              )}
            </td>
            <td className="px-2 py-2 text-xs text-slate-700">
              <p className="line-clamp-2">{row.reason}</p>
              {row.decisionNote !== null && (
                <p className="mt-0.5 text-[11px] text-slate-500">{row.decisionNote}</p>
              )}
            </td>
            <td className="px-2 py-2">
              <span
                className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium uppercase ${JUSTIFICATION_TONES[row.status]}`}
              >
                <T k={JUSTIFICATION_STATUS_LABELS[row.status]} />
              </span>
            </td>
            <td className="px-2 py-2 text-xs whitespace-nowrap text-slate-500">
              {/*
                Blank for a reverted row, on purpose: it has no decidedAt because it is not a
                decision — it is the row going back to the employee, and stamping it as decided would
                make an open item look closed in every list that sorts on this column.
              */}
              {row.decidedAt === null ? '—' : formatDate(row.decidedAt)}
            </td>
            <td className="px-2 py-2 pr-4">
              <RowActions>
                <RowAction
                  icon={<Eye className="size-4" aria-hidden />}
                  label={t('justify.action.view')}
                  onClick={() => setTarget(row)}
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
        onPageSize={setPageSize}
        onRefresh={load}
      />

      {target !== null && (
        <DecisionDialog
          target={target}
          mayApprove={mayApprove}
          onClose={() => setTarget(null)}
          onDone={async (message) => {
            setTarget(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </PanelCard>
  );
}

/**
 * The decision, with the day it is about laid out beside the reason.
 *
 * Three buttons, following the reference system: approve, reject, and send back. Send back is the one
 * that keeps a thin submission from becoming a permanent rejection — "your reason was not accepted"
 * and "I cannot act on what you wrote" are different messages, and only one of them means the person
 * should try again.
 */
function DecisionDialog({
  target,
  mayApprove,
  onClose,
  onDone,
}: {
  target: QueueRow;
  mayApprove: boolean;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const settled = target.status === 'approved' || target.status === 'rejected';

  const decide = async (decision: JustificationDecision): Promise<void> => {
    setBusy(true);
    try {
      await justificationApi.decide(target.id, decision, note);
      await onDone(t('justify.decided'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  /*
   * Rejecting and reverting need a note; approving does not.
   *
   * Approval is agreement with what the person already wrote, so there is nothing to add. The other
   * two ask somebody to accept an outcome or to try again, and an outcome with no words attached is
   * one they cannot act on or appeal. Enforced on the server too.
   */
  const noteMissing = note.trim().length < 3;

  return (
    <Dialog
      title={<T k="justify.form.title" vars={{ date: formatDateOnly(target.workDate) }} />}
      titleText={t('justify.form.title', { date: formatDateOnly(target.workDate) })}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <DetailGrid>
          <Detail label={<T k="justify.column.staff" />} value={target.staffName} />
          <Detail label={<T k="justify.column.kind" />} value={<T k={KIND_LABELS[target.statusKind]} />} />
          <Detail
            label={<T k="panel.column.status" />}
            value={<T k={JUSTIFICATION_STATUS_LABELS[target.status]} />}
          />
          <Detail label={<T k="justify.column.submitted" />} value={formatDate(target.submittedAt)} />
        </DetailGrid>

        {target.record === null ? (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="justify.decision.recordMissing" />
          </PanelNote>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-xs font-medium text-slate-600">
              <T k="justify.form.record" />
            </p>
            <DetailGrid>
              <Detail
                label={<T k="justify.record.shift" />}
                value={target.record.shiftName ?? '—'}
              />
              <Detail
                label={<T k="justify.record.scheduled" />}
                value={`${clockTime(target.record.scheduledStart)} – ${clockTime(target.record.scheduledEnd)}`}
              />
              <Detail
                label={<T k="justify.record.actual" />}
                value={`${clockTime(target.record.checkInAt)} – ${clockTime(target.record.checkOutAt)}`}
              />
              <Detail
                label={<T k="justify.record.hours" />}
                value={formatMinutes(target.record.workedMinutes)}
              />
            </DetailGrid>
          </div>
        )}

        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">
            <T k="justify.form.reason" />
          </p>
          {/* The employee's words, read-only. A supervisor decides an explanation, not rewrites it. */}
          <p className="rounded-lg border border-slate-200 px-3 py-2 text-sm whitespace-pre-wrap text-slate-800">
            {target.reason}
          </p>
        </div>

        {settled ? (
          <PanelNote>
            <T k="justify.refuse.alreadyPending" />
          </PanelNote>
        ) : (
          mayApprove && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="decision-note">
                  <T k="justify.decision.note" />
                </label>
                <textarea
                  id="decision-note"
                  rows={3}
                  value={note}
                  maxLength={500}
                  onChange={(event) => setNote(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
                <p className="mt-1 text-xs text-slate-500">
                  <T k="justify.decision.note.hint" />
                </p>
                <p className="text-xs text-slate-500">
                  <T k="justify.decision.note.optional" />
                </p>
              </div>

              <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
                <Button
                  variant="ghost"
                  disabled={busy || noteMissing}
                  title={noteMissing ? t('justify.decision.note.hint') : undefined}
                  onClick={() => void decide('reverted')}
                >
                  <T k="justify.action.revert" />
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || noteMissing}
                  title={noteMissing ? t('justify.decision.note.hint') : undefined}
                  onClick={() => void decide('rejected')}
                >
                  <T k="justify.action.reject" />
                </Button>
                <Button disabled={busy} onClick={() => void decide('approved')}>
                  <T k="justify.action.approve" />
                </Button>
              </div>
            </>
          )
        )}

        {!mayApprove && (
          <DialogFooter onClose={onClose} closeLabel={<T k="dialog.close" />} />
        )}
      </div>
    </Dialog>
  );
}
