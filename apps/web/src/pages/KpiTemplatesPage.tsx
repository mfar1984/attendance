import {
  CircleAlert,
  ClipboardList,
  Plus,
  Scale,
  SquarePen,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  ExpandButton,
  PanelBody,
  PanelCard,
  PanelNote,
  PanelSection,
  RecordTable,
  RowAction,
  RowActions,
} from '../components/RecordPanel';
import { Button, Field } from '../components/ui';
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
 */
export function KpiTemplatesPage(): ReactNode {
  const [rows, setRows] = useState<KpiTemplate[]>([]);
  const [options, setOptions] = useState<CompetencyOption[]>([]);
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

  return (
    <PanelCard title={<T k="kpi.template.title" />} subtitle={<T k="kpi.template.subtitle" />}>
      <PanelSection
        icon={<ClipboardList className="size-4" aria-hidden />}
        title={<T k="kpi.template.title" />}
        action={
          can(SCREEN, 'create') ? (
            <Button onClick={() => setEditing('new')} disabled={options.length === 0}>
              <Plus className="size-4" aria-hidden />
              <T k="kpi.template.action.new" />
            </Button>
          ) : undefined
        }
      />

      <PanelBody className="space-y-2 pb-0">
        <Feedback error={error} notice={notice} />

        {/*
          The catalogue being empty is a blocking condition stated where it blocks, not a dropdown
          that silently offers nothing.
        */}
        {!loading && options.length === 0 && (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="kpi.template.form.catalogueEmpty" />
          </PanelNote>
        )}

        <PanelNote icon={<CircleAlert className="size-3.5" aria-hidden />}>
          <T k="kpi.template.note.editable" />
        </PanelNote>
        <PanelNote>
          <T k="kpi.template.note.catalogue" />
        </PanelNote>
      </PanelBody>

      <RecordTable
        loading={loading}
        rowCount={rows.length}
        empty={<T k="kpi.template.empty" />}
        columns={[
          { header: <T k="kpi.template.column.code" />, width: 'w-32' },
          { header: <T k="kpi.template.column.name" /> },
          { header: <T k="kpi.template.column.items" />, width: 'w-28', align: 'right' },
          { header: <T k="kpi.template.column.weight" />, width: 'w-40', align: 'right' },
          { header: <T k="kpi.template.column.used" />, width: 'w-24', align: 'right' },
          { header: <T k="panel.column.actions" />, width: 'w-32', align: 'right' },
        ]}
      >
        {rows.map((row) => (
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
          // A form whose weights no longer sum to 100 would be refused when it is assigned; tone it
          // so the eye finds it before it reads the number.
          !balanced && 'bg-rose-50/40',
          !row.active && 'text-slate-400',
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
        <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-700">
          {row.items.length}
        </td>
        <td className="px-2 py-2 text-right text-xs tabular-nums">
          {balanced ? (
            <span className="text-slate-700">100%</span>
          ) : (
            <span className="font-medium text-rose-700">
              <T k="kpi.template.weightOff" vars={{ total: row.weightTotal.toFixed(2) }} />
            </span>
          )}
        </td>
        <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-500">
          {row.assignmentCount}
        </td>
        <td className="px-2 py-2 pr-4">
          <RowActions>
            {can(SCREEN, 'edit') && (
              <RowAction
                icon={<SquarePen className="size-4" aria-hidden />}
                label={t('kpi.template.action.edit')}
                onClick={onEdit}
              />
            )}
            {can(SCREEN, 'delete') && (
              <RowAction
                icon={<Trash2 className="size-4" aria-hidden />}
                label={t('kpi.template.action.delete')}
                tone="danger"
                disabled={inUse}
                onClick={async () => {
                  try {
                    await kpiApi.deleteTemplate(row.id);
                    await onChanged(`${row.code} dibuang.`);
                  } catch (cause) {
                    onError(cause instanceof Error ? cause.message : '');
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
          <td colSpan={6} className="px-5 py-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] tracking-wide text-slate-500 uppercase">
                  <th className="pb-1">
                    <T k="kpi.template.form.item.competency" />
                  </th>
                  <th className="w-24 pb-1 text-right">
                    <T k="kpi.template.form.item.weight" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {row.items.map((item) => (
                  <tr key={item.id ?? item.sortOrder} className="border-t border-slate-200">
                    <td className="py-1.5 text-slate-700">
                      <span className="block">
                        {item.competencyName}
                        {item.category !== null && (
                          <span className="ml-1.5 text-[11px] text-slate-400">
                            <T k={CATEGORY_LABELS[item.category]} />
                          </span>
                        )}
                      </span>
                      {item.description !== null && (
                        <span className="block text-[11px] text-slate-400">{item.description}</span>
                      )}
                      {item.competencyRetired === true && (
                        <span className="block text-[11px] text-amber-700">
                          <T k="kpi.template.retiredItem" />
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-slate-700">
                      {item.weight.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

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

            {inUse && (
              <PanelNote className="mt-2">
                <T k="kpi.template.note.editable" />
              </PanelNote>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

interface DraftItem {
  competencyId: string;
  description: string;
  weight: string;
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
      ? [{ competencyId: '', description: '', weight: '' }]
      : target.items.map((item) => ({
          competencyId: item.competencyId === null ? '' : String(item.competencyId),
          description: item.description ?? '',
          weight: String(item.weight),
        })),
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

  const setItem = (index: number, patch: Partial<DraftItem>): void => {
    setItems((current) =>
      current.map((item, position) => (position === index ? { ...item, ...patch } : item)),
    );
  };

  const equalise = (): void => {
    const weights = equaliseWeights(items.length);
    setItems((current) =>
      current.map((item, index) => ({ ...item, weight: String(weights[index] ?? 0) })),
    );
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const payload = {
        code,
        name,
        ...(description === '' ? {} : { description }),
        active,
        items: items.map((item) => ({
          competencyId: Number(item.competencyId),
          ...(item.description === '' ? {} : { description: item.description }),
          weight: Number(item.weight),
        })),
      };

      if (target === null) await kpiApi.createTemplate(payload);
      else await kpiApi.updateTemplate(target.id, payload);

      await onDone(`${code.toUpperCase()} disimpan.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  const complete =
    code.trim() !== '' &&
    name.trim() !== '' &&
    items.length > 0 &&
    items.every((item) => item.competencyId !== '' && Number(item.weight) > 0);

  return (
    <Dialog
      title={<T k="kpi.template.form.title" />}
      titleText={t('kpi.template.form.title')}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/*
          A form in use can be edited now, and saying so matters: it used to be refused, so anybody
          who learned that rule would not try.
        */}
        {inUse && (
          <PanelNote icon={<CircleAlert className="size-3.5" aria-hidden />}>
            <T k="kpi.template.note.editable" />
          </PanelNote>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k="kpi.template.form.code" />}
            value={code}
            maxLength={24}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <Field
            label={<T k="kpi.template.form.name" />}
            value={name}
            maxLength={190}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <Field
          label={<T k="kpi.template.form.description" />}
          value={description}
          maxLength={500}
          onChange={(event) => setDescription(event.target.value)}
        />

        <div>
          <p className="text-sm font-medium text-slate-700">
            <T k="kpi.template.form.items" />
          </p>

          <div className="mt-2 space-y-2">
            {items.map((item, index) => (
              <div key={index} className="flex items-start gap-2">
                <div className="flex-1">
                  <label className="sr-only" htmlFor={`item-competency-${String(index)}`}>
                    <T k="kpi.template.form.item.competency" />
                  </label>
                  <select
                    id={`item-competency-${String(index)}`}
                    value={item.competencyId}
                    onChange={(event) => setItem(index, { competencyId: event.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="">{t('kpi.template.form.item.competency.placeholder')}</option>
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
                </div>
                <div className="w-28">
                  <Field
                    label={<span className="sr-only">{t('kpi.template.form.item.weight')}</span>}
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    value={item.weight}
                    placeholder="%"
                    onChange={(event) => setItem(index, { weight: event.target.value })}
                  />
                </div>
                <button
                  type="button"
                  aria-label={t('kpi.template.form.item.remove')}
                  title={t('kpi.template.form.item.remove')}
                  // The last competency cannot be removed: a form with none scores nothing.
                  disabled={items.length === 1}
                  onClick={() =>
                    setItems((current) => current.filter((_, position) => position !== index))
                  }
                  className="mt-1 rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                onClick={() =>
                  setItems((current) => [
                    ...current,
                    { competencyId: '', description: '', weight: '' },
                  ])
                }
                disabled={items.length >= options.length}
              >
                <Plus className="size-4" aria-hidden />
                <T k="kpi.template.form.item.add" />
              </Button>
              {/*
                "Make these equal" is what somebody actually wants from a form builder, and doing it
                by hand across seven rows is where the sum stops being 100.
              */}
              <Button variant="ghost" onClick={equalise} title={t('kpi.template.form.equalise.hint')}>
                <Scale className="size-4" aria-hidden />
                <T k="kpi.template.form.equalise" />
              </Button>
            </div>

            <span
              className={cn(
                'text-xs font-medium tabular-nums',
                balanced ? 'text-emerald-700' : 'text-rose-700',
              )}
            >
              <T
                k={balanced ? 'kpi.template.form.total.ok' : 'kpi.template.form.total'}
                vars={{ total: total.toFixed(2) }}
              />
            </span>
          </div>

          {duplicateName !== null && (
            <PanelNote tone="warn" className="mt-2">
              <T k="kpi.audit.duplicateCompetency" vars={{ name: duplicateName }} />
            </PanelNote>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />
          <T k="kpi.template.form.active" />
        </label>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          // Refused client-side as well, so the balance rule reads as part of the form rather
          // than as a server that says no.
          disabled={!complete || !balanced || duplicateName !== null}
          submitLabel={<T k="dialog.save" />}
        />
      </div>
    </Dialog>
  );
}
