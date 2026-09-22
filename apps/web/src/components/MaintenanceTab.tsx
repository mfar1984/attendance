import {
  Activity,
  CircleCheck,
  CircleX,
  Cpu,
  Database,
  Eraser,
  FileClock,
  HeartPulse,
  Loader2,
  Lock,
  Power,
  RefreshCw,
  Save,
  ScrollText,
  Trash2,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { LabelKey } from '@attendance/shared';

import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { attendanceApi, daysAgoIso, formatDateTime, todayIso } from '../lib/operations-api';
import {
  asText,
  logsApi,
  maintenanceApi,
  retentionApi,
  type ActivityLogRow,
  type RetentionPreview,
  type SystemHealth,
} from '../lib/settings-api';
import { T, useLabels, type LabelVars } from '../lib/translation';
import { SELECT, Spinner, formatBytes, useSettings } from '../pages/SettingsPage';
import { CONTROL, ChannelHint, SettingRow, Switch } from './ChannelForm';
import { Dialog, DialogFooter, Feedback } from './Dialog';
import {
  KeyValue,
  KeyValueList,
  PanelActions,
  PanelBody,
  PanelNote,
  PanelSection,
  SettingsGroup,
  SettingsStack,
} from './RecordPanel';
import { Button, Field } from './ui';

/**
 * Maintenance, logging, cache and health.
 *
 * Everything on this tab either stops the system doing something or removes data, so each
 * control states its consequence next to itself rather than in a tooltip.
 */
export function MaintenanceTab(): ReactNode {
  const { can } = useAuth();
  const { t } = useLabels();
  const { data, error, notice, busy, save } = useSettings();

  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [allowIps, setAllowIps] = useState('');
  const [level, setLevel] = useState('info');
  const [logDays, setLogDays] = useState('90');
  const [rawMonths, setRawMonths] = useState('24');
  const [pictureMonths, setPictureMonths] = useState('6');

  useEffect(() => {
    if (!data) return;
    setEnabled(data.values['maintenance.enabled'] === true);
    setMessage(asText(data.values['maintenance.message']));
    setAllowIps(asText(data.values['maintenance.allowIps']));
    setLevel(asText(data.values['logging.level'], 'info'));
    setLogDays(asText(data.values['logging.retentionDays'], '90'));
    setRawMonths(asText(data.values['retention.rawEventMonths'], '24'));
    setPictureMonths(asText(data.values['retention.pictureMonths'], '6'));
  }, [data]);

  if (!data) return <Spinner />;

  const editable = can('settings.maintenance', 'edit');
  const live = data.values['maintenance.enabled'] === true;

  return (
    <>
      <PanelSection
        icon={<Wrench className="size-4" aria-hidden />}
        title={<T k="settings.tab.maintenance" />}
        subtitle={<T k="maintenance.subtitle" />}
        action={
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
              live ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700',
            )}
          >
            <T k={live ? 'maintenance.state.under' : 'maintenance.state.operating'} />
          </span>
        }
      />

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <SettingsStack>
        <SettingsGroup
          title={<T k="maintenance.mode.group" />}
          icon={<Power className="size-3.5" aria-hidden />}
          subtitle={<T k="maintenance.mode.subtitle" />}
          action={
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
                enabled ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600',
              )}
            >
              <T k={enabled ? 'maintenance.mode.on' : 'maintenance.mode.off'} />
            </span>
          }
        >
          {/*
            The single most important thing on this tab. A scan the terminal cannot deliver
            is not retried in any form this application can rely on — it leaves the device's
            ring buffer and is gone, and the whole system is built on the raw log being
            complete.
          */}
          <ChannelHint>
            <T
              k="maintenance.mode.ingestNote"
              vars={{
                never: (
                  <strong className="font-medium">
                    <T k="maintenance.mode.ingestNote.never" />
                  </strong>
                ),
              }}
            />
          </ChannelHint>

          <SettingRow
            label={<T k="maintenance.mode.enable" />}
            hint={<T k="maintenance.mode.enable.hint" />}
          >
            <Switch
              checked={enabled}
              onChange={setEnabled}
              label={t('maintenance.mode.enable.switch')}
              disabled={!editable}
            />
          </SettingRow>

          <SettingRow
            label={<T k="maintenance.mode.message" />}
            hint={<T k="maintenance.mode.message.hint" />}
          >
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={2}
              disabled={!editable}
              placeholder={t('maintenance.mode.message.placeholder')}
              aria-label={t('maintenance.mode.message')}
              className={cn(CONTROL, 'disabled:bg-slate-50')}
            />
          </SettingRow>

          <SettingRow
            label={<T k="maintenance.mode.allowIps" />}
            hint={<T k="maintenance.mode.allowIps.hint" />}
          >
            <div className="space-y-1.5">
              <input
                value={allowIps}
                onChange={(event) => setAllowIps(event.target.value)}
                disabled={!editable}
                placeholder="127.0.0.1, 192.168.1.*"
                aria-label={t('maintenance.mode.allowIps')}
                className={cn(CONTROL, 'font-mono disabled:bg-slate-50')}
              />
              <p className="text-xs text-slate-500">
                <T
                  k="maintenance.mode.allowIps.loopback"
                  vars={{
                    ipv4: <code className="font-mono text-[11px]">127.0.0.1</code>,
                    ipv6: <code className="font-mono text-[11px]">::1</code>,
                  }}
                />
              </p>
            </div>
          </SettingRow>

          {/*
            The guard that stops this being a one-way switch. The server refuses the save
            outright, but saying so here means the operator does not have to discover it
            from a 409.
          */}
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />} className="my-2">
            <T k="maintenance.mode.lockoutWarning" />
          </PanelNote>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="maintenance.log.group" />}
          icon={<FileClock className="size-3.5" aria-hidden />}
          subtitle={<T k="maintenance.log.subtitle" />}
          action={
            <span className="text-[11px] text-slate-400 uppercase">
              <T k="maintenance.log.summary" vars={{ level, days: logDays }} />
            </span>
          }
        >
          <SettingRow
            label={<T k="maintenance.log.level" />}
            hint={<T k="maintenance.log.level.hint" />}
          >
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              disabled={!editable}
              aria-label={t('maintenance.log.level.aria')}
              className={cn(SELECT, 'max-w-56 disabled:bg-slate-50')}
            >
              <option value="debug">{t('maintenance.log.level.debug')}</option>
              <option value="info">{t('maintenance.log.level.info')}</option>
              <option value="warn">{t('maintenance.log.level.warn')}</option>
            </select>
          </SettingRow>

          {/*
            Why the list stops at WARN. A verbosity control that can discard the entry
            recording a purge is not a verbosity control.
          */}
          <PanelNote className="my-2">
            <T
              k="maintenance.log.floorNote"
              vars={{
                warn: <strong className="font-medium">{t('logLevel.warn')}</strong>,
                error: <strong className="font-medium">{t('logLevel.error')}</strong>,
              }}
            />
          </PanelNote>

          <SettingRow
            label={<T k="maintenance.log.retention" />}
            hint={<T k="maintenance.log.retention.hint" />}
          >
            <div className="flex items-center gap-2">
              <input
                inputMode="numeric"
                value={logDays}
                onChange={(event) => setLogDays(event.target.value.replace(/\D/g, ''))}
                disabled={!editable}
                aria-label={t('maintenance.log.retention')}
                className={cn(CONTROL, 'max-w-24 disabled:bg-slate-50')}
              />
              <span className="text-sm text-slate-500">
                <T k="maintenance.log.retention.unit" />
              </span>
              {Number(logDays) < 7 && (
                <span className="text-xs text-rose-700">
                  <T k="maintenance.log.retention.minimum" />
                </span>
              )}
            </div>
          </SettingRow>

          <PanelNote className="my-2">
            <T
              k="maintenance.log.auditNote"
              vars={{
                emphasis: (
                  <strong className="font-medium">
                    <T k="maintenance.log.auditNote.emphasis" />
                  </strong>
                ),
              }}
            />
          </PanelNote>
        </SettingsGroup>
      </SettingsStack>

      {editable && (
        <PanelActions hint={enabled ? <T k="maintenance.save.hint" /> : undefined}>
          <Button
            onClick={() =>
              void save({
                'maintenance.enabled': enabled,
                'maintenance.message': message.trim(),
                'maintenance.allowIps': allowIps.trim(),
                'logging.level': level,
                'logging.retentionDays': Number(logDays),
              })
            }
            disabled={busy || Number(logDays) < 7}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            <T k="maintenance.save" />
          </Button>
        </PanelActions>
      )}

      <CacheSection />

      <RecomputeSection />

      <RetentionSection
        rawMonths={rawMonths}
        pictureMonths={pictureMonths}
        onRawMonths={setRawMonths}
        onPictureMonths={setPictureMonths}
        onSave={save}
        busy={busy}
      />

      <RecentLogs />

      <HealthSection />
    </>
  );
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

function CacheSection(): ReactNode {
  const { can } = useAuth();
  const { t } = useLabels();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function clear(scope: 'config' | 'devices' | 'all'): Promise<void> {
    setBusy(scope);
    setError(null);
    setNotice(null);
    try {
      const outcome = await maintenanceApi.clearCache(scope);
      setNotice(
        [
          t('maintenance.cache.result', {
            items: outcome.cleared.map((key) => t(key)).join(', '),
          }),
          t(outcome.noteKey),
        ].join(' '),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('maintenance.cache.error'));
    } finally {
      setBusy(null);
    }
  }

  if (!can('settings.maintenance', 'clearCache')) return null;

  const rows: Array<{
    scope: 'config' | 'devices' | 'all';
    titleKey: LabelKey;
    detailKey: LabelKey;
  }> = [
    {
      scope: 'config',
      titleKey: 'maintenance.cache.config',
      detailKey: 'maintenance.cache.config.detail',
    },
    {
      scope: 'devices',
      titleKey: 'maintenance.cache.devices',
      detailKey: 'maintenance.cache.devices.detail',
    },
    {
      scope: 'all',
      titleKey: 'maintenance.cache.all',
      detailKey: 'maintenance.cache.all.detail',
    },
  ];

  return (
    <>
      <PanelSection
        icon={<Eraser className="size-4" aria-hidden />}
        title={<T k="maintenance.cache.title" />}
        subtitle={<T k="maintenance.cache.subtitle" />}
      />

      <PanelBody className="space-y-3">
        <Feedback error={error} notice={notice} />

        {/*
          Said plainly. The alternative is an operator clicking "clear cache" for twenty
          minutes while the real fault is elsewhere.
        */}
        <PanelNote>
          <T k="maintenance.cache.leftAlone" />
        </PanelNote>

        <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
          {rows.map((row) => (
            <div
              key={row.scope}
              className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-700">
                  <T k={row.titleKey} />
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  <T k={row.detailKey} />
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={() => void clear(row.scope)}
                disabled={busy !== null}
              >
                {busy === row.scope ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="size-4" aria-hidden />
                )}
                <T k="maintenance.cache.action" />
              </Button>
            </div>
          ))}
        </div>
      </PanelBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Recompute
// ---------------------------------------------------------------------------

function RecomputeSection(): ReactNode {
  const { can } = useAuth();
  const { t } = useLabels();
  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function recompute(): Promise<void> {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const outcome = await attendanceApi.recompute(from, to);
      setResult(
        t('maintenance.recompute.result', {
          records: outcome.recordsWritten,
          staff: outcome.staffProcessed,
          exceptions: outcome.exceptionsRaised,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('maintenance.recompute.error'));
    } finally {
      setRunning(false);
    }
  }

  if (!can('settings.maintenance', 'recompute')) return null;

  return (
    <>
      <PanelSection
        icon={<RefreshCw className="size-4" aria-hidden />}
        title={<T k="maintenance.recompute.title" />}
        subtitle={<T k="maintenance.recompute.subtitle" />}
      />

      <PanelBody className="space-y-4">
        <Feedback error={error} notice={result} />

        <PanelNote icon={<RefreshCw className="size-3.5" aria-hidden />}>
          <T k="maintenance.recompute.note" />
        </PanelNote>

        <div className="flex flex-wrap items-end gap-3">
          <Field
            label={<T k="filter.from" />}
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <Field
            label={<T k="filter.to" />}
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
          <Button onClick={() => void recompute()} disabled={running}>
            <RefreshCw className={running ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
            <T k="maintenance.recompute.action" />
          </Button>
        </div>

        <PanelNote>
          <T k="maintenance.recompute.futureNote" />
        </PanelNote>
      </PanelBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * Retention policy and the purge it drives.
 *
 * The figures are shown before the switch, not after. "Delete anything older than 24
 * months" is an abstraction until you can see it means 180,000 rows and that the oldest
 * record you hold is from last year.
 */
function RetentionSection({
  rawMonths,
  pictureMonths,
  onRawMonths,
  onPictureMonths,
  onSave,
  busy,
}: {
  rawMonths: string;
  pictureMonths: string;
  onRawMonths: (value: string) => void;
  onPictureMonths: (value: string) => void;
  onSave: (values: Record<string, string | number | boolean | null>) => Promise<void>;
  busy: boolean;
}): ReactNode {
  const { can } = useAuth();
  const { t } = useLabels();
  const [preview, setPreview] = useState<RetentionPreview | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [hour, setHour] = useState('3');
  const [running, setRunning] = useState(false);
  const [trimming, setTrimming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await retentionApi.preview();
      setPreview(data);
      setEnabled(data.policy.enabled);
      setHour(String(data.policy.purgeHour));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('maintenance.retention.error.load'));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function save(): Promise<void> {
    setError(null);
    setResult(null);
    try {
      await onSave({
        'retention.rawEventMonths': Number(rawMonths),
        'retention.pictureMonths': Number(pictureMonths),
        'retention.autoPurgeEnabled': enabled,
        'retention.purgeHour': Number(hour),
      });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
    }
  }

  async function run(): Promise<void> {
    setConfirming(false);
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const outcome = await retentionApi.run();
      // The "ran out of time" clause is a sentence of its own, so it can be absent.
      setResult(
        [
          t('maintenance.retention.purge.result', {
            scans: outcome.rawEventsDeleted.toLocaleString('ms-MY'),
            pictures: outcome.picturesCleared.toLocaleString('ms-MY'),
            links: outcome.exceptionLinksCleared.toLocaleString('ms-MY'),
            seconds: (outcome.durationMs / 1000).toFixed(1),
          }),
          outcome.noteKey === undefined ? null : t(outcome.noteKey),
        ]
          .filter((part): part is string => part !== null)
          .join(' '),
      );
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('maintenance.retention.error.purge'));
    } finally {
      setRunning(false);
    }
  }

  async function trimLogs(): Promise<void> {
    setTrimming(true);
    setError(null);
    setResult(null);
    try {
      const outcome = await maintenanceApi.trimLogs();
      setResult(
        [
          t('maintenance.retention.trim.result', {
            count: outcome.deleted.toLocaleString('ms-MY'),
            cutoff: formatDateTime(outcome.cutoff),
          }),
          t(outcome.noteKey),
        ].join(' '),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('maintenance.retention.error.trim'));
    } finally {
      setTrimming(false);
    }
  }

  if (!preview) {
    return (
      <>
        <PanelSection title={<T k="maintenance.retention.title" />} />
        <Spinner />
      </>
    );
  }

  const belowFloor = Number(rawMonths) < preview.minimumRawEventMonths;
  const number = new Intl.NumberFormat('ms-MY');
  const due = preview.rawEventsDue > 0 || preview.picturesDue > 0;
  const editable = can('settings.maintenance', 'edit');

  return (
    <>
      <PanelSection
        icon={<Database className="size-4" aria-hidden />}
        title={<T k="maintenance.retention.title" />}
        subtitle={<T k="maintenance.retention.subtitle" />}
        action={
          due && can('settings.maintenance', 'purge') ? (
            <Button
              variant="ghost"
              onClick={() => setConfirming(true)}
              disabled={running}
              className="border-rose-300 text-rose-700 hover:bg-rose-50"
            >
              <Trash2 className={running ? 'size-4 animate-pulse' : 'size-4'} aria-hidden />
              <T
                k={
                  running
                    ? 'maintenance.retention.purge.busy'
                    : 'maintenance.retention.purge'
                }
              />
            </Button>
          ) : undefined
        }
      />

      <PanelBody className="pb-0">
        <Feedback error={error} notice={result} />
      </PanelBody>

      <SettingsStack>
        <SettingsGroup
          title={<T k="maintenance.retention.policy.group" />}
          icon={<Database className="size-3.5" aria-hidden />}
          action={
            <span className="text-[11px] text-slate-400">
              <T
                k="maintenance.retention.policy.summary"
                vars={{
                  months: rawMonths,
                  schedule: enabled
                    ? t('maintenance.retention.policy.summary.auto', {
                        time: `${hour.padStart(2, '0')}:00`,
                      })
                    : t('maintenance.retention.policy.summary.manual'),
                }}
              />
            </span>
          }
        >
          <SettingRow
            label={<T k="maintenance.retention.raw" />}
            hint={<T k="maintenance.retention.raw.hint" />}
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <input
                  inputMode="numeric"
                  value={rawMonths}
                  onChange={(event) => onRawMonths(event.target.value.replace(/\D/g, ''))}
                  disabled={!editable}
                  aria-label={t('maintenance.retention.raw')}
                  className={cn(CONTROL, 'max-w-24 disabled:bg-slate-50')}
                />
                <span className="text-sm text-slate-500">
                  <T k="maintenance.retention.months" />
                </span>
              </div>
              {belowFloor && (
                <p className="text-xs text-rose-700">
                  <T
                    k="maintenance.retention.raw.floor"
                    vars={{ months: preview.minimumRawEventMonths }}
                  />
                </p>
              )}
            </div>
          </SettingRow>

          <SettingRow
            label={<T k="maintenance.retention.pictures" />}
            hint={<T k="maintenance.retention.pictures.hint" />}
          >
            <div className="flex items-center gap-2">
              <input
                inputMode="numeric"
                value={pictureMonths}
                onChange={(event) => onPictureMonths(event.target.value.replace(/\D/g, ''))}
                disabled={!editable}
                aria-label={t('maintenance.retention.pictures')}
                className={cn(CONTROL, 'max-w-24 disabled:bg-slate-50')}
              />
              <span className="text-sm text-slate-500">
                <T k="maintenance.retention.months" />
              </span>
            </div>
          </SettingRow>

          {/*
            Opt-in, and stated as such. A system that begins deleting payroll evidence
            because a default value said twenty-four months is a system nobody should trust
            with the evidence.
          */}
          <SettingRow
            label={<T k="maintenance.retention.auto" />}
            hint={<T k="maintenance.retention.auto.hint" />}
          >
            <Switch
              checked={enabled}
              onChange={setEnabled}
              label={t('maintenance.retention.auto.switch')}
              disabled={!editable}
            />
          </SettingRow>

          {enabled && (
            <SettingRow
              label={<T k="maintenance.retention.hour" />}
              hint={<T k="maintenance.retention.hour.hint" />}
            >
              <select
                value={hour}
                onChange={(event) => setHour(event.target.value)}
                disabled={!editable}
                aria-label={t('maintenance.retention.hour.aria')}
                className={cn(SELECT, 'max-w-32 disabled:bg-slate-50')}
              >
                {Array.from({ length: 24 }, (_, index) => (
                  <option key={index} value={String(index)}>
                    {String(index).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </SettingRow>
          )}

          {editable && (
            <div className="my-2">
              <Button variant="ghost" onClick={() => void save()} disabled={busy || belowFloor}>
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="size-4" aria-hidden />
                )}
                <T k="maintenance.retention.policy.save" />
              </Button>
            </div>
          )}
        </SettingsGroup>

        <SettingsGroup
          title={<T k="maintenance.retention.preview.group" />}
          icon={<TriangleAlert className="size-3.5" aria-hidden />}
          subtitle={<T k="maintenance.retention.preview.subtitle" />}
        >
          <div className="my-2 space-y-3">
            <KeyValueList>
              <KeyValue
                label={<T k="maintenance.retention.preview.total" />}
                value={number.format(preview.totalRawEvents)}
                mono={false}
              />
              <KeyValue
                label={<T k="maintenance.retention.preview.oldest" />}
                value={preview.oldestEventAt === null ? '—' : formatDateTime(preview.oldestEventAt)}
              />
              <KeyValue
                label={<T k="maintenance.retention.preview.cutoff" />}
                value={formatDateTime(preview.rawCutoff)}
              />
              <KeyValue
                label={<T k="maintenance.retention.preview.lastPurge" />}
                value={
                  preview.policy.lastPurgeAt === null
                    ? t('maintenance.retention.preview.never')
                    : formatDateTime(preview.policy.lastPurgeAt)
                }
              />
            </KeyValueList>

            {due ? (
              <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                {/*
                  The punch clause carries its own leading space and full stop, so the
                  sentence closes cleanly when nothing is affected.
                */}
                <T
                  k="maintenance.retention.due"
                  vars={{
                    scans: (
                      <strong className="font-medium">
                        <T
                          k="maintenance.retention.due.scans"
                          vars={{ count: number.format(preview.rawEventsDue) }}
                        />
                      </strong>
                    ),
                    pictures: number.format(preview.picturesDue),
                    punches:
                      preview.punchesAffected > 0
                        ? t('maintenance.retention.due.punches', {
                            count: number.format(preview.punchesAffected),
                          })
                        : '',
                  }}
                />
              </PanelNote>
            ) : (
              <PanelNote tone="success">
                <T k="maintenance.retention.nothingDue" />
              </PanelNote>
            )}

            <PanelNote>
              <T k="maintenance.retention.auditNote" />
            </PanelNote>

            {can('settings.maintenance', 'purge') && (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="ghost" onClick={() => void trimLogs()} disabled={trimming}>
                  {trimming ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <ScrollText className="size-4" aria-hidden />
                  )}
                  <T k="maintenance.retention.trim" />
                </Button>
                <p className="text-xs text-slate-500">
                  <T k="maintenance.retention.trim.hint" />
                </p>
              </div>
            )}
          </div>
        </SettingsGroup>
      </SettingsStack>

      {confirming && (
        <Dialog
          title={<T k="maintenance.retention.confirm.title" />}
          titleText={t('maintenance.retention.confirm.title')}
          onClose={() => setConfirming(false)}
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <T
                k="maintenance.retention.confirm.body"
                vars={{
                  count: number.format(preview.rawEventsDue),
                  cutoff: <strong>{formatDateTime(preview.rawCutoff)}</strong>,
                }}
              />
            </p>
            <PanelNote tone="danger">
              <T k="maintenance.retention.confirm.note" />
            </PanelNote>
            <DialogFooter
              onClose={() => setConfirming(false)}
              onSubmit={() => void run()}
              submitLabel={<T k="maintenance.retention.confirm.submit" />}
            />
          </div>
        </Dialog>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Recent logs
// ---------------------------------------------------------------------------

const LEVEL_TONES: Record<string, string> = {
  info: 'bg-sky-500/20 text-sky-300',
  warn: 'bg-amber-500/20 text-amber-300',
  error: 'bg-rose-500/20 text-rose-300',
  debug: 'bg-slate-500/20 text-slate-300',
};

/** The last few entries, so this tab can be judged without leaving it. */
function RecentLogs(): ReactNode {
  const { can } = useAuth();
  const [rows, setRows] = useState<ActivityLogRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const page = await logsApi.activity({ page: 1, pageSize: 25 });
      setRows(page.rows);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!can('settings.logs.activity', 'view')) return null;

  return (
    <>
      <PanelSection
        icon={<ScrollText className="size-4" aria-hidden />}
        title={<T k="maintenance.recentLogs.title" />}
        subtitle={<T k="maintenance.recentLogs.subtitle" />}
        action={
          <Button variant="ghost" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
            <T k="app.refresh" />
          </Button>
        }
      />

      <PanelBody>
        <div className="max-h-72 overflow-y-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-relaxed">
          {rows === null ? (
            <p className="text-slate-500">
              <T k="app.loading" />
            </p>
          ) : rows.length === 0 ? (
            <p className="text-slate-500">
              <T k="maintenance.recentLogs.empty" />
            </p>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="flex flex-wrap items-baseline gap-2 py-0.5">
                <span className="text-slate-500">{formatDateTime(row.createdAt)}</span>
                <span
                  className={cn(
                    'rounded px-1 text-[10px] font-semibold uppercase',
                    LEVEL_TONES[row.level] ?? LEVEL_TONES['info'],
                  )}
                >
                  {row.level}
                </span>
                <span className="text-slate-400">{row.actorLabel}</span>
                <span className="text-slate-200">{row.action}</span>
                {row.detail !== null && (
                  <span className="min-w-0 break-all text-slate-400">{row.detail}</span>
                )}
              </div>
            ))
          )}
        </div>
      </PanelBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/**
 * What the system believes about itself.
 *
 * Each line is measured rather than read from configuration: the database with a query,
 * the storage directory with a real write, the backup from the file's own timestamp. A
 * health panel that reports what the settings say stays green through an outage.
 */
function HealthSection(): ReactNode {
  const { t } = useLabels();
  const [data, setData] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await maintenanceApi.health());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('maintenance.health.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <>
      <PanelSection
        icon={<HeartPulse className="size-4" aria-hidden />}
        title={<T k="maintenance.health.title" />}
        subtitle={<T k="maintenance.health.subtitle" />}
        action={
          <Button variant="ghost" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
            <T k="app.refresh" />
          </Button>
        }
      />

      <PanelBody className="space-y-3">
        <Feedback error={error} />

        {data === null ? (
          <Spinner />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <HealthTile
              icon={<Database className="size-3.5" aria-hidden />}
              label={<T k="maintenance.health.database" />}
              value={
                data.database.ok
                  ? t('maintenance.health.database.ok', { latency: data.database.latencyMs ?? 0 })
                  : t('maintenance.health.database.fail')
              }
              detail={data.database.ok ? undefined : data.database.detail}
              ok={data.database.ok}
            />
            <HealthTile
              icon={<Activity className="size-3.5" aria-hidden />}
              label={<T k="maintenance.health.storage" />}
              value={t(
                data.storage.ok
                  ? 'maintenance.health.storage.ok'
                  : 'maintenance.health.storage.fail',
              )}
              detail={data.storage.ok ? undefined : data.storage.detail}
              ok={data.storage.ok}
            />
            <HealthTile
              icon={<Lock className="size-3.5" aria-hidden />}
              label={<T k="maintenance.health.mode" />}
              value={t(
                data.maintenanceMode.active ? 'maintenance.mode.on' : 'maintenance.mode.off',
              )}
              ok={!data.maintenanceMode.active}
            />
            <HealthTile
              icon={<Database className="size-3.5" aria-hidden />}
              label={<T k="maintenance.health.backup" />}
              value={
                data.backup.lastAt === null
                  ? t('maintenance.retention.preview.never')
                  : t('maintenance.health.backup.value', {
                      count: data.backup.count,
                      days: data.backup.staleDays ?? 0,
                    })
              }
              detail={t(
                data.backup.scheduled
                  ? 'maintenance.health.backup.scheduled'
                  : 'maintenance.health.backup.unscheduled',
              )}
              // A schedule switched on is not evidence it ran, so the age is what decides.
              ok={data.backup.lastAt !== null && (data.backup.staleDays ?? 99) <= 7}
            />
            <HealthTile
              icon={<Activity className="size-3.5" aria-hidden />}
              label={<T k="maintenance.health.email" />}
              value={t('maintenance.health.email.value', { count: data.email.activeProfiles })}
              ok={data.email.activeProfiles > 0}
            />
            <HealthTile
              icon={<ScrollText className="size-3.5" aria-hidden />}
              label={<T k="maintenance.health.logs" />}
              value={t('maintenance.health.logs.value', {
                count: data.logs.activityRows.toLocaleString('ms-MY'),
              })}
              detail={t('maintenance.health.logs.detail', {
                audit: data.logs.auditRows.toLocaleString('ms-MY'),
                days: data.logs.retentionDays,
              })}
              ok
            />
            <HealthTile
              icon={<Cpu className="size-3.5" aria-hidden />}
              label={<T k="maintenance.health.memory" />}
              value={t('maintenance.health.memory.value', {
                used: formatBytes(data.process.heapUsedBytes),
                total: formatBytes(data.process.heapTotalBytes),
              })}
              detail={t('maintenance.health.memory.detail', {
                rss: formatBytes(data.process.rssBytes),
                version: data.process.nodeVersion,
              })}
              ok
            />
            <HealthTile
              icon={<Activity className="size-3.5" aria-hidden />}
              label={<T k="maintenance.health.uptime" />}
              value={formatUptime(data.process.uptimeSeconds, t)}
              ok
            />
            {data.branding.orphanedFiles > 0 && (
              <HealthTile
                icon={<TriangleAlert className="size-3.5" aria-hidden />}
                label={<T k="maintenance.health.orphans" />}
                value={String(data.branding.orphanedFiles)}
                detail={t('maintenance.health.orphans.detail')}
                ok={false}
              />
            )}
          </div>
        )}
      </PanelBody>
    </>
  );
}

function HealthTile({
  icon,
  label,
  value,
  detail,
  ok,
}: {
  icon: ReactNode;
  /** A node so the label can carry its registry number when those are switched on. */
  label: ReactNode;
  value: string;
  detail?: string;
  ok: boolean;
}): ReactNode {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2',
        ok ? 'border-slate-200 bg-slate-50' : 'border-amber-300 bg-amber-50',
      )}
    >
      <p
        className={cn(
          'flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase',
          ok ? 'text-slate-500' : 'text-amber-800',
        )}
      >
        {icon}
        {label}
      </p>
      <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-slate-800">
        {ok ? (
          <CircleCheck className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
        ) : (
          <CircleX className="size-3.5 shrink-0 text-amber-600" aria-hidden />
        )}
        {value}
      </p>
      {detail !== undefined && <p className="mt-0.5 text-[11px] text-slate-500">{detail}</p>}
    </div>
  );
}

/**
 * Uptime in the largest two units that apply.
 *
 * Takes `t` rather than calling the hook: it is a plain function, and the unit letters are
 * words in their own right — a language that abbreviates days differently needs them
 * through the registry like anything else.
 */
function formatUptime(seconds: number, t: (key: LabelKey, vars?: LabelVars) => string): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return t('maintenance.uptime.days', { days, hours });
  if (hours > 0) return t('maintenance.uptime.hours', { hours, minutes });
  return t('maintenance.uptime.minutes', { minutes });
}
