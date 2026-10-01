import type { LabelKey } from '@attendance/shared';
import { CircleCheck, CircleX, Pencil, Plus, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { formatDateOnly, todayIso } from '../lib/operations-api';
import {
  BONUS_TYPE_LABELS,
  COMMISSION_TYPE_LABELS,
  RECORD_STATE_LABELS,
  payrollApi,
  type AppraisalPeriodOption,
  type AwardPage,
  type AwardRow,
  type PeriodOption,
  type RecordState,
} from '../lib/payroll-api';
import { T, TEnum, useLabels } from '../lib/translation';
import { Dialog, DialogFooter, Feedback } from './Dialog';
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
} from './RecordPanel';
import { StaffPicker, type PickedStaff } from './StaffPicker';
import { Badge, Button, Field, SelectField, TextArea } from './ui';

/**
 * Bonuses and commissions, which are the same screen with different words on it.
 *
 * Shared as a component rather than merged into one route: they carry separate permission keys,
 * because they are granted by different people for different reasons. A single screen would have
 * to pick one key to check, and whichever it picked would hand over the other for free. For the
 * same reason the staff search and the period list are read from this kind's own endpoints rather
 * than borrowed from the directory or the payroll period screen.
 *
 * The wording is passed in as label keys, so the two screens cannot drift into saying "bonus"
 * where the other says "komisen".
 */
export interface AwardCopy {
  kind: 'bonuses' | 'commissions';
  screen: 'hr.bonuses' | 'hr.commissions';
  title: LabelKey;
  subtitle: LabelKey;
  /** The section heading: a count, as on every list. */
  count: LabelKey;
  add: LabelKey;
  empty: LabelKey;
  errorLoad: LabelKey;
  formTitle: LabelKey;
  formEdit: LabelKey;
  formStaff: LabelKey;
  formKind: LabelKey;
  formName: LabelKey;
  formAmount: LabelKey;
  formDate: LabelKey;
  formPeriod: LabelKey;
  formNote: LabelKey;
  columnReference: LabelKey;
  columnStaff: LabelKey;
  columnKind: LabelKey;
  columnName: LabelKey;
  columnAmount: LabelKey;
  columnDate: LabelKey;
  columnPeriod: LabelKey;
  kinds: readonly string[];
  kindLabels: Record<string, LabelKey>;
  /** Only bonuses can be generated from appraisals, so this is optional. */
  generate?: boolean;
}

export const BONUS_COPY: AwardCopy = {
  kind: 'bonuses',
  screen: 'hr.bonuses',
  title: 'pay.bonus.title',
  subtitle: 'pay.bonus.subtitle',
  count: 'pay.bonus.count',
  add: 'pay.bonus.action.add',
  empty: 'pay.bonus.empty',
  errorLoad: 'pay.bonus.error.load',
  formTitle: 'pay.bonus.form.title',
  formEdit: 'pay.bonus.form.edit',
  formStaff: 'pay.bonus.form.staff',
  formKind: 'pay.bonus.form.kind',
  formName: 'pay.bonus.form.name',
  formAmount: 'pay.bonus.form.amount',
  formDate: 'pay.bonus.form.date',
  formPeriod: 'pay.bonus.form.period',
  formNote: 'pay.bonus.form.note',
  columnReference: 'pay.bonus.column.reference',
  columnStaff: 'pay.bonus.column.staff',
  columnKind: 'pay.bonus.column.kind',
  columnName: 'pay.bonus.column.name',
  columnAmount: 'pay.bonus.column.amount',
  columnDate: 'pay.bonus.column.date',
  columnPeriod: 'pay.bonus.column.period',
  kinds: ['performance', 'annual', 'festival', 'project', 'attendance', 'other'],
  kindLabels: BONUS_TYPE_LABELS,
  generate: true,
};

export const COMMISSION_COPY: AwardCopy = {
  kind: 'commissions',
  screen: 'hr.commissions',
  title: 'pay.commission.title',
  subtitle: 'pay.commission.subtitle',
  count: 'pay.commission.count',
  add: 'pay.commission.action.add',
  empty: 'pay.commission.empty',
  errorLoad: 'pay.commission.error.load',
  formTitle: 'pay.commission.form.title',
  formEdit: 'pay.commission.form.edit',
  formStaff: 'pay.commission.form.staff',
  formKind: 'pay.commission.form.kind',
  formName: 'pay.commission.form.name',
  formAmount: 'pay.commission.form.amount',
  formDate: 'pay.commission.form.date',
  formPeriod: 'pay.commission.form.period',
  formNote: 'pay.commission.form.note',
  columnReference: 'pay.commission.column.reference',
  columnStaff: 'pay.commission.column.staff',
  columnKind: 'pay.commission.column.kind',
  columnName: 'pay.commission.column.name',
  columnAmount: 'pay.commission.column.amount',
  columnDate: 'pay.commission.column.date',
  columnPeriod: 'pay.commission.column.period',
  kinds: ['sales', 'project', 'referral', 'other'],
  kindLabels: COMMISSION_TYPE_LABELS,
};

type AwardState = Extract<RecordState, 'pending' | 'approved' | 'paid' | 'cancelled'>;

const STATES: AwardState[] = ['pending', 'approved', 'paid', 'cancelled'];

const STATE_DOT: Record<AwardState, string> = {
  pending: 'bg-amber-500',
  approved: 'bg-sky-500',
  paid: 'bg-emerald-600',
  cancelled: 'bg-slate-400',
};

/** Register for approved, verdict for the rest: approved is signed but not yet money. */
const STATE_TONE: Record<string, 'neutral' | 'warning' | 'success' | 'info'> = {
  pending: 'warning',
  approved: 'info',
  paid: 'success',
  cancelled: 'neutral',
};

/**
 * A payroll period the run will still build — the only kind an award can be attached to, approved
 * into or cancelled out of.
 *
 * A draft, and not `processing`: the run reads approved awards when it builds the payslips and
 * does not run again after that. Mirrors `assertRebuildable` on the server.
 */
function rebuildable(status: string | null): boolean {
  return status === 'draft';
}

export function AwardsPanel({ copy }: { copy: AwardCopy }): ReactNode {
  const [data, setData] = useState<AwardPage | null>(null);
  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<AwardState | undefined>(undefined);
  const [periodId, setPeriodId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AwardRow | null>(null);
  const [deciding, setDeciding] = useState<{ row: AwardRow; action: 'approve' | 'cancel' } | null>(
    null,
  );
  const [removing, setRemoving] = useState<AwardRow | null>(null);
  const [generating, setGenerating] = useState(false);
  const { t } = useLabels();
  const { can } = useAuth();
  // Which load is the latest, so a search answered out of order cannot replace the current rows.
  const latest = useRef(0);

  // One request per pause in typing, not one per key — the same debounce as the request lists.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadPeriods = useCallback(async () => {
    try {
      setPeriods(await payrollApi.awardPeriods(copy.kind));
    } catch {
      // The filter and the dialog say so when there is no period to choose.
    }
  }, [copy.kind]);

  useEffect(() => {
    void loadPeriods();
  }, [loadPeriods]);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    try {
      const result = await payrollApi.awards(copy.kind, {
        page,
        pageSize,
        ...(debounced === '' ? {} : { search: debounced }),
        ...(status === undefined ? {} : { status }),
        ...(periodId === '' ? {} : { periodId: Number(periodId) }),
      });
      if (mine !== latest.current) return;
      setData(result);
      setError(null);
    } catch (cause) {
      if (mine !== latest.current) return;
      setError(cause instanceof Error ? cause.message : t(copy.errorLoad));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [copy.kind, copy.errorLoad, page, pageSize, debounced, status, periodId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const done = async (message: string): Promise<void> => {
    setCreating(false);
    setEditing(null);
    setDeciding(null);
    setRemoving(null);
    setGenerating(false);
    setNotice(message);
    await load();
  };

  const rows = data?.rows ?? [];
  const counts = data?.counts ?? {};
  // The heading counts every status, so choosing a chip does not make it shrink with the table.
  const count = Object.values(counts).reduce((sum, value) => sum + value, 0);

  return (
    <PanelCard title={<T k={copy.title} />} subtitle={<T k={copy.subtitle} />}>
      <PanelSection
        title={<T k={copy.count} vars={{ count }} />}
        action={
          can(copy.screen, 'create') ? (
            /*
              Two ways to create, kept together so neither reads as the screen's other job: one by
              hand, and — for bonuses — a batch from a closed appraisal cycle.
            */
            <div className="flex flex-wrap justify-end gap-2">
              {copy.generate === true && (
                <Button variant="ghost" onClick={() => setGenerating(true)}>
                  <Sparkles className="size-4" aria-hidden />
                  <T k="pay.bonus.action.generate" />
                </Button>
              )}
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden />
                <T k={copy.add} />
              </Button>
            </div>
          ) : undefined
        }
      />

      <ChipBar
        active={status}
        onChange={(id) => {
          setStatus(id as AwardState | undefined);
          setPage(1);
        }}
        chips={STATES.map((key) => ({
          id: key,
          label: <T k={RECORD_STATE_LABELS[key]} />,
          count: counts[key] ?? 0,
          dot: STATE_DOT[key],
        }))}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('pay.award.search')}
        dirty={search.length > 0 || status !== undefined || periodId !== ''}
        onReset={() => {
          setSearch('');
          setStatus(undefined);
          setPeriodId('');
          setPage(1);
        }}
      >
        <FacetSelect
          label={t('pay.filter.period')}
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
        empty={<T k={copy.empty} />}
        columns={[
          { header: <T k={copy.columnReference} />, width: 'w-36' },
          { header: <T k={copy.columnStaff} /> },
          { header: <T k={copy.columnKind} />, width: 'w-28' },
          { header: <T k={copy.columnName} /> },
          { header: <T k={copy.columnAmount} />, width: 'w-28', align: 'right' },
          { header: <T k={copy.columnDate} />, width: 'w-28' },
          { header: <T k={copy.columnPeriod} />, width: 'w-28' },
          { header: <T k="panel.column.status" />, width: 'w-28' },
          { header: <T k="panel.column.actions" />, width: 'w-32', align: 'right' },
        ]}
      >
        {rows.map((row) => {
          const pending = row.status === 'pending';
          const approved = row.status === 'approved';
          const cancellable = pending || approved;
          // An approved award in a processed period is on a payslip the run will not rebuild.
          const cancelLocked = approved && row.periodCode !== null && !rebuildable(row.periodStatus);
          // Approval needs a period, and one the run will still build.
          const approveBlock =
            row.periodId === null
              ? t('pay.award.approve.noPeriod')
              : !rebuildable(row.periodStatus)
                ? t('pay.award.approve.locked', { period: row.periodCode ?? '' })
                : null;
          return (
            <tr
              key={row.id}
              className={cn(
                'border-b border-slate-100 hover:bg-slate-50/70',
                row.status === 'cancelled' && 'text-slate-400',
                // Approved with no period is money nobody will pay: the run reads by period.
                approved && row.periodId === null && 'bg-rose-50/40',
                pending && 'bg-amber-50/40',
              )}
            >
              <td className="px-5 py-2 font-mono text-xs text-slate-700">{row.reference}</td>
              <td className="px-2 py-2">
                <span className="block text-slate-800">{row.fullName}</span>
                <span className="block font-mono text-[11px] text-slate-400">{row.employeeNo}</span>
              </td>
              <td className="px-2 py-2 text-xs text-slate-600">
                <TEnum k={copy.kindLabels[row.kind]} fallback={row.kind} />
              </td>
              <td className="px-2 py-2 text-xs text-slate-700">
                <span className="block">{row.name}</span>
                {row.fromAppraisal && (
                  <span className="block text-[11px] text-slate-400">
                    <T k="pay.bonus.fromAppraisal" />
                  </span>
                )}
              </td>
              <td className="px-2 py-2 text-right text-xs font-medium tabular-nums text-slate-800">
                {row.amount.toFixed(2)}
              </td>
              <td className="px-2 py-2 text-xs whitespace-nowrap tabular-nums text-slate-600">
                {formatDateOnly(row.onDate)}
              </td>
              <td className="px-2 py-2 font-mono text-xs text-slate-600">
                {row.periodCode ?? (
                  <span
                    className={cn('font-sans', approved ? 'text-rose-600' : 'text-slate-400')}
                  >
                    <T k="pay.bonus.noPeriod" />
                  </span>
                )}
              </td>
              <td className="px-2 py-2">
                {/* Uppercased by the badge's class: a translated word cannot be upper-cased safely. */}
                <Badge tone={STATE_TONE[row.status] ?? 'neutral'} className="uppercase">
                  <TEnum k={RECORD_STATE_LABELS[row.status]} fallback={row.status} />
                </Badge>
              </td>
              <td className="px-2 py-2 pr-4">
                <RowActions>
                  {can(copy.screen, 'approve') && pending && (
                    <RowAction
                      icon={<CircleCheck className="size-4" aria-hidden />}
                      // Disabled with the reason the server would refuse it with.
                      label={approveBlock ?? t('pay.award.row.approve')}
                      tone="success"
                      disabled={approveBlock !== null}
                      onClick={() => setDeciding({ row, action: 'approve' })}
                    />
                  )}
                  {can(copy.screen, 'approve') && cancellable && (
                    <RowAction
                      icon={<CircleX className="size-4" aria-hidden />}
                      label={
                        cancelLocked
                          ? t('pay.award.cancel.locked', { period: row.periodCode ?? '' })
                          : t('pay.award.row.cancel')
                      }
                      tone="danger"
                      disabled={cancelLocked}
                      onClick={() => setDeciding({ row, action: 'cancel' })}
                    />
                  )}
                  {can(copy.screen, 'edit') && (
                    <RowAction
                      icon={<Pencil className="size-4" aria-hidden />}
                      label={pending ? t('pay.action.edit') : t('pay.award.locked')}
                      tone="edit"
                      disabled={!pending}
                      onClick={() => setEditing(row)}
                    />
                  )}
                  {can(copy.screen, 'delete') && (
                    <RowAction
                      icon={<Trash2 className="size-4" aria-hidden />}
                      label={
                        approved
                          ? t('pay.award.remove.locked.approved')
                          : row.status === 'paid'
                            ? t('pay.award.remove.locked.paid')
                            : t('pay.action.remove')
                      }
                      tone="danger"
                      disabled={approved || row.status === 'paid'}
                      onClick={() => setRemoving(row)}
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
        onPageSize={(value) => {
          setPageSize(value);
          setPage(1);
        }}
        onRefresh={() => {
          void load();
          void loadPeriods();
        }}
      />

      {(creating || editing !== null) && (
        <AwardDialog
          copy={copy}
          periods={periods}
          target={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onDone={done}
        />
      )}

      {deciding !== null && (
        <DecisionDialog
          copy={copy}
          row={deciding.row}
          action={deciding.action}
          onClose={() => setDeciding(null)}
          onDone={done}
        />
      )}

      {removing !== null && (
        <RemoveDialog copy={copy} row={removing} onClose={() => setRemoving(null)} onDone={done} />
      )}

      {generating && (
        <GenerateDialog periods={periods} onClose={() => setGenerating(false)} onDone={done} />
      )}
    </PanelCard>
  );
}

/**
 * One award, by hand.
 *
 * Name first through the shared picker, then the form — the same two stages as every request
 * form. This used to be a number field labelled with a staff-number example while sending the
 * directory's internal row id, so typing somebody's staff number awarded the money to whoever
 * happened to hold that row id.
 */
function AwardDialog({
  copy,
  periods,
  target,
  onClose,
  onDone,
}: {
  copy: AwardCopy;
  periods: PeriodOption[];
  target: AwardRow | null;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  // Only a draft period can take an award: once processed, the run that would have collected it
  // has already happened.
  const open = periods.filter((row) => rebuildable(row.status));
  const [staff, setStaff] = useState<PickedStaff | null>(null);
  const [kind, setKind] = useState(target?.kind ?? copy.kinds[0] ?? 'other');
  const [name, setName] = useState(target?.name ?? '');
  const [amount, setAmount] = useState(target === null ? '' : String(target.amount));
  const [onDate, setOnDate] = useState(target?.onDate ?? todayIso());
  const [periodId, setPeriodId] = useState(
    target?.periodId === null || target === null ? '' : String(target.periodId),
  );
  const [note, setNote] = useState(target?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  /*
   * The period a pending award still names after that period moved past editing.
   *
   * Shown, so the select says what is stored, but not selectable — and saving is blocked until
   * another is chosen, because the server refuses to attach an award to a frozen period.
   */
  const lockedPeriod =
    target !== null &&
    target.periodId !== null &&
    String(target.periodId) === periodId &&
    !rebuildable(target.periodStatus)
      ? (target.periodCode ?? '')
      : null;

  const submit = async (): Promise<void> => {
    if (target === null && staff === null) return;
    setBusy(true);
    setError(null);
    const input = {
      kind,
      name: name.trim(),
      amount: Number(amount),
      onDate,
      periodId: periodId === '' ? null : Number(periodId),
      note: note.trim(),
    };
    try {
      if (target === null) {
        await payrollApi.createAward(copy.kind, { ...input, staffId: staff?.id ?? 0 });
      } else {
        await payrollApi.updateAward(copy.kind, target.id, input);
      }
      await onDone(
        t('pay.award.notice.saved', {
          name: input.name,
          staff: target?.fullName ?? staff?.fullName ?? '',
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  const titleKey = target === null ? copy.formTitle : copy.formEdit;
  const ready = target !== null || staff !== null;

  return (
    <Dialog title={<T k={titleKey} />} titleText={t(titleKey)} width="2xl" onClose={onClose}>
      <div className="space-y-4">
        <Feedback error={error} />

        {target === null ? (
          <StaffPicker
            value={staff}
            onChange={setStaff}
            search={(query) => payrollApi.searchAwardStaff(copy.kind, query)}
            hint={<T k="pay.award.form.staff.hint" />}
          />
        ) : (
          // The recipient is fixed once recorded; the server refuses to move an award to another
          // person, so the dialog does not offer it.
          <DetailGrid>
            <Detail
              label={<T k={copy.formStaff} />}
              value={`${target.fullName} · ${target.employeeNo}`}
            />
            <Detail label={<T k={copy.columnReference} />} value={target.reference} mono />
          </DetailGrid>
        )}

        {ready && (
          <>
            <div className="grid items-start gap-4 sm:grid-cols-[14rem_1fr]">
              <SelectField
                label={<T k={copy.formKind} />}
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                {copy.kinds.map((value) => {
                  const label = copy.kindLabels[value];
                  return (
                    <option key={value} value={value}>
                      {label === undefined ? value : t(label)}
                    </option>
                  );
                })}
              </SelectField>
              <Field
                label={<T k={copy.formName} />}
                value={name}
                maxLength={190}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div className="grid items-start gap-4 sm:grid-cols-3">
              <Field
                label={<T k={copy.formAmount} />}
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <Field
                label={<T k={copy.formDate} />}
                type="date"
                value={onDate}
                onChange={(event) => setOnDate(event.target.value)}
              />
              <SelectField
                label={<T k={copy.formPeriod} />}
                hint={
                  lockedPeriod !== null ? (
                    <T k="pay.award.form.periodLocked" vars={{ period: lockedPeriod }} />
                  ) : open.length === 0 ? (
                    <T k="pay.award.form.noOpenPeriod" />
                  ) : (
                    <T k="pay.bonus.form.period.hint" />
                  )
                }
                value={periodId}
                onChange={(event) => setPeriodId(event.target.value)}
              >
                {/* "None" is a real choice here: approval needs a period, saving does not. */}
                <option value="">{t('pay.form.periodNone')}</option>
                {lockedPeriod !== null && target !== null && (
                  <option value={periodId} disabled>
                    {target.periodCode ?? ''}
                  </option>
                )}
                {open.map((row) => (
                  <option key={row.id} value={String(row.id)}>
                    {`${row.code} — ${row.name}`}
                  </option>
                ))}
              </SelectField>
            </div>

            {/* The last block before the footer, so it carries the `pb-2`. */}
            <div className="pb-2">
              <TextArea
                label={<T k={copy.formNote} />}
                rows={2}
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>

            <DialogFooter
              onClose={onClose}
              onSubmit={() => void submit()}
              busy={busy}
              disabled={
                name.trim() === '' ||
                !(Number(amount) > 0) ||
                onDate === '' ||
                lockedPeriod !== null
              }
              {...(lockedPeriod === null
                ? {}
                : { submitTitle: t('pay.award.form.periodLocked', { period: lockedPeriod }) })}
              submitLabel={<T k="dialog.save" />}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Approve or cancel, one decision per dialog.
 *
 * The row says which it is before the dialog opens, the way leave and claims do: the act is
 * symmetrical and the consequence is not. Approval makes the figure payable and freezes it;
 * cancelling stops it being paid at all.
 */
function DecisionDialog({
  copy,
  row,
  action,
  onClose,
  onDone,
}: {
  copy: AwardCopy;
  row: AwardRow;
  action: 'approve' | 'cancel';
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();
  const approve = action === 'approve';

  const titleKey: LabelKey = approve ? 'pay.award.approve.title' : 'pay.award.cancel.title';

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const trimmed = note.trim();
      await payrollApi.decideAward(copy.kind, row.id, {
        action,
        ...(trimmed === '' ? {} : { note: trimmed }),
      });
      await onDone(
        approve
          ? t('pay.award.notice.approved', {
              reference: row.reference,
              period: row.periodCode ?? '',
            })
          : t('pay.award.notice.cancelled', { reference: row.reference }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k={titleKey} vars={{ reference: row.reference }} />}
      titleText={t(titleKey, { reference: row.reference })}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <DetailGrid>
          <Detail label={<T k={copy.columnStaff} />} value={row.fullName} />
          <Detail label={<T k={copy.columnAmount} />} value={row.amount.toFixed(2)} />
          <Detail
            label={<T k={copy.columnPeriod} />}
            value={row.periodCode ?? <T k="pay.bonus.noPeriod" />}
          />
        </DetailGrid>

        {/* The consequence, said at the moment of deciding. */}
        <PanelNote
          tone={approve ? 'warn' : 'danger'}
          icon={<TriangleAlert className="size-3.5" aria-hidden />}
        >
          <T k={approve ? 'pay.award.approve.body' : 'pay.award.cancel.body'} />
        </PanelNote>

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="pb-2">
          <TextArea
            label={<T k="pay.award.note" />}
            rows={2}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel={
            <T k={approve ? 'pay.award.approve.submit' : 'pay.award.cancel.submit'} />
          }
        />
      </div>
    </Dialog>
  );
}

/** The second step of removing a pending or cancelled award. Nothing restores the row. */
function RemoveDialog({
  copy,
  row,
  onClose,
  onDone,
}: {
  copy: AwardCopy;
  row: AwardRow;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await payrollApi.removeAward(copy.kind, row.id);
      await onDone(t('pay.award.notice.removed', { reference: row.reference }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.remove'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="pay.award.remove.title" vars={{ reference: row.reference }} />}
      titleText={t('pay.award.remove.title', { reference: row.reference })}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <DetailGrid>
          <Detail label={<T k={copy.columnStaff} />} value={row.fullName} />
          <Detail label={<T k={copy.columnAmount} />} value={row.amount.toFixed(2)} />
          <Detail
            label={<T k="panel.column.status" />}
            value={<TEnum k={RECORD_STATE_LABELS[row.status]} fallback={row.status} />}
          />
        </DetailGrid>

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="pb-2">
          <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="pay.award.remove.confirm" vars={{ reference: row.reference }} />
          </PanelNote>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel={<T k="app.remove" />}
        />
      </div>
    </Dialog>
  );
}

/**
 * Turns finalised appraisals into pending bonus rows.
 *
 * Pending, not approved. A KPI grade carrying a bonus factor produces a row somebody still has to
 * sign, which is the difference between a bonus HR can withhold or reschedule and a figure that
 * appears from nowhere on payday.
 *
 * The cycles come from the bonus module's own endpoint. It used to read the KPI period list, which
 * is behind `hr.kpiPeriods`, so the person allowed to generate bonuses saw an empty choice unless
 * they also managed appraisal cycles.
 */
function GenerateDialog({
  periods,
  onClose,
  onDone,
}: {
  periods: PeriodOption[];
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const open = periods.filter((row) => rebuildable(row.status));
  const [cycles, setCycles] = useState<AppraisalPeriodOption[] | null>(null);
  const [kpiPeriodId, setKpiPeriodId] = useState('');
  const [periodId, setPeriodId] = useState(open[0] === undefined ? '' : String(open[0].id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  /*
   * Take the first draft period once the list arrives. The select has no empty option, so a
   * dialog opened before the periods loaded would show a period it was not holding — and with a
   * single option there is no change event to fix it.
   */
  const firstOpen = open[0]?.id;
  useEffect(() => {
    if (periodId === '' && firstOpen !== undefined) setPeriodId(String(firstOpen));
  }, [periodId, firstOpen]);

  useEffect(() => {
    void (async () => {
      try {
        const rows = await payrollApi.appraisalPeriods();
        setCycles(rows);
        const first = rows[0];
        if (first !== undefined) setKpiPeriodId(String(first.id));
      } catch (cause) {
        setCycles([]);
        setError(cause instanceof Error ? cause.message : null);
      }
    })();
  }, []);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await payrollApi.generateFromAppraisals({
        kpiPeriodId: Number(kpiPeriodId),
        periodId: Number(periodId),
      });
      await onDone(
        t('pay.bonus.generate.done', {
          created: result.created,
          existing: result.skippedExisting,
          noGrade: result.skippedNoGrade,
          noSalary: result.skippedNoSalary,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="pay.bonus.generate.title" />}
      titleText={t('pay.bonus.generate.title')}
      description={<T k="pay.bonus.generate.body" />}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="grid items-start gap-4 pb-2 sm:grid-cols-2">
          <SelectField
            label={<T k="pay.bonus.generate.kpiPeriod" />}
            hint={
              cycles !== null && cycles.length === 0 ? (
                <T k="pay.bonus.generate.none" />
              ) : undefined
            }
            value={kpiPeriodId}
            onChange={(event) => setKpiPeriodId(event.target.value)}
            disabled={cycles === null || cycles.length === 0}
          >
            {(cycles ?? []).map((row) => (
              <option key={row.id} value={String(row.id)}>
                {t('pay.bonus.generate.kpiOption', {
                  code: row.code,
                  name: row.name,
                  finalised: row.finalised,
                  generated: row.generated,
                })}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={<T k="pay.bonus.generate.period" />}
            hint={open.length === 0 ? <T k="pay.bonus.generate.noOpenPeriod" /> : undefined}
            value={periodId}
            onChange={(event) => setPeriodId(event.target.value)}
            disabled={open.length === 0}
          >
            {open.map((row) => (
              <option key={row.id} value={String(row.id)}>
                {`${row.code} — ${row.name}`}
              </option>
            ))}
          </SelectField>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={kpiPeriodId === '' || periodId === ''}
          submitLabel={<T k="pay.bonus.generate.submit" />}
        />
      </div>
    </Dialog>
  );
}
