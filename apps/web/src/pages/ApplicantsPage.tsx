import {
  CircleAlert,
  CircleCheck,
  CircleX,
  MoveRight,
  Plus,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
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
import type { ApprovalTrailEntry } from '../lib/hr-api';
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

const SCREEN = 'hr.applicants';

/** Candidates against live postings. */
export function ApplicantsPage(): ReactNode {
  return <ApplicantsPanel archived={false} />;
}

/** Candidates against closed postings, for the archive screen. */
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [advancing, setAdvancing] = useState<ApplicantRow | null>(null);
  const [deciding, setDeciding] = useState<{ row: ApplicantRow; approve: boolean } | null>(null);
  const [hiring, setHiring] = useState<ApplicantRow | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await recruitmentApi.applicants({
          page,
          pageSize,
          archived,
          ...(status === undefined ? {} : { status }),
          ...(postingId === '' ? {} : { postingId: Number(postingId) }),
        }),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('recruit.applicant.error.load'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, postingId, archived, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        // Only live postings can take a new application, so the picker offers those.
        const result = await recruitmentApi.postings({ status: 'published', pageSize: 200 });
        setPostings(result.rows);
      } catch {
        // The filter and the create form fall back to empty, which the dialog states.
      }
    })();
  }, []);

  const rows = data?.rows ?? [];

  return (
    <PanelCard
      title={<T k="recruit.applicant.title" />}
      subtitle={<T k="recruit.applicant.subtitle" />}
    >
      <PanelSection
        icon={<Users className="size-4" aria-hidden />}
        title={<T k={archived ? 'recruit.archive.tab.applicants' : 'recruit.applicant.title'} />}
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
        chips={(
          ['new', 'screening', 'interview', 'offered', 'hired', 'rejected'] as ApplicantStatus[]
        ).map((key) => ({
          id: key,
          label: <T k={APPLICANT_STATUS_LABELS[key]} />,
          count: data?.counts[key] ?? 0,
          dot: STATUS_DOT[key],
        }))}
      />

      <FilterRow
        dirty={status !== undefined || postingId !== ''}
        onReset={() => {
          setStatus(undefined);
          setPostingId('');
          setPage(1);
        }}
      >
        <FacetSelect
          label={t('recruit.applicant.form.posting')}
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

      <PanelBody className="space-y-2 pb-0">
        <Feedback error={error} notice={notice} />
        <PanelNote icon={<CircleAlert className="size-3.5" aria-hidden />}>
          <T k="recruit.applicant.note.offer" />
        </PanelNote>
      </PanelBody>

      <RecordTable
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
    </PanelCard>
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
  onChanged,
  onError,
}: {
  row: ApplicantRow;
  chainLength: number;
  expanded: boolean;
  onToggle: () => void;
  onAdvance: () => void;
  onApprove: () => void;
  onReject: () => void;
  onHire: () => void;
  onChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
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
  const live = row.nextStatuses.length > 0;

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
          <Badge tone={STATUS_TONE[row.status]}>
            <span className="uppercase">
              <T k={APPLICANT_STATUS_LABELS[row.status]} />
            </span>
          </Badge>
          {chainLength > 1 && row.status === 'interview' && row.currentLevel > 0 && (
            <span className="mt-0.5 block text-[10px] text-slate-500">
              <T k="hr.approval.progress" vars={{ level: row.currentLevel, total: chainLength }} />
            </span>
          )}
        </td>
        <td className="px-2 py-2 pr-4">
          <RowActions>
            {canAdvance && can(SCREEN, 'edit') && (
              <RowAction
                icon={<MoveRight className="size-4" aria-hidden />}
                label={t('recruit.applicant.action.advance')}
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
            {can(SCREEN, 'delete') && row.staffId === null && (
              <RowAction
                icon={<Trash2 className="size-4" aria-hidden />}
                label={t('recruit.applicant.action.delete')}
                tone="danger"
                onClick={async () => {
                  try {
                    await recruitmentApi.deleteApplicant(row.id);
                    await onChanged(`${row.applicantNo} dibuang.`);
                  } catch (cause) {
                    onError(cause instanceof Error ? cause.message : '');
                  }
                }}
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

            {live && can(SCREEN, 'delete') && (
              <PanelNote tone="danger" className="mt-2">
                <T k="recruit.applicant.note.delete" />
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
        fullName,
        ...(icNo === '' ? {} : { icNo }),
        ...(email === '' ? {} : { email }),
        ...(phone === '' ? {} : { phone }),
        ...(coverNote === '' ? {} : { coverNote }),
      });
      await onDone(`${created.applicantNo} direkodkan.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="recruit.applicant.form.title" />}
      titleText={t('recruit.applicant.form.title')}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {postings.length === 0 ? (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="recruit.applicant.form.posting.hint" />
          </PanelNote>
        ) : (
          <FacetSelect
            label={t('recruit.applicant.form.posting')}
            value={postingId}
            onChange={setPostingId}
            options={postings.map((row) => ({
              value: String(row.id),
              label: `${row.code} — ${row.title}`,
            }))}
          />
        )}

        <Field
          label={<T k="recruit.applicant.form.fullName" />}
          value={fullName}
          maxLength={190}
          onChange={(event) => setFullName(event.target.value)}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k="recruit.applicant.form.icNo" />}
            hint={<T k="recruit.applicant.form.icNo.hint" />}
            value={icNo}
            maxLength={20}
            onChange={(event) => setIcNo(event.target.value)}
          />
          <Field
            label={<T k="recruit.applicant.form.phone" />}
            value={phone}
            maxLength={20}
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>

        <Field
          label={<T k="recruit.applicant.form.email" />}
          type="email"
          value={email}
          maxLength={190}
          onChange={(event) => setEmail(event.target.value)}
        />

        <div>
          <label htmlFor="applicant-cover" className="block text-sm font-medium text-slate-700">
            <T k="recruit.applicant.form.coverNote" />
          </label>
          <textarea
            id="applicant-cover"
            rows={4}
            value={coverNote}
            maxLength={4000}
            onChange={(event) => setCoverNote(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

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
        ...(note === '' ? {} : { note }),
        ...(interviewAt === '' ? {} : { interviewAt: new Date(interviewAt).toISOString() }),
      });
      await onDone(`${target.applicantNo}: ${t(APPLICANT_STATUS_LABELS[status])}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
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

        <FacetSelect
          label={t('recruit.advance.status')}
          value={status}
          onChange={(value) => setStatus(value as ApplicantStatus)}
          options={options.map((value) => ({
            value,
            label: t(APPLICANT_STATUS_LABELS[value]),
          }))}
        />

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
        ...(note === '' ? {} : { note }),
      });

      const base = !approve
        ? `${target.applicantNo} tidak berjaya.`
        : result.finalized
          ? `${target.applicantNo} ditawarkan jawatan.`
          : `${target.applicantNo}: ${t('hr.approval.progress', {
              level: result.level,
              total: result.totalLevels,
            })}.`;
      await onDone(base);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
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
        employeeNo,
        hireDate,
        ...(position === '' ? {} : { position }),
        departmentId: departmentId === '' ? null : Number(departmentId),
        locationId: locationId === '' ? null : Number(locationId),
      });
      await onDone(
        t('recruit.hire.done', { name: target.fullName, employeeNo: result.employeeNo }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

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
        {(target.icNo === null || target.icNo.trim() === '') && (
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

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={<T k="recruit.hire.employeeNo" />}
            value={employeeNo}
            maxLength={32}
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

        <div className="grid gap-3 sm:grid-cols-2">
          <FacetSelect
            label={t('recruit.hire.department')}
            value={departmentId}
            onChange={setDepartmentId}
            options={(lookups?.departments ?? []).map((row) => ({
              value: String(row.id),
              label: row.name,
            }))}
          />
          <FacetSelect
            label={t('recruit.hire.location')}
            value={locationId}
            onChange={setLocationId}
            options={(lookups?.locations ?? []).map((row) => ({
              value: String(row.id),
              label: row.name,
            }))}
          />
        </div>

        <PanelNote tone="warn">
          <T k="recruit.applicant.note.hired" />
        </PanelNote>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={employeeNo.trim() === '' || target.icNo === null || target.icNo.trim() === ''}
          submitLabel={<T k="recruit.hire.submit" />}
        />
      </div>
    </Dialog>
  );
}
