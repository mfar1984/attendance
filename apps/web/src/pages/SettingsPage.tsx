import {
  Activity,
  Building2,
  Clock,
  Database,
  ImageIcon,
  Languages,
  Loader2,
  Save,
  Settings2,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { LabelKey } from '@attendance/shared';

import { CONTROL, ChannelHint, SettingRow } from '../components/ChannelForm';
import { Feedback } from '../components/Dialog';
import {
  KeyValue,
  KeyValueList,
  PanelActions,
  PanelBody,
  PanelCard,
  PanelNote,
  PanelSection,
  PanelTabs,
  SettingsGroup,
  SettingsStack,
} from '../components/RecordPanel';
import { Button } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { asText, settingsApi, type SettingsPayload } from '../lib/settings-api';
import { T, useLabels } from '../lib/translation';
import { BackupTab } from '../components/BackupTab';
import { MaintenanceTab } from '../components/MaintenanceTab';
import { TranslationTab } from '../components/TranslationTab';

/**
 * Runtime configuration.
 *
 * The split between this page and the environment file is the whole organising idea:
 * anything here is safe to change while people are clocking in, and anything that would
 * relocate the database or move the organisation's timezone is shown read-only because it
 * is read once at boot.
 *
 * Branding used to be a tab of its own holding a colour and a logo URL. It folded in here:
 * naming the organisation and choosing its logo is one job, and the colour picker was
 * removed rather than reimplemented, because a theme that only half the screens honour is
 * worse than no theme at all.
 */
export function SettingsPage(): ReactNode {
  const { can } = useAuth();
  const { t } = useLabels();
  const [tab, setTab] = useState('general');

  return (
    <PanelCard title={<T k="settings.title" />} subtitle={<T k="settings.subtitle" />}>
      <PanelTabs
        label={t('settings.tabs.aria')}
        active={tab}
        onChange={setTab}
        tabs={[
          ...(can('settings.general', 'view')
            ? [
                {
                  id: 'general',
                  label: <T k="settings.tab.general" />,
                  labelText: t('settings.tab.general'),
                  icon: <Settings2 className="size-4" aria-hidden />,
                },
              ]
            : []),
          ...(can('settings.translation', 'view')
            ? [
                {
                  id: 'translation',
                  // Through `<T>` so the label number can be stamped on it. This is the
                  // first label wired up, and it is deliberately the one on the screen that
                  // manages them: the mechanism is visible from where it is switched on.
                  label: <T k="settings.translation.title" />,
                  labelText: t('settings.translation.title'),
                  icon: <Languages className="size-4" aria-hidden />,
                },
              ]
            : []),
          ...(can('settings.backup', 'view')
            ? [
                {
                  id: 'backup',
                  label: <T k="settings.tab.backup" />,
                  labelText: t('settings.tab.backup'),
                  icon: <Database className="size-4" aria-hidden />,
                },
              ]
            : []),
          ...(can('settings.maintenance', 'view')
            ? [
                {
                  id: 'maintenance',
                  label: <T k="settings.tab.maintenance" />,
                  labelText: t('settings.tab.maintenance'),
                  icon: <Wrench className="size-4" aria-hidden />,
                },
              ]
            : []),
        ]}
      />

      {tab === 'general' && can('settings.general', 'view') && <GeneralTab />}
      {tab === 'translation' && can('settings.translation', 'view') && <TranslationTab />}
      {tab === 'backup' && can('settings.backup', 'view') && <BackupTab />}
      {tab === 'maintenance' && can('settings.maintenance', 'view') && <MaintenanceTab />}
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Shared settings loader
// ---------------------------------------------------------------------------

export interface SettingsAccess {
  data: SettingsPayload | null;
  error: string | null;
  notice: string | null;
  busy: boolean;
  reload: () => Promise<void>;
  save: (values: Record<string, string | number | boolean | null>) => Promise<void>;
}

export function useSettings(): SettingsAccess {
  const { refreshDisplay } = useAuth();
  const { t } = useLabels();
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setData(await settingsApi.load());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('settings.error.load'));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (values: Record<string, string | number | boolean | null>) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await settingsApi.save(values);
        setNotice(t('settings.notice.saved'));
        await reload();
        // The clock format lives on the session, so a save has to refresh it or the
        // change appears not to have worked until the next login.
        await refreshDisplay();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('app.error.save'));
      } finally {
        setBusy(false);
      }
    },
    [reload, refreshDisplay, t],
  );

  return { data, error, notice, busy, reload, save };
}

export function Spinner(): ReactNode {
  const { t } = useLabels();
  return (
    <div className="flex min-h-48 items-center justify-center">
      <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('app.loading')} />
    </div>
  );
}

export const SELECT = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ---------------------------------------------------------------------------
// Umum
// ---------------------------------------------------------------------------

function GeneralTab(): ReactNode {
  const { can } = useAuth();
  const { t } = useLabels();
  const { data, error, notice, busy, reload, save } = useSettings();

  const [name, setName] = useState('');
  const [dateFormat, setDateFormat] = useState('DD/MM/YYYY');
  const [timeFormat, setTimeFormat] = useState('24');
  const [weekStart, setWeekStart] = useState('1');
  const [dedupSeconds, setDedupSeconds] = useState('60');

  useEffect(() => {
    if (!data) return;
    setName(asText(data.values['organisation.name']));
    setDateFormat(asText(data.values['organisation.dateFormat'], 'DD/MM/YYYY'));
    setTimeFormat(asText(data.values['organisation.timeFormat'], '24'));
    setWeekStart(asText(data.values['organisation.weekStart'], '1'));
    setDedupSeconds(asText(data.values['attendance.dedupWindowSeconds'], '60'));
  }, [data]);

  if (!data) return <Spinner />;

  const editable = can('settings.general', 'edit');
  const sample = new Date();

  return (
    <>
      <PanelSection
        icon={<Settings2 className="size-4" aria-hidden />}
        title={<T k="settings.general.title" />}
        subtitle={<T k="settings.general.subtitle" />}
      />

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <SettingsStack>
        <SettingsGroup
          title={<T k="settings.org.group" />}
          icon={<Building2 className="size-3.5" aria-hidden />}
        >
          <SettingRow
            label={<T k="settings.org.name" />}
            hint={<T k="settings.org.name.hint" />}
          >
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('settings.org.name.placeholder')}
              disabled={!editable}
              aria-label={t('settings.org.name')}
              className={cn(CONTROL, 'disabled:bg-slate-50')}
            />
          </SettingRow>

          <SettingRow label={<T k="settings.dedup.label" />} hint={<T k="settings.dedup.hint" />}>
            <div className="flex items-center gap-2">
              <input
                inputMode="numeric"
                value={dedupSeconds}
                onChange={(event) => setDedupSeconds(event.target.value.replace(/\D/g, ''))}
                disabled={!editable}
                aria-label={t('settings.dedup.label')}
                className={cn(CONTROL, 'max-w-24 disabled:bg-slate-50')}
              />
              <span className="text-sm text-slate-500">
                <T k="settings.dedup.unit" />
              </span>
            </div>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="settings.datetime.group" />}
          icon={<Clock className="size-3.5" aria-hidden />}
          subtitle={<T k="settings.datetime.subtitle" />}
          action={
            <span className="font-mono text-[11px] text-slate-400">
              <T
                k="settings.datetime.summary"
                vars={{
                  format: dateFormat,
                  clock: t(
                    timeFormat === '12'
                      ? 'settings.datetime.clock12'
                      : 'settings.datetime.clock24',
                  ),
                }}
              />
            </span>
          }
        >
          <ChannelHint>
            <T k="settings.datetime.note" />
          </ChannelHint>

          <SettingRow label={<T k="settings.dateFormat.label" />}>
            <select
              value={dateFormat}
              onChange={(event) => setDateFormat(event.target.value)}
              disabled={!editable}
              aria-label={t('settings.dateFormat.label')}
              className={cn(SELECT, 'max-w-64 disabled:bg-slate-50')}
            >
              {/*
                The pattern itself is not translated — it is the stored value, and an
                operator picking `YYYY-MM-DD` is picking those letters. The worked example
                beside it is what makes the choice legible.
              */}
              {(
                [
                  ['DD/MM/YYYY', '29/08/2026'],
                  ['YYYY-MM-DD', '2026-08-29'],
                  ['DD MMM YYYY', '29 Ogos 2026'],
                ] as const
              ).map(([pattern, example]) => (
                <option key={pattern} value={pattern}>
                  {t('settings.dateFormat.option', { pattern, sample: example })}
                </option>
              ))}
            </select>
          </SettingRow>

          <SettingRow
            label={<T k="settings.timeFormat.label" />}
            hint={<T k="settings.timeFormat.hint" />}
          >
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-4">
                {(
                  [
                    ['24', 'settings.datetime.clock24', false],
                    ['12', 'settings.datetime.clock12', true],
                  ] as const
                ).map(([value, clockKey, hour12]) => (
                  <label key={value} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="time-format"
                      value={value}
                      checked={timeFormat === value}
                      onChange={() => setTimeFormat(value)}
                      disabled={!editable}
                    />
                    <T
                      k="settings.timeFormat.option"
                      vars={{
                        clock: t(clockKey),
                        sample: sample.toLocaleTimeString('ms-MY', { hour12 }),
                      }}
                    />
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                <T k="settings.timeFormat.note" />
              </p>
            </div>
          </SettingRow>

          <SettingRow label={<T k="settings.weekStart.label" />}>
            <select
              value={weekStart}
              onChange={(event) => setWeekStart(event.target.value)}
              disabled={!editable}
              aria-label={t('settings.weekStart.label')}
              className={cn(SELECT, 'max-w-48 disabled:bg-slate-50')}
            >
              {/* Day names come from the shared weekday map, keyed by `getUTCDay()`. */}
              <option value="1">{t('weekday.1')}</option>
              <option value="0">{t('weekday.0')}</option>
            </select>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="settings.branding.group" />}
          icon={<ImageIcon className="size-3.5" aria-hidden />}
          subtitle={<T k="settings.branding.subtitle" />}
        >
          <div className="my-2 grid gap-3 sm:grid-cols-2">
            <AssetUpload
              slot="logo"
              labelKey="settings.branding.logo"
              hintKey="settings.branding.logo.hint"
              current={data.branding.logo}
              maxBytes={data.environment.maxUploadBytes}
              editable={editable}
              onChanged={reload}
            />
            <AssetUpload
              slot="favicon"
              labelKey="settings.branding.favicon"
              hintKey="settings.branding.favicon.hint"
              current={data.branding.favicon}
              maxBytes={data.environment.maxUploadBytes}
              editable={editable}
              onChanged={reload}
            />
          </div>

          {/*
            The refusal is stated before somebody tries it, because SVG is the obvious
            format for a logo and the reason it is refused is not obvious at all.
          */}
          <PanelNote className="mb-2">
            <T
              k="settings.branding.formats"
              vars={{
                limit: formatBytes(data.environment.maxUploadBytes),
                refusal: (
                  <strong className="font-medium">
                    <T k="settings.branding.formats.refusal" />
                  </strong>
                ),
              }}
            />
          </PanelNote>

          <PanelNote className="mb-2">
            <T k="settings.branding.offline" />
          </PanelNote>
        </SettingsGroup>

        {/*
          Deployment-time values, read-only. Presenting them as editable would imply the
          system can relocate its own database or change its own timezone while people are
          clocking in against it.
        */}
        <SettingsGroup
          title={<T k="settings.env.group" />}
          icon={<Activity className="size-3.5" aria-hidden />}
          subtitle={<T k="settings.env.subtitle" />}
        >
          <div className="my-2 space-y-3">
            <KeyValueList>
              <KeyValue
                label={<T k="settings.env.connectorMode" />}
                value={t(
                  data.environment.connectorMode === 'direct'
                    ? 'settings.env.connectorMode.direct'
                    : 'settings.env.connectorMode.agent',
                )}
              />
              <KeyValue label={<T k="settings.env.timezone" />} value={data.environment.timezone} />
              <KeyValue
                label={<T k="settings.env.driftWarn" />}
                value={t('settings.env.seconds', { count: data.environment.driftWarnSeconds })}
              />
              <KeyValue
                label={<T k="settings.env.syncInterval" />}
                value={t('settings.env.seconds', { count: data.environment.syncIntervalSeconds })}
              />
              <KeyValue
                label={<T k="settings.env.require2fa" />}
                value={t(
                  data.environment.requireAdmin2fa
                    ? 'settings.env.require2fa.on'
                    : 'settings.env.require2fa.off',
                )}
              />
              <KeyValue
                label={<T k="settings.env.ingestPath" />}
                value={data.environment.ingestPath}
              />
            </KeyValueList>

            {!data.environment.requireAdmin2fa && (
              <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                <T
                  k="settings.env.no2fa"
                  vars={{
                    flag: <code className="font-mono">REQUIRE_ADMIN_2FA</code>,
                  }}
                />
              </PanelNote>
            )}
          </div>
        </SettingsGroup>
      </SettingsStack>

      {editable && (
        <PanelActions hint={<T k="settings.general.hint" />}>
          <Button
            onClick={() =>
              void save({
                'organisation.name': name,
                'organisation.dateFormat': dateFormat,
                'organisation.timeFormat': timeFormat,
                'organisation.weekStart': weekStart,
                'attendance.dedupWindowSeconds': Number(dedupSeconds),
              })
            }
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            <T k="settings.save" />
          </Button>
        </PanelActions>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * One upload slot.
 *
 * Saves on selection rather than waiting for the form's save button. A file input holds a
 * handle to something on the operator's disk, not a value in the form, and carrying it
 * through a save that might fail for an unrelated field is how an upload silently does not
 * happen.
 */
function AssetUpload({
  slot,
  labelKey,
  hintKey,
  current,
  maxBytes,
  editable,
  onChanged,
}: {
  slot: 'logo' | 'favicon';
  /** Keys rather than words: the slot name is also the `alt` text and the busy label. */
  labelKey: LabelKey;
  hintKey: LabelKey;
  current: { set: boolean; url: string | null; bytes: number | null };
  maxBytes: number;
  editable: boolean;
  onChanged: () => Promise<void>;
}): ReactNode {
  const { t } = useLabels();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // Checked here as well as on the server, so an operator with a 4 MB photo is told
      // before the browser spends a minute uploading it.
      if (file.size > maxBytes) {
        throw new Error(
          t('settings.upload.tooLarge', {
            size: formatBytes(file.size),
            limit: formatBytes(maxBytes),
          }),
        );
      }
      await settingsApi.uploadBranding(slot, file);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('settings.upload.error'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await settingsApi.removeBranding(slot);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.remove'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-sm font-medium text-slate-700">
        <T k={labelKey} />
      </p>
      <p className="mt-0.5 text-xs text-slate-500">
        <T k={hintKey} />
      </p>

      <div className="mt-2 flex min-h-24 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
        {busy ? (
          <Loader2
            className="size-5 animate-spin text-slate-400"
            aria-label={t('settings.upload.busy')}
          />
        ) : current.set && current.url !== null ? (
          <img
            src={current.url}
            alt={t('settings.upload.currentAlt', { label: t(labelKey) })}
            className="max-h-16 max-w-full object-contain"
          />
        ) : (
          <span className="text-xs text-slate-400">
            <T k="settings.upload.empty" />
          </span>
        )}
      </div>

      {error !== null && <p className="mt-1.5 text-xs text-rose-700">{error}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700',
            editable && !busy ? 'cursor-pointer hover:bg-slate-50' : 'cursor-not-allowed opacity-50',
          )}
        >
          <ImageIcon className="size-3.5" aria-hidden />
          <T k={current.set ? 'settings.upload.replace' : 'settings.upload.choose'} />
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/x-icon,.ico"
            disabled={!editable || busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset so choosing the same file twice still fires a change.
              event.target.value = '';
              if (file) void upload(file);
            }}
            className="hidden"
          />
        </label>

        {current.set && current.bytes !== null && (
          <span className="text-xs text-slate-500">{formatBytes(current.bytes)}</span>
        )}

        {current.set && editable && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className="text-xs font-medium text-rose-700 hover:underline disabled:opacity-50"
          >
            <T k="app.remove" />
          </button>
        )}
      </div>
    </div>
  );
}

