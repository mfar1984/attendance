import { Archive, CircleAlert, Megaphone, Pencil, Plus, Send, Trash2, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  ChipBar,
  CodePill,
  Detail,
  DetailGrid,
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
  type PanelTab,
} from '../components/RecordPanel';
import { Badge, Button, Field, SelectField, TextArea } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { formatDateOnly, lookupsApi, todayIso, type Lookups } from '../lib/operations-api';
import {
  EMPLOYMENT_TYPE_LABELS,
  POSTING_STATUS_LABELS,
  formatSalaryRange,
  recruitmentApi,
  type EmploymentType,
  type PostingPage,
  type PostingRow,
  type PostingStatus,
} from '../lib/recruitment-api';
import { T, useLabels } from '../lib/translation';
import { ArchivedApplicantsPanel } from './ApplicantsPage';

const STATUS_DOT: Record<PostingStatus, string> = {
  draft: 'bg-slate-400',
  published: 'bg-emerald-600',
  closed: 'bg-slate-300',
};

const SCREEN = 'hr.career';

const EMPLOYMENT_TYPES: EmploymentType[] = ['permanent', 'contract', 'temporary', 'internship'];

/**
 * Job postings.
 *
 * Live postings only — closed ones live on the archive screen, because a list mixing a vacancy
 * somebody is recruiting for with one closed two years ago is a list nobody can scan.
 *
 * The card belongs to the page and not to the panel, so the archive can put two panels under one
 * card with a tab bar between them. A panel that draws its own card cannot be a tab.
 */
export function JobPostingsPage(): ReactNode {
  return (
    <PanelCard
      title={<T k="recruit.posting.title" />}
      subtitle={<T k="recruit.posting.subtitle" />}
    >
      <PostingsPanel archived={false} />
    </PanelCard>
  );
}

/**
 * The archive: closed postings, and the candidates who applied to them.
 *
 * Two subjects on one screen, so a tab bar — the same shape as every settings screen. The
 * applicants half existed as a panel for a long time with nothing mounting it, which meant the
 * candidates of a closed posting could only be found by knowing the posting's code.
 *
 * Each tab is offered only to somebody who can read it. The two lists sit behind different
 * grants, and a tab that opens onto a refusal teaches people the archive is broken.
 */
export function RecruitmentArchivePage(): ReactNode {
  const { t } = useLabels();
  const { can } = useAuth();

  const tabs: PanelTab[] = [
    ...(can(SCREEN, 'view')
      ? [
          {
            id: 'postings',
            label: <T k="recruit.archive.tab.postings" />,
            labelText: t('recruit.archive.tab.postings'),
            icon: <Megaphone className="size-4" aria-hidden />,
          },
        ]
      : []),
    ...(can('hr.applicants', 'view')
      ? [
          {
            id: 'applicants',
            label: <T k="recruit.archive.tab.applicants" />,
            labelText: t('recruit.archive.tab.applicants'),
            icon: <UserPlus className="size-4" aria-hidden />,
          },
        ]
      : []),
  ];
  const [tab, setTab] = useState(tabs[0]?.id ?? 'postings');

  return (
    <PanelCard title={<T k="recruit.archive.title" />} subtitle={<T k="recruit.archive.subtitle" />}>
      {/* A one-tab bar is a control that cannot do anything, so it only appears with two. */}
      {tabs.length > 1 && (
        <PanelTabs label={t('recruit.archive.title')} active={tab} onChange={setTab} tabs={tabs} />
      )}

      {/*
        Neither grant: say so, rather than mount a panel whose first request is refused. The entry
        itself is gated on the archive screen, which a role can hold without either list behind it.
      */}
      {tabs.length === 0 ? (
        <PanelBody>
          <PanelNote tone="warn" icon={<CircleAlert className="size-3.5" aria-hidden />}>
            <T k="recruit.archive.noAccess" />
          </PanelNote>
        </PanelBody>
      ) : tab === 'applicants' ? (
        <ArchivedApplicantsPanel />
      ) : (
        <PostingsPanel archived />
      )}
    </PanelCard>
  );
}

function PostingsPanel({ archived }: { archived: boolean }): ReactNode {
  const [data, setData] = useState<PostingPage | null>(null);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [status, setStatus] = useState<PostingStatus | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<PostingRow | 'new' | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();
  /*
   * Which load is the latest. A search answered out of order would otherwise leave the table
   * showing the rows for the previous term under the box that now holds the next one.
   */
  const latest = useRef(0);

  // Same debounce as the leave list: one request per pause in typing, not one per key.
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
      const result = await recruitmentApi.postings({
        page,
        pageSize,
        archived,
        ...(status === undefined ? {} : { status }),
        ...(debounced === '' ? {} : { search: debounced }),
      });
      if (mine !== latest.current) return;
      setData(result);
      setError(null);
    } catch (cause) {
      if (mine !== latest.current) return;
      setError(cause instanceof Error ? cause.message : t('recruit.posting.error.load'));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [page, pageSize, status, debounced, archived, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (archived) return;
    void (async () => {
      try {
        setLookups(await lookupsApi.load());
      } catch {
        // The form falls back to no department or location, which is a valid posting.
      }
    })();
  }, [archived]);

  const rows = data?.rows ?? [];
  /*
   * The heading counts what this screen holds, ignoring the chip: live postings are drafts plus
   * published ones, the archive is the closed ones. Counted from the chip totals so choosing a
   * chip does not make the heading shrink with the table.
   */
  const count = archived
    ? (data?.counts.closed ?? 0)
    : (data?.counts.draft ?? 0) + (data?.counts.published ?? 0);

  return (
    <>
      <PanelSection
        title={
          <T k={archived ? 'recruit.archive.count' : 'recruit.posting.count'} vars={{ count }} />
        }
        action={
          !archived && can(SCREEN, 'create') ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden />
              <T k="recruit.posting.action.new" />
            </Button>
          ) : undefined
        }
      />

      {/* Only the live screen filters by status; the archive is one status by definition. */}
      {!archived && (
        <ChipBar
          active={status}
          onChange={(id) => {
            setStatus(id as PostingStatus | undefined);
            setPage(1);
          }}
          chips={(['draft', 'published'] as PostingStatus[]).map((key) => ({
            id: key,
            label: <T k={POSTING_STATUS_LABELS[key]} />,
            count: data?.counts[key] ?? 0,
            dot: STATUS_DOT[key],
          }))}
        />
      )}

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('recruit.posting.search')}
        dirty={status !== undefined || search.length > 0}
        onReset={() => {
          setStatus(undefined);
          setSearch('');
          setPage(1);
        }}
      />

      {(error !== null || notice !== null || !archived) && (
        <PanelBody className="space-y-2 pb-0">
          <Feedback error={error} notice={notice} />
          {!archived && (
            <PanelNote icon={<CircleAlert className="size-3.5" aria-hidden />}>
              <T k="recruit.posting.note.forward" />
            </PanelNote>
          )}
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={rows.length}
        empty={<T k="recruit.posting.empty" />}
        columns={[
          { header: <T k="recruit.posting.column.code" />, width: 'w-32' },
          { header: <T k="recruit.posting.column.title" /> },
          { header: <T k="recruit.posting.column.department" />, width: 'w-36' },
          { header: <T k="recruit.posting.column.positions" />, width: 'w-28', align: 'right' },
          { header: <T k="recruit.posting.column.applicants" />, width: 'w-24', align: 'right' },
          { header: <T k="recruit.posting.column.opened" />, width: 'w-28' },
          { header: <T k="recruit.posting.column.closes" />, width: 'w-28' },
          { header: <T k="panel.column.status" />, width: 'w-28' },
          { header: <T k="panel.column.actions" />, width: 'w-36', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <PostingRowView
            key={row.id}
            row={row}
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

      {editing !== null && (
        <PostingDialog
          target={editing === 'new' ? null : editing}
          lookups={lookups}
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

function PostingRowView({
  row,
  expanded,
  onToggle,
  onEdit,
  onChanged,
  onError,
}: {
  row: PostingRow;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
}): ReactNode {
  const { t } = useLabels();
  const { can } = useAuth();
  const full = row.hired >= row.positions;
  const closed = row.status === 'closed';

  return (
    <>
      <tr
        className={cn(
          'border-b border-slate-100',
          expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
          closed && 'text-slate-400',
        )}
      >
        <td className="px-5 py-2">
          <CodePill code={row.code} />
        </td>
        <td className="px-2 py-2">
          <span className={cn('block font-medium', closed ? 'text-slate-400' : 'text-slate-800')}>
            {row.title}
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">
            <T k={EMPLOYMENT_TYPE_LABELS[row.employmentType]} /> ·{' '}
            {formatSalaryRange(row.salaryMin, row.salaryMax)}
          </span>
        </td>
        <td className="px-2 py-2 text-xs text-slate-600">{row.departmentName ?? '—'}</td>
        <td className="px-2 py-2 text-right text-xs tabular-nums">
          <span className={cn(full ? 'font-medium text-amber-700' : 'text-slate-700')}>
            <T k="recruit.posting.filled" vars={{ hired: row.hired, positions: row.positions }} />
          </span>
        </td>
        <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-500">
          {row.applicantCount}
        </td>
        <td className="px-2 py-2 text-xs whitespace-nowrap tabular-nums text-slate-600">
          {formatDateOnly(row.openedOn)}
        </td>
        <td className="px-2 py-2 text-xs whitespace-nowrap tabular-nums text-slate-600">
          {row.closesOn === null ? '—' : formatDateOnly(row.closesOn)}
        </td>
        <td className="px-2 py-2">
          {/* Uppercased by the badge's class: a translated word cannot be upper-cased safely. */}
          <Badge
            tone={
              row.status === 'published' ? 'success' : row.status === 'draft' ? 'warning' : 'neutral'
            }
            className="uppercase"
          >
            <T k={POSTING_STATUS_LABELS[row.status]} />
          </Badge>
        </td>
        <td className="px-2 py-2 pr-4">
          <RowActions>
            {row.status === 'draft' && can(SCREEN, 'edit') && (
              <RowAction
                icon={<Send className="size-4" aria-hidden />}
                label={t('recruit.posting.action.publish')}
                tone="success"
                onClick={async () => {
                  try {
                    await recruitmentApi.setPostingStatus(row.id, 'published');
                    await onChanged(t('recruit.posting.notice.published', { code: row.code }));
                  } catch (cause) {
                    onError(cause instanceof Error ? cause.message : '');
                  }
                }}
              />
            )}
            {row.status === 'published' && can(SCREEN, 'edit') && (
              <RowAction
                icon={<Archive className="size-4" aria-hidden />}
                label={t('recruit.posting.action.close')}
                tone="warn"
                onClick={async () => {
                  try {
                    await recruitmentApi.setPostingStatus(row.id, 'closed');
                    await onChanged(t('recruit.posting.notice.closed', { code: row.code }));
                  } catch (cause) {
                    onError(cause instanceof Error ? cause.message : '');
                  }
                }}
              />
            )}
            {!closed && can(SCREEN, 'edit') && (
              <RowAction
                icon={<Pencil className="size-4" aria-hidden />}
                label={t('recruit.posting.action.edit')}
                tone="edit"
                onClick={onEdit}
              />
            )}
            {/*
              Disabled with the count in the tooltip rather than hidden or refused: applicants must
              be able to name the post they applied for, and the reason belongs on the control.
            */}
            {can(SCREEN, 'delete') && (
              <RowAction
                icon={<Trash2 className="size-4" aria-hidden />}
                label={
                  row.applicantCount > 0
                    ? t(closed ? 'recruit.posting.row.lockedClosed' : 'recruit.posting.row.locked', {
                        count: row.applicantCount,
                      })
                    : t('recruit.posting.action.delete')
                }
                tone="danger"
                disabled={row.applicantCount > 0}
                onClick={async () => {
                  try {
                    await recruitmentApi.deletePosting(row.id);
                    await onChanged(t('recruit.posting.notice.removed', { code: row.code }));
                  } catch (cause) {
                    onError(cause instanceof Error ? cause.message : '');
                  }
                }}
              />
            )}
            <ExpandButton
              expanded={expanded}
              onClick={onToggle}
              label={t('recruit.posting.action.view')}
            />
          </RowActions>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={9} className="px-5 py-3">
            <DetailGrid>
              <Detail label={<T k="recruit.posting.form.location" />} value={row.locationName ?? '—'} />
              <Detail
                label={<T k="recruit.posting.form.employmentType" />}
                value={<T k={EMPLOYMENT_TYPE_LABELS[row.employmentType]} />}
              />
              <Detail
                label={<T k="recruit.posting.form.salaryMin" />}
                value={formatSalaryRange(row.salaryMin, row.salaryMax)}
              />
              <Detail label={<T k="recruit.posting.form.summary" />} value={row.summary ?? '—'} />
              <Detail
                label={<T k="recruit.posting.form.requirements" />}
                value={row.requirements ?? '—'}
              />
            </DetailGrid>

            {closed && (
              <p className="mt-2 text-xs text-slate-500">
                <T k="recruit.posting.note.locked" />
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function PostingDialog({
  target,
  lookups,
  onClose,
  onDone,
}: {
  target: PostingRow | null;
  lookups: Lookups | null;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [code, setCode] = useState(target?.code ?? '');
  const [title, setTitle] = useState(target?.title ?? '');
  const [positions, setPositions] = useState(String(target?.positions ?? 1));
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    target?.employmentType ?? 'permanent',
  );
  // From the stored ids, not matched back from the names — see `departmentId` on `PostingRow`.
  const [departmentId, setDepartmentId] = useState(
    target?.departmentId == null ? '' : String(target.departmentId),
  );
  const [locationId, setLocationId] = useState(
    target?.locationId == null ? '' : String(target.locationId),
  );
  const [salaryMin, setSalaryMin] = useState(
    target?.salaryMin == null ? '' : String(target.salaryMin),
  );
  const [salaryMax, setSalaryMax] = useState(
    target?.salaryMax == null ? '' : String(target.salaryMax),
  );
  const [openedOn, setOpenedOn] = useState(target?.openedOn ?? todayIso());
  const [closesOn, setClosesOn] = useState(target?.closesOn ?? '');
  const [summary, setSummary] = useState(target?.summary ?? '');
  const [requirements, setRequirements] = useState(target?.requirements ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        code: code.trim().toUpperCase(),
        title: title.trim(),
        departmentId: departmentId === '' ? null : Number(departmentId),
        locationId: locationId === '' ? null : Number(locationId),
        /*
          Sent even when empty, because empty is what clears them. The route reads `''` as "none"
          and an absent key as "leave as it was".
        */
        summary: summary.trim(),
        requirements: requirements.trim(),
        positions: Number(positions),
        employmentType,
        salaryMin: salaryMin === '' ? null : Number(salaryMin),
        salaryMax: salaryMax === '' ? null : Number(salaryMax),
        openedOn,
        closesOn: closesOn === '' ? null : closesOn,
      };
      if (target === null) await recruitmentApi.createPosting(body);
      else await recruitmentApi.updatePosting(target.id, body);
      await onDone(t('recruit.posting.notice.saved', { code: body.code }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  const titleKey = target === null ? 'recruit.posting.form.create' : 'recruit.posting.form.edit';

  return (
    <Dialog title={<T k={titleKey} />} titleText={t(titleKey)} width="2xl" onClose={onClose}>
      <div className="space-y-4">
        <Feedback error={error} />

        {/*
          Identity first: the code a candidate quotes on the telephone, then the title they read.
          The code column is wider than a leave type's because a posting code runs to twenty-four
          characters and its hint is a sentence, not an example.
        */}
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <Field
            label={<T k="recruit.posting.form.code" />}
            hint={<T k="recruit.posting.form.code.hint" />}
            value={code}
            maxLength={24}
            autoFocus
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <Field
            label={<T k="recruit.posting.form.jobTitle" />}
            value={title}
            maxLength={190}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextArea
            label={<T k="recruit.posting.form.summary" />}
            rows={4}
            value={summary}
            maxLength={4000}
            onChange={(event) => setSummary(event.target.value)}
          />
          <TextArea
            label={<T k="recruit.posting.form.requirements" />}
            rows={4}
            value={requirements}
            maxLength={4000}
            onChange={(event) => setRequirements(event.target.value)}
          />
        </div>

        {/*
          Form selects with visible labels, not facets. A facet's empty option means "no filter";
          here "none" is a real answer — a posting open to any department — so it is written out.
        */}
        <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField
            label={<T k="recruit.posting.form.department" />}
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">{t('staffForm.none')}</option>
            {(lookups?.departments ?? []).map((row) => (
              <option key={row.id} value={String(row.id)}>
                {row.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={<T k="recruit.posting.form.location" />}
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
          >
            <option value="">{t('staffForm.none')}</option>
            {(lookups?.locations ?? []).map((row) => (
              <option key={row.id} value={String(row.id)}>
                {row.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={<T k="recruit.posting.form.employmentType" />}
            value={employmentType}
            onChange={(event) => setEmploymentType(event.target.value as EmploymentType)}
          >
            {EMPLOYMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(EMPLOYMENT_TYPE_LABELS[value])}
              </option>
            ))}
          </SelectField>
          <Field
            label={<T k="recruit.posting.form.positions" />}
            inputMode="numeric"
            value={positions}
            onChange={(event) => setPositions(event.target.value.replace(/\D/g, ''))}
          />
        </div>

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="grid items-start gap-4 pb-2 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label={<T k="recruit.posting.form.salaryMin" />}
            hint={<T k="recruit.posting.form.salary.hint" />}
            type="number"
            step="0.01"
            min={0}
            value={salaryMin}
            onChange={(event) => setSalaryMin(event.target.value)}
          />
          <Field
            label={<T k="recruit.posting.form.salaryMax" />}
            type="number"
            step="0.01"
            min={0}
            value={salaryMax}
            onChange={(event) => setSalaryMax(event.target.value)}
          />
          <Field
            label={<T k="recruit.posting.form.openedOn" />}
            type="date"
            value={openedOn}
            onChange={(event) => setOpenedOn(event.target.value)}
          />
          <Field
            label={<T k="recruit.posting.form.closesOn" />}
            hint={<T k="recruit.posting.form.closesOn.hint" />}
            type="date"
            value={closesOn}
            onChange={(event) => setClosesOn(event.target.value)}
          />
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={code.trim() === '' || title.trim() === '' || !(Number(positions) >= 1)}
          submitLabel={<T k="dialog.save" />}
        />
      </div>
    </Dialog>
  );
}
