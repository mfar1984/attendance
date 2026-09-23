import {
  Activity,
  Clock,
  Download,
  HeartPulse,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Router,
  Satellite,
  Server,
  ShieldOff,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  ChipBar,
  Detail,
  DetailGrid,
  ExpandButton,
  FilterRow,
  FormGrid,
  KeyValue,
  KeyValueList,
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
import { RevealSecret } from '../components/RevealSecret';
import { Badge, Button, Field, StatTile } from '../components/ui';
import {
  AGENT_CREDENTIAL_PATH,
  AGENT_STATUS_LABELS,
  agentInstallCommand,
  agentsApi,
  type AgentRow,
  type IssuedAgentToken,
} from '../lib/agents-api';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { T, TEnum, useLabels } from '../lib/translation';
import {
  PROTOCOL_LABELS,
  REACHABILITY_LABELS,
  VENDOR_LABELS,
  formatDateTime,
  lookupsApi,
} from '../lib/operations-api';
import {
  DeviceVendor,
  VENDOR_PROTOCOLS,
  defaultProtocolFor,
  isCallbackProtocol,
  usesStoredCredentials,
  type LabelKey,
} from '@attendance/shared';

interface DeviceRow {
  id: number;
  name: string;
  /** Manufacturer, fixed once the record exists. */
  vendor: string;
  /** Transport, also fixed. A vendor can have several and they are not interchangeable. */
  protocol: string;
  host: string;
  port: number;
  useHttps: boolean;
  verifyTls: boolean;
  /**
   * The stored password is never returned, so the edit form starts it empty.
   *
   * Null on a protocol with no stored credential — TA Push identifies a unit by its serial
   * number, so there is no username to show rather than an empty one.
   */
  username: string | null;
  doorNo: number;
  locationId: number | null;
  model: string | null;
  serialNumber: string | null;
  firmware: string | null;
  macAddress: string | null;
  status: string;
  clockDriftS: number | null;
  clockMode: string | null;
  faceCapacity: number;
  lastSeenAt: string | null;
  lastError: string | null;
  enrolled: number;
  location: { id: number; name: string } | null;
  syncState: {
    lastSerialNo: string;
    lastSyncAt: string | null;
    lastPushAt: string | null;
    recoveredByPull: number;
  } | null;
}

/**
 * Whether the server has to reach into a terminal, or the terminal dials out.
 *
 * Derived from the protocol rather than stored, so there is one source of truth. It decides
 * whether a remote site needs a VPN: a request/response protocol needs inbound access to the
 * unit for every operation — on Hikvision, including the call that configures push in the
 * first place — while a callback protocol needs none.
 */
function reachabilityOf(protocol: string): 'inbound' | 'outbound' {
  return isCallbackProtocol(protocol) ? 'outbound' : 'inbound';
}



interface DeviceHealth {
  deviceId: number;
  status: string;
  clockDriftSeconds: number | null;
  clockMode: string | null;
  faceCapacity: number | null;
  enrolled: number | null;
  /** A registry key and its measurements, resolved here rather than on the server. */
  warnings: Array<{ key: LabelKey; vars?: Record<string, string | number> }>;
  error?: string;
}

interface IngestStats {
  heartbeats: number;
  events: number;
  rejected: number;
  undecodable: number;
  /** Parsed, but carried no event we could file. */
  ignored: number;
  lastContactAt: string | null;
  pushedEvents: number;
  pulledEvents: number;
  ingestPath: string;
  authMethod: string;
}

/**
 * Registry keys, not words.
 *
 * The same four states are badged on the dashboard, so the wording is shared rather than
 * written twice — two copies would need translating twice and could disagree about what
 * "degraded" is called.
 */
const STATUS_LABELS: Record<string, LabelKey> = {
  online: 'device.status.online',
  degraded: 'device.status.degraded',
  offline: 'device.status.offline',
  unknown: 'device.status.unknown',
};

const STATUS_BADGE: Record<string, string> = {
  online: 'bg-emerald-50 text-emerald-700',
  degraded: 'bg-amber-50 text-amber-800',
  offline: 'bg-rose-50 text-rose-700',
  unknown: 'bg-slate-100 text-slate-600',
};

const STATUS_DOT: Record<string, string> = {
  online: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  offline: 'bg-rose-500',
  unknown: 'bg-slate-400',
};

export function DevicesPage(): ReactNode {
  const { t } = useLabels();
  const [tab, setTab] = useState('list');
  const [count, setCount] = useState<number | null>(null);

  const reloadCount = useCallback(() => {
    void api
      .get<DeviceRow[]>('/api/devices')
      .then((rows) => setCount(rows.length))
      .catch(() => setCount(null));
  }, []);

  useEffect(reloadCount, [reloadCount]);

  return (
    <PanelCard title={<T k="device.title" />} subtitle={<T k="device.subtitle" />}>
      <PanelTabs
        label={t('device.tabs.aria')}
        active={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'list',
            label: <T k="device.tab.list" />,
            labelText: t('device.tab.list'),
            icon: <Router className="size-4" aria-hidden />,
            count: count ?? undefined,
          },
          {
            id: 'connection',
            label: <T k="device.tab.connection" />,
            labelText: t('device.tab.connection'),
            icon: <Satellite className="size-4" aria-hidden />,
          },
          {
            id: 'health',
            label: <T k="device.tab.health" />,
            labelText: t('device.tab.health'),
            icon: <HeartPulse className="size-4" aria-hidden />,
          },
          /*
           * Connectors sit on the device screen rather than under Integrations, because whoever
           * may add a terminal is whoever may add the machine that reaches it — which is also why
           * the routes reuse `settings.devices` instead of inventing a permission no role holds.
           */
          {
            id: 'connector',
            label: <T k="agent.tab" />,
            labelText: t('agent.tab'),
            icon: <Server className="size-4" aria-hidden />,
          },
        ]}
      />

      {tab === 'list' && <ListPanel onChanged={reloadCount} />}
      {tab === 'connection' && <ConnectionPanel />}
      {tab === 'health' && <HealthPanel />}
      {tab === 'connector' && <ConnectorPanel />}
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function ListPanel({ onChanged }: { onChanged: () => void }): ReactNode {
  const { t } = useLabels();
  const navigate = useNavigate();
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.get<DeviceRow[]>('/api/devices'));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('device.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function syncNow(row: DeviceRow): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<{ stored: number; duplicates: number; error?: string }>(
        `/api/devices/${String(row.id)}/sync`,
      );
      setNotice(
        result.error !== undefined
          ? t('device.sync.failed', { name: row.name, error: result.error })
          : t('device.sync.done', {
              name: row.name,
              stored: result.stored,
              duplicates: result.duplicates,
            }),
      );
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('device.error.sync'));
    } finally {
      setBusy(false);
    }
  }

  async function importUsers(row: DeviceRow): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<{
        deviceUsers: number;
        autoMapped: number;
        needsReview: number;
      }>(`/api/devices/${String(row.id)}/import-users`);
      setNotice(
        t('device.import.done', {
          name: row.name,
          users: result.deviceUsers,
          mapped: result.autoMapped,
          review: result.needsReview,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('device.error.import'));
    } finally {
      setBusy(false);
    }
  }

  const needle = search.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (statusFilter !== undefined && row.status !== statusFilter) return false;
    return (
      needle.length === 0 ||
      row.name.toLowerCase().includes(needle) ||
      row.host.toLowerCase().includes(needle)
    );
  });

  const counts = Object.fromEntries(
    ['online', 'degraded', 'offline', 'unknown'].map((status) => [
      status,
      rows.filter((row) => row.status === status).length,
    ]),
  );

  return (
    <>
      <PanelSection
        title={<T k="device.list.count" vars={{ count: rows.length }} />}
        subtitle={<T k="device.list.subtitle" />}
        action={
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden />
            <T k="device.list.add" />
          </Button>
        }
      />

      <ChipBar
        active={statusFilter}
        onChange={setStatusFilter}
        chips={['online', 'degraded', 'offline', 'unknown'].map((status) => ({
          id: status,
          label: <TEnum k={STATUS_LABELS[status]} fallback={status} />,
          count: counts[status] ?? 0,
          dot: STATUS_DOT[status] ?? 'bg-slate-400',
        }))}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('device.list.search')}
        dirty={search.length > 0 || statusFilter !== undefined}
        onReset={() => {
          setSearch('');
          setStatusFilter(undefined);
        }}
      />

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <RecordTable
        loading={loading}
        rowCount={filtered.length}
        empty={<T k="device.list.empty" />}
        columns={[
          { header: <T k="device.column.name" /> },
          { header: <T k="device.column.address" />, width: 'w-52' },
          { header: <T k="panel.column.status" />, width: 'w-32' },
          { header: <T k="device.column.clock" />, width: 'w-24' },
          { header: <T k="device.column.enrolled" />, width: 'w-28' },
          { header: <T k="device.column.serial" />, width: 'w-28' },
          { header: <T k="device.column.seen" />, width: 'w-44' },
          { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
        ]}
      >
        {filtered.map((row) => {
          const expanded = open === row.id;
          const drift = row.clockDriftS;
          const drifting = drift !== null && Math.abs(drift) > 30;
          const unhealthy = row.status === 'offline' || row.status === 'degraded';

          return (
            <>
              <tr
                key={row.id}
                className={cn(
                  'border-b border-slate-100',
                  expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
                  unhealthy && !expanded && 'bg-rose-50/40',
                )}
              >
                <td className="px-5 py-2.5">
                  <span className="block font-medium text-slate-800">{row.name}</span>
                  {/*
                    The manufacturer sits with the model rather than in its own column. On a
                    site running two brands it is the first thing needed to read the rest of
                    the row — a drift figure and a serial number mean different things per
                    vendor — but it does not earn a ninth column in a table this wide.
                  */}
                  <span className="block text-[11px] text-slate-400">
                    <span className="font-semibold uppercase">
                      <TEnum k={VENDOR_LABELS[row.vendor]} fallback={row.vendor} />
                    </span>
                    {' · '}
                    {row.model ?? t('device.row.unknownModel')}
                    {row.location !== null && ` · ${row.location.name}`}
                  </span>
                </td>
                <td className="px-2 py-2.5 font-mono text-xs text-slate-600">
                  {row.useHttps ? 'https' : 'http'}://{row.host}:{row.port}
                  {/*
                    On a callback protocol this address is where the unit was last seen, not
                    how it is reached — the terminal dials out to us. Saying so here is what
                    stops somebody at a remote site trying to open a firewall inwards to fix a
                    terminal that never needed it.
                  */}
                  {reachabilityOf(row.protocol) === 'outbound' && (
                    <span className="mt-0.5 block font-sans text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
                      <TEnum
                        k={REACHABILITY_LABELS[reachabilityOf(row.protocol)]}
                        fallback={row.protocol}
                      />
                    </span>
                  )}
                </td>
                <td className="px-2 py-2.5">
                  <span
                    className={cn(
                      'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
                      STATUS_BADGE[row.status] ?? 'bg-slate-100 text-slate-600',
                    )}
                  >
                    <TEnum k={STATUS_LABELS[row.status]} fallback={row.status} />
                  </span>
                </td>
                <td className="px-2 py-2.5 font-mono text-xs tabular-nums">
                  {drift === null ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    <span className={drifting ? 'font-semibold text-amber-700' : 'text-slate-600'}>
                      {drift > 0 ? '+' : ''}
                      {drift}s
                    </span>
                  )}
                </td>
                <td className="px-2 py-2.5 font-mono text-xs tabular-nums text-slate-600">
                  {row.enrolled}/{row.faceCapacity}
                </td>
                <td className="px-2 py-2.5 font-mono text-xs tabular-nums text-slate-500">
                  {row.syncState === null ? '—' : `#${row.syncState.lastSerialNo}`}
                </td>
                <td className="px-2 py-2.5 text-xs whitespace-nowrap text-slate-500">
                  {row.lastSeenAt === null
                    ? t('device.row.neverSeen')
                    : formatDateTime(row.lastSeenAt)}
                </td>
                <td className="px-2 py-2.5 pr-4">
                  <RowActions>
                    <RowAction
                      icon={<Pencil className="size-4" aria-hidden />}
                      label={t('device.row.edit')}
                      tone="edit"
                      disabled={busy}
                      // To the editor page, not a dialog. Seven tabs of terminal settings
                      // need the viewport, and a dialog would hide the group whose
                      // control is being changed.
                      onClick={() => void navigate(`/tetapan/peranti/${String(row.id)}`)}
                    />
                    <RowAction
                      icon={<RefreshCw className="size-4" aria-hidden />}
                      label={t('device.row.sync')}
                      tone="edit"
                      disabled={busy}
                      onClick={() => void syncNow(row)}
                    />
                    <RowAction
                      icon={<Download className="size-4" aria-hidden />}
                      label={t('device.row.importUsers')}
                      tone="view"
                      disabled={busy}
                      onClick={() => void importUsers(row)}
                    />
                    <ExpandButton
                      expanded={expanded}
                      onClick={() => setOpen(expanded ? null : row.id)}
                      label={t('device.row.expand')}
                    />
                  </RowActions>
                </td>
              </tr>

              {expanded && (
                <tr
                  key={`${String(row.id)}-detail`}
                  className="border-b border-slate-200 bg-slate-50"
                >
                  <td colSpan={8} className="px-5 py-3">
                    <DetailGrid>
                      <Detail label={<T k="device.detail.model" />} value={row.model ?? '—'} />
                      <Detail
                        label={<T k="device.detail.firmware" />}
                        value={row.firmware ?? '—'}
                        mono
                      />
                      <Detail
                        label={<T k="device.detail.serial" />}
                        value={row.serialNumber ?? '—'}
                        mono
                      />
                      <Detail
                        label={<T k="device.detail.mac" />}
                        value={row.macAddress ?? '—'}
                        mono
                      />
                      <Detail
                        label={<T k="device.detail.location" />}
                        value={row.location?.name ?? '—'}
                      />
                      <Detail
                        label={<T k="device.detail.clockMode" />}
                        value={row.clockMode ?? '—'}
                      />
                      <Detail
                        label={<T k="device.detail.lastSync" />}
                        value={
                          row.syncState?.lastSyncAt === null ||
                          row.syncState?.lastSyncAt === undefined
                            ? t('device.row.neverSeen')
                            : formatDateTime(row.syncState.lastSyncAt)
                        }
                      />
                      <Detail
                        label={<T k="device.detail.lastPush" />}
                        value={
                          row.syncState?.lastPushAt === null ||
                          row.syncState?.lastPushAt === undefined
                            ? t('device.row.neverSeen')
                            : formatDateTime(row.syncState.lastPushAt)
                        }
                      />
                      <Detail
                        label={<T k="device.detail.recovered" />}
                        value={String(row.syncState?.recoveredByPull ?? 0)}
                      />
                    </DetailGrid>

                    {row.lastError !== null && (
                      <PanelNote tone="danger" className="mt-3">
                        {row.lastError}
                      </PanelNote>
                    )}

                    {/*
                      A climbing recovery count is the visible symptom of push being
                      dropped. Nothing else reports it: events still arrive, just late.
                    */}
                    {(row.syncState?.recoveredByPull ?? 0) > 0 && (
                      <PanelNote className="mt-3">
                        <T
                          k="device.detail.recoveredNote"
                          vars={{ count: row.syncState?.recoveredByPull ?? 0 }}
                        />
                      </PanelNote>
                    )}

                    {drifting && (
                      <PanelNote
                        tone="warn"
                        className="mt-3"
                        icon={<TriangleAlert className="size-3.5" aria-hidden />}
                      >
                        {/* The sign is part of the reading, so it travels with the number. */}
                        <T
                          k="device.detail.driftWarning"
                          vars={{ drift: `${drift > 0 ? '+' : ''}${String(drift)}s` }}
                        />
                      </PanelNote>
                    )}
                  </td>
                </tr>
              )}
            </>
          );
        })}
      </RecordTable>

      <PanelFooter
        shown={filtered.length}
        total={rows.length}
        page={1}
        pageSize={Math.max(1, rows.length)}
        pageSizes={[Math.max(1, rows.length)]}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => {
          void load();
          onChanged();
        }}
      />

      {adding && (
        <DeviceDialog
          onClose={() => setAdding(false)}
          onSaved={async (message) => {
            setAdding(false);
            setNotice(message);
            await load();
            onChanged();
          }}
        />
      )}
    </>
  );
}

/**
 * Adding a terminal only.
 *
 * Editing moved to `/tetapan/peranti/:id`, because everything worth changing about a
 * terminal after it exists lives on the unit rather than in this record, and reading it
 * takes seven tabs. Creating is different: the record has to exist before anything can be
 * read from the address, so this asks for the minimum needed to reach it and probes.
 *
 * `verifyTls`, `doorNo` and `active` are deliberately absent — the schema defaults cover
 * a new unit, and the editor exposes them properly. This dialog used to send
 * `verifyTls: false` as a literal, which meant editing a terminal turned certificate
 * verification back off for anybody who had turned it on.
 */
function DeviceDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}): ReactNode {
  const { t } = useLabels();
  const [name, setName] = useState('');
  const [vendor, setVendor] = useState<DeviceVendor>(DeviceVendor.hikvision);
  const [protocol, setProtocol] = useState<string>(defaultProtocolFor(DeviceVendor.hikvision));
  const [host, setHost] = useState('');
  const [port, setPort] = useState('443');
  const [useHttps, setUseHttps] = useState(true);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [locationId, setLocationId] = useState('');
  const [locations, setLocations] = useState<Array<{ id: number; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Whether this protocol has a credential to ask for.
   *
   * A callback protocol has none, so the fields are hidden rather than shown empty and
   * optional. An optional password box on a form that cannot use one is a box somebody fills
   * in, and then believes protects the connection.
   */
  const needsCredentials = usesStoredCredentials(protocol);

  useEffect(() => {
    void lookupsApi
      .load()
      .then((data) => setLocations(data.locations))
      .catch(() => undefined);
  }, []);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ id: number; health: DeviceHealth | null }>('/api/devices', {
        name: name.trim(),
        vendor,
        protocol,
        host: host.trim(),
        port: Number(port),
        useHttps,
        // Omitted entirely for a protocol with no credentials, so the server stores null
        // rather than an empty string that would reach the wire and fail authentication.
        ...(needsCredentials ? { username: username.trim(), password } : {}),
        locationId: locationId === '' ? null : Number(locationId),
      });

      /*
        Three whole sentences rather than one assembled from a clause. The warning count is
        only there sometimes, and "unreachable" is not the same sentence with a number
        removed.
      */
      const health = result.health;
      await onSaved(
        health === null
          ? t('device.saved.added', { name })
          : health.error !== undefined
            ? t('device.saved.added.unreachable', { name, error: health.error })
            : health.warnings.length > 0
              ? t('device.saved.added.warnings', { name, count: health.warnings.length })
              : t('device.saved.added', { name }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={<T k="device.dialog.add" />}
      titleText={t('device.dialog.add')}
      description={<T k="device.dialog.description" />}
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <Field
          label={<T k="device.dialog.name" />}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          placeholder={t('device.dialog.name.placeholder')}
        />

        {/*
          Asked first, and fixed afterwards. Every raw event and every ID mapping on the
          record that follows belongs to this protocol's semantics, so the editor refuses to
          change it later — which makes this the one field on the form worth getting right
          before anything else is typed.
        */}
        <FormGrid>
          <div className="space-y-1.5">
            <label htmlFor="device-vendor" className="block text-sm font-medium text-slate-700">
              <T k="device.dialog.vendor" />
            </label>
            <select
              id="device-vendor"
              value={vendor}
              onChange={(event) => {
                const next = event.target.value as DeviceVendor;
                setVendor(next);
                // Reset rather than preserved: the previous protocol belongs to the previous
                // vendor, and the server refuses a mismatched pair.
                setProtocol(defaultProtocolFor(next));
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            >
              {Object.keys(VENDOR_PROTOCOLS).map((value) => (
                <option key={value} value={value}>
                  {t(VENDOR_LABELS[value] ?? 'device.vendor.hikvision')}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="device-protocol" className="block text-sm font-medium text-slate-700">
              <T k="device.dialog.protocol" />
            </label>
            <select
              id="device-protocol"
              value={protocol}
              onChange={(event) => setProtocol(event.target.value)}
              disabled={VENDOR_PROTOCOLS[vendor].length < 2}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 disabled:bg-slate-50 disabled:text-slate-500"
            >
              {VENDOR_PROTOCOLS[vendor].map((value) => (
                <option key={value} value={value}>
                  {t(PROTOCOL_LABELS[value] ?? 'device.protocol.isapi')}
                </option>
              ))}
            </select>
          </div>
        </FormGrid>

        <PanelNote tone={needsCredentials ? 'info' : 'success'}>
          <T k={needsCredentials ? 'device.dialog.reach.inbound' : 'device.dialog.reach.outbound'} />
        </PanelNote>

        <div className="grid grid-cols-3 gap-3">
          <Field
            label={<T k="device.dialog.host" />}
            wrapperClassName="col-span-2"
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="192.168.1.250"
          />
          <Field
            label={<T k="device.dialog.port" />}
            inputMode="numeric"
            value={port}
            onChange={(event) => setPort(event.target.value.replace(/\D/g, ''))}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={useHttps}
            onChange={(event) => {
              setUseHttps(event.target.checked);
              setPort(event.target.checked ? '443' : '80');
            }}
          />
          <T k="device.dialog.https" />
        </label>

        {needsCredentials && (
          <FormGrid>
            <Field
              label={<T k="device.dialog.username" />}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <Field
              label={<T k="device.dialog.password" />}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
          </FormGrid>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor="device-location"
            className="block text-sm font-medium text-slate-700"
          >
            <T k="device.dialog.location" />
          </label>
          <select
            id="device-location"
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
          >
            <option value="">{t('device.dialog.location.none')}</option>
            {locations.map((row) => (
              <option key={row.id} value={String(row.id)}>
                {row.name}
              </option>
            ))}
          </select>
        </div>

        {needsCredentials && (
          <PanelNote>
            <T k="device.dialog.credentialNote" />
          </PanelNote>
        )}

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          /*
            The password is only required where the protocol uses one. Keeping it in the
            condition unconditionally would leave the submit button permanently disabled on a
            callback terminal, with no field on screen explaining why.
          */
          disabled={
            name.trim() === '' || host.trim() === '' || (needsCredentials && password === '')
          }
          submitLabel={<T k={busy ? 'device.dialog.probing' : 'device.dialog.submit.add'} />}
        />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Connection mode
// ---------------------------------------------------------------------------

function ConnectionPanel(): ReactNode {
  const { t } = useLabels();
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [stats, setStats] = useState<IngestStats | null>(null);
  const [environment, setEnvironment] = useState<Record<string, unknown> | null>(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8080');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [deviceRows, ingest, settings] = await Promise.all([
        api.get<DeviceRow[]>('/api/devices'),
        api.get<IngestStats>('/api/ingest/stats'),
        api.get<{ environment: Record<string, unknown> }>('/api/settings'),
      ]);
      setDevices(deviceRows);
      setStats(ingest);
      setEnvironment(settings.environment);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('device.connection.error.load'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function configurePush(device: DeviceRow): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<{ configured: string }>(
        `/api/devices/${String(device.id)}/push`,
        {
          host: host.trim(),
          port: Number(port),
          path: '/hik/events',
          useHttps: false,
          slot: 1,
        },
      );
      setNotice(
        t('device.push.done', { name: device.name, target: result.configured }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('device.push.error'));
    } finally {
      setBusy(false);
    }
  }

  const mode = String(environment?.['connectorMode'] ?? '—');

  return (
    <>
      <PanelSection
        title={<T k="device.connection.title" />}
        subtitle={<T k="device.connection.subtitle" />}
      />

      <PanelBody className="space-y-3">
        <Feedback error={error} notice={notice} />

        {/*
          Read-only because switching modes changes where the database and the server
          live. A toggle here would imply the system can relocate itself.
        */}
        <div className="grid gap-3 sm:grid-cols-2">
          <ModeCard
            active={mode === 'direct'}
            titleKey="device.connection.direct"
            bodyKey="device.connection.direct.body"
          />
          <ModeCard
            active={mode === 'agent'}
            titleKey="device.connection.agent"
            bodyKey="device.connection.agent.body"
          />
        </div>

        <PanelNote>
          <T
            k="device.connection.fixed"
            vars={{ env: <code className="font-mono">CONNECTOR_MODE</code> }}
          />
        </PanelNote>
      </PanelBody>

      <PanelSection
        title={<T k="device.ingest.title" />}
        subtitle={<T k="device.ingest.subtitle" />}
      />

      <PanelBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-4">
          <StatTile
            label={<T k="device.ingest.pushed" />}
            value={String(stats?.pushedEvents ?? 0)}
          />
          <StatTile
            label={<T k="device.ingest.pulled" />}
            value={String(stats?.pulledEvents ?? 0)}
          />
          <StatTile
            label={<T k="device.ingest.heartbeats" />}
            value={String(stats?.heartbeats ?? 0)}
          />
          {/*
            A non-zero count means the terminal is reaching us and we are discarding the
            payload, which is worse than it being unreachable.
          */}
          <StatTile
            label={<T k="device.ingest.undecodable" />}
            value={String(stats?.undecodable ?? 0)}
            tone={(stats?.undecodable ?? 0) > 0 ? 'danger' : 'neutral'}
          />
        </div>

        <KeyValueList>
          <KeyValue
            label={<T k="device.ingest.path" />}
            value={stats?.ingestPath ?? '/hik/events'}
          />
          <KeyValue
            label={<T k="device.ingest.auth" />}
            value={stats?.authMethod ?? 'MD5digest'}
          />
          <KeyValue
            label={<T k="device.ingest.lastContact" />}
            value={
              stats?.lastContactAt === null || stats?.lastContactAt === undefined
                ? t('device.row.neverSeen')
                : formatDateTime(stats.lastContactAt)
            }
          />
          <KeyValue
            label={<T k="device.ingest.rejected" />}
            value={String(stats?.rejected ?? 0)}
          />
          {/*
            Payloads that authenticated and parsed but carried no event.
            
            This case used to answer 200 and drop the body with nothing recorded anywhere, so
            a firmware that renamed a field presented on every screen as an ordinary quiet
            morning. Surfaced here because it is the first number worth reading when a
            terminal appears to be connected and yet no scans arrive.
          */}
          <KeyValue
            label={<T k="device.ingest.ignored" />}
            value={String(stats?.ignored ?? 0)}
          />
        </KeyValueList>

        {(stats?.undecodable ?? 0) > 0 && (
          <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="device.ingest.undecodable.note" vars={{ count: stats?.undecodable ?? 0 }} />
          </PanelNote>
        )}

        {(stats?.ignored ?? 0) > 0 && (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="device.ingest.ignored.note" vars={{ count: stats?.ignored ?? 0 }} />
          </PanelNote>
        )}
      </PanelBody>

      <PanelSection
        title={<T k="device.push.title" />}
        subtitle={<T k="device.push.subtitle" />}
      />

      <PanelBody className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label={<T k="device.push.host" />}
            wrapperClassName="sm:col-span-2"
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="192.168.1.102"
          />
          <Field
            label={<T k="device.dialog.port" />}
            inputMode="numeric"
            value={port}
            onChange={(event) => setPort(event.target.value.replace(/\D/g, ''))}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {devices.map((device) => (
            <Button
              key={device.id}
              variant="ghost"
              disabled={busy || host.trim() === ''}
              onClick={() => void configurePush(device)}
            >
              <Satellite className="size-4" aria-hidden />
              {device.name}
            </Button>
          ))}
        </div>

        <PanelNote>
          <T k="device.push.note" />
        </PanelNote>
      </PanelBody>
    </>
  );
}

function ModeCard({
  active,
  titleKey,
  bodyKey,
}: {
  active: boolean;
  titleKey: LabelKey;
  bodyKey: LabelKey;
}): ReactNode {
  return (
    <div
      className={cn(
        'rounded-lg p-3',
        active ? 'border-brand-600 bg-brand-100/60 border-2' : 'border border-slate-200',
      )}
    >
      <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
        <T k={titleKey} />
        {active && (
          <Badge tone="success">
            <T k="device.connection.active" />
          </Badge>
        )}
      </p>
      <p className="mt-1 text-xs text-slate-600">
        <T k={bodyKey} />
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Health and clock
// ---------------------------------------------------------------------------

function HealthPanel(): ReactNode {
  const { t, tEnum } = useLabels();
  const [health, setHealth] = useState<DeviceHealth[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [ntpHost, setNtpHost] = useState('192.168.1.1');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, checks] = await Promise.all([
        api.get<DeviceRow[]>('/api/devices'),
        api.get<DeviceHealth[]>('/api/devices/health'),
      ]);
      setDevices(rows);
      setHealth(checks);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('device.health.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function fixClock(device: DeviceRow): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<{ driftSeconds: number; timeMode: string }>(
        `/api/devices/${String(device.id)}/clock/ntp`,
        { host: ntpHost.trim(), timeZone: 'CST-8:00:00', intervalMinutes: 60 },
      );
      setNotice(
        t('device.health.ntp.done', {
          name: device.name,
          mode: result.timeMode,
          drift: result.driftSeconds,
        }),
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('device.health.ntp.error'));
    } finally {
      setBusy(false);
    }
  }

  async function disableRemoteCheck(device: DeviceRow): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.post(`/api/devices/${String(device.id)}/remote-check/disable`);
      setNotice(t('device.health.remoteOff', { name: device.name }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('device.health.remoteOff.error'));
    } finally {
      setBusy(false);
    }
  }

  const byId = new Map(health.map((row) => [row.deviceId, row]));
  const drifting = devices.filter((device) => {
    const drift = byId.get(device.id)?.clockDriftSeconds ?? device.clockDriftS;
    return drift !== null && Math.abs(drift) > 30;
  }).length;

  return (
    <>
      <PanelSection
        title={<T k="device.health.title" />}
        subtitle={<T k="device.health.subtitle" />}
        action={
          <Button variant="ghost" onClick={() => void load()} disabled={loading}>
            <Activity className={loading ? 'size-4 animate-pulse' : 'size-4'} aria-hidden />
            <T k="device.health.recheck" />
          </Button>
        }
      />

      <PanelBody className="space-y-4">
        <Feedback error={error} notice={notice} />

        <PanelNote tone={drifting > 0 ? 'warn' : 'info'} icon={<Clock className="size-3.5" aria-hidden />}>
          {/*
            The drift count is a bold sentence appended only when something is drifting, so
            it arrives as a var carrying its own leading space and full stop.
          */}
          <T
            k="device.health.silentNote"
            vars={{
              drifting:
                drifting > 0 ? (
                  <strong className="font-medium">
                    <T k="device.health.silentNote.drifting" vars={{ count: drifting }} />
                  </strong>
                ) : (
                  ''
                ),
            }}
          />
        </PanelNote>

        <div className="max-w-md">
          <Field
            label={<T k="device.health.ntp" />}
            value={ntpHost}
            onChange={(event) => setNtpHost(event.target.value)}
            hint={<T k="device.health.ntp.hint" />}
          />
        </div>
      </PanelBody>

      <RecordTable
        loading={loading}
        rowCount={devices.length}
        empty={<T k="device.health.empty" />}
        columns={[
          { header: <T k="device.health.column.terminal" /> },
          { header: <T k="device.column.clock" />, width: 'w-28' },
          { header: <T k="device.detail.clockMode" />, width: 'w-28' },
          { header: <T k="device.health.column.capacity" />, width: 'w-32' },
          { header: <T k="device.health.column.warnings" /> },
          { header: <T k="panel.column.actions" />, width: 'w-32', align: 'right' },
        ]}
      >
        {devices.map((device) => {
          const check = byId.get(device.id);
          const drift = check?.clockDriftSeconds ?? device.clockDriftS;
          const off = drift !== null && Math.abs(drift) > 30;
          const warnings = check?.warnings ?? [];
          const expanded = open === device.id;

          return (
            <>
              <tr
                key={device.id}
                className={cn(
                  'border-b border-slate-100',
                  expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
                  off && !expanded && 'bg-amber-50/40',
                )}
              >
                <td className="px-5 py-2.5 font-medium text-slate-800">{device.name}</td>
                <td className="px-2 py-2.5 font-mono text-xs tabular-nums">
                  {drift === null ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    <span className={off ? 'font-semibold text-amber-700' : 'text-slate-600'}>
                      {drift > 0 ? '+' : ''}
                      {drift}s
                    </span>
                  )}
                </td>
                <td className="px-2 py-2.5 font-mono text-xs text-slate-600">
                  {check?.clockMode ?? device.clockMode ?? '—'}
                </td>
                <td className="px-2 py-2.5 font-mono text-xs tabular-nums text-slate-600">
                  {check?.enrolled ?? device.enrolled}/{check?.faceCapacity ?? device.faceCapacity}
                </td>
                <td className="px-2 py-2.5 text-xs">
                  {check?.error !== undefined ? (
                    <span className="text-rose-700">{check.error}</span>
                  ) : warnings.length === 0 ? (
                    <span className="text-emerald-700">
                      <T k="device.health.noWarnings" />
                    </span>
                  ) : (
                    <span className="text-amber-800">
                      <T k="device.health.warningCount" vars={{ count: warnings.length }} />
                    </span>
                  )}
                </td>
                <td className="px-2 py-2.5 pr-4">
                  <RowActions>
                    <RowAction
                      icon={<Clock className="size-4" aria-hidden />}
                      label={t('device.health.row.fixClock')}
                      tone={off ? 'warn' : 'edit'}
                      disabled={busy || ntpHost.trim() === ''}
                      onClick={() => void fixClock(device)}
                    />
                    <RowAction
                      icon={<ShieldOff className="size-4" aria-hidden />}
                      label={t('device.health.row.disableRemote')}
                      tone="neutral"
                      disabled={busy}
                      onClick={() => void disableRemoteCheck(device)}
                    />
                    <ExpandButton
                      expanded={expanded}
                      onClick={() => setOpen(expanded ? null : device.id)}
                      label={t('device.health.row.expand')}
                    />
                  </RowActions>
                </td>
              </tr>

              {expanded && (
                <tr
                  key={`${String(device.id)}-detail`}
                  className="border-b border-slate-200 bg-slate-50"
                >
                  <td colSpan={6} className="px-5 py-3">
                    <DetailGrid>
                      {/*
                        Through the enum map, not the raw value. Rendering `status`
                        directly printed "degraded" here while every badge on the screen
                        said "BERMASALAH" — the sort of gap a typecheck cannot see.
                      */}
                      <Detail
                        label={<T k="panel.column.status" />}
                        value={tEnum(
                          STATUS_LABELS[check?.status ?? device.status],
                          check?.status ?? device.status,
                        )}
                      />
                      <Detail
                        label={<T k="device.health.detail.driftTarget" />}
                        value={
                          drift === null
                            ? t('device.health.detail.unmeasured')
                            : `${String(drift)}s`
                        }
                      />
                      <Detail
                        label={<T k="device.detail.clockMode" />}
                        value={check?.clockMode ?? device.clockMode ?? '—'}
                      />
                      <Detail
                        label={<T k="device.detail.firmware" />}
                        value={device.firmware ?? '—'}
                        mono
                      />
                      <Detail
                        label={<T k="device.health.detail.lastSeen" />}
                        value={
                          device.lastSeenAt === null
                            ? t('device.row.neverSeen')
                            : formatDateTime(device.lastSeenAt)
                        }
                      />
                    </DetailGrid>

                    {warnings.length > 0 && (
                      <ul className="mt-3 space-y-1.5">
                        {warnings.map((warning) => (
                          <li
                            key={warning.key}
                            className="flex items-start gap-1.5 text-xs text-amber-800"
                          >
                            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                            <T k={warning.key} vars={warning.vars} />
                          </li>
                        ))}
                      </ul>
                    )}

                    {check?.error !== undefined && (
                      <PanelNote tone="danger" className="mt-3">
                        {check.error}
                      </PanelNote>
                    )}

                    {off && (
                      <PanelNote tone="warn" className="mt-3">
                        <T k="device.health.pastRecords" />
                      </PanelNote>
                    )}
                  </td>
                </tr>
              )}
            </>
          );
        })}
      </RecordTable>

      <PanelFooter
        shown={devices.length}
        total={devices.length}
        page={1}
        pageSize={Math.max(1, devices.length)}
        pageSizes={[Math.max(1, devices.length)]}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => void load()}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Connector
//
// The machines that reach terminals this server cannot route to. This tab exists so an
// enrolment token is issued from a screen rather than from `create-agent.mts` on the host —
// the CLI put the one credential that matters in a shell command typed by whoever had SSH,
// which is a different set of people from whoever is allowed to add a terminal.
// ---------------------------------------------------------------------------

function ConnectorPanel(): ReactNode {
  const { t } = useLabels();
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ issued: IssuedAgentToken; reissued: boolean } | null>(
    null,
  );
  const [revoking, setRevoking] = useState<AgentRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await agentsApi.list());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('agent.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reissue(row: AgentRow): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      setRevealed({ issued: await agentsApi.reissue(row.id), reissued: true });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('agent.error.reissue'));
    }
  }

  async function revoke(row: AgentRow): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await agentsApi.revoke(row.id);
      setRevoking(null);
      setNotice(t('agent.revoked', { name: row.name }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('agent.error.revoke'));
    }
  }

  const needle = search.trim().toLowerCase();
  const filtered = rows.filter(
    (row) => needle.length === 0 || row.name.toLowerCase().includes(needle),
  );

  /*
   * One note, shown only when it names something to do.
   *
   * A connector in `pending` has never enrolled, which means the installer was never run at that
   * site. Terminals assigned to it report exactly like broken units — offline, nothing arriving —
   * so without this line somebody drives to a hospital to inspect a terminal that is working.
   */
  const pending = rows.filter((row) => row.status === 'pending').length;

  return (
    <>
      <PanelSection
        title={<T k="agent.count" vars={{ count: rows.length }} />}
        subtitle={<T k="agent.subtitle" />}
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            <T k="agent.add" />
          </Button>
        }
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('agent.search')}
        dirty={search.length > 0}
        onReset={() => setSearch('')}
      />

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      {pending > 0 && (
        <PanelBody className="pb-0">
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="agent.pending.note" />
          </PanelNote>
        </PanelBody>
      )}

      {/* One flexing name column and six narrow ones: the shape `framed` exists for. */}
      <RecordTable
        framed
        loading={loading}
        rowCount={filtered.length}
        empty={<T k="agent.empty" />}
        columns={[
          { header: <T k="agent.column.name" /> },
          { header: <T k="agent.column.devices" />, width: 'w-24' },
          { header: <T k="agent.column.queued" />, width: 'w-28' },
          { header: <T k="agent.column.version" />, width: 'w-24' },
          { header: <T k="agent.column.address" />, width: 'w-40' },
          { header: <T k="agent.column.seen" />, width: 'w-32' },
          { header: <T k="panel.column.status" />, width: 'w-32' },
          { header: <T k="panel.column.actions" />, width: 'w-24', align: 'right' },
        ]}
      >
        {filtered.map((row) => (
          <tr
            key={row.id}
            className={cn(
              'border-b border-slate-100 hover:bg-slate-50/70',
              // Colour before the status column is read.
              row.status === 'pending' && 'bg-amber-50/40',
              row.status === 'revoked' && 'bg-rose-50/40',
            )}
          >
            <td className="px-5 py-2.5">
              <p className="font-medium text-slate-800">{row.name}</p>
              {/* The public identifier, because it is what the connector's own log lines carry. */}
              <p className="text-xs text-slate-500">{row.agentKey}</p>
            </td>
            <td className="px-2 py-2.5 text-slate-700">{row.devices}</td>
            <td className="px-2 py-2.5">
              {/*
                Queue depth next to terminal count, because those two together are what say
                whether a connector is doing anything. Terminals with a rising queue is a site
                collecting nothing; a badge alone cannot tell that from healthy.
              */}
              <span className={cn(row.queued > 0 ? 'text-amber-700' : 'text-slate-400')}>
                {row.queued}
              </span>
            </td>
            <td className="px-2 py-2.5 text-slate-600">{row.version ?? '—'}</td>
            <td className="px-2 py-2.5">
              {row.lanHost === null ? (
                <span className="text-xs text-slate-400">
                  <T k="agent.row.noAddress" />
                </span>
              ) : (
                <code className="text-xs text-slate-600">
                  {row.lanHost}
                  {row.lanPort === null ? '' : `:${String(row.lanPort)}`}
                </code>
              )}
            </td>
            <td className="px-2 py-2.5 text-xs text-slate-600">
              {row.lastSeenAt === null ? (
                <span className="text-slate-400">
                  <T k="agent.row.neverSeen" />
                </span>
              ) : (
                formatDateTime(row.lastSeenAt)
              )}
            </td>
            <td className="px-2 py-2.5">
              <Badge
                tone={
                  row.status === 'active' ? 'success' : row.status === 'pending' ? 'warning' : 'danger'
                }
                className="uppercase"
              >
                <TEnum k={AGENT_STATUS_LABELS[row.status]} fallback={row.status} />
              </Badge>
            </td>
            <td className="px-2 py-2.5 pr-4">
              <RowActions>
                <RowAction
                  icon={<KeyRound className="size-4" aria-hidden />}
                  label={t('agent.row.reissue')}
                  tone="warn"
                  onClick={() => void reissue(row)}
                />
                {/*
                  Disabled with the reason in the tooltip rather than live and answering 409.
                  Revoking with terminals still attached leaves them pointing at a connector that
                  can no longer deliver, and the cloud will not dial them itself.
                */}
                <RowAction
                  icon={<ShieldOff className="size-4" aria-hidden />}
                  label={
                    row.devices > 0
                      ? t('agent.row.revokeBlocked', { count: row.devices })
                      : t('agent.row.revoke')
                  }
                  tone="danger"
                  disabled={row.devices > 0 || row.status === 'revoked'}
                  onClick={() => setRevoking(row)}
                />
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
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => void load()}
      />

      {creating && (
        <CreateAgentDialog
          onClose={() => setCreating(false)}
          onCreated={(issued) => {
            setCreating(false);
            setNotice(t('agent.created', { name: issued.name }));
            setRevealed({ issued, reissued: false });
            void load();
          }}
        />
      )}

      {revealed !== null && (
        <RevealSecret
          title={t(revealed.reissued ? 'agent.reissue.title' : 'agent.reveal.title')}
          label={t('agent.reveal.label')}
          value={agentInstallCommand(revealed.issued)}
          note={t('agent.reveal.note', { minutes: revealed.issued.ttlMinutes })}
          hint={
            <>
              <T
                k="agent.reveal.hint"
                vars={{ path: <code className="text-slate-600">{AGENT_CREDENTIAL_PATH}</code> }}
              />
              {revealed.reissued && (
                <>
                  {' '}
                  <T k="agent.reissue.note" />
                </>
              )}
            </>
          }
          onClose={() => setRevealed(null)}
        />
      )}

      {revoking !== null && (
        <Dialog
          title={<T k="agent.revoke.title" />}
          titleText={t('agent.revoke.title')}
          description={<T k="agent.revoke.description" />}
          width="md"
          onClose={() => setRevoking(null)}
        >
          <div className="space-y-4">
            <p className="pb-2 text-sm text-slate-700">{revoking.name}</p>
            <DialogFooter
              onClose={() => setRevoking(null)}
              onSubmit={() => {
                void revoke(revoking);
              }}
              submitLabel={<T k="agent.revoke.submit" />}
            />
          </div>
        </Dialog>
      )}
    </>
  );
}

/**
 * Creates a connector and hands back its enrolment token.
 *
 * Name only. A connector has no other configuration: the roster arrives from the cloud on every
 * heartbeat, and the LAN address is reported by the connector because only it knows which
 * interface it is reachable on. A form asking for either would be a second copy of the truth.
 */
function CreateAgentDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (issued: IssuedAgentToken) => void;
}): ReactNode {
  const { t } = useLabels();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onCreated(await agentsApi.create(name.trim()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('agent.error.create'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={<T k="agent.dialog.new" />}
      titleText={t('agent.dialog.new')}
      description={<T k="agent.dialog.new.description" />}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <Field
          label={<T k="agent.dialog.name" />}
          hint={<T k="agent.dialog.name.hint" />}
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
        />

        {/*
          The caveat sits at the moment of the decision, not under the table.
          A non-ISAPI terminal assigned to a connector is accepted here and refused by the agent,
          so the site reads as healthy and records nothing.
        */}
        <div className="pb-2">
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="agent.note.isapiOnly" />
          </PanelNote>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={name.trim().length === 0}
          submitLabel={<T k="agent.dialog.submit" />}
        />
      </div>
    </Dialog>
  );
}
