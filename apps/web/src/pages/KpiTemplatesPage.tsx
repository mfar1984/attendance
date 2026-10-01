import { Pencil, Plus, Scale, Trash2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

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
  RecordTable,
  RowAction,
  RowActions,
} from '../components/RecordPanel';
import { Badge, Button, Field, SelectField, TextArea } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import {
  CATEGORY_LABELS,
  equaliseWeights,
  kpiApi,
  type CompetencyOption,
  type KpiTemplate,
} from '../lib/kpi-api';
import { T, useLabels } from '../lib/translation';

const SCREEN = 'hr.kpiTemplates';

/** One sen of slack, matching the server: thirds cannot be expressed exactly in two decimals. */
const WEIGHT_TOLERANCE = 0.01;

function weightsBalanced(total: number): boolean {
  return Math.round(Math.abs(total - 100) * 100) / 100 <= WEIGHT_TOLERANCE;
}

/**
 * Appraisal forms: which competencies somebody is assessed against, and what each is worth.
 *
 * Competencies are picked from the catalogue, not typed. Free text was what made the catalogue
 * necessary — "Komunikasi" became ten spellings of itself, and nothing could answer what a
 * competency averaged across the organisation or which forms asked about it.
 *
 * Weights are edited as a set because they are only valid as a set. Saving one competency at a time
 * would let somebody store a valid row that leaves the form summing to 90, and two people read out
 * of different totals are not on the same scale.
 *
 * Shaped after the leave types tab, which is the reference for every table of master data.
 */
export function KpiTemplatesPage(): ReactNode {
  const [rows, setRows] = useState<KpiTemplate[]>([]);
  const [options, setOptions] = useState<CompetencyOption[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<KpiTemplate | 'new' | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [templates, catalogue] = await Promise.all([
        kpiApi.templates(),
        kpiApi.competencyOptions(),
      ]);
      setRows(templates);
      setOptions(catalogue);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('kpi.template.error.load'));
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
  // The catalogue being empty blocks the action, so it is stated where it blocks.
  const catalogueEmpty = !loading && options.length === 0;

  return (
    <PanelCard title={<T k="kpi.template.title" />} subtitle={<T k="kpi.template.subtitle" />}>
      {/* Count in the title, the way the leave types tab heads its list. */}
      <PanelSection
        title={<T k="kpi.template.count" vars={{ count: rows.length }} />}
        action={
          can(SCREEN, 'create') ? (
            <Button
              onClick={() => setEditing('new')}
              disabled={options.length === 0}
              {...(options.length === 0 ? { title: t('kpi.template.form.catalogueEmpty') } : {})}
            >
              <Plus className="size-4" aria-hidden />
              <T k="kpi.template.action.new" />
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

      {(error !== null || notice !== null || catalogueEmpty) && (
        <PanelBody className="space-y-2 pb-0">
          <Feedback error={error} notice={notice} />
          {catalogueEmpty && (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="kpi.template.form.catalogueEmpty" />
            </PanelNote>
          )}
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={filtered.length}
        empty={<T k="kpi.template.empty" />}
        columns={[
          { header: <T k="kpi.template.column.code" />, width: 'w-28' },
          { header: <T k="kpi.template.column.name" /> },
          { header: <T k="kpi.template.column.items" />, width: 'w-28', align: 'right' },
          { header: <T k="kpi.template.column.weight" />, width: 'w-40', align: 'right' },
          { header: <T k="kpi.template.column.used" />, width: 'w-24', align: 'right' },
          { header: <T k="panel.column.status" />, width: 'w-24' },
          { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
        ]}
      >
        {filtered.map((row) => (
          <TemplateRowView
            key={row.id}
            row={row}
            balanced={weightsBalanced(row.weightTotal)}
            expanded={open === row.id}
            onToggle={() => setOpen(open === row.id ? null : row.id)}
            onEdit={() => setEditing(row)}
            onChanged={async (message) => {
              setNotice(message);
              await load();
            }}
            onError={setError}
          />
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
        <TemplateDialog
          target={editing === 'new' ? null : editing}
          options={options}
          onClose={() => setEditing(null)}
          onDone={async (message) => {
            setEditing(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </PanelCard>
  );
}

function TemplateRowView({
  row,
  balanced,
  expanded,
  onToggle,
  onEdit,
  onChanged,
  onError,
}: {
  row: KpiTemplate;
  balanced: boolean;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
}): ReactNode {
  const { t } = useLabels();
  const { can } = useAuth();
  const inUse = row.assignmentCount > 0;

  return (
    <>
      <tr
        className={cn(
          'border-b border-slate-100',
          expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
          /*
            A form whose weights no longer sum to 100 would be refused when it is assigned; tone it
            so the eye finds it before it reads the number.
          */
          !expanded && !balanced ? 'bg-rose-50/40' : !expanded && !row.active && 'bg-slate-50/60',
        )}
      >
        <td className="px-5 py-2.5">
          <CodePill code={row.code} />
        </td>
        <td className="px-2 py-2.5">
          <span className={cn('block font-medium', row.active ? 'text-slate-800' : 'text-slate-400')}>
            {row.name}
          </span>
          {row.description !== null && row.description.length > 0 && (
            <span className="mt-0.5 block text-xs text-slate-500">{row.description}</span>
          )}
        </td>
        <td className="px-2 py-2.5 text-right text-xs tabular-nums text-slate-700">
          {row.items.length}
        </td>
        <td className="px-2 py-2.5 text-right text-xs tabular-nums">
          {balanced ? (
            <span className="text-slate-700">100%</span>
          ) : (
            <span className="font-medium text-rose-700">
              <T k="kpi.template.weightOff" vars={{ total: row.weightTotal.toFixed(2) }} />
            </span>
          )}
        </td>
        <td className="px-2 py-2.5 text-right text-xs tabular-nums text-slate-500">
          {row.assignmentCount}
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
                label={t('kpi.template.action.edit')}
                tone="edit"
                onClick={onEdit}
              />
            )}
            {/*
              Disabled with the count in the tooltip rather than live and refused: an appraisal
              still has to name the form it was taken against.
            */}
            {can(SCREEN, 'delete') && (
              <RowAction
                icon={<Trash2 className="size-4" aria-hidden />}
                label={
                  inUse
                    ? t(row.active ? 'kpi.template.row.locked' : 'kpi.template.row.locked.inactive', {
                        count: row.assignmentCount,
                      })
                    : t('kpi.template.action.delete')
                }
                tone="danger"
                disabled={inUse}
                onClick={async () => {
                  try {
                    await kpiApi.deleteTemplate(row.id);
                    await onChanged(t('kpi.template.removed', { code: row.code }));
                  } catch (cause) {
                    onError(cause instanceof Error ? cause.message : t('app.error.remove'));
                  }
                }}
              />
            )}
            <ExpandButton
              expanded={expanded}
              onClick={onToggle}
              label={t('kpi.template.action.view')}
            />
          </RowActions>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={7} className="px-5 py-3">
            {/* The questions, framed like the lines of a claim: a table of its own inside the row. */}
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/70">
                  <tr className="border-b border-slate-200 text-left text-[11px] tracking-wide text-slate-500 uppercase">
                    <th scope="col" className="px-3 py-2 font-medium">
                      <T k="kpi.template.form.item.competency" />
                    </th>
                    <th scope="col" className="w-28 px-3 py-2 text-right font-medium">
                      <T k="kpi.template.form.item.weight" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {row.items.map((item) => (
                    <tr key={item.id ?? item.sortOrder} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2 text-slate-800">
                        <span className="block">
                          {item.competencyName}
                          {item.category !== null && (
                            <span className="ml-1.5 text-xs text-slate-400">
                              <T k={CATEGORY_LABELS[item.category]} />
                            </span>
                          )}
                        </span>
                        {item.description !== null && (
                          <span className="block text-xs text-slate-500">{item.description}</span>
                        )}
                        {item.competencyRetired === true && (
                          <span className="block text-xs text-amber-700">
                            <T k="kpi.template.retiredItem" />
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-700">
                        {item.weight.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/*
              Every fault at once, from the server. Not just the first: a banner that reveals its
              second problem only after you fix the first is a banner people stop reading.
            */}
            {row.faults.length > 0 && (
              <PanelNote tone="warn" className="mt-3">
                <ul className="list-disc space-y-0.5 pl-4">
                  {row.faults.map((fault, index) => (
                    <li key={index}>
                      <T k={fault.key} vars={fault.vars} />
                    </li>
                  ))}
                </ul>
              </PanelNote>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

interface DraftItem {
  /** Client-side identity, so removing a line from the middle does not shift the inputs below. */
  key: string;
  competencyId: string;
  description: string;
  weight: string;
  /**
   * The stored wording of a competency since deactivated in the catalogue, or null.
   *
   * The picker only offers active entries, so without this the select showed its placeholder while
   * the line still held the retired id — and the save was refused naming a competency the screen
   * did not show.
   */
  retiredName: string | null;
}

let draftCounter = 0;
function draftItem(patch: Partial<Omit<DraftItem, 'key'>> = {}): DraftItem {
  draftCounter += 1;
  return {
    key: `kpi-item-${String(draftCounter)}`,
    competencyId: '',
    description: '',
    weight: '',
    retiredName: null,
    ...patch,
  };
}

function TemplateDialog({
  target,
  options,
  onClose,
  onDone,
}: {
  target: KpiTemplate | null;
  options: CompetencyOption[];
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [code, setCode] = useState(target?.code ?? '');
  const [name, setName] = useState(target?.name ?? '');
  const [description, setDescription] = useState(target?.description ?? '');
  const [active, setActive] = useState(target?.active ?? true);
  const [items, setItems] = useState<DraftItem[]>(
    target === null
      ? [draftItem()]
      : target.items.map((item) =>
          draftItem({
            competencyId: item.competencyId === null ? '' : String(item.competencyId),
            description: item.description ?? '',
            weight: String(item.weight),
            retiredName: item.competencyRetired === true ? item.competencyName : null,
          }),
        ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const inUse = (target?.assignmentCount ?? 0) > 0;

  /*
   * The running total, shown live.
   *
   * The server refuses a form that does not sum to 100, and finding that out on save means
   * re-deriving which competency to adjust. Showing it while editing turns the rule into something
   * the form helps satisfy.
   */
  const total =
    Math.round(items.reduce((sum, item) => sum + (Number(item.weight) || 0), 0) * 100) / 100;
  const balanced = weightsBalanced(total);

  /** Ids already chosen, so the same competency cannot be picked twice. */
  const taken = useMemo(
    () => new Set(items.map((item) => item.competencyId).filter((value) => value !== '')),
    [items],
  );

  /**
   * The name of a competency chosen twice, or null.
   *
   * Defensive: the picker already disables an entry once it is taken, and the database has a unique
   * index across `(templateId, competencyId)`. It stays because the check is two lines and the
   * failure it catches — one competency weighted twice, reading as two questions — is invisible in
   * a list of rows.
   */
  const duplicateName = useMemo((): string | null => {
    const seen = new Set<string>();
    for (const item of items) {
      if (item.competencyId === '') continue;
      if (seen.has(item.competencyId)) {
        return (
          options.find((option) => String(option.id) === item.competencyId)?.name ??
          item.competencyId
        );
      }
      seen.add(item.competencyId);
    }
    return null;
  }, [items, options]);

  /**
   * The first line still holding a retired competency, by its stored wording.
   *
   * The server refuses to save a form that asks about one, so the save is blocked here with the
   * same reason and the line is outlined.
   */
  const retired = items.find((item) => item.retiredName !== null)?.retiredName ?? null;

  const setItem = (key: string, patch: Partial<DraftItem>): void => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const equalise = (): void => {
    const weights = equaliseWeights(items.length);
    setItems((current) =>
      current.map((item, index) => ({ ...item, weight: String(weights[index] ?? 0) })),
    );
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        /*
          Sent even when empty, because empty is what clears it. The route reads `''` as "none"
          and an absent key as "leave as it was".
        */
        description: description.trim(),
        active,
        items: items.map((item) => ({
          competencyId: Number(item.competencyId),
          ...(item.description === '' ? {} : { description: item.description }),
          weight: Number(item.weight),
        })),
      };

      if (target === null) await kpiApi.createTemplate(payload);
      else await kpiApi.updateTemplate(target.id, payload);

      await onDone(t('kpi.template.saved', { code: payload.code }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  const complete =
    code.trim() !== '' &&
    name.trim() !== '' &&
    items.length > 0 &&
    items.every((item) => item.competencyId !== '' && Number(item.weight) > 0);

  const titleKey = target === null ? 'kpi.template.form.create' : 'kpi.template.form.edit';

  return (
    <Dialog
      title={<T k={titleKey} />}
      titleText={t(titleKey)}
      /*
        A form in use can be edited now, and saying so matters: it used to be refused, so anybody
        who learned that rule would not try. The caveat sits where the decision is made.
      */
      {...(inUse ? { description: <T k="kpi.template.note.editable" /> } : {})}
      width="2xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/* Identity first: the code somebody types, then the name they read. */}
        <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
          <Field
            label={<T k="kpi.template.form.code" />}
            value={code}
            maxLength={24}
            autoFocus
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <Field
            label={<T k="kpi.template.form.name" />}
            value={name}
            maxLength={190}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="grid items-start gap-4 sm:grid-cols-[1fr_12rem]">
          <TextArea
            label={<T k="kpi.template.form.description" />}
            hint={<T k="app.description.hint" />}
            rows={2}
            value={description}
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
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

        {/* ── The competencies ── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">
              <T k="kpi.template.form.items" />
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              <T k="kpi.template.note.catalogue" />
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/*
              "Make these equal" is what somebody actually wants from a form builder, and doing it
              by hand across seven rows is where the sum stops being 100.
            */}
            <Button variant="ghost" onClick={equalise} title={t('kpi.template.form.equalise.hint')}>
              <Scale className="size-4" aria-hidden />
              <T k="kpi.template.form.equalise" />
            </Button>
            <Button
              variant="ghost"
              onClick={() => setItems((current) => [...current, draftItem()])}
              disabled={items.length >= options.length}
            >
              <Plus className="size-4" aria-hidden />
              <T k="kpi.template.form.item.add" />
            </Button>
          </div>
        </div>

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="space-y-2 pb-2">
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/70">
                <tr className="border-b border-slate-200 text-left text-[11px] tracking-wide text-slate-500 uppercase">
                  <th scope="col" className="px-3 py-2 font-medium">
                    <T k="kpi.template.form.item.competency" />
                  </th>
                  <th scope="col" className="w-32 px-2 py-2 font-medium">
                    <T k="kpi.template.form.item.weight" />
                  </th>
                  <th scope="col" className="w-12 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.key} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2">
                      {/*
                        A bare select with the column heading as its visible label. Each row gets
                        its accessible name from the same words, so a screen reader hears which
                        column it is in.
                      */}
                      <select
                        aria-label={t('kpi.template.form.item.competency')}
                        value={item.competencyId}
                        onChange={(event) =>
                          setItem(item.key, { competencyId: event.target.value, retiredName: null })
                        }
                        className={cn(
                          'w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-800',
                          item.retiredName === null ? 'border-slate-300' : 'border-amber-400',
                        )}
                      >
                        <option value="">{t('kpi.template.form.item.competency.placeholder')}</option>
                        {/*
                          The retired entry the line still holds, shown so the select says what is
                          stored. Not selectable again once something else is picked.
                        */}
                        {item.retiredName !== null && (
                          <option value={item.competencyId} disabled>
                            {item.retiredName}
                          </option>
                        )}
                        {options.map((option) => (
                          <option
                            key={option.id}
                            value={String(option.id)}
                            /*
                             * Already-chosen entries are offered but not selectable, rather than
                             * removed. A dropdown whose contents shift as you fill the form above it
                             * makes the list feel unreliable.
                             */
                            disabled={
                              taken.has(String(option.id)) && item.competencyId !== String(option.id)
                            }
                          >
                            {`${option.name} — ${t(CATEGORY_LABELS[option.category])}`}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        aria-label={t('kpi.template.form.item.weight')}
                        type="number"
                        step="0.01"
                        min={0}
                        max={100}
                        value={item.weight}
                        onChange={(event) => setItem(item.key, { weight: event.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-right text-sm tabular-nums text-slate-800"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      {/* The last competency cannot be removed: a form with none scores nothing. */}
                      <RowAction
                        icon={<Trash2 className="size-4" aria-hidden />}
                        label={
                          items.length === 1
                            ? t('kpi.template.form.item.lastRow')
                            : t('kpi.template.form.item.remove')
                        }
                        tone="danger"
                        disabled={items.length === 1}
                        onClick={() =>
                          setItems((current) => current.filter((row) => row.key !== item.key))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* The total on a tinted strip, because it is what the save is refused on. */}
          <div
            className={cn(
              'flex flex-wrap items-baseline justify-between gap-2 rounded-lg border px-3 py-2.5',
              balanced
                ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
                : 'border-rose-200 bg-rose-50 text-rose-900',
            )}
          >
            <span className="text-sm font-medium">
              <T k="kpi.template.column.weight" />
            </span>
            <span className="text-sm font-semibold tabular-nums">
              <T
                k={balanced ? 'kpi.template.form.total.ok' : 'kpi.template.form.total'}
                vars={{ total: total.toFixed(2) }}
              />
            </span>
          </div>

          {duplicateName !== null && (
            <PanelNote tone="warn">
              <T k="kpi.audit.duplicateCompetency" vars={{ name: duplicateName }} />
            </PanelNote>
          )}

          {retired !== null && (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="kpi.template.form.retired" vars={{ name: retired }} />
            </PanelNote>
          )}
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          // Refused client-side as well, so the balance rule reads as part of the form rather
          // than as a server that says no.
          disabled={!complete || !balanced || duplicateName !== null || retired !== null}
          {...(retired !== null
            ? { submitTitle: t('kpi.template.form.retired', { name: retired }) }
            : complete && !balanced
              ? { submitTitle: t('kpi.template.form.total', { total: total.toFixed(2) }) }
              : {})}
          submitLabel={<T k="dialog.save" />}
        />
      </div>
    </Dialog>
  );
}
