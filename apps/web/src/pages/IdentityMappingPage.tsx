import {
  ArrowLeftRight,
  CircleCheck,
  Download,
  EyeOff,
  Fingerprint,
  IdCard,
  Link2,
  ScanFace,
  TriangleAlert,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
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
  PanelTabs,
  RecordTable,
  RowAction,
  RowActions,
} from '../components/RecordPanel';
import { StaffPicker } from '../components/StaffPicker';
import { Badge } from '../components/ui';
import {
  identityApi,
  type MappingDevice,
  type StaffCandidate,
  type UnconfirmedMapping,
  type UnmappedUser,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { DEVICE_STATUS_LABELS, DEVICE_STATUS_TONES, formatDateTime } from '../lib/operations-api';
import { T, TEnum, useLabels } from '../lib/translation';

const SCREEN = 'staff.mapping';

/** Shared by every panel: they are read in one round trip and refreshed together. */
interface PanelProps {
  loading: boolean;
  generatedAt: string | null;
  feedback: ReactNode;
  onReload: () => void;
  onDone: (message: string) => Promise<void>;
}

/** The terminal id a dialog acts on, whichever queue it came from. */
interface MapTarget {
  deviceId: number;
  deviceName: string;
  deviceEmployeeNo: string;
  /** The name typed into the terminal, when there is one. A search hint, never a match. */
  terminalName: string | null;
  /** Set when remapping an automatic match: the person the id is credited to now. */
  current: { id: number; fullName: string } | null;
}

/**
 * Resolves which person each terminal identifier belongs to.
 *
 * A terminal never sends us a face. It matches biometrics locally and reports only its own
 * `employeeNo`, and that number is local to the unit: the same person is routinely 1001 on one
 * door and 680 on another. This mapping is the sole link between a scan and a person, and a wrong
 * row credits one employee's attendance to another with nothing raising an error.
 *
 * Which is why nothing here resolves automatically on a name. Names are not unique at this
 * headcount, and the terminal's name field is editable at the keypad.
 */
export function IdentityMappingPage(): ReactNode {
  const [tab, setTab] = useState('unmapped');
  const [unmapped, setUnmapped] = useState<UnmappedUser[]>([]);
  const [unconfirmed, setUnconfirmed] = useState<UnconfirmedMapping[]>([]);
  const [devices, setDevices] = useState<MappingDevice[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { t } = useLabels();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pending, review, terminals] = await Promise.all([
        identityApi.unmapped(),
        identityApi.unconfirmed(),
        identityApi.devices(),
      ]);
      setUnmapped(pending);
      setUnconfirmed(review);
      setDevices(terminals.devices);
      // The two queues answer as bare arrays, which the verification scripts read. They are
      // fetched in the same round trip as the terminal list, so its stamp stands for all three.
      setGeneratedAt(terminals.generatedAt);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('mapping.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const shared: PanelProps = {
    loading,
    generatedAt,
    feedback:
      error !== null || notice !== null ? <Feedback error={error} notice={notice} /> : null,
    onReload: () => void load(),
    onDone: async (message) => {
      setNotice(message);
      setError(null);
      await load();
    },
  };

  return (
    <PanelCard title={<T k="mapping.title" />} subtitle={<T k="mapping.subtitle" />}>
      <PanelTabs
        label={t('mapping.tabs.aria')}
        active={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'unmapped',
            label: <T k="mapping.tab.unmapped" />,
            labelText: t('mapping.tab.unmapped'),
            icon: <TriangleAlert className="size-4" aria-hidden />,
            count: unmapped.length,
          },
          {
            id: 'unconfirmed',
            label: <T k="mapping.tab.unconfirmed" />,
            labelText: t('mapping.tab.unconfirmed'),
            icon: <Link2 className="size-4" aria-hidden />,
            count: unconfirmed.length,
          },
          {
            id: 'import',
            label: <T k="mapping.tab.import" />,
            labelText: t('mapping.tab.import'),
            icon: <Download className="size-4" aria-hidden />,
          },
        ]}
      />

      {tab === 'unmapped' && <UnmappedPanel rows={unmapped} {...shared} />}
      {tab === 'unconfirmed' && <UnconfirmedPanel rows={unconfirmed} {...shared} />}
      {tab === 'import' && <ImportPanel rows={devices} {...shared} />}
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Unmapped
// ---------------------------------------------------------------------------

function UnmappedPanel({
  rows,
  loading,
  generatedAt,
  feedback,
  onReload,
  onDone,
}: PanelProps & { rows: UnmappedUser[] }): ReactNode {
  const [search, setSearch] = useState('');
  const [deviceFilter, setDeviceFilter] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [mapping, setMapping] = useState<UnmappedUser | null>(null);
  const [dismissing, setDismissing] = useState<UnmappedUser | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();
  const mayMap = can(SCREEN, 'create');
  const mayDismiss = can(SCREEN, 'delete');

  const needle = search.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (deviceFilter.length > 0 && String(row.deviceId) !== deviceFilter) return false;
    return (
      needle.length === 0 ||
      row.deviceEmployeeNo.toLowerCase().includes(needle) ||
      (row.deviceName ?? '').toLowerCase().includes(needle)
    );
  });

  const losing = rows.filter((row) => row.scanCount > 0);
  const lostScans = losing.reduce((running, row) => running + row.scanCount, 0);

  // Only terminals that have something in this queue: a filter that can only empty the table
  // is not one worth offering.
  const deviceOptions = [...new Map(rows.map((row) => [row.deviceId, row.device.name])).entries()];

  return (
    <>
      <PanelSection
        title={
          rows.length === 0 ? (
            <T k="mapping.unmapped.none" />
          ) : (
            <T k="mapping.unmapped.count" vars={{ count: rows.length }} />
          )
        }
        subtitle={<T k="mapping.unmapped.subtitle" />}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('mapping.unmapped.search')}
        dirty={search.length > 0 || deviceFilter.length > 0}
        onReset={() => {
          setSearch('');
          setDeviceFilter('');
        }}
      >
        <FacetSelect
          label={t('rawlog.filter.allDevices')}
          value={deviceFilter}
          onChange={setDeviceFilter}
          options={deviceOptions.map(([id, name]) => ({ value: String(id), label: name }))}
        />
      </FilterRow>

      {(feedback !== null || lostScans > 0) && (
        <PanelBody className="space-y-2 pb-0">
          {feedback}
          {/* The one note: it says what is being lost and what recovers it. */}
          {lostScans > 0 && (
            <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T
                k="mapping.unmapped.lostScans"
                vars={{ scans: lostScans, ids: losing.length }}
              />
            </PanelNote>
          )}
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={filtered.length}
        empty={<T k="mapping.unmapped.empty" />}
        columns={[
          { header: <T k="mapping.column.terminal" />, width: 'w-44' },
          { header: <T k="mapping.column.terminalId" />, width: 'w-32' },
          { header: <T k="mapping.column.terminalName" /> },
          { header: <T k="mapping.column.biometrics" />, width: 'w-28' },
          { header: <T k="mapping.column.lostScans" />, width: 'w-32' },
          { header: <T k="panel.column.actions" />, width: 'w-32', align: 'right' },
        ]}
      >
        {filtered.map((row) => {
          const expanded = open === row.id;
          return (
            <Fragment key={row.id}>
              <tr
                className={cn(
                  'border-b border-slate-100',
                  expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
                  row.scanCount > 0 && !expanded && 'bg-rose-50/40',
                )}
              >
                <td className="px-5 py-2.5 text-xs text-slate-700">{row.device.name}</td>
                <td className="px-2 py-2.5 font-mono text-xs font-semibold text-slate-800">
                  {row.deviceEmployeeNo}
                </td>
                <td className="px-2 py-2.5 text-slate-600">
                  {/* Shown only as a hint for whoever is reviewing. Never used to resolve the
                      mapping, because this field is editable at the terminal itself. */}
                  {row.deviceName ?? (
                    <span className="text-slate-400 italic">
                      <T k="mapping.row.noName" />
                    </span>
                  )}
                </td>
                <td className="px-2 py-2.5">
                  <Credentials
                    face={row.numOfFace}
                    fingerprint={row.numOfFp}
                    card={row.numOfCard}
                  />
                </td>
                <td className="px-2 py-2.5">
                  {row.scanCount > 0 ? (
                    <Badge tone="danger" className="uppercase">
                      <T k="mapping.row.lost" vars={{ count: row.scanCount }} />
                    </Badge>
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </td>
                <td className="px-2 py-2.5 pr-4">
                  <RowActions>
                    {mayMap && (
                      <RowAction
                        icon={<Link2 className="size-4" aria-hidden />}
                        label={t('mapping.row.map')}
                        tone="success"
                        onClick={() => setMapping(row)}
                      />
                    )}
                    {mayDismiss && (
                      <RowAction
                        icon={<EyeOff className="size-4" aria-hidden />}
                        label={t('mapping.row.dismiss')}
                        tone="danger"
                        onClick={() => setDismissing(row)}
                      />
                    )}
                    <ExpandButton
                      expanded={expanded}
                      onClick={() => setOpen(expanded ? null : row.id)}
                      label={t('mapping.row.expand')}
                    />
                  </RowActions>
                </td>
              </tr>

              {expanded && (
                <tr className="border-b border-slate-200 bg-slate-50">
                  <td colSpan={6} className="px-5 py-3">
                    <DetailGrid>
                      <Detail label={<T k="mapping.column.terminal" />} value={row.device.name} />
                      <Detail
                        label={<T k="mapping.column.terminalId" />}
                        value={row.deviceEmployeeNo}
                        mono
                      />
                      <Detail
                        label={<T k="mapping.column.terminalName" />}
                        value={row.deviceName ?? '—'}
                      />
                      <Detail label={<T k="mapping.detail.face" />} value={String(row.numOfFace)} />
                      <Detail
                        label={<T k="mapping.detail.fingerprint" />}
                        value={String(row.numOfFp)}
                      />
                      <Detail label={<T k="mapping.detail.card" />} value={String(row.numOfCard)} />
                      <Detail
                        label={<T k="mapping.detail.firstSeen" />}
                        value={formatDateTime(row.firstSeenAt)}
                      />
                      <Detail
                        label={<T k="mapping.detail.lastSeen" />}
                        value={formatDateTime(row.lastSeenAt)}
                      />
                      <Detail
                        label={<T k="mapping.detail.heldScans" />}
                        value={String(row.scanCount)}
                      />
                    </DetailGrid>

                    <PanelNote className="mt-3">
                      <T k="mapping.detail.nameWarning" />
                    </PanelNote>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </RecordTable>

      <PanelFooter
        shown={filtered.length}
        total={rows.length}
        page={1}
        pageSize={Math.max(1, rows.length)}
        pageSizes={[Math.max(1, rows.length)]}
        generatedAt={generatedAt}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={onReload}
      />

      {mapping !== null && (
        <MapDialog
          target={{
            deviceId: mapping.deviceId,
            deviceName: mapping.device.name,
            deviceEmployeeNo: mapping.deviceEmployeeNo,
            terminalName: mapping.deviceName,
            current: null,
          }}
          onClose={() => setMapping(null)}
          onDone={async (message) => {
            setMapping(null);
            await onDone(message);
          }}
        />
      )}

      {dismissing !== null && (
        <DismissDialog
          row={dismissing}
          onClose={() => setDismissing(null)}
          onDone={async (message) => {
            setDismissing(null);
            await onDone(message);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Auto-matched, awaiting confirmation
// ---------------------------------------------------------------------------

function UnconfirmedPanel({
  rows,
  loading,
  generatedAt,
  feedback,
  onReload,
  onDone,
}: PanelProps & { rows: UnconfirmedMapping[] }): ReactNode {
  const [search, setSearch] = useState('');
  const [deviceFilter, setDeviceFilter] = useState('');
  const [confirming, setConfirming] = useState<UnconfirmedMapping | null>(null);
  const [remapping, setRemapping] = useState<UnconfirmedMapping | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();
  const mayMap = can(SCREEN, 'create');

  const needle = search.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (deviceFilter.length > 0 && String(row.deviceId) !== deviceFilter) return false;
    return (
      needle.length === 0 ||
      row.deviceEmployeeNo.toLowerCase().includes(needle) ||
      row.staff.fullName.toLowerCase().includes(needle) ||
      row.staff.employeeNo.toLowerCase().includes(needle)
    );
  });

  const deviceOptions = [...new Map(rows.map((row) => [row.deviceId, row.device.name])).entries()];

  return (
    <>
      <PanelSection
        title={
          rows.length === 0 ? (
            <T k="mapping.unconfirmed.none" />
          ) : (
            <T k="mapping.unconfirmed.count" vars={{ count: rows.length }} />
          )
        }
        subtitle={<T k="mapping.unconfirmed.subtitle" />}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('mapping.unconfirmed.search')}
        dirty={search.length > 0 || deviceFilter.length > 0}
        onReset={() => {
          setSearch('');
          setDeviceFilter('');
        }}
      >
        <FacetSelect
          label={t('rawlog.filter.allDevices')}
          value={deviceFilter}
          onChange={setDeviceFilter}
          options={deviceOptions.map(([id, name]) => ({ value: String(id), label: name }))}
        />
      </FilterRow>

      {feedback !== null && <PanelBody className="pb-0">{feedback}</PanelBody>}

      <RecordTable
        framed
        loading={loading}
        rowCount={filtered.length}
        empty={<T k="mapping.unconfirmed.empty" />}
        columns={[
          { header: <T k="mapping.column.terminal" />, width: 'w-44' },
          { header: <T k="mapping.column.terminalId" />, width: 'w-32' },
          { header: <T k="mapping.column.matchedTo" /> },
          { header: <T k="staff.column.employeeNo" />, width: 'w-32' },
          { header: <T k="mapping.column.matchedAt" />, width: 'w-40' },
          { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
        ]}
      >
        {filtered.map((row) => (
          // Amber because every one of these is crediting scans to a person nobody has agreed to.
          <tr
            key={row.id}
            className="border-b border-slate-100 bg-amber-50/40 hover:bg-amber-50/70"
          >
            <td className="px-5 py-2.5 text-xs text-slate-700">{row.device.name}</td>
            <td className="px-2 py-2.5 font-mono text-xs font-semibold text-slate-800">
              {row.deviceEmployeeNo}
            </td>
            <td className="px-2 py-2.5 font-medium text-slate-800">{row.staff.fullName}</td>
            <td className="px-2 py-2.5 font-mono text-xs text-slate-600">{row.staff.employeeNo}</td>
            <td className="px-2 py-2.5 text-xs text-slate-600">{formatDateTime(row.createdAt)}</td>
            <td className="px-2 py-2.5 pr-4">
              <RowActions>
                {mayMap && (
                  <>
                    <RowAction
                      icon={<CircleCheck className="size-4" aria-hidden />}
                      label={t('mapping.unconfirmed.confirm')}
                      tone="success"
                      onClick={() => setConfirming(row)}
                    />
                    <RowAction
                      icon={<ArrowLeftRight className="size-4" aria-hidden />}
                      label={t('mapping.remap.action')}
                      tone="edit"
                      onClick={() => setRemapping(row)}
                    />
                  </>
                )}
              </RowActions>
            </td>
          </tr>
        ))}
      </RecordTable>

      <PanelFooter
        shown={filtered.length}
        total={rows.length}
        page={1}
        pageSize={Math.max(1, rows.length)}
        pageSizes={[Math.max(1, rows.length)]}
        generatedAt={generatedAt}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={onReload}
      />

      {confirming !== null && (
        <ConfirmDialog
          row={confirming}
          onClose={() => setConfirming(null)}
          onDone={async (message) => {
            setConfirming(null);
            await onDone(message);
          }}
        />
      )}

      {remapping !== null && (
        <MapDialog
          target={{
            deviceId: remapping.deviceId,
            deviceName: remapping.device.name,
            deviceEmployeeNo: remapping.deviceEmployeeNo,
            terminalName: null,
            current: { id: remapping.staff.id, fullName: remapping.staff.fullName },
          }}
          onClose={() => setRemapping(null)}
          onDone={async (message) => {
            setRemapping(null);
            await onDone(message);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Read a terminal's roster
// ---------------------------------------------------------------------------

function ImportPanel({
  rows,
  loading,
  generatedAt,
  feedback,
  onReload,
  onDone,
}: PanelProps & { rows: MappingDevice[] }): ReactNode {
  const [search, setSearch] = useState('');
  const [reading, setReading] = useState<MappingDevice | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();
  const mayImport = can(SCREEN, 'import');

  const needle = search.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      needle.length === 0 ||
      row.name.toLowerCase().includes(needle) ||
      row.host.toLowerCase().includes(needle) ||
      (row.location ?? '').toLowerCase().includes(needle),
  );

  return (
    <>
      <PanelSection
        title={<T k="mapping.import.count" vars={{ count: rows.length }} />}
        subtitle={<T k="mapping.import.subtitle" />}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('mapping.import.search')}
        dirty={search.length > 0}
        onReset={() => setSearch('')}
      />

      {feedback !== null && <PanelBody className="pb-0">{feedback}</PanelBody>}

      <RecordTable
        framed
        loading={loading}
        rowCount={filtered.length}
        empty={<T k="mapping.import.noDevices" />}
        columns={[
          { header: <T k="mapping.column.terminal" /> },
          { header: <T k="staff.column.location" />, width: 'w-44' },
          { header: <T k="mapping.column.mapped" />, width: 'w-28', align: 'right' },
          { header: <T k="mapping.column.unconfirmed" />, width: 'w-32', align: 'right' },
          { header: <T k="mapping.column.unmapped" />, width: 'w-32', align: 'right' },
          { header: <T k="panel.column.status" />, width: 'w-32' },
          { header: <T k="panel.column.actions" />, width: 'w-20', align: 'right' },
        ]}
      >
        {filtered.map((row) => (
          <tr
            key={row.id}
            className={cn(
              'border-b border-slate-100 hover:bg-slate-50/70',
              row.unmapped > 0 && 'bg-amber-50/40',
            )}
          >
            <td className="px-5 py-2.5">
              <span className="block font-medium text-slate-800">{row.name}</span>
              <span className="block font-mono text-[11px] text-slate-500">
                {row.host}
                {row.viaConnector && (
                  <>
                    {' · '}
                    <T k="mapping.import.viaConnector" />
                  </>
                )}
              </span>
            </td>
            <td className="px-2 py-2.5 text-xs text-slate-600">{row.location ?? '—'}</td>
            <td className="px-2 py-2.5 text-right font-mono text-xs text-slate-700">
              {row.mapped}
            </td>
            <td className="px-2 py-2.5 text-right font-mono text-xs text-slate-700">
              {row.unconfirmed}
            </td>
            <td
              className={cn(
                'px-2 py-2.5 text-right font-mono text-xs',
                row.unmapped > 0 ? 'font-semibold text-amber-800' : 'text-slate-700',
              )}
            >
              {row.unmapped}
            </td>
            <td className="px-2 py-2.5">
              <Badge tone={DEVICE_STATUS_TONES[row.status] ?? 'neutral'} className="uppercase">
                <TEnum k={DEVICE_STATUS_LABELS[row.status]} fallback={row.status} />
              </Badge>
            </td>
            <td className="px-2 py-2.5 pr-4">
              <RowActions>
                {mayImport && (
                  <RowAction
                    icon={<Download className="size-4" aria-hidden />}
                    label={t('mapping.import.action')}
                    tone="edit"
                    onClick={() => setReading(row)}
                  />
                )}
              </RowActions>
            </td>
          </tr>
        ))}
      </RecordTable>

      <PanelFooter
        shown={filtered.length}
        total={rows.length}
        page={1}
        pageSize={Math.max(1, rows.length)}
        pageSizes={[Math.max(1, rows.length)]}
        generatedAt={generatedAt}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={onReload}
      />

      {reading !== null && (
        <ImportDialog
          device={reading}
          onClose={() => setReading(null)}
          onDone={async (message) => {
            setReading(null);
            await onDone(message);
          }}
        />
      )}
    </>
  );
}

function Credentials({
  face,
  fingerprint,
  card,
}: {
  face: number;
  fingerprint: number;
  card: number;
}): ReactNode {
  const { t } = useLabels();

  return (
    <span className="inline-flex items-center gap-1.5">
      <ScanFace
        className={cn('size-3.5', face > 0 ? 'text-emerald-600' : 'text-slate-300')}
        aria-label={t(face > 0 ? 'staff.biometric.face.present' : 'staff.biometric.face.absent')}
      />
      <Fingerprint
        className={cn('size-3.5', fingerprint > 0 ? 'text-emerald-600' : 'text-slate-300')}
        aria-label={t(
          fingerprint > 0
            ? 'staff.biometric.fingerprint.present'
            : 'staff.biometric.fingerprint.absent',
        )}
      />
      <IdCard
        className={cn('size-3.5', card > 0 ? 'text-emerald-600' : 'text-slate-300')}
        aria-label={t(card > 0 ? 'staff.biometric.card.present' : 'staff.biometric.card.absent')}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

/**
 * Pairs one terminal id with a person, or moves an automatic match to the right one.
 *
 * Two stages, through the shared picker. Choosing a name in the list used to map it on the spot —
 * one click that rewrites past scans into somebody's attendance, with nothing to read between the
 * click and the write. Now the choice lands on a strip and the footer commits it.
 */
function MapDialog({
  target,
  onClose,
  onDone,
}: {
  target: MapTarget;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [picked, setPicked] = useState<StaffCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const remap = target.current !== null;
  /*
   * Flagged before the attempt rather than after being refused: one person holding two ids on a
   * terminal would split their day across both. Holding this very id is not a clash — that is the
   * person an automatic match already credits, and the server accepts it for the same reason.
   */
  const existing = picked?.existingDeviceEmployeeNo ?? null;
  const clash = existing !== null && existing !== target.deviceEmployeeNo ? existing : null;
  const unchanged = picked !== null && picked.id === target.current?.id;

  async function submit(): Promise<void> {
    if (picked === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await identityApi.map({
        deviceId: target.deviceId,
        deviceEmployeeNo: target.deviceEmployeeNo,
        staffId: picked.id,
      });
      await onDone(
        t(remap ? 'mapping.remap.done' : 'mapping.dialog.done', {
          name: picked.fullName,
          employeeNo: target.deviceEmployeeNo,
          note: t(result.noteKey, { count: result.backfilled }),
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('mapping.dialog.error'));
      setBusy(false);
    }
  }

  // The remap dialog is titled with the row action that opens it, so the two cannot disagree.
  const titleKey = remap ? 'mapping.remap.action' : 'mapping.dialog.title';
  const blockedReason =
    picked === null
      ? t('mapping.dialog.pickFirst')
      : clash !== null
        ? t('mapping.dialog.clash.reason')
        : unchanged
          ? t('mapping.remap.unchanged')
          : undefined;

  return (
    <Dialog
      title={<T k={titleKey} />}
      titleText={t(titleKey)}
      description={
        target.current !== null ? (
          <T
            k="mapping.remap.description"
            vars={{
              device: target.deviceName,
              employeeNo: target.deviceEmployeeNo,
              name: target.current.fullName,
            }}
          />
        ) : (
          <T
            k={
              target.terminalName !== null
                ? 'mapping.dialog.description.named'
                : 'mapping.dialog.description'
            }
            vars={{
              device: target.deviceName,
              employeeNo: target.deviceEmployeeNo,
              name: target.terminalName ?? '',
            }}
          />
        )
      }
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <StaffPicker
          value={picked}
          onChange={(staff) => {
            setPicked(staff as StaffCandidate | null);
            setError(null);
          }}
          search={(query) => identityApi.searchStaff(query, target.deviceId)}
          initialQuery={target.terminalName ?? ''}
          hint={<T k="mapping.dialog.pickHint" />}
        />

        {/* The last block before the footer, so it carries the `pb-2`. One note at a time:
            when the choice cannot be saved, why is the only thing worth reading. */}
        <div className="pb-2">
          {clash !== null && picked !== null ? (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T
                k="mapping.dialog.clash.note"
                vars={{ name: picked.fullName, employeeNo: clash }}
              />
            </PanelNote>
          ) : target.current !== null ? (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="mapping.remap.note" vars={{ name: target.current.fullName }} />
            </PanelNote>
          ) : (
            <PanelNote tone="success">
              <T k="mapping.dialog.note" />
            </PanelNote>
          )}
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={blockedReason !== undefined}
          {...(blockedReason === undefined ? {} : { submitTitle: blockedReason })}
          submitLabel={<T k={remap ? 'mapping.remap.submit' : 'mapping.dialog.submit'} />}
        />
      </div>
    </Dialog>
  );
}

/** Agreeing to an automatic match, after reading what agreeing does to past scans. */
function ConfirmDialog({
  row,
  onClose,
  onDone,
}: {
  row: UnconfirmedMapping;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await identityApi.map({
        deviceId: row.deviceId,
        deviceEmployeeNo: row.deviceEmployeeNo,
        staffId: row.staff.id,
      });
      await onDone(
        t('mapping.unconfirmed.done', {
          name: row.staff.fullName,
          employeeNo: row.deviceEmployeeNo,
          note: t(result.noteKey, { count: result.backfilled }),
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('mapping.unconfirmed.error'));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={<T k="mapping.confirm.title" vars={{ employeeNo: row.deviceEmployeeNo }} />}
      titleText={t('mapping.confirm.title', { employeeNo: row.deviceEmployeeNo })}
      description={
        <T
          k="mapping.confirm.description"
          vars={{
            device: row.device.name,
            name: row.staff.fullName,
            staffNo: row.staff.employeeNo,
          }}
        />
      }
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="pb-2">
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="mapping.unconfirmed.warning" />
          </PanelNote>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel={<T k="mapping.confirm.submit" />}
        />
      </div>
    </Dialog>
  );
}

/** Hiding an id that will never belong to anybody — and saying that hiding is all it does. */
function DismissDialog({
  row,
  onClose,
  onDone,
}: {
  row: UnmappedUser;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await identityApi.dismiss(row.id);
      await onDone(
        t('mapping.dismiss.done', { employeeNo: row.deviceEmployeeNo, device: row.device.name }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('mapping.dismiss.error'));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={<T k="mapping.dismiss.title" vars={{ employeeNo: row.deviceEmployeeNo }} />}
      titleText={t('mapping.dismiss.title', { employeeNo: row.deviceEmployeeNo })}
      description={
        <T
          k={
            row.deviceName !== null
              ? 'mapping.dialog.description.named'
              : 'mapping.dialog.description'
          }
          vars={{
            device: row.device.name,
            employeeNo: row.deviceEmployeeNo,
            name: row.deviceName ?? '',
          }}
        />
      }
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/* The last block before the footer, so it carries the `pb-2`. Rose when the id is
            scanning: that is most likely a person, and hiding them hides their attendance. */}
        <div className="pb-2">
          <PanelNote
            tone={row.scanCount > 0 ? 'danger' : 'warn'}
            icon={<TriangleAlert className="size-3.5" aria-hidden />}
          >
            <T
              k={row.scanCount > 0 ? 'mapping.dismiss.note.scanning' : 'mapping.dismiss.note'}
              vars={{ count: row.scanCount }}
            />
          </PanelNote>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel={<T k="mapping.dismiss.submit" />}
        />
      </div>
    </Dialog>
  );
}

/** Reading a terminal's roster, after saying what the automatic matches will and will not be. */
function ImportDialog({
  device,
  onClose,
  onDone,
}: {
  device: MappingDevice;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await identityApi.importUsers(device.id);
      await onDone(
        t('mapping.import.done', {
          device: device.name,
          users: result.deviceUsers,
          auto: result.autoMapped,
          existing: result.alreadyMapped,
          review: result.needsReview,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('mapping.import.error'));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={<T k="mapping.import.dialog.title" vars={{ device: device.name }} />}
      titleText={t('mapping.import.dialog.title', { device: device.name })}
      description={<T k="mapping.import.dialog.description" />}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="pb-2">
          <PanelNote>
            <T
              k="mapping.import.note"
              vars={{
                emphasis: (
                  <strong className="font-medium">
                    <T k="mapping.import.unconfirmed" />
                  </strong>
                ),
              }}
            />
          </PanelNote>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel={
            <T k={busy ? 'mapping.import.dialog.pending' : 'mapping.import.dialog.submit'} />
          }
        />
      </div>
    </Dialog>
  );
}
