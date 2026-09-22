import {
  CircleAlert,
  CircleCheck,
  Download,
  FileUp,
  Loader2,
  Play,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Feedback } from '../components/Dialog';
import {
  PanelBody,
  PanelCard,
  PanelNote,
  PanelSection,
} from '../components/RecordPanel';
import { Button, StatTile } from '../components/ui';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { lookupsApi, type Lookups } from '../lib/operations-api';
import { T, useLabels } from '../lib/translation';

interface RowProblem {
  line: number;
  employeeNo: string;
  field: string;
  message: string;
}

interface ImportPreview {
  totalLines: number;
  valid: Array<{ employeeNo: string; fullName: string }>;
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

/**
 * Bulk staff import.
 *
 * Two explicit steps: validate, then commit. With thousands of rows a single
 * combined action means a bad column on row 4000 leaves the directory half
 * populated, so nothing is written until the operator has seen every problem.
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
  const { t } = useLabels();

  useEffect(() => {
    void lookupsApi.load().then(setLookups).catch(() => undefined);
  }, []);

  // Polled while running. The import performs thousands of sequential device
  // calls, so an open HTTP request would time out long before it finished.
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

  async function pick(file: File): Promise<void> {
    setError(null);
    setPreview(null);
    setJob(null);
    setFileName(file.name);

    const text = await file.text();
    setCsv(text);
    setBusy(true);

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

  const toCreate =
    preview === null ? 0 : preview.valid.length - preview.existing.length;
  const canCommit = preview !== null && preview.problems.length === 0 && toCreate > 0;

  return (
    <PanelCard title={<T k="import.title" />} subtitle={<T k="import.subtitle" />}>
      <PanelSection title={<T k="import.step1" />} subtitle={<T k="import.step1.subtitle" />} />

      <PanelBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void pick(file);
            }}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={busy}>
            <FileUp className="size-4" aria-hidden />
            <T k="import.pick" />
          </Button>
          <a
            href="/api/staff/import/template"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="size-4" aria-hidden />
            <T k="import.template" />
          </a>
          {fileName !== null && (
            <span className="text-sm text-slate-600">{fileName}</span>
          )}
          {busy && <Loader2 className="size-4 animate-spin text-slate-400" aria-hidden />}
        </div>
        <PanelNote>
          <T k="import.commas" />
        </PanelNote>

        <Feedback error={error} />
      </PanelBody>

      {preview !== null && (
        <>
          <PanelSection
            title={<T k="import.preview.title" />}
            subtitle={<T k="import.preview.subtitle" />}
          />

          <PanelBody className="grid gap-4 sm:grid-cols-4">
            <StatTile
              label={<T k="import.stat.linesRead" />}
              value={String(preview.totalLines)}
            />
            <StatTile
              label={<T k="import.stat.valid" />}
              value={String(preview.valid.length)}
              tone={preview.valid.length > 0 ? 'success' : 'neutral'}
            />
            <StatTile
              label={<T k="import.stat.errors" />}
              value={String(preview.problems.length)}
              tone={preview.problems.length > 0 ? 'danger' : 'neutral'}
            />
            {/*
              Existing rows are skipped, never overwritten. Re-running an import
              after fixing a few rows is a normal thing to do, and it must not
              rewrite records somebody has since edited.
            */}
            <StatTile
              label={<T k="import.stat.existing" />}
              value={String(preview.existing.length)}
              hint={<T k="import.stat.existing.hint" />}
            />
          </PanelBody>

          {preview.problems.length > 0 && (
            <>
              <PanelSection
                title={
                  <T k="import.problems.title" vars={{ count: preview.problems.length }} />
                }
                subtitle={<T k="import.problems.subtitle" />}
              />
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t('import.problems.caption')}</caption>
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs tracking-wide text-slate-500 uppercase">
                      <th scope="col" className="py-2 pr-3 font-medium">
                        <T k="import.problems.column.line" />
                      </th>
                      <th scope="col" className="py-2 pr-3 font-medium">
                        <T k="import.problems.column.employeeNo" />
                      </th>
                      <th scope="col" className="py-2 pr-3 font-medium">
                        <T k="import.problems.column.field" />
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        <T k="import.problems.column.message" />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.problems.slice(0, 200).map((problem, index) => (
                      <tr
                        key={`${problem.line}-${problem.field}-${index}`}
                        className="border-b border-slate-100 last:border-0 [&>td]:py-2 [&>td]:pr-3"
                      >
                        <td className="font-mono text-xs tabular-nums text-slate-600">
                          {problem.line}
                        </td>
                        <td className="font-mono text-xs">{problem.employeeNo || '—'}</td>
                        <td className="text-slate-600">{problem.field}</td>
                        <td className="text-rose-700">{problem.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.problems.length > 200 && (
                  <p className="px-5 pt-2 text-xs text-slate-500">
                    <T k="import.problems.capped" vars={{ total: preview.problems.length }} />
                  </p>
                )}
              </div>
            </>
          )}

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

          <PanelSection
            title={<T k="import.step2" />}
            subtitle={<T k="import.step2.subtitle" />}
          />

          <PanelBody className="space-y-3">
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-slate-700">
                <T k="import.devices" />
              </legend>
              <div className="space-y-1.5">
                {(lookups?.devices ?? []).map((device) => (
                  <label key={device.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={deviceIds.includes(device.id)}
                      onChange={() =>
                        setDeviceIds((current) =>
                          current.includes(device.id)
                            ? current.filter((id) => id !== device.id)
                            : [...current, device.id],
                        )
                      }
                      className="size-4 rounded border-slate-300"
                    />
                    {device.name}
                  </label>
                ))}
              </div>
            </fieldset>

            <Button onClick={() => void commit()} disabled={!canCommit || busy || job !== null}>
              <Play className="size-4" aria-hidden />
              <T k="import.commit" vars={{ count: toCreate }} />
            </Button>
            {!canCommit && preview.problems.length === 0 && toCreate === 0 && (
              <PanelNote>
                <T k="import.allExisting" />
              </PanelNote>
            )}
          </PanelBody>
        </>
      )}

      {job !== null && (
        <>
          <PanelSection
            title={<T k="import.step3" />}
            subtitle={<T k="import.step3.subtitle" />}
            action={
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
                  job.status === 'running' && 'bg-sky-50 text-sky-700',
                  job.status === 'done' && 'bg-emerald-50 text-emerald-700',
                  job.status === 'failed' && 'bg-rose-50 text-rose-700',
                )}
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
              </span>
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

            {job.error !== undefined && (
              <p role="alert" className="text-sm text-rose-700">
                {job.error}
              </p>
            )}

            {job.failures.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-900">
                  <CircleAlert className="size-3.5" aria-hidden />
                  <T k="import.failures.heading" />
                </p>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-amber-900">
                  {job.failures.map((failure, index) => (
                    <li key={`${failure.employeeNo}-${index}`} className="font-mono">
                      {failure.employeeNo} → {failure.deviceName}: {failure.error.slice(0, 70)}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs text-amber-800">
                  <T k="import.failures.hint" />
                </p>
              </div>
            )}

            {job.status === 'done' && job.pushFailed === 0 && (
              <PanelNote tone="success" icon={<CircleCheck className="size-3.5" aria-hidden />}>
                <T k="import.done" />
              </PanelNote>
            )}
          </PanelBody>
        </>
      )}
    </PanelCard>
  );
}
