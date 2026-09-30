import {
  CircleAlert,
  CircleCheck,
  CircleX,
  MoveRight,
  Plus,
  Trash2,
  TriangleAlert,
  UserPlus,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

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
import { Badge, Button, Field, SelectField, TextArea } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { signedNotice, type ApprovalTrailEntry } from '../lib/hr-api';
import { formatDateTime, lookupsApi, todayIso, type Lookups } from '../lib/operations-api';
import {
  APPLICANT_STATUS_LABELS,
  recruitmentApi,
  type ApplicantPage,
  type ApplicantRow,
  type ApplicantStatus,
  type PostingRow,
} from '../lib/recruitment-api';
import { T, useLabels } from '../lib/translation';

const STATUS_DOT: Record<ApplicantStatus, string> = {
  new: 'bg-slate-400',
  screening: 'bg-sky-500',
  interview: 'bg-violet-500',
  offered: 'bg-amber-500',
  hired: 'bg-emerald-600',
  rejected: 'bg-rose-500',
  withdrawn: 'bg-slate-300',
};

const STATUS_TONE: Record<ApplicantStatus, 'neutral' | 'warning' | 'danger' | 'success'> = {
  new: 'neutral',
  screening: 'neutral',
  interview: 'neutral',
  offered: 'warning',
  hired: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
};

/** Every stage, withdrawn included: a stage without a chip is a stage nobody can filter to. */
const STATUSES: ApplicantStatus[] = [
  'new',
  'screening',
  'interview',
  'offered',
  'hired',
  'rejected',
  'withdrawn',
];

const SCREEN = 'hr.applicants';

/** Candidates against live postings. The card belongs to the page, so the archive can reuse the panel. */
export function ApplicantsPage(): ReactNode {
  return (
    <PanelCard
      title={<T k="recruit.applicant.title" />}
      subtitle={<T k="recruit.applicant.subtitle" />}
    >
      <ApplicantsPanel archived={false} />
    </PanelCard>
  );
}

/** Candidates against closed postings, mounted as a tab of the archive screen. */
export function ArchivedApplicantsPanel(): ReactNode {
  return <ApplicantsPanel archived />;
}

function ApplicantsPanel({ archived }: { archived: boolean }): ReactNode {
  const [data, setData] = useState<ApplicantPage | null>(null);
  const [postings, setPostings] = useState<PostingRow[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [status, setStatus] = useState<ApplicantStatus | undefined>(undefined);
  const [postingId, setPostingId] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [advancing, setAdvancing] = useState<ApplicantRow | null>(null);
  const [deciding, setDeciding] = useState<{ row: ApplicantRow; approve: boolean } | null>(null);
  const [hiring, setHiring] = useState<ApplicantRow | null>(null);
  const [removing, setRemoving] = useState<ApplicantRow | null>(null);
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
      const result = await recruitmentApi.applicants({
        page,
        pageSize,
        archived,
        ...(status === undefined ? {} : { status }),
        ...(postingId === '' ? {} : { postingId: Number(postingId) }),
        ...(debounced === '' ? {} : { search: debounced }),
      });
      if (mine !== latest.current) return;
      setData(result);
      setError(null);
    } catch (cause) {
      if (mine !== latest.current) return;
      setError(cause instanceof Error ? cause.message : t('recruit.applicant.error.load'));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [page, pageSize, status, postingId, debounced, archived, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        /*
          The postings this list can be filtered by. Live: the published ones, which are also the
          only ones the create form may offer. Archive: the closed ones its candidates applied to.
        */
        const result = await recruitmentApi.postings(
          archived ? { archived: true, pageSize: 200 } : { status: 'published', pageSize: 200 },
        );
        setPostings(result.rows);
      } catch {
        // The filter and the create form fall back to empty, which the dialog states.
      }
    })();
  }, [archived]);

  const rows = data?.rows ?? [];
  // The heading counts every stage, so choosing a chip does not make it shrink with the table.
  const count = Object.values(data?.counts ?? {}).reduce((sum, value) => sum + (value ?? 0), 0);

  return (
    <>
      <PanelSection
        title={<T k="recruit.applicant.count" vars={{ count }} />}
        action={
          !archived && can(SCREEN, 'edit') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              <T k="recruit.applicant.action.new" />
            </Button>
          ) : undefined
        }
      />

      <ChipBar
        active={status}
        onChange={(id) => {
          setStatus(id as ApplicantStatus | undefined);
          setPage(1);
        }}
        chips={STATUSES.map((key) => ({
          id: key,
          label: <T k={APPLICANT_STATUS_LABELS[key]} />,
          count: data?.counts[key] ?? 0,
          dot: STATUS_DOT[key],
        }))}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('recruit.applicant.search')}
        dirty={status !== undefined || postingId !== '' || search.length > 0}
        onReset={() => {
          setStatus(undefined);
          setPostingId('');
          setSearch('');
          setPage(1);
        }}
      >
        <FacetSelect
          label={t('recruit.applicant.filter.allPostings')}
          value={postingId}
          onChange={(value) => {
            setPostingId(value);
            setPage(1);
          }}
          options={postings.map((row) => ({
            value: String(row.id),
            label: `${row.code} — ${row.title}`,
          }))}
        />
      </FilterRow>

      {(error !== null || notice !== null || !archived) && (
        <PanelBody className="space-y-2 pb-0">
          <Feedback error={error} notice={notice} />
          {/* How an offer is made, on the screen where offers are made. */}
          {!archived && (
            <PanelNote icon={<CircleAlert className="size-3.5" aria-hidden />}>
              <T k="recruit.applicant.note.offer" />
            </PanelNote>
          )}
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={rows.length}
        empty={<T k="recruit.applicant.empty" />}
        columns={[
          { header: <T k="recruit.applicant.column.applicantNo" />, width: 'w-40' },
          { header: <T k="recruit.applicant.column.name" /> },
          { header: <T k="recruit.applicant.column.posting" />, width: 'w-44' },
          { header: <T k="recruit.applicant.column.contact" />, width: 'w-44' },
          { header: <T k="recruit.applicant.column.interview" />, width: 'w-36' },
          { header: <T k="recruit.applicant.column.staff" />, width: 'w-28' },
          { header: <T k="panel.column.status" />, width: 'w-32' },
          { header: <T k="panel.column.actions" />, width: 'w-40', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <ApplicantRowView
            key={row.id}
            row={row}
            chainLength={data?.chainLength ?? 0}
            expanded={open === row.id}
            onToggle={() => setOpen(open === row.id ? null : row.id)}
            onAdvance={() => setAdvancing(row)}
            onApprove={() => setDeciding({ row, approve: true })}
            onReject={() => setDeciding({ row, approve: false })}
            onHire={() => setHiring(row)}
            onRemove={() => setRemoving(row)}
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

      {creating && (
        <NewApplicantDialog
          postings={postings}
          onClose={() => setCreating(false)}
          onDone={async (message) => {
            setCreating(false);
            setNotice(message);
            await load();
          }}
        />
      )}

      {advancing !== null && (
        <AdvanceDialog
          target={advancing}
          onClose={() => setAdvancing(null)}
          onDone={async (message) => {
            setAdvancing(null);
            setNotice(message);
            await load();
          }}
        />
      )}

      {deciding !== null && (
        <DecideDialog
          target={deciding.row}
          approve={deciding.approve}
          onClose={() => setDeciding(null)}
          onDone={async (message) => {
            setDeciding(null);
            setNotice(message);
            await load();
          }}
        />
      )}

      {hiring !== null && (
        <HireDialog
          target={hiring}
          onClose={() => setHiring(null)}
          onDone={async (message) => {
            setHiring(null);
            setNotice(message);
            await load();
          }}
        />
      )}

      {removing !== null && (
        <RemoveDialog
          target={removing}
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

function ApplicantRowView({
  row,
  chainLength,
  expanded,
  onToggle,
  onAdvance,
  onApprove,
  onReject,
  onHire,
  onRemove,
}: {
  row: ApplicantRow;
  chainLength: number;
  expanded: boolean;
  onToggle: () => void;
  onAdvance: () => void;
  onApprove: () => void;
  onReject: () => void;
  onHire: () => void;
  onRemove: () => void;
}): ReactNode {
  const [detail, setDetail] = useState<{ coverNote: string | null; trail: ApprovalTrailEntry[] } | null>(
    null,
  );
  const { t } = useLabels();
  const { can } = useAuth();

  /*
   * The pipeline decides which actions exist. `nextStatuses` comes from the server so the
   * state machine lives in one place — a client-side copy is what lets somebody hire a
   * rejected candidate after a refactor.
   */
  const canAdvance = row.nextStatuses.some((next) => next !== 'offered' && next !== 'hired');
  const canDecide = row.status === 'interview';
  const canHire = row.status === 'offered' && row.staffId === null;
  const hired = row.staffId !== null;

  useEffect(() => {
    if (!expanded || detail !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await recruitmentApi.applicantDetail(row.id);
        if (!cancelled) setDetail({ coverNote: result.coverNote, trail: result.trail });
      } catch {
        if (!cancelled) setDetail({ coverNote: null, trail: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, detail, row.id]);

  return (
    <>
      <tr
        className={cn(
          'border-b border-slate-100',
          expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
          !expanded && row.status === 'interview' && 'bg-amber-50/40',
        )}
      >
        <td className="px-5 py-2 font-mono text-xs text-slate-700">{row.applicantNo}</td>
        <td className="px-2 py-2">
          <span className="block text-slate-800">{row.fullName}</span>
          <span className="block font-mono text-[11px] text-slate-400">{row.icNo ?? '—'}</span>
        </td>
        <td className="px-2 py-2 text-xs text-slate-600">
          <span className="block font-mono text-[11px] text-slate-400">{row.postingCode}</span>
          <span className="line-clamp-1">{row.postingTitle}</span>
        </td>
        <td className="px-2 py-2 text-xs text-slate-600">
          <span className="block line-clamp-1">{row.email ?? '—'}</span>
          <span className="block text-[11px] text-slate-400">{row.phone ?? '—'}</span>
        </td>
        <td className="px-2 py-2 text-xs whitespace-nowrap text-slate-600">
          {row.interviewAt === null ? '—' : formatDateTime(row.interviewAt)}
        </td>
        <td className="px-2 py-2 text-xs">
          {row.employeeNo === null ? (
            <span className="text-slate-400">—</span>
          ) : (
            <span className="text-brand-700 font-mono">{row.employeeNo}</span>
          )}
        </td>
        <td className="px-2 py-2">
          {/* Uppercased by the badge's class: a translated word cannot be upper-cased safely. */}
          <Badge tone={STATUS_TONE[row.status]} className="uppercase">
            <T k={APPLICANT_STATUS_LABELS[row.status]} />
          </Badge>
          {chainLength > 1 && row.status === 'interview' && row.currentLevel > 0 && (
            <span className="mt-0.5 block text-[10px] text-slate-500">
              <T k="hr.approval.progress" vars={{ level: row.currentLevel, total: chainLength }} />
            </span>
          )}
        </td>
        <td className="px-2 py-2 pr-4">
          <RowActions>
            {/* Amber: moving a candidate between stages changes the record. */}
            {canAdvance && can(SCREEN, 'edit') && (
              <RowAction
                icon={<MoveRight className="size-4" aria-hidden />}
                label={t('recruit.applicant.action.advance')}
                tone="edit"
                onClick={onAdvance}
              />
            )}
            {canDecide && can(SCREEN, 'approve') && (
              <>
                <RowAction
                  icon={<CircleCheck className="size-4" aria-hidden />}
                  label={t('recruit.decide.approve')}
                  tone="success"
                  onClick={onApprove}
                />
                <RowAction
                  icon={<CircleX className="size-4" aria-hidden />}
                  label={t('recruit.decide.reject')}
                  tone="danger"
                  onClick={onReject}
                />
              </>
            )}
            {canHire && can(SCREEN, 'approve') && (
              <RowAction
                icon={<UserPlus className="size-4" aria-hidden />}
                label={t('recruit.applicant.action.hire')}
                tone="success"
                onClick={onHire}
              />
            )}
            {/*
              Disabled with the reason rather than hidden once the candidate is hired: the staff
              record refers to the application, and a bin that silently vanishes from one row reads
              as a permission somebody lost.
            */}
            {can(SCREEN, 'delete') && (
              <RowAction
                icon={<Trash2 className="size-4" aria-hidden />}
                label={
                  hired ? t('recruit.applicant.row.locked') : t('recruit.applicant.action.delete')
                }
                tone="danger"
                disabled={hired}
                onClick={onRemove}
              />
            )}
            <ExpandButton
              expanded={expanded}
              onClick={onToggle}
              label={t('recruit.applicant.action.view')}
            />
          </RowActions>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={8} className="px-5 py-3">
            <DetailGrid>
              <Detail label={<T k="recruit.applicant.form.icNo" />} value={row.icNo ?? '—'} />
              <Detail
                label={<T k="recruit.applicant.column.interview" />}
                value={row.interviewAt === null ? '—' : formatDateTime(row.interviewAt)}
              />
              <Detail
                label={<T k="recruit.advance.note" />}
                value={row.interviewNote ?? '—'}
              />
              <Detail
                label={<T k="claim.decide.note" />}
                value={row.decisionNote ?? '—'}
              />
              <Detail
                label={<T k="recruit.applicant.form.coverNote" />}
                value={detail?.coverNote ?? '—'}
              />
            </DetailGrid>

            {row.status === 'hired' && (
              <PanelNote tone="warn" className="mt-3">
                <T k="recruit.applicant.note.hired" />
              </PanelNote>
            )}

            <div className="mt-3 border-t border-slate-200 pt-3">
              <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                <T k="hr.approval.trail.title" />
              </p>
              {detail === null ? (
                <p className="mt-1 text-xs text-slate-400">
                  <T k="app.loading" />
                </p>
              ) : detail.trail.length === 0 ? (
                <p className="mt-1 text-xs text-slate-400">
                  <T k="hr.approval.trail.empty" />
                </p>
              ) : (
                <ol className="mt-1.5 space-y-1">
                  {detail.trail.map((entry) => (
                    <li key={entry.id} className="flex flex-wrap items-baseline gap-2 text-xs">
                      <span className="font-medium text-slate-600">
                        <T k="hr.approval.trail.level" vars={{ level: entry.level }} />
                      </span>
                      <span
                        className={cn(
                          'font-medium',
                          entry.action === 'approved' ? 'text-emerald-700' : 'text-rose-700',
                        )}
                      >
                        <T
                          k={
                            entry.action === 'approved'
                              ? 'hr.approval.trail.approved'
                              : 'hr.approval.trail.rejected'
                          }
                        />
                      </span>
                      <span className="text-slate-600">{entry.actorLabel}</span>
                      <span className="text-slate-400">{formatDateTime(entry.createdAt)}</span>
                      {entry.remarks !== null && (
                        <span className="text-slate-500 italic">{entry.remarks}</span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function NewApplicantDialog({
  postings,
  onClose,
  onDone,
}: {
  postings: PostingRow[];
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [postingId, setPostingId] = useState('');
  const [fullName, setFullName] = useState('');
  const [icNo, setIcNo] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [coverNote, setCoverNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const created = await recruitmentApi.createApplicant({
        postingId: Number(postingId),
        fullName: fullName.trim(),
        ...(icNo.trim() === '' ? {} : { icNo: icNo.trim() }),
        ...(email.trim() === '' ? {} : { email: email.trim() }),
        ...(phone.trim() === '' ? {} : { phone: phone.trim() }),
        ...(coverNote.trim() === '' ? {} : { coverNote: coverNote.trim() }),
      });
      await onDone(t('hr.record.created', { number: created.applicantNo }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="recruit.applicant.form.title" />}
      titleText={t('recruit.applicant.form.title')}
      width="2xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/*
          The vacancy first: it is what the application is for, and with none published there is
          nothing below worth filling in.
        */}
        {postings.length === 0 ? (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="recruit.applicant.form.posting.hint" />
          </PanelNote>
        ) : (
          <SelectField
            label={<T k="recruit.applicant.form.posting" />}
            hint={<T k="recruit.applicant.form.posting.hint" />}
            value={postingId}
            onChange={(event) => setPostingId(event.target.value)}
          >
            {/* A prompt, not a choice: submitting stays disabled until a posting is picked. */}
            <option value="">{t('recruit.applicant.form.posting')}</option>
            {postings.map((row) => (
              <option key={row.id} value={String(row.id)}>
                {`${row.code} — ${row.title}`}
              </option>
            ))}
          </SelectField>
        )}

        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field
            label={<T k="recruit.applicant.form.fullName" />}
            value={fullName}
            maxLength={190}
            onChange={(event) => setFullName(event.target.value)}
          />
          <Field
            label={<T k="recruit.applicant.form.icNo" />}
            hint={<T k="recruit.applicant.form.icNo.hint" />}
            value={icNo}
            maxLength={20}
            onChange={(event) => setIcNo(event.target.value)}
          />
        </div>

        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field
            label={<T k="recruit.applicant.form.email" />}
            type="email"
            value={email}
            maxLength={190}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Field
            label={<T k="recruit.applicant.form.phone" />}
            value={phone}
            maxLength={20}
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <TextArea
          label={<T k="recruit.applicant.form.coverNote" />}
          rows={4}
          value={coverNote}
          maxLength={4000}
          wrapperClassName="pb-2"
          onChange={(event) => setCoverNote(event.target.value)}
        />

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={postingId === '' || fullName.trim() === ''}
          submitLabel={<T k="dialog.save" />}
        />
      </div>
    </Dialog>
  );
}

function AdvanceDialog({
  target,
  onClose,
  onDone,
}: {
  target: ApplicantRow;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  /*
   * Offers and hires are removed from the choices: both go through their own path, and offering
   * one here would skip the approval the offer exists to record.
   */
  const options = target.nextStatuses.filter((next) => next !== 'offered' && next !== 'hired');

  const [status, setStatus] = useState<ApplicantStatus>(options[0] ?? 'screening');
  const [interviewAt, setInterviewAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await recruitmentApi.setApplicantStatus(target.id, {
        status,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
        ...(interviewAt === '' ? {} : { interviewAt: new Date(interviewAt).toISOString() }),
      });
      await onDone(
        t('recruit.advance.done', {
          number: target.applicantNo,
          status: t(APPLICANT_STATUS_LABELS[status]),
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="recruit.advance.title" vars={{ applicantNo: target.applicantNo }} />}
      titleText={t('recruit.advance.title', { applicantNo: target.applicantNo })}
      description={<T k="recruit.advance.description" />}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/*
          A form select, not a facet: the stage always has a value, and a facet's empty option
          would let somebody submit a move to nowhere.
        */}
        <SelectField
          label={<T k="recruit.advance.status" />}
          value={status}
          onChange={(event) => setStatus(event.target.value as ApplicantStatus)}
        >
          {options.map((value) => (
            <option key={value} value={value}>
              {t(APPLICANT_STATUS_LABELS[value])}
            </option>
          ))}
        </SelectField>

        {/* Only asked for when the new stage is an interview. */}
        {status === 'interview' && (
          <Field
            label={<T k="recruit.advance.interviewAt" />}
            type="datetime-local"
            value={interviewAt}
            onChange={(event) => setInterviewAt(event.target.value)}
          />
        )}

        <Field
          label={<T k="recruit.advance.note" />}
          {...(status === 'rejected' ? { hint: <T k="recruit.advance.note.required" /> } : {})}
          value={note}
          maxLength={500}
          wrapperClassName="pb-2"
          onChange={(event) => setNote(event.target.value)}
        />

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={status === 'rejected' && note.trim().length < 3}
          submitLabel={<T k="dialog.save" />}
        />
      </div>
    </Dialog>
  );
}

function DecideDialog({
  target,
  approve,
  onClose,
  onDone,
}: {
  target: ApplicantRow;
  approve: boolean;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await recruitmentApi.decideApplicant(target.id, {
        decision: approve ? 'approved' : 'rejected',
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });

      await onDone(
        !approve
          ? t('recruit.decide.done.rejected', { number: target.applicantNo })
          : result.finalized
            ? t('recruit.decide.done.offered', { number: target.applicantNo })
            : signedNotice(t, target.applicantNo, result),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="recruit.decide.title" vars={{ applicantNo: target.applicantNo }} />}
      titleText={t('recruit.decide.title', { applicantNo: target.applicantNo })}
      description={<T k="recruit.decide.description" />}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <DetailGrid>
          <Detail label={<T k="recruit.applicant.column.name" />} value={target.fullName} />
          <Detail
            label={<T k="recruit.applicant.column.posting" />}
            value={`${target.postingCode} — ${target.postingTitle}`}
          />
          <Detail
            label={<T k="recruit.applicant.column.interview" />}
            value={target.interviewAt === null ? '—' : formatDateTime(target.interviewAt)}
          />
        </DetailGrid>

        <Field
          label={<T k="claim.decide.note" />}
          {...(approve ? {} : { hint: <T k="recruit.advance.note.required" /> })}
          value={note}
          maxLength={500}
          wrapperClassName="pb-2"
          onChange={(event) => setNote(event.target.value)}
        />

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={!approve && note.trim().length < 3}
          submitLabel={<T k={approve ? 'recruit.decide.approve' : 'recruit.decide.reject'} />}
        />
      </div>
    </Dialog>
  );
}

function HireDialog({
  target,
  onClose,
  onDone,
}: {
  target: ApplicantRow;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [employeeNo, setEmployeeNo] = useState('');
  const [hireDate, setHireDate] = useState(todayIso());
  const [position, setPosition] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  useEffect(() => {
    void (async () => {
      try {
        setLookups(await lookupsApi.load());
      } catch {
        // A hire with no department is valid; the staff form can set it later.
      }
    })();
  }, []);

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await recruitmentApi.hire(target.id, {
        employeeNo: employeeNo.trim(),
        hireDate,
        ...(position.trim() === '' ? {} : { position: position.trim() }),
        departmentId: departmentId === '' ? null : Number(departmentId),
        locationId: locationId === '' ? null : Number(locationId),
      });
      await onDone(
        t('recruit.hire.done', { name: target.fullName, employeeNo: result.employeeNo }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  };

  const noIc = target.icNo === null || target.icNo.trim() === '';

  return (
    <Dialog
      title={<T k="recruit.hire.title" vars={{ name: target.fullName }} />}
      titleText={t('recruit.hire.title', { name: target.fullName })}
      description={<T k="recruit.hire.description" />}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/*
          Stated before the attempt. An IC is not required to apply but is required to become an
          employee, because payroll and the statutory returns are keyed on it.
        */}
        {noIc && (
          <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="recruit.applicant.form.icNo.hint" />
          </PanelNote>
        )}

        <DetailGrid>
          <Detail label={<T k="recruit.applicant.column.name" />} value={target.fullName} />
          <Detail label={<T k="recruit.applicant.form.icNo" />} value={target.icNo ?? '—'} />
          <Detail label={<T k="recruit.applicant.form.email" />} value={target.email ?? '—'} />
          <Detail label={<T k="recruit.applicant.form.phone" />} value={target.phone ?? '—'} />
        </DetailGrid>

        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field
            label={<T k="recruit.hire.employeeNo" />}
            value={employeeNo}
            maxLength={32}
            autoFocus
            onChange={(event) => setEmployeeNo(event.target.value)}
          />
          <Field
            label={<T k="recruit.hire.hireDate" />}
            type="date"
            value={hireDate}
            onChange={(event) => setHireDate(event.target.value)}
          />
        </div>

        <Field
          label={<T k="recruit.hire.position" />}
          hint={<T k="recruit.hire.position.hint" />}
          value={position}
          maxLength={120}
          onChange={(event) => setPosition(event.target.value)}
        />

        {/*
          Form selects with "none" written out: a hire without a department is valid, and the staff
          form can set it later. A facet's empty option would say "no filter" instead.
        */}
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <SelectField
            label={<T k="recruit.hire.department" />}
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
            label={<T k="recruit.hire.location" />}
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
        </div>

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="pb-2">
          <PanelNote tone="warn">
            <T k="recruit.applicant.note.hired" />
          </PanelNote>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={employeeNo.trim() === '' || noIc}
          submitLabel={<T k="recruit.hire.submit" />}
        />
      </div>
    </Dialog>
  );
}

/**
 * The second step of removing a candidate.
 *
 * A real delete of a member of the public's personal data, with their decision trail, and it
 * cannot be undone — so it is not a single click on a bin. The consequence is stated here, at the
 * moment of deciding, rather than in the expanded row where it used to sit and be read afterwards.
 */
function RemoveDialog({
  target,
  onClose,
  onDone,
}: {
  target: ApplicantRow;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await recruitmentApi.deleteApplicant(target.id);
      await onDone(t('recruit.applicant.notice.removed', { number: target.applicantNo }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.remove'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="recruit.applicant.remove.title" vars={{ number: target.applicantNo }} />}
      titleText={t('recruit.applicant.remove.title', { number: target.applicantNo })}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <DetailGrid>
          <Detail label={<T k="recruit.applicant.column.name" />} value={target.fullName} />
          <Detail
            label={<T k="recruit.applicant.column.posting" />}
            value={`${target.postingCode} — ${target.postingTitle}`}
          />
        </DetailGrid>

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="pb-2">
          <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="recruit.applicant.note.delete" />
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
