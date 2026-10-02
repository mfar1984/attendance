import type { LabelKey } from '@attendance/shared';
import {
  CircleCheck,
  Clock,
  Layers,
  Moon,
  Pencil,
  Plus,
  Tag,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  CodePill,
  ExpandButton,
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
import { RemoveDialog } from '../components/RemoveDialog';
import { Badge, Button, CheckCard, Field, SelectField, TextArea } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { formatMinutes } from '../lib/operations-api';
import { T, TEnum, useLabels } from '../lib/translation';

const PATTERNS = 'schedule.workPatterns';
const SHIFTS = 'schedule.shifts';

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

/** What a shift may point at, read on the shifts screen's own grant. */
interface PatternOption {
  id: number;
  name: string;
  active: boolean;
  timeBlocks: TimeBlock[];
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

/** One list, loaded once and handed to its tab, so the tab count and the table agree. */
interface ListState<Row> {
  rows: Row[];
  loading: boolean;
  error: string | null;
  loadedAt: string | null;
}

const EMPTY = { rows: [], loading: true, error: null, loadedAt: null };

/** Registry keys, not words — see `EXCEPTION_LABELS` for why. */
const KIND_LABELS: Record<string, LabelKey> = {
  regular: 'patternKind.regular',
  shift: 'patternKind.shift',
  standby: 'patternKind.standby',
};

/** Register, not severity: a kind of pattern is a category, and none of them is a fault. */
const KIND_TONES: Record<string, 'neutral' | 'info' | 'accent'> = {
  regular: 'neutral',
  shift: 'info',
  standby: 'accent',
};

/** Compact rendering of a pattern's blocks, e.g. `22:00–07:00+1`. */
function blocksLabel(blocks: TimeBlock[]): string {
  return blocks
    .map((block) => `${block.startTime}–${block.endTime}${block.endsNextDay ? '+1' : ''}`)
    .join(', ');
}

/** The fields the schema takes, in a fixed order: a block read back from the server carries its row id. */
function normaliseBlocks(blocks: TimeBlock[]): Omit<TimeBlock, 'id'>[] {
  return blocks.map((block) => ({
    blockOrder: block.blockOrder,
    startTime: block.startTime,
    endTime: block.endTime,
    endsNextDay: block.endsNextDay,
    breakMinutes: block.breakMinutes,
    graceBeforeMinutes: block.graceBeforeMinutes,
    graceAfterMinutes: block.graceAfterMinutes,
  }));
}

/**
 * Work patterns and the shift codes that name them.
 *
 * Two screens behind one route, each with its own grant. Both lists were fetched twice — once per
 * tab and once for the tab counts, through one `Promise.all` — so a grant for one screen but not
 * the other blanked both counts, and the shift form's pattern list came from the pattern screen.
 */
export function ShiftsPage(): ReactNode {
  const { can } = useAuth();
  const mayPatterns = can(PATTERNS, 'view');
  const mayShifts = can(SHIFTS, 'view');
  const [tab, setTab] = useState(mayPatterns ? 'patterns' : 'shifts');
  const [patterns, setPatterns] = useState<ListState<WorkPattern>>(EMPTY);
  const [shifts, setShifts] = useState<ListState<Shift>>(EMPTY);
  const [options, setOptions] = useState<PatternOption[]>([]);
  const { t } = useLabels();

  const loadPatterns = useCallback(async () => {
    if (!mayPatterns) return;
    setPatterns((current) => ({ ...current, loading: true }));
    try {
      const rows = await api.get<WorkPattern[]>('/api/work-patterns');
      setPatterns({ rows, loading: false, error: null, loadedAt: new Date().toISOString() });
    } catch (cause) {
      setPatterns((current) => ({
        ...current,
        loading: false,
        error: cause instanceof Error ? cause.message : t('shifts.pattern.error.load'),
      }));
    }
  }, [mayPatterns, t]);

  const loadShifts = useCallback(async () => {
    if (!mayShifts) return;
    setShifts((current) => ({ ...current, loading: true }));
    try {
      const [rows, patternOptions] = await Promise.all([
        api.get<Shift[]>('/api/shifts'),
        api.get<PatternOption[]>('/api/shifts/work-patterns'),
      ]);
      setShifts({ rows, loading: false, error: null, loadedAt: new Date().toISOString() });
      setOptions(patternOptions);
    } catch (cause) {
      setShifts((current) => ({
        ...current,
        loading: false,
        error: cause instanceof Error ? cause.message : t('shifts.shift.error.load'),
      }));
    }
  }, [mayShifts, t]);

  useEffect(() => {
    void loadPatterns();
    void loadShifts();
  }, [loadPatterns, loadShifts]);

  const tabs = [
    ...(mayPatterns
      ? [
          {
            id: 'patterns',
            label: <T k="shifts.tab.patterns" />,
            labelText: t('shifts.tab.patterns'),
            icon: <Clock className="size-4" aria-hidden />,
            count: patterns.rows.length,
          },
        ]
      : []),
    ...(mayShifts
      ? [
          {
            id: 'shifts',
            label: <T k="shifts.tab.shifts" />,
            labelText: t('shifts.tab.shifts'),
            icon: <Tag className="size-4" aria-hidden />,
            count: shifts.rows.length,
          },
        ]
      : []),
  ];

  return (
    <PanelCard title={<T k="shifts.title" />} subtitle={<T k="shifts.subtitle" />}>
      {tabs.length > 1 && (
        <PanelTabs label={t('shifts.tabs.aria')} active={tab} onChange={setTab} tabs={tabs} />
      )}

      {tab === 'patterns' && mayPatterns && (
        <PatternsPanel
          list={patterns}
          onReload={async () => {
            await loadPatterns();
            // A pattern's name and times show on the shift rows too.
            await loadShifts();
          }}
        />
      )}
      {tab === 'shifts' && mayShifts && (
        <ShiftsPanel
          list={shifts}
          options={options}
          onReload={async () => {
            await loadShifts();
            // The pattern rows count the shifts that refer to them.
            await loadPatterns();
          }}
        />
      )}
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Work patterns
// ---------------------------------------------------------------------------

function PatternsPanel({
  list,
  onReload,
}: {
  list: ListState<WorkPattern>;
  onReload: () => Promise<void>;
}): ReactNode {
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<WorkPattern | 'new' | null>(null);
  const [removing, setRemoving] = useState<WorkPattern | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();
  const mayEdit = can(PATTERNS, 'edit');
  const mayRemove = can(PATTERNS, 'delete');

  const { rows, loading } = list;
  const needle = search.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      needle.length === 0 ||
      row.name.toLowerCase().includes(needle) ||
      (row.description ?? '').toLowerCase().includes(needle),
  );
  const overnight = rows.filter((row) => row.timeBlocks.some((block) => block.endsNextDay)).length;

  const done = async (message: string): Promise<void> => {
    setEditing(null);
    setRemoving(null);
    setNotice(message);
    await onReload();
  };

  return (
    <>
      <PanelSection
        title={<T k="shifts.pattern.count" vars={{ count: rows.length }} />}
        subtitle={<T k="shifts.pattern.subtitle" vars={{ overnight }} />}
        action={
          can(PATTERNS, 'create') ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden />
              <T k="shifts.pattern.add" />
            </Button>
          ) : undefined
        }
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('shifts.pattern.search')}
        dirty={search.length > 0}
        onReset={() => setSearch('')}
      />

      {(list.error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={list.error} notice={notice} />
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={filtered.length}
        empty={<T k="shifts.pattern.empty" />}
        columns={[
          { header: <T k="shifts.pattern.column.name" /> },
          { header: <T k="shifts.pattern.column.kind" />, width: 'w-28' },
          { header: <T k="shifts.pattern.column.blocks" />, width: 'w-64' },
          { header: <T k="shifts.pattern.column.dailyHours" />, width: 'w-24', align: 'right' },
          { header: <T k="shifts.pattern.column.staff" />, width: 'w-20', align: 'right' },
          { header: <T k="shifts.pattern.column.shifts" />, width: 'w-20', align: 'right' },
          { header: <T k="panel.column.status" />, width: 'w-28' },
          { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
        ]}
      >
        {filtered.map((row) => {
          const expanded = open === row.id;
          const crossesMidnight = row.timeBlocks.some((block) => block.endsNextDay);
          const locked = row.staffCount > 0 || row.shiftCount > 0;

          return (
            <Fragment key={row.id}>
              <tr
                className={cn(
                  'border-b border-slate-100',
                  expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
                )}
              >
                <td className="px-5 py-2.5">
                  <span className="block font-medium text-slate-800">{row.name}</span>
                  {row.description !== null && row.description.length > 0 && (
                    <span className="block truncate text-[11px] text-slate-400">
                      {row.description}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2.5">
                  <Badge tone={KIND_TONES[row.kind] ?? 'neutral'} className="uppercase">
                    <TEnum k={KIND_LABELS[row.kind]} fallback={row.kind} />
                  </Badge>
                </td>
                <td className="px-2 py-2.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-xs text-slate-600">
                      {blocksLabel(row.timeBlocks)}
                    </span>
                    {crossesMidnight && (
                      <Badge tone="warning" className="uppercase">
                        <Moon className="size-3" aria-hidden />
                        <T k="shifts.pattern.overnight" />
                      </Badge>
                    )}
                  </span>
                </td>
                <td className="px-2 py-2.5 text-right font-mono text-xs text-slate-700 tabular-nums">
                  {formatMinutes(row.dailyMinutes)}
                </td>
                <td className="px-2 py-2.5 text-right text-xs text-slate-700 tabular-nums">
                  {row.staffCount}
                </td>
                <td className="px-2 py-2.5 text-right text-xs text-slate-700 tabular-nums">
                  {row.shiftCount}
                </td>
                <td className="px-2 py-2.5">
                  <Badge tone={row.active ? 'success' : 'neutral'} className="uppercase">
                    <T k={row.active ? 'app.status.active' : 'app.status.inactive'} />
                  </Badge>
                </td>
                <td className="px-2 py-2.5 pr-4">
                  <RowActions>
                    {mayEdit && (
                      <RowAction
                        icon={<Pencil className="size-4" aria-hidden />}
                        label={t('shifts.pattern.row.edit')}
                        tone="edit"
                        onClick={() => setEditing(row)}
                      />
                    )}
                    {mayRemove && (
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
                        onClick={() => setRemoving(row)}
                      />
                    )}
                    <ExpandButton
                      expanded={expanded}
                      onClick={() => setOpen(expanded ? null : row.id)}
                      label={t('shifts.pattern.row.expand')}
                    />
                  </RowActions>
                </td>
              </tr>

              {expanded && (
                <tr className="border-b border-slate-200 bg-slate-50">
                  <td colSpan={8} className="px-5 py-3">
                    {/* Each block's own windows: the row above can only show the first and last
                        times, and the grace windows are what decide which scans count. */}
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
                              <td className="px-3 py-1.5 font-mono text-slate-700 tabular-nums">
                                {block.startTime}
                              </td>
                              <td className="px-3 py-1.5 font-mono text-slate-700 tabular-nums">
                                {block.endTime}
                                {block.endsNextDay && (
                                  <span className="ml-1 text-amber-700">
                                    <T k="shifts.block.nextDay" />
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 font-mono text-slate-600 tabular-nums">
                                {block.breakMinutes} m
                              </td>
                              <td className="px-3 py-1.5 font-mono text-slate-500 tabular-nums">
                                −{block.graceBeforeMinutes} m
                              </td>
                              <td className="px-3 py-1.5 font-mono text-slate-500 tabular-nums">
                                +{block.graceAfterMinutes} m
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {crossesMidnight && (
                      <PanelNote tone="warn" className="mt-3">
                        <T k="shifts.pattern.detail.overnight" />
                      </PanelNote>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </RecordTable>

      <PanelFooter
        shown={filtered.length}
        total={rows.length}
        page={1}
        pageSize={Math.max(1, rows.length)}
        pageSizes={[Math.max(1, rows.length)]}
        generatedAt={list.loadedAt}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => void onReload()}
      />

      {editing !== null && (
        <PatternDialog
          target={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={done}
        />
      )}

      {removing !== null && (
        <RemoveDialog
          title={<T k="shifts.pattern.remove.title" vars={{ name: removing.name }} />}
          titleText={t('shifts.pattern.remove.title', { name: removing.name })}
          description={<T k="shifts.pattern.remove.body" />}
          onConfirm={async () => {
            await api.delete(`/api/work-patterns/${String(removing.id)}`);
            await done(t('shifts.pattern.removed', { name: removing.name }));
          }}
          onClose={() => setRemoving(null)}
        />
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
  onSaved: (message: string) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState(target?.name ?? '');
  const [description, setDescription] = useState(target?.description ?? '');
  const [kind, setKind] = useState(target?.kind ?? 'regular');
  /*
   * Read from the record. The form sent `active: true` on every save, so editing an inactive
   * pattern switched it back on, and there was no way to switch one off at all.
   */
  const [active, setActive] = useState(target?.active ?? true);
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

  /** Minutes fields accept digits only; an emptied box reads as zero rather than as NaN. */
  const minutes = (value: string): number => Number(value.replace(/\D/g, '') || 0);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    const timeBlocks = normaliseBlocks(blocks);
    /*
     * Blocks only when they moved. The server answers any save that carries them with "blocks
     * changed, recompute the affected dates" — so renaming a pattern told the operator to
     * recompute a month of attendance for a change that touched no time at all.
     */
    const blocksMoved =
      target === null ||
      JSON.stringify(timeBlocks) !== JSON.stringify(normaliseBlocks(target.timeBlocks));
    const payload = {
      name: name.trim(),
      description: description.trim(),
      kind,
      active,
      ...(blocksMoved ? { timeBlocks } : {}),
    };

    try {
      const result = target
        ? await api.patch<{ noteKey?: LabelKey }>(
            `/api/work-patterns/${String(target.id)}`,
            payload,
          )
        : await api.post<{ noteKey?: LabelKey }>('/api/work-patterns', payload);
      // The record's name first, then what the server says follows from the change.
      await onSaved(
        [t('shifts.pattern.saved', { name: payload.name }), result.noteKey ? t(result.noteKey) : '']
          .filter((part) => part.length > 0)
          .join(' '),
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
      width="2xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/* Identity first: the name somebody picks it by, then what kind it is. */}
        <div className="grid items-start gap-4 sm:grid-cols-[1fr_14rem]">
          <Field
            label={<T k="shifts.pattern.column.name" />}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
          <SelectField
            label={<T k="shifts.pattern.column.kind" />}
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            {/* `<option>` cannot hold a node, so these resolve to plain text. */}
            {Object.entries(KIND_LABELS).map(([value, key]) => (
              <option key={value} value={value}>
                {tEnum(key, value)}
              </option>
            ))}
          </SelectField>
        </div>

        <TextArea
          label={<T k="shifts.pattern.field.description" />}
          rows={2}
          maxLength={500}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />

        <fieldset className="space-y-3">
          <legend className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <Layers className="size-4 text-slate-400" aria-hidden />
            <T k="shifts.pattern.dialog.blocks" />
          </legend>
          {/* The rule that holds across blocks, so it sits with the blocks rather than under one. */}
          <p className="text-xs text-slate-500">
            <T k="shifts.pattern.dialog.overlapWarning" />
          </p>

          {blocks.map((block, index) => (
            <div key={index} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">
                  <T k="shifts.pattern.dialog.blockLabel" vars={{ order: block.blockOrder }} />
                </span>
                {blocks.length > 1 && (
                  <RowAction
                    icon={<Trash2 className="size-4" aria-hidden />}
                    label={t('shifts.pattern.dialog.removeBlock', { order: block.blockOrder })}
                    tone="danger"
                    onClick={() => removeBlock(index)}
                  />
                )}
              </div>

              <div className="grid items-start gap-3 sm:grid-cols-5">
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
                  onChange={(event) => update(index, { breakMinutes: minutes(event.target.value) })}
                />
                <Field
                  label={<T k="shifts.pattern.dialog.graceBefore" />}
                  inputMode="numeric"
                  value={String(block.graceBeforeMinutes)}
                  onChange={(event) =>
                    update(index, { graceBeforeMinutes: minutes(event.target.value) })
                  }
                />
                <Field
                  label={<T k="shifts.pattern.dialog.graceAfter" />}
                  inputMode="numeric"
                  value={String(block.graceAfterMinutes)}
                  onChange={(event) =>
                    update(index, { graceAfterMinutes: minutes(event.target.value) })
                  }
                />
              </div>

              <div className="mt-3">
                <CheckCard
                  checked={block.endsNextDay}
                  onChange={(checked) => update(index, { endsNextDay: checked })}
                  icon={<Moon className="size-4" aria-hidden />}
                  title={<T k="shifts.pattern.dialog.endsNextDay" />}
                  hint={<T k="shifts.pattern.dialog.endsNextDay.hint" />}
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

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="pb-2">
          <CheckCard
            checked={active}
            onChange={setActive}
            icon={<CircleCheck className="size-4" aria-hidden />}
            title={<T k="shifts.dialog.active" />}
            hint={<T k="shifts.pattern.dialog.active.hint" />}
          />
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={name.trim().length === 0}
          submitLabel={<T k={target ? 'dialog.save' : 'shifts.pattern.dialog.create'} />}
        />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

function ShiftsPanel({
  list,
  options,
  onReload,
}: {
  list: ListState<Shift>;
  options: PatternOption[];
  onReload: () => Promise<void>;
}): ReactNode {
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Shift | 'new' | null>(null);
  const [removing, setRemoving] = useState<Shift | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();
  const mayEdit = can(SHIFTS, 'edit');
  const mayRemove = can(SHIFTS, 'delete');

  const { rows, loading } = list;
  const needle = search.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      needle.length === 0 ||
      row.code.toLowerCase().includes(needle) ||
      row.name.toLowerCase().includes(needle),
  );
  // A new shift can only point at an active pattern, so that is what decides whether one can be added.
  const noPattern = !loading && !options.some((option) => option.active);

  const done = async (message: string): Promise<void> => {
    setEditing(null);
    setRemoving(null);
    setNotice(message);
    await onReload();
  };

  return (
    <>
      <PanelSection
        title={<T k="shifts.shift.count" vars={{ count: rows.length }} />}
        subtitle={<T k="shifts.shift.subtitle" />}
        action={
          can(SHIFTS, 'create') ? (
            <Button
              onClick={() => setEditing('new')}
              disabled={noPattern}
              {...(noPattern ? { title: t('shifts.shift.needPattern') } : {})}
            >
              <Plus className="size-4" aria-hidden />
              <T k="shifts.shift.add" />
            </Button>
          ) : undefined
        }
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('shifts.shift.search')}
        dirty={search.length > 0}
        onReset={() => setSearch('')}
      />

      {(list.error !== null || notice !== null || noPattern) && (
        <PanelBody className="space-y-2 pb-0">
          <Feedback error={list.error} notice={notice} />
          {noPattern && (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="shifts.shift.needPattern" />
            </PanelNote>
          )}
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={filtered.length}
        empty={<T k="shifts.shift.empty" />}
        columns={[
          { header: <T k="shifts.shift.column.code" />, width: 'w-28' },
          { header: <T k="shifts.shift.column.name" /> },
          { header: <T k="shifts.shift.column.pattern" />, width: 'w-48' },
          { header: <T k="shifts.shift.column.hours" />, width: 'w-48' },
          { header: <T k="shifts.shift.column.rosterDays" />, width: 'w-32', align: 'right' },
          { header: <T k="panel.column.status" />, width: 'w-28' },
          { header: <T k="panel.column.actions" />, width: 'w-24', align: 'right' },
        ]}
      >
        {filtered.map((row) => {
          const locked = row.rosterCount > 0;

          return (
            <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/70">
              <td className="px-5 py-2.5">
                {/* The colour the calendar paints this shift in, carried on the code itself. */}
                <CodePill code={row.code} colour={row.colour} />
              </td>
              <td className="px-2 py-2.5 text-slate-800">{row.name}</td>
              <td className="px-2 py-2.5 text-xs text-slate-600">{row.workPattern.name}</td>
              <td className="px-2 py-2.5 font-mono text-xs text-slate-600">
                {blocksLabel(row.workPattern.timeBlocks)}
              </td>
              <td className="px-2 py-2.5 text-right text-xs text-slate-700 tabular-nums">
                {row.rosterCount}
              </td>
              <td className="px-2 py-2.5">
                <Badge tone={row.active ? 'success' : 'neutral'} className="uppercase">
                  <T k={row.active ? 'app.status.active' : 'app.status.inactive'} />
                </Badge>
              </td>
              <td className="px-2 py-2.5 pr-4">
                <RowActions>
                  {mayEdit && (
                    <RowAction
                      icon={<Pencil className="size-4" aria-hidden />}
                      label={t('shifts.shift.row.edit')}
                      tone="edit"
                      onClick={() => setEditing(row)}
                    />
                  )}
                  {mayRemove && (
                    <RowAction
                      icon={<Trash2 className="size-4" aria-hidden />}
                      label={
                        locked
                          ? t('shifts.shift.row.locked', { count: row.rosterCount })
                          : t('shifts.shift.row.remove')
                      }
                      tone="danger"
                      disabled={locked}
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
        shown={filtered.length}
        total={rows.length}
        page={1}
        pageSize={Math.max(1, rows.length)}
        pageSizes={[Math.max(1, rows.length)]}
        generatedAt={list.loadedAt}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => void onReload()}
      />

      {editing !== null && (
        <ShiftDialog
          target={editing === 'new' ? null : editing}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={done}
        />
      )}

      {removing !== null && (
        <RemoveDialog
          title={<T k="shifts.shift.remove.title" vars={{ code: removing.code }} />}
          titleText={t('shifts.shift.remove.title', { code: removing.code })}
          description={<T k="shifts.shift.remove.body" />}
          onConfirm={async () => {
            await api.delete(`/api/shifts/${String(removing.id)}`);
            await done(t('shifts.shift.removed', { code: removing.code }));
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}

function ShiftDialog({
  target,
  options,
  onClose,
  onSaved,
}: {
  target: Shift | null;
  options: PatternOption[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}): ReactNode {
  // Active patterns, plus the one this shift already points at so editing does not silently move it.
  const choices = options.filter(
    (option) => option.active || option.id === target?.workPattern.id,
  );
  const [code, setCode] = useState(target?.code ?? '');
  const [name, setName] = useState(target?.name ?? '');
  const [colour, setColour] = useState(target?.colour ?? '#2563eb');
  const [active, setActive] = useState(target?.active ?? true);
  const [workPatternId, setWorkPatternId] = useState(
    String(target?.workPattern.id ?? choices[0]?.id ?? ''),
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
      active,
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
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/* Identity first: the short code somebody types, then the name they read. */}
        <div className="grid items-start gap-4 sm:grid-cols-[7rem_1fr]">
          <Field
            label={<T k="shifts.shift.column.code" />}
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            autoFocus
            hint={<T k="shifts.shift.dialog.code.hint" />}
          />
          <Field
            label={<T k="shifts.shift.column.name" />}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="grid items-start gap-4 sm:grid-cols-[1fr_10rem]">
          <SelectField
            label={<T k="shifts.shift.column.pattern" />}
            value={workPatternId}
            onChange={(event) => setWorkPatternId(event.target.value)}
          >
            {choices.map((pattern) => (
              <option key={pattern.id} value={pattern.id}>
                {pattern.name} ({blocksLabel(pattern.timeBlocks)})
              </option>
            ))}
          </SelectField>
          <div className="space-y-1.5">
            <label htmlFor="shift-colour" className="block text-sm font-medium text-slate-700">
              <T k="shifts.shift.dialog.colour" />
            </label>
            <div className="flex items-center gap-2">
              <input
                id="shift-colour"
                type="color"
                value={colour}
                onChange={(event) => setColour(event.target.value)}
                className="h-9 w-14 rounded-lg border border-slate-300"
              />
              <span className="font-mono text-xs text-slate-600">{colour}</span>
            </div>
          </div>
        </div>

        {/* The last block before the footer, so it carries the `pb-2`. Deactivating is what the
            server asks for when a shift has history, so the form has to be able to do it. */}
        <div className="pb-2">
          <CheckCard
            checked={active}
            onChange={setActive}
            icon={<CircleCheck className="size-4" aria-hidden />}
            title={<T k="shifts.dialog.active" />}
            hint={<T k="shifts.shift.dialog.active.hint" />}
          />
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={
            code.trim().length === 0 || name.trim().length === 0 || workPatternId.length === 0
          }
          submitLabel={<T k={target ? 'dialog.save' : 'shifts.shift.dialog.create'} />}
        />
      </div>
    </Dialog>
  );
}
