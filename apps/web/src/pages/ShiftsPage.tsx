import type { LabelKey } from '@attendance/shared';
import { Clock, Layers, Moon, Pencil, Plus, Tag, Trash2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  Detail,
  DetailGrid,
  ExpandButton,
  FilterRow,
  FormGrid,
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
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { formatMinutes } from '../lib/operations-api';
import { T, TEnum, useLabels } from '../lib/translation';

interface TimeBlock {
  id?: number;
  blockOrder: number;
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  breakMinutes: number;
  graceBeforeMinutes: number;
  graceAfterMinutes: number;
}

interface WorkPattern {
  id: number;
  name: string;
  description: string | null;
  kind: string;
  active: boolean;
  timeBlocks: TimeBlock[];
  staffCount: number;
  shiftCount: number;
  dailyMinutes: number;
}

interface Shift {
  id: number;
  code: string;
  name: string;
  colour: string | null;
  active: boolean;
  workPattern: { id: number; name: string; timeBlocks: TimeBlock[] };
  rosterCount: number;
}

/** Registry keys, not words — see `EXCEPTION_LABELS` for why. */
const KIND_LABELS: Record<string, LabelKey> = {
  regular: 'patternKind.regular',
  shift: 'patternKind.shift',
  standby: 'patternKind.standby',
};

/** Compact rendering of a pattern's blocks, e.g. `22:00–07:00+1`. */
function blocksLabel(blocks: TimeBlock[]): string {
  return blocks
    .map((block) => `${block.startTime}–${block.endTime}${block.endsNextDay ? '+1' : ''}`)
    .join(', ');
}

export function ShiftsPage(): ReactNode {
  const [tab, setTab] = useState('patterns');
  const [counts, setCounts] = useState<{ patterns: number; shifts: number } | null>(null);
  const { t } = useLabels();

  const reloadCounts = useCallback(() => {
    void Promise.all([api.get<WorkPattern[]>('/api/work-patterns'), api.get<Shift[]>('/api/shifts')])
      .then(([patterns, shifts]) =>
        setCounts({ patterns: patterns.length, shifts: shifts.length }),
      )
      .catch(() => setCounts(null));
  }, []);

  useEffect(reloadCounts, [reloadCounts]);

  return (
    <PanelCard title={<T k="shifts.title" />} subtitle={<T k="shifts.subtitle" />}>
      <PanelTabs
        label={t('shifts.tabs.aria')}
        active={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'patterns',
            label: <T k="shifts.tab.patterns" />,
            labelText: t('shifts.tab.patterns'),
            icon: <Clock className="size-4" aria-hidden />,
            count: counts?.patterns,
          },
          {
            id: 'shifts',
            label: <T k="shifts.tab.shifts" />,
            labelText: t('shifts.tab.shifts'),
            icon: <Tag className="size-4" aria-hidden />,
            count: counts?.shifts,
          },
        ]}
      />

      {tab === 'patterns' ? (
        <PatternsPanel onChanged={reloadCounts} />
      ) : (
        <ShiftsPanel onChanged={reloadCounts} />
      )}
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Work patterns
// ---------------------------------------------------------------------------

function PatternsPanel({ onChanged }: { onChanged: () => void }): ReactNode {
  const [rows, setRows] = useState<WorkPattern[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<WorkPattern | 'new' | null>(null);
  const [confirming, setConfirming] = useState<WorkPattern | null>(null);
  const { t } = useLabels();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.get<WorkPattern[]>('/api/work-patterns'));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('shifts.pattern.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: WorkPattern): Promise<void> {
    setConfirming(null);
    setError(null);
    setNotice(null);
    try {
      await api.delete(`/api/work-patterns/${String(row.id)}`);
      setNotice(t('shifts.pattern.removed', { name: row.name }));
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.remove'));
    }
  }

  const needle = search.trim().toLowerCase();
  const filtered = rows.filter(
    (row) => needle.length === 0 || row.name.toLowerCase().includes(needle),
  );
  const overnight = rows.filter((row) => row.timeBlocks.some((block) => block.endsNextDay)).length;

  return (
    <>
      <PanelSection
        title={<T k="shifts.pattern.count" vars={{ count: rows.length }} />}
        subtitle={<T k="shifts.pattern.subtitle" vars={{ overnight }} />}
        action={
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden />
            <T k="shifts.pattern.add" />
          </Button>
        }
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('shifts.pattern.search')}
        dirty={search.length > 0}
        onReset={() => setSearch('')}
      />

      <PanelBody className="space-y-3 pb-0">
        <Feedback error={error} notice={notice} />
        <PanelNote icon={<Clock className="size-3.5" aria-hidden />}>
          <T k="shifts.pattern.graceNote" />
        </PanelNote>
      </PanelBody>

      <div className="mt-3">
        <RecordTable
          loading={loading}
          rowCount={filtered.length}
          empty={<T k="shifts.pattern.empty" />}
          columns={[
            { header: <T k="shifts.pattern.column.name" /> },
            { header: <T k="shifts.pattern.column.kind" />, width: 'w-24' },
            { header: <T k="shifts.pattern.column.blocks" />, width: 'w-56' },
            { header: <T k="shifts.pattern.column.dailyHours" />, width: 'w-28' },
            { header: <T k="shifts.pattern.column.staff" />, width: 'w-20' },
            { header: <T k="shifts.pattern.column.shifts" />, width: 'w-20' },
            { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
          ]}
        >
          {filtered.map((row) => {
            const expanded = open === row.id;
            const crossesMidnight = row.timeBlocks.some((block) => block.endsNextDay);
            const locked = row.staffCount > 0 || row.shiftCount > 0;

            return (
              <>
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-slate-100',
                    expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
                  )}
                >
                  <td className="px-5 py-2.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-slate-800">{row.name}</span>
                      {crossesMidnight && (
                        <Badge tone="warning">
                          <Moon className="size-3" aria-hidden />
                          <T k="shifts.pattern.overnight" />
                        </Badge>
                      )}
                      {!row.active && (
                        <Badge tone="neutral">
                          <T k="shifts.pattern.inactive" />
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-xs text-slate-600">
                    <TEnum k={KIND_LABELS[row.kind]} fallback={row.kind} />
                  </td>
                  <td className="px-2 py-2.5 font-mono text-xs text-slate-600">
                    {blocksLabel(row.timeBlocks)}
                  </td>
                  <td className="px-2 py-2.5 font-mono text-xs tabular-nums text-slate-700">
                    {formatMinutes(row.dailyMinutes)}
                  </td>
                  <td className="px-2 py-2.5 text-xs tabular-nums text-slate-700">
                    {row.staffCount}
                  </td>
                  <td className="px-2 py-2.5 text-xs tabular-nums text-slate-700">
                    {row.shiftCount}
                  </td>
                  <td className="px-2 py-2.5 pr-4">
                    <RowActions>
                      <RowAction
                        icon={<Pencil className="size-4" aria-hidden />}
                        label={t('shifts.pattern.row.edit')}
                        tone="edit"
                        onClick={() => setEditing(row)}
                      />
                      <RowAction
                        icon={<Trash2 className="size-4" aria-hidden />}
                        label={
                          locked
                            ? t('shifts.pattern.row.locked', {
                                staff: row.staffCount,
                                shifts: row.shiftCount,
                              })
                            : t('shifts.pattern.row.remove')
                        }
                        tone="danger"
                        disabled={locked}
                        onClick={() => setConfirming(row)}
                      />
                      <ExpandButton
                        expanded={expanded}
                        onClick={() => setOpen(expanded ? null : row.id)}
                        label={t('shifts.pattern.row.expand')}
                      />
                    </RowActions>
                  </td>
                </tr>

                {expanded && (
                  <tr
                    key={`${String(row.id)}-detail`}
                    className="border-b border-slate-200 bg-slate-50"
                  >
                    <td colSpan={7} className="px-5 py-3">
                      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-left tracking-wide text-slate-500 uppercase">
                              <th scope="col" className="px-3 py-1.5 font-medium">
                                <T k="shifts.block.column.block" />
                              </th>
                              <th scope="col" className="px-3 py-1.5 font-medium">
                                <T k="shifts.block.column.start" />
                              </th>
                              <th scope="col" className="px-3 py-1.5 font-medium">
                                <T k="shifts.block.column.end" />
                              </th>
                              <th scope="col" className="px-3 py-1.5 font-medium">
                                <T k="shifts.block.column.break" />
                              </th>
                              <th scope="col" className="px-3 py-1.5 font-medium">
                                <T k="shifts.block.column.graceBefore" />
                              </th>
                              <th scope="col" className="px-3 py-1.5 font-medium">
                                <T k="shifts.block.column.graceAfter" />
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {row.timeBlocks.map((block) => (
                              <tr
                                key={block.blockOrder}
                                className="border-b border-slate-100 last:border-0"
                              >
                                <th
                                  scope="row"
                                  className="px-3 py-1.5 text-left font-medium text-slate-600"
                                >
                                  B{block.blockOrder}
                                </th>
                                <td className="px-3 py-1.5 font-mono tabular-nums text-slate-700">
                                  {block.startTime}
                                </td>
                                <td className="px-3 py-1.5 font-mono tabular-nums text-slate-700">
                                  {block.endTime}
                                  {block.endsNextDay && (
                                    <span className="ml-1 text-amber-700">
                                      <T k="shifts.block.nextDay" />
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-1.5 font-mono tabular-nums text-slate-600">
                                  {block.breakMinutes} m
                                </td>
                                <td className="px-3 py-1.5 font-mono tabular-nums text-slate-500">
                                  −{block.graceBeforeMinutes} m
                                </td>
                                <td className="px-3 py-1.5 font-mono tabular-nums text-slate-500">
                                  +{block.graceAfterMinutes} m
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <DetailGrid>
                        <Detail
                          label={<T k="shifts.pattern.detail.dailyHours" />}
                          value={formatMinutes(row.dailyMinutes)}
                        />
                        <Detail
                          label={<T k="shifts.pattern.detail.staffUsing" />}
                          value={String(row.staffCount)}
                        />
                        <Detail
                          label={<T k="shifts.pattern.detail.shiftsUsing" />}
                          value={String(row.shiftCount)}
                        />
                      </DetailGrid>

                      {crossesMidnight && (
                        <PanelNote tone="warn" className="mt-3">
                          <T k="shifts.pattern.detail.overnight" />
                        </PanelNote>
                      )}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </RecordTable>
      </div>

      <PanelFooter
        shown={filtered.length}
        total={rows.length}
        page={1}
        pageSize={Math.max(1, rows.length)}
        pageSizes={[Math.max(1, rows.length)]}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => {
          void load();
          onChanged();
        }}
      />

      {editing !== null && (
        <PatternDialog
          target={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (note) => {
            setEditing(null);
            setNotice(note);
            await load();
            onChanged();
          }}
        />
      )}

      {confirming !== null && (
        <Dialog
          title={<T k="shifts.pattern.remove.title" vars={{ name: confirming.name }} />}
          titleText={t('shifts.pattern.remove.title', { name: confirming.name })}
          onClose={() => setConfirming(null)}
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <T k="shifts.pattern.remove.body" />
            </p>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                <T k="dialog.cancel" />
              </Button>
              <Button
                onClick={() => void remove(confirming)}
                className="bg-rose-600 hover:bg-rose-500"
              >
                <T k="app.remove" />
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

function PatternDialog({
  target,
  onClose,
  onSaved,
}: {
  target: WorkPattern | null;
  onClose: () => void;
  onSaved: (note: string | null) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState(target?.name ?? '');
  const [kind, setKind] = useState(target?.kind ?? 'regular');
  const [blocks, setBlocks] = useState<TimeBlock[]>(
    target?.timeBlocks ?? [
      {
        blockOrder: 1,
        startTime: '08:00',
        endTime: '17:00',
        endsNextDay: false,
        breakMinutes: 60,
        graceBeforeMinutes: 60,
        graceAfterMinutes: 120,
      },
    ],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t, tEnum } = useLabels();

  function update(index: number, patch: Partial<TimeBlock>): void {
    setBlocks((current) =>
      current.map((block, position) => (position === index ? { ...block, ...patch } : block)),
    );
  }

  function addBlock(): void {
    setBlocks((current) => [
      ...current,
      {
        blockOrder: current.length + 1,
        startTime: '18:00',
        endTime: '22:00',
        endsNextDay: false,
        breakMinutes: 0,
        graceBeforeMinutes: 30,
        graceAfterMinutes: 30,
      },
    ]);
  }

  function removeBlock(index: number): void {
    setBlocks((current) =>
      current
        .filter((_, position) => position !== index)
        .map((block, position) => ({ ...block, blockOrder: position + 1 })),
    );
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    const payload = { name: name.trim(), kind, active: true, timeBlocks: blocks };

    try {
      const result = target
        ? await api.patch<{ noteKey?: LabelKey }>(
            `/api/work-patterns/${String(target.id)}`,
            payload,
          )
        : await api.post<{ noteKey?: LabelKey }>('/api/work-patterns', payload);
      await onSaved(
        result.noteKey === undefined
          ? t('shifts.pattern.saved', { name: payload.name })
          : t(result.noteKey),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  }

  const titleKey = target ? 'shifts.pattern.dialog.edit' : 'shifts.pattern.dialog.create';

  return (
    <Dialog
      title={<T k={titleKey} />}
      titleText={t(titleKey)}
      description={<T k="shifts.pattern.dialog.description" />}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <FormGrid>
          <Field
            label={<T k="shifts.pattern.column.name" />}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
          <div>
            <label htmlFor="pattern-kind" className="block text-sm font-medium text-slate-700">
              <T k="shifts.pattern.column.kind" />
            </label>
            <select
              id="pattern-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {/* `<option>` cannot hold a node, so these resolve to plain text. */}
              {Object.entries(KIND_LABELS).map(([value, key]) => (
                <option key={value} value={value}>
                  {tEnum(key, value)}
                </option>
              ))}
            </select>
          </div>
        </FormGrid>

        <fieldset className="space-y-3">
          <legend className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <Layers className="size-4 text-slate-400" aria-hidden />
            <T k="shifts.pattern.dialog.blocks" />
          </legend>

          {blocks.map((block, index) => (
            <div key={index} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">
                  <T
                    k="shifts.pattern.dialog.blockLabel"
                    vars={{ order: block.blockOrder }}
                  />
                </span>
                {blocks.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeBlock(index)}
                    aria-label={t('shifts.pattern.dialog.removeBlock', {
                      order: block.blockOrder,
                    })}
                    className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <Field
                  label={<T k="shifts.block.column.start" />}
                  type="time"
                  value={block.startTime}
                  onChange={(event) => update(index, { startTime: event.target.value })}
                />
                <Field
                  label={<T k="shifts.block.column.end" />}
                  type="time"
                  value={block.endTime}
                  onChange={(event) => update(index, { endTime: event.target.value })}
                />
                <Field
                  label={<T k="shifts.pattern.dialog.break" />}
                  inputMode="numeric"
                  value={String(block.breakMinutes)}
                  onChange={(event) =>
                    update(index, {
                      breakMinutes: Number(event.target.value.replace(/\D/g, '') || 0),
                    })
                  }
                />
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={block.endsNextDay}
                      onChange={(event) => update(index, { endsNextDay: event.target.checked })}
                    />
                    <T k="shifts.pattern.dialog.endsNextDay" />
                  </label>
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field
                  label={<T k="shifts.pattern.dialog.graceBefore" />}
                  inputMode="numeric"
                  value={String(block.graceBeforeMinutes)}
                  onChange={(event) =>
                    update(index, {
                      graceBeforeMinutes: Number(event.target.value.replace(/\D/g, '') || 0),
                    })
                  }
                />
                <Field
                  label={<T k="shifts.pattern.dialog.graceAfter" />}
                  inputMode="numeric"
                  value={String(block.graceAfterMinutes)}
                  onChange={(event) =>
                    update(index, {
                      graceAfterMinutes: Number(event.target.value.replace(/\D/g, '') || 0),
                    })
                  }
                />
              </div>
            </div>
          ))}

          {blocks.length < 6 && (
            <Button variant="ghost" onClick={addBlock}>
              <Plus className="size-4" aria-hidden />
              <T k="shifts.pattern.dialog.addBlock" />
            </Button>
          )}
        </fieldset>

        <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
          <T k="shifts.pattern.dialog.overlapWarning" />
        </PanelNote>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={name.trim().length === 0}
        />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

function ShiftsPanel({ onChanged }: { onChanged: () => void }): ReactNode {
  const [rows, setRows] = useState<Shift[]>([]);
  const [patterns, setPatterns] = useState<WorkPattern[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<Shift | 'new' | null>(null);
  const [confirming, setConfirming] = useState<Shift | null>(null);
  const { t } = useLabels();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [shifts, workPatterns] = await Promise.all([
        api.get<Shift[]>('/api/shifts'),
        api.get<WorkPattern[]>('/api/work-patterns'),
      ]);
      setRows(shifts);
      setPatterns(workPatterns);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('shifts.shift.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: Shift): Promise<void> {
    setConfirming(null);
    setError(null);
    setNotice(null);
    try {
      await api.delete(`/api/shifts/${String(row.id)}`);
      setNotice(t('shifts.shift.removed', { code: row.code }));
      await load();
      onChanged();
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
      <PanelSection
        title={<T k="shifts.shift.count" vars={{ count: rows.length }} />}
        subtitle={<T k="shifts.shift.subtitle" />}
        action={
          <Button onClick={() => setEditing('new')} disabled={patterns.length === 0}>
            <Plus className="size-4" aria-hidden />
            <T k="shifts.shift.add" />
          </Button>
        }
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('shifts.shift.search')}
        dirty={search.length > 0}
        onReset={() => setSearch('')}
      />

      {(error !== null || notice !== null || patterns.length === 0) && (
        <PanelBody className="space-y-3 pb-0">
          <Feedback error={error} notice={notice} />
          {patterns.length === 0 && (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="shifts.shift.needPattern" />
            </PanelNote>
          )}
        </PanelBody>
      )}

      <div className="mt-3">
        <RecordTable
          loading={loading}
          rowCount={filtered.length}
          empty={<T k="shifts.shift.empty" />}
          columns={[
            { header: <T k="shifts.shift.column.code" />, width: 'w-24' },
            { header: <T k="shifts.shift.column.name" /> },
            { header: <T k="shifts.shift.column.pattern" />, width: 'w-48' },
            { header: <T k="shifts.shift.column.hours" />, width: 'w-48' },
            { header: <T k="shifts.shift.column.rosterDays" />, width: 'w-36' },
            { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
          ]}
        >
          {filtered.map((row) => {
            const expanded = open === row.id;
            const locked = row.rosterCount > 0;

            return (
              <>
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-slate-100',
                    expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
                  )}
                >
                  <td className="px-5 py-2.5">
                    <span className="inline-flex items-center gap-2">
                      {row.colour !== null && (
                        <span
                          className="size-3 rounded-full"
                          style={{ backgroundColor: row.colour }}
                          aria-hidden
                        />
                      )}
                      <span className="font-mono text-xs font-semibold text-slate-800">
                        {row.code}
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-slate-800">{row.name}</td>
                  <td className="px-2 py-2.5 text-xs text-slate-600">{row.workPattern.name}</td>
                  <td className="px-2 py-2.5 font-mono text-xs text-slate-600">
                    {blocksLabel(row.workPattern.timeBlocks)}
                  </td>
                  <td className="px-2 py-2.5 text-xs tabular-nums text-slate-700">
                    {row.rosterCount}
                  </td>
                  <td className="px-2 py-2.5 pr-4">
                    <RowActions>
                      <RowAction
                        icon={<Pencil className="size-4" aria-hidden />}
                        label={t('shifts.shift.row.edit')}
                        tone="edit"
                        onClick={() => setEditing(row)}
                      />
                      <RowAction
                        icon={<Trash2 className="size-4" aria-hidden />}
                        label={
                          locked
                            ? t('shifts.shift.row.locked', { count: row.rosterCount })
                            : t('shifts.shift.row.remove')
                        }
                        tone="danger"
                        disabled={locked}
                        onClick={() => setConfirming(row)}
                      />
                      <ExpandButton
                        expanded={expanded}
                        onClick={() => setOpen(expanded ? null : row.id)}
                        label={t('shifts.shift.row.expand')}
                      />
                    </RowActions>
                  </td>
                </tr>

                {expanded && (
                  <tr
                    key={`${String(row.id)}-detail`}
                    className="border-b border-slate-200 bg-slate-50"
                  >
                    <td colSpan={6} className="px-5 py-3">
                      <DetailGrid>
                        <Detail
                          label={<T k="shifts.shift.column.code" />}
                          value={row.code}
                          mono
                        />
                        <Detail label={<T k="shifts.shift.column.name" />} value={row.name} />
                        <Detail
                          label={<T k="shifts.shift.column.pattern" />}
                          value={row.workPattern.name}
                        />
                        <Detail
                          label={<T k="shifts.shift.column.hours" />}
                          value={blocksLabel(row.workPattern.timeBlocks)}
                          mono
                        />
                        <Detail
                          label={<T k="shifts.shift.column.rosterDays" />}
                          value={String(row.rosterCount)}
                        />
                        <Detail
                          label={<T k="shifts.shift.detail.active" />}
                          value={
                            <T
                              k={
                                row.active
                                  ? 'shifts.shift.detail.active.yes'
                                  : 'shifts.shift.detail.active.no'
                              }
                            />
                          }
                        />
                      </DetailGrid>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </RecordTable>
      </div>

      <PanelFooter
        shown={filtered.length}
        total={rows.length}
        page={1}
        pageSize={Math.max(1, rows.length)}
        pageSizes={[Math.max(1, rows.length)]}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => {
          void load();
          onChanged();
        }}
      />

      {editing !== null && (
        <ShiftDialog
          target={editing === 'new' ? null : editing}
          patterns={patterns}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            setNotice(message);
            await load();
            onChanged();
          }}
        />
      )}

      {confirming !== null && (
        <Dialog
          title={<T k="shifts.shift.remove.title" vars={{ code: confirming.code }} />}
          titleText={t('shifts.shift.remove.title', { code: confirming.code })}
          onClose={() => setConfirming(null)}
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <T k="shifts.shift.remove.body" />
            </p>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                <T k="dialog.cancel" />
              </Button>
              <Button
                onClick={() => void remove(confirming)}
                className="bg-rose-600 hover:bg-rose-500"
              >
                <T k="app.remove" />
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

function ShiftDialog({
  target,
  patterns,
  onClose,
  onSaved,
}: {
  target: Shift | null;
  patterns: WorkPattern[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}): ReactNode {
  const [code, setCode] = useState(target?.code ?? '');
  const [name, setName] = useState(target?.name ?? '');
  const [colour, setColour] = useState(target?.colour ?? '#2563eb');
  const [workPatternId, setWorkPatternId] = useState(
    String(target?.workPattern.id ?? patterns[0]?.id ?? ''),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useLabels();

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    const payload = {
      code: code.trim(),
      name: name.trim(),
      colour,
      workPatternId: Number(workPatternId),
      active: true,
    };

    try {
      if (target) {
        await api.patch(`/api/shifts/${String(target.id)}`, payload);
      } else {
        await api.post('/api/shifts', payload);
      }
      await onSaved(t('shifts.shift.saved', { code: payload.code }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  }

  const titleKey = target ? 'shifts.shift.dialog.edit' : 'shifts.shift.dialog.create';

  return (
    <Dialog
      title={<T k={titleKey} />}
      titleText={t(titleKey)}
      description={<T k="shifts.shift.dialog.description" />}
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <FormGrid>
          <Field
            label={<T k="shifts.shift.column.code" />}
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            autoFocus
            hint={<T k="shifts.shift.dialog.code.hint" />}
          />
          <div>
            <label htmlFor="shift-colour" className="block text-sm font-medium text-slate-700">
              <T k="shifts.shift.dialog.colour" />
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                id="shift-colour"
                type="color"
                value={colour}
                onChange={(event) => setColour(event.target.value)}
                className="h-9 w-16 rounded-lg border border-slate-300"
              />
              <span className="font-mono text-xs text-slate-600">{colour}</span>
            </div>
          </div>
        </FormGrid>

        <Field
          label={<T k="shifts.shift.column.name" />}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />

        <div>
          <label htmlFor="shift-pattern" className="block text-sm font-medium text-slate-700">
            <T k="shifts.shift.column.pattern" />
          </label>
          <select
            id="shift-pattern"
            value={workPatternId}
            onChange={(event) => setWorkPatternId(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {patterns.map((pattern) => (
              <option key={pattern.id} value={pattern.id}>
                {pattern.name} ({blocksLabel(pattern.timeBlocks)})
              </option>
            ))}
          </select>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={code.trim().length === 0 || name.trim().length === 0}
        />
      </div>
    </Dialog>
  );
}
