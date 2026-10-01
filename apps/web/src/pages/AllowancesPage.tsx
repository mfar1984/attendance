import type { LabelKey } from '@attendance/shared';
import {
  Landmark,
  Pencil,
  Plus,
  Receipt,
  Tags,
  Trash2,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
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
  PanelTabs,
  RecordTable,
  RowAction,
  RowActions,
} from '../components/RecordPanel';
import { StaffPicker, type PickedStaff } from '../components/StaffPicker';
import { Badge, Button, CheckCard, Field, SelectField, TextArea } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { formatDateOnly, todayIso } from '../lib/operations-api';
import {
  CALC_MODE_LABELS,
  payrollApi,
  type AllowancePage,
  type AllowanceType,
  type CalcMode,
  type StaffAllowanceRow,
} from '../lib/payroll-api';
import { T, useLabels } from '../lib/translation';

const SCREEN = 'hr.allowances';

/**
 * Allowances: the catalogue of kinds, and the standing rows per person.
 *
 * A catalogue rather than four fixed columns. The reference had `housing_allowance`,
 * `transport_allowance`, `meal_allowance` and `other_allowances`, which makes a fifth kind of
 * allowance a schema migration — and allowances are exactly the part meant to change without one.
 *
 * No approve action anywhere on this screen. An allowance is part of what somebody was hired on;
 * it is configured, not applied for.
 */
export function AllowancesPage(): ReactNode {
  const [tab, setTab] = useState<'staff' | 'types'>('staff');
  const { t } = useLabels();

  return (
    <PanelCard title={<T k="pay.allowance.title" />} subtitle={<T k="pay.allowance.subtitle" />}>
      <PanelTabs
        label={t('pay.allowance.title')}
        active={tab}
        onChange={(next) => setTab(next as 'staff' | 'types')}
        tabs={[
          {
            id: 'staff',
            label: <T k="pay.allowance.tab.staff" />,
            labelText: t('pay.allowance.tab.staff'),
            icon: <UserRound className="size-4" aria-hidden />,
          },
          {
            id: 'types',
            label: <T k="pay.allowance.tab.types" />,
            labelText: t('pay.allowance.tab.types'),
            icon: <Tags className="size-4" aria-hidden />,
          },
        ]}
      />
      {tab === 'staff' ? <StaffTab /> : <TypesTab />}
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Staff allowances
// ---------------------------------------------------------------------------

type ActiveChip = 'active' | 'inactive';

function StaffTab(): ReactNode {
  const [data, setData] = useState<AllowancePage | null>(null);
  const [types, setTypes] = useState<AllowanceType[] | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [typeId, setTypeId] = useState('');
  const [state, setState] = useState<ActiveChip | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StaffAllowanceRow | null>(null);
  const [removing, setRemoving] = useState<StaffAllowanceRow | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();
  // Which load is the latest, so a search answered out of order cannot replace the current rows.
  const latest = useRef(0);

  useEffect(() => {
    void payrollApi
      .allowanceTypes()
      .then(setTypes)
      .catch(() => setTypes([]));
  }, []);

  // One request per pause in typing, not one per key — the same debounce as the request lists.
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
      const result = await payrollApi.allowances({
        page,
        pageSize,
        ...(debounced === '' ? {} : { search: debounced }),
        ...(typeId === '' ? {} : { typeId: Number(typeId) }),
        ...(state === undefined ? {} : { active: state === 'active' ? '1' : '0' }),
      });
      if (mine !== latest.current) return;
      setData(result);
      setError(null);
    } catch (cause) {
      if (mine !== latest.current) return;
      setError(cause instanceof Error ? cause.message : t('pay.allowance.error.load'));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [page, pageSize, debounced, typeId, state, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const done = async (message: string): Promise<void> => {
    setCreating(false);
    setEditing(null);
    setRemoving(null);
    setNotice(message);
    await load();
  };

  const rows = data?.rows ?? [];
  const counts = data?.counts ?? {};
  const count = (counts.active ?? 0) + (counts.inactive ?? 0);
  const activeTypes = (types ?? []).filter((row) => row.active);
  // Nothing to assign until the catalogue has a live type; said where it blocks the action.
  const noTypes = types !== null && activeTypes.length === 0;

  return (
    <>
      <PanelSection
        title={<T k="pay.allowance.count" vars={{ count }} />}
        subtitle={<T k="pay.allowance.section.subtitle" />}
        action={
          can(SCREEN, 'create') ? (
            // Held until the catalogue arrives, so the dialog never opens on a list still loading.
            <Button
              onClick={() => setCreating(true)}
              disabled={types === null || noTypes}
              {...(noTypes ? { title: t('pay.allowance.type.empty') } : {})}
            >
              <Plus className="size-4" aria-hidden />
              <T k="pay.allowance.action.add" />
            </Button>
          ) : undefined
        }
      />

      <ChipBar
        active={state}
        onChange={(id) => {
          setState(id as ActiveChip | undefined);
          setPage(1);
        }}
        chips={[
          {
            id: 'active',
            label: <T k="app.status.active" />,
            count: counts.active ?? 0,
            dot: 'bg-emerald-600',
          },
          {
            id: 'inactive',
            label: <T k="app.status.inactive" />,
            count: counts.inactive ?? 0,
            dot: 'bg-slate-400',
          },
        ]}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('pay.allowance.search')}
        dirty={search.length > 0 || typeId !== '' || state !== undefined}
        onReset={() => {
          setSearch('');
          setTypeId('');
          setState(undefined);
          setPage(1);
        }}
      >
        <FacetSelect
          label={t('pay.filter.type')}
          value={typeId}
          onChange={(value) => {
            setTypeId(value);
            setPage(1);
          }}
          options={(types ?? []).map((row) => ({
            value: String(row.id),
            label: `${row.code} — ${row.name}`,
          }))}
        />
      </FilterRow>

      {(error !== null || notice !== null || noTypes) && (
        <PanelBody className="space-y-2 pb-0">
          <Feedback error={error} notice={notice} />
          {noTypes && (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="pay.allowance.type.empty" />
            </PanelNote>
          )}
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={rows.length}
        empty={<T k="pay.allowance.empty" />}
        columns={[
          { header: <T k="pay.allowance.column.staff" /> },
          { header: <T k="pay.allowance.column.type" />, width: 'w-48' },
          { header: <T k="pay.allowance.column.value" />, width: 'w-28', align: 'right' },
          { header: <T k="pay.allowance.column.resolved" />, width: 'w-28', align: 'right' },
          { header: <T k="pay.allowance.column.window" />, width: 'w-48' },
          { header: <T k="panel.column.status" />, width: 'w-28' },
          { header: <T k="panel.column.actions" />, width: 'w-24', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <tr
            key={row.id}
            className={cn(
              'border-b border-slate-100 hover:bg-slate-50/70',
              !row.active && 'text-slate-400',
            )}
          >
            <td className="px-5 py-2">
              <span className="block text-slate-800">{row.fullName}</span>
              <span className="block font-mono text-[11px] text-slate-400">{row.employeeNo}</span>
            </td>
            <td className="px-2 py-2 text-xs text-slate-600">
              <span className="block">{row.typeName}</span>
              <span className="block font-mono text-[11px] text-slate-400">{row.typeCode}</span>
            </td>
            <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-700">
              {row.calcMode === 'percentOfBasic' ? (
                <T k="pay.allowance.percentOf" vars={{ percent: row.value }} />
              ) : (
                row.value.toFixed(2)
              )}
            </td>
            <td className="px-2 py-2 text-right text-xs font-medium tabular-nums text-slate-800">
              {row.resolved.toFixed(2)}
            </td>
            <td className="px-2 py-2 text-xs whitespace-nowrap tabular-nums text-slate-600">
              {row.effectiveTo === null ? (
                <T
                  k="pay.allowance.window.open"
                  vars={{ from: formatDateOnly(row.effectiveFrom) }}
                />
              ) : (
                <T
                  k="pay.allowance.window.closed"
                  vars={{
                    from: formatDateOnly(row.effectiveFrom),
                    to: formatDateOnly(row.effectiveTo),
                  }}
                />
              )}
            </td>
            <td className="px-2 py-2">
              {/* Uppercased by the badge's class: a translated word cannot be upper-cased safely. */}
              <Badge tone={row.active ? 'success' : 'neutral'} className="uppercase">
                <T k={row.active ? 'app.status.active' : 'app.status.inactive'} />
              </Badge>
            </td>
            <td className="px-2 py-2 pr-4">
              <RowActions>
                {can(SCREEN, 'edit') && (
                  <RowAction
                    icon={<Pencil className="size-4" aria-hidden />}
                    label={t('pay.action.edit')}
                    tone="edit"
                    onClick={() => setEditing(row)}
                  />
                )}
                {can(SCREEN, 'delete') && (
                  <RowAction
                    icon={<Trash2 className="size-4" aria-hidden />}
                    label={t('pay.action.remove')}
                    tone="danger"
                    onClick={() => setRemoving(row)}
                  />
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
        onPageSize={(value) => {
          setPageSize(value);
          setPage(1);
        }}
        onRefresh={() => void load()}
      />

      {(creating || editing !== null) && (
        <AllowanceDialog
          types={types ?? []}
          target={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onDone={done}
        />
      )}

      {removing !== null && (
        <RemoveDialog row={removing} onClose={() => setRemoving(null)} onDone={done} />
      )}
    </>
  );
}

/**
 * One standing allowance for one person.
 *
 * The person is picked by name. This used to be a number field labelled with a staff-number
 * example while sending the directory's internal row id, so typing somebody's staff number put
 * the allowance on whoever held that row id — and every run after that paid it to them.
 */
function AllowanceDialog({
  types,
  target,
  onClose,
  onDone,
}: {
  types: AllowanceType[];
  target: StaffAllowanceRow | null;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const active = types.filter((row) => row.active);
  const [staff, setStaff] = useState<PickedStaff | null>(null);
  const [typeId, setTypeId] = useState(() => {
    if (target !== null) {
      const match = types.find((row) => row.code === target.typeCode);
      if (match !== undefined) return String(match.id);
    }
    return active[0] === undefined ? '' : String(active[0].id);
  });
  const [value, setValue] = useState(target === null ? '' : String(target.value));
  const [from, setFrom] = useState(target?.effectiveFrom ?? todayIso());
  const [to, setTo] = useState(target?.effectiveTo ?? '');
  const [isActive, setIsActive] = useState(target?.active ?? true);
  const [note, setNote] = useState(target?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  /*
   * Take the first live type if none is held. The select has no empty option, so without this a
   * dialog whose list arrived after it opened showed a type it was not holding, and Save stayed
   * disabled with nothing on screen to say why.
   */
  const firstActive = active[0]?.id;
  useEffect(() => {
    if (target === null && typeId === '' && firstActive !== undefined) {
      setTypeId(String(firstActive));
    }
  }, [target, typeId, firstActive]);

  const chosen = types.find((row) => String(row.id) === typeId);
  const mode: CalcMode = target?.calcMode ?? chosen?.calcMode ?? 'fixed';

  /*
   * Offering the type's default saves typing without hiding it: the field stays editable.
   *
   * Only a positive default. Types saved before the "no default" fix were stored with 0, and
   * offering that would open the form on its own error.
   */
  useEffect(() => {
    if (target !== null) return;
    if (chosen?.defaultAmount != null && chosen.defaultAmount > 0) {
      setValue(String(chosen.defaultAmount));
    }
  }, [typeId, chosen, target]);

  const amount = Number(value);
  const valueFault =
    value.trim() !== '' &&
    (!Number.isFinite(amount) || amount <= 0 || (mode === 'percentOfBasic' && amount > 100));
  // The server refuses an end before the start; said on the field before Save.
  const endsEarly = to !== '' && from !== '' && to < from;

  const submit = async (): Promise<void> => {
    if (target === null && staff === null) return;
    setBusy(true);
    setError(null);
    const common = {
      value: amount,
      effectiveFrom: from,
      effectiveTo: to === '' ? null : to,
      active: isActive,
      note: note.trim(),
    };
    try {
      if (target === null) {
        await payrollApi.createAllowance({
          ...common,
          staffId: staff?.id ?? 0,
          typeId: Number(typeId),
        });
      } else {
        await payrollApi.updateAllowance(target.id, common);
      }
      await onDone(
        t('pay.allowance.notice.saved', {
          type: target?.typeCode ?? chosen?.code ?? '',
          staff: target?.fullName ?? staff?.fullName ?? '',
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  const titleKey: LabelKey =
    target === null ? 'pay.allowance.form.title' : 'pay.allowance.form.edit';
  const ready = target !== null || staff !== null;

  const valueField = (
    <Field
      label={<T k="pay.allowance.form.value" />}
      hint={
        mode === 'percentOfBasic' ? (
          <T k="pay.allowance.form.value.percent" />
        ) : (
          <T k="pay.allowance.form.value.fixed" />
        )
      }
      {...(valueFault
        ? {
            error:
              mode === 'percentOfBasic'
                ? t('pay.allowance.form.value.percent')
                : t('pay.allowance.form.value.positive'),
          }
        : {})}
      type="number"
      inputMode="decimal"
      step="0.01"
      min={0}
      max={mode === 'percentOfBasic' ? 100 : undefined}
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );

  const fromField = (
    <Field
      label={<T k="pay.allowance.form.from" />}
      hint={<T k="pay.allowance.form.from.hint" />}
      type="date"
      value={from}
      onChange={(event) => setFrom(event.target.value)}
    />
  );

  const toField = (
    <Field
      label={<T k="pay.allowance.form.to" />}
      hint={<T k="pay.allowance.form.to.hint" />}
      {...(endsEarly ? { error: t('pay.form.endBeforeStart') } : {})}
      type="date"
      value={to}
      min={from === '' ? undefined : from}
      onChange={(event) => setTo(event.target.value)}
    />
  );

  return (
    <Dialog title={<T k={titleKey} />} titleText={t(titleKey)} width="2xl" onClose={onClose}>
      <div className="space-y-4">
        <Feedback error={error} />

        {target === null ? (
          <StaffPicker
            value={staff}
            onChange={setStaff}
            search={payrollApi.searchAllowanceStaff}
            hint={<T k="pay.allowance.form.staff.hint" />}
          />
        ) : (
          // The person and the type are fixed once recorded; the server refuses to move either.
          <DetailGrid>
            <Detail
              label={<T k="pay.allowance.form.staff" />}
              value={`${target.fullName} · ${target.employeeNo}`}
            />
            <Detail
              label={<T k="pay.allowance.form.type" />}
              value={`${target.typeCode} — ${target.typeName}`}
            />
          </DetailGrid>
        )}

        {ready && (
          <>
            {/*
              Creating: the type beside the value it prices, then the dates. Editing: the type is
              fixed, so the value joins the dates on one row instead of leaving a hole beside it.
            */}
            {target === null ? (
              <>
                <div className="grid items-start gap-4 sm:grid-cols-[1fr_12rem]">
                  <SelectField
                    label={<T k="pay.allowance.form.type" />}
                    value={typeId}
                    onChange={(event) => setTypeId(event.target.value)}
                  >
                    {active.map((row) => (
                      <option key={row.id} value={String(row.id)}>
                        {`${row.code} — ${row.name} · ${t(CALC_MODE_LABELS[row.calcMode])}`}
                      </option>
                    ))}
                  </SelectField>
                  {valueField}
                </div>
                <div className="grid items-start gap-4 sm:grid-cols-2">
                  {fromField}
                  {toField}
                </div>
              </>
            ) : (
              <div className="grid items-start gap-4 sm:grid-cols-3">
                {valueField}
                {fromField}
                {toField}
              </div>
            )}

            {/* The last block before the footer, so it carries the `pb-2`. */}
            <div className="grid items-start gap-4 pb-2 sm:grid-cols-[1fr_12rem]">
              <TextArea
                label={<T k="pay.allowance.form.note" />}
                rows={2}
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
              />
              <SelectField
                label={<T k="panel.column.status" />}
                hint={<T k="pay.allowance.form.status.hint" />}
                value={isActive ? 'active' : 'inactive'}
                onChange={(event) => setIsActive(event.target.value === 'active')}
              >
                <option value="active">{t('app.status.active')}</option>
                <option value="inactive">{t('app.status.inactive')}</option>
              </SelectField>
            </div>

            <DialogFooter
              onClose={onClose}
              onSubmit={() => void submit()}
              busy={busy}
              disabled={
                (target === null && typeId === '') ||
                value.trim() === '' ||
                valueFault ||
                from === '' ||
                endsEarly
              }
              submitLabel={<T k="dialog.save" />}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}

/** The second step of removing an allowance. Payslips already paid keep their figure. */
function RemoveDialog({
  row,
  onClose,
  onDone,
}: {
  row: StaffAllowanceRow;
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
      await payrollApi.removeAllowance(row.id);
      await onDone(t('pay.allowance.notice.removed', { type: row.typeCode, staff: row.fullName }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.remove'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="pay.allowance.remove.title" />}
      titleText={t('pay.allowance.remove.title')}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <DetailGrid>
          <Detail label={<T k="pay.allowance.column.staff" />} value={row.fullName} />
          <Detail label={<T k="pay.allowance.column.type" />} value={row.typeCode} />
          <Detail
            label={<T k="pay.allowance.column.resolved" />}
            value={row.resolved.toFixed(2)}
          />
        </DetailGrid>

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="pb-2">
          <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="pay.allowance.remove.body" />
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

// ---------------------------------------------------------------------------
// Allowance types
// ---------------------------------------------------------------------------

/** Shaped after the leave types tab, the reference for every table of master data. */
function TypesTab(): ReactNode {
  const [rows, setRows] = useState<AllowanceType[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<AllowanceType | 'new' | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await payrollApi.allowanceTypes());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('pay.allowance.type.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const needle = search.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      needle.length === 0 ||
      row.code.toLowerCase().includes(needle) ||
      row.name.toLowerCase().includes(needle),
  );

  const remove = async (row: AllowanceType): Promise<void> => {
    try {
      await payrollApi.removeAllowanceType(row.id);
      setNotice(t('pay.allowance.type.notice.removed', { code: row.code }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.remove'));
    }
  };

  return (
    <>
      <PanelSection
        title={<T k="pay.allowance.type.count" vars={{ count: rows.length }} />}
        subtitle={<T k="pay.allowance.type.subtitle" />}
        action={
          can(SCREEN, 'create') ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden />
              <T k="pay.allowance.type.action.add" />
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
        empty={<T k="pay.allowance.type.empty" />}
        columns={[
          { header: <T k="pay.allowance.type.column.code" />, width: 'w-28' },
          { header: <T k="pay.allowance.type.column.name" /> },
          { header: <T k="pay.allowance.type.column.mode" />, width: 'w-44' },
          { header: <T k="pay.allowance.type.column.default" />, width: 'w-24', align: 'right' },
          { header: <T k="pay.allowance.type.column.epf" />, width: 'w-28' },
          { header: <T k="pay.allowance.type.column.used" />, width: 'w-24', align: 'right' },
          { header: <T k="panel.column.status" />, width: 'w-24' },
          { header: <T k="panel.column.actions" />, width: 'w-24', align: 'right' },
        ]}
      >
        {filtered.map((row) => {
          const inUse = row.usageCount > 0;
          return (
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
              <td className="px-2 py-2.5 text-xs text-slate-600">
                <T k={CALC_MODE_LABELS[row.calcMode]} />
              </td>
              <td className="px-2 py-2.5 text-right text-xs tabular-nums text-slate-600">
                {row.defaultAmount === null ? '—' : row.defaultAmount.toFixed(2)}
              </td>
              <td className="px-2 py-2.5">
                {/* Register, not severity: being EPF-liable is the careful default, not a fault. */}
                <Badge tone={row.epfLiable ? 'info' : 'neutral'}>
                  <T
                    k={row.epfLiable ? 'pay.allowance.type.epf.yes' : 'pay.allowance.type.epf.no'}
                  />
                </Badge>
              </td>
              <td className="px-2 py-2.5 text-right text-xs tabular-nums text-slate-600">
                <T k="pay.allowance.type.usage" vars={{ count: row.usageCount }} />
              </td>
              <td className="px-2 py-2.5">
                <Badge tone={row.active ? 'success' : 'neutral'}>
                  <T k={row.active ? 'app.status.active' : 'app.status.inactive'} />
                </Badge>
              </td>
              <td className="px-2 py-2.5 pr-4">
                <RowActions>
                  {can(SCREEN, 'edit') && (
                    <RowAction
                      icon={<Pencil className="size-4" aria-hidden />}
                      label={t('pay.action.edit')}
                      tone="edit"
                      onClick={() => setEditing(row)}
                    />
                  )}
                  {/*
                    Deactivated rather than deleted once it has history: a payslip already paid
                    names the allowance it paid, and that name has to keep existing.
                  */}
                  {can(SCREEN, 'delete') && (
                    <RowAction
                      icon={<Trash2 className="size-4" aria-hidden />}
                      label={
                        inUse
                          ? t(
                              row.active
                                ? 'pay.allowance.type.row.locked'
                                : 'pay.allowance.type.row.locked.inactive',
                              { count: row.usageCount },
                            )
                          : t('pay.action.remove')
                      }
                      tone="danger"
                      disabled={inUse}
                      onClick={() => void remove(row)}
                    />
                  )}
                </RowActions>
              </td>
            </tr>
          );
        })}
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
  target: AllowanceType | null;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [code, setCode] = useState(target?.code ?? '');
  const [name, setName] = useState(target?.name ?? '');
  const [description, setDescription] = useState(target?.description ?? '');
  const [calcMode, setCalcMode] = useState<CalcMode>(target?.calcMode ?? 'fixed');
  const [defaultAmount, setDefaultAmount] = useState(
    target?.defaultAmount === null || target?.defaultAmount === undefined
      ? ''
      : String(target.defaultAmount),
  );
  const [epfLiable, setEpfLiable] = useState(target?.epfLiable ?? true);
  const [taxable, setTaxable] = useState(target?.taxable ?? true);
  const [active, setActive] = useState(target?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const frozen = (target?.usageCount ?? 0) > 0;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const finalCode = code.trim().toUpperCase();
    try {
      const input = {
        code: finalCode,
        name: name.trim(),
        description: description.trim(),
        // Frozen fields are omitted rather than sent unchanged: the server refuses them on a
        // type in use, and sending the current value would look like an attempt to change it.
        ...(frozen ? {} : { calcMode, epfLiable }),
        defaultAmount: defaultAmount === '' ? null : Number(defaultAmount),
        taxable,
        active,
      };
      if (target === null) {
        await payrollApi.createAllowanceType({ ...input, calcMode, epfLiable });
      } else {
        await payrollApi.updateAllowanceType(target.id, input);
      }
      await onDone(t('pay.allowance.type.notice.saved', { code: target?.code ?? finalCode }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  const titleKey: LabelKey =
    target === null ? 'pay.allowance.type.form.title' : 'pay.allowance.type.form.edit';

  return (
    <Dialog
      title={<T k={titleKey} />}
      titleText={t(titleKey)}
      // A caveat about this decision, so it sits under the title rather than as a strip inside.
      {...(frozen ? { description: <T k="pay.allowance.type.form.frozen" /> } : {})}
      width="2xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/* Identity first: the code somebody types, then the name they read. */}
        <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
          <Field
            label={<T k="pay.allowance.type.form.code" />}
            value={code}
            maxLength={24}
            autoFocus={target === null}
            disabled={target !== null}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <Field
            label={<T k="pay.allowance.type.form.name" />}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <TextArea
          label={<T k="pay.allowance.type.form.description" />}
          hint={<T k="app.description.hint" />}
          rows={2}
          value={description}
          maxLength={500}
          onChange={(event) => setDescription(event.target.value)}
        />

        <div className="grid items-start gap-4 sm:grid-cols-3">
          <SelectField
            label={<T k="pay.allowance.type.form.mode" />}
            hint={<T k="pay.allowance.type.form.mode.hint" />}
            value={calcMode}
            disabled={frozen}
            onChange={(event) => setCalcMode(event.target.value as CalcMode)}
          >
            {(['fixed', 'percentOfBasic'] as const).map((value) => (
              <option key={value} value={value}>
                {t(CALC_MODE_LABELS[value])}
              </option>
            ))}
          </SelectField>
          <Field
            label={<T k="pay.allowance.type.form.default" />}
            hint={<T k="pay.allowance.type.form.default.hint" />}
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            value={defaultAmount}
            onChange={(event) => setDefaultAmount(event.target.value)}
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

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="space-y-2 pb-2">
          <CheckCard
            checked={epfLiable}
            onChange={setEpfLiable}
            disabled={frozen}
            icon={<Landmark className="size-4" aria-hidden />}
            title={<T k="pay.allowance.type.form.epf" />}
            hint={<T k="pay.allowance.type.form.epf.hint" />}
          />
          <CheckCard
            checked={taxable}
            onChange={setTaxable}
            icon={<Receipt className="size-4" aria-hidden />}
            title={<T k="pay.allowance.type.form.taxable" />}
            hint={<T k="pay.allowance.type.form.taxable.hint" />}
          />
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
