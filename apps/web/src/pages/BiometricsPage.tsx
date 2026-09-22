import {
  CircleAlert,
  CircleCheck,
  Loader2,
  ScanFace,
  Trash2,
  Upload,
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
import { Button } from '../components/ui';
import { api, staffApi, type StaffPage, type StaffRow } from '../lib/api';
import { cn } from '../lib/cn';
import {
  FACE_LIMITS,
  defaultCrop,
  loadImage,
  prepareFaceImage,
  type CropRect,
  type PreparedFace,
} from '../lib/face-image';
import { lookupsApi, type Lookups } from '../lib/operations-api';
import { T, useLabels } from '../lib/translation';

interface FaceResult {
  deviceId: number;
  deviceName: string;
  ok: boolean;
  error?: string;
}

/**
 * Face enrolment.
 *
 * The picture is stored on the terminals, not here. Each unit matches locally against
 * its own copy, so enrolling sends the same image to every terminal the person is
 * assigned to.
 */
export function BiometricsPage(): ReactNode {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<StaffPage['counts'] | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  // Defaults to the people who cannot scan. That is the working queue; the full
  // directory is one click away but is not what this screen is for.
  const [scope, setScope] = useState<string | undefined>('missing');
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [active, setActive] = useState<StaffRow | null>(null);
  const { t } = useLabels();

  useEffect(() => {
    void lookupsApi
      .load()
      .then(setLookups)
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await staffApi.list({
        page,
        pageSize,
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(departmentId ? { departmentId: Number(departmentId) } : {}),
        // Both states filter now. Selecting "enrolled" used to send nothing, so the chip
        // labelled "face enrolled" listed every staff member including those without one.
        ...(scope === 'missing'
          ? ({ biometrics: 'missing' } as const)
          : scope === 'enrolled'
            ? ({ biometrics: 'enrolled' } as const)
            : {}),
      });
      setRows(result.rows);
      setCounts(result.counts);
      setTotal(result.total);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('biometrics.error.load'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, departmentId, scope, t]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <PanelCard title={<T k="biometrics.title" />} subtitle={<T k="biometrics.subtitle" />}>
      <PanelSection
        title={
          <T
            k={
              scope === 'missing'
                ? 'biometrics.count.missing'
                : scope === 'enrolled'
                  ? 'biometrics.count.enrolled'
                  : 'biometrics.count.all'
            }
            vars={{ count: new Intl.NumberFormat('ms-MY').format(total) }}
          />
        }
        subtitle={
          <T
            k="biometrics.limits"
            vars={{ maxKb: FACE_LIMITS.maxKb, minPixels: FACE_LIMITS.minPixels }}
          />
        }
      />

      <ChipBar
        active={scope}
        onChange={(id) => {
          setScope(id);
          setPage(1);
        }}
        /*
          Both counts come from the server and neither depends on the selected chip. They
          used to be `scope === 'missing' ? total : 0` and its mirror, so whichever chip was
          not selected read zero — the enrolled chip has never shown a real number.
        */
        chips={[
          {
            id: 'missing',
            label: <T k="biometrics.chip.missing" />,
            count: counts?.missingBiometrics ?? 0,
            dot: 'bg-rose-500',
          },
          {
            id: 'enrolled',
            label: <T k="biometrics.chip.enrolled" />,
            count: counts?.withBiometrics ?? 0,
            dot: 'bg-emerald-500',
          },
        ]}
      />

      <FilterRow
        search={search}
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        placeholder={t('staff.search')}
        dirty={search.length > 0 || departmentId.length > 0 || scope !== 'missing'}
        onReset={() => {
          setSearch('');
          setDepartmentId('');
          setScope('missing');
          setPage(1);
        }}
      >
        <FacetSelect
          label={t('staff.filter.allDepartments')}
          value={departmentId}
          onChange={(value) => {
            setDepartmentId(value);
            setPage(1);
          }}
          options={(lookups?.departments ?? []).map((row) => ({
            value: String(row.id),
            label: row.name,
          }))}
        />
      </FilterRow>

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <RecordTable
        loading={loading}
        rowCount={rows.length}
        empty={
          <T k={scope === 'missing' ? 'biometrics.empty.missing' : 'biometrics.empty.all'} />
        }
        columns={[
          { header: <T k="staff.column.employeeNo" />, width: 'w-28' },
          { header: <T k="staff.column.name" /> },
          { header: <T k="staff.column.department" />, width: 'w-44' },
          { header: <T k="biometrics.column.face" />, width: 'w-28' },
          { header: <T k="biometrics.column.canScan" />, width: 'w-28' },
          { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <BiometricRow
            key={row.id}
            row={row}
            expanded={open === row.id}
            onToggle={() => setOpen(open === row.id ? null : row.id)}
            onEnrol={() => setActive(row)}
          />
        ))}
      </RecordTable>

      <PanelFooter
        shown={rows.length}
        total={total}
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

      {active !== null && (
        <FaceDialog
          staff={active}
          onClose={() => setActive(null)}
          onDone={async (message) => {
            setActive(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </PanelCard>
  );
}

function BiometricRow({
  row,
  expanded,
  onToggle,
  onEnrol,
}: {
  row: StaffRow;
  expanded: boolean;
  onToggle: () => void;
  onEnrol: () => void;
}): ReactNode {
  const { t } = useLabels();
  const canScan = row.numOfFace > 0 || row.numOfFp > 0 || row.numOfCard > 0;

  return (
    <>
      <tr
        className={cn(
          'border-b border-slate-100',
          expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
          !canScan && !expanded && 'bg-rose-50/40',
        )}
      >
        <td className="px-5 py-2 font-mono text-xs text-slate-600">{row.employeeNo}</td>
        <td className="px-2 py-2 font-medium text-slate-800">{row.fullName}</td>
        <td className="px-2 py-2 text-xs text-slate-600">{row.department?.name ?? '—'}</td>
        <td className="px-2 py-2">
          <span
            className={cn(
              'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
              row.numOfFace > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800',
            )}
          >
            <span className="uppercase">
              <T k={row.numOfFace > 0 ? 'biometrics.face.enrolled' : 'biometrics.face.none'} />
            </span>
          </span>
        </td>
        <td className="px-2 py-2 text-xs">
          {canScan ? (
            <span className="text-emerald-700">
              <T k="biometrics.canScan.yes" />
            </span>
          ) : (
            <span className="font-medium text-rose-700">
              <T k="biometrics.canScan.no" />
            </span>
          )}
        </td>
        <td className="px-2 py-2 pr-4">
          <RowActions>
            <RowAction
              icon={<ScanFace className="size-4" aria-hidden />}
              label={t(row.numOfFace > 0 ? 'biometrics.row.replace' : 'biometrics.row.enrol')}
              tone={row.numOfFace > 0 ? 'edit' : 'success'}
              onClick={onEnrol}
            />
            <ExpandButton
              expanded={expanded}
              onClick={onToggle}
              label={t('biometrics.row.expand')}
            />
          </RowActions>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={6} className="px-5 py-3">
            <div className="flex flex-wrap items-start gap-4">
              {row.numOfFace > 0 && (
                <img
                  src={`/api/staff/${String(row.id)}/face`}
                  alt={t('biometrics.row.faceAlt', { name: row.fullName })}
                  className="size-24 rounded-lg border border-slate-200 bg-slate-100 object-cover"
                />
              )}
              <div className="min-w-64 flex-1">
                <DetailGrid>
                  <Detail label={<T k="staff.detail.faces" />} value={String(row.numOfFace)} />
                  <Detail
                    label={<T k="staff.detail.fingerprints" />}
                    value={String(row.numOfFp)}
                  />
                  <Detail label={<T k="staff.detail.cards" />} value={String(row.numOfCard)} />
                  {/*
                    The fourth credential, listed beside the three counts it was missing from.
                    Not a count: it is a yes or no from our own record, because the PIN is the
                    one credential this system writes rather than reads back.
                  */}
                  <Detail
                    label={<T k="staff.detail.doorPin" />}
                    value={
                      <T
                        k={
                          row.hasDoorPin
                            ? 'staff.biometric.pin.present'
                            : 'staff.biometric.pin.absent'
                        }
                      />
                    }
                  />
                  <Detail
                    label={<T k="staff.detail.location" />}
                    value={row.location?.name ?? '—'}
                  />
                  <Detail
                    label={<T k="biometrics.detail.active" />}
                    value={
                      <T
                        k={
                          row.active
                            ? 'biometrics.detail.active.yes'
                            : 'biometrics.detail.active.no'
                        }
                      />
                    }
                  />
                  <Detail label={<T k="staff.detail.staffId" />} value={String(row.id)} mono />
                </DetailGrid>
              </div>
            </div>

            {!canScan && (
              <PanelNote tone="danger" className="mt-3">
                <T k="biometrics.detail.blockedWarning" />
              </PanelNote>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function FaceDialog({
  staff,
  onClose,
  onDone,
}: {
  staff: StaffRow;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [prepared, setPrepared] = useState<PreparedFace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<FaceResult[] | null>(null);
  const { t } = useLabels();

  // Object URLs are revoked so a long enrolment session does not leak memory.
  useEffect(() => {
    return () => {
      if (prepared) URL.revokeObjectURL(prepared.previewUrl);
    };
  }, [prepared]);

  async function pick(file: File): Promise<void> {
    setError(null);
    setResults(null);
    try {
      const loaded = await loadImage(file);
      const initial = defaultCrop(loaded);
      setImage(loaded);
      setCrop(initial);
      setPrepared(await prepareFaceImage(loaded, initial));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('biometrics.error.image'));
    }
  }

  async function adjust(zoom: number): Promise<void> {
    if (!image || !crop) return;
    const edge = Math.min(image.naturalWidth, image.naturalHeight);
    const size = Math.round(edge * zoom);
    const next: CropRect = {
      x: Math.round((image.naturalWidth - size) / 2),
      y: Math.round((image.naturalHeight - size) / 2),
      width: size,
      height: size,
    };
    setCrop(next);
    try {
      setPrepared(await prepareFaceImage(image, next));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('biometrics.error.compress'));
    }
  }

  async function upload(): Promise<void> {
    if (!prepared) return;
    setBusy(true);
    setError(null);
    try {
      // Sent as raw JPEG bytes rather than multipart: the browser has already produced
      // exactly what the terminal accepts.
      const response = await fetch(`/api/staff/${String(staff.id)}/face`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'image/jpeg' },
        body: prepared.blob,
      });

      const payload = (await response.json()) as { results?: FaceResult[]; error?: string };

      if (!response.ok) {
        setError(payload.error ?? t('biometrics.error.status', { status: response.status }));
        setBusy(false);
        return;
      }

      const rows = payload.results ?? [];
      setResults(rows);

      const failed = rows.filter((row) => !row.ok);
      if (failed.length === 0) {
        await onDone(
          t('biometrics.done.enrolled', { name: staff.fullName, count: rows.length }),
        );
      } else {
        // Kept open: the person can scan at some doors and not others, and closing would
        // hide which.
        setBusy(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('biometrics.error.send'));
      setBusy(false);
    }
  }

  async function removeExisting(): Promise<void> {
    setBusy(true);
    try {
      const payload = await api.delete<{ results: FaceResult[] }>(
        `/api/staff/${String(staff.id)}/face`,
      );
      await onDone(
        t('biometrics.done.removed', {
          name: staff.fullName,
          count: payload.results.filter((row) => row.ok).length,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('biometrics.error.remove'));
      setBusy(false);
    }
  }

  const titleKey = staff.numOfFace > 0 ? 'biometrics.row.replace' : 'biometrics.row.enrol';

  return (
    <Dialog
      title={<T k={titleKey} />}
      titleText={t(titleKey)}
      description={
        <T
          k="biometrics.dialog.description"
          vars={{ name: staff.fullName, employeeNo: staff.employeeNo }}
        />
      }
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {staff.numOfFace > 0 && prepared === null && (
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <img
              src={`/api/staff/${String(staff.id)}/face`}
              alt={t('biometrics.row.faceAlt', { name: staff.fullName })}
              className="size-20 rounded-lg border border-slate-200 object-cover"
            />
            <p className="min-w-0 flex-1 text-xs text-slate-600">
              <T k="biometrics.dialog.current" />
            </p>
            <Button variant="ghost" onClick={() => void removeExisting()} disabled={busy}>
              <Trash2 className="size-4" aria-hidden />
              <T k="biometrics.dialog.remove" />
            </Button>
          </div>
        )}

        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void pick(file);
            }}
          />
          <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload className="size-4" aria-hidden />
            <T k="biometrics.dialog.pick" />
          </Button>
          <p className="mt-1.5 text-xs text-slate-500">
            <T k="biometrics.dialog.pick.hint" />
          </p>
        </div>

        {prepared !== null && (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <img
                src={prepared.previewUrl}
                alt={t('biometrics.dialog.previewAlt')}
                className="size-32 rounded-lg border border-slate-200 object-cover"
              />
              <div className="min-w-0 flex-1">
                <DetailGrid>
                  <Detail
                    label={<T k="biometrics.dialog.size" />}
                    value={`${String(Math.round(prepared.bytes / 1024))} / ${String(FACE_LIMITS.maxKb)} KB`}
                    mono
                  />
                  <Detail
                    label={<T k="biometrics.dialog.dimensions" />}
                    value={`${String(prepared.width)}×${String(prepared.height)}`}
                    mono
                  />
                  <Detail
                    label={<T k="biometrics.dialog.quality" />}
                    value={`${String(Math.round(prepared.quality * 100))}%`}
                    mono
                  />
                </DetailGrid>
              </div>
            </div>

            <div>
              <label htmlFor="face-zoom" className="block text-xs font-medium text-slate-600">
                <T k="biometrics.dialog.zoom" />
              </label>
              <input
                id="face-zoom"
                type="range"
                min={40}
                max={100}
                defaultValue={100}
                onChange={(event) => void adjust(Number(event.target.value) / 100)}
                className="mt-1 w-full"
              />
            </div>
          </div>
        )}

        {results !== null && (
          <ul className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
            {results.map((row) => (
              <li key={row.deviceId} className="flex items-start gap-2 text-xs">
                {row.ok ? (
                  <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden />
                ) : (
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-rose-500" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="font-medium text-slate-700">{row.deviceName}</span>
                  {!row.ok && <span className="ml-1.5 text-rose-700">{row.error}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void upload()}
          busy={busy}
          disabled={prepared === null}
          closeLabel={<T k="dialog.close" />}
          submitLabel={
            <T k={busy ? 'biometrics.dialog.submit.pending' : 'biometrics.dialog.submit'} />
          }
        />

        {busy && (
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            <T k="biometrics.dialog.sending" />
          </p>
        )}
      </div>
    </Dialog>
  );
}
