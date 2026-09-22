import {
  CalendarClock,
  Database,
  Download,
  HardDriveDownload,
  Loader2,
  Save,
  Terminal,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { formatDateTime } from '../lib/operations-api';
import { backupApi, type BackupPayload } from '../lib/settings-api';
import { T, useLabels } from '../lib/translation';
import { SELECT, Spinner, formatBytes, useSettings } from '../pages/SettingsPage';
import { CONTROL, ChannelHint, SettingRow, Switch } from './ChannelForm';
import { Dialog, Feedback } from './Dialog';
import {
  KeyValue,
  KeyValueList,
  PanelBody,
  PanelNote,
  PanelSection,
  RecordTable,
  RowAction,
  RowActions,
  SettingsGroup,
  SettingsStack,
} from './RecordPanel';
import { Button } from './ui';

/**
 * Database backup.
 *
 * The terminal is not a fallback copy of anything. Its internal log is capped and
 * overwrites the oldest records once full, so this database is the only place the
 * attendance history exists, and it is what payroll is computed from.
 *
 * What this screen does not have, and why: there is no push to FTP, SFTP or object
 * storage. A dump holds every attendance record and every password hash in the system,
 * and shipping it to a remote host unattended means storing credentials for that host and
 * adding a new way for the 2 a.m. job to fail. Until that is built properly, the honest
 * arrangement is a scheduled local dump plus a download the operator takes off the
 * machine — and this screen says so rather than implying otherwise.
 */
export function BackupTab(): ReactNode {
  const { can } = useAuth();
  const { t } = useLabels();
  // Only for writing the `backup.*` keys; the file list has its own endpoint.
  const { save, busy: savingPolicy } = useSettings();

  const [data, setData] = useState<BackupPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [hour, setHour] = useState('2');
  const [keepCount, setKeepCount] = useState('14');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await backupApi.load();
      setData(payload);
      setEnabled(payload.policy.enabled);
      setHour(String(payload.policy.hour));
      setKeepCount(String(payload.policy.keepCount));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('backup.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function savePolicy(): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await save({
        'backup.autoEnabled': enabled,
        'backup.hour': Number(hour),
        'backup.keepCount': Number(keepCount),
      });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('backup.error.savePolicy'));
    }
  }

  async function run(): Promise<void> {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const outcome = await backupApi.run();
      // Three complete sentences joined, so the pruning one can be absent without
      // leaving a gap in the middle of the other two.
      setNotice(
        [
          t('backup.run.result', {
            name: outcome.name,
            size: formatBytes(outcome.bytes),
            seconds: (outcome.durationMs / 1000).toFixed(1),
          }),
          outcome.pruned.length > 0
            ? t('backup.run.pruned', { count: outcome.pruned.length })
            : null,
          t(outcome.noteKey),
        ]
          .filter((part): part is string => part !== null)
          .join(' '),
      );
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('backup.error.run'));
    } finally {
      setRunning(false);
    }
  }

  async function remove(name: string): Promise<void> {
    setConfirming(null);
    setError(null);
    try {
      await backupApi.remove(name);
      setNotice(t('backup.notice.removed', { name }));
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('backup.error.remove'));
    }
  }

  if (!data) return <Spinner />;

  const editable = can('settings.backup', 'edit');
  const newest = data.files[0];
  const staleDays =
    newest === undefined
      ? null
      : Math.floor((Date.now() - new Date(newest.createdAt).getTime()) / 86_400_000);

  return (
    <>
      <PanelSection
        icon={<Database className="size-4" aria-hidden />}
        title={<T k="settings.tab.backup" />}
        subtitle={<T k="backup.subtitle" />}
        action={
          can('settings.backup', 'create') ? (
            <Button onClick={() => void run()} disabled={running || !data.toolAvailable}>
              {running ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <HardDriveDownload className="size-4" aria-hidden />
              )}
              <T k={running ? 'backup.run.busy' : 'backup.run.action'} />
            </Button>
          ) : undefined
        }
      />

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <SettingsStack>
        {!data.toolAvailable && (
          <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T
              k="backup.tool.missing"
              vars={{ tool: <code className="font-mono">mysqldump</code> }}
            />
          </PanelNote>
        )}

        {data.files.length === 0 ? (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="backup.empty.warning" />
          </PanelNote>
        ) : staleDays !== null && staleDays > 7 ? (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="backup.stale.warning" vars={{ days: staleDays }} />
          </PanelNote>
        ) : null}

        <SettingsGroup
          title={<T k="backup.auto.group" />}
          icon={<CalendarClock className="size-3.5" aria-hidden />}
          subtitle={<T k="backup.auto.subtitle" />}
          action={
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
                enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600',
              )}
            >
              {enabled ? (
                <T k="backup.auto.summary.on" vars={{ time: `${hour.padStart(2, '0')}:00` }} />
              ) : (
                <T k="backup.auto.summary.off" />
              )}
            </span>
          }
        >
          <ChannelHint>
            <T k="backup.auto.note" />
          </ChannelHint>

          <SettingRow
            label={<T k="backup.schedule.label" />}
            hint={<T k="backup.schedule.hint" />}
          >
            <Switch
              checked={enabled}
              onChange={setEnabled}
              label={t('backup.schedule.switch')}
              disabled={!editable}
            />
          </SettingRow>

          <SettingRow label={<T k="backup.hour.label" />} hint={<T k="backup.hour.hint" />}>
            <select
              value={hour}
              onChange={(event) => setHour(event.target.value)}
              disabled={!enabled || !editable}
              aria-label={t('backup.hour.aria')}
              className={cn(SELECT, 'max-w-32 disabled:bg-slate-50 disabled:text-slate-400')}
            >
              {Array.from({ length: 24 }, (_, index) => (
                <option key={index} value={String(index)}>
                  {String(index).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </SettingRow>

          <SettingRow label={<T k="backup.keep.label" />} hint={<T k="backup.keep.hint" />}>
            <div className="flex items-center gap-2">
              <input
                inputMode="numeric"
                value={keepCount}
                onChange={(event) => setKeepCount(event.target.value.replace(/\D/g, ''))}
                disabled={!editable}
                aria-label={t('backup.keep.aria')}
                className={cn(CONTROL, 'max-w-24 disabled:bg-slate-50')}
              />
              <span className="text-sm text-slate-500">
                <T k="backup.keep.unit" />
              </span>
              {Number(keepCount) < 2 && (
                <span className="text-xs text-rose-700">
                  <T k="backup.keep.minimum" />
                </span>
              )}
            </div>
          </SettingRow>

          {editable && (
            <div className="my-2">
              <Button
                variant="ghost"
                onClick={() => void savePolicy()}
                disabled={savingPolicy || Number(keepCount) < 2}
              >
                {savingPolicy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="size-4" aria-hidden />
                )}
                <T k="backup.policy.save" />
              </Button>
            </div>
          )}
        </SettingsGroup>

        <SettingsGroup
          title={<T k="backup.destination.group" />}
          icon={<Database className="size-3.5" aria-hidden />}
          action={
            <span className="text-[11px] text-slate-400">
              <T k="backup.destination.summary" />
            </span>
          }
        >
          <div className="my-2 space-y-3">
            <KeyValueList>
              <KeyValue label={<T k="backup.destination.directory" />} value={data.directory} />
              <KeyValue
                label={<T k="backup.destination.fileCount" />}
                value={String(data.files.length)}
                mono={false}
              />
              <KeyValue
                label={<T k="backup.destination.spaceUsed" />}
                value={formatBytes(data.totalBytes)}
                mono={false}
              />
              <KeyValue
                label={<T k="backup.destination.last" />}
                value={
                  newest === undefined
                    ? t('backup.destination.never')
                    : formatDateTime(newest.createdAt)
                }
              />
            </KeyValueList>

            {/*
              Stated rather than implied by an empty tab. An operator who expects a nightly
              copy to be leaving the building should find that out here, not after the disk
              fails.
            */}
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T
                k="backup.destination.warning"
                vars={{
                  sameDisk: (
                    <strong className="font-medium">
                      <T k="backup.destination.warning.sameDisk" />
                    </strong>
                  ),
                }}
              />
            </PanelNote>
          </div>
        </SettingsGroup>
      </SettingsStack>

      <PanelSection
        title={<T k="backup.files.title" />}
        subtitle={<T k="backup.files.subtitle" />}
      />

      <RecordTable
        loading={loading}
        rowCount={data.files.length}
        empty={<T k="backup.files.empty" />}
        columns={[
          { header: <T k="backup.column.file" /> },
          { header: <T k="backup.column.size" />, width: 'w-28' },
          { header: <T k="panel.column.created" />, width: 'w-48' },
          { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
        ]}
      >
        {data.files.map((file, index) => (
          <tr key={file.name} className="border-b border-slate-100 hover:bg-slate-50/70">
            <td className="px-5 py-2.5">
              <span className="flex items-center gap-2">
                <Database className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                <span className="truncate font-mono text-xs text-slate-700">{file.name}</span>
                {index === 0 && (
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 uppercase">
                    <T k="backup.row.newest" />
                  </span>
                )}
              </span>
            </td>
            <td className="px-2 py-2.5 text-xs tabular-nums text-slate-600">
              {formatBytes(file.bytes)}
            </td>
            <td className="px-2 py-2.5 text-xs whitespace-nowrap text-slate-500">
              {formatDateTime(file.createdAt)}
            </td>
            <td className="px-2 py-2.5 pr-4">
              <RowActions>
                {can('settings.backup', 'download') && (
                  // A plain link: the browser handles the download and the filename from
                  // content-disposition, which a fetch would have to redo for a file that
                  // should never sit in a tab's memory.
                  <a
                    href={backupApi.downloadUrl(file.name)}
                    title={t('backup.row.download', { name: file.name })}
                    aria-label={t('backup.row.download', { name: file.name })}
                    className="rounded-md p-1.5 text-sky-500 hover:bg-sky-50 hover:text-sky-700"
                  >
                    <Download className="size-4" aria-hidden />
                  </a>
                )}
                {can('settings.backup', 'delete') && (
                  <RowAction
                    icon={<Trash2 className="size-4" aria-hidden />}
                    label={
                      data.files.length <= 1
                        ? t('backup.row.onlyCopy')
                        : t('backup.row.remove', { name: file.name })
                    }
                    tone="danger"
                    disabled={data.files.length <= 1}
                    onClick={() => setConfirming(file.name)}
                  />
                )}
              </RowActions>
            </td>
          </tr>
        ))}
      </RecordTable>

      {/*
        Restore is shown as a command rather than a button. It overwrites every attendance
        record in one action, and the right moment to run it is with the server stopped,
        which a web request cannot arrange for itself.
      */}
      <PanelSection
        icon={<Terminal className="size-4" aria-hidden />}
        title={<T k="backup.restore.title" />}
        subtitle={<T k="backup.restore.subtitle" />}
      />

      <PanelBody className="space-y-3">
        <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
          <T k={data.restoreWarningKey} />
        </PanelNote>
        <p className="text-sm text-slate-600">
          <T k="backup.restore.lead" />
        </p>
        <pre className="overflow-x-auto rounded-lg bg-slate-900 px-3 py-2.5 text-xs text-slate-100">
          <code>{data.restoreHint}</code>
        </pre>
        <PanelNote>
          <T k="backup.restore.note" />
        </PanelNote>
      </PanelBody>

      {confirming !== null && (
        <Dialog
          title={<T k="backup.remove.title" />}
          titleText={t('backup.remove.title')}
          onClose={() => setConfirming(null)}
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <T
                k="backup.remove.body"
                vars={{ name: <span className="font-mono text-xs">{confirming}</span> }}
              />
            </p>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                <T k="dialog.cancel" />
              </Button>
              <Button
                onClick={() => void remove(confirming)}
                className="bg-rose-600 hover:bg-rose-500"
              >
                <T k="app.remove" />
              </Button>
            </div>
          </div>
        </Dialog>
      )}

    </>
  );
}
