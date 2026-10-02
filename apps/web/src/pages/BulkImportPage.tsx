import type { LabelKey } from '@attendance/shared';
import { CircleCheck, Download, FileUp, Loader2, Play, ScanFace, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Feedback } from '../components/Dialog';
import {
  ChipBar,
  FilterRow,
  PanelActions,
  PanelBody,
  PanelCard,
  PanelFooter,
  PanelNote,
  PanelSection,
  RecordTable,
} from '../components/RecordPanel';
import { Badge, Button, CheckCard, StatTile } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { lookupsApi, type Lookups } from '../lib/operations-api';
import { T, TEnum, useLabels } from '../lib/translation';

const SCREEN = 'staff.import';

interface RowProblem {
  line: number;
  employeeNo: string;
  fullName: string;
  field: string;
  message: string;
}

interface PreviewRow {
  line: number;
  employeeNo: string;
  fullName: string;
  department: string | null;
  location: string | null;
}

interface ImportPreview {
  totalLines: number;
  valid: PreviewRow[];
  problems: RowProblem[];
  existing: string[];
  newDepartments: string[];
  newLocations: string[];
}

interface ImportProgress {
  jobId: string;
  status: 'running' | 'done' | 'failed';
  total: number;
  created: number;
  skipped: number;
  pushed: number;
  pushFailed: number;
  error?: string;
  failures: Array<{ employeeNo: string; deviceName: string; error: string }>;
}

/** What committing would do with one line of the file. */
type LineState = 'create' | 'existing' | 'problem';

interface PreviewLine {
  line: number;
  employeeNo: string;
  fullName: string;
  department: string | null;
  location: string | null;
  state: LineState;
  problems: Array<{ field: string; message: string }>;
}

/** One key per state, shared by the chip and the row badge: it is the same state. */
const STATE_LABELS: Record<LineState, LabelKey> = {
  create: 'import.state.create',
  existing: 'import.state.existing',
  problem: 'import.state.problem',
};

const STATE_TONES: Record<LineState, 'success' | 'neutral' | 'danger'> = {
  create: 'success',
  existing: 'neutral',
  problem: 'danger',
};

const STATE_DOTS: Record<LineState, string> = {
  create: 'bg-emerald-500',
  existing: 'bg-slate-400',
  problem: 'bg-rose-500',
};

const STATE_ORDER: LineState[] = ['create', 'existing', 'problem'];

/**
 * The CSV column a problem is about, named in the reader's language.
 *
 * The server reports its own field key — `doorPin`, `basicSalary` — and those were printed on the
 * screen as they came. The header row accepts both languages, so naming the column the way the
 * step-one subtitle does is naming it the way the operator will find it in the file.
 */
const FIELD_LABELS: Record<string, LabelKey> = {
  employeeNo: 'import.field.employeeNo',
  fullName: 'import.field.fullName',
  icNo: 'import.field.icNo',
  phone: 'import.field.phone',
  email: 'import.field.email',
  department: 'import.field.department',
  location: 'import.field.location',
  doorPin: 'import.field.doorPin',
  basicSalary: 'import.field.basicSalary',
  header: 'import.field.header',
  row: 'import.field.row',
};

/**
 * One row per line of the file, in file order.
 *
 * Problems are grouped by line, so a row with three bad cells is one row with three reasons rather
 * than three rows that look like three people.
 */
function previewLines(preview: ImportPreview): PreviewLine[] {
  const existing = new Set(preview.existing);
  const byLine = new Map<number, PreviewLine>();

  for (const row of preview.valid) {
    byLine.set(row.line, {
      ...row,
      state: existing.has(row.employeeNo) ? 'existing' : 'create',
      problems: [],
    });
  }

  for (const problem of preview.problems) {
    const current = byLine.get(problem.line);
    if (current !== undefined) {
      current.state = 'problem';
      current.problems.push({ field: problem.field, message: problem.message });
      continue;
    }
    byLine.set(problem.line, {
      line: problem.line,
      employeeNo: problem.employeeNo,
      fullName: problem.fullName,
      department: null,
      location: null,
      state: 'problem',
      problems: [{ field: problem.field, message: problem.message }],
    });
  }

  return [...byLine.values()].sort((left, right) => left.line - right.line);
}

/**
 * Bulk staff import.
 *
 * Two explicit steps: validate, then commit. With thousands of rows a single combined action means
 * a bad column on row 4000 leaves the directory half populated, so nothing is written until the
 * operator has seen every problem.
 */
export function BulkImportPage(): ReactNode {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [deviceIds, setDeviceIds] = useState<number[]>([]);
  const [job, setJob] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<LineState | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const { t } = useLabels();
  const { can } = useAuth();
  const mayImport = can(SCREEN, 'create');

  useEffect(() => {
    void lookupsApi
      .load()
      .then(setLookups)
      .catch(() => undefined);
  }, []);

  // Polled while running. The import performs thousands of sequential device calls, so an open
  // HTTP request would time out long before it finished.
  useEffect(() => {
    if (job === null || job.status !== 'running') return;

    const timer = setInterval(() => {
      void (async () => {
        try {
          setJob(await api.get<ImportProgress>(`/api/staff/import/status/${job.jobId}`));
        } catch {
          // The job expires after a while; stop polling rather than erroring.
          clearInterval(timer);
        }
      })();
    }, 1000);

    return () => clearInterval(timer);
  }, [job]);

  async function runPreview(text: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/staff/import/preview', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'text/csv' },
        body: text,
      });
      const payload = (await response.json()) as ImportPreview & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? t('import.error.status', { status: response.status }));
        return;
      }
      setPreview(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('import.error.read'));
    } finally {
      setBusy(false);
    }
  }

  async function pick(file: File): Promise<void> {
    setPreview(null);
    setJob(null);
    setState(undefined);
    setSearch('');
    setPage(1);
    setFileName(file.name);

    const text = await file.text();
    setCsv(text);
    await runPreview(text);
  }

  async function commit(): Promise<void> {
    if (csv === null) return;
    setBusy(true);
    setError(null);
    try {
      setJob(
        await api.post<ImportProgress>('/api/staff/import/commit', {
          csv,
          deviceIds,
          skipExisting: true,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('import.error.start'));
    } finally {
      setBusy(false);
    }
  }

  const lines = useMemo(() => (preview === null ? [] : previewLines(preview)), [preview]);

  const needle = search.trim().toLowerCase();
  const searched = lines.filter(
    (line) =>
      needle.length === 0 ||
      line.employeeNo.toLowerCase().includes(needle) ||
      line.fullName.toLowerCase().includes(needle),
  );
  // Counted over the search but not over the chip, so choosing one does not zero the others.
  const counts: Record<LineState, number> = { create: 0, existing: 0, problem: 0 };
  for (const line of searched) counts[line.state] += 1;
  const filtered = state === undefined ? searched : searched.filter((line) => line.state === state);
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize);

  const toCreate = lines.filter((line) => line.state === 'create').length;
  const problemLines = lines.filter((line) => line.state === 'problem').length;
  const existingLines = lines.filter((line) => line.state === 'existing').length;
  const canCommit = preview !== null && problemLines === 0 && toCreate > 0;

  /*
   * Why the commit button is grey, said beside it and on it. It used to be grey with a note only for
   * the all-existing case; with errors in the file there was nothing at the button at all.
   */
  const blockedReason =
    preview === null
      ? undefined
      : problemLines > 0
        ? t('import.blocked.problems', { count: problemLines })
        : toCreate === 0
          ? t('import.allExisting')
          : undefined;

  const devices = lookups?.devices ?? [];

  return (
    <PanelCard title={<T k="import.title" />} subtitle={<T k="import.subtitle" />}>
      <PanelSection
        title={<T k="import.step1" />}
        subtitle={<T k="import.step1.subtitle" />}
        action={
          can(SCREEN, 'template') ? (
            <a
              href="/api/staff/import/template"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium whitespace-nowrap text-slate-700 hover:bg-slate-50"
            >
              <Download className="size-4" aria-hidden />
              <T k="import.template" />
            </a>
          ) : undefined
        }
      />

      <PanelBody className="space-y-3">
        {mayImport && (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Cleared so picking the same file again — after fixing it — fires again.
                event.target.value = '';
                if (file) void pick(file);
              }}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => fileRef.current?.click()} disabled={busy || job?.status === 'running'}>
                <FileUp className="size-4" aria-hidden />
                <T k="import.pick" />
              </Button>
              {fileName !== null && (
                <span className="font-mono text-xs text-slate-600">{fileName}</span>
              )}
              {busy && (
                <Loader2 className="size-4 animate-spin text-slate-400" aria-label={t('app.loading')} />
              )}
            </div>
            {/* A format rule for the one input on this step, so it is that input's hint. */}
            <p className="mt-1.5 text-xs text-slate-500">
              <T k="import.commas" />
            </p>
          </div>
        )}

        <Feedback error={error} />
      </PanelBody>

      {preview !== null && (
        <>
          <PanelSection
            title={<T k="import.preview.count" vars={{ count: preview.totalLines }} />}
            subtitle={<T k="import.preview.subtitle" />}
          />

          <ChipBar
            active={state}
            onChange={(id) => {
              setState(id as LineState | undefined);
              setPage(1);
            }}
            chips={STATE_ORDER.map((id) => ({
              id,
              label: <T k={STATE_LABELS[id]} />,
              count: counts[id],
              dot: STATE_DOTS[id],
            }))}
          />

          <FilterRow
            search={search}
            onSearch={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder={t('import.preview.search')}
            dirty={search.length > 0 || state !== undefined}
            onReset={() => {
              setSearch('');
              setState(undefined);
              setPage(1);
            }}
          />

          {/* The one note on the preview: committing creates these, and nobody asked for them by name. */}
          {(preview.newDepartments.length > 0 || preview.newLocations.length > 0) && (
            <PanelBody className="pb-0">
              <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                <T k="import.newRefs" />
                {preview.newDepartments.length > 0 && (
                  <span className="mt-1 block">
                    <T
                      k="import.newRefs.departments"
                      vars={{ names: preview.newDepartments.join(', ') }}
                    />
                  </span>
                )}
                {preview.newLocations.length > 0 && (
                  <span className="block">
                    <T
                      k="import.newRefs.locations"
                      vars={{ names: preview.newLocations.join(', ') }}
                    />
                  </span>
                )}
              </PanelNote>
            </PanelBody>
          )}

          <RecordTable
            framed
            loading={false}
            rowCount={filtered.length}
            empty={<T k="import.preview.empty" />}
            columns={[
              { header: <T k="import.column.line" />, width: 'w-20' },
              { header: <T k="staff.column.employeeNo" />, width: 'w-32' },
              { header: <T k="staff.column.name" /> },
              { header: <T k="staff.column.department" />, width: 'w-44' },
              { header: <T k="staff.column.location" />, width: 'w-40' },
              { header: <T k="panel.column.status" />, width: 'w-32' },
            ]}
          >
            {shown.map((line) => (
              <tr
                key={line.line}
                className={cn(
                  'border-b border-slate-100 hover:bg-slate-50/70',
                  line.state === 'problem' && 'bg-rose-50/40',
                )}
              >
                <td className="px-5 py-2.5 font-mono text-xs text-slate-500 tabular-nums">
                  {line.line}
                </td>
                <td className="px-2 py-2.5 font-mono text-xs text-slate-700">
                  {line.employeeNo.length > 0 ? line.employeeNo : '—'}
                </td>
                <td className="px-2 py-2.5">
                  {/* The name as parsed: an unquoted comma shows up here as half a name. */}
                  <span className="block text-slate-800">
                    {line.fullName.length > 0 ? line.fullName : '—'}
                  </span>
                  {line.problems.map((problem, index) => (
                    <span key={index} className="mt-0.5 block text-xs text-rose-700">
                      <T
                        k="import.problem"
                        vars={{
                          field: <TEnum k={FIELD_LABELS[problem.field]} fallback={problem.field} />,
                          message: problem.message,
                        }}
                      />
                    </span>
                  ))}
                </td>
                <td className="px-2 py-2.5 text-xs text-slate-600">{line.department ?? '—'}</td>
                <td className="px-2 py-2.5 text-xs text-slate-600">{line.location ?? '—'}</td>
                <td className="px-2 py-2.5">
                  <Badge tone={STATE_TONES[line.state]} className="uppercase">
                    <T k={STATE_LABELS[line.state]} />
                  </Badge>
                </td>
              </tr>
            ))}
          </RecordTable>

          <PanelFooter
            shown={shown.length}
            total={filtered.length}
            page={page}
            pageSize={pageSize}
            pageSizes={[50, 100, 200]}
            loading={busy}
            onPage={setPage}
            onPageSize={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            // Re-reads the same file against the directory as it is now.
            onRefresh={() => {
              if (csv !== null) void runPreview(csv);
            }}
          />

          <PanelSection
            title={<T k="import.step2" />}
            subtitle={<T k="import.step2.subtitle" />}
          />

          <PanelBody>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium text-slate-700">
                <T k="import.devices" />
              </legend>
              {devices.length === 0 ? (
                <p className="text-xs text-slate-500">
                  <T k="staffForm.devices.none" />
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {devices.map((device) => (
                    <CheckCard
                      key={device.id}
                      checked={deviceIds.includes(device.id)}
                      disabled={job !== null}
                      onChange={() =>
                        setDeviceIds((current) =>
                          current.includes(device.id)
                            ? current.filter((id) => id !== device.id)
                            : [...current, device.id],
                        )
                      }
                      icon={<ScanFace className="size-4" aria-hidden />}
                      title={device.name}
                    />
                  ))}
                </div>
              )}
            </fieldset>
          </PanelBody>

          {mayImport && (
            <PanelActions
              hint={
                blockedReason ??
                (existingLines > 0 ? (
                  <T k="import.commit.hint.existing" vars={{ count: existingLines }} />
                ) : (
                  <T k="import.commit.hint" />
                ))
              }
            >
              <Button
                onClick={() => void commit()}
                disabled={!canCommit || busy || job !== null}
                {...(blockedReason === undefined ? {} : { title: blockedReason })}
              >
                <Play className="size-4" aria-hidden />
                <T k="import.commit" vars={{ count: toCreate }} />
              </Button>
            </PanelActions>
          )}
        </>
      )}

      {job !== null && (
        <>
          <PanelSection
            title={<T k="import.step3" />}
            subtitle={<T k="import.step3.subtitle" />}
            action={
              <Badge
                tone={
                  job.status === 'running' ? 'info' : job.status === 'done' ? 'success' : 'danger'
                }
                className="uppercase"
              >
                <T
                  k={
                    job.status === 'running'
                      ? 'import.status.running'
                      : job.status === 'done'
                        ? 'import.status.done'
                        : 'import.status.failed'
                  }
                />
              </Badge>
            }
          />

          <PanelBody className="space-y-3">
            <div
              className="h-2 overflow-hidden rounded-full bg-slate-200"
              role="progressbar"
              aria-valuenow={job.created + job.skipped}
              aria-valuemin={0}
              aria-valuemax={job.total}
              aria-label={t('import.progress.aria')}
            >
              <div
                className="h-full bg-emerald-500 transition-[width]"
                style={{
                  width: `${job.total === 0 ? 100 : Math.round(((job.created + job.skipped) / job.total) * 100)}%`,
                }}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <StatTile
                label={<T k="import.stat.created" />}
                value={String(job.created)}
                tone="success"
              />
              <StatTile label={<T k="import.stat.skipped" />} value={String(job.skipped)} />
              <StatTile label={<T k="import.stat.pushed" />} value={String(job.pushed)} />
              <StatTile
                label={<T k="import.stat.pushFailed" />}
                value={String(job.pushFailed)}
                tone={job.pushFailed > 0 ? 'warning' : 'neutral'}
              />
            </div>

            <Feedback error={job.error ?? null} />

            {job.status === 'done' && job.pushFailed === 0 && (
              <PanelNote tone="success" icon={<CircleCheck className="size-3.5" aria-hidden />}>
                <T k="import.done" />
              </PanelNote>
            )}
          </PanelBody>

          {job.failures.length > 0 && (
            <>
              <PanelSection
                title={<T k="import.failures.count" vars={{ count: job.pushFailed }} />}
                subtitle={<T k="import.failures.hint" />}
              />

              <RecordTable
                framed
                loading={false}
                rowCount={job.failures.length}
                empty={null}
                columns={[
                  { header: <T k="staff.column.employeeNo" />, width: 'w-32' },
                  { header: <T k="import.failures.column.terminal" />, width: 'w-48' },
                  { header: <T k="import.failures.column.error" /> },
                ]}
              >
                {job.failures.map((failure, index) => (
                  <tr
                    key={`${failure.employeeNo}-${failure.deviceName}-${String(index)}`}
                    className="border-b border-slate-100 bg-amber-50/40"
                  >
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-700">
                      {failure.employeeNo}
                    </td>
                    <td className="px-2 py-2.5 text-xs text-slate-700">{failure.deviceName}</td>
                    <td className="px-2 py-2.5 font-mono text-[11px] text-amber-900">
                      {failure.error}
                    </td>
                  </tr>
                ))}
              </RecordTable>

              {/* Capped at a hundred on the server, so the footer says how many are not listed. */}
              <PanelFooter
                shown={job.failures.length}
                total={job.pushFailed}
                page={1}
                pageSize={Math.max(1, job.failures.length)}
                pageSizes={[Math.max(1, job.failures.length)]}
                loading={job.status === 'running'}
                onPage={() => undefined}
                onPageSize={() => undefined}
                onRefresh={() => {
                  void api
                    .get<ImportProgress>(`/api/staff/import/status/${job.jobId}`)
                    .then(setJob)
                    .catch(() => undefined);
                }}
              />
            </>
          )}
        </>
      )}
    </PanelCard>
  );
}
