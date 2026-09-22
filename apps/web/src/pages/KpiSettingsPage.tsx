import {
  Bell,
  CircleAlert,
  CircleCheck,
  Eye,
  EyeOff,
  Layers,
  Mail,
  Pencil,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
  Trophy,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import { EmailTemplates } from '../components/EmailTemplates';
import { ModuleNotifications } from '../components/ModuleNotifications';
import {
  ChipBar,
  PanelActions,
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
import { Button, Field } from '../components/ui';
import { useAuth } from '../lib/auth';
import {
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  kpiApi,
  type Competency,
  type CompetencyCategory,
  type Fault,
  type GradePayload,
  type KpiGrade,
} from '../lib/kpi-api';
import { T, useLabels } from '../lib/translation';

const SCREEN = 'hr.kpiSettings';

/**
 * KPI settings: the competency catalogue, the grade bands, and who gets told.
 *
 * Four tabs and no approval flow. An appraisal moves through scoring rather than through
 * signatures — there is no rung anybody is on, so a chain here would configure nothing. Stated on
 * the screen rather than left as an absence somebody has to notice.
 */
export function KpiSettingsPage(): ReactNode {
  const [tab, setTab] = useState('competencies');
  const { t } = useLabels();

  return (
    <PanelCard title={<T k="kpi.grade.title" />} subtitle={<T k="kpi.grade.subtitle" />}>
      <PanelTabs
        label={t('kpi.grade.title')}
        active={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'competencies',
            label: <T k="kpi.settings.tab.competencies" />,
            labelText: t('kpi.settings.tab.competencies'),
            icon: <Layers className="size-4" aria-hidden />,
          },
          {
            id: 'grades',
            label: <T k="kpi.settings.tab.grades" />,
            labelText: t('kpi.settings.tab.grades'),
            icon: <Trophy className="size-4" aria-hidden />,
          },
          {
            id: 'notify',
            label: <T k="hr.notify.tab" />,
            labelText: t('hr.notify.tab'),
            icon: <Bell className="size-4" aria-hidden />,
          },
          {
            id: 'templates',
            label: <T k="hr.template.tab" />,
            labelText: t('hr.template.tab'),
            icon: <Mail className="size-4" aria-hidden />,
          },
        ]}
      />

      {tab === 'competencies' && <CompetenciesTab />}
      {tab === 'grades' && <GradesTab />}
      {tab === 'notify' && <ModuleNotifications module="kpi" screen={SCREEN} />}
      {tab === 'templates' && <EmailTemplates module="kpi" screen={SCREEN} />}
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Competencies
// ---------------------------------------------------------------------------

interface CompetencyDraft {
  id: number | null;
  name: string;
  category: CompetencyCategory;
  description: string;
  active: boolean;
}

const EMPTY_COMPETENCY: CompetencyDraft = {
  id: null,
  name: '',
  category: 'core',
  description: '',
  active: true,
};

/**
 * The catalogue every form picks its questions from.
 *
 * A full record screen rather than a list of text fields, because the two columns that matter are
 * the ones free text could never have produced: which category a competency belongs to, and how
 * many forms ask about it. The second is what makes retiring one a decision.
 */
function CompetenciesTab(): ReactNode {
  const [rows, setRows] = useState<Competency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<CompetencyDraft | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const { t } = useLabels();
  const { can } = useAuth();

  const mayEdit = can(SCREEN, 'edit');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await kpiApi.competencies());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('kpi.competency.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Chip counts ignore the chip filter, so picking one does not zero the others.
   *
   * Otherwise the remaining chips read as "there are none of those", when what happened is that
   * the list is filtered.
   */
  const chips = useMemo(
    () =>
      CATEGORY_ORDER.map((value) => ({
        id: value,
        label: <T k={CATEGORY_LABELS[value]} />,
        count: rows.filter((row) => row.category === value).length,
        dot: 'bg-slate-400',
      })),
    [rows],
  );

  const filtered = useMemo(
    () => (category === undefined ? rows : rows.filter((row) => row.category === category)),
    [rows, category],
  );

  const shown = filtered.slice((page - 1) * pageSize, page * pageSize);

  const submit = async (): Promise<void> => {
    if (editing === null) return;
    try {
      if (editing.id === null) {
        await kpiApi.createCompetency({
          name: editing.name,
          category: editing.category,
          description: editing.description,
          active: editing.active,
        });
        setNotice(t('kpi.competency.saved'));
      } else {
        const before = rows.find((row) => row.id === editing.id);
        await kpiApi.updateCompetency(editing.id, {
          name: editing.name,
          category: editing.category,
          description: editing.description,
          active: editing.active,
        });
        /*
         * A rename reports how far it reached.
         *
         * The forms that ask about this competency follow the new wording; appraisals already
         * created keep the words that were put to the person. Both are correct and neither is
         * obvious from pressing Save, so the count is stated rather than left to be discovered.
         */
        setNotice(
          before !== undefined && before.name !== editing.name
            ? t('kpi.competency.renamed', { count: before.templateCount })
            : t('kpi.competency.saved'),
        );
      }
      setEditing(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
    }
  };

  /** Retiring — which is what the delete refusal tells somebody to do instead. */
  const toggleActive = async (row: Competency): Promise<void> => {
    try {
      await kpiApi.updateCompetency(row.id, { active: !row.active });
      setNotice(t('kpi.competency.saved'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
    }
  };

  const remove = async (row: Competency): Promise<void> => {
    try {
      await kpiApi.deleteCompetency(row.id);
      setNotice(t('kpi.competency.removed'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
    }
  };

  return (
    <>
      <PanelSection
        title={<T k="kpi.competency.title" />}
        subtitle={<T k="kpi.competency.subtitle" />}
        action={
          mayEdit ? (
            <Button onClick={() => setEditing(EMPTY_COMPETENCY)}>
              <Plus className="size-4" aria-hidden />
              <T k="kpi.competency.action.new" />
            </Button>
          ) : undefined
        }
      />

      <ChipBar chips={chips} active={category} onChange={setCategory} />

      <PanelBody className="space-y-2 pb-0">
        <Feedback error={error} notice={notice} />
        <PanelNote icon={<CircleAlert className="size-3.5" aria-hidden />}>
          <T k="kpi.competency.note.retire" />
        </PanelNote>
        {/*
          The missing tab, named. An absence nobody explains reads as an oversight, and the next
          person to notice it adds the chain back.
        */}
        <PanelNote>
          <T k="kpi.settings.note.noChain" />
        </PanelNote>
      </PanelBody>

      <RecordTable
        columns={[
          { header: <T k="kpi.competency.column.name" /> },
          { header: <T k="kpi.competency.column.category" /> },
          { header: <T k="kpi.competency.column.used" />, align: 'right' },
          { header: <T k="panel.column.status" /> },
          { header: <T k="panel.column.actions" />, align: 'right' },
        ]}
        loading={loading}
        rowCount={shown.length}
        empty={<T k="kpi.competency.empty" />}
      >
        {shown.map((row) => (
          <tr
            key={row.id}
            // Toned before the status column is read: a retired competency still on forms is
            // something to notice, not something to find.
            className={row.active ? undefined : 'bg-amber-50/40'}
          >
            <td className="px-5 py-2.5">
              <p className="font-medium text-slate-900">{row.name}</p>
              {row.description !== null && (
                <p className="mt-0.5 text-xs text-slate-500">{row.description}</p>
              )}
            </td>
            <td className="px-2 py-2.5 text-slate-600">
              <T k={CATEGORY_LABELS[row.category]} />
            </td>
            <td className="px-2 py-2.5 text-right tabular-nums text-slate-600">
              {row.templateCount === 0 ? (
                <span className="text-slate-400">
                  <T k="kpi.competency.used.none" />
                </span>
              ) : (
                <T k="kpi.competency.used" vars={{ count: row.templateCount }} />
              )}
            </td>
            <td className="px-2 py-2.5">
              <span
                className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium uppercase ${
                  row.active ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                }`}
              >
                {row.active ? <T k="app.status.active" /> : <T k="kpi.competency.inactive" />}
              </span>
            </td>
            <td className="px-2 py-2.5">
              <RowActions>
                {mayEdit && (
                  <RowAction
                    icon={<Pencil className="size-4" aria-hidden />}
                    label={t('kpi.competency.action.edit')}
                    onClick={() =>
                      setEditing({
                        id: row.id,
                        name: row.name,
                        category: row.category,
                        description: row.description ?? '',
                        active: row.active,
                      })
                    }
                  />
                )}
                {mayEdit && (
                  <RowAction
                    icon={
                      row.active ? (
                        <EyeOff className="size-4" aria-hidden />
                      ) : (
                        <Eye className="size-4" aria-hidden />
                      )
                    }
                    tone={row.active ? 'warn' : 'success'}
                    label={
                      row.active
                        ? t('kpi.competency.action.deactivate')
                        : t('kpi.competency.action.activate')
                    }
                    onClick={() => void toggleActive(row)}
                  />
                )}
                {mayEdit && (
                  <RowAction
                    icon={<Trash2 className="size-4" aria-hidden />}
                    tone="danger"
                    /*
                     * Disabled with the reason in the label, not enabled and then a 409.
                     *
                     * `RowAction` has no separate reason slot on purpose: the tooltip and the
                     * accessible name are the same string, so the reason has to live in the label
                     * or it does not reach a screen reader at all.
                     */
                    label={
                      row.templateCount > 0
                        ? t('kpi.competency.note.inUse')
                        : t('kpi.competency.action.delete')
                    }
                    disabled={row.templateCount > 0}
                    onClick={() => void remove(row)}
                  />
                )}
              </RowActions>
            </td>
          </tr>
        ))}
      </RecordTable>

      <PanelFooter
        shown={shown.length}
        total={filtered.length}
        page={page}
        pageSize={pageSize}
        loading={loading}
        onPage={setPage}
        onPageSize={setPageSize}
        onRefresh={load}
      />

      {editing !== null && (
        <Dialog
          title={<T k="kpi.competency.form.title" />}
          titleText={t('kpi.competency.form.title')}
          onClose={() => setEditing(null)}
        >
          <div className="space-y-4">
            <Field
              label={<T k="kpi.competency.form.name" />}
              hint={<T k="kpi.competency.form.name.hint" />}
              value={editing.name}
              maxLength={190}
              onChange={(event) => setEditing({ ...editing, name: event.target.value })}
            />

            <div>
              <label
                className="mb-1 block text-xs font-medium text-slate-600"
                htmlFor="competency-category"
              >
                <T k="kpi.competency.form.category" />
              </label>
              <select
                id="competency-category"
                value={editing.category}
                onChange={(event) =>
                  setEditing({ ...editing, category: event.target.value as CompetencyCategory })
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                {CATEGORY_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {t(CATEGORY_LABELS[value])}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                <T k={CATEGORY_HINTS[editing.category]} />
              </p>
            </div>

            <Field
              label={<T k="kpi.competency.form.description" />}
              hint={<T k="kpi.competency.form.description.hint" />}
              value={editing.description}
              maxLength={500}
              onChange={(event) => setEditing({ ...editing, description: event.target.value })}
            />

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(event) => setEditing({ ...editing, active: event.target.checked })}
              />
              <T k="kpi.competency.form.active" />
            </label>

            <PanelNote>
              <T k="kpi.competency.form.category.hint" />
            </PanelNote>

            <DialogFooter
              onClose={() => setEditing(null)}
              onSubmit={() => void submit()}
              submitLabel={<T k="dialog.save" />}
              closeLabel={<T k="dialog.cancel" />}
              disabled={editing.name.trim() === ''}
            />
          </div>
        </Dialog>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Grade bands
// ---------------------------------------------------------------------------

interface GradeDraft {
  code: string;
  name: string;
  minScore: string;
  maxScore: string;
  bonusMonths: string;
  color: string;
}

/** The palette the colour picker offers. Green through red, so a distribution is scanned. */
const PALETTE = [
  '#16a34a',
  '#3b82f6',
  '#f59e0b',
  '#f97316',
  '#ef4444',
  '#8b5cf6',
  '#0891b2',
  '#64748b',
];

const EMPTY_GRADE: GradeDraft = {
  code: '',
  name: '',
  minScore: '',
  maxScore: '',
  bonusMonths: '',
  color: '#64748b',
};

function toDraft(grade: KpiGrade): GradeDraft {
  return {
    code: grade.code,
    name: grade.name,
    minScore: String(grade.minScore),
    maxScore: String(grade.maxScore),
    bonusMonths: grade.bonusMonths === null ? '' : String(grade.bonusMonths),
    color: grade.color,
  };
}

/**
 * Grades and their score bands.
 *
 * A table with row actions and a modal, not a stack of field rows. It was the stack, and it was the
 * one screen in the application that ignored the record-panel convention: five bands meant thirty
 * inputs on the page at once, and the coverage rule they have to satisfy together was impossible to
 * read off them. A table shows the bands as a range somebody can scan for a gap.
 *
 * Saved as one set, because bands are only valid together. A per-grade save would let somebody
 * store a legitimate band that leaves a gap — and a gap only surfaces when a reviewer submits an
 * assessment and is refused, at which point they cannot fix it.
 */
function GradesTab(): ReactNode {
  const [payload, setPayload] = useState<GradePayload | null>(null);
  const [grades, setGrades] = useState<GradeDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ index: number | null; draft: GradeDraft } | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const mayEdit = can(SCREEN, 'edit');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await kpiApi.grades();
      setPayload(result);
      setGrades(result.grades.map(toDraft));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('kpi.grade.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Coverage audited locally as well as on the server.
   *
   * The same rule in two places is a cost, and the alternative is worse: finding out on save that
   * the set leaves a gap, without being told which pair. Every fault is listed rather than the
   * first, because a banner that reveals its second problem only after you fix the first is a
   * banner people stop reading.
   */
  const localFaults = useMemo((): Fault[] => {
    const parsed = grades.map((grade) => ({
      code: grade.code.toUpperCase(),
      min: Number(grade.minScore),
      max: Number(grade.maxScore),
    }));
    if (parsed.length === 0) return [{ key: 'kpi.refuse.noBands' }];

    const faults: Fault[] = [];
    for (const band of parsed) {
      if (!Number.isFinite(band.min) || !Number.isFinite(band.max)) {
        faults.push({ key: 'kpi.refuse.badBand', vars: { code: band.code } });
      } else if (band.min > band.max) {
        faults.push({ key: 'kpi.refuse.bandOrder', vars: { code: band.code } });
      } else if (band.min < 0 || band.max > 100) {
        faults.push({ key: 'kpi.refuse.bandRange', vars: { code: band.code } });
      }
    }
    if (faults.length > 0) return faults;

    const seen = new Set<string>();
    for (const band of parsed) {
      if (seen.has(band.code)) {
        faults.push({ key: 'kpi.refuse.bandDuplicate', vars: { code: band.code } });
      }
      seen.add(band.code);
    }

    const sorted = [...parsed].sort((left, right) => left.min - right.min);
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    if (first.min !== 0) {
      faults.push({ key: 'kpi.refuse.bandStart', vars: { lowest: first.min.toFixed(2) } });
    }
    if (last.max !== 100) {
      faults.push({ key: 'kpi.refuse.bandEnd', vars: { highest: last.max.toFixed(2) } });
    }

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]!;
      const current = sorted[index]!;
      if (current.min <= previous.max) {
        faults.push({
          key: 'kpi.refuse.bandOverlap',
          vars: { first: previous.code, second: current.code },
        });
        continue;
      }
      if (Math.round((current.min - previous.max) * 100) / 100 > 0.01) {
        faults.push({
          key: 'kpi.refuse.bandGap',
          vars: {
            first: previous.code,
            second: current.code,
            from: (Math.round((previous.max + 0.01) * 100) / 100).toFixed(2),
            to: (Math.round((current.min - 0.01) * 100) / 100).toFixed(2),
          },
        });
      }
    }
    return faults;
  }, [grades]);

  /** Sorted for display: highest band first, the way a grade table is read. */
  const ordered = useMemo(
    () =>
      grades
        .map((grade, index) => ({ grade, index }))
        .sort((left, right) => Number(right.grade.minScore) - Number(left.grade.minScore)),
    [grades],
  );

  const dirty = useMemo(() => {
    if (payload === null) return false;
    const saved = JSON.stringify(payload.grades.map(toDraft));
    return saved !== JSON.stringify(grades);
  }, [payload, grades]);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await kpiApi.saveGrades(
        grades.map((grade) => ({
          code: grade.code,
          name: grade.name,
          minScore: Number(grade.minScore),
          maxScore: Number(grade.maxScore),
          bonusMonths: grade.bonusMonths === '' ? null : Number(grade.bonusMonths),
          color: grade.color,
        })),
      );
      setNotice(t('kpi.grade.saved'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
    } finally {
      setBusy(false);
    }
  };

  const complete = grades.every(
    (grade) =>
      grade.code.trim() !== '' &&
      grade.name.trim() !== '' &&
      grade.minScore !== '' &&
      grade.maxScore !== '',
  );

  const maxBonus = payload?.maxBonusMonths ?? 12;

  return (
    <>
      <PanelSection
        title={<T k="kpi.settings.tab.grades" />}
        subtitle={<T k="kpi.grade.subtitle" />}
        action={
          mayEdit ? (
            <Button onClick={() => setEditing({ index: null, draft: EMPTY_GRADE })}>
              <Plus className="size-4" aria-hidden />
              <T k="kpi.grade.action.add" />
            </Button>
          ) : undefined
        }
      />

      <PanelBody className="space-y-2 pb-0">
        <Feedback error={error} notice={notice} />

        {/*
          The stored set's faults, from the server, before anything is edited. A gap that is already
          saved is refusing submissions right now.
        */}
        {payload !== null && payload.faults.length > 0 && !dirty && (
          <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <span className="block font-medium">
              <T k="kpi.grade.faults" />
            </span>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {payload.faults.map((fault, index) => (
                <li key={index}>
                  <T k={fault.key} vars={fault.vars} />
                </li>
              ))}
            </ul>
          </PanelNote>
        )}

        <PanelNote icon={<CircleAlert className="size-3.5" aria-hidden />}>
          <T k="kpi.grade.note.set" />
        </PanelNote>
        <PanelNote>
          <T k="kpi.grade.note.boundary" />
        </PanelNote>
        <PanelNote>
          <T k="kpi.grade.note.history" />
        </PanelNote>
      </PanelBody>

      <RecordTable
        columns={[
          { header: <T k="kpi.grade.column.code" /> },
          { header: <T k="kpi.grade.column.name" /> },
          { header: <T k="kpi.grade.column.band" />, align: 'right' },
          { header: <T k="kpi.grade.column.bonus" />, align: 'right' },
          { header: <T k="panel.column.actions" />, align: 'right' },
        ]}
        loading={loading}
        rowCount={ordered.length}
        empty={<T k="kpi.grade.empty" />}
      >
        {ordered.map(({ grade, index }) => (
          <tr key={index}>
            <td className="px-5 py-2.5">
              <span
                className="inline-flex min-w-8 justify-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase text-white"
                style={{ backgroundColor: grade.color }}
              >
                {grade.code || '—'}
              </span>
            </td>
            <td className="px-2 py-2.5 font-medium text-slate-900">{grade.name}</td>
            <td className="px-2 py-2.5 text-right tabular-nums text-slate-600">
              <T k="kpi.grade.band" vars={{ min: grade.minScore, max: grade.maxScore }} />
            </td>
            <td className="px-2 py-2.5 text-right tabular-nums text-slate-600">
              {grade.bonusMonths === '' ? (
                <span className="text-slate-400">
                  <T k="kpi.grade.bonusNone" />
                </span>
              ) : (
                <T k="kpi.grade.bonusMonths" vars={{ months: grade.bonusMonths }} />
              )}
            </td>
            <td className="px-2 py-2.5">
              <RowActions>
                {mayEdit && (
                  <RowAction
                    icon={<Pencil className="size-4" aria-hidden />}
                    label={t('kpi.grade.action.edit')}
                    onClick={() => setEditing({ index, draft: grade })}
                  />
                )}
                {mayEdit && (
                  <RowAction
                    icon={<Trash2 className="size-4" aria-hidden />}
                    tone="danger"
                    label={t('kpi.grade.action.remove')}
                    onClick={() =>
                      setGrades((current) => current.filter((_, position) => position !== index))
                    }
                  />
                )}
              </RowActions>
            </td>
          </tr>
        ))}
      </RecordTable>

      {!loading && grades.length > 0 && (
        <PanelBody className="pt-3">
          <PanelNote tone={localFaults.length === 0 ? 'success' : 'warn'}>
            {localFaults.length === 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <CircleCheck className="size-3.5" aria-hidden />
                <T k="kpi.grade.covered" />
              </span>
            ) : (
              <>
                <span className="block font-medium">
                  <T k="kpi.grade.faults" />
                </span>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {localFaults.map((fault, index) => (
                    <li key={index}>
                      <T k={fault.key} vars={fault.vars} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </PanelNote>
        </PanelBody>
      )}

      {mayEdit && (
        <PanelActions hint={<T k="kpi.grade.note.set" />}>
          <Button
            // Refused locally too, so the coverage rule reads as part of the form.
            disabled={busy || loading || !complete || localFaults.length > 0 || !dirty}
            onClick={() => void save()}
          >
            <Save className="size-4" aria-hidden />
            <T k="kpi.grade.action.save" />
          </Button>
        </PanelActions>
      )}

      {editing !== null && (
        <Dialog
          title={<T k="kpi.grade.form.title" />}
          titleText={t('kpi.grade.form.title')}
          onClose={() => setEditing(null)}
        >
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={<T k="kpi.grade.form.code" />}
                value={editing.draft.code}
                maxLength={16}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    draft: { ...editing.draft, code: event.target.value.toUpperCase() },
                  })
                }
              />
              <Field
                label={<T k="kpi.grade.form.name" />}
                value={editing.draft.name}
                maxLength={120}
                onChange={(event) =>
                  setEditing({ ...editing, draft: { ...editing.draft, name: event.target.value } })
                }
              />
              <Field
                label={<T k="kpi.grade.form.min" />}
                type="number"
                step="0.01"
                min={0}
                max={100}
                value={editing.draft.minScore}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    draft: { ...editing.draft, minScore: event.target.value },
                  })
                }
              />
              <Field
                label={<T k="kpi.grade.form.max" />}
                type="number"
                step="0.01"
                min={0}
                max={100}
                value={editing.draft.maxScore}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    draft: { ...editing.draft, maxScore: event.target.value },
                  })
                }
              />
            </div>

            <Field
              label={<T k="kpi.grade.form.bonus" />}
              hint={<T k="kpi.grade.form.bonus.hint" vars={{ max: maxBonus }} />}
              type="number"
              step="0.01"
              min={0}
              max={maxBonus}
              value={editing.draft.bonusMonths}
              onChange={(event) =>
                setEditing({
                  ...editing,
                  draft: { ...editing.draft, bonusMonths: event.target.value },
                })
              }
            />

            <div>
              <span className="mb-1 block text-xs font-medium text-slate-600">
                <T k="kpi.grade.form.color" />
              </span>
              <div className="flex flex-wrap gap-1.5">
                {PALETTE.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={color}
                    aria-pressed={editing.draft.color === color}
                    onClick={() => setEditing({ ...editing, draft: { ...editing.draft, color } })}
                    style={{ backgroundColor: color }}
                    className={`size-7 rounded-md ring-offset-2 ${
                      editing.draft.color === color ? 'ring-2 ring-slate-900' : 'ring-0'
                    }`}
                  />
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                <T k="kpi.grade.form.color.hint" />
              </p>
            </div>

            <DialogFooter
              onClose={() => setEditing(null)}
              onSubmit={() => {
                const draft = editing.draft;
                setGrades((current) =>
                  editing.index === null
                    ? [...current, draft]
                    : current.map((row, position) => (position === editing.index ? draft : row)),
                );
                setEditing(null);
              }}
              submitLabel={<T k="dialog.save" />}
              closeLabel={<T k="dialog.cancel" />}
              disabled={
                editing.draft.code.trim() === '' ||
                editing.draft.name.trim() === '' ||
                editing.draft.minScore === '' ||
                editing.draft.maxScore === ''
              }
            />
          </div>
        </Dialog>
      )}
    </>
  );
}
