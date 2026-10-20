import {
  Activity,
  Clock,
  Download,
  Eye,
  HeartPulse,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Router,
  Satellite,
  Save,
  Server,
  ShieldCheck,
  ShieldOff,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import { SettingRow, TextControl } from '../components/ChannelForm';
import {
  ChipBar,
  Detail,
  DetailGrid,
  ExpandButton,
  FilterRow,
  FormGrid,
  KeyValue,
  KeyValueList,
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
  SettingsGroup,
  SettingsStack,
} from '../components/RecordPanel';
import { RemoveDialog } from '../components/RemoveDialog';
import { RevealSecret } from '../components/RevealSecret';
import { Badge, Button, CheckCard, Field, SelectField, StatTile } from '../components/ui';
import { useAuth } from '../lib/auth';
import {
  AGENT_BUILD_LABELS,
  AGENT_CREDENTIAL_PATH,
  AGENT_STATUS_LABELS,
  agentInstallCommand,
  agentsApi,
  type AgentRow,
  type IssuedAgentToken,
} from '../lib/agents-api';
import { api } from '../lib/api';
import { settingsApi } from '../lib/settings-api';
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

/** What `/api/ingest/stats` reports for the callback path. See `iclockStats()` on the server. */
interface CallbackIngest {
  path: string;
  handshakes: number;
  records: number;
  duplicates: number;
  /** Requests whose serial matched no registered terminal. The one number this tab exists for. */
  unregistered: number;
  outOfRange: number;
  undecodable: number;
  commandsSent: number;
  lastContactAt: string | null;
  /** Refused because the source address is public and not on the allowlist. */
  blocked: number;
  /**
   * The last public address turned away.
   *
   * This is how the allowlist gets filled in: the site's public address is something only the
   * server can observe, and the alternative was reading the journal on the host.
   */
  lastBlockedAddress: string | null;
  lastBlockedAt: string | null;
  /**
   * What the last request appeared to come from.
   *
   * Loopback here on a public installation means the reverse proxy is not forwarding the client
   * address, so every request reads as private and the allowlist cannot refuse anything.
   */
  lastSourceAddress: string | null;
}

/** Loopback in either form, which is what a proxy that forwards nothing looks like. */
function isLoopbackAddress(address: string): boolean {
  const value = address.replace(/^::ffff:/i, '');
  return value === '127.0.0.1' || value === '::1';
}

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
  /**
   * The unit's own serial, and on a callback protocol its only identity.
   *
   * Null is a working record on ISAPI — the probe fills it in — and a terminal that records
   * nothing on TA Push, because incoming scans are matched against this and nothing else.
   */
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
  /** Null when this server reaches the terminal itself. */
  agentId: number | null;
  /**
   * The connector's own state, sent beside every terminal it serves.
   *
   * A terminal behind a connector that never enrolled is not a broken terminal, and its own
   * `status` cannot say so: reconcile stops touching the row once it is assigned.
   */
  agent: { id: number; name: string; status: string } | null;
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
  /** The second ingest path, for terminals that dial out. */
  callback: CallbackIngest;
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

const STATUS_TONES: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  online: 'success',
  degraded: 'warning',
  offline: 'danger',
  unknown: 'neutral',
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
  const { can } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  // Each row action is its own grant on the server, so each is offered only where it would pass.
  const maySync = can('settings.devices', 'sync');
  // Reading a terminal's users feeds the ID mapping screen, and that screen owns the grant.
  const mayImport = can('staff.mapping', 'import');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.get<DeviceRow[]>('/api/devices'));
      setLoadedAt(new Date().toISOString());
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
  const searched = rows.filter(
    (row) =>
      needle.length === 0 ||
      row.name.toLowerCase().includes(needle) ||
      row.host.toLowerCase().includes(needle),
  );
  const filtered =
    statusFilter === undefined ? searched : searched.filter((row) => row.status === statusFilter);

  // Counted over the search but not over the chip, so choosing one does not zero the others.
  const counts = Object.fromEntries(
    ['online', 'degraded', 'offline', 'unknown'].map((status) => [
      status,
      searched.filter((row) => row.status === status).length,
    ]),
  );

  return (
    <>
      <PanelSection
        title={<T k="device.list.count" vars={{ count: rows.length }} />}
        subtitle={<T k="device.list.subtitle" />}
        action={
          can('settings.devices', 'create') ? (
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden />
              <T k="device.list.add" />
            </Button>
          ) : undefined
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
        framed
        loading={loading}
        rowCount={filtered.length}
        empty={<T k="device.list.empty" />}
        columns={[
          { header: <T k="device.column.name" /> },
          { header: <T k="device.column.address" />, width: 'w-52' },
          { header: <T k="device.column.clock" />, width: 'w-20', align: 'right' },
          { header: <T k="device.column.enrolled" />, width: 'w-24', align: 'right' },
          { header: <T k="device.column.serial" />, width: 'w-28' },
          { header: <T k="device.column.seen" />, width: 'w-40' },
          { header: <T k="panel.column.status" />, width: 'w-32' },
          { header: <T k="panel.column.actions" />, width: 'w-32', align: 'right' },
        ]}
      >
        {filtered.map((row) => {
          const expanded = open === row.id;
          const drift = row.clockDriftS;
          const drifting = drift !== null && Math.abs(drift) > 30;

          return (
            <Fragment key={row.id}>
              <tr
                className={cn(
                  'border-b border-slate-100',
                  expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
                  // Rose for a unit that is down, amber for one that answers but needs a look.
                  !expanded && row.status === 'offline' && 'bg-rose-50/40',
                  !expanded && row.status === 'degraded' && 'bg-amber-50/40',
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
                  {/*
                    A scheme and a port only where they describe how the unit is reached. On a
                    callback protocol the row used to read `https://192.168.0.22:443` from stored
                    defaults nothing ever uses, which reads as an address somebody should be able
                    to open. The serial is shown instead, because that is the identity there — and
                    its absence is why such a terminal records nothing.
                  */}
                  {usesStoredCredentials(row.protocol) ? (
                    <>
                      {row.useHttps ? 'https' : 'http'}://{row.host}:{row.port}
                    </>
                  ) : (
                    <>
                      {row.host}
                      {row.serialNumber === null ? (
                        <span className="mt-0.5 flex items-center gap-1 font-sans text-[11px] font-medium text-amber-700">
                          <TriangleAlert className="size-3 shrink-0" aria-hidden />
                          <T k="device.row.noSerial" />
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-[11px] text-slate-400">
                          {row.serialNumber}
                        </span>
                      )}
                    </>
                  )}
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
                  {/*
                    Who reaches it, when it is not this server. The address above is then the one
                    the connector dials on its own LAN, and a connector that has not enrolled is why
                    such a terminal reads as offline — not anything wrong with the unit.
                  */}
                  {row.agent !== null && (
                    <span
                      className={cn(
                        'mt-0.5 flex items-center gap-1 font-sans text-[11px]',
                        row.agent.status === 'active' ? 'text-slate-500' : 'text-amber-700',
                      )}
                    >
                      <Satellite className="size-3 shrink-0" aria-hidden />
                      <T k="device.row.viaAgent" vars={{ agent: row.agent.name }} />
                      {row.agent.status !== 'active' && (
                        <>
                          {' · '}
                          <TEnum k={AGENT_STATUS_LABELS[row.agent.status]} fallback={row.agent.status} />
                        </>
                      )}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums">
                  {drift === null ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    <span className={drifting ? 'font-semibold text-amber-700' : 'text-slate-600'}>
                      {drift > 0 ? '+' : ''}
                      {drift}s
                    </span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums text-slate-600">
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
                <td className="px-2 py-2.5">
                  <Badge tone={STATUS_TONES[row.status] ?? 'neutral'} className="uppercase">
                    <TEnum k={STATUS_LABELS[row.status]} fallback={row.status} />
                  </Badge>
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
                      // control is being changed. Open to a viewer too: each tab there
                      // gates its own writes, and the live readings are worth seeing.
                      onClick={() => void navigate(`/tetapan/peranti/${String(row.id)}`)}
                    />
                    {maySync && (
                      <RowAction
                        icon={<RefreshCw className="size-4" aria-hidden />}
                        label={t('device.row.sync')}
                        tone="edit"
                        disabled={busy}
                        onClick={() => void syncNow(row)}
                      />
                    )}
                    {mayImport && (
                      <RowAction
                        icon={<Download className="size-4" aria-hidden />}
                        label={t('device.row.importUsers')}
                        tone="view"
                        disabled={busy}
                        onClick={() => void importUsers(row)}
                      />
                    )}
                    <ExpandButton
                      expanded={expanded}
                      onClick={() => setOpen(expanded ? null : row.id)}
                      label={t('device.row.expand')}
                    />
                  </RowActions>
                </td>
              </tr>

              {expanded && (
                <tr className="border-b border-slate-200 bg-slate-50">
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
                      {/* The terminal's own `timeMode` value, shown as it stores it. */}
                      <Detail
                        label={<T k="device.detail.clockMode" />}
                        value={row.clockMode ?? '—'}
                        mono
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
        generatedAt={loadedAt}
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
  const [serialNumber, setSerialNumber] = useState('');
  const [locationId, setLocationId] = useState('');
  const [locations, setLocations] = useState<Array<{ id: number; name: string }>>([]);
  /** Empty means direct, matching `Device.agentId` being null — the default and the existing behaviour. */
  const [agentId, setAgentId] = useState('');
  const [agents, setAgents] = useState<AgentRow[]>([]);
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

  /*
   * No protocol gate on the connector choice, and that is a change.
   *
   * It used to be offered for ISAPI only, because that was the only protocol a connector could
   * drive. From 0.3.0 one build serves both — it answers the callback path as well, relaying work
   * for a terminal that collects its own — so the gate would now withhold the arrangement that
   * exists precisely to keep a ZKTeco unit off the internet.
   *
   * Nothing replaces it with a second list, deliberately. Which protocols a build drives is a fact
   * about the code running at that site, and a copy of it here would be a copy free to drift from
   * the connector it describes. The connector reports what it drives, and the Connector tab names
   * any terminal assigned to a build that cannot — which is also the honest answer for a protocol
   * added later.
   */

  useEffect(() => {
    void lookupsApi
      .load()
      .then((data) => setLocations(data.locations))
      .catch(() => undefined);
    void agentsApi
      .list()
      .then(setAgents)
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
        // Omitted when blank, so the probe's reading wins rather than an empty string
        // overwriting what the terminal reports.
        ...(serialNumber.trim() === '' ? {} : { serialNumber: serialNumber.trim() }),
        locationId: locationId === '' ? null : Number(locationId),
        // Omitted when direct, so a new row takes the server's own default rather than being told
        // null by a form that had nothing to say about it.
        ...(agentId === '' ? {} : { agentId: Number(agentId) }),
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
      width="lg"
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

          Which way the connection runs is the protocol's hint: it is the consequence of that
          one choice, and it is read while the choice is being made.
        */}
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <SelectField
            label={<T k="device.dialog.vendor" />}
            value={vendor}
            onChange={(event) => {
              const next = event.target.value as DeviceVendor;
              setVendor(next);
              // Reset rather than preserved: the previous protocol belongs to the previous
              // vendor, and the server refuses a mismatched pair.
              setProtocol(defaultProtocolFor(next));
            }}
          >
            {Object.keys(VENDOR_PROTOCOLS).map((value) => (
              <option key={value} value={value}>
                {t(VENDOR_LABELS[value] ?? 'device.vendor.hikvision')}
              </option>
            ))}
          </SelectField>

          <SelectField
            label={<T k="device.dialog.protocol" />}
            value={protocol}
            onChange={(event) => setProtocol(event.target.value)}
            disabled={VENDOR_PROTOCOLS[vendor].length < 2}
            hint={
              <T
                k={needsCredentials ? 'device.dialog.reach.inbound' : 'device.dialog.reach.outbound'}
              />
            }
          >
            {VENDOR_PROTOCOLS[vendor].map((value) => (
              <option key={value} value={value}>
                {t(PROTOCOL_LABELS[value] ?? 'device.protocol.isapi')}
              </option>
            ))}
          </SelectField>
        </div>

        {/*
          The serial, first of the identity fields on a callback protocol because it IS the
          identity there. Required in that case and the hint says why; optional on a protocol the
          probe can read it from.
        */}
        <Field
          label={<T k="device.dialog.serial" />}
          value={serialNumber}
          onChange={(event) => setSerialNumber(event.target.value)}
          hint={
            <T
              k={
                needsCredentials
                  ? 'device.dialog.serial.hint.optional'
                  : 'device.dialog.serial.hint.required'
              }
            />
          }
        />

        {/*
          Port and the HTTPS toggle are asked only where the server dials the unit.

          On a callback protocol nothing here ever opens a connection to the terminal, so these
          two described a transport that does not exist — and the list then rendered the stored
          defaults as `https://192.168.0.22:443`, which reads as the address somebody should be
          able to reach. The host stays: it is the last known address and it is worth having when
          diagnosing, which is what the column says it is.
        */}
        {needsCredentials ? (
          <div className="grid items-start gap-4 sm:grid-cols-3">
            <Field
              label={<T k="device.dialog.host" />}
              wrapperClassName="sm:col-span-2"
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
        ) : (
          <Field
            label={<T k="device.dialog.host.lastKnown" />}
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="192.168.1.250"
            hint={<T k="device.dialog.host.lastKnown.hint" />}
          />
        )}

        {needsCredentials && (
          <CheckCard
            checked={useHttps}
            onChange={(checked) => {
              setUseHttps(checked);
              setPort(checked ? '443' : '80');
            }}
            icon={<Lock className="size-4" aria-hidden />}
            title={<T k="device.dialog.https" />}
          />
        )}

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

        {/* The last block when no credential note follows, so it takes the footer clearance. */}
        <div className={cn('grid items-start gap-4 sm:grid-cols-2', !needsCredentials && 'pb-2')}>
          {/* Not a `FacetSelect`: no location is a real choice here, not the absence of a filter. */}
          <SelectField
            label={<T k="device.dialog.location" />}
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
          >
            <option value="">{t('device.dialog.location.none')}</option>
            {locations.map((row) => (
              <option key={row.id} value={String(row.id)}>
                {row.name}
              </option>
            ))}
          </SelectField>

          {/*
            Who reaches this terminal. Offered for every protocol — see the note above `submit`
            for why there is no longer a gate here.
          */}
          <SelectField
            label={<T k="device.editor.field.agent" />}
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
            hint={<T k="device.editor.field.agent.hint" />}
          >
            <option value="">{t('device.editor.field.agent.direct')}</option>
            {agents.map((row) => (
              <option key={row.id} value={String(row.id)}>
                {row.status === 'active'
                  ? row.name
                  : `${row.name} — ${t(AGENT_STATUS_LABELS[row.status] ?? 'agent.status.pending')}`}
              </option>
            ))}
          </SelectField>
        </div>

        {needsCredentials && (
          <div className="pb-2">
            <PanelNote>
              <T k="device.dialog.credentialNote" />
            </PanelNote>
          </div>
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
            name.trim() === '' ||
            host.trim() === '' ||
            (needsCredentials && password === '') ||
            // The server refuses a callback terminal with no serial, so the button says so first.
            (!needsCredentials && serialNumber.trim() === '')
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
  const { can } = useAuth();
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [stats, setStats] = useState<IngestStats | null>(null);
  const [environment, setEnvironment] = useState<Record<string, unknown> | null>(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8080');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The ingest allowlist, as stored and as being edited. */
  const [allowIps, setAllowIps] = useState('');
  const [storedAllowIps, setStoredAllowIps] = useState('');
  const [allowEditable, setAllowEditable] = useState(false);

  const load = useCallback(async () => {
    try {
      const [deviceRows, ingest, settings] = await Promise.all([
        api.get<DeviceRow[]>('/api/devices'),
        api.get<IngestStats>('/api/ingest/stats'),
        settingsApi.load(),
      ]);
      setDevices(deviceRows);
      setStats(ingest);
      setEnvironment(settings.environment as unknown as Record<string, unknown>);
      const stored =
        typeof settings.values['ingest.callbackAllowIps'] === 'string'
          ? settings.values['ingest.callbackAllowIps']
          : '';
      setStoredAllowIps(stored);
      setAllowIps(stored);
      // Narrowed server-side, so a disabled field is a disabled field rather than a save
      // that fails after the fact.
      setAllowEditable(settings.editableKeys.includes('ingest.callbackAllowIps'));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('device.connection.error.load'));
    }
  }, [t]);

  async function saveAllowList(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await settingsApi.save({ 'ingest.callbackAllowIps': allowIps.trim() });
      setNotice(t('device.ingest.callback.allow.saved'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
    } finally {
      setBusy(false);
    }
  }

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

  /*
    Only terminals this server reaches itself. One behind a connector is pointed at the connector
    from its own editor tab — this server cannot open a connection to it, and a button that tries
    is a request that hangs until it times out.
  */
  const direct = devices.filter((device) => device.agentId === null);

  /** Terminals on the callback path, and those among them that can never be matched. */
  const callbackTerminals = devices.filter((device) => isCallbackProtocol(device.protocol));
  const missingSerial = callbackTerminals.filter((device) => device.serialNumber === null);

  /*
    The address as the terminal must be configured with it, not as a bare path.

    `window.location.origin` is this browser's view of the server, which for every deployment of
    this application is also the address a dialling terminal uses — it is a public hostname in the
    cloud shape and the LAN address in the standalone one. A path alone left somebody to work out
    the host, and the host is the part that gets typed wrong.
  */
  const origin = window.location.origin;

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

      {/*
        The second ingest path, shown only once a terminal is registered on it.

        Terminals that dial out identify themselves by serial number and authenticate with nothing,
        so this path fails in a way the Digest one cannot: a unit calling in with a serial nobody
        registered is turned away, and until now that was counted where no screen could read it.
        Hidden entirely on a site running only Hikvision, where it would be four permanent zeros.
      */}
      {callbackTerminals.length > 0 && (
        <>
          <PanelSection
            title={<T k="device.ingest.callback.title" />}
            subtitle={<T k="device.ingest.callback.subtitle" />}
          />

          <PanelBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <StatTile
                label={<T k="device.ingest.callback.records" />}
                value={String(stats?.callback.records ?? 0)}
              />
              <StatTile
                label={<T k="device.ingest.callback.handshakes" />}
                value={String(stats?.callback.handshakes ?? 0)}
              />
              <StatTile
                label={<T k="device.ingest.callback.commands" />}
                value={String(stats?.callback.commandsSent ?? 0)}
              />
              {/*
                The number that answers "the terminal is online and nothing is arriving". Toned
                because a non-zero value here is always a configuration mistake, never traffic.
              */}
              <StatTile
                label={<T k="device.ingest.callback.unregistered" />}
                value={String(stats?.callback.unregistered ?? 0)}
                tone={(stats?.callback.unregistered ?? 0) > 0 ? 'danger' : 'neutral'}
              />
            </div>

            <KeyValueList>
              <KeyValue
                label={<T k="device.ingest.path" />}
                value={`${origin}${stats?.callback.path ?? '/iclock/cdata'}`}
              />
              <KeyValue
                label={<T k="device.ingest.auth" />}
                value={<T k="device.ingest.callback.auth.none" />}
                mono={false}
              />
              <KeyValue
                label={<T k="device.ingest.lastContact" />}
                value={
                  stats?.callback.lastContactAt === null ||
                  stats?.callback.lastContactAt === undefined
                    ? t('device.row.neverSeen')
                    : formatDateTime(stats.callback.lastContactAt)
                }
              />
              <KeyValue
                label={<T k="device.ingest.callback.duplicates" />}
                value={String(stats?.callback.duplicates ?? 0)}
              />
              <KeyValue
                label={<T k="device.ingest.callback.outOfRange" />}
                value={String(stats?.callback.outOfRange ?? 0)}
              />
              <KeyValue
                label={<T k="device.ingest.undecodable" />}
                value={String(stats?.callback.undecodable ?? 0)}
              />
              {/* What the server actually saw, which is what the allowlist is matched against. */}
              <KeyValue
                label={<T k="device.ingest.callback.lastSource" />}
                value={stats?.callback.lastSourceAddress ?? t('device.row.neverSeen')}
              />
            </KeyValueList>

            {/*
              The misconfiguration that would make the allowlist decorative, named where it can be
              seen. Only shown once something has actually arrived, because before that loopback
              would be a guess rather than an observation.
            */}
            {stats?.callback.lastSourceAddress !== null &&
              stats?.callback.lastSourceAddress !== undefined &&
              isLoopbackAddress(stats.callback.lastSourceAddress) && (
                <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                  <T
                    k="device.ingest.callback.proxyBlind"
                    vars={{
                      address: (
                        <code className="font-mono font-semibold">
                          {stats.callback.lastSourceAddress}
                        </code>
                      ),
                      header: <code className="font-mono">X-Forwarded-For</code>,
                    }}
                  />
                </PanelNote>
              )}

            {(stats?.callback.unregistered ?? 0) > 0 && (
              <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                <T
                  k="device.ingest.callback.unregistered.note"
                  vars={{ count: stats?.callback.unregistered ?? 0 }}
                />
              </PanelNote>
            )}

            {/* Named where they are, because this is the screen somebody is on when they ask. */}
            {missingSerial.length > 0 && (
              <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                <T
                  k="device.ingest.callback.missingSerial"
                  vars={{ names: missingSerial.map((device) => device.name).join(', ') }}
                />
              </PanelNote>
            )}
          </PanelBody>

          {/*
            The allowlist, and it is the only gate this path has.

            TA Push carries no credential — the identity is a serial number printed on the unit —
            so on a public address anybody who has read that sticker can file attendance, and a
            forged row cannot be removed: the raw log has no delete path anywhere in this
            application, deliberately, because it is the evidence.

            Private sources are trusted without a list, which is the standalone shape and needs no
            configuration. Public sources are refused until named here.
          */}
          <SettingsStack>
            <SettingsGroup
              title={<T k="device.ingest.callback.allow.group" />}
              icon={<ShieldCheck className="size-3.5" aria-hidden />}
              action={
                <Badge tone={storedAllowIps.trim() === '' ? 'warning' : 'success'} className="uppercase">
                  <T
                    k={
                      storedAllowIps.trim() === ''
                        ? 'device.ingest.callback.allow.state.empty'
                        : 'device.ingest.callback.allow.state.set'
                    }
                  />
                </Badge>
              }
            >
              <SettingRow
                label={<T k="device.ingest.callback.allow.label" />}
                hint={<T k="device.ingest.callback.allow.hint" />}
              >
                <TextControl
                  label={t('device.ingest.callback.allow.label')}
                  value={allowIps}
                  disabled={!allowEditable}
                  onChange={(event) => setAllowIps(event.target.value)}
                  placeholder="203.0.113.7, 203.0.113.0/24"
                />
              </SettingRow>

              {/*
                The address to paste, when one has been turned away. Shown rather than described,
                because the site's public address is a fact only the server has seen.
              */}
              {stats?.callback.lastBlockedAddress !== null &&
                stats?.callback.lastBlockedAddress !== undefined && (
                  <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                    <T
                      k="device.ingest.callback.blocked.note"
                      vars={{
                        count: stats.callback.blocked,
                        address: (
                          <code className="font-mono font-semibold">
                            {stats.callback.lastBlockedAddress}
                          </code>
                        ),
                        when:
                          stats.callback.lastBlockedAt === null
                            ? ''
                            : formatDateTime(stats.callback.lastBlockedAt),
                      }}
                    />
                  </PanelNote>
                )}

              {/* Only while it is true, and only where there is a terminal it applies to. */}
              {storedAllowIps.trim() === '' && (
                <PanelNote tone="info">
                  <T k="device.ingest.callback.allow.empty.note" />
                </PanelNote>
              )}
            </SettingsGroup>
          </SettingsStack>

          {allowEditable && (
            <PanelActions hint={<T k="device.ingest.callback.allow.actions.hint" />}>
              <Button
                onClick={() => void saveAllowList()}
                disabled={busy || allowIps.trim() === storedAllowIps.trim()}
              >
                <Save className="size-4" aria-hidden />
                <T k="device.ingest.callback.allow.save" />
              </Button>
            </PanelActions>
          )}
        </>
      )}

      {/* Writing the push target is the `sync` grant, so the section exists only for it. */}
      {can('settings.devices', 'sync') && direct.length > 0 && (
        <>
          <PanelSection
            title={<T k="device.push.title" />}
            subtitle={<T k="device.push.subtitle" />}
          />

          <PanelBody className="space-y-3">
            <div className="grid items-start gap-4 sm:grid-cols-3">
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
              {direct.map((device) => (
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
          </PanelBody>
        </>
      )}
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
          <Badge tone="success" className="uppercase">
            <T k="app.status.active" />
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
  const { can } = useAuth();
  const [health, setHealth] = useState<DeviceHealth[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [ntpHost, setNtpHost] = useState('192.168.1.1');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const mayFixClock = can('settings.devices', 'clock');
  const mayEdit = can('settings.devices', 'edit');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, checks] = await Promise.all([
        api.get<DeviceRow[]>('/api/devices'),
        api.get<DeviceHealth[]>('/api/devices/health'),
      ]);
      setDevices(rows);
      setHealth(checks);
      setLoadedAt(new Date().toISOString());
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
      // No zone: the server writes the organisation's own. This used to send `CST-8:00:00` for
      // every terminal, which is UTC+8 whatever the installation's zone is.
      const result = await api.post<{ driftSeconds: number; timeMode: string }>(
        `/api/devices/${String(device.id)}/clock/ntp`,
        { host: ntpHost.trim(), intervalMinutes: 60 },
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

        {/*
          One note, and only while there is something to do about it. Why the clock matters at all
          is the section's subtitle; repeating it in a strip under that was the same sentence twice.
        */}
        {drifting > 0 && (
          <PanelNote tone="warn" icon={<Clock className="size-3.5" aria-hidden />}>
            <T k="device.health.drifting" vars={{ count: drifting }} />
          </PanelNote>
        )}

        {mayFixClock && (
          <div className="max-w-md">
            <Field
              label={<T k="device.health.ntp" />}
              value={ntpHost}
              onChange={(event) => setNtpHost(event.target.value)}
              hint={<T k="device.health.ntp.hint" />}
            />
          </div>
        )}
      </PanelBody>

      <RecordTable
        framed
        loading={loading}
        rowCount={devices.length}
        empty={<T k="device.health.empty" />}
        columns={[
          { header: <T k="device.health.column.terminal" /> },
          { header: <T k="device.column.clock" />, width: 'w-24', align: 'right' },
          { header: <T k="device.detail.clockMode" />, width: 'w-28' },
          { header: <T k="device.health.column.capacity" />, width: 'w-28', align: 'right' },
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
          // Offered only where the check found it on: elsewhere the control would do nothing.
          const remoteCheckOn = warnings.some((warning) => warning.key === 'device.warning.remoteCheck');

          return (
            <Fragment key={device.id}>
              <tr
                className={cn(
                  'border-b border-slate-100',
                  expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
                  !expanded && check?.error !== undefined && 'bg-rose-50/40',
                  !expanded && check?.error === undefined && off && 'bg-amber-50/40',
                )}
              >
                <td className="px-5 py-2.5 font-medium text-slate-800">{device.name}</td>
                <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums">
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
                <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums text-slate-600">
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
                    {mayFixClock && (
                      <RowAction
                        icon={<Clock className="size-4" aria-hidden />}
                        label={t('device.health.row.fixClock')}
                        tone={off ? 'warn' : 'edit'}
                        disabled={busy || ntpHost.trim() === ''}
                        onClick={() => void fixClock(device)}
                      />
                    )}
                    {mayEdit && remoteCheckOn && (
                      <RowAction
                        icon={<ShieldOff className="size-4" aria-hidden />}
                        label={t('device.health.row.disableRemote')}
                        tone="edit"
                        disabled={busy}
                        onClick={() => void disableRemoteCheck(device)}
                      />
                    )}
                    <ExpandButton
                      expanded={expanded}
                      onClick={() => setOpen(expanded ? null : device.id)}
                      label={t('device.health.row.expand')}
                    />
                  </RowActions>
                </td>
              </tr>

              {expanded && (
                <tr className="border-b border-slate-200 bg-slate-50">
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
            </Fragment>
          );
        })}
      </RecordTable>

      <PanelFooter
        shown={devices.length}
        total={devices.length}
        page={1}
        pageSize={Math.max(1, devices.length)}
        pageSizes={[Math.max(1, devices.length)]}
        generatedAt={loadedAt}
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
  const [removing, setRemoving] = useState<AgentRow | null>(null);
  const [viewing, setViewing] = useState<AgentRow | null>(null);

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

  /*
    Both let the failure through rather than catching it. `RemoveDialog` shows a thrown error inside
    the dialog and stays open, which is where somebody is looking — a strip on the page behind it
    would be read after the dialog was already dismissed.
  */
  async function revoke(row: AgentRow): Promise<void> {
    await agentsApi.revoke(row.id);
    setRevoking(null);
    setError(null);
    setNotice(t('agent.revoked', { name: row.name }));
    await load();
  }

  async function remove(row: AgentRow): Promise<void> {
    await agentsApi.remove(row.id);
    setRemoving(null);
    setError(null);
    setNotice(t('agent.deleted', { name: row.name }));
    await load();
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
              /*
                An active connector holding a terminal it cannot drive is toned too, because
                nothing in its own columns says so: status reads active, the terminal count reads
                normal, and the unit it cannot serve is simply offline on the other tab.
              */
              row.status === 'active' && row.protocolMismatch.length > 0 && 'bg-amber-50/40',
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
                {/*
                  Blue, because it reads rather than changes. The build comparison lives in here
                  rather than as another column: it needs both version numbers and an explanation of
                  what updating does, which is more than a cell can carry.
                */}
                <RowAction
                  icon={<Eye className="size-4" aria-hidden />}
                  label={t('agent.row.view')}
                  tone="view"
                  onClick={() => setViewing(row)}
                />
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
                  tone="warn"
                  disabled={row.devices > 0 || row.status === 'revoked'}
                  onClick={() => setRevoking(row)}
                />
                {/*
                  The cleanup after revoking, and the reason it is blocked is named rather than
                  left to a 409. Two distinct reasons because they call for different actions:
                  terminals attached means move them, still active means withdraw first.
                */}
                <RowAction
                  icon={<Trash2 className="size-4" aria-hidden />}
                  label={
                    row.devices > 0
                      ? t('agent.row.deleteBlocked.devices', { count: row.devices })
                      : row.status === 'active'
                        ? t('agent.row.deleteBlocked.active')
                        : t('agent.row.delete')
                  }
                  tone="danger"
                  disabled={row.devices > 0 || row.status === 'active'}
                  onClick={() => setRemoving(row)}
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

      {/*
        Through the shared confirm, like every other destructive action. The connector's name was a
        line of body text under the description; it belongs in the title, which is where every
        other one of these names its record.
      */}
      {revoking !== null && (
        <RemoveDialog
          title={<T k="agent.revoke.title" vars={{ name: revoking.name }} />}
          titleText={t('agent.revoke.title', { name: revoking.name })}
          description={<T k="agent.revoke.description" />}
          submitLabel={<T k="agent.revoke.submit" />}
          onConfirm={() => revoke(revoking)}
          onClose={() => setRevoking(null)}
        />
      )}

      {viewing !== null && (
        <AgentDetailDialog
          row={viewing}
          onClose={() => setViewing(null)}
          onUpdated={async (message) => {
            setViewing(null);
            setNotice(message);
            await load();
          }}
        />
      )}

      {removing !== null && (
        <RemoveDialog
          title={<T k="agent.delete.title" vars={{ name: removing.name }} />}
          titleText={t('agent.delete.title', { name: removing.name })}
          description={<T k="agent.delete.description" />}
          submitLabel={<T k="agent.delete.submit" />}
          onConfirm={() => remove(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}

/**
 * What one connector reports about itself, and the one action that changes it.
 *
 * A dialog rather than an expanding row, because the build comparison is the reason somebody opens
 * it and that comparison needs both numbers side by side with room for the explanation of what
 * pressing the button will do.
 */
function AgentDetailDialog({
  row,
  onClose,
  onUpdated,
}: {
  row: AgentRow;
  onClose: () => void;
  onUpdated: (message: string) => Promise<void>;
}): ReactNode {
  const { t } = useLabels();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = row.updateRequestedAt !== null;

  /*
   * Three reasons the button is off, and each names a different next step: nothing to do, nothing
   * installed yet, or an attempt already waiting. One shared "cannot update" would leave the
   * operator guessing which applies.
   */
  const blocked =
    row.buildStatus === 'current'
      ? t('agent.update.disabled.current', { version: row.targetVersion })
      : row.buildStatus === 'unknown'
        ? t('agent.update.disabled.unknown')
        : pending
          ? t('agent.update.disabled.pending')
          : null;

  async function requestUpdate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await agentsApi.update(row.id);
      await onUpdated(t('agent.update.requested'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('agent.error.update'));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={<T k="agent.detail.title" />}
      titleText={t('agent.detail.title')}
      description={<T k="agent.detail.subtitle" />}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <div>
          <p className="font-medium text-slate-800">{row.name}</p>
          <p className="text-xs text-slate-500">{row.agentKey}</p>
        </div>

        <KeyValueList>
          <KeyValue
            label={<T k="agent.detail.reported" />}
            value={row.version ?? <T k="agent.detail.never" />}
            mono
          />
          <KeyValue label={<T k="agent.detail.target" />} value={row.targetVersion} mono />
          <KeyValue
            label={<T k="panel.column.status" />}
            value={
              <Badge
                tone={
                  row.buildStatus === 'current'
                    ? 'success'
                    : row.buildStatus === 'outdated'
                      ? 'warning'
                      : 'neutral'
                }
                className="uppercase"
              >
                <TEnum k={AGENT_BUILD_LABELS[row.buildStatus]} fallback={row.buildStatus} />
              </Badge>
            }
          />
          <KeyValue
            label={<T k="agent.detail.lan" />}
            value={
              row.lanHost === null ? (
                <T k="agent.row.noAddress" />
              ) : (
                `${row.lanHost}${row.lanPort === null ? '' : `:${String(row.lanPort)}`}`
              )
            }
            mono
          />
          {/*
            What the running build says it can drive.
 
            Three states, like the build comparison above it: a list, an empty list, or no report at
            all. Null is the connector on code older than 0.3.0, which said nothing — rendering that
            as "none" would read as a broken site rather than an old one.
          */}
          <KeyValue
            label={<T k="agent.detail.protocols" />}
            value={
              row.protocols === null ? (
                <T k="agent.detail.protocols.unreported" />
              ) : row.protocols.length === 0 ? (
                <T k="agent.detail.protocols.none" />
              ) : (
                row.protocols
                  .map((protocol) =>
                    t(PROTOCOL_LABELS[protocol] ?? 'agent.detail.protocols.unknown', { protocol }),
                  )
                  .join(' · ')
              )
            }
            mono={false}
          />
          <KeyValue label={<T k="agent.detail.devices" />} value={row.devices} />
          <KeyValue label={<T k="agent.detail.queued" />} value={row.queued} />
          {/* When the installer actually ran, which is not the same as when the row was created. */}
          <KeyValue
            label={<T k="agent.detail.enrolled" />}
            value={
              row.enrolledAt === null ? <T k="agent.detail.never" /> : formatDateTime(row.enrolledAt)
            }
          />
          <KeyValue
            label={<T k="agent.detail.lastSeen" />}
            value={
              row.lastSeenAt === null ? <T k="agent.detail.never" /> : formatDateTime(row.lastSeenAt)
            }
          />
          <KeyValue
            label={<T k="agent.detail.publicAddress" />}
            value={row.lastAddress ?? <T k="agent.detail.never" />}
            mono
          />
        </KeyValueList>

        {/*
          Terminals this build cannot drive, named here rather than as a strip over the list.

          This is where the fix is: updating the connector is the usual answer, and the button for it
          is a few lines below. A note over the table would state the problem a long way from the one
          control that resolves it — and the list already carries one strip, for a connector that has
          never enrolled.

          The symptom is worth stating because it is indistinguishable from hardware failure: the
          connector leaves such a terminal off its roster, so it delivers nothing and shows offline.
        */}
        {row.protocolMismatch.length > 0 && (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T
              k="agent.mismatch.note"
              vars={{
                count: row.protocolMismatch.length,
                terminals: row.protocolMismatch
                  .map(
                    (device) =>
                      `${device.name} (${t(
                        PROTOCOL_LABELS[device.protocol] ?? 'agent.detail.protocols.unknown',
                        { protocol: device.protocol },
                      )})`,
                  )
                  .join(', '),
              }}
            />
          </PanelNote>
        )}

        {/*
          The failure is shown above the note, because it is what the operator came back for.
          A previous attempt's reason beside a fresh button is the difference between "try again"
          and "go and look at the machine".
        */}
        {row.updateError !== null && (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T
              k="agent.update.failed"
              vars={{
                time: row.updateErrorAt === null ? '' : formatDateTime(row.updateErrorAt),
                // A connector before 0.2.2 sent a sentence of its own, with no stage to translate.
                reason: row.updateErrorKey === null ? row.updateError : <T k={row.updateErrorKey} />,
              }}
            />
            {/*
              What git or npm printed, kept whole and as printed. It is the line somebody at the
              machine will search for, and a summary of it would be one more thing to translate
              back before it could be looked up.
            */}
            {row.updateErrorKey !== null && row.updateError !== '' && (
              <code className="mt-1.5 block font-mono text-[11px] break-all whitespace-pre-wrap">
                {row.updateError}
              </code>
            )}
          </PanelNote>
        )}

        {pending && row.updateError === null && (
          <PanelNote tone="info">
            <T
              k="agent.update.pending"
              vars={{ time: formatDateTime(row.updateRequestedAt ?? '') }}
            />
          </PanelNote>
        )}

        <div className="pb-2">
          <PanelNote>
            <T k="agent.update.note" />
          </PanelNote>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void requestUpdate()}
          busy={busy}
          disabled={blocked !== null}
          submitLabel={<T k="agent.update.action" />}
          {...(blocked === null ? {} : { submitTitle: blocked })}
        />
      </div>
    </Dialog>
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
          What a connector is, read at the moment one is being created.

          Informational rather than a warning now. It used to say a connector drives ISAPI only and
          carried an amber strip, because assigning anything else produced a site that looked
          configured and recorded nothing. One build serves both protocols from 0.3.0, and the case
          that is still wrong — a terminal on a build too old to drive it — is named against the
          connector itself, where the update button is.
        */}
        <div className="pb-2">
          <PanelNote>
            <T k="agent.note.protocols" />
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
