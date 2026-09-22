import type { LabelKey } from '@attendance/shared';
import { CircleAlert, Pencil, Plus, PlusCircle, Tags, Trash2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { SelectControl, SettingRow, Switch } from '../components/ChannelForm';
import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
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
import { Badge, Button, Field } from '../components/ui';
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
          },
          {
            id: 'types',
            label: <T k="pay.allowance.tab.types" />,
            labelText: t('pay.allowance.tab.types'),
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

function StaffTab(): ReactNode {
  const [data, setData] = useState<AllowancePage | null>(null);
  const [types, setTypes] = useState<AllowanceType[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [typeId, setTypeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StaffAllowanceRow | null>(null);
  const [removing, setRemoving] = useState<StaffAllowanceRow | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  useEffect(() => {
    void payrollApi.allowanceTypes().then(setTypes).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await payrollApi.allowances({
          page,
          pageSize,
          search: search === '' ? undefined : search,
          typeId: typeId === '' ? undefined : Number(typeId),
        }),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('pay.allowance.error.load'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, typeId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];

  return (
    <>
      <PanelSection
        icon={<PlusCircle className="size-4" aria-hidden />}
        title={<T k="pay.allowance.section" />}
        subtitle={<T k="pay.allowance.section.subtitle" />}
        action={
          can(SCREEN, 'create') ? (
            <Button onClick={() => setCreating(true)} disabled={types.length === 0}>
              <Plus className="size-4" aria-hidden />
              <T k="pay.allowance.action.add" />
            </Button>
          ) : undefined
        }
      />

      <PanelBody className="space-y-2 pb-0">
        <Feedback error={error} notice={notice} />
        {types.length === 0 && !loading && (
          <PanelNote tone="warn" icon={<CircleAlert className="size-3.5" aria-hidden />}>
            <T k="pay.allowance.type.empty" />
          </PanelNote>
        )}
      </PanelBody>

      <FilterRow
        search={search}
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        dirty={search !== '' || typeId !== ''}
        onReset={() => {
          setSearch('');
          setTypeId('');
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
          options={types.map((row) => ({
            value: String(row.id),
            label: `${row.code} — ${row.name}`,
          }))}
        />
      </FilterRow>

      <RecordTable
        loading={loading}
        rowCount={rows.length}
        empty={<T k="pay.allowance.empty" />}
        columns={[
          { header: <T k="pay.allowance.column.staff" /> },
          { header: <T k="pay.allowance.column.type" />, width: 'w-44' },
          { header: <T k="pay.allowance.column.value" />, width: 'w-28', align: 'right' },
          { header: <T k="pay.allowance.column.resolved" />, width: 'w-28', align: 'right' },
          { header: <T k="pay.allowance.column.window" />, width: 'w-44' },
          { header: <T k="panel.column.status" />, width: 'w-24' },
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
              <p className="text-slate-800">{row.fullName}</p>
              <p className="text-xs text-slate-500">{row.employeeNo}</p>
            </td>
            <td className="px-2 py-2">
              <p className="text-sm text-slate-700">{row.typeName}</p>
              <p className="font-mono text-xs text-slate-500">{row.typeCode}</p>
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
              <Badge tone={row.active ? 'success' : 'neutral'}>
                <span className="uppercase">
                  <T k={row.active ? 'app.status.active' : 'app.status.inactive'} />
                </span>
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
          types={types}
          target={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onDone={async (message) => {
            setCreating(false);
            setEditing(null);
            setNotice(message);
            await load();
          }}
        />
      )}

      {removing !== null && (
        <RemoveDialog
          row={removing}
          onClose={() => setRemoving(null)}
          onDone={async (message) => {
            setRemoving(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </>
  );
}

function AllowanceDialog({
  types,
  target,
  onClose,
  onDone,
}: {
  types: AllowanceType[];
  target?: StaffAllowanceRow;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const active = types.filter((row) => row.active);
  const [staffId, setStaffId] = useState(target === undefined ? '' : String(target.staffId));
  const [typeId, setTypeId] = useState(() => {
    if (target !== undefined) {
      const match = types.find((row) => row.code === target.typeCode);
      if (match !== undefined) return String(match.id);
    }
    return active[0] === undefined ? '' : String(active[0].id);
  });
  const [value, setValue] = useState(target === undefined ? '' : String(target.value));
  const [from, setFrom] = useState(target?.effectiveFrom ?? todayIso());
  const [to, setTo] = useState(target?.effectiveTo ?? '');
  const [isActive, setIsActive] = useState(target?.active ?? true);
  const [note, setNote] = useState(target?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const chosen = types.find((row) => String(row.id) === typeId);
  const mode: CalcMode = chosen?.calcMode ?? 'fixed';

  // Offering the type's default saves typing without hiding it: the field stays editable.
  useEffect(() => {
    if (target !== undefined) return;
    if (chosen?.defaultAmount != null) setValue(String(chosen.defaultAmount));
  }, [typeId, chosen, target]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      if (target === undefined) {
        await payrollApi.createAllowance({
          staffId: Number(staffId),
          typeId: Number(typeId),
          value: Number(value),
          effectiveFrom: from,
          effectiveTo: to === '' ? null : to,
          active: isActive,
          note,
        });
      } else {
        await payrollApi.updateAllowance(target.id, {
          value: Number(value),
          effectiveFrom: from,
          effectiveTo: to === '' ? null : to,
          active: isActive,
          note,
        });
      }
      await onDone(t('pay.allowance.title'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  const titleKey: LabelKey =
    target === undefined ? 'pay.allowance.form.title' : 'pay.allowance.form.edit';

  return (
    <Dialog title={<T k={titleKey} />} titleText={t(titleKey)} width="lg" onClose={onClose}>
      <div className="space-y-4">
        <Feedback error={error} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k="pay.allowance.form.staff" />}
            type="number"
            inputMode="numeric"
            value={staffId}
            disabled={target !== undefined}
            placeholder={t('pay.form.staffPlaceholder')}
            onChange={(event) => setStaffId(event.target.value)}
          />
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-700">
              <T k="pay.allowance.form.type" />
            </p>
            <SelectControl
              label={t('pay.allowance.form.type')}
              value={typeId}
              disabled={target !== undefined}
              onChange={(event) => setTypeId(event.target.value)}
            >
              {active.map((row) => (
                <option key={row.id} value={String(row.id)}>
                  {`${row.code} — ${row.name}`}
                </option>
              ))}
            </SelectControl>
          </div>
        </div>

        <Field
          label={<T k="pay.allowance.form.value" />}
          hint={
            mode === 'percentOfBasic' ? (
              <T k="pay.allowance.form.value.percent" />
            ) : (
              <T k="pay.allowance.form.value.fixed" />
            )
          }
          type="number"
          step="0.01"
          min={0}
          max={mode === 'percentOfBasic' ? 100 : undefined}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k="pay.allowance.form.from" />}
            hint={<T k="pay.allowance.form.from.hint" />}
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <Field
            label={<T k="pay.allowance.form.to" />}
            hint={<T k="pay.allowance.form.to.hint" />}
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>

        <SettingRow label={<T k="pay.allowance.form.active" />}>
          <Switch
            checked={isActive}
            onChange={setIsActive}
            label={t('pay.allowance.form.active')}
            showLabel={false}
          />
        </SettingRow>

        <Field
          label={<T k="pay.allowance.form.note" />}
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={
            (target === undefined && (staffId.trim() === '' || typeId === '')) ||
            value.trim() === '' ||
            from === ''
          }
          submitLabel={<T k="dialog.save" />}
        />
      </div>
    </Dialog>
  );
}

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

  return (
    <Dialog
      title={<T k="pay.allowance.remove.title" />}
      titleText={t('pay.allowance.remove.title')}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />
        <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
          <T k="pay.allowance.remove.body" />
        </PanelNote>
        <DialogFooter
          onClose={onClose}
          busy={busy}
          onSubmit={() => {
            setBusy(true);
            void payrollApi
              .removeAllowance(row.id)
              .then(() => onDone(`${row.fullName}: ${row.typeCode} dibuang.`))
              .catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : null);
                setBusy(false);
              });
          }}
          submitLabel={<T k="app.remove" />}
        />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Allowance types
// ---------------------------------------------------------------------------

function TypesTab(): ReactNode {
  const [rows, setRows] = useState<AllowanceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<AllowanceType | null>(null);
  const [creating, setCreating] = useState(false);
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

  return (
    <>
      <PanelSection
        icon={<Tags className="size-4" aria-hidden />}
        title={<T k="pay.allowance.type.section" />}
        subtitle={<T k="pay.allowance.type.subtitle" />}
        action={
          can(SCREEN, 'create') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              <T k="pay.allowance.type.action.add" />
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
        {rows.map((row) => (
          <tr
            key={row.id}
            className={cn(
              'border-b border-slate-100 hover:bg-slate-50/70',
              !row.active && 'text-slate-400',
            )}
          >
            <td className="px-5 py-2 font-mono text-xs text-slate-700">{row.code}</td>
            <td className="px-2 py-2">
              <p className="text-slate-800">{row.name}</p>
              {row.description !== null && (
                <p className="text-xs text-slate-500">{row.description}</p>
              )}
            </td>
            <td className="px-2 py-2 text-xs text-slate-600">
              <T k={CALC_MODE_LABELS[row.calcMode]} />
            </td>
            <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-600">
              {row.defaultAmount === null ? '—' : row.defaultAmount.toFixed(2)}
            </td>
            <td className="px-2 py-2">
              <Badge tone={row.epfLiable ? 'warning' : 'neutral'}>
                <T
                  k={row.epfLiable ? 'pay.allowance.type.epf.yes' : 'pay.allowance.type.epf.no'}
                />
              </Badge>
            </td>
            <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-600">
              <T k="pay.allowance.type.usage" vars={{ count: row.usageCount }} />
            </td>
            <td className="px-2 py-2">
              <Badge tone={row.active ? 'success' : 'neutral'}>
                <span className="uppercase">
                  <T k={row.active ? 'app.status.active' : 'app.status.inactive'} />
                </span>
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
                    // Deactivated rather than deleted once it has history: a payslip already
                    // paid names the allowance it paid, and that name has to keep existing.
                    label={
                      row.usageCount > 0
                        ? t('pay.allowance.type.inUse')
                        : t('pay.action.remove')
                    }
                    tone="danger"
                    disabled={row.usageCount > 0}
                    onClick={() => {
                      void payrollApi
                        .removeAllowanceType(row.id)
                        .then(async () => {
                          setNotice(`${row.code} dibuang.`);
                          await load();
                        })
                        .catch((cause: unknown) => {
                          setError(cause instanceof Error ? cause.message : null);
                        });
                    }}
                  />
                )}
              </RowActions>
            </td>
          </tr>
        ))}
      </RecordTable>

      {(creating || editing !== null) && (
        <TypeDialog
          target={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onDone={async (message) => {
            setCreating(false);
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
  target?: AllowanceType;
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
    try {
      const input = {
        code,
        name,
        description,
        // Frozen fields are omitted rather than sent unchanged: the server refuses them on a
        // type in use, and sending the current value would look like an attempt to change it.
        ...(frozen ? {} : { calcMode, epfLiable }),
        defaultAmount: defaultAmount === '' ? null : Number(defaultAmount),
        taxable,
        active,
      };
      if (target === undefined) {
        await payrollApi.createAllowanceType({ ...input, calcMode, epfLiable });
        await onDone(`${code.toUpperCase()} disimpan.`);
      } else {
        await payrollApi.updateAllowanceType(target.id, input);
        await onDone(`${target.code} dikemas kini.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  const titleKey: LabelKey =
    target === undefined ? 'pay.allowance.type.form.title' : 'pay.allowance.type.form.edit';

  return (
    <Dialog title={<T k={titleKey} />} titleText={t(titleKey)} width="lg" onClose={onClose}>
      <div className="space-y-4">
        <Feedback error={error} />

        {frozen && (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="pay.allowance.type.form.frozen" />
          </PanelNote>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k="pay.allowance.type.form.code" />}
            value={code}
            maxLength={24}
            disabled={target !== undefined}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <Field
            label={<T k="pay.allowance.type.form.name" />}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <Field
          label={<T k="pay.allowance.type.form.description" />}
          value={description}
          maxLength={500}
          onChange={(event) => setDescription(event.target.value)}
        />

        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-700">
            <T k="pay.allowance.type.form.mode" />
          </p>
          <SelectControl
            label={t('pay.allowance.type.form.mode')}
            value={calcMode}
            disabled={frozen}
            onChange={(event) => setCalcMode(event.target.value as CalcMode)}
          >
            {(['fixed', 'percentOfBasic'] as const).map((value) => (
              <option key={value} value={value}>
                {t(CALC_MODE_LABELS[value])}
              </option>
            ))}
          </SelectControl>
          <p className="text-xs text-slate-500">
            <T k="pay.allowance.type.form.mode.hint" />
          </p>
        </div>

        <Field
          label={<T k="pay.allowance.type.form.default" />}
          hint={<T k="pay.allowance.type.form.default.hint" />}
          type="number"
          step="0.01"
          min={0}
          value={defaultAmount}
          onChange={(event) => setDefaultAmount(event.target.value)}
        />

        <SettingRow
          label={<T k="pay.allowance.type.form.epf" />}
          hint={<T k="pay.allowance.type.form.epf.hint" />}
        >
          <Switch
            checked={epfLiable}
            onChange={setEpfLiable}
            disabled={frozen}
            label={t('pay.allowance.type.form.epf')}
            showLabel={false}
          />
        </SettingRow>

        <SettingRow label={<T k="pay.allowance.type.form.taxable" />}>
          <Switch
            checked={taxable}
            onChange={setTaxable}
            label={t('pay.allowance.type.form.taxable')}
            showLabel={false}
          />
        </SettingRow>

        <SettingRow label={<T k="pay.allowance.type.form.active" />}>
          <Switch
            checked={active}
            onChange={setActive}
            label={t('pay.allowance.type.form.active')}
            showLabel={false}
          />
        </SettingRow>

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
