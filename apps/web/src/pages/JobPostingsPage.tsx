import {
  Archive,
  CircleAlert,
  Megaphone,
  Plus,
  Send,
  SquarePen,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  ChipBar,
  Detail,
  DetailGrid,
  ExpandButton,
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
} from '../components/RecordPanel';
import { Badge, Button, Field } from '../components/ui';
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
 */
export function JobPostingsPage(): ReactNode {
  return <PostingsPanel archived={false} />;
}

/**
 * The archive.
 *
 * The same table over closed postings. One component rather than two, so a column added to one
 * cannot go missing from the other.
 */
export function RecruitmentArchivePage(): ReactNode {
  return <PostingsPanel archived />;
}

function PostingsPanel({ archived }: { archived: boolean }): ReactNode {
  const [data, setData] = useState<PostingPage | null>(null);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [status, setStatus] = useState<PostingStatus | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<PostingRow | 'new' | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await recruitmentApi.postings({
          page,
          pageSize,
          archived,
          ...(status === undefined ? {} : { status }),
        }),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('recruit.posting.error.load'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, archived, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        setLookups(await lookupsApi.load());
      } catch {
        // The form falls back to no department or location, which is a valid posting.
      }
    })();
  }, []);

  const rows = data?.rows ?? [];

  return (
    <PanelCard
      title={<T k={archived ? 'recruit.archive.title' : 'recruit.posting.title'} />}
      subtitle={<T k={archived ? 'recruit.archive.subtitle' : 'recruit.posting.subtitle'} />}
    >
      <PanelSection
        icon={
          archived ? (
            <Archive className="size-4" aria-hidden />
          ) : (
            <Megaphone className="size-4" aria-hidden />
          )
        }
        title={<T k={archived ? 'recruit.archive.tab.postings' : 'recruit.posting.tab.list'} />}
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
        dirty={status !== undefined}
        onReset={() => {
          setStatus(undefined);
          setPage(1);
        }}
      />

      <PanelBody className="space-y-2 pb-0">
        <Feedback error={error} notice={notice} />
        {!archived && (
          <PanelNote icon={<CircleAlert className="size-3.5" aria-hidden />}>
            <T k="recruit.posting.note.forward" />
          </PanelNote>
        )}
      </PanelBody>

      <RecordTable
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
    </PanelCard>
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
        <td className="px-5 py-2 font-mono text-xs text-slate-700">{row.code}</td>
        <td className="px-2 py-2">
          <span className={cn('block', closed ? 'text-slate-400' : 'text-slate-800')}>
            {row.title}
          </span>
          <span className="block text-[11px] text-slate-400">
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
          <Badge
            tone={
              row.status === 'published' ? 'success' : row.status === 'draft' ? 'warning' : 'neutral'
            }
          >
            <span className="uppercase">
              <T k={POSTING_STATUS_LABELS[row.status]} />
            </span>
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
                    await onChanged(`${row.code} diterbitkan.`);
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
                    await onChanged(`${row.code} ditutup.`);
                  } catch (cause) {
                    onError(cause instanceof Error ? cause.message : '');
                  }
                }}
              />
            )}
            {!closed && can(SCREEN, 'edit') && (
              <RowAction
                icon={<SquarePen className="size-4" aria-hidden />}
                label={t('recruit.posting.action.edit')}
                onClick={onEdit}
              />
            )}
            {can(SCREEN, 'delete') && (
              <RowAction
                icon={<Trash2 className="size-4" aria-hidden />}
                label={t('recruit.posting.action.delete')}
                tone="danger"
                // Applicants must be able to name the post they applied for; the server
                // refuses and says so, but disabling states it before the click.
                disabled={row.applicantCount > 0}
                onClick={async () => {
                  try {
                    await recruitmentApi.deletePosting(row.id);
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
  const [departmentId, setDepartmentId] = useState(
    target === null ? '' : String(lookups?.departments.find((d) => d.name === target.departmentName)?.id ?? ''),
  );
  const [locationId, setLocationId] = useState(
    target === null ? '' : String(lookups?.locations.find((l) => l.name === target.locationName)?.id ?? ''),
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
    try {
      const body = {
        code,
        title,
        departmentId: departmentId === '' ? null : Number(departmentId),
        locationId: locationId === '' ? null : Number(locationId),
        ...(summary === '' ? {} : { summary }),
        ...(requirements === '' ? {} : { requirements }),
        positions: Number(positions),
        employmentType,
        salaryMin: salaryMin === '' ? null : Number(salaryMin),
        salaryMax: salaryMax === '' ? null : Number(salaryMax),
        openedOn,
        closesOn: closesOn === '' ? null : closesOn,
      };
      if (target === null) await recruitmentApi.createPosting(body);
      else await recruitmentApi.updatePosting(target.id, body);
      await onDone(`${code.toUpperCase()} disimpan.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="recruit.posting.form.title" />}
      titleText={t('recruit.posting.form.title')}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k="recruit.posting.form.code" />}
            hint={<T k="recruit.posting.form.code.hint" />}
            value={code}
            maxLength={24}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <Field
            label={<T k="recruit.posting.form.positions" />}
            type="number"
            min={1}
            max={500}
            value={positions}
            onChange={(event) => setPositions(event.target.value)}
          />
        </div>

        <Field
          label={<T k="recruit.posting.form.jobTitle" />}
          value={title}
          maxLength={190}
          onChange={(event) => setTitle(event.target.value)}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <FacetSelect
            label={t('recruit.posting.form.department')}
            value={departmentId}
            onChange={setDepartmentId}
            options={(lookups?.departments ?? []).map((row) => ({
              value: String(row.id),
              label: row.name,
            }))}
          />
          <FacetSelect
            label={t('recruit.posting.form.location')}
            value={locationId}
            onChange={setLocationId}
            options={(lookups?.locations ?? []).map((row) => ({
              value: String(row.id),
              label: row.name,
            }))}
          />
        </div>

        <FacetSelect
          label={t('recruit.posting.form.employmentType')}
          value={employmentType}
          onChange={(value) => setEmploymentType(value as EmploymentType)}
          options={EMPLOYMENT_TYPES.map((value) => ({
            value,
            label: t(EMPLOYMENT_TYPE_LABELS[value]),
          }))}
        />

        <div className="grid gap-3 sm:grid-cols-2">
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
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
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

        <div>
          <label htmlFor="posting-summary" className="block text-sm font-medium text-slate-700">
            <T k="recruit.posting.form.summary" />
          </label>
          <textarea
            id="posting-summary"
            rows={4}
            value={summary}
            maxLength={4000}
            onChange={(event) => setSummary(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="posting-requirements" className="block text-sm font-medium text-slate-700">
            <T k="recruit.posting.form.requirements" />
          </label>
          <textarea
            id="posting-requirements"
            rows={4}
            value={requirements}
            maxLength={4000}
            onChange={(event) => setRequirements(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={code.trim() === '' || title.trim() === '' || Number(positions) < 1}
          submitLabel={<T k="dialog.save" />}
        />
      </div>
    </Dialog>
  );
}


