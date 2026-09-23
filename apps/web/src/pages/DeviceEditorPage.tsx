import { usesStoredCredentials, type LabelKey } from '@attendance/shared';
import {
  Activity,
  ArrowLeft,
  ClipboardList,
  Clock,
  DoorOpen,
  Loader2,
  Plug,
  Power,
  Radio,
  Satellite,
  Save,
  ScanFace,
  Search,
  Settings2,
  ShieldCheck,
  Stethoscope,
  TriangleAlert,
  Unlock,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';

import {
  ControlCell,
  ControlGrid,
  RadioControl,
  SelectControl,
  SettingRow,
  StaticControl,
  Switch,
  TextControl,
  type RadioOption,
} from '../components/ChannelForm';
import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  PanelActions,
  PanelBody,
  PanelNote,
  PanelSection,
  PanelTabs,
  SettingsGroup,
  SettingsStack,
} from '../components/RecordPanel';
import { Badge, Button } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  PROTOCOL_LABELS,
  VENDOR_LABELS,
  formatDateTime,
  lookupsApi,
} from '../lib/operations-api';
import { T, TEnum, useLabels } from '../lib/translation';

/**
 * Per-terminal editor.
 *
 * One page rather than a dialog, for the reason the role editor is a page: seven tabs of
 * settings need the viewport, and a dialog would hide the group whose control is being
 * changed. The device list keeps its own fleet-level tabs; this is the other axis.
 *
 * The split that shapes every tab: the first one saves to this database, and the rest
 * read and write the terminal live over ISAPI. Mixing them would give one Save button
 * where half the fields go to MySQL and half go to a door lock — and when the terminal is
 * unreachable, half the form would work and half would not, with nothing saying which.
 *
 * Terminal settings are deliberately not mirrored into the database. A cached copy is a
 * second version of the truth, and the moment somebody changes a setting at the keypad
 * the screen is confidently wrong. So an offline unit renders as unreadable rather than
 * as its last known values.
 */
export function DeviceEditorPage(): ReactNode {
  const params = useParams<{ id?: string }>();
  const { t } = useLabels();
  const deviceId = Number(params.id);

  const [tab, setTab] = useState('connection');
  const [device, setDevice] = useState<DeviceRecord | null>(null);
  const [health, setHealth] = useState<DeviceHealth | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const loadRecord = useCallback(async () => {
    try {
      const rows = await api.get<DeviceRecord[]>('/api/devices');
      const found = rows.find((row) => row.id === deviceId) ?? null;
      setDevice(found);
      setLoadError(found === null ? t('device.editor.notFound') : null);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : t('device.editor.error.load'));
    }
  }, [deviceId, t]);

  useEffect(() => {
    void loadRecord();
  }, [loadRecord]);

  async function recheck(): Promise<void> {
    setChecking(true);
    try {
      setHealth(await api.post<DeviceHealth>(`/api/devices/${String(deviceId)}/check`));
      await loadRecord();
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : t('device.editor.error.check'));
    } finally {
      setChecking(false);
    }
  }

  if (loadError !== null && device === null) {
    return (
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <PanelBody>
          <Feedback error={loadError} />
        </PanelBody>
      </section>
    );
  }

  if (device === null) {
    return (
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex min-h-64 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('app.loading')} />
        </div>
      </section>
    );
  }

  const status = health?.status ?? device.status;

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4">
        <div className="flex min-w-0 items-start gap-3">
          <BackLink />
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-800">
              {device.name}
              <Badge tone={STATUS_TONE[status] ?? 'neutral'}>
                <TEnum k={STATUS_LABELS[status]} fallback={status} />
              </Badge>
              {!device.active && (
                <Badge tone="neutral">
                  <T k="app.status.inactive" />
                </Badge>
              )}
            </h1>
            {/*
              Model, address and serial on one line. This is the strip that answers "am I
              editing the terminal I think I am" before any control below is touched.
            */}
            <p className="mt-0.5 font-mono text-xs text-slate-500">
              {[
                device.model ?? t('device.editor.unknownModel'),
                `${device.host}:${String(device.port)}`,
                device.serialNumber === null ? null : `#${device.serialNumber}`,
              ]
                .filter((part): part is string => part !== null)
                .join(' · ')}
            </p>
          </div>
        </div>

        <Button variant="ghost" onClick={() => void recheck()} disabled={checking}>
          <Activity className={checking ? 'size-4 animate-pulse' : 'size-4'} aria-hidden />
          <T k="device.editor.recheck" />
        </Button>
      </header>

      <PanelTabs
        label={t('device.editor.tabs.aria')}
        active={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'connection',
            label: <T k="device.editor.tab.connection" />,
            labelText: t('device.editor.tab.connection'),
            icon: <Plug className="size-4" aria-hidden />,
          },
          {
            id: 'identity',
            label: <T k="device.editor.tab.identity" />,
            labelText: t('device.editor.tab.identity'),
            icon: <Search className="size-4" aria-hidden />,
          },
          {
            id: 'clock',
            label: <T k="device.editor.tab.clock" />,
            labelText: t('device.editor.tab.clock'),
            icon: <Clock className="size-4" aria-hidden />,
          },
          {
            id: 'attendance',
            label: <T k="device.editor.tab.attendance" />,
            labelText: t('device.editor.tab.attendance'),
            icon: <ClipboardList className="size-4" aria-hidden />,
          },
          {
            id: 'door',
            label: <T k="device.editor.tab.door" />,
            labelText: t('device.editor.tab.door'),
            icon: <DoorOpen className="size-4" aria-hidden />,
          },
          {
            id: 'push',
            label: <T k="device.editor.tab.push" />,
            labelText: t('device.editor.tab.push'),
            icon: <Radio className="size-4" aria-hidden />,
          },
          {
            id: 'diagnostics',
            label: <T k="device.editor.tab.diagnostics" />,
            labelText: t('device.editor.tab.diagnostics'),
            icon: <Stethoscope className="size-4" aria-hidden />,
          },
        ]}
      />

      {tab === 'connection' && <ConnectionTab device={device} onSaved={loadRecord} />}
      {tab === 'identity' && <IdentityTab device={device} />}
      {tab === 'clock' && <ClockTab device={device} />}
      {tab === 'attendance' && <AttendanceTab device={device} />}
      {tab === 'door' && <DoorTab device={device} />}
      {tab === 'push' && <PushTab device={device} />}
      {tab === 'diagnostics' && <DiagnosticsTab device={device} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Live reads
// ---------------------------------------------------------------------------

/**
 * Reads a terminal endpoint, tracking when the answer was obtained.
 *
 * The timestamp is not decoration. Six of these tabs show live device state, and a page
 * left open for twenty minutes looks identical to one just loaded — the same reason the
 * record tables carry `generatedAt` in their footer.
 */
function useTerminalRead<T>(
  path: string,
  options: {
    /**
     * Do not attempt the read at all.
     *
     * Set for a terminal behind a connector, where the answer is known in advance: the connector
     * collects commands and does not serve reads, so the request would return 409 every time. The
     * page used to fire it anyway and render the refusal through `Feedback`, which put a red error
     * strip on six tabs — one per read — for a single structural fact about the topology. Nothing
     * had failed, and a screen that reports a healthy site as six errors is a screen that sends
     * somebody looking for a hardware fault.
     *
     * Skipping keeps `error` null so each tab can say the one useful thing instead.
     */
    skip?: boolean;
  } = {},
): {
  data: T | null;
  error: string | null;
  loading: boolean;
  readAt: Date | null;
  reload: () => Promise<void>;
} {
  const skip = options.skip ?? false;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!skip);
  const [readAt, setReadAt] = useState<Date | null>(null);

  const reload = useCallback(async () => {
    if (skip) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      setData(await api.get<T>(path));
      setReadAt(new Date());
      setError(null);
    } catch (cause) {
      // The previous answer is kept rather than blanked. It is still what the terminal
      // said, and clearing it would turn one failed poll into an empty screen.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [path, skip]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, readAt, reload };
}

/**
 * Why this tab is empty, and where the answer actually lives.
 *
 * One note instead of a red error strip. The distinction the screen has to carry is that nothing
 * is broken: a connector terminal is reached by commands it collects, so live reads have no
 * mechanism, and the values an operator came here for are on the device list — reported by the
 * connector on every heartbeat.
 *
 * Deliberately not `tone="danger"`. Red is for a unit at fault, and using it for a permanent
 * property of the topology teaches operators to ignore red on this screen.
 */
function ConnectorManagedNote({
  device,
  writable = false,
}: {
  device: DeviceRecord;
  /** True where the tab also offers a write this connector cannot carry. */
  writable?: boolean;
}): ReactNode {
  return (
    <PanelNote tone="warn" icon={<Satellite className="size-3.5" aria-hidden />}>
      <T k="device.editor.viaAgent.read" vars={{ agent: device.agent?.name ?? '' }} />
      {writable && (
        <>
          {' '}
          <T k="device.editor.viaAgent.write" />
        </>
      )}
    </PanelNote>
  );
}

/**
 * The heading every live tab opens with.
 *
 * Carries the read time and the reload control, so no tab has to decide where to put
 * them and they cannot end up in different corners on different tabs.
 */
function LiveSection({
  titleKey,
  subtitleKey,
  icon,
  readAt,
  loading,
  onReload,
  unavailable,
}: {
  titleKey: LabelKey;
  subtitleKey: LabelKey;
  icon: ReactNode;
  readAt: Date | null;
  loading: boolean;
  onReload: () => void;
  /**
   * No read is possible here, so neither the timestamp nor the refresh means anything.
   *
   * Without this the header read `Sedang membaca…` forever on a connector terminal — `readAt`
   * never gets set because no request is made — beside a refresh button that did nothing when
   * pressed. Two controls describing activity that was not happening, on six tabs.
   */
  unavailable?: boolean;
}): ReactNode {
  const { t } = useLabels();

  return (
    <PanelSection
      icon={icon}
      title={<T k={titleKey} />}
      subtitle={<T k={subtitleKey} />}
      action={
        <div className="flex items-center gap-3">
          {!unavailable && (
            <span className="text-xs text-slate-500">
              {readAt === null ? (
                <T k="device.editor.live.reading" />
              ) : (
                <T
                  k="device.editor.live.readAt"
                  vars={{ time: readAt.toLocaleTimeString('ms-MY') }}
                />
              )}
            </span>
          )}
          <Button
            variant="ghost"
            onClick={onReload}
            disabled={loading || unavailable === true}
            {...(unavailable === true ? { title: t('device.editor.viaAgent.disabled') } : {})}
          >
            <Activity className={loading ? 'size-4 animate-pulse' : 'size-4'} aria-hidden />
            <T k="device.editor.live.reload" />
          </Button>
        </div>
      }
    />
  );
}

/** Shown in place of controls the firmware does not report. */
function Unsupported({ children }: { children?: ReactNode }): ReactNode {
  return (
    <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
      {children ?? <T k="device.editor.live.unsupported" />}
    </PanelNote>
  );
}

/**
 * Says why a tab's controls are greyed out.
 *
 * On every tab that writes, not just the one. A disabled control with no explanation is
 * the same trap as a search box that filters nothing: it teaches the operator that the
 * screen is broken rather than that they lack a grant. The action is named because the
 * grant is per-action, so "ask for permission" is not actionable on its own — somebody has
 * to know which box to tick.
 */
function ReadOnlyNote({ actionKey }: { actionKey: LabelKey }): ReactNode {
  return (
    <PanelNote icon={<ShieldCheck className="size-3.5" aria-hidden />}>
      <T
        k="device.editor.readOnly"
        vars={{
          action: (
            <strong className="font-medium">
              <T k={actionKey} />
            </strong>
          ),
        }}
      />
    </PanelNote>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Connection. The only tab that writes to this database.
// ---------------------------------------------------------------------------

function ConnectionTab({
  device,
  onSaved,
}: {
  device: DeviceRecord;
  onSaved: () => Promise<void>;
}): ReactNode {
  const { t } = useLabels();
  const { can } = useAuth();
  const editable = can('settings.devices', 'edit');

  const [name, setName] = useState(device.name);
  const [host, setHost] = useState(device.host);
  const [port, setPort] = useState(String(device.port));
  const [useHttps, setUseHttps] = useState(device.useHttps);
  const [verifyTls, setVerifyTls] = useState(device.verifyTls);
  /**
   * Empty string rather than null, because this is a controlled input.
   *
   * A protocol with no stored credential stores null, and the fields are hidden below rather
   * than shown empty — so this value is never read on those terminals.
   */
  const [username, setUsername] = useState(device.username ?? '');
  const [password, setPassword] = useState('');
  const [doorNo, setDoorNo] = useState(String(device.doorNo));
  /** Whether this protocol authenticates with a stored username and password. */
  const needsCredentials = usesStoredCredentials(device.protocol);
  const [active, setActive] = useState(device.active);
  const [locationId, setLocationId] = useState(
    device.locationId === null ? '' : String(device.locationId),
  );
  const [locations, setLocations] = useState<Array<{ id: number; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void lookupsApi
      .load()
      .then((data) => setLocations(data.locations))
      .catch(() => undefined);
  }, []);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.patch<{ id: number; health: DeviceHealth | null }>(
        `/api/devices/${String(device.id)}`,
        {
          name: name.trim(),
          host: host.trim(),
          port: Number(port),
          useHttps,
          // Sent as the current state of the control. It used to be hardcoded false here,
          // so anybody who had turned certificate verification on had it silently turned
          // back off by an unrelated edit.
          verifyTls,
          /*
            Credentials omitted entirely on a protocol that has none, so an edit cannot write
            an empty username onto a callback terminal — which the server would then refuse as
            a protocol that requires one, on a form where no such field was shown.
          */
          ...(needsCredentials
            ? {
                username: username.trim(),
                // Omitted when blank, which keeps the stored one. The password is never
                // returned, so blank cannot mean "clear it".
                ...(password === '' ? {} : { password }),
              }
            : {}),
          doorNo: Number(doorNo),
          active,
          locationId: locationId === '' ? null : Number(locationId),
        },
      );

      await onSaved();
      setPassword('');

      /*
        Four whole messages rather than one assembled from a clause. A deactivated
        terminal is not probed at all, so there is no health to report — and "saved" with
        no warning count is a different sentence from "saved, but unreachable".
      */
      const health = result.health;
      setNotice(
        health === null
          ? t('device.editor.saved.noProbe', { name: name.trim() })
          : health.error !== undefined
            ? t('device.editor.saved.unreachable', { name: name.trim(), error: health.error })
            : health.warnings.length > 0
              ? t('device.editor.saved.warnings', {
                  name: name.trim(),
                  count: health.warnings.length,
                })
              : t('device.editor.saved', { name: name.trim() }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PanelSection
        icon={<Plug className="size-4" aria-hidden />}
        title={<T k="device.editor.connection.title" />}
        subtitle={<T k="device.editor.connection.subtitle" />}
      />

      <SettingsStack>
        <Feedback error={error} notice={notice} />

        {!editable && <ReadOnlyNote actionKey="action.edit" />}

        <SettingsGroup
          title={<T k="device.editor.group.address" />}
          icon={<Settings2 className="size-3.5" aria-hidden />}
          action={
            <span className="font-mono text-[11px] text-slate-500">
              {useHttps ? 'https' : 'http'}://{host}:{port}
            </span>
          }
        >
          <SettingRow label={<T k="device.editor.field.name" />} required>
            <TextControl
              label={t('device.editor.field.name')}
              value={name}
              disabled={!editable}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('device.editor.field.name.placeholder')}
            />
          </SettingRow>

          {/*
            Read only, because the server refuses to change either. Shown rather than omitted:
            it is what decides how every other control on this page behaves, and an operator
            reading a terminal that has no password field needs to see why.
          */}
          <SettingRow
            label={<T k="device.editor.field.vendor" />}
            hint={<T k="device.editor.field.vendor.hint" />}
          >
            <ControlGrid columns={2}>
              <ControlCell caption={<T k="device.dialog.vendor" />}>
                <StaticControl
                  value={<TEnum k={VENDOR_LABELS[device.vendor]} fallback={device.vendor} />}
                />
              </ControlCell>
              <ControlCell caption={<T k="device.dialog.protocol" />}>
                <StaticControl
                  mono
                  value={<TEnum k={PROTOCOL_LABELS[device.protocol]} fallback={device.protocol} />}
                />
              </ControlCell>
            </ControlGrid>
          </SettingRow>

          <SettingRow
            label={<T k="device.editor.field.host" />}
            hint={<T k="device.editor.field.host.hint" />}
            required
          >
            <ControlGrid columns={3}>
              <ControlCell caption={<T k="device.editor.field.host.caption" />} className="sm:col-span-2">
                <TextControl
                  label={t('device.editor.field.host')}
                  value={host}
                  disabled={!editable}
                  onChange={(event) => setHost(event.target.value)}
                  placeholder="192.168.1.250"
                />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.field.port" />}>
                <TextControl
                  label={t('device.editor.field.port')}
                  inputMode="numeric"
                  value={port}
                  disabled={!editable}
                  onChange={(event) => setPort(event.target.value.replace(/\D/g, ''))}
                />
              </ControlCell>
            </ControlGrid>
          </SettingRow>

          <SettingRow
            label={<T k="device.editor.field.tls" />}
            hint={<T k="device.editor.field.tls.hint" />}
          >
            <ControlGrid columns={2}>
              <ControlCell>
                <Switch
                  checked={useHttps}
                  disabled={!editable}
                  onChange={(next) => {
                    setUseHttps(next);
                    setPort(next ? '443' : '80');
                  }}
                  label={t('device.editor.field.https')}
                />
              </ControlCell>
              <ControlCell>
                <Switch
                  checked={verifyTls}
                  disabled={!editable || !useHttps}
                  onChange={setVerifyTls}
                  label={t('device.editor.field.verifyTls')}
                />
              </ControlCell>
            </ControlGrid>
          </SettingRow>
        </SettingsGroup>

        {/*
          The credentials card exists only for a protocol that authenticates with them.

          Replaced rather than disabled on the others. A greyed-out password field reads as a
          control somebody lacks permission for, which sends them looking for the permission —
          when in fact the protocol has no password to store. The card that takes its place
          says what identifies the unit instead.
        */}
        {needsCredentials ? (
          <SettingsGroup
            title={<T k="device.editor.group.credentials" />}
            icon={<ShieldCheck className="size-3.5" aria-hidden />}
            action={
              <span className="text-[11px] font-semibold tracking-wide text-emerald-700 uppercase">
                <T k="device.editor.passwordStored" />
              </span>
            }
          >
            <SettingRow label={<T k="device.editor.field.username" />} required>
              <TextControl
                label={t('device.editor.field.username')}
                value={username}
                disabled={!editable}
                onChange={(event) => setUsername(event.target.value)}
              />
            </SettingRow>

            <SettingRow
              label={<T k="device.editor.field.password" />}
              hint={<T k="device.editor.field.password.hint" />}
            >
              <TextControl
                label={t('device.editor.field.password')}
                type="password"
                value={password}
                disabled={!editable}
                autoComplete="new-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
            </SettingRow>
          </SettingsGroup>
        ) : (
          <SettingsGroup
            title={<T k="device.editor.group.identification" />}
            icon={<ShieldCheck className="size-3.5" aria-hidden />}
            action={
              <span className="font-mono text-[11px] text-slate-500">
                {device.serialNumber ?? '—'}
              </span>
            }
          >
            <SettingRow
              label={<T k="device.editor.field.serialIdentity" />}
              hint={<T k="device.editor.field.serialIdentity.hint" />}
            >
              <StaticControl mono value={device.serialNumber ?? '—'} />
            </SettingRow>

            {device.serialNumber === null && (
              <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                <T k="device.editor.field.serialIdentity.missing" />
              </PanelNote>
            )}
          </SettingsGroup>
        )}

        <SettingsGroup
          title={<T k="device.editor.group.placement" />}
          icon={<DoorOpen className="size-3.5" aria-hidden />}
          action={
            <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <T
                k="device.editor.enrolled"
                vars={{ enrolled: device.enrolled, capacity: device.faceCapacity }}
              />
            </span>
          }
        >
          <SettingRow label={<T k="device.editor.field.location" />}>
            <ControlGrid columns={2}>
              <ControlCell caption={<T k="device.editor.field.location.caption" />}>
                <SelectControl
                  label={t('device.editor.field.location')}
                  value={locationId}
                  disabled={!editable}
                  onChange={(event) => setLocationId(event.target.value)}
                >
                  <option value="">{t('device.editor.field.location.none')}</option>
                  {locations.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </SelectControl>
              </ControlCell>
              <ControlCell
                caption={<T k="device.editor.field.doorNo" />}
                hint={<T k="device.editor.field.doorNo.hint" />}
              >
                <TextControl
                  label={t('device.editor.field.doorNo')}
                  inputMode="numeric"
                  value={doorNo}
                  disabled={!editable}
                  onChange={(event) => setDoorNo(event.target.value.replace(/\D/g, ''))}
                />
              </ControlCell>
            </ControlGrid>
          </SettingRow>

          <SettingRow
            label={<T k="device.editor.field.active" />}
            hint={<T k="device.editor.field.active.hint" />}
          >
            <Switch
              checked={active}
              disabled={!editable}
              onChange={setActive}
              label={t('device.editor.field.active')}
            />
          </SettingRow>
        </SettingsGroup>
      </SettingsStack>

      <PanelActions hint={<T k="device.editor.connection.hint" />}>
        <Button
          onClick={() => void submit()}
          disabled={busy || !editable || name.trim() === '' || host.trim() === ''}
        >
          <Save className="size-4" aria-hidden />
          <T k="device.editor.save" />
        </Button>
      </PanelActions>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Identity. Read only.
// ---------------------------------------------------------------------------

function IdentityTab({ device }: { device: DeviceRecord }): ReactNode {
  /** A connector collects commands and does not serve reads, so none is attempted. */
  const viaAgent = device.agentId !== null;

  const { data, error, loading, readAt, reload } = useTerminalRead<TerminalIdentity>(
    `/api/devices/${String(device.id)}/terminal/identity`,
    { skip: viaAgent },
  );

  /**
   * A serial that disagrees with the stored one means this address is answering for a
   * different box than the one holding these enrolments — a swapped unit, or two records
   * pointing at one terminal. Worth stating loudly: every mapping on the record belongs
   * to the serial we first saw.
   */
  const swapped =
    data !== null &&
    data.record.serialNumber !== null &&
    data.info.serialNumber !== data.record.serialNumber;

  /**
   * People on the unit but nothing to scan with.
   *
   * Uses `?? 0`, so a protocol that does not break its counts down by credential reads as
   * zero-of-each and therefore flags. That is the safer direction: the note asks somebody to
   * check, and a missed warning here means people who cannot clock in.
   */
  const noCredentials =
    data !== null &&
    (data.counts.withFace ?? 0) === 0 &&
    (data.counts.withFingerprint ?? 0) === 0 &&
    (data.counts.withCard ?? 0) === 0 &&
    data.counts.people > 0;

  return (
    <>
      <LiveSection
        icon={<Search className="size-4" aria-hidden />}
        titleKey="device.editor.identity.title"
        subtitleKey="device.editor.identity.subtitle"
        readAt={readAt}
        loading={loading}
        onReload={() => void reload()}
        unavailable={viaAgent}
      />

      <SettingsStack>
        <Feedback error={error} />

        {viaAgent && <ConnectorManagedNote device={device} />}

        {swapped && (
          <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T
              k="device.editor.identity.serialMismatch"
              vars={{
                live: data.info.serialNumber,
                stored: data.record.serialNumber ?? '',
              }}
            />
          </PanelNote>
        )}

        <SettingsGroup
          title={<T k="device.editor.identity.group.unit" />}
          icon={<Settings2 className="size-3.5" aria-hidden />}
          action={
            <span className="font-mono text-[11px] text-slate-500">
              {data?.info.firmware ?? '—'}
            </span>
          }
        >
          <SettingRow label={<T k="device.editor.identity.model" />}>
            <ControlGrid columns={2}>
              <ControlCell caption={<T k="device.editor.identity.model.caption" />}>
                <StaticControl value={data?.info.model ?? '—'} mono />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.identity.deviceName" />}>
                <StaticControl value={data?.info.name ?? '—'} />
              </ControlCell>
            </ControlGrid>
          </SettingRow>

          <SettingRow label={<T k="device.editor.identity.firmware" />}>
            <ControlGrid columns={2}>
              <ControlCell caption={<T k="device.editor.identity.firmware.caption" />}>
                <StaticControl value={data?.info.firmware ?? '—'} mono />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.identity.mac" />}>
                {/*
                  The firmware release date used to sit here. It was a Hikvision-only field, so
                  the cell would be empty on every other vendor — and the MAC address is both
                  reported by all of them and the more useful thing to see next to a serial
                  number when identifying which box is at an address.
                */}
                <StaticControl value={data?.info.macAddress ?? '—'} mono />
              </ControlCell>
            </ControlGrid>
          </SettingRow>

          <SettingRow
            label={<T k="device.editor.identity.serial" />}
            hint={<T k="device.editor.identity.serial.hint" />}
          >
            <ControlGrid columns={2}>
              <ControlCell caption={<T k="device.editor.identity.serial.live" />}>
                <StaticControl
                  value={data?.info.serialNumber ?? '—'}
                  mono
                  tone={swapped ? 'danger' : 'neutral'}
                />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.identity.mac" />}>
                <StaticControl value={data?.info.macAddress ?? '—'} mono />
              </ControlCell>
            </ControlGrid>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="device.editor.identity.group.credentials" />}
          icon={<ShieldCheck className="size-3.5" aria-hidden />}
          action={
            <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <T
                k="device.editor.enrolled"
                vars={{
                  enrolled: data?.counts.people ?? 0,
                  capacity: data?.capacity?.faces ?? device.faceCapacity,
                }}
              />
            </span>
          }
        >
          <SettingRow
            label={<T k="device.editor.identity.users" />}
            hint={<T k="device.editor.identity.users.hint" />}
          >
            <ControlGrid columns={4}>
              <ControlCell caption={<T k="device.editor.identity.users.caption" />}>
                <StaticControl value={String(data?.counts.people ?? '—')} mono />
              </ControlCell>
              {/*
                An em dash where a protocol does not break its counts down by credential, which
                is a different statement from zero. Printing 0 would assert that nobody on the
                unit has a face enrolled.
              */}
              <ControlCell caption={<T k="device.editor.identity.withFace" />}>
                <StaticControl value={String(data?.counts.withFace ?? '—')} mono />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.identity.withFingerprint" />}>
                <StaticControl value={String(data?.counts.withFingerprint ?? '—')} mono />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.identity.withCard" />}>
                <StaticControl value={String(data?.counts.withCard ?? '—')} mono />
              </ControlCell>
            </ControlGrid>
          </SettingRow>

          {noCredentials && (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T
                k="device.editor.identity.noCredentials"
                vars={{ count: data.counts.people }}
              />
            </PanelNote>
          )}
        </SettingsGroup>

        <SettingsGroup
          title={<T k="device.editor.identity.group.library" />}
          icon={<Search className="size-3.5" aria-hidden />}
        >
          {data !== null && data.libraries.length === 0 ? (
            <Unsupported>
              <T k="device.editor.identity.noLibrary" />
            </Unsupported>
          ) : (
            <SettingRow
              label={<T k="device.editor.identity.libraries" />}
              hint={<T k="device.editor.identity.libraries.hint" />}
            >
              <ControlGrid columns={2}>
                <ControlCell caption={<T k="device.editor.identity.libraries.caption" />}>
                  <StaticControl
                    value={
                      data === null
                        ? '—'
                        : data.libraries
                            .map((library) =>
                              library.name === null ? library.id : `${library.id}:${library.name}`,
                            )
                            .join(', ')
                    }
                    mono
                  />
                </ControlCell>
                <ControlCell caption={<T k="device.editor.identity.capacity" />}>
                  <StaticControl value={String(data?.capacity?.faces ?? '—')} mono />
                </ControlCell>
              </ControlGrid>
            </SettingRow>
          )}
        </SettingsGroup>
      </SettingsStack>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab 3 — Clock
// ---------------------------------------------------------------------------

function ClockTab({ device }: { device: DeviceRecord }): ReactNode {
  /** A connector collects commands and does not serve reads, so none is attempted. */
  const viaAgent = device.agentId !== null;

  const { t } = useLabels();
  const { can } = useAuth();
  const permitted = can('settings.devices', 'clock');
  const allowed = permitted && !viaAgent;

  const { data, error, loading, readAt, reload } = useTerminalRead<TerminalClock>(
    `/api/devices/${String(device.id)}/terminal/clock`,
    { skip: viaAgent },
  );

  const [ntpHost, setNtpHost] = useState('');
  const [ntpPort, setNtpPort] = useState('123');
  const [interval, setInterval] = useState('60');
  const [timeZone, setTimeZone] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  /**
   * Prefilled from what the terminal already holds.
   *
   * The old screen offered an empty box, so an operator could not tell whether NTP was
   * already pointed somewhere sensible or still at the factory placeholder — and an empty
   * box beside a working configuration invites overwriting it.
   */
  useEffect(() => {
    if (data === null) return;
    const slot = data.servers[0];
    if (slot !== undefined) {
      setNtpHost(slot.ipAddress ?? slot.hostName ?? '');
      setNtpPort(String(slot.portNo));
      setInterval(String(slot.synchronizeInterval));
    }
    // `?? ''` because a protocol that reports no zone leaves this null, and the field is a
    // controlled input that cannot hold one.
    setTimeZone((current) => (current === '' ? (data.timeZone ?? '') : current));
  }, [data]);

  const factoryPlaceholder = data?.servers.some((slot) => slot.ipAddress === '192.0.0.64') === true;
  const drifting = data !== null && Math.abs(data.driftSeconds) > 30;

  async function applyNtp(): Promise<void> {
    setBusy(true);
    setWriteError(null);
    setNotice(null);
    try {
      const result = await api.post<{ driftSeconds: number; timeMode: string }>(
        `/api/devices/${String(device.id)}/clock/ntp`,
        {
          host: ntpHost.trim(),
          timeZone: timeZone.trim(),
          intervalMinutes: Number(interval),
        },
      );
      setNotice(
        t('device.editor.clock.applied', {
          mode: result.timeMode,
          drift: result.driftSeconds,
        }),
      );
      await reload();
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause.message : t('app.error.save'));
    } finally {
      setBusy(false);
    }
  }

  async function applyManual(): Promise<void> {
    setBusy(true);
    setWriteError(null);
    setNotice(null);
    try {
      const result = await api.post<{ driftSeconds: number; timeMode: string }>(
        `/api/devices/${String(device.id)}/terminal/clock/manual`,
        { timeZone: timeZone.trim() },
      );
      setNotice(t('device.editor.clock.manual.applied', { drift: result.driftSeconds }));
      await reload();
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause.message : t('app.error.save'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <LiveSection
        icon={<Clock className="size-4" aria-hidden />}
        titleKey="device.editor.clock.title"
        subtitleKey="device.editor.clock.subtitle"
        readAt={readAt}
        loading={loading}
        onReload={() => void reload()}
        unavailable={viaAgent}
      />

      <SettingsStack>
        <Feedback error={error ?? writeError} notice={notice} />

        {viaAgent && <ConnectorManagedNote device={device} writable />}

        {!permitted && <ReadOnlyNote actionKey="perm.action.clock" />}

        <PanelNote
          tone={drifting ? 'warn' : 'info'}
          icon={<Clock className="size-3.5" aria-hidden />}
        >
          <T k="device.editor.clock.silentNote" />
        </PanelNote>

        <SettingsGroup
          title={<T k="device.editor.clock.group.state" />}
          icon={<Clock className="size-3.5" aria-hidden />}
          action={
            <span
              className={
                data?.manualClock === true
                  ? 'text-[11px] font-semibold tracking-wide text-amber-700 uppercase'
                  : 'text-[11px] font-semibold tracking-wide text-emerald-700 uppercase'
              }
            >
              {data?.timeMode ?? '—'}
            </span>
          }
        >
          <SettingRow
            label={<T k="device.editor.clock.drift" />}
            hint={<T k="device.editor.clock.drift.hint" />}
          >
            <ControlGrid columns={3}>
              <ControlCell caption={<T k="device.editor.clock.drift.caption" />}>
                <StaticControl
                  mono
                  tone={drifting ? 'warn' : 'success'}
                  value={
                    data === null
                      ? '—'
                      : `${data.driftSeconds > 0 ? '+' : ''}${String(data.driftSeconds)}s`
                  }
                />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.clock.deviceTime" />}>
                <StaticControl
                  mono
                  value={data === null ? '—' : formatDateTime(data.deviceTime)}
                />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.clock.serverTime" />}>
                <StaticControl
                  mono
                  value={data === null ? '—' : formatDateTime(data.serverTime)}
                />
              </ControlCell>
            </ControlGrid>
          </SettingRow>

          <SettingRow
            label={<T k="device.editor.clock.slots" />}
            hint={<T k="device.editor.clock.slots.hint" />}
          >
            {data !== null && data.servers.length === 0 ? (
              <StaticControl value={t('device.editor.clock.slots.none')} />
            ) : (
              <div className="space-y-2">
                {(data?.servers ?? []).map((slot) => (
                  <StaticControl
                    key={slot.id}
                    mono
                    tone={slot.ipAddress === '192.0.0.64' ? 'warn' : 'neutral'}
                    value={`#${slot.id} · ${slot.ipAddress ?? slot.hostName ?? '—'}:${String(
                      slot.portNo,
                    )} · ${String(slot.synchronizeInterval)} min`}
                  />
                ))}
              </div>
            )}
            {factoryPlaceholder && (
              <p className="mt-1.5 text-xs text-amber-800">
                <T k="device.editor.clock.slots.placeholder" />
              </p>
            )}
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="device.editor.clock.group.ntp" />}
          icon={<Radio className="size-3.5" aria-hidden />}
          subtitle={<T k="device.editor.clock.group.ntp.subtitle" />}
        >
          <SettingRow
            label={<T k="device.editor.clock.ntpHost" />}
            hint={<T k="device.editor.clock.ntpHost.hint" />}
            required
          >
            <ControlGrid columns={3}>
              <ControlCell caption={<T k="device.editor.clock.ntpHost.caption" />}>
                <TextControl
                  label={t('device.editor.clock.ntpHost')}
                  value={ntpHost}
                  disabled={!allowed}
                  onChange={(event) => setNtpHost(event.target.value)}
                  placeholder="192.168.1.1"
                />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.clock.ntpPort" />}>
                <TextControl
                  label={t('device.editor.clock.ntpPort')}
                  inputMode="numeric"
                  value={ntpPort}
                  disabled={!allowed}
                  onChange={(event) => setNtpPort(event.target.value.replace(/\D/g, ''))}
                />
              </ControlCell>
              <ControlCell
                caption={<T k="device.editor.clock.ntpInterval" />}
                hint={<T k="device.editor.clock.ntpInterval.hint" />}
              >
                <TextControl
                  label={t('device.editor.clock.ntpInterval')}
                  inputMode="numeric"
                  value={interval}
                  disabled={!allowed}
                  onChange={(event) => setInterval(event.target.value.replace(/\D/g, ''))}
                />
              </ControlCell>
            </ControlGrid>
          </SettingRow>

          <SettingRow
            label={<T k="device.editor.clock.timeZone" />}
            hint={<T k="device.editor.clock.timeZone.hint" />}
            required
          >
            <ControlGrid columns={2}>
              <ControlCell caption={<T k="device.editor.clock.timeZone.caption" />}>
                <TextControl
                  label={t('device.editor.clock.timeZone')}
                  value={timeZone}
                  disabled={!allowed}
                  onChange={(event) => setTimeZone(event.target.value)}
                  placeholder="CST-8:00:00"
                />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.clock.orgTimeZone" />}>
                <StaticControl value={data?.orgTimeZone ?? '—'} mono />
              </ControlCell>
            </ControlGrid>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="device.editor.clock.group.manual" />}
          icon={<TriangleAlert className="size-3.5" aria-hidden />}
          subtitle={<T k="device.editor.clock.group.manual.subtitle" />}
        >
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="device.editor.clock.manual.note" />
          </PanelNote>
          <SettingRow
            label={<T k="device.editor.clock.manual.action" />}
            hint={<T k="device.editor.clock.manual.action.hint" />}
          >
            <Button
              variant="ghost"
              onClick={() => void applyManual()}
              disabled={busy || !allowed || timeZone.trim() === ''}
            >
              <Clock className="size-4" aria-hidden />
              <T k="device.editor.clock.manual.apply" />
            </Button>
          </SettingRow>
        </SettingsGroup>
      </SettingsStack>

      <PanelActions hint={<T k="device.editor.clock.hint" />}>
        <Button
          onClick={() => void applyNtp()}
          disabled={busy || !allowed || ntpHost.trim() === '' || timeZone.trim() === ''}
        >
          <Save className="size-4" aria-hidden />
          <T k="device.editor.clock.apply" />
        </Button>
      </PanelActions>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab 4 — Attendance mode
// ---------------------------------------------------------------------------

function AttendanceTab({ device }: { device: DeviceRecord }): ReactNode {
  /** A connector collects commands and does not serve reads, so none is attempted. */
  const viaAgent = device.agentId !== null;

  const { t } = useLabels();
  const { can } = useAuth();
  const permitted = can('settings.devices', 'terminal');
  const allowed = permitted && !viaAgent;

  const { data, error, loading, readAt, reload } = useTerminalRead<AttendanceModeState>(
    `/api/devices/${String(device.id)}/terminal/attendance`,
    { skip: viaAgent },
  );

  const [mode, setMode] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  useEffect(() => {
    if (data !== null) setMode(data.mode);
  }, [data]);

  const options: RadioOption[] = useMemo(
    () => [
      {
        value: 'disable',
        label: <T k="device.editor.attendance.mode.disable" />,
        hint: <T k="device.editor.attendance.mode.disable.hint" />,
      },
      {
        value: 'manual',
        label: <T k="device.editor.attendance.mode.manual" />,
        hint: <T k="device.editor.attendance.mode.manual.hint" />,
      },
      {
        value: 'auto',
        label: <T k="device.editor.attendance.mode.auto" />,
        hint: <T k="device.editor.attendance.mode.auto.hint" />,
      },
      {
        value: 'manualAndAuto',
        label: <T k="device.editor.attendance.mode.manualAndAuto" />,
        hint: <T k="device.editor.attendance.mode.manualAndAuto.hint" />,
      },
    ],
    [],
  );

  async function submit(): Promise<void> {
    setBusy(true);
    setWriteError(null);
    setNotice(null);
    try {
      await api.put(`/api/devices/${String(device.id)}/terminal/attendance`, { mode });
      setNotice(t('device.editor.attendance.saved'));
      await reload();
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause.message : t('app.error.save'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <LiveSection
        icon={<ClipboardList className="size-4" aria-hidden />}
        titleKey="device.editor.attendance.title"
        subtitleKey="device.editor.attendance.subtitle"
        readAt={readAt}
        loading={loading}
        onReload={() => void reload()}
        unavailable={viaAgent}
      />

      <SettingsStack>
        <Feedback error={error ?? writeError} notice={notice} />

        {viaAgent && <ConnectorManagedNote device={device} writable />}

        {!permitted && <ReadOnlyNote actionKey="perm.action.terminalConfig" />}

        <SettingsGroup
          title={<T k="device.editor.attendance.group.mode" />}
          icon={<ClipboardList className="size-3.5" aria-hidden />}
          action={
            <span className="font-mono text-[11px] tracking-wide text-slate-500 uppercase">
              {data?.mode ?? '—'}
            </span>
          }
        >
          <SettingRow
            label={<T k="device.editor.attendance.mode" />}
            hint={<T k="device.editor.attendance.mode.hint" />}
          >
            <RadioControl
              name="attendance-mode"
              label={t('device.editor.attendance.mode')}
              value={mode}
              disabled={!allowed || loading}
              onChange={setMode}
              options={options}
            />
          </SettingRow>

          {/*
            Read and shown, never written. The firmware treats these as part of the mode's
            own definition and nothing in this application consumes them — a control that
            writes a setting nothing reads is a control that appears to work and does
            nothing, which is worse than no control.
          */}
          <SettingRow
            label={<T k="device.editor.attendance.derived" />}
            hint={<T k="device.editor.attendance.derived.hint" />}
          >
            <ControlGrid columns={2}>
              <ControlCell caption={<T k="device.editor.attendance.statusTime" />}>
                <StaticControl
                  mono
                  value={data === null ? '—' : `${String(data.attendanceStatusTime)}s`}
                />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.attendance.reqStatus" />}>
                <StaticControl
                  value={
                    data === null ? (
                      '—'
                    ) : (
                      <T k={data.reqAttendanceStatus ? 'app.status.active' : 'app.status.inactive'} />
                    )
                  }
                />
              </ControlCell>
            </ControlGrid>
          </SettingRow>
        </SettingsGroup>

        <PanelNote icon={<TriangleAlert className="size-3.5" aria-hidden />}>
          <T k="device.editor.attendance.note" />
        </PanelNote>
      </SettingsStack>

      <PanelActions hint={<T k="device.editor.attendance.hint" />}>
        <Button
          onClick={() => void submit()}
          disabled={busy || !allowed || mode === '' || mode === data?.mode}
        >
          <Save className="size-4" aria-hidden />
          <T k="device.editor.attendance.apply" />
        </Button>
      </PanelActions>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab 5 — Door and authentication
// ---------------------------------------------------------------------------

function DoorTab({ device }: { device: DeviceRecord }): ReactNode {
  /** A connector collects commands and does not serve reads, so none is attempted. */
  const viaAgent = device.agentId !== null;

  const { t } = useLabels();
  const { can } = useAuth();
  const permitted = can('settings.devices', 'terminal');
  const allowed = permitted && !viaAgent;

  const { data, error, loading, readAt, reload } = useTerminalRead<TerminalDoor>(
    `/api/devices/${String(device.id)}/terminal/door`,
    { skip: viaAgent },
  );

  const [verifyMode, setVerifyMode] = useState('');
  const [fingerprintLevel, setFingerprintLevel] = useState('');
  const [faceThreshold, setFaceThreshold] = useState('');
  const [liveness, setLiveness] = useState(false);
  const [livenessLevel, setLivenessLevel] = useState('');
  const [remoteCheck, setRemoteCheck] = useState(false);
  const [openDuration, setOpenDuration] = useState('');
  const [disabledOpenDuration, setDisabledOpenDuration] = useState('');
  const [alarmTimeout, setAlarmTimeout] = useState('');
  const [magneticType, setMagneticType] = useState('');
  const [showPicture, setShowPicture] = useState(false);
  const [showEmployeeNo, setShowEmployeeNo] = useState(false);
  const [showName, setShowName] = useState(false);
  const [voicePrompt, setVoicePrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (data === null) return;
    const reader = data.reader;
    const door = data.door;

    setVerifyMode(reader?.verifyMode ?? '');
    setFingerprintLevel(numberToField(reader?.fingerprintLevel));
    setFaceThreshold(numberToField(reader?.faceThreshold));
    setLiveness(reader?.livenessEnabled === true);
    setLivenessLevel(reader?.livenessLevel ?? '');

    setOpenDuration(numberToField(door?.openSeconds));
    setDisabledOpenDuration(numberToField(door?.extendedOpenSeconds));
    setAlarmTimeout(numberToField(door?.heldOpenAlarmSeconds));
    setMagneticType(door?.sensorRestState ?? '');

    // Null on any protocol without an `AcsCfg` document, in which case the whole card is
    // omitted below and these states are never read.
    setRemoteCheck(data.acs?.remoteCheckDoorEnabled === true);
    setShowPicture(data.acs?.showPicture === true);
    setShowEmployeeNo(data.acs?.showEmployeeNo === true);
    setShowName(data.acs?.showName === true);
    setVoicePrompt(data.acs?.voicePrompt === true);
  }, [data]);

  /**
   * Authentication modes.
   *
   * The terminal holds a value for `defaultVerifyMode` but its capability document does
   * not enumerate the accepted set — confirmed by probing V4.38.0. So the list is the
   * documented one, marked on screen as unverified, plus whatever the unit currently
   * holds so the present setting is always selectable. A firmware that does publish an
   * option list overrides all of it, which is why the device's answer is checked first.
   */
  const verifyOptions: RadioOption[] = useMemo(() => {
    // Keyed by the firmware's own field name, because the option lists come straight from its
    // capability document and are not renamed by the driver.
    const published = data?.options['defaultVerifyMode'] ?? [];
    const current = data?.reader?.verifyMode;
    const values =
      published.length > 0
        ? published
        : [...DOCUMENTED_VERIFY_MODES, ...(current !== undefined && current !== null && !DOCUMENTED_VERIFY_MODES.includes(current) ? [current] : [])];

    return values.map((value) => ({
      value,
      // Registry wording when we have words for the mode, and the firmware's own token
      // otherwise. An unrecognised mode stays selectable: hiding it would be this screen
      // deciding the terminal is wrong about what it supports.
      label: <TEnum k={VERIFY_MODE_LABELS[value]} fallback={value} />,
      ...(VERIFY_MODE_HINTS[value] === undefined
        ? {}
        : { hint: <T k={VERIFY_MODE_HINTS[value]} /> }),
    }));
  }, [data?.options, data?.reader?.verifyMode]);

  /** Not a 1-5 scale. V4.38.0 accepts 3, 5, 6, 12 and 13, and says so in its capabilities. */
  const fingerprintLevels = data?.options['fingerPrintCheckLevel'] ?? OBSERVED_FINGERPRINT_LEVELS;
  const livenessLevels = data?.options['liveDetLevelSet'] ?? OBSERVED_LIVENESS_LEVELS;
  const verifyModePublished = (data?.options['defaultVerifyMode'] ?? []).length > 0;

  async function submit(): Promise<void> {
    setBusy(true);
    setWriteError(null);
    setNotice(null);
    try {
      const result = await api.put<{ applied: string[]; failures: DoorFailure[] }>(
        `/api/devices/${String(device.id)}/terminal/door`,
        {
          /**
           * Omitted entirely when the protocol has no `AcsCfg` document.
           *
           * Sending an empty object would make the server attempt a Hikvision-only write
           * against a unit that has never heard of it, and report a failure for a group the
           * screen never showed.
           *
           * Within it, only the fields this firmware actually reported: a switch bound to an
           * absent field writes a name the device accepts and ignores.
           */
          ...(data?.acs == null
            ? {}
            : {
                acs: {
                  remoteCheckDoorEnabled: remoteCheck,
                  ...(data.acs.showPicture === null ? {} : { showPicture }),
                  ...(data.acs.showEmployeeNo === null ? {} : { showEmployeeNo }),
                  ...(data.acs.showName === null ? {} : { showName }),
                  ...(data.acs.voicePrompt === null ? {} : { voicePrompt }),
                },
              }),
          ...(data?.door == null
            ? {}
            : {
                door: {
                  ...(openDuration === '' ? {} : { openDuration: Number(openDuration) }),
                  ...(disabledOpenDuration === ''
                    ? {}
                    : { disabledOpenDuration: Number(disabledOpenDuration) }),
                  ...(alarmTimeout === ''
                    ? {}
                    : { magneticAlarmTimeout: Number(alarmTimeout) }),
                  ...(magneticType === '' ? {} : { magneticType }),
                },
              }),
          ...(data?.reader == null
            ? {}
            : {
                reader: {
                  ...(verifyMode === '' ? {} : { defaultVerifyMode: verifyMode }),
                  ...(fingerprintLevel === ''
                    ? {}
                    : { fingerprintLevel: Number(fingerprintLevel) }),
                  ...(faceThreshold === ''
                    ? {}
                    : { faceMatchThresholdN: Number(faceThreshold) }),
                  ...(data.reader.livenessEnabled === null
                    ? {}
                    : { livingBodyDetect: liveness }),
                  ...(livenessLevel === '' ? {} : { liveDetLevel: livenessLevel }),
                },
              }),
        },
      );

      /*
        Three endpoints, so three possible outcomes rather than one. The reader accepting
        a change while the door refuses one is a real result, and reporting it as a plain
        success would leave somebody believing a setting took that did not.
      */
      if (result.failures.length > 0) {
        setWriteError(
          t('device.editor.door.partial', {
            applied: result.applied.length,
            failed: result.failures.map((row) => `${row.group}: ${row.error}`).join('; '),
          }),
        );
      } else {
        setNotice(t('device.editor.door.saved', { count: result.applied.length }));
      }
      await reload();
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause.message : t('app.error.save'));
    } finally {
      setBusy(false);
    }
  }

  async function openDoor(): Promise<void> {
    setBusy(true);
    setWriteError(null);
    setNotice(null);
    try {
      await api.post(`/api/devices/${String(device.id)}/terminal/door/open`);
      setNotice(t('device.editor.door.opened', { doorNo: device.doorNo }));
      setConfirmOpen(false);
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause.message : t('device.editor.door.open.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <LiveSection
        icon={<DoorOpen className="size-4" aria-hidden />}
        titleKey="device.editor.door.title"
        subtitleKey="device.editor.door.subtitle"
        readAt={readAt}
        loading={loading}
        onReload={() => void reload()}
        unavailable={viaAgent}
      />

      <SettingsStack>
        <Feedback error={error ?? writeError} notice={notice} />

        {viaAgent && <ConnectorManagedNote device={device} writable />}

        {!permitted && <ReadOnlyNote actionKey="perm.action.terminalConfig" />}

        <SettingsGroup
          title={<T k="device.editor.door.group.verify" />}
          icon={<ShieldCheck className="size-3.5" aria-hidden />}
          subtitle={<T k="device.editor.door.group.verify.subtitle" />}
          action={
            <span className="font-mono text-[11px] text-slate-500">
              {data?.reader?.verifyMode ?? '—'}
            </span>
          }
        >
          {data !== null && data.reader === null ? (
            <Unsupported>
              <T k="device.editor.door.reader.unsupported" />
            </Unsupported>
          ) : (
            <>
              <SettingRow
                label={<T k="device.editor.door.verifyMode" />}
                hint={<T k="device.editor.door.verifyMode.hint" />}
              >
                <RadioControl
                  name="verify-mode"
                  label={t('device.editor.door.verifyMode')}
                  value={verifyMode}
                  disabled={!allowed}
                  onChange={setVerifyMode}
                  options={verifyOptions}
                />
                {!verifyModePublished && (
                  <p className="mt-1.5 text-xs text-amber-800">
                    <T k="device.editor.door.verifyMode.unpublished" />
                  </p>
                )}
              </SettingRow>

              <SettingRow
                label={<T k="device.editor.door.modules" />}
                hint={<T k="device.editor.door.modules.hint" />}
              >
                <StaticControl
                  mono
                  value={
                    data === null || data.reader === null || data.reader.functions.length === 0
                      ? '—'
                      : data.reader.functions.join(' + ')
                  }
                />
              </SettingRow>

              <SettingRow
                label={<T k="device.editor.door.thresholds" />}
                hint={<T k="device.editor.door.thresholds.hint" />}
              >
                <ControlGrid columns={2}>
                  <ControlCell
                    caption={<T k="device.editor.door.faceThreshold" />}
                    hint={<T k="device.editor.door.faceThreshold.hint" />}
                  >
                    <TextControl
                      label={t('device.editor.door.faceThreshold')}
                      inputMode="numeric"
                      value={faceThreshold}
                      disabled={!allowed}
                      onChange={(event) => setFaceThreshold(event.target.value.replace(/\D/g, ''))}
                    />
                  </ControlCell>
                  <ControlCell
                    caption={<T k="device.editor.door.fingerprintLevel" />}
                    hint={<T k="device.editor.door.fingerprintLevel.hint" />}
                  >
                    <SelectControl
                      label={t('device.editor.door.fingerprintLevel')}
                      value={fingerprintLevel}
                      disabled={!allowed}
                      onChange={(event) => setFingerprintLevel(event.target.value)}
                    >
                      <option value="">{t('device.editor.door.unchanged')}</option>
                      {fingerprintLevels.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </SelectControl>
                  </ControlCell>
                </ControlGrid>
              </SettingRow>
            </>
          )}
        </SettingsGroup>

        {/*
          Anti-spoofing, its own group rather than a row among the thresholds.
          The probe found it switched off on the test unit, which means a photograph is
          not being screened out — that is a security state, not a tuning knob.
        */}
        {data?.reader != null && (
          <SettingsGroup
            title={<T k="device.editor.door.group.liveness" />}
            icon={<ScanFace className="size-3.5" aria-hidden />}
            action={
              <span
                className={
                  liveness
                    ? 'text-[11px] font-semibold tracking-wide text-emerald-700 uppercase'
                    : 'text-[11px] font-semibold tracking-wide text-rose-700 uppercase'
                }
              >
                <T k={liveness ? 'app.status.active' : 'app.status.inactive'} />
              </span>
            }
          >
            {!liveness && (
              <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                <T k="device.editor.door.liveness.offWarning" />
              </PanelNote>
            )}

            <SettingRow
              label={<T k="device.editor.door.liveness" />}
              hint={<T k="device.editor.door.liveness.hint" />}
            >
              <Switch
                checked={liveness}
                disabled={!allowed || data.reader.livenessEnabled === null}
                onChange={setLiveness}
                label={t('device.editor.door.liveness')}
              />
            </SettingRow>

            <SettingRow
              label={<T k="device.editor.door.livenessLevel" />}
              hint={<T k="device.editor.door.livenessLevel.hint" />}
            >
              <ControlGrid columns={2}>
                <ControlCell caption={<T k="device.editor.door.livenessLevel.caption" />}>
                  <SelectControl
                    label={t('device.editor.door.livenessLevel')}
                    value={livenessLevel}
                    disabled={!allowed || !liveness}
                    onChange={(event) => setLivenessLevel(event.target.value)}
                  >
                    <option value="">{t('device.editor.door.unchanged')}</option>
                    {livenessLevels.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </SelectControl>
                </ControlCell>
              </ControlGrid>
            </SettingRow>
          </SettingsGroup>
        )}

        <SettingsGroup
          title={<T k="device.editor.door.group.remote" />}
          icon={<Radio className="size-3.5" aria-hidden />}
          action={
            <span
              className={
                remoteCheck
                  ? 'text-[11px] font-semibold tracking-wide text-amber-700 uppercase'
                  : 'text-[11px] font-semibold tracking-wide text-emerald-700 uppercase'
              }
            >
              <T k={remoteCheck ? 'device.editor.door.remote.on' : 'device.editor.door.remote.off'} />
            </span>
          }
        >
          <SettingRow
            label={<T k="device.editor.door.remoteCheck" />}
            hint={<T k="device.editor.door.remoteCheck.hint" />}
          >
            <Switch
              checked={remoteCheck}
              disabled={!allowed}
              onChange={setRemoteCheck}
              label={t('device.editor.door.remoteCheck')}
            />
          </SettingRow>

          <SettingRow label={<T k="device.editor.door.remoteDetail" />}>
            <ControlGrid columns={2}>
              <ControlCell caption={<T k="device.editor.door.channel" />}>
                <StaticControl value={String(data?.acs?.checkChannelType ?? '—')} mono />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.door.timeout" />}>
                <StaticControl value={String(data?.acs?.remoteCheckTimeout ?? '—')} mono />
              </ControlCell>
            </ControlGrid>
          </SettingRow>

          {remoteCheck && (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="device.editor.door.remoteWarning" />
            </PanelNote>
          )}
        </SettingsGroup>

        <SettingsGroup
          title={<T k="device.editor.door.group.behaviour" />}
          icon={<DoorOpen className="size-3.5" aria-hidden />}
          action={
            <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <T k="device.editor.door.doorNo" vars={{ doorNo: data?.doorNo ?? device.doorNo }} />
            </span>
          }
        >
          {data !== null && data.door === null ? (
            <Unsupported>
              <T k="device.editor.door.param.unsupported" />
            </Unsupported>
          ) : (
            <>
              <SettingRow
                label={<T k="device.editor.door.timing" />}
                hint={<T k="device.editor.door.timing.hint" />}
              >
                <ControlGrid columns={3}>
                  <ControlCell
                    caption={<T k="device.editor.door.openDuration" />}
                    hint={<T k="device.editor.door.openDuration.hint" />}
                  >
                    <TextControl
                      label={t('device.editor.door.openDuration')}
                      inputMode="numeric"
                      value={openDuration}
                      disabled={!allowed}
                      onChange={(event) => setOpenDuration(event.target.value.replace(/\D/g, ''))}
                    />
                  </ControlCell>
                  <ControlCell
                    caption={<T k="device.editor.door.disabledOpenDuration" />}
                    hint={<T k="device.editor.door.disabledOpenDuration.hint" />}
                  >
                    <TextControl
                      label={t('device.editor.door.disabledOpenDuration')}
                      inputMode="numeric"
                      value={disabledOpenDuration}
                      disabled={!allowed}
                      onChange={(event) =>
                        setDisabledOpenDuration(event.target.value.replace(/\D/g, ''))
                      }
                    />
                  </ControlCell>
                  <ControlCell
                    caption={<T k="device.editor.door.alarmTimeout" />}
                    hint={<T k="device.editor.door.alarmTimeout.hint" />}
                  >
                    <TextControl
                      label={t('device.editor.door.alarmTimeout')}
                      inputMode="numeric"
                      value={alarmTimeout}
                      disabled={!allowed}
                      onChange={(event) => setAlarmTimeout(event.target.value.replace(/\D/g, ''))}
                    />
                  </ControlCell>
                </ControlGrid>
              </SettingRow>

              <SettingRow
                label={<T k="device.editor.door.sensors" />}
                hint={<T k="device.editor.door.sensors.hint" />}
              >
                <ControlGrid columns={2}>
                  <ControlCell caption={<T k="device.editor.door.magneticType" />}>
                    <SelectControl
                      label={t('device.editor.door.magneticType')}
                      value={magneticType}
                      disabled={!allowed}
                      onChange={(event) => setMagneticType(event.target.value)}
                    >
                      <option value="">{t('device.editor.door.unchanged')}</option>
                      <option value="alwaysClose">
                        {t('device.editor.door.magneticType.alwaysClose')}
                      </option>
                      <option value="alwaysOpen">
                        {t('device.editor.door.magneticType.alwaysOpen')}
                      </option>
                    </SelectControl>
                  </ControlCell>
                  {/*
                    Read only. The exit button's resting state is wired in hardware, and a
                    control that changed it without the wiring changing would leave the
                    door reporting the opposite of what it is doing.
                  */}
                  <ControlCell caption={<T k="device.editor.door.exitButton" />}>
                    <StaticControl mono value={data?.door?.exitButtonRestState ?? '—'} />
                  </ControlCell>
                </ControlGrid>
              </SettingRow>
            </>
          )}

          <SettingRow
            label={<T k="device.editor.door.remoteOpen" />}
            hint={<T k="device.editor.door.remoteOpen.hint" />}
          >
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(true)}
              disabled={busy || !allowed}
              className="border-rose-300 text-rose-700 hover:bg-rose-50"
            >
              <Unlock className="size-4" aria-hidden />
              <T k="device.editor.door.open" />
            </Button>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="device.editor.door.group.display" />}
          icon={<Settings2 className="size-3.5" aria-hidden />}
        >
          <SettingRow
            label={<T k="device.editor.door.onScreen" />}
            hint={<T k="device.editor.door.onScreen.hint" />}
          >
            <ControlGrid columns={3}>
              <ControlCell caption={<T k="device.editor.door.showName" />}>
                <Switch
                  checked={showName}
                  disabled={!allowed || data?.acs?.showName === null}
                  onChange={setShowName}
                  label={t('device.editor.door.showName')}
                  showLabel={false}
                />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.door.showEmployeeNo" />}>
                <Switch
                  checked={showEmployeeNo}
                  disabled={!allowed || data?.acs?.showEmployeeNo === null}
                  onChange={setShowEmployeeNo}
                  label={t('device.editor.door.showEmployeeNo')}
                  showLabel={false}
                />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.door.showPicture" />}>
                <Switch
                  checked={showPicture}
                  disabled={!allowed || data?.acs?.showPicture === null}
                  onChange={setShowPicture}
                  label={t('device.editor.door.showPicture')}
                  showLabel={false}
                />
              </ControlCell>
            </ControlGrid>
          </SettingRow>

          {/*
            Masking, read only. Both were on for the test unit. Turning them off puts
            names and staff numbers on a screen in a public corridor, so it belongs behind
            a decision somebody records rather than a switch on a settings tab.
          */}
          <SettingRow
            label={<T k="device.editor.door.masking" />}
            hint={<T k="device.editor.door.masking.hint" />}
          >
            <ControlGrid columns={2}>
              <ControlCell caption={<T k="device.editor.door.showName" />}>
                <StaticControl
                  value={<T k={maskLabel(data?.acs?.desensitiseName)} />}
                  tone={data?.acs?.desensitiseName === false ? 'warn' : 'neutral'}
                />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.door.showEmployeeNo" />}>
                <StaticControl
                  value={<T k={maskLabel(data?.acs?.desensitiseEmployeeNo)} />}
                  tone={data?.acs?.desensitiseEmployeeNo === false ? 'warn' : 'neutral'}
                />
              </ControlCell>
            </ControlGrid>
          </SettingRow>

          <SettingRow
            label={<T k="device.editor.door.voicePrompt" />}
            hint={<T k="device.editor.door.voicePrompt.hint" />}
          >
            <Switch
              checked={voicePrompt}
              disabled={!allowed || data?.acs?.voicePrompt === null}
              onChange={setVoicePrompt}
              label={t('device.editor.door.voicePrompt')}
            />
          </SettingRow>
        </SettingsGroup>
      </SettingsStack>

      <PanelActions hint={<T k="device.editor.door.hint" />}>
        <Button onClick={() => void submit()} disabled={busy || !allowed || loading}>
          <Save className="size-4" aria-hidden />
          <T k="device.editor.door.apply" />
        </Button>
      </PanelActions>

      {confirmOpen && (
        <Dialog
          title={<T k="device.editor.door.open.confirm.title" />}
          titleText={t('device.editor.door.open.confirm.title')}
          description={
            <T k="device.editor.door.open.confirm.description" vars={{ name: device.name }} />
          }
          onClose={() => setConfirmOpen(false)}
        >
          <div className="space-y-4">
            <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="device.editor.door.open.confirm.body" />
            </PanelNote>
            <DialogFooter
              onClose={() => setConfirmOpen(false)}
              onSubmit={() => void openDoor()}
              busy={busy}
              submitLabel={<T k="device.editor.door.open" />}
            />
          </div>
        </Dialog>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab 6 — Push slots
// ---------------------------------------------------------------------------

function PushTab({ device }: { device: DeviceRecord }): ReactNode {
  /** A connector collects commands and does not serve reads, so none is attempted. */
  const viaAgent = device.agentId !== null;

  const { t } = useLabels();
  const { can } = useAuth();
  const permitted = can('settings.devices', 'sync');
  const allowed = permitted && !viaAgent;

  const { data, error, loading, readAt, reload } = useTerminalRead<PushHost[]>(
    `/api/devices/${String(device.id)}/push`,
    { skip: viaAgent },
  );

  const [host, setHost] = useState('');
  const [port, setPort] = useState('8080');
  const [path, setPath] = useState('/hik/events');
  const [slot, setSlot] = useState('1');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  async function configure(): Promise<void> {
    setBusy(true);
    setWriteError(null);
    setNotice(null);
    try {
      const result = await api.post<{ ok: boolean; configured: string }>(
        `/api/devices/${String(device.id)}/push`,
        {
          host: host.trim(),
          port: Number(port),
          path: path.trim(),
          useHttps: false,
          slot: Number(slot),
        },
      );
      setNotice(t('device.editor.push.configured', { target: result.configured }));
      await reload();
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause.message : t('app.error.save'));
    } finally {
      setBusy(false);
    }
  }

  async function clear(which: number): Promise<void> {
    setBusy(true);
    setWriteError(null);
    setNotice(null);
    try {
      await api.delete(`/api/devices/${String(device.id)}/push/${String(which)}`);
      setNotice(t('device.editor.push.cleared', { slot: which }));
      await reload();
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause.message : t('app.error.remove'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Both slots, always drawn.
   *
   * The firmware has exactly two, and an unconfigured one is information: it is where a
   * second server would go. Drawing only the populated ones would make the ceiling
   * invisible, which is how somebody discovers it by having a configuration silently
   * refused.
   */
  const slots = [1, 2].map((id) => {
    const match = data?.find((row) => row.slot === id) ?? null;
    // A slot the terminal reports with no address is free, not broken. The driver collapses a
    // zero address to an empty string precisely so this check is one comparison.
    return { id, host: match !== null && match.url !== '' ? match : null };
  });

  return (
    <>
      <LiveSection
        icon={<Radio className="size-4" aria-hidden />}
        titleKey="device.editor.push.title"
        subtitleKey="device.editor.push.subtitle"
        readAt={readAt}
        loading={loading}
        onReload={() => void reload()}
        unavailable={viaAgent}
      />

      <SettingsStack>
        <Feedback error={error ?? writeError} notice={notice} />

        {viaAgent && <ConnectorManagedNote device={device} writable />}

        {!permitted && <ReadOnlyNote actionKey="perm.action.sync.push" />}

        {slots.map((entry) => (
          <SettingsGroup
            key={entry.id}
            title={<T k="device.editor.push.slot" vars={{ slot: entry.id }} />}
            icon={<Radio className="size-3.5" aria-hidden />}
            action={
              <span
                className={
                  entry.host === null
                    ? 'text-[11px] font-semibold tracking-wide text-slate-400 uppercase'
                    : 'text-[11px] font-semibold tracking-wide text-emerald-700 uppercase'
                }
              >
                <T k={entry.host === null ? 'device.editor.push.empty' : 'device.editor.push.set'} />
              </span>
            }
          >
            {entry.host === null ? (
              <SettingRow label={<T k="device.editor.push.target" />}>
                <StaticControl value={t('device.editor.push.empty.detail')} />
              </SettingRow>
            ) : (
              <>
                <SettingRow label={<T k="device.editor.push.target" />}>
                  <ControlGrid columns={2}>
                    <ControlCell caption={<T k="device.editor.push.url" />}>
                      <StaticControl mono value={entry.host.url} />
                    </ControlCell>
                    <ControlCell caption={<T k="device.editor.push.format" />}>
                      <StaticControl mono value={entry.host.format ?? '—'} />
                    </ControlCell>
                  </ControlGrid>
                </SettingRow>

                <SettingRow
                  label={<T k="device.editor.push.auth" />}
                  hint={<T k="device.editor.push.auth.hint" />}
                >
                  <ControlGrid columns={3}>
                    <ControlCell caption={<T k="device.editor.push.auth.method" />}>
                      <StaticControl
                        mono
                        tone={entry.host.authMethod === 'none' ? 'danger' : 'success'}
                        value={entry.host.authMethod}
                      />
                    </ControlCell>
                    <ControlCell caption={<T k="device.editor.push.auth.user" />}>
                      <StaticControl mono value={entry.host.authUser ?? '—'} />
                    </ControlCell>
                    <ControlCell caption={<T k="device.editor.push.heartbeat" />}>
                      <StaticControl
                        mono
                        value={
                          entry.host.heartbeatSeconds === null
                            ? '—'
                            : `${String(entry.host.heartbeatSeconds)}s`
                        }
                      />
                    </ControlCell>
                  </ControlGrid>
                </SettingRow>

                {entry.host.authMethod === 'none' && (
                  <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                    <T k="device.editor.push.noAuth" />
                  </PanelNote>
                )}

                <SettingRow
                  label={<T k="device.editor.push.release" />}
                  hint={<T k="device.editor.push.release.hint" />}
                >
                  <Button
                    variant="ghost"
                    onClick={() => void clear(entry.id)}
                    disabled={busy || !allowed}
                  >
                    <T k="device.editor.push.clear" />
                  </Button>
                </SettingRow>
              </>
            )}
          </SettingsGroup>
        ))}

        <SettingsGroup
          title={<T k="device.editor.push.group.configure" />}
          icon={<Settings2 className="size-3.5" aria-hidden />}
          subtitle={<T k="device.editor.push.group.configure.subtitle" />}
        >
          <SettingRow
            label={<T k="device.editor.push.destination" />}
            hint={<T k="device.editor.push.destination.hint" />}
            required
          >
            <ControlGrid columns={3}>
              <ControlCell caption={<T k="device.editor.push.host" />}>
                <TextControl
                  label={t('device.editor.push.host')}
                  value={host}
                  disabled={!allowed}
                  onChange={(event) => setHost(event.target.value)}
                  placeholder="192.168.1.100"
                />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.push.port" />}>
                <TextControl
                  label={t('device.editor.push.port')}
                  inputMode="numeric"
                  value={port}
                  disabled={!allowed}
                  onChange={(event) => setPort(event.target.value.replace(/\D/g, ''))}
                />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.push.slotCaption" />}>
                <SelectControl
                  label={t('device.editor.push.slotCaption')}
                  value={slot}
                  disabled={!allowed}
                  onChange={(event) => setSlot(event.target.value)}
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                </SelectControl>
              </ControlCell>
            </ControlGrid>
          </SettingRow>

          <SettingRow
            label={<T k="device.editor.push.path" />}
            hint={<T k="device.editor.push.path.hint" />}
          >
            <TextControl
              label={t('device.editor.push.path')}
              value={path}
              disabled={!allowed}
              onChange={(event) => setPath(event.target.value)}
            />
          </SettingRow>
        </SettingsGroup>
      </SettingsStack>

      <PanelActions hint={<T k="device.editor.push.hint" />}>
        <Button
          onClick={() => void configure()}
          disabled={busy || !allowed || host.trim() === '' || path.trim() === ''}
        >
          <Save className="size-4" aria-hidden />
          <T k="device.editor.push.configure" />
        </Button>
      </PanelActions>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab 7 — Diagnostics
// ---------------------------------------------------------------------------

function DiagnosticsTab({ device }: { device: DeviceRecord }): ReactNode {
  /** A connector collects commands and does not serve reads, so none is attempted. */
  const viaAgent = device.agentId !== null;

  const { t } = useLabels();
  const { can } = useAuth();
  const permitted = can('settings.devices', 'terminal');
  // Reboot is the one terminal write a connector does carry, so this tab keeps its control.
  const allowed = permitted;
  const { data, error, loading, readAt, reload } = useTerminalRead<TerminalDiagnostics>(
    `/api/devices/${String(device.id)}/terminal/diagnostics`,
    { skip: viaAgent },
  );

  const [confirmReboot, setConfirmReboot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  async function reboot(): Promise<void> {
    setBusy(true);
    setWriteError(null);
    setNotice(null);
    try {
      await api.post<{ ok: boolean; connectionDropped: boolean }>(
        `/api/devices/${String(device.id)}/terminal/reboot`,
      );
      // One message either way. Whether the socket dropped is an implementation detail of
      // how the firmware answers, and reporting it would read as a partial failure.
      setNotice(t('device.editor.reboot.sent', { name: device.name }));
      setConfirmReboot(false);
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause.message : t('device.editor.reboot.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <LiveSection
        icon={<Stethoscope className="size-4" aria-hidden />}
        titleKey="device.editor.diag.title"
        subtitleKey="device.editor.diag.subtitle"
        readAt={readAt}
        loading={loading}
        onReload={() => void reload()}
        unavailable={viaAgent}
      />

      <SettingsStack>
        <Feedback error={error ?? writeError} notice={notice} />

        {viaAgent && <ConnectorManagedNote device={device} />}

        <SettingsGroup
          title={<T k="device.editor.diag.group.cursor" />}
          icon={<Activity className="size-3.5" aria-hidden />}
          action={
            <span className="font-mono text-[11px] text-slate-500">
              {/*
                A bare em dash, not `#—`. A protocol with no pull has no cursor at all, and a
                hash in front of nothing reads as a number that failed to load.
              */}
              {data?.cursor.lastSerialNo == null ? '—' : `#${data.cursor.lastSerialNo}`}
            </span>
          }
        >
          <SettingRow
            label={<T k="device.editor.diag.cursor" />}
            hint={<T k="device.editor.diag.cursor.hint" />}
          >
            <ControlGrid columns={4}>
              <ControlCell caption={<T k="device.editor.diag.lastSerial" />}>
                <StaticControl mono value={data?.cursor.lastSerialNo ?? '—'} />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.diag.lastSync" />}>
                <StaticControl
                  mono
                  value={
                    data?.cursor.lastSyncAt == null ? '—' : formatDateTime(data.cursor.lastSyncAt)
                  }
                />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.diag.lastPush" />}>
                <StaticControl
                  mono
                  value={
                    data?.cursor.lastPushAt == null ? '—' : formatDateTime(data.cursor.lastPushAt)
                  }
                />
              </ControlCell>
              <ControlCell caption={<T k="device.editor.diag.recovered" />}>
                <StaticControl
                  mono
                  tone={(data?.cursor.recoveredByPull ?? 0) > 0 ? 'warn' : 'neutral'}
                  value={String(data?.cursor.recoveredByPull ?? 0)}
                />
              </ControlCell>
            </ControlGrid>
          </SettingRow>

          {(data?.cursor.recoveredByPull ?? 0) > 0 && (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T
                k="device.editor.diag.recoveredNote"
                vars={{ count: data?.cursor.recoveredByPull ?? 0 }}
              />
            </PanelNote>
          )}

          {data?.lastError != null && (
            <PanelNote tone="danger" className="mt-2">
              {data.lastError}
            </PanelNote>
          )}
        </SettingsGroup>

        {/*
          The whole AcsCfg object. The health check reads this and keeps one flag out of
          it, so every other field the firmware reports has been invisible — which is the
          state that makes a firmware change impossible to diagnose without a site visit.
        */}
        <SettingsGroup
          title={<T k="device.editor.diag.group.acs" />}
          icon={<Settings2 className="size-3.5" aria-hidden />}
          subtitle={<T k="device.editor.diag.group.acs.subtitle" />}
        >
          <RawDocument value={data?.acsConfig ?? null} emptyLabel={t('device.editor.diag.none')} />
        </SettingsGroup>

        <SettingsGroup
          title={<T k="device.editor.diag.group.capabilities" />}
          icon={<ClipboardList className="size-3.5" aria-hidden />}
          subtitle={<T k="device.editor.diag.group.capabilities.subtitle" />}
        >
          {Object.entries(data?.capabilities ?? {}).map(([name, document]) => (
            <SettingRow key={name} label={<span className="font-mono text-xs">{name}</span>}>
              <RawDocument
                value={document}
                emptyLabel={t('device.editor.diag.unsupported')}
              />
            </SettingRow>
          ))}
          {data !== null && Object.keys(data.capabilities).length === 0 && (
            <Unsupported>
              <T k="device.editor.diag.noCapabilities" />
            </Unsupported>
          )}
        </SettingsGroup>

        {/*
          Last group on the last tab, on purpose. This is the only control in the editor
          that takes the door out of service, so it sits where somebody arrives after
          reading everything else rather than beside a field they came to change.
        */}
        <SettingsGroup
          title={<T k="device.editor.reboot.group" />}
          icon={<Power className="size-3.5" aria-hidden />}
          subtitle={<T k="device.editor.reboot.group.subtitle" />}
          className="border-rose-200"
          action={
            <span className="text-[11px] font-semibold tracking-wide text-rose-700 uppercase">
              <T k="device.editor.reboot.disruptive" />
            </span>
          }
        >
          {!permitted && <ReadOnlyNote actionKey="perm.action.terminalConfig" />}

          <SettingRow
            label={<T k="device.editor.reboot.action" />}
            hint={<T k="device.editor.reboot.action.hint" />}
          >
            <Button
              variant="ghost"
              onClick={() => setConfirmReboot(true)}
              disabled={busy || !allowed}
              className="border-rose-300 text-rose-700 hover:bg-rose-50"
            >
              <Power className="size-4" aria-hidden />
              <T k="device.editor.reboot" />
            </Button>
          </SettingRow>
        </SettingsGroup>
      </SettingsStack>

      {confirmReboot && (
        <Dialog
          title={<T k="device.editor.reboot.confirm.title" vars={{ name: device.name }} />}
          titleText={t('device.editor.reboot.confirm.title', { name: device.name })}
          description={<T k="device.editor.reboot.confirm.description" />}
          onClose={() => setConfirmReboot(false)}
        >
          <div className="space-y-4">
            <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="device.editor.reboot.confirm.consequence" />
            </PanelNote>

            {/*
              The reassuring half, stated as plainly as the warning. The question somebody
              actually has before pressing this is whether attendance is lost, and the
              answer is no — so it belongs here rather than in a comment nobody reads.
            */}
            <PanelNote tone="info">
              <T k="device.editor.reboot.confirm.safe" />
            </PanelNote>

            <DialogFooter
              onClose={() => setConfirmReboot(false)}
              onSubmit={() => void reboot()}
              busy={busy}
              submitLabel={<T k="device.editor.reboot.confirm.submit" />}
            />
          </div>
        </Dialog>
      )}
    </>
  );
}

/**
 * A device document, pretty-printed.
 *
 * Scrollable rather than truncated: the point of showing it is that somebody can read the
 * field a control is missing, and an elided document cannot answer that.
 */
function RawDocument({
  value,
  emptyLabel,
}: {
  value: unknown;
  emptyLabel: string;
}): ReactNode {
  if (value === null || value === undefined) {
    return <StaticControl value={emptyLabel} />;
  }
  return (
    <pre className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-700">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function BackLink(): ReactNode {
  const navigate = useNavigate();
  const { t } = useLabels();
  return (
    <button
      type="button"
      onClick={() => void navigate('/tetapan/peranti')}
      aria-label={t('device.editor.back.aria')}
      className="mt-0.5 rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
    >
      <ArrowLeft className="size-4" aria-hidden />
    </button>
  );
}

/**
 * Registry keys, not words. The same four states are badged on the dashboard and the
 * device list, so the wording is shared rather than written a third time.
 */
const STATUS_LABELS: Record<string, LabelKey> = {
  online: 'device.status.online',
  degraded: 'device.status.degraded',
  offline: 'device.status.offline',
  unknown: 'device.status.unknown',
};

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  online: 'success',
  degraded: 'warning',
  offline: 'danger',
  unknown: 'neutral',
};

/**
 * The authentication modes offered when the firmware publishes no list.
 *
 * Probing V4.38.0 showed `defaultVerifyMode` holds a value but its capability document
 * carries no `opt` attribute for it, so there is nothing to enumerate from. This is the
 * documented set, narrowed to the credentials this terminal family actually has. It is
 * marked as unverified on screen, and a value the unit refuses fails loudly rather than
 * appearing to save — which is the honest way to offer a list that might be wrong.
 */
const DOCUMENTED_VERIFY_MODES = [
  'face',
  'fp',
  'card',
  'pw',
  'faceOrFp',
  'faceOrCard',
  'faceOrPw',
  'cardOrPw',
  'faceOrFpOrCard',
  'faceOrFpOrCardOrPw',
  'faceAndFp',
  'faceAndCard',
  'faceAndPw',
  'cardAndPw',
];

/** Fallbacks used only until the capability read lands, taken from the probed unit. */
const OBSERVED_FINGERPRINT_LEVELS = ['3', '5', '6', '12', '13'];
const OBSERVED_LIVENESS_LEVELS = ['general', 'enhancive', 'professional'];

/**
 * Wording for the authentication modes we have words for.
 *
 * Partial on purpose. A mode absent from this map still renders, using the device's own
 * token — worse to read but truthful. Hiding it would be this screen overriding the
 * hardware about what it supports.
 */
const VERIFY_MODE_LABELS: Record<string, LabelKey | undefined> = {
  face: 'device.editor.verify.face',
  fp: 'device.editor.verify.fp',
  card: 'device.editor.verify.card',
  pw: 'device.editor.verify.pw',
  faceOrFp: 'device.editor.verify.faceOrFp',
  faceOrCard: 'device.editor.verify.faceOrCard',
  faceOrPw: 'device.editor.verify.faceOrPw',
  cardOrPw: 'device.editor.verify.cardOrPw',
  faceOrFpOrCard: 'device.editor.verify.faceOrFpOrCard',
  faceOrFpOrCardOrPw: 'device.editor.verify.faceOrFpOrCardOrPw',
  faceAndFp: 'device.editor.verify.faceAndFp',
  faceAndCard: 'device.editor.verify.faceAndCard',
  faceAndPw: 'device.editor.verify.faceAndPw',
  cardAndPw: 'device.editor.verify.cardAndPw',
};

const VERIFY_MODE_HINTS: Record<string, LabelKey | undefined> = {
  face: 'device.editor.verify.face.hint',
  faceAndPw: 'device.editor.verify.faceAndPw.hint',
  pw: 'device.editor.verify.pw.hint',
  faceOrFpOrCardOrPw: 'device.editor.verify.faceOrFpOrCardOrPw.hint',
};

/** Empty string for an unreported number, so the control shows blank rather than 0. */
function numberToField(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Masking is read-only, so it renders as three states rather than a switch. */
function maskLabel(value: unknown): LabelKey {
  if (value === true) return 'device.editor.door.masking.on';
  if (value === false) return 'device.editor.door.masking.off';
  return 'device.editor.door.masking.unknown';
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

interface DeviceRecord {
  id: number;
  name: string;
  /**
   * Manufacturer and transport, both fixed once the record exists.
   *
   * The server refuses to change either: every raw event and every ID mapping on this row was
   * produced under one protocol's semantics, and `eventKey` is namespaced by it. Repointing
   * the field would reinterpret history rather than change a connection.
   */
  vendor: string;
  protocol: string;
  host: string;
  port: number;
  useHttps: boolean;
  verifyTls: boolean;
  /** Null on a protocol with no stored credential. */
  username: string | null;
  doorNo: number;
  locationId: number | null;
  model: string | null;
  serialNumber: string | null;
  firmware: string | null;
  status: string;
  faceCapacity: number;
  active: boolean;
  enrolled: number;
  /**
   * Which on-site connector reaches this terminal. Null means this server reaches it itself.
   *
   * Carried at the record level rather than read per tab, and that matters here: on a connector
   * terminal the live reads are refused, so a tab that learned this from its own read would learn
   * it from the failure — and render six red error strips to say one structural fact.
   */
  agentId: number | null;
  agent: {
    id: number;
    name: string;
    status: string;
    lastSeenAt: string | null;
    lanHost: string | null;
    lanPort: number | null;
  } | null;
}

interface DeviceHealth {
  deviceId: number;
  status: string;
  warnings: Array<{ key: LabelKey; vars?: Record<string, string | number> }>;
  error?: string;
}

interface TerminalIdentity {
  /**
   * Vendor-neutral names, mirroring `TerminalIdentity` on the server.
   *
   * Every field nullable because a protocol may not report it. These were Hikvision's own
   * spellings — `deviceName`, `firmwareVersion`, `bindFaceUserNumber`, `FDID` — and a screen
   * bound to those is a screen that shows blanks for every other vendor.
   */
  info: {
    name: string | null;
    model: string | null;
    serialNumber: string | null;
    macAddress: string | null;
    firmware: string | null;
  };
  counts: {
    people: number;
    withFace: number | null;
    withFingerprint: number | null;
    withCard: number | null;
  };
  libraries: Array<{ id: string; name: string | null }>;
  capacity: { people: number | null; faces: number | null; fingerprints: number | null } | null;
  record: { serialNumber: string | null; faceCapacity: number; doorNo: number };
}

interface TerminalClock {
  driftSeconds: number;
  deviceTime: string;
  serverTime: string;
  manualClock: boolean;
  /** `ntp`, `manual` or `unknown` — normalised by the driver, not the firmware's spelling. */
  timeMode: string;
  /** The terminal's own zone string, which on Hikvision inverts the sign. */
  timeZone: string | null;
  /** Minutes east of UTC, parsed by the driver so no caller has to know the inversion. */
  utcOffsetMinutes: number | null;
  servers: Array<{
    id: string;
    ipAddress?: string;
    hostName?: string;
    portNo: number;
    synchronizeInterval: number;
  }>;
  orgTimeZone: string;
}

interface AttendanceModeState {
  mode: string;
  attendanceStatusTime: number;
  reqAttendanceStatus: boolean;
}

interface DoorFailure {
  group: string;
  error: string;
}

/**
 * What the driver says its unit can do.
 *
 * Read so the screen can distinguish "this vendor has no such control" from "the unit is not
 * answering". Before this existed both produced a null and rendered amber like a fault, which
 * sent operators looking for hardware problems that did not exist.
 */
interface DriverCapabilities {
  operations: string[];
  writeModel: 'inline' | 'queued';
  reachability: 'serverInitiated' | 'deviceInitiated';
  /** Operations the protocol has but this model or firmware lacks, with the reason. */
  unavailable?: Record<string, string>;
}

interface TerminalDoor {
  /**
   * Hikvision `AcsCfg`, and null on any other protocol.
   *
   * Null means the whole card is omitted rather than rendered with switches that read as off.
   * These fields belong to one vendor — remote verification, and which of a person's details
   * show on screen during a scan — so there is nothing for another driver to report here.
   *
   * `unknown` on each field rather than `boolean | null` because the terminal answers them as
   * real booleans over JSON but the set varies by firmware, and null means "this unit does not
   * have it" — which the controls check before offering a switch.
   */
  acs: {
    remoteCheckDoorEnabled: unknown;
    checkChannelType: unknown;
    remoteCheckTimeout: unknown;
    showPicture: unknown;
    showEmployeeNo: unknown;
    showName: unknown;
    desensitiseEmployeeNo: unknown;
    desensitiseName: unknown;
    voicePrompt: unknown;
  } | null;
  door: {
    doorNo: number;
    name: string | null;
    openSeconds: number | null;
    extendedOpenSeconds: number | null;
    heldOpenAlarmSeconds: number | null;
    sensorRestState: string | null;
    exitButtonRestState: string | null;
    heldOpenAlarmEnabled: boolean | null;
  } | null;
  reader: {
    readerNo: number;
    enabled: boolean | null;
    verifyMode: string | null;
    functions: string[];
    faceThreshold: number | null;
    livenessEnabled: boolean | null;
    livenessLevel: string | null;
    fingerprintLevel: number | null;
  } | null;
  /** Option lists the terminal published, keyed by its own field name. */
  options: Record<string, string[]>;
  doorNo: number;
  capabilities: DriverCapabilities;
}

/**
 * Where a terminal is currently pointed, as the driver reports it.
 *
 * Credentials are dropped inside the driver, so there is no field here that could carry one.
 */
interface PushHost {
  slot: number;
  /** The complete address, assembled by the driver. Empty when the slot is free. */
  url: string;
  authMethod: string;
  authUser: string | null;
  format: string | null;
  heartbeatSeconds: number | null;
}

interface TerminalDiagnostics {
  acsConfig?: Record<string, unknown> | null;
  capabilities: DriverCapabilities;
  protocol: string;
  cursor: {
    /** Null on a protocol with no pull, which is different from a cursor still at zero. */
    lastSerialNo: string | null;
    lastSyncAt: string | null;
    lastPushAt: string | null;
    recoveredByPull: number | null;
  };
  lastError: string | null;
  lastErrorAt: string | null;
}
