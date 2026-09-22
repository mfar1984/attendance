import {
  CircleAlert,
  CircleCheck,
  CircleX,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  Tags,
  Trash2,
  TriangleAlert,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  BoolMark,
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
import { Badge, Button, CheckCard, Field, SelectField, TextArea } from '../components/ui';
import { useAuth } from '../lib/auth';
import {
  CLAIM_STATUS_LABELS,
  claimsApi,
  formatRinggit,
  type ClaimItem,
  type ClaimPage,
  type ClaimRow,
  type ClaimStatus,
  type ClaimType,
} from '../lib/claims-api';
import { cn } from '../lib/cn';
import type { ApprovalTrailEntry } from '../lib/hr-api';
import { daysAgoIso, formatDateOnly, formatDateTime, todayIso } from '../lib/operations-api';
import { T, useLabels } from '../lib/translation';

const STATUS_DOT: Record<ClaimStatus, string> = {
  pending: 'bg-amber-500',
  approved: 'bg-emerald-600',
  rejected: 'bg-rose-500',
  cancelled: 'bg-slate-400',
};

const SCREEN = 'hr.claims';

/**
 * Claims, and the categories that price them.
 *
 * Five tabs on one entry, the same shape as Overtime and Leave: the queue, the master data,
 * then the three settings the shared engine provides. Consistency across the request modules
 * is the point — an operator who has learned one has learned all of them.
 */
export function ClaimsPage(): ReactNode {
  /*
    One view, so no tab bar. The four configuration tabs moved to
    `/hr/permohonan/tuntutan/tetapan`, which is a sibling entry in the sidebar — the same split
    the permission model already described with `approve` on one side and `configure` on the other.
  */
  return (
    <PanelCard title={<T k="claim.title" />} subtitle={<T k="claim.subtitle" />}>
      <RequestsTab />
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

function RequestsTab(): ReactNode {
  const [data, setData] = useState<ClaimPage | null>(null);
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
  const [deciding, setDeciding] = useState<{ row: ClaimRow; approve: boolean } | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await claimsApi.list({
          page,
          pageSize,
          ...(status === undefined ? {} : { status }),
          from,
          to,
        }),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('claim.error.load'));
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
        title={<T k="claim.tab.requests" />}
        action={
          can(SCREEN, 'create') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              <T k="claim.action.new" />
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
          <T k="claim.note.receipt" />
        </PanelNote>
        <PanelNote>
          <T k="claim.note.notPaid" />
        </PanelNote>
      </PanelBody>

      <RecordTable
        framed
        loading={loading}
        rowCount={rows.length}
        empty={<T k="claim.empty" />}
        columns={[
          { header: <T k="claim.column.requestNo" />, width: 'w-36' },
          { header: <T k="claim.column.staff" /> },
          { header: <T k="claim.column.type" />, width: 'w-40' },
          { header: <T k="claim.column.incurredOn" />, width: 'w-28' },
          { header: <T k="claim.column.items" />, width: 'w-20', align: 'right' },
          { header: <T k="claim.column.amount" />, width: 'w-28', align: 'right' },
          { header: <T k="claim.column.approved" />, width: 'w-28', align: 'right' },
          { header: <T k="claim.column.receipt" />, width: 'w-32' },
          { header: <T k="panel.column.status" />, width: 'w-24' },
          { header: <T k="panel.column.actions" />, width: 'w-32', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <ClaimRowView
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
        <NewClaimDialog
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

function ClaimRowView({
  row,
  chainLength,
  expanded,
  onToggle,
  onApprove,
  onReject,
  onChanged,
  onError,
}: {
  row: ClaimRow;
  chainLength: number;
  expanded: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  onChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
}): ReactNode {
  const [trail, setTrail] = useState<ApprovalTrailEntry[] | null>(null);
  // The file input moved into `ItemReceipt`: one per line, because a shared one would attach the
  // chosen file to whichever line triggered it last.
  const { t } = useLabels();
  const { can } = useAuth();
  const waiting = row.status === 'pending';
  // Approved for less than claimed is a decision worth seeing without opening the row.
  const trimmed = row.status === 'approved' && row.approvedAmount < row.amount;

  useEffect(() => {
    if (!expanded || trail !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const detail = await claimsApi.detail(row.id);
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
          waiting && !expanded && 'bg-amber-50/40',
        )}
      >
        <td className="px-5 py-2 font-mono text-xs text-slate-700">{row.requestNo}</td>
        <td className="px-2 py-2">
          <span className="block text-slate-800">{row.staffName}</span>
          <span className="block font-mono text-[11px] text-slate-400">{row.employeeNo}</span>
        </td>
        <td className="px-2 py-2 text-xs text-slate-600">
          <span className="block">{row.claimTypeName}</span>
          {row.quantity !== null && (
            <span className="block text-[11px] text-slate-400">
              {row.quantity} {row.unitLabel ?? ''} × {formatRinggit(row.ratePerUnit)}
            </span>
          )}
        </td>
        <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-600">
          {row.itemCount}
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
        {/*
          A count, not a link. Receipts hang off lines now, so one cell cannot open "the" receipt —
          and what an approver needs from this column is whether anything is still outstanding.
          Amber when something is, because that is what blocks approval.
        */}
        <td className="px-2 py-2">
          {row.receiptsMissing === 0 ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
              <FileText className="size-3.5" aria-hidden />
              <T k="claim.receipt.allPresent" vars={{ count: row.itemCount }} />
            </span>
          ) : (
            <span className="text-xs font-medium text-amber-700">
              <T
                k="claim.receipt.someMissing"
                vars={{ missing: row.receiptsMissing, count: row.itemCount }}
              />
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
              <T
                k="hr.approval.progress"
                vars={{ level: row.currentLevel, total: chainLength }}
              />
            </span>
          )}
        </td>
        <td className="px-2 py-2 pr-4">
          <RowActions>
            {/*
              No upload action on the row any more. A receipt belongs to a line, and this row has
              several — the upload lives beside each line in the expanded panel, where it is
              unambiguous which cost the file is evidence for.
            */}
            {waiting && can(SCREEN, 'approve') && (
              <>
                <RowAction
                  icon={<CircleCheck className="size-4" aria-hidden />}
                  label={t('claim.decide.approve')}
                  tone="success"
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
                    await claimsApi.cancel(row.id);
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
          <td colSpan={9} className="px-5 py-3">
            <DetailGrid>
              <Detail label={<T k="claim.column.type" />} value={row.claimTypeName} />
              <Detail label={<T k="claim.new.detail" />} value={row.description} />
              <Detail label={<T k="claim.decide.claimed" />} value={formatRinggit(row.amount)} />
              <Detail
                label={<T k="claim.column.approved" />}
                value={row.status === 'approved' ? formatRinggit(row.approvedAmount) : '—'}
              />
              <Detail
                label={<T k="claim.decide.note" />}
                value={row.decisionNote ?? '—'}
              />
            </DetailGrid>

            {/*
              The lines, each with its own receipt control.
              This is where the upload lives, because here it is unambiguous which cost the file is
              evidence for — on the collapsed row it would have been a guess.
            */}
            <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/70">
                  <tr className="border-b border-slate-200 text-left text-[11px] tracking-wide text-slate-500 uppercase">
                    <th scope="col" className="px-3 py-2 font-medium">
                      <T k="claim.new.items.date" />
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium">
                      <T k="claim.new.items.description" />
                    </th>
                    <th scope="col" className="w-32 px-2 py-2 font-medium">
                      <T k="claim.new.items.category" />
                    </th>
                    <th scope="col" className="w-24 px-2 py-2 text-right font-medium">
                      <T k="claim.column.amount" />
                    </th>
                    <th scope="col" className="w-40 px-2 py-2 font-medium">
                      <T k="claim.column.receipt" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {row.items.map((item) => (
                    <tr key={item.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2 text-xs tabular-nums text-slate-700">
                        {formatDateOnly(item.incurredOn)}
                      </td>
                      <td className="px-2 py-2 text-slate-800">
                        {item.description}
                        {item.quantity !== null && (
                          <span className="ml-1.5 text-xs text-slate-500 tabular-nums">
                            {`${String(item.quantity)} ${row.unitLabel ?? ''}`}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-xs text-slate-500">{item.category ?? '—'}</td>
                      <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-700">
                        {formatRinggit(item.amount)}
                      </td>
                      <td className="px-2 py-2">
                        <ItemReceipt
                          item={item}
                          editable={waiting && can(SCREEN, 'create')}
                          removable={waiting && can(SCREEN, 'edit')}
                          onChanged={onChanged}
                          onError={onError}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

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

/**
 * The receipt control for one line: open it, replace it, or remove it.
 *
 * Its own component because each line needs its own hidden file input — one input shared across the
 * lines would attach whatever was chosen to whichever line happened to have triggered it last, and
 * that is a receipt filed against the wrong cost.
 */
function ItemReceipt({
  item,
  editable,
  removable,
  onChanged,
  onError,
}: {
  item: ClaimItem;
  editable: boolean;
  removable: boolean;
  onChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
}): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  const { t } = useLabels();

  return (
    <span className="flex items-center gap-1.5">
      {item.hasReceipt ? (
        <a
          href={claimsApi.receiptUrl(item.id)}
          target="_blank"
          rel="noreferrer"
          title={t('claim.receipt.open')}
          className="text-brand-700 inline-flex items-center gap-1 text-xs hover:underline"
        >
          <FileText className="size-3.5" aria-hidden />
          <T k="claim.receipt.present" />
        </a>
      ) : (
        <span className="text-[11px] text-amber-700">
          <T k="claim.receipt.missing" />
        </span>
      )}

      {editable && (
        <>
          <input
            ref={input}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                await claimsApi.uploadReceipt(item.id, file);
                await onChanged(t('claim.receipt.uploaded'));
              } catch (cause) {
                onError(cause instanceof Error ? cause.message : '');
              } finally {
                // Cleared so choosing the same file again still fires a change.
                event.target.value = '';
              }
            }}
          />
          <RowAction
            icon={<Upload className="size-4" aria-hidden />}
            label={t('claim.receipt.upload')}
            onClick={() => input.current?.click()}
          />
        </>
      )}

      {item.hasReceipt && removable && (
        <RowAction
          icon={<Trash2 className="size-4" aria-hidden />}
          label={t('claim.receipt.remove')}
          tone="danger"
          onClick={async () => {
            try {
              await claimsApi.removeReceipt(item.id);
              await onChanged(t('claim.receipt.removed'));
            } catch (cause) {
              onError(cause instanceof Error ? cause.message : '');
            }
          }}
        />
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// New claim
// ---------------------------------------------------------------------------

type PickedStaff = {
  id: number;
  employeeNo: string;
  fullName: string;
  department: { name: string } | null;
};

/**
 * One line being typed.
 *
 * Every numeric field is a string, because that is what an input holds. `'12.'` is a legitimate
 * intermediate state and coercing it to a number mid-keystroke would delete the operator's decimal
 * point as they typed it.
 *
 * `key` is a client-side identity so React can keep inputs stable while lines are removed from the
 * middle. The array index cannot do that job: deleting line 2 would make line 3 inherit its state.
 */
type DraftItem = {
  key: string;
  incurredOn: string;
  description: string;
  category: string;
  quantity: string;
  amount: string;
  /**
   * The receipt chosen for this line, held until the line exists.
   *
   * It cannot travel with the claim: this is a handle to something on the user's disk, not a value in
   * the form, and the JSON body has nowhere to put it. So the file waits here, the claim is filed, and
   * each line's file is posted against the row that came back.
   *
   * Collected here rather than only afterwards because the person filing has the receipts in front of
   * them at that moment. Sending them to the list to attach three files one row at a time is how
   * claims sit unapproved for a week.
   */
  file: File | null;
};

let draftCounter = 0;
function blankItem(): DraftItem {
  draftCounter += 1;
  return {
    key: `draft-${String(draftCounter)}`,
    incurredOn: todayIso(),
    description: '',
    category: '',
    quantity: '',
    amount: '',
    file: null,
  };
}

/** Same ceiling the upload route enforces, checked here so a 4 MB photo is refused before submit. */
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;

/**
 * The file picker for one draft line.
 *
 * Its own component for the same reason `ItemReceipt` is: each line needs its own hidden input. One
 * input shared across the lines attaches whatever was chosen to whichever line triggered it last,
 * which is a receipt filed against the wrong cost.
 */
function DraftReceipt({
  item,
  required,
  onPick,
  onError,
}: {
  item: DraftItem;
  required: boolean;
  onPick: (file: File | null) => void;
  onError: (message: string) => void;
}): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  const { t } = useLabels();

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-200 pt-2.5">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
        <Paperclip className="size-3.5 text-slate-400" aria-hidden />
        <T k="claim.new.items.receipt" />
      </span>

      <input
        ref={input}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          // Cleared so choosing the same file again still fires a change.
          event.target.value = '';
          if (file === null) return;
          if (file.size > MAX_RECEIPT_BYTES) {
            onError(t('claim.new.items.receipt.tooBig', { name: file.name }));
            return;
          }
          onPick(file);
        }}
      />

      <Button
        variant="ghost"
        onClick={() => input.current?.click()}
        title={t('claim.new.items.receipt.formats')}
      >
        <Upload className="size-4" aria-hidden />
        {item.file === null ? (
          <T k="claim.new.items.receipt.attach" />
        ) : (
          <T k="claim.new.items.receipt.replace" />
        )}
      </Button>

      {item.file === null ? (
        /*
          Amber only when the category demands one. On a category that asks for no paper an empty
          slot is a detail, and colouring it would make every mileage line look incomplete.
        */
        <span className={cn('text-xs', required ? 'text-amber-700' : 'text-slate-500')}>
          <T k="claim.new.items.receipt.none" />
        </span>
      ) : (
        <>
          <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-slate-700">
            <FileText className="size-3.5 shrink-0 text-slate-400" aria-hidden />
            <span className="truncate">{item.file.name}</span>
            <span className="shrink-0 tabular-nums text-slate-400">
              {Math.max(1, Math.round(item.file.size / 1024))} KB
            </span>
          </span>
          {/*
            The wording says the upload has not happened yet. A control labelled "attach" that does
            nothing until submit is a control that lies about what it did.
          */}
          <span className="text-[11px] text-slate-500 italic">
            <T k="claim.new.items.receipt.pending" />
          </span>
          <RowAction
            icon={<Trash2 className="size-4" aria-hidden />}
            label={t('claim.new.items.receipt.clear')}
            tone="danger"
            onClick={() => onPick(null)}
          />
        </>
      )}
    </div>
  );
}

function NewClaimDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [types, setTypes] = useState<ClaimType[]>([]);
  const [staff, setStaff] = useState<PickedStaff | null>(null);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<PickedStaff[]>([]);
  const [searching, setSearching] = useState(false);
  const [typeId, setTypeId] = useState('');
  const [incurredOn, setIncurredOn] = useState(todayIso());
  const [description, setDescription] = useState('');
  const [remarks, setRemarks] = useState('');
  /**
   * The lines, which is what a claim is now.
   *
   * Held as strings because they are form fields: a partially typed amount is `'12.'`, which is not a
   * number and must not be coerced into one while somebody is still typing.
   */
  const [items, setItems] = useState<DraftItem[]>([blankItem()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  useEffect(() => {
    void (async () => {
      try {
        const list = await claimsApi.types();
        setTypes(list.filter((type) => type.active));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : null);
      }
    })();
  }, []);

  // Same debounce and same shape as the leave form's picker.
  useEffect(() => {
    if (staff !== null) return;
    setSearching(true);
    const timer = setTimeout(() => {
      void claimsApi
        .searchStaff(query)
        .then(setCandidates)
        .catch(() => setCandidates([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, staff]);

  const chosen = types.find((type) => String(type.id) === typeId) ?? null;
  const rated = chosen?.ratePerUnit != null;

  /**
   * What one line comes to, computed the same way the server will.
   *
   * A rated category refuses a typed amount, so the applicant has to see what the quantity produces
   * before submitting — otherwise the figure only appears after the fact. Rounded in the same
   * direction as `ratedAmount` on the server, so the running total on screen is the total that gets
   * stored rather than an estimate of it.
   */
  const lineAmount = (item: DraftItem): number => {
    if (rated) {
      if (item.quantity === '' || chosen?.ratePerUnit == null) return 0;
      return Math.round(Number(item.quantity) * chosen.ratePerUnit * 100) / 100;
    }
    return item.amount === '' ? 0 : Number(item.amount);
  };

  /** Summed in sen so a run of two-decimal lines cannot drift by a cent. */
  const total =
    items.reduce((sum, item) => sum + Math.round(lineAmount(item) * 100), 0) / 100;

  const setItem = (key: string, patch: Partial<DraftItem>): void => {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  };

  const overCap = chosen?.maxAmount != null && total > chosen.maxAmount;

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      if (staff === null) return;
      /*
       * The total is not sent. The server sums it from the lines, because a figure the client
       * computes is a figure the client can get wrong — and this one turns into money.
       */
      const created = await claimsApi.create({
        staffId: staff.id,
        claimTypeId: Number(typeId),
        incurredOn,
        description,
        ...(remarks.trim() === '' ? {} : { remarks: remarks.trim() }),
        items: items.map((item) => ({
          incurredOn: item.incurredOn,
          description: item.description.trim(),
          ...(item.category.trim() === '' ? {} : { category: item.category.trim() }),
          ...(rated ? { quantity: Number(item.quantity) } : { amount: Number(item.amount) }),
        })),
      });
      /*
       * The receipts go up after the claim exists, one per line, mapped positionally.
       *
       * Sequential rather than `Promise.all`: these are file uploads over a hospital network, and
       * firing fifty at once is how the first few succeed and the rest time out. Order also makes the
       * failure count mean something.
       *
       * A failed upload does not fail the claim. The claim is already stored and the lines are already
       * on it — throwing here would leave the screen reporting an error for a record that exists,
       * which is the reading that makes somebody file it a second time. The count is reported instead,
       * and the missing paper can be attached from the list.
       */
      let uploaded = 0;
      let failed = 0;
      for (const [index, item] of items.entries()) {
        const itemId = created.itemIds[index];
        if (item.file === null || itemId === undefined) continue;
        try {
          await claimsApi.uploadReceipt(itemId, item.file);
          uploaded += 1;
        } catch {
          failed += 1;
        }
      }

      const parts = [`${created.requestNo} direkodkan.`];
      if (uploaded > 0) parts.push(t('claim.new.uploaded', { count: uploaded }));
      if (failed > 0) parts.push(t('claim.new.uploadFailed', { count: failed }));
      /*
       * The reminder only when paper is still owed. Saying "attach the receipts next" to somebody who
       * just attached all of them reads as if the upload had not worked.
       */
      else if (created.receiptRequired && uploaded < items.length) {
        parts.push(t('claim.new.receiptNext'));
      }

      await onDone(parts.join(' '));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  const linesReady =
    items.length > 0 &&
    items.every(
      (item) =>
        item.incurredOn !== '' &&
        item.description.trim() !== '' &&
        (rated ? Number(item.quantity) > 0 : Number(item.amount) > 0),
    );

  const blocked =
    staff === null || typeId === '' || description.trim() === '' || !linesReady || overCap;

  return (
    <Dialog
      title={<T k="claim.new.title" />}
      titleText={t('claim.new.title')}
      description={<T k="claim.new.description" />}
      width="3xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/*
          Name first, then the form — the same two stages as the leave form, and for the same reason:
          a select of five thousand staff is a quarter of a megabyte of options with no way to search
          it. Everything after the picker is one screen.
        */}
        {staff === null ? (
          <div>
            <Field
              label={<T k="claim.new.staff" />}
              hint={<T k="claim.new.staff.hint" />}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('leave.new.searchStaff.placeholder')}
              autoFocus
            />

            <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-slate-200">
              {searching && candidates.length === 0 ? (
                <div className="flex min-h-24 items-center justify-center">
                  <Loader2 className="size-4 animate-spin text-slate-400" aria-label={t('app.loading')} />
                </div>
              ) : candidates.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-slate-500">
                  <T k="leave.new.noMatch" />
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {candidates.map((candidate) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        onClick={() => setStaff(candidate)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
                      >
                        <UserRound className="size-4 shrink-0 text-slate-400" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-800">
                            {candidate.fullName}
                          </span>
                          <span className="block truncate font-mono text-xs text-slate-500">
                            {candidate.employeeNo}
                            {candidate.department !== null && ` · ${candidate.department.name}`}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <UserRound className="size-4 text-slate-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{staff.fullName}</p>
                <p className="font-mono text-xs text-slate-500">
                  {staff.employeeNo}
                  {staff.department !== null && ` · ${staff.department.name}`}
                </p>
              </div>
              <Button variant="ghost" onClick={() => setStaff(null)}>
                <T k="leave.new.change" />
              </Button>
            </div>

            <div className="grid items-start gap-4 sm:grid-cols-2">
              {/*
                Each option carries the category's own pricing rule, so the difference between a rated
                and a flat category is visible before it changes what the line asks for.
              */}
              <SelectField
                label={<T k="claim.new.type" />}
                value={typeId}
                onChange={(event) => setTypeId(event.target.value)}
                hint={
                  chosen?.maxAmount != null ? (
                    <T k="claim.new.cap" vars={{ cap: formatRinggit(chosen.maxAmount) }} />
                  ) : undefined
                }
              >
                <option value="">{t('claim.new.type')}</option>
                {types.map((type) => (
                  <option key={type.id} value={String(type.id)}>
                    {type.ratePerUnit == null
                      ? type.maxAmount == null
                        ? type.name
                        : `${type.name} (had ${formatRinggit(type.maxAmount)})`
                      : `${type.name} — RM ${String(type.ratePerUnit)}/${type.unitLabel ?? ''}`}
                  </option>
                ))}
              </SelectField>
              <Field
                label={<T k="claim.new.incurredOn" />}
                hint={<T k="claim.new.incurredOn.hint" />}
                type="date"
                value={incurredOn}
                max={todayIso()}
                onChange={(event) => setIncurredOn(event.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextArea
                label={<T k="claim.new.detail" />}
                hint={<T k="claim.new.detail.hint" />}
                rows={2}
                value={description}
                maxLength={500}
                onChange={(event) => setDescription(event.target.value)}
              />
              <TextArea
                label={<T k="leave.new.remarks" />}
                hint={<T k="claim.new.remarks.hint" />}
                rows={2}
                value={remarks}
                maxLength={500}
                placeholder={t('leave.new.remarks.placeholder')}
                onChange={(event) => setRemarks(event.target.value)}
              />
            </div>

            {/* ── The lines ── */}
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">
                  <T k="claim.new.items" />
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {chosen?.requiresReceipt === true ? (
                    <T k="claim.new.items.receiptHint" />
                  ) : (
                    <T k="claim.new.items.hint" />
                  )}
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={() => setItems((current) => [...current, blankItem()])}
                disabled={items.length >= 50}
              >
                <Plus className="size-4" aria-hidden />
                <T k="claim.new.items.add" />
              </Button>
            </div>

            <div className="space-y-3">
              {items.map((item, index) => (
                <div
                  key={item.key}
                  className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                      <T k="claim.new.items.row" vars={{ index: index + 1 }} />
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs tabular-nums text-slate-600">
                        {formatRinggit(lineAmount(item))}
                      </span>
                      {/*
                        Disabled on the last line rather than hidden, with the reason in the tooltip.
                        A claim with no lines has no amount, so the server refuses it — disabling here
                        says so before the submit does.
                      */}
                      <RowAction
                        icon={<Trash2 className="size-4" aria-hidden />}
                        label={
                          items.length === 1
                            ? t('claim.new.items.lastRow')
                            : t('claim.new.items.remove')
                        }
                        tone="danger"
                        disabled={items.length === 1}
                        onClick={() =>
                          setItems((current) => current.filter((row) => row.key !== item.key))
                        }
                      />
                    </span>
                  </div>

                  <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field
                      label={<T k="claim.new.items.date" />}
                      type="date"
                      value={item.incurredOn}
                      max={todayIso()}
                      onChange={(event) => setItem(item.key, { incurredOn: event.target.value })}
                    />
                    <Field
                      label={<T k="claim.new.items.description" />}
                      value={item.description}
                      maxLength={255}
                      placeholder={t('claim.new.items.description.placeholder')}
                      onChange={(event) => setItem(item.key, { description: event.target.value })}
                    />
                    <Field
                      label={<T k="claim.new.items.category" />}
                      value={item.category}
                      maxLength={120}
                      placeholder={t('claim.new.items.category.placeholder')}
                      onChange={(event) => setItem(item.key, { category: event.target.value })}
                    />
                    {/*
                      A rated category asks for the quantity and derives the money; a flat one asks for
                      the money. Never both: accepting a typed amount on a rated category would make
                      the rate decorative, and the rate is the whole control.
                    */}
                    {rated ? (
                      <Field
                        label={
                          <T k="claim.new.quantity" vars={{ unit: chosen?.unitLabel ?? '' }} />
                        }
                        hint={
                          <T
                            k="claim.new.quantity.hint"
                            vars={{ amount: formatRinggit(lineAmount(item)) }}
                          />
                        }
                        type="number"
                        step="0.01"
                        min={0}
                        value={item.quantity}
                        onChange={(event) => setItem(item.key, { quantity: event.target.value })}
                      />
                    ) : (
                      <Field
                        label={<T k="claim.new.amount" />}
                        type="number"
                        step="0.01"
                        min={0}
                        value={item.amount}
                        onChange={(event) => setItem(item.key, { amount: event.target.value })}
                      />
                    )}
                  </div>

                  {/*
                    A strip of its own under the fields, not a fifth column. It carries a filename and
                    a size, which no column width accommodates, and the separator is what says the
                    paper belongs to the line above rather than being another value on it.
                  */}
                  <DraftReceipt
                    item={item}
                    required={chosen?.requiresReceipt === true}
                    onPick={(file) => setItem(item.key, { file })}
                    onError={setError}
                  />
                </div>
              ))}
            </div>

            {/*
              The last block before the footer, so it carries the `pb-2`.

              `DialogFooter` is `sticky bottom-0` with a negative margin that cancels the body
              padding, which means on a form long enough to scroll it floats over the content. Without
              the padding the total strip sat directly on the footer's rule with no gap at all, and a
              tinted box touching a separator reads as clipped rather than as finished.
            */}
            <div className="space-y-4 pb-2">
              {/*
                Total on a tinted strip, because it is the figure that becomes money and it should be
                the last thing read before the submit. Amber when it breaks the category's ceiling —
                the server refuses that, so saying it here saves a round trip.
              */}
              <div
                className={cn(
                  'flex flex-wrap items-baseline justify-between gap-2 rounded-lg border px-3 py-2.5',
                  overCap
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-emerald-200 bg-emerald-50/70 text-emerald-900',
                )}
              >
                <span className="text-sm font-medium">
                  <T k="claim.new.total" />
                </span>
                <span className="text-lg font-semibold tabular-nums">{formatRinggit(total)}</span>
                {overCap && chosen?.maxAmount != null && (
                  <span className="w-full text-xs">
                    <T k="claim.new.total.overCap" vars={{ cap: formatRinggit(chosen.maxAmount) }} />
                  </span>
                )}
              </div>

              {chosen?.requiresReceipt === true && (
                <PanelNote tone="warn" icon={<Paperclip className="size-3.5" aria-hidden />}>
                  <T k="claim.new.receiptNext" /> <T k="claim.receipt.hint" />
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
  target: ClaimRow;
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
      const result = await claimsApi.decide(target.id, {
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
          <Detail label={<T k="claim.column.type" />} value={target.claimTypeName} />
          <Detail
            label={<T k="claim.column.incurredOn" />}
            value={formatDateOnly(target.incurredOn)}
          />
          <Detail label={<T k="claim.decide.claimed" />} value={formatRinggit(target.amount)} />
          <Detail label={<T k="claim.new.detail" />} value={target.description} />
        </DetailGrid>

        {/*
          Stated before the attempt rather than returned as a 409 afterwards. The approver
          cannot fix it from here — somebody has to attach the file first.
        */}
        {approve && !target.hasReceipt && (
          <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="claim.decide.noReceipt" />
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
              ? approved === '' || Number(approved) <= 0 || Number(approved) > target.amount
              : note.trim().length < 3
          }
          submitLabel={<T k={approve ? 'claim.decide.approve' : 'claim.decide.reject'} />}
        />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Claim types
// ---------------------------------------------------------------------------

/**
 * Claim types, hosted by the claim settings screen.
 *
 * Exported and left in this file rather than moved: it was written here with its dialog beside it,
 * and relocating it would be risk with no behaviour attached.
 */
export function ClaimTypesPanel(): ReactNode {
  const [rows, setRows] = useState<ClaimType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<ClaimType | 'new' | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await claimsApi.types());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('claim.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      {/* Count in the title, the way the leave types tab heads its list. */}
      <PanelSection
        title={<T k="claim.types.count" vars={{ count: rows.length }} />}
        subtitle={<T k="claim.types.subtitle" />}
        action={
          can(SCREEN, 'configure') ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden />
              <T k="claim.types.action.new" />
            </Button>
          ) : undefined
        }
      />

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      {/*
        No "Posts to account" column, and none in the dialog either.
        The reference has one because it sits inside an accounting package and a paid claim debits a
        ledger account there. This application has no general ledger — a claim here ends at
        "approved and paid", and a dropdown naming accounts that nothing posts to would be a control
        that does nothing, which is worse than no control.
      */}
      <RecordTable
        framed
        loading={loading}
        rowCount={rows.length}
        empty={<T k="claim.types.empty" />}
        columns={[
          { header: <T k="claim.types.column.code" />, width: 'w-20' },
          { header: <T k="claim.types.column.name" /> },
          { header: <T k="claim.types.column.rate" />, width: 'w-32', align: 'right' },
          { header: <T k="claim.types.column.cap" />, width: 'w-28', align: 'right' },
          { header: <T k="claim.types.column.receipt" />, width: 'w-24' },
          { header: <T k="claim.types.column.approval" />, width: 'w-24' },
          { header: <T k="claim.types.column.used" />, width: 'w-24', align: 'right' },
          { header: <T k="panel.column.status" />, width: 'w-24' },
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
            <td className="px-5 py-2.5">
              <CodePill code={row.code} />
            </td>
            <td className="px-2 py-2.5">
              <span
                className={cn('block font-medium', row.active ? 'text-slate-800' : 'text-slate-400')}
              >
                {row.name}
              </span>
              {row.description !== null && (
                <span className="mt-0.5 block text-xs text-slate-500">{row.description}</span>
              )}
            </td>
            <td className="px-2 py-2.5 text-right text-xs tabular-nums text-slate-700">
              {row.ratePerUnit == null ? (
                <span className="text-slate-400">
                  <T k="claim.types.flat" />
                </span>
              ) : (
                `RM ${String(row.ratePerUnit)}/${row.unitLabel ?? ''}`
              )}
            </td>
            <td className="px-2 py-2.5 text-right text-xs tabular-nums text-slate-600">
              {row.maxAmount == null ? '—' : formatRinggit(row.maxAmount)}
            </td>
            {/*
              Marks, not an amber badge against a dash. The old shape made "receipt required" shout
              and "not required" vanish, so a column of nine rows read as one value and eight blanks.
            */}
            <td className="px-2 py-2.5">
              <BoolMark
                value={row.requiresReceipt}
                label={t(row.requiresReceipt ? 'claim.types.receipt.yes' : 'claim.types.receipt.no')}
              />
            </td>
            <td className="px-2 py-2.5">
              <BoolMark
                value={row.requiresApproval}
                label={t(
                  row.requiresApproval ? 'claim.types.approval.yes' : 'claim.types.approval.auto',
                )}
              />
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
        <TypeDialog
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

function TypeDialog({
  target,
  onClose,
  onDone,
}: {
  target: ClaimType | null;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [code, setCode] = useState(target?.code ?? '');
  const [name, setName] = useState(target?.name ?? '');
  const [description, setDescription] = useState(target?.description ?? '');
  const [rate, setRate] = useState(target?.ratePerUnit == null ? '' : String(target.ratePerUnit));
  const [unit, setUnit] = useState(target?.unitLabel ?? '');
  const [cap, setCap] = useState(target?.maxAmount == null ? '' : String(target.maxAmount));
  const [requiresReceipt, setRequiresReceipt] = useState(target?.requiresReceipt ?? true);
  const [requiresApproval, setRequiresApproval] = useState(target?.requiresApproval ?? true);
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
        // Empty means flat, expressed as an explicit null so an edit can clear a rate.
        ratePerUnit: rate === '' ? null : Number(rate),
        ...(unit === '' ? {} : { unitLabel: unit }),
        maxAmount: cap === '' ? null : Number(cap),
        requiresReceipt,
        requiresApproval,
        active,
      };
      if (target === null) await claimsApi.createType(body);
      else await claimsApi.updateType(target.id, body);
      await onDone(`Jenis ${code.toUpperCase()} disimpan.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="claim.types.form.title" />}
      titleText={t('claim.types.form.title')}
      width="2xl"
      onClose={onClose}
    >
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
          hint={<T k="claim.types.form.description.hint" />}
          rows={2}
          value={description}
          maxLength={255}
          onChange={(event) => setDescription(event.target.value)}
        />

        {/*
          The four picked values on one row, every label one line so the inputs share a baseline.

          No "Posts to account" here. The reference has one because it lives inside an accounting
          package; this application has no general ledger, and a dropdown naming accounts that
          nothing posts to would be a control that does nothing.
        */}
        <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
          <Field
            label={<T k="claim.types.form.cap" />}
            hint={<T k="claim.types.form.cap.hint" />}
            type="number"
            step="0.01"
            min={0}
            value={cap}
            onChange={(event) => setCap(event.target.value)}
          />
          <Field
            label={<T k="claim.types.form.rate" />}
            hint={<T k="claim.types.form.rate.hint" />}
            type="number"
            step="0.01"
            min={0}
            value={rate}
            onChange={(event) => setRate(event.target.value)}
          />
          <Field
            label={<T k="claim.types.form.unit" />}
            hint={<T k="claim.types.form.unit.hint" />}
            value={unit}
            maxLength={24}
            onChange={(event) => setUnit(event.target.value)}
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

        <div className="space-y-2 pb-2">
          <CheckCard
            checked={requiresReceipt}
            onChange={setRequiresReceipt}
            icon={<Paperclip className="size-4" aria-hidden />}
            title={<T k="claim.types.form.requiresReceipt" />}
            hint={<T k="claim.types.form.requiresReceipt.hint" />}
          />
          <CheckCard
            checked={requiresApproval}
            onChange={setRequiresApproval}
            icon={<CircleCheck className="size-4" aria-hidden />}
            title={<T k="claim.types.form.requiresApproval" />}
            hint={<T k="claim.types.form.requiresApproval.hint" />}
          />
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={code.trim() === '' || name.trim() === '' || (rate !== '' && unit.trim() === '')}
          submitLabel={<T k="dialog.save" />}
        />
      </div>
    </Dialog>
  );
}
