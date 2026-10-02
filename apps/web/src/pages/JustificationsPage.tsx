import type { LabelKey } from '@attendance/shared';
import { CircleCheck, CircleX, TriangleAlert, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  ChipBar,
  DateBox,
  Detail,
  DetailGrid,
  ExpandButton,
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
import { Badge, TextArea } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { formatDate, formatDateOnly, formatDateTime } from '../lib/operations-api';
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

const STATUS_DOT: Record<JustificationStatus, string> = {
  pending: 'bg-amber-500',
  reverted: 'bg-sky-500',
  approved: 'bg-emerald-500',
  rejected: 'bg-rose-500',
};

/**
 * Deciding the explanations staff have filed for their own attendance.
 *
 * Separate from Pengecualian, and the separation is the point. Exceptions are the eight conditions the
 * engine could not resolve — an unmatched face, a terminal whose clock drifted — and resolving one
 * corrects data. This is the four states the engine resolved with confidence and that somebody wants
 * to account for; deciding one changes no attendance figure anywhere.
 *
 * Laid out as the leave queue is: pending by default, one row action per decision, the detail in the
 * row's own expansion. It used to open every row in a dialog that held all three decisions at once,
 * with a footer of its own that sat a step wider than the panel.
 */
export function JustificationsPage(): ReactNode {
  const [data, setData] = useState<QueuePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // The range the server chose on the first read, so Reset can return to it and `dirty` can tell.
  const [defaultRange, setDefaultRange] = useState<{ from: string; to: string } | null>(null);
  const [departmentId, setDepartmentId] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState<string | undefined>('pending');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [open, setOpen] = useState<number | null>(null);

  const [deciding, setDeciding] = useState<{
    row: QueueRow;
    decision: JustificationDecision;
  } | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const mayApprove = can(SCREEN, 'approve');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await justificationApi.list({
        dari: from || undefined,
        hingga: to || undefined,
        departmentId: departmentId === '' ? undefined : Number(departmentId),
        search: debounced === '' ? undefined : debounced,
        status: status as JustificationStatus | undefined,
        jenis: kind === '' ? undefined : (kind as (typeof KIND_ORDER)[number]),
        page,
        pageSize,
      });
      setData(result);
      /*
       * The pickers are seeded from the range the server read, not from a default computed here.
       *
       * Only while they are blank — after that they are what the operator chose, and overwriting
       * them would fight the person typing.
       */
      setDefaultRange((current) => current ?? { from: result.from, to: result.to });
      setFrom((current) => (current === '' ? result.from : current));
      setTo((current) => (current === '' ? result.to : current));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('justify.error.load'));
    } finally {
      setLoading(false);
    }
  }, [from, to, departmentId, debounced, status, kind, page, pageSize, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];
  const pending = data?.counts.pending ?? 0;

  /*
   * Chip counts come from the server's tally with the status filter removed, so choosing one chip
   * does not zero the others.
   */
  const chips = useMemo(
    () =>
      JUSTIFICATION_STATUS_ORDER.map((value) => ({
        id: value,
        label: <T k={JUSTIFICATION_STATUS_LABELS[value]} />,
        count: data?.counts[value] ?? 0,
        dot: STATUS_DOT[value],
      })),
    [data],
  );

  const dirty =
    search.length > 0 ||
    departmentId !== '' ||
    kind !== '' ||
    status !== 'pending' ||
    (defaultRange !== null && (from !== defaultRange.from || to !== defaultRange.to));

  return (
    <PanelCard title={<T k="justify.title" />} subtitle={<T k="justify.subtitle" />}>
      <PanelSection
        title={
          pending === 0 ? <T k="hr.queue.none" /> : <T k="hr.queue.pending" vars={{ count: pending }} />
        }
        subtitle={<T k="justify.note.noChain" />}
      />

      <ChipBar
        chips={chips}
        active={status}
        onChange={(id) => {
          setStatus(id);
          setPage(1);
        }}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('justify.search')}
        dirty={dirty}
        onReset={() => {
          setSearch('');
          setDepartmentId('');
          setKind('');
          setStatus('pending');
          // Blank, so the next read answers the server's own default range and re-seeds them.
          setFrom('');
          setTo('');
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
          options={(data?.departments ?? []).map((row) => ({ value: String(row.id), label: row.name }))}
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
        <DateBox
          label={t('filter.from')}
          value={from}
          onChange={(value) => {
            setFrom(value);
            setPage(1);
          }}
        />
        <DateBox
          label={t('filter.to')}
          value={to}
          onChange={(value) => {
            setTo(value);
            setPage(1);
          }}
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
        empty={<T k="justify.empty" />}
        columns={[
          { header: <T k="justify.column.staff" /> },
          { header: <T k="justify.column.date" />, width: 'w-28' },
          { header: <T k="justify.column.kind" />, width: 'w-32' },
          { header: <T k="justify.column.record" />, width: 'w-40' },
          { header: <T k="justify.column.reason" />, width: 'w-72' },
          { header: <T k="panel.column.status" />, width: 'w-36' },
          { header: <T k="panel.column.actions" />, width: 'w-36', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <QueueRowView
            key={row.id}
            row={row}
            mayApprove={mayApprove}
            expanded={open === row.id}
            onToggle={() => setOpen(open === row.id ? null : row.id)}
            onDecide={(decision) => setDeciding({ row, decision })}
          />
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

      {deciding !== null && (
        <DecisionDialog
          target={deciding.row}
          decision={deciding.decision}
          onClose={() => setDeciding(null)}
          onDone={async (message) => {
            setDeciding(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </PanelCard>
  );
}

/** Pending and sent-back days are still open; approved and rejected ones were signed. */
function isOpen(status: JustificationStatus): boolean {
  return status === 'pending' || status === 'reverted';
}

function QueueRowView({
  row,
  mayApprove,
  expanded,
  onToggle,
  onDecide,
}: {
  row: QueueRow;
  mayApprove: boolean;
  expanded: boolean;
  onToggle: () => void;
  onDecide: (decision: JustificationDecision) => void;
}): ReactNode {
  const { t } = useLabels();
  const open = isOpen(row.status);

  return (
    <>
      <tr
        className={cn(
          'border-b border-slate-100',
          expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
          row.status === 'pending' && !expanded && 'bg-amber-50/40',
        )}
      >
        <td className="px-5 py-2.5">
          <span className="block font-medium text-slate-800">{row.staffName}</span>
          <span className="block font-mono text-[11px] text-slate-400">
            {row.employeeNo}
            {row.departmentName !== null && ` · ${row.departmentName}`}
          </span>
        </td>
        <td className="px-2 py-2.5 text-xs whitespace-nowrap tabular-nums text-slate-700">
          {formatDateOnly(row.workDate)}
        </td>
        <td className="px-2 py-2.5 text-xs text-slate-600">
          <T k={KIND_LABELS[row.statusKind]} />
        </td>
        <td className="px-2 py-2.5 text-xs tabular-nums text-slate-600">
          <RecordSummary row={row} />
        </td>
        <td className="px-2 py-2.5 text-xs text-slate-700">
          <p className="line-clamp-2">{row.reason}</p>
        </td>
        <td className="px-2 py-2.5">
          {/* Uppercased by the badge's class: a translated word cannot be upper-cased safely. */}
          <Badge tone={JUSTIFICATION_TONES[row.status]} className="uppercase">
            <T k={JUSTIFICATION_STATUS_LABELS[row.status]} />
          </Badge>
        </td>
        <td className="px-2 py-2.5 pr-4">
          <RowActions>
            {mayApprove && open && (
              <>
                <RowAction
                  icon={<CircleCheck className="size-4" aria-hidden />}
                  label={t('justify.action.approve')}
                  tone="success"
                  onClick={() => onDecide('approved')}
                />
                <RowAction
                  icon={<CircleX className="size-4" aria-hidden />}
                  label={t('justify.action.reject')}
                  tone="danger"
                  onClick={() => onDecide('rejected')}
                />
                {/*
                  Disabled on a day already sent back, with the reason as the label: it is waiting on
                  the employee, and sending it again would only send them a second identical message.
                */}
                <RowAction
                  icon={<Undo2 className="size-4" aria-hidden />}
                  label={
                    row.status === 'reverted'
                      ? t('justify.action.revert.already')
                      : t('justify.action.revert')
                  }
                  tone="warn"
                  disabled={row.status === 'reverted'}
                  onClick={() => onDecide('reverted')}
                />
              </>
            )}
            <ExpandButton expanded={expanded} onClick={onToggle} label={t('justify.row.expand')} />
          </RowActions>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={7} className="px-5 py-3">
            <DetailGrid>
              <Detail label={<T k="justify.column.submitted" />} value={formatDateTime(row.submittedAt)} />
              <Detail
                label={<T k="justify.column.decided" />}
                value={
                  /*
                    A dash for a sent-back row, on purpose: it has no decidedAt because it is not a
                    decision — it is the row going back to the employee.
                  */
                  row.decidedAt === null ? '—' : formatDateTime(row.decidedAt)
                }
              />
              {row.record !== null && (
                <>
                  <Detail label={<T k="justify.record.shift" />} value={row.record.shiftName ?? '—'} />
                  <Detail
                    label={<T k="justify.record.scheduled" />}
                    value={`${clockTime(row.record.scheduledStart)} – ${clockTime(row.record.scheduledEnd)}`}
                  />
                  <Detail
                    label={<T k="justify.record.actual" />}
                    value={`${clockTime(row.record.checkInAt)} – ${clockTime(row.record.checkOutAt)}`}
                  />
                  <Detail
                    label={<T k="justify.record.hours" />}
                    value={formatMinutes(row.record.workedMinutes)}
                  />
                </>
              )}
            </DetailGrid>

            <div className="mt-3 border-t border-slate-200 pt-2">
              <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                <T k="justify.form.reason" />
              </p>
              {/* The employee's words, read-only. A supervisor decides an explanation, not rewrites it. */}
              <p className="mt-1 text-sm break-words whitespace-pre-wrap text-slate-700">{row.reason}</p>
            </div>

            {row.decisionNote !== null && (
              <PanelNote tone={row.status === 'approved' ? 'success' : 'warn'} className="mt-3">
                <T k="justify.detail.decisionNote" vars={{ note: row.decisionNote }} />
              </PanelNote>
            )}

            {row.record === null && (
              <PanelNote
                tone="warn"
                className="mt-3"
                icon={<TriangleAlert className="size-3.5" aria-hidden />}
              >
                <T k="justify.decision.recordMissing" />
              </PanelNote>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/** The day being explained, as times. Without them a reason for a late day means nothing. */
function RecordSummary({ row }: { row: QueueRow }): ReactNode {
  if (row.record === null) {
    /*
     * The day has been recomputed into a different shape since. The row still stands as a record of
     * what was asked and answered, and the gap is shown rather than hidden.
     */
    return (
      <span className="text-[11px] text-amber-700">
        <T k="justify.record.missing" />
      </span>
    );
  }
  return (
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
  );
}

const DECISION_TITLES: Record<JustificationDecision, LabelKey> = {
  approved: 'justify.decision.approve.title',
  rejected: 'justify.decision.reject.title',
  reverted: 'justify.decision.revert.title',
};

const DECISION_SUBMITS: Record<JustificationDecision, LabelKey> = {
  approved: 'justify.action.approve',
  rejected: 'justify.action.reject',
  reverted: 'justify.action.revert',
};

/** What each decision does, said at the moment of making it. One note, not three. */
const DECISION_NOTES: Record<JustificationDecision, LabelKey> = {
  approved: 'justify.decision.approveNote',
  rejected: 'justify.decision.rejectNote',
  reverted: 'justify.decision.revertNote',
};

const DECISION_NOTICES: Record<JustificationDecision, LabelKey> = {
  approved: 'justify.notice.approved',
  rejected: 'justify.notice.rejected',
  reverted: 'justify.notice.reverted',
};

/**
 * One decision, with the day it is about and the reason laid out above it.
 *
 * Rejecting and sending back need a note; approving does not. Approval is agreement with what the
 * person already wrote. The other two ask somebody to accept an outcome or to try again, and an
 * outcome with no words attached is one they cannot act on or appeal. Enforced on the server too.
 */
function DecisionDialog({
  target,
  decision,
  onClose,
  onDone,
}: {
  target: QueueRow;
  decision: JustificationDecision;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const needsNote = decision !== 'approved';
  const noteMissing = needsNote && note.trim().length < 3;
  const date = formatDateOnly(target.workDate);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await justificationApi.decide(target.id, decision, note.trim());
      await onDone(t(DECISION_NOTICES[decision], { name: target.staffName, date }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k={DECISION_TITLES[decision]} />}
      titleText={t(DECISION_TITLES[decision])}
      description={
        <T
          k="justify.decision.description"
          vars={{ name: target.staffName, date, kind: t(KIND_LABELS[target.statusKind]) }}
        />
      }
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <DetailGrid>
          <Detail label={<T k="justify.column.record" />} value={<RecordSummary row={target} />} />
          <Detail label={<T k="justify.column.submitted" />} value={formatDate(target.submittedAt)} />
          <Detail
            label={<T k="panel.column.status" />}
            value={<T k={JUSTIFICATION_STATUS_LABELS[target.status]} />}
          />
        </DetailGrid>

        <div>
          <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
            <T k="justify.form.reason" />
          </p>
          <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm break-words whitespace-pre-wrap text-slate-800">
            {target.reason}
          </p>
        </div>

        <TextArea
          label={<T k="justify.decision.note" />}
          hint={
            <T k={needsNote ? 'justify.decision.note.hint' : 'justify.decision.note.optional'} />
          }
          rows={3}
          maxLength={500}
          autoFocus
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="pb-2">
          <PanelNote
            tone={decision === 'rejected' ? 'danger' : decision === 'reverted' ? 'warn' : 'info'}
            icon={<TriangleAlert className="size-3.5" aria-hidden />}
          >
            <T k={DECISION_NOTES[decision]} />
          </PanelNote>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={noteMissing}
          {...(noteMissing ? { submitTitle: t('justify.decision.note.hint') } : {})}
          submitLabel={<T k={DECISION_SUBMITS[decision]} />}
        />
      </div>
    </Dialog>
  );
}
