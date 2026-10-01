import { Bell, Layers, Mail, Pencil, Plus, Save, Trash2, TriangleAlert, Trophy } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import { EmailTemplates } from '../components/EmailTemplates';
import { ModuleNotifications } from '../components/ModuleNotifications';
import {
  ChipBar,
  FilterRow,
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
import { Badge, Button, Field, SelectField, TextArea } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
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

/** Register, not severity: a category is a grouping, never a fault. See `TONES` in `ui.tsx`. */
const CATEGORY_TONES: Record<CompetencyCategory, 'neutral' | 'info' | 'accent'> = {
  core: 'neutral',
  functional: 'info',
  leadership: 'accent',
};

const CATEGORY_DOTS: Record<CompetencyCategory, string> = {
  core: 'bg-slate-400',
  functional: 'bg-sky-500',
  leadership: 'bg-fuchsia-500',
};

/**
 * KPI settings: the competency catalogue, the grade bands, and who gets told.
 *
 * Four tabs and no approval flow. An appraisal moves through scoring rather than through
 * signatures — there is no rung anybody is on, so a chain here would configure nothing. That is
 * said in the screen's subtitle, beside the tabs it explains, rather than as a strip inside one of
 * them.
 */
export function KpiSettingsPage(): ReactNode {
  const [tab, setTab] = useState('competencies');
  const { t } = useLabels();

  return (
    <PanelCard title={<T k="kpi.grade.title" />} subtitle={<T k="kpi.settings.subtitle" />}>
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

/**
 * The catalogue every form picks its questions from.
 *
 * Shaped after the leave types tab, the reference for every table of master data. The two columns
 * that matter are the ones free text could never have produced: which category a competency belongs
 * to, and how many forms ask about it. The second is what makes retiring one a decision, so it is
 * also what greys out the bin.
 */
function CompetenciesTab(): ReactNode {
  const [rows, setRows] = useState<Competency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Competency | 'new' | null>(null);
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

  const needle = search.trim().toLowerCase();
  const searched = useMemo(
    () =>
      needle.length === 0
        ? rows
        : rows.filter(
            (row) =>
              row.name.toLowerCase().includes(needle) ||
              (row.description ?? '').toLowerCase().includes(needle),
          ),
    [rows, needle],
  );

  /*
   * Chip counts ignore the chip filter, so picking one does not zero the others. They do follow
   * the search, because that is the list the chips are filtering.
   */
  const chips = CATEGORY_ORDER.map((value) => ({
    id: value,
    label: <T k={CATEGORY_LABELS[value]} />,
    count: searched.filter((row) => row.category === value).length,
    dot: CATEGORY_DOTS[value],
  }));

  const filtered =
    category === undefined ? searched : searched.filter((row) => row.category === category);
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize);

  const remove = async (row: Competency): Promise<void> => {
    try {
      await kpiApi.deleteCompetency(row.id);
      setNotice(t('kpi.competency.notice.removed', { name: row.name }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.remove'));
    }
  };

  return (
    <>
      <PanelSection
        title={<T k="kpi.competency.count" vars={{ count: rows.length }} />}
        subtitle={<T k="kpi.competency.subtitle" />}
        action={
          mayEdit ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden />
              <T k="kpi.competency.action.new" />
            </Button>
          ) : undefined
        }
      />

      <ChipBar
        chips={chips}
        active={category}
        onChange={(id) => {
          setCategory(id);
          setPage(1);
        }}
      />

      <FilterRow
        search={search}
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        placeholder={t('kpi.competency.search')}
        dirty={category !== undefined || search.length > 0}
        onReset={() => {
          setCategory(undefined);
          setSearch('');
          setPage(1);
        }}
      />

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <RecordTable
        framed
        columns={[
          { header: <T k="kpi.competency.column.name" /> },
          { header: <T k="kpi.competency.column.category" />, width: 'w-36' },
          { header: <T k="kpi.competency.column.used" />, width: 'w-32', align: 'right' },
          { header: <T k="panel.column.status" />, width: 'w-28' },
          { header: <T k="panel.column.actions" />, width: 'w-24', align: 'right' },
        ]}
        loading={loading}
        rowCount={shown.length}
        empty={<T k="kpi.competency.empty" />}
      >
        {shown.map((row) => {
          const inUse = row.templateCount > 0;
          return (
            <tr
              key={row.id}
              className={cn(
                'border-b border-slate-100 hover:bg-slate-50/70',
                // A retired competency that forms still ask about is something to notice.
                !row.active && inUse && 'bg-amber-50/40',
              )}
            >
              <td className="px-5 py-2.5">
                <span
                  className={cn('block font-medium', row.active ? 'text-slate-800' : 'text-slate-400')}
                >
                  {row.name}
                </span>
                {row.description !== null && row.description.length > 0 && (
                  <span className="mt-0.5 block text-xs text-slate-500">{row.description}</span>
                )}
              </td>
              <td className="px-2 py-2.5">
                <Badge tone={CATEGORY_TONES[row.category]}>
                  <T k={CATEGORY_LABELS[row.category]} />
                </Badge>
              </td>
              <td className="px-2 py-2.5 text-right text-xs tabular-nums text-slate-600">
                {inUse ? (
                  <T k="kpi.competency.used" vars={{ count: row.templateCount }} />
                ) : (
                  <span className="text-slate-400">
                    <T k="kpi.competency.used.none" />
                  </span>
                )}
              </td>
              <td className="px-2 py-2.5">
                <Badge tone={row.active ? 'success' : 'neutral'}>
                  <T k={row.active ? 'app.status.active' : 'app.status.inactive'} />
                </Badge>
              </td>
              <td className="px-2 py-2.5 pr-4">
                {mayEdit && (
                  <RowActions>
                    <RowAction
                      icon={<Pencil className="size-4" aria-hidden />}
                      label={t('kpi.competency.action.edit')}
                      tone="edit"
                      onClick={() => setEditing(row)}
                    />
                    {/*
                      Disabled with the reason, not enabled and then a 409. A form still asks about
                      it, so the remedy is to deactivate — which the dialog does.
                    */}
                    <RowAction
                      icon={<Trash2 className="size-4" aria-hidden />}
                      label={
                        inUse
                          ? t(
                              row.active
                                ? 'kpi.competency.row.locked'
                                : 'kpi.competency.row.locked.inactive',
                              { count: row.templateCount },
                            )
                          : t('kpi.competency.action.delete')
                      }
                      tone="danger"
                      disabled={inUse}
                      onClick={() => void remove(row)}
                    />
                  </RowActions>
                )}
              </td>
            </tr>
          );
        })}
      </RecordTable>

      <PanelFooter
        shown={shown.length}
        total={filtered.length}
        page={page}
        pageSize={pageSize}
        loading={loading}
        onPage={setPage}
        onPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onRefresh={() => void load()}
      />

      {editing !== null && (
        <CompetencyDialog
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

function CompetencyDialog({
  target,
  onClose,
  onDone,
}: {
  target: Competency | null;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState(target?.name ?? '');
  const [category, setCategory] = useState<CompetencyCategory>(target?.category ?? 'core');
  const [description, setDescription] = useState(target?.description ?? '');
  const [active, setActive] = useState(target?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const inUse = (target?.templateCount ?? 0) > 0;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const body = { name: name.trim(), category, description: description.trim(), active };
    try {
      if (target === null) {
        await kpiApi.createCompetency(body);
        await onDone(t('kpi.competency.notice.saved', { name: body.name }));
        return;
      }
      await kpiApi.updateCompetency(target.id, body);
      /*
       * A rename reports how far it reached.
       *
       * The forms that ask about this competency follow the new wording; appraisals already created
       * keep the words that were put to the person. Both are correct and neither is obvious from
       * pressing Save, so the count is stated rather than left to be discovered.
       */
      await onDone(
        target.name !== body.name && inUse
          ? t('kpi.competency.renamed', { count: target.templateCount })
          : t('kpi.competency.notice.saved', { name: body.name }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  const titleKey = target === null ? 'kpi.competency.form.create' : 'kpi.competency.form.edit';

  return (
    <Dialog
      title={<T k={titleKey} />}
      titleText={t(titleKey)}
      /*
        Editing one that forms ask about: what a rename reaches is the caveat on this decision, so it
        is said here before Save rather than only in the notice afterwards.
      */
      {...(inUse
        ? {
            description: (
              <T k="kpi.competency.form.inUse" vars={{ count: target?.templateCount ?? 0 }} />
            ),
          }
        : {})}
      width="2xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field
            label={<T k="kpi.competency.form.name" />}
            hint={<T k="kpi.competency.form.name.hint" />}
            value={name}
            maxLength={190}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
          <SelectField
            label={<T k="kpi.competency.form.category" />}
            hint={
              <>
                <T k={CATEGORY_HINTS[category]} /> <T k="kpi.competency.form.category.hint" />
              </>
            }
            value={category}
            onChange={(event) => setCategory(event.target.value as CompetencyCategory)}
          >
            {CATEGORY_ORDER.map((value) => (
              <option key={value} value={value}>
                {t(CATEGORY_LABELS[value])}
              </option>
            ))}
          </SelectField>
        </div>

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="grid items-start gap-4 pb-2 sm:grid-cols-[1fr_14rem]">
          <TextArea
            label={<T k="kpi.competency.form.description" />}
            hint={<T k="kpi.competency.form.description.hint" />}
            rows={2}
            value={description}
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
          />
          <SelectField
            label={<T k="panel.column.status" />}
            hint={<T k="kpi.competency.form.status.hint" />}
            value={active ? 'active' : 'inactive'}
            onChange={(event) => setActive(event.target.value === 'active')}
          >
            <option value="active">{t('app.status.active')}</option>
            <option value="inactive">{t('app.status.inactive')}</option>
          </SelectField>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={name.trim() === ''}
          submitLabel={<T k="dialog.save" />}
        />
      </div>
    </Dialog>
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
 * A table with row actions and a dialog, like every other table of master data — with one
 * difference that is the reason for this tab's save bar. Bands are only valid together, so the
 * dialog edits a draft of the set and the set is saved once. A per-grade save would let somebody
 * store a legitimate band that leaves a gap, and a gap only surfaces when a reviewer submits an
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

  /*
   * One list of faults on the screen, never two. While editing it is the draft's, which is what
   * the save would be refused on; otherwise it is the stored set's, from the server — a gap already
   * saved is refusing submissions right now, so it is rose rather than amber.
   */
  const faults = dirty ? localFaults : (payload?.faults ?? []);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
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
      setNotice(t('kpi.grade.notice.saved', { count: grades.length }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
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
        title={<T k="kpi.grade.count" vars={{ count: grades.length }} />}
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

      {(error !== null || notice !== null || faults.length > 0) && (
        <PanelBody className="space-y-2 pb-0">
          <Feedback error={error} notice={notice} />
          {faults.length > 0 && (
            <PanelNote
              tone={dirty ? 'warn' : 'danger'}
              icon={<TriangleAlert className="size-3.5" aria-hidden />}
            >
              <span className="block font-medium">
                <T k="kpi.grade.faults" />
              </span>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {faults.map((fault, index) => (
                  <li key={index}>
                    <T k={fault.key} vars={fault.vars} />
                  </li>
                ))}
              </ul>
            </PanelNote>
          )}
        </PanelBody>
      )}

      <RecordTable
        framed
        columns={[
          { header: <T k="kpi.grade.column.code" />, width: 'w-24' },
          { header: <T k="kpi.grade.column.name" /> },
          { header: <T k="kpi.grade.column.band" />, width: 'w-40', align: 'right' },
          { header: <T k="kpi.grade.column.bonus" />, width: 'w-40', align: 'right' },
          { header: <T k="panel.column.actions" />, width: 'w-24', align: 'right' },
        ]}
        loading={loading}
        rowCount={ordered.length}
        empty={<T k="kpi.grade.empty" />}
      >
        {ordered.map(({ grade, index }) => (
          <tr key={index} className="border-b border-slate-100 hover:bg-slate-50/70">
            <td className="px-5 py-2.5">
              <span
                className="inline-flex min-w-8 justify-center rounded px-1.5 py-0.5 text-[11px] font-semibold text-white uppercase"
                style={{ backgroundColor: grade.color }}
              >
                {grade.code || '—'}
              </span>
            </td>
            <td className="px-2 py-2.5 font-medium text-slate-800">{grade.name}</td>
            <td className="px-2 py-2.5 text-right text-xs tabular-nums text-slate-600">
              <T k="kpi.grade.band" vars={{ min: grade.minScore, max: grade.maxScore }} />
            </td>
            <td className="px-2 py-2.5 text-right text-xs tabular-nums text-slate-600">
              {grade.bonusMonths === '' ? (
                <span className="text-slate-400">
                  <T k="kpi.grade.bonusNone" />
                </span>
              ) : (
                <T k="kpi.grade.bonusMonths" vars={{ months: grade.bonusMonths }} />
              )}
            </td>
            <td className="px-2 py-2.5 pr-4">
              {mayEdit && (
                <RowActions>
                  <RowAction
                    icon={<Pencil className="size-4" aria-hidden />}
                    label={t('kpi.grade.action.edit')}
                    tone="edit"
                    onClick={() => setEditing({ index, draft: grade })}
                  />
                  {/*
                    The consequence rides on the label: a finalised appraisal stores the grade as a
                    code, so removing the band does not regrade anybody.
                  */}
                  <RowAction
                    icon={<Trash2 className="size-4" aria-hidden />}
                    tone="danger"
                    label={t('kpi.grade.row.remove')}
                    onClick={() =>
                      setGrades((current) => current.filter((_, position) => position !== index))
                    }
                  />
                </RowActions>
              )}
            </td>
          </tr>
        ))}
      </RecordTable>

      {mayEdit && (
        <PanelActions
          hint={dirty ? <T k="kpi.grade.unsaved" /> : <T k="kpi.grade.note.set" />}
        >
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
        <GradeDialog
          draft={editing.draft}
          creating={editing.index === null}
          maxBonus={maxBonus}
          onClose={() => setEditing(null)}
          onApply={(draft) => {
            setGrades((current) =>
              editing.index === null
                ? [...current, draft]
                : current.map((row, position) => (position === editing.index ? draft : row)),
            );
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

/**
 * One band, edited into the draft set.
 *
 * Its button says where the change goes. A dialog labelled "Save" that saved nothing would be the
 * control that lies — the set is stored by the bar under the table, once it covers 0–100.
 */
function GradeDialog({
  draft: initial,
  creating,
  maxBonus,
  onClose,
  onApply,
}: {
  draft: GradeDraft;
  creating: boolean;
  maxBonus: number;
  onClose: () => void;
  onApply: (draft: GradeDraft) => void;
}): ReactNode {
  const [draft, setDraft] = useState<GradeDraft>(initial);
  const { t } = useLabels();

  const set = (patch: Partial<GradeDraft>): void => setDraft((current) => ({ ...current, ...patch }));

  const titleKey = creating ? 'kpi.grade.form.create' : 'kpi.grade.form.edit';

  return (
    <Dialog
      title={<T k={titleKey} />}
      titleText={t(titleKey)}
      description={<T k="kpi.grade.form.description" />}
      width="2xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        {/* Identity first: the code somebody reads on a chip, then its name. */}
        <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
          <Field
            label={<T k="kpi.grade.form.code" />}
            value={draft.code}
            maxLength={16}
            autoFocus
            onChange={(event) => set({ code: event.target.value.toUpperCase() })}
          />
          <Field
            label={<T k="kpi.grade.form.name" />}
            value={draft.name}
            maxLength={120}
            onChange={(event) => set({ name: event.target.value })}
          />
        </div>

        <div className="grid items-start gap-4 sm:grid-cols-3">
          <Field
            label={<T k="kpi.grade.form.min" />}
            hint={<T k="kpi.grade.note.boundary" />}
            type="number"
            step="0.01"
            min={0}
            max={100}
            value={draft.minScore}
            onChange={(event) => set({ minScore: event.target.value })}
          />
          <Field
            label={<T k="kpi.grade.form.max" />}
            type="number"
            step="0.01"
            min={0}
            max={100}
            value={draft.maxScore}
            onChange={(event) => set({ maxScore: event.target.value })}
          />
          <Field
            label={<T k="kpi.grade.form.bonus" />}
            hint={<T k="kpi.grade.form.bonus.hint" vars={{ max: maxBonus }} />}
            type="number"
            step="0.01"
            min={0}
            max={maxBonus}
            value={draft.bonusMonths}
            onChange={(event) => set({ bonusMonths: event.target.value })}
          />
        </div>

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="pb-2">
          <span className="block text-sm font-medium text-slate-700">
            <T k="kpi.grade.form.color" />
          </span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={color}
                aria-pressed={draft.color === color}
                onClick={() => set({ color })}
                style={{ backgroundColor: color }}
                className={cn(
                  'size-7 rounded-md ring-offset-2',
                  draft.color === color ? 'ring-2 ring-slate-900' : 'ring-0',
                )}
              />
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            <T k="kpi.grade.form.color.hint" />
          </p>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => onApply(draft)}
          disabled={
            draft.code.trim() === '' ||
            draft.name.trim() === '' ||
            draft.minScore === '' ||
            draft.maxScore === ''
          }
          submitLabel={
            creating ? <T k="kpi.grade.form.apply.add" /> : <T k="kpi.grade.form.apply.update" />
          }
        />
      </div>
    </Dialog>
  );
}
