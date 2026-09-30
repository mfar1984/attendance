import {
  CircleAlert,
  CircleCheck,
  CircleX,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import { DraftReceipt } from '../components/DraftReceipt';
import {
  ChipBar,
  CodePill,
  DateBox,
  Detail,
  DetailGrid,
  ExpandButton,
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
import { Badge, Button, Field, SelectField, TextArea } from '../components/ui';
import { useAuth } from '../lib/auth';
import { CLAIM_STATUS_LABELS, formatRinggit, type ClaimStatus } from '../lib/claims-api';
import { cn } from '../lib/cn';
import {
  expensesApi,
  type ExpenseCategory,
  type ExpensePage,
  type ExpenseRow,
} from '../lib/expenses-api';
import { signedNotice, type ApprovalTrailEntry } from '../lib/hr-api';
import { daysAgoIso, formatDateOnly, formatDateTime, todayIso } from '../lib/operations-api';
import { T, useLabels } from '../lib/translation';

const STATUS_DOT: Record<ClaimStatus, string> = {
  pending: 'bg-amber-500',
  approved: 'bg-emerald-600',
  rejected: 'bg-rose-500',
  cancelled: 'bg-slate-400',
};

const SCREEN = 'hr.expenses';

/**
 * Expenses, and the categories that classify them.
 *
 * The same shape as Leave, Claims and Overtime. The status labels and the money formatter come
 * from the claims client rather than being redeclared: the two modules move through identical
 * states, and a second copy is a second thing to keep in step.
 */
export function ExpensesPage(): ReactNode {
  /*
    One view, so no tab bar. The categories and the three configuration panels moved to
    `/hr/permohonan/perbelanjaan/tetapan`, a sibling entry in the sidebar.
  */
  return (
    <PanelCard title={<T k="expense.title" />} subtitle={<T k="expense.subtitle" />}>
      <RequestsTab />
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function RequestsTab(): ReactNode {
  const [data, setData] = useState<ExpensePage | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [status, setStatus] = useState<ClaimStatus | undefined>(undefined);
  const [from, setFrom] = useState(daysAgoIso(90));
  const [to, setTo] = useState(todayIso());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<{ row: ExpenseRow; approve: boolean } | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await expensesApi.list({
          page,
          pageSize,
          ...(status === undefined ? {} : { status }),
          from,
          to,
        }),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('expense.error.load'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, from, to, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];
  // Across every date, not the 90-day window: an expense back-dated past it is still waiting.
  const pending = data?.pendingTotal ?? 0;

  return (
    <>
      {/* The queue's size in the heading, the way the leave list heads its own. */}
      <PanelSection
        title={
          pending === 0 ? (
            <T k="hr.queue.none" />
          ) : (
            <T k="hr.queue.pending" vars={{ count: pending }} />
          )
        }
        action={
          can(SCREEN, 'create') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              <T k="expense.action.new" />
            </Button>
          ) : undefined
        }
      />

      <ChipBar
        active={status}
        onChange={(id) => {
          setStatus(id as ClaimStatus | undefined);
          setPage(1);
        }}
        chips={(['pending', 'approved', 'rejected', 'cancelled'] as ClaimStatus[]).map((key) => ({
          id: key,
          label: <T k={CLAIM_STATUS_LABELS[key]} />,
          count: data?.counts[key] ?? 0,
          dot: STATUS_DOT[key],
        }))}
      />

      <FilterRow
        dirty={status !== undefined || from !== daysAgoIso(90) || to !== todayIso()}
        onReset={() => {
          setStatus(undefined);
          setFrom(daysAgoIso(90));
          setTo(todayIso());
          setPage(1);
        }}
      >
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

      <PanelBody className="space-y-2 pb-0">
        <Feedback error={error} notice={notice} />
        <PanelNote icon={<CircleAlert className="size-3.5" aria-hidden />}>
          <T k="expense.note.receipt" />
        </PanelNote>
        <PanelNote>
          <T k="claim.note.notPaid" />
        </PanelNote>
      </PanelBody>

      <RecordTable
        framed
        loading={loading}
        rowCount={rows.length}
        empty={<T k="expense.empty" />}
        columns={[
          { header: <T k="expense.column.requestNo" />, width: 'w-36' },
          { header: <T k="claim.column.staff" /> },
          { header: <T k="expense.column.category" />, width: 'w-36' },
          { header: <T k="expense.column.payee" />, width: 'w-40' },
          { header: <T k="claim.column.incurredOn" />, width: 'w-28' },
          { header: <T k="claim.column.amount" />, width: 'w-28', align: 'right' },
          { header: <T k="claim.column.approved" />, width: 'w-28', align: 'right' },
          { header: <T k="claim.column.receipt" />, width: 'w-24' },
          { header: <T k="panel.column.status" />, width: 'w-24' },
          { header: <T k="panel.column.actions" />, width: 'w-36', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <ExpenseRowView
            key={row.id}
            row={row}
            chainLength={data?.chainLength ?? 0}
            expanded={open === row.id}
            onToggle={() => setOpen(open === row.id ? null : row.id)}
            onApprove={() => setDeciding({ row, approve: true })}
            onReject={() => setDeciding({ row, approve: false })}
            onChanged={async (message) => {
              setNotice(message);
              await load();
            }}
            onError={setError}
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

      {creating && (
        <NewExpenseDialog
          onClose={() => setCreating(false)}
          onDone={async (message) => {
            setCreating(false);
            setNotice(message);
            await load();
          }}
        />
      )}

      {deciding !== null && (
        <DecideDialog
          target={deciding.row}
          approve={deciding.approve}
          onClose={() => setDeciding(null)}
          onDone={async (message) => {
            setDeciding(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </>
  );
}

function ExpenseRowView({
  row,
  chainLength,
  expanded,
  onToggle,
  onApprove,
  onReject,
  onChanged,
  onError,
}: {
  row: ExpenseRow;
  chainLength: number;
  expanded: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  onChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
}): ReactNode {
  const [trail, setTrail] = useState<ApprovalTrailEntry[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { t } = useLabels();
  const { can } = useAuth();
  const waiting = row.status === 'pending';
  const trimmed = row.status === 'approved' && row.approvedAmount < row.amount;
  /*
   * A pending expense with no receipt cannot be approved at all, so it is toned as broken
   * rather than merely waiting. The eye should find it before it reads the receipt column.
   */
  const blocked = waiting && !row.hasReceipt;

  useEffect(() => {
    if (!expanded || trail !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const detail = await expensesApi.detail(row.id);
        if (!cancelled) setTrail(detail.trail);
      } catch {
        if (!cancelled) setTrail([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, trail, row.id]);

  return (
    <>
      <tr
        className={cn(
          'border-b border-slate-100',
          expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
          !expanded && blocked && 'bg-rose-50/40',
          !expanded && waiting && !blocked && 'bg-amber-50/40',
        )}
      >
        <td className="px-5 py-2 font-mono text-xs text-slate-700">{row.requestNo}</td>
        <td className="px-2 py-2">
          <span className="block text-slate-800">{row.staffName}</span>
          <span className="block font-mono text-[11px] text-slate-400">{row.employeeNo}</span>
        </td>
        <td className="px-2 py-2 text-xs text-slate-600">{row.categoryName}</td>
        <td className="px-2 py-2 text-xs text-slate-600">
          <span className="line-clamp-1">{row.payee}</span>
        </td>
        <td className="px-2 py-2 text-xs whitespace-nowrap tabular-nums text-slate-600">
          {formatDateOnly(row.incurredOn)}
        </td>
        <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-700">
          {formatRinggit(row.amount)}
        </td>
        <td
          className={cn(
            'px-2 py-2 text-right text-xs tabular-nums',
            trimmed ? 'font-medium text-amber-700' : 'text-slate-700',
          )}
        >
          {row.status === 'approved' ? formatRinggit(row.approvedAmount) : '—'}
        </td>
        <td className="px-2 py-2">
          {row.hasReceipt ? (
            <a
              href={expensesApi.receiptUrl(row.id)}
              target="_blank"
              rel="noreferrer"
              title={t('claim.receipt.open')}
              className="text-brand-700 inline-flex items-center gap-1 text-xs hover:underline"
            >
              <FileText className="size-3.5" aria-hidden />
              <T k="claim.receipt.present" />
            </a>
          ) : (
            <span
              className={cn('text-[11px]', blocked ? 'font-medium text-rose-600' : 'text-slate-400')}
            >
              <T k="claim.receipt.missing" />
            </span>
          )}
        </td>
        <td className="px-2 py-2">
          {/* Uppercased by the badge's class: a translated word cannot be upper-cased safely. */}
          <Badge
            tone={
              row.status === 'approved'
                ? 'success'
                : row.status === 'pending'
                  ? 'warning'
                  : row.status === 'rejected'
                    ? 'danger'
                    : 'neutral'
            }
            className="uppercase"
          >
            <T k={CLAIM_STATUS_LABELS[row.status]} />
          </Badge>
          {chainLength > 1 && waiting && row.currentLevel > 0 && (
            <span className="mt-0.5 block text-[10px] text-slate-500">
              <T k="hr.approval.progress" vars={{ level: row.currentLevel, total: chainLength }} />
            </span>
          )}
        </td>
        <td className="px-2 py-2 pr-4">
          <RowActions>
            {/*
              The upload stays on the row, unlike a claim's. An expense has exactly one receipt, so
              there is no question which cost the file is evidence for.
            */}
            {waiting && can(SCREEN, 'create') && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    try {
                      await expensesApi.uploadReceipt(row.id, file);
                      await onChanged(t('claim.receipt.uploaded'));
                    } catch (cause) {
                      onError(cause instanceof Error ? cause.message : '');
                    } finally {
                      event.target.value = '';
                    }
                  }}
                />
                <RowAction
                  icon={<Upload className="size-4" aria-hidden />}
                  label={t('claim.receipt.upload')}
                  onClick={() => fileInput.current?.click()}
                />
              </>
            )}
            {waiting && can(SCREEN, 'approve') && (
              <>
                <RowAction
                  icon={<CircleCheck className="size-4" aria-hidden />}
                  label={t('claim.decide.approve')}
                  tone="success"
                  // Disabled rather than allowed and refused: the approver cannot fix this
                  // from here, somebody has to attach the file first.
                  disabled={!row.hasReceipt}
                  onClick={onApprove}
                />
                <RowAction
                  icon={<CircleX className="size-4" aria-hidden />}
                  label={t('claim.decide.reject')}
                  tone="danger"
                  onClick={onReject}
                />
              </>
            )}
            {waiting && can(SCREEN, 'edit') && (
              <RowAction
                icon={<X className="size-4" aria-hidden />}
                label={t('claim.action.cancel')}
                tone="warn"
                onClick={async () => {
                  try {
                    await expensesApi.cancel(row.id);
                    await onChanged(t('hr.request.withdrawn', { number: row.requestNo }));
                  } catch (cause) {
                    onError(cause instanceof Error ? cause.message : '');
                  }
                }}
              />
            )}
            <ExpandButton expanded={expanded} onClick={onToggle} label={t('claim.action.view')} />
          </RowActions>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={10} className="px-5 py-3">
            <DetailGrid>
              <Detail label={<T k="expense.column.category" />} value={row.categoryName} />
              <Detail label={<T k="expense.column.payee" />} value={row.payee} />
              <Detail label={<T k="claim.new.detail" />} value={row.description} />
              <Detail label={<T k="claim.decide.claimed" />} value={formatRinggit(row.amount)} />
              <Detail
                label={<T k="claim.column.approved" />}
                value={row.status === 'approved' ? formatRinggit(row.approvedAmount) : '—'}
              />
              <Detail label={<T k="claim.decide.note" />} value={row.decisionNote ?? '—'} />
            </DetailGrid>

            {row.hasReceipt && can(SCREEN, 'edit') && waiting && (
              <div className="mt-3">
                <Button
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await expensesApi.removeReceipt(row.id);
                      await onChanged(t('expense.receipt.removed', { number: row.requestNo }));
                    } catch (cause) {
                      onError(cause instanceof Error ? cause.message : '');
                    }
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                  <T k="claim.receipt.remove" />
                </Button>
              </div>
            )}

            {!waiting && (
              <p className="mt-2 text-xs text-slate-500">
                <T k="claim.receipt.locked" />
              </p>
            )}

            <div className="mt-3 border-t border-slate-200 pt-3">
              <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                <T k="hr.approval.trail.title" />
              </p>
              {trail === null ? (
                <p className="mt-1 text-xs text-slate-400">
                  <T k="app.loading" />
                </p>
              ) : trail.length === 0 ? (
                <p className="mt-1 text-xs text-slate-400">
                  <T k="hr.approval.trail.empty" />
                </p>
              ) : (
                <ol className="mt-1.5 space-y-1">
                  {trail.map((entry) => (
                    <li key={entry.id} className="flex flex-wrap items-baseline gap-2 text-xs">
                      <span className="font-medium text-slate-600">
                        <T k="hr.approval.trail.level" vars={{ level: entry.level }} />
                      </span>
                      <span
                        className={cn(
                          'font-medium',
                          entry.action === 'approved' ? 'text-emerald-700' : 'text-rose-700',
                        )}
                      >
                        <T
                          k={
                            entry.action === 'approved'
                              ? 'hr.approval.trail.approved'
                              : 'hr.approval.trail.rejected'
                          }
                        />
                      </span>
                      <span className="text-slate-600">{entry.actorLabel}</span>
                      <span className="text-slate-400">{formatDateTime(entry.createdAt)}</span>
                      {entry.remarks !== null && (
                        <span className="text-slate-500 italic">{entry.remarks}</span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// New expense
// ---------------------------------------------------------------------------

function NewExpenseDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [staff, setStaff] = useState<PickedStaff | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [incurredOn, setIncurredOn] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [payee, setPayee] = useState('');
  const [description, setDescription] = useState('');
  /**
   * The receipt, held until the expense exists.
   *
   * Collected here rather than only from the list afterwards because the person filing has the
   * receipt in front of them at this moment — and without it the expense cannot be approved at all.
   */
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  useEffect(() => {
    void (async () => {
      try {
        const list = await expensesApi.categories();
        setCategories(list.filter((row) => row.active));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : null);
      }
    })();
  }, []);

  const chosen = categories.find((row) => String(row.id) === categoryId) ?? null;
  // The route refuses an amount over the category's ceiling; the field says so first.
  const overCap = chosen?.maxAmount != null && amount !== '' && Number(amount) > chosen.maxAmount;

  const submit = async (): Promise<void> => {
    if (staff === null) return;
    setBusy(true);
    try {
      const created = await expensesApi.create({
        staffId: staff.id,
        categoryId: Number(categoryId),
        incurredOn,
        amount: Number(amount),
        payee: payee.trim(),
        description: description.trim(),
      });

      /*
       * The receipt goes up after the expense exists, because the upload needs a row to attach to.
       *
       * A failed upload does not fail the expense. It is already stored — throwing here would leave
       * the screen reporting an error for a record that exists, which is the reading that makes
       * somebody file it a second time. The failure is said instead, and the receipt can be
       * attached from the list.
       */
      const parts = [t('hr.record.created', { number: created.requestNo })];
      if (file === null) {
        parts.push(t('expense.new.receiptNext'));
      } else {
        try {
          await expensesApi.uploadReceipt(created.id, file);
          parts.push(t('claim.receipt.uploaded'));
        } catch (cause) {
          parts.push(t('expense.new.uploadFailed'));
          /*
            The server's own reason as a sentence of its own. With one receipt there is room for it,
            and without it somebody retries the same file from the list and is refused the same way.
          */
          if (cause instanceof Error && cause.message.trim() !== '') parts.push(cause.message);
        }
      }

      await onDone(parts.join(' '));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  const blocked =
    staff === null ||
    categoryId === '' ||
    amount === '' ||
    !(Number(amount) > 0) ||
    overCap ||
    payee.trim() === '' ||
    description.trim() === '';

  return (
    <Dialog
      title={<T k="expense.new.title" />}
      titleText={t('expense.new.title')}
      description={<T k="expense.new.description" />}
      width="2xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/* Name first, then the form — the same two stages as the leave and claim forms. */}
        <StaffPicker
          value={staff}
          onChange={setStaff}
          search={expensesApi.searchStaff}
          hint={<T k="claim.new.staff.hint" />}
        />

        {staff !== null && (
          <>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <SelectField
                label={<T k="expense.new.category" />}
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                hint={
                  chosen?.maxAmount != null ? (
                    <T k="claim.new.cap" vars={{ cap: formatRinggit(chosen.maxAmount) }} />
                  ) : undefined
                }
              >
                {/* A prompt, not a choice: submitting stays disabled until a category is picked. */}
                <option value="">{t('expense.new.category')}</option>
                {categories.map((row) => (
                  <option key={row.id} value={String(row.id)}>
                    {row.maxAmount == null
                      ? `${row.code} — ${row.name}`
                      : `${row.code} — ${row.name} (${formatRinggit(row.maxAmount)})`}
                  </option>
                ))}
              </SelectField>
              <Field
                label={<T k="claim.new.incurredOn" />}
                type="date"
                value={incurredOn}
                max={todayIso()}
                onChange={(event) => setIncurredOn(event.target.value)}
              />
            </div>

            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field
                label={<T k="claim.new.amount" />}
                type="number"
                step="0.01"
                min={0}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                {...(overCap && chosen?.maxAmount != null
                  ? { error: t('expense.new.overCap', { cap: formatRinggit(chosen.maxAmount) }) }
                  : {})}
              />
              <Field
                label={<T k="expense.new.payee" />}
                hint={<T k="expense.new.payee.hint" />}
                value={payee}
                maxLength={190}
                onChange={(event) => setPayee(event.target.value)}
              />
            </div>

            <TextArea
              label={<T k="claim.new.detail" />}
              hint={<T k="expense.new.detail.hint" />}
              rows={2}
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
            />

            {/* The last block before the footer, so it carries the `pb-2`. */}
            <div className="space-y-2 pb-2">
              <DraftReceipt
                framed
                file={file}
                required
                onPick={(next) => {
                  setFile(next);
                  // A valid pick answers a size refusal still on screen from the previous one.
                  if (next !== null) setError(null);
                }}
                onError={setError}
              />
              {file === null && (
                <PanelNote tone="warn" icon={<Paperclip className="size-3.5" aria-hidden />}>
                  <T k="expense.new.noReceipt" />
                </PanelNote>
              )}
            </div>

            <DialogFooter
              onClose={onClose}
              onSubmit={() => void submit()}
              busy={busy}
              disabled={blocked}
              submitLabel={<T k="claim.new.submit" />}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

function DecideDialog({
  target,
  approve,
  onClose,
  onDone,
}: {
  target: ExpenseRow;
  approve: boolean;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [approved, setApproved] = useState(String(target.amount));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await expensesApi.decide(target.id, {
        decision: approve ? 'approved' : 'rejected',
        ...(approve ? { approvedAmount: Number(approved) } : {}),
        ...(note.trim() === '' ? {} : { note }),
      });

      await onDone(
        !approve
          ? t('hr.decision.rejected', { number: target.requestNo })
          : result.finalized
            ? t('hr.decision.approved', {
                number: target.requestNo,
                amount: formatRinggit(result.approvedAmount),
              })
            : signedNotice(t, target.requestNo, result),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="claim.decide.title" vars={{ requestNo: target.requestNo }} />}
      titleText={t('claim.decide.title', { requestNo: target.requestNo })}
      description={<T k="claim.decide.description" />}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <DetailGrid>
          <Detail label={<T k="claim.column.staff" />} value={target.staffName} />
          <Detail label={<T k="expense.column.category" />} value={target.categoryName} />
          <Detail label={<T k="expense.column.payee" />} value={target.payee} />
          <Detail
            label={<T k="claim.column.incurredOn" />}
            value={formatDateOnly(target.incurredOn)}
          />
          <Detail label={<T k="claim.decide.claimed" />} value={formatRinggit(target.amount)} />
          <Detail label={<T k="claim.new.detail" />} value={target.description} />
        </DetailGrid>

        {approve && !target.hasReceipt && (
          <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="expense.decide.noReceipt" />
          </PanelNote>
        )}

        {approve && (
          <Field
            label={<T k="claim.decide.approvedAmount" />}
            hint={<T k="claim.decide.approvedAmount.hint" />}
            type="number"
            step="0.01"
            min={0}
            max={target.amount}
            value={approved}
            onChange={(event) => setApproved(event.target.value)}
          />
        )}

        <Field
          label={<T k="claim.decide.note" />}
          {...(approve ? {} : { hint: <T k="claim.decide.noteRequired" /> })}
          value={note}
          maxLength={500}
          wrapperClassName="pb-2"
          onChange={(event) => setNote(event.target.value)}
        />

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={
            approve
              ? !target.hasReceipt ||
                approved === '' ||
                Number(approved) <= 0 ||
                Number(approved) > target.amount
              : note.trim().length < 3
          }
          submitLabel={<T k={approve ? 'claim.decide.approve' : 'claim.decide.reject'} />}
        />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * Expense categories, hosted by the expense settings screen.
 *
 * Exported and left in this file rather than moved: it was written here with its dialog beside it.
 * Shaped after the leave types tab, which is the reference for every table of master data.
 */
export function ExpenseCategoriesPanel(): ReactNode {
  const [rows, setRows] = useState<ExpenseCategory[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<ExpenseCategory | 'new' | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();
  // The settings screen is open to anybody who can view the module; writing needs `configure`.
  const configurable = can(SCREEN, 'configure');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await expensesApi.categories());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('expense.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: ExpenseCategory): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await expensesApi.deleteCategory(row.id);
      setNotice(t('expense.categories.removed', { code: row.code }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.remove'));
    }
  }

  const needle = search.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      needle.length === 0 ||
      row.code.toLowerCase().includes(needle) ||
      row.name.toLowerCase().includes(needle),
  );

  return (
    <>
      {/* Count in the title, the way the leave types tab heads its list. */}
      <PanelSection
        title={<T k="expense.categories.count" vars={{ count: rows.length }} />}
        subtitle={<T k="expense.categories.subtitle" />}
        action={
          configurable ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden />
              <T k="expense.categories.action.new" />
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
        empty={<T k="expense.categories.empty" />}
        columns={[
          { header: <T k="claim.types.column.code" />, width: 'w-20' },
          { header: <T k="claim.types.column.name" /> },
          { header: <T k="claim.types.column.cap" />, width: 'w-28', align: 'right' },
          { header: <T k="claim.types.column.used" />, width: 'w-24', align: 'right' },
          { header: <T k="panel.column.status" />, width: 'w-24' },
          { header: <T k="panel.column.actions" />, width: 'w-24', align: 'right' },
        ]}
      >
        {filtered.map((row) => (
          <tr
            key={row.id}
            className={cn(
              'border-b border-slate-100 hover:bg-slate-50/70',
              !row.active && 'bg-slate-50/60',
            )}
          >
            <td className="px-5 py-2.5">
              <CodePill code={row.code} />
            </td>
            <td className="px-2 py-2.5">
              <span
                className={cn('block font-medium', row.active ? 'text-slate-800' : 'text-slate-400')}
              >
                {row.name}
              </span>
              {row.description !== null && row.description.length > 0 && (
                <span className="mt-0.5 block text-xs text-slate-500">{row.description}</span>
              )}
            </td>
            <td className="px-2 py-2.5 text-right text-xs tabular-nums text-slate-600">
              {row.maxAmount == null ? '—' : formatRinggit(row.maxAmount)}
            </td>
            <td className="px-2 py-2.5 text-right text-xs tabular-nums text-slate-500">
              {row.requestCount}
            </td>
            <td className="px-2 py-2.5">
              <Badge tone={row.active ? 'success' : 'neutral'}>
                <T k={row.active ? 'app.status.active' : 'app.status.inactive'} />
              </Badge>
            </td>
            <td className="px-2 py-2.5 pr-4">
              {configurable && (
                <RowActions>
                  <RowAction
                    icon={<Pencil className="size-4" aria-hidden />}
                    label={t('expense.categories.row.edit')}
                    tone="edit"
                    onClick={() => setEditing(row)}
                  />
                  {/*
                    Disabled with the count in the tooltip rather than live and refused: a decided
                    expense still has to name the category it was filed under.
                  */}
                  <RowAction
                    icon={<Trash2 className="size-4" aria-hidden />}
                    label={
                      row.requestCount > 0
                        ? t(row.active ? 'hr.row.locked' : 'hr.row.locked.inactive', {
                            count: row.requestCount,
                          })
                        : t('expense.categories.row.remove')
                    }
                    tone="danger"
                    disabled={row.requestCount > 0}
                    onClick={() => void remove(row)}
                  />
                </RowActions>
              )}
            </td>
          </tr>
        ))}
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

      {editing !== null && (
        <CategoryDialog
          target={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={async (message) => {
            setEditing(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </>
  );
}

function CategoryDialog({
  target,
  onClose,
  onDone,
}: {
  target: ExpenseCategory | null;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [code, setCode] = useState(target?.code ?? '');
  const [name, setName] = useState(target?.name ?? '');
  const [description, setDescription] = useState(target?.description ?? '');
  const [cap, setCap] = useState(target?.maxAmount == null ? '' : String(target.maxAmount));
  const [active, setActive] = useState(target?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        /*
          Sent even when empty, because empty is what clears it. The route reads `''` as "none"
          and an absent key as "leave as it was", so omitting it made a cleared box a no-op.
        */
        description: description.trim(),
        // Empty means no ceiling, sent as an explicit null so an edit can clear one.
        maxAmount: cap === '' ? null : Number(cap),
        active,
      };
      if (target === null) await expensesApi.createCategory(body);
      else await expensesApi.updateCategory(target.id, body);
      await onDone(t('expense.categories.saved', { code: body.code }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  const titleKey =
    target === null ? 'expense.categories.form.create' : 'expense.categories.form.edit';

  return (
    <Dialog title={<T k={titleKey} />} titleText={t(titleKey)} width="2xl" onClose={onClose}>
      <div className="space-y-4">
        <Feedback error={error} />

        {/* Identity first: the code somebody types, then the name they read. */}
        <div className="grid gap-4 sm:grid-cols-[7rem_1fr]">
          <Field
            label={<T k="claim.types.form.code" />}
            value={code}
            maxLength={16}
            autoFocus
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <Field
            label={<T k="claim.types.form.name" />}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <TextArea
          label={<T k="claim.types.form.description" />}
          hint={<T k="app.description.hint" />}
          rows={2}
          value={description}
          maxLength={255}
          onChange={(event) => setDescription(event.target.value)}
        />

        {/*
          The picked values on one row, in the claim type form's columns so the two settings
          screens line up. A category classifies and caps; it has no rate, so the row is shorter.
        */}
        <div className="grid items-start gap-4 pb-2 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label={<T k="claim.types.form.cap" />}
            hint={<T k="claim.types.form.cap.hint" />}
            type="number"
            step="0.01"
            min={0}
            value={cap}
            onChange={(event) => setCap(event.target.value)}
          />
          <SelectField
            label={<T k="panel.column.status" />}
            value={active ? 'active' : 'inactive'}
            onChange={(event) => setActive(event.target.value === 'active')}
          >
            <option value="active">{t('app.status.active')}</option>
            <option value="inactive">{t('app.status.inactive')}</option>
          </SelectField>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={code.trim() === '' || name.trim() === ''}
          submitLabel={<T k="dialog.save" />}
        />
      </div>
    </Dialog>
  );
}
