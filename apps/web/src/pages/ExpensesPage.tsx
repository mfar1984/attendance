import {
  CircleAlert,
  CircleCheck,
  CircleX,
  FileText,
  Plus,
  Tags,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

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
import { Badge, Button, Field } from '../components/ui';
import { useAuth } from '../lib/auth';
import { CLAIM_STATUS_LABELS, formatRinggit, type ClaimStatus } from '../lib/claims-api';
import { cn } from '../lib/cn';
import {
  expensesApi,
  type ExpenseCategory,
  type ExpensePage,
  type ExpenseRow,
} from '../lib/expenses-api';
import type { ApprovalTrailEntry } from '../lib/hr-api';
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
 * The same five tabs as Claims and Overtime. The status labels and the money formatter come
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

  return (
    <>
      <PanelSection
        title={<T k="expense.tab.requests" />}
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
          >
            <span className="uppercase">
              <T k={CLAIM_STATUS_LABELS[row.status]} />
            </span>
          </Badge>
          {chainLength > 1 && waiting && row.currentLevel > 0 && (
            <span className="mt-0.5 block text-[10px] text-slate-500">
              <T k="hr.approval.progress" vars={{ level: row.currentLevel, total: chainLength }} />
            </span>
          )}
        </td>
        <td className="px-2 py-2 pr-4">
          <RowActions>
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
                    await onChanged(`${row.requestNo} ditarik.`);
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
                      await onChanged(`${row.requestNo}: resit dibuang.`);
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
  const [staffId, setStaffId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [incurredOn, setIncurredOn] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [payee, setPayee] = useState('');
  const [description, setDescription] = useState('');
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

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const created = await expensesApi.create({
        staffId: Number(staffId),
        categoryId: Number(categoryId),
        incurredOn,
        amount: Number(amount),
        payee,
        description,
      });
      await onDone(`${created.requestNo} direkodkan. ${t('claim.new.receiptNext')}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="expense.new.title" />}
      titleText={t('expense.new.title')}
      description={<T k="expense.new.description" />}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k="claim.new.staff" />}
            type="number"
            inputMode="numeric"
            value={staffId}
            onChange={(event) => setStaffId(event.target.value)}
          />
          <Field
            label={<T k="claim.new.incurredOn" />}
            type="date"
            value={incurredOn}
            max={todayIso()}
            onChange={(event) => setIncurredOn(event.target.value)}
          />
        </div>

        <FacetSelect
          label={t('expense.new.category')}
          value={categoryId}
          onChange={setCategoryId}
          options={categories.map((row) => ({ value: String(row.id), label: row.name }))}
        />

        {chosen?.maxAmount != null && (
          <PanelNote>
            <T k="claim.new.cap" vars={{ cap: formatRinggit(chosen.maxAmount) }} />
          </PanelNote>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k="claim.new.amount" />}
            type="number"
            step="0.01"
            min={0}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <Field
            label={<T k="expense.new.payee" />}
            hint={<T k="expense.new.payee.hint" />}
            value={payee}
            maxLength={190}
            onChange={(event) => setPayee(event.target.value)}
          />
        </div>

        <Field
          label={<T k="claim.new.detail" />}
          value={description}
          maxLength={500}
          onChange={(event) => setDescription(event.target.value)}
        />

        <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
          <T k="claim.new.receiptNext" /> <T k="claim.receipt.hint" />
        </PanelNote>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={
            staffId === '' ||
            categoryId === '' ||
            amount === '' ||
            Number(amount) <= 0 ||
            payee.trim() === '' ||
            description.trim() === ''
          }
          submitLabel={<T k="claim.new.submit" />}
        />
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

      const base = !approve
        ? `${target.requestNo} ditolak.`
        : result.finalized
          ? `${target.requestNo} diluluskan — ${formatRinggit(result.approvedAmount)}.`
          : `${target.requestNo}: ${t('hr.approval.progress', {
              level: result.level,
              total: result.totalLevels,
            })}.`;
      await onDone(base);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
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
 */
export function ExpenseCategoriesPanel(): ReactNode {
  const [rows, setRows] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<ExpenseCategory | 'new' | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

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

  return (
    <>
      <PanelSection
        title={<T k="expense.categories.title" />}
        subtitle={<T k="expense.categories.subtitle" />}
        action={
          can(SCREEN, 'configure') ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden />
              <T k="expense.categories.action.new" />
            </Button>
          ) : undefined
        }
      />

      <PanelBody className="pb-0">
        <Feedback error={error} notice={notice} />
      </PanelBody>

      <RecordTable
        loading={loading}
        rowCount={rows.length}
        empty={<T k="expense.categories.empty" />}
        columns={[
          { header: <T k="claim.types.column.code" />, width: 'w-28' },
          { header: <T k="claim.types.column.name" /> },
          { header: <T k="claim.types.column.cap" />, width: 'w-28', align: 'right' },
          { header: <T k="claim.types.column.used" />, width: 'w-24', align: 'right' },
          { header: <T k="panel.column.actions" />, width: 'w-24', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <tr
            key={row.id}
            className={cn(
              'border-b border-slate-100 hover:bg-slate-50/70',
              !row.active && 'bg-slate-50/60 text-slate-400',
            )}
          >
            <td className="px-5 py-2 font-mono text-xs text-slate-700">{row.code}</td>
            <td className="px-2 py-2">
              <span className={cn('block', row.active ? 'text-slate-800' : 'text-slate-400')}>
                {row.name}
              </span>
              {row.description !== null && (
                <span className="block text-[11px] text-slate-400">{row.description}</span>
              )}
            </td>
            <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-600">
              {row.maxAmount == null ? '—' : formatRinggit(row.maxAmount)}
            </td>
            <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-500">
              {row.requestCount}
            </td>
            <td className="px-2 py-2 pr-4">
              {can(SCREEN, 'configure') && (
                <RowActions>
                  <RowAction
                    icon={<Tags className="size-4" aria-hidden />}
                    label={t('action.edit')}
                    onClick={() => setEditing(row)}
                  />
                </RowActions>
              )}
            </td>
          </tr>
        ))}
      </RecordTable>

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
    try {
      const body = {
        code,
        name,
        ...(description === '' ? {} : { description }),
        maxAmount: cap === '' ? null : Number(cap),
        active,
      };
      if (target === null) await expensesApi.createCategory(body);
      else await expensesApi.updateCategory(target.id, body);
      await onDone(`Kategori ${code.toUpperCase()} disimpan.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="expense.categories.form.title" />}
      titleText={t('expense.categories.form.title')}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k="claim.types.form.code" />}
            value={code}
            maxLength={16}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <Field
            label={<T k="claim.types.form.cap" />}
            hint={<T k="claim.types.form.cap.hint" />}
            type="number"
            step="0.01"
            min={0}
            value={cap}
            onChange={(event) => setCap(event.target.value)}
          />
        </div>

        <Field
          label={<T k="claim.types.form.name" />}
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
        />
        <Field
          label={<T k="claim.types.form.description" />}
          value={description}
          maxLength={255}
          onChange={(event) => setDescription(event.target.value)}
        />

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />
          <T k="claim.types.form.active" />
        </label>

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
