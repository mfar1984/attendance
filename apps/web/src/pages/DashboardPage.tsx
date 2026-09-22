import { CircleAlert, Fingerprint, IdCard, Loader2, Radio, Router, ScanFace } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useOutletContext } from 'react-router';

import type { ShellContext } from '../components/layout/AppShell';
import {
  PanelBody,
  PanelCard,
  PanelNote,
  PanelSection,
  RecordTable,
} from '../components/RecordPanel';
import { StatTile } from '../components/ui';
import type { DashboardDevice, DashboardException, DashboardScan } from '../lib/api';
import { cn } from '../lib/cn';
import { EXCEPTION_LABELS } from '../lib/operations-api';
import { T, useLabels } from '../lib/translation';

const METHOD_ICONS: Record<string, typeof ScanFace> = {
  face: ScanFace,
  fingerprint: Fingerprint,
  card: IdCard,
};

export function DashboardPage(): ReactNode {
  const { data, loading, error } = useOutletContext<ShellContext>();
  const { t } = useLabels();
  const number = new Intl.NumberFormat('ms-MY');

  if (loading && !data) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('app.loading')} />
      </div>
    );
  }

  if (!data) {
    return (
      <PanelCard title={<T k="nav.dashboard" />}>
        <PanelBody>
          <PanelNote tone="danger">{error ?? <T k="dashboard.empty" />}</PanelNote>
        </PanelBody>
      </PanelCard>
    );
  }

  const { today, recentScans, exceptions, devices } = data;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label={<T k="dashboard.stat.present" />}
          value={number.format(today.present)}
          hint={
            <T
              k="dashboard.stat.present.hint"
              vars={{ total: number.format(today.staffTotal) }}
            />
          }
          tone="success"
        />
        <StatTile
          label={<T k="dashboard.stat.late" />}
          value={number.format(today.late)}
          tone="warning"
        />
        <StatTile
          label={<T k="dashboard.stat.absent" />}
          value={number.format(today.absent)}
          tone="danger"
        />
        <StatTile
          label={<T k="dashboard.stat.onLeave" />}
          value={number.format(today.onLeave)}
        />
        {/*
          Surfaced on the dashboard rather than hidden behind a filter. A staff member can
          exist on a terminal with no face, fingerprint or card, in which case they cannot
          clock in at all — and nothing errors.
        */}
        <StatTile
          label={<T k="dashboard.stat.noBiometrics" />}
          value={number.format(today.missingBiometrics)}
          hint={<T k="dashboard.stat.noBiometrics.hint" />}
          tone={today.missingBiometrics > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <PanelCard title={<T k="dashboard.scans.title" />}>
            <PanelSection
              title={
                recentScans.length === 0 ? (
                  <T k="dashboard.scans.none" />
                ) : (
                  <T k="dashboard.scans.count" vars={{ count: recentScans.length }} />
                )
              }
              subtitle={<T k="dashboard.scans.subtitle" />}
              action={
                <Link
                  to="/kehadiran/monitor"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Radio className="size-3.5" aria-hidden />
                  <T k="dashboard.scans.monitor" />
                </Link>
              }
            />

            <RecordTable
              loading={false}
              rowCount={recentScans.length}
              empty={<T k="dashboard.scans.empty" />}
              columns={[
                { header: <T k="dashboard.scans.column.time" />, width: 'w-24' },
                { header: <T k="dashboard.scans.column.staff" /> },
                { header: <T k="dashboard.scans.column.terminal" />, width: 'w-36' },
                { header: <T k="dashboard.scans.column.status" />, width: 'w-40' },
              ]}
            >
              {recentScans.map((scan) => (
                <ScanRow key={scan.id} scan={scan} />
              ))}
            </RecordTable>
          </PanelCard>
        </div>

        <PanelCard title={<T k="dashboard.exceptions.title" />}>
          <PanelSection
            title={
              exceptions.length === 0 ? (
                <T k="dashboard.exceptions.none" />
              ) : (
                <T k="dashboard.exceptions.count" vars={{ count: exceptions.length }} />
              )
            }
            action={
              <Link
                to="/kehadiran/pengecualian"
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <T k="dashboard.exceptions.open" />
              </Link>
            }
          />

          {exceptions.length === 0 ? (
            <PanelBody>
              <PanelNote tone="success">
                <T k="dashboard.exceptions.clear" />
              </PanelNote>
            </PanelBody>
          ) : (
            <ul className="divide-y divide-slate-100">
              {exceptions.map((exception) => (
                <ExceptionRow key={exception.id} exception={exception} />
              ))}
            </ul>
          )}
        </PanelCard>
      </div>

      <PanelCard title={<T k="dashboard.devices.title" />}>
        <PanelSection
          title={<T k="dashboard.devices.count" vars={{ count: devices.length }} />}
          subtitle={<T k="dashboard.devices.subtitle" />}
          action={
            <Link
              to="/tetapan/peranti"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Router className="size-3.5" aria-hidden />
              <T k="dashboard.devices.manage" />
            </Link>
          }
        />

        <RecordTable
          loading={false}
          rowCount={devices.length}
          empty={<T k="dashboard.devices.empty" />}
          columns={[
            { header: <T k="dashboard.devices.column.name" /> },
            { header: <T k="dashboard.devices.column.host" />, width: 'w-44' },
            { header: <T k="dashboard.devices.column.status" />, width: 'w-32' },
            { header: <T k="dashboard.devices.column.capacity" />, width: 'w-44' },
            { header: <T k="dashboard.devices.column.clock" />, width: 'w-32' },
            { header: <T k="dashboard.devices.column.serial" />, width: 'w-28' },
          ]}
        >
          {devices.map((device) => (
            <DeviceRow key={device.id} device={device} threshold={data.driftThresholdSeconds} />
          ))}
        </RecordTable>
      </PanelCard>
    </div>
  );
}

function ScanRow({ scan }: { scan: DashboardScan }): ReactNode {
  const Icon = METHOD_ICONS[scan.method] ?? ScanFace;

  return (
    <tr className={cn('border-b border-slate-100', scan.suppressed && 'bg-slate-50/60')}>
      <td className="px-5 py-2 font-mono text-xs tabular-nums text-slate-600">
        {formatTime(scan.time)}
      </td>
      <td className="px-2 py-2">
        <span className="flex items-center gap-1.5">
          <Icon className="size-3.5 shrink-0 text-slate-400" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-slate-800">{scan.name}</span>
            <span className="block font-mono text-[11px] text-slate-400">{scan.employeeNo}</span>
          </span>
        </span>
      </td>
      <td className="px-2 py-2 text-xs text-slate-600">{scan.device ?? '—'}</td>
      <td className="px-2 py-2">
        {/*
          Suppressed scans are shown, not hidden. The terminal emits several scans for
          one person seconds apart; the engine keeps one and flags the rest. Hiding them
          would make this view disagree with the raw device log.
        */}
        {scan.suppressed ? (
          <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600">
            <T k="scan.suppressed" />
          </span>
        ) : scan.direction === 'in' ? (
          <span className="inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700">
            <T k="scan.in" />
          </span>
        ) : scan.direction === 'out' ? (
          <span className="inline-block rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-sky-700">
            <T k="scan.out" />
          </span>
        ) : (
          <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600">
            <T k="scan.undecided" />
          </span>
        )}
      </td>
    </tr>
  );
}

function ExceptionRow({ exception }: { exception: DashboardException }): ReactNode {
  const key = EXCEPTION_LABELS[exception.kind];
  const who = exception.name ?? exception.employeeNo;

  return (
    <li className="flex gap-2.5 px-5 py-2.5">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
      <div className="min-w-0">
        {/* Falls back to the raw enum value: an unmapped kind should still be readable
            rather than rendering as blank. */}
        <p className="text-sm font-medium text-slate-700">
          {key === undefined ? exception.kind : <T k={key} />}
        </p>
        <p className="truncate text-xs text-slate-500">
          {who !== null && who.length > 0 ? `${who} · ` : ''}
          {formatDateTime(exception.occurredAt)}
        </p>
        {exception.detail !== null && (
          <p className="truncate text-xs text-slate-400">{exception.detail}</p>
        )}
      </div>
    </li>
  );
}

function DeviceRow({
  device,
  threshold,
}: {
  device: DashboardDevice;
  threshold: number;
}): ReactNode {
  const drift = device.clockDriftSeconds;
  const drifting = drift !== null && Math.abs(drift) > threshold;
  const unhealthy = device.status === 'offline' || device.status === 'degraded';

  return (
    <tr className={cn('border-b border-slate-100', (unhealthy || drifting) && 'bg-rose-50/40')}>
      <td className="px-5 py-2.5">
        <span className="block font-medium text-slate-800">{device.name}</span>
        <span className="block text-[11px] text-slate-400">{device.model ?? '—'}</span>
      </td>
      <td className="px-2 py-2.5 font-mono text-xs text-slate-600">{device.host}</td>
      <td className="px-2 py-2.5">
        <span
          className={cn(
            'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
            device.status === 'online' && 'bg-emerald-50 text-emerald-700',
            device.status === 'degraded' && 'bg-amber-50 text-amber-800',
            device.status === 'offline' && 'bg-rose-50 text-rose-700',
            device.status === 'unknown' && 'bg-slate-100 text-slate-600',
          )}
        >
          {device.status === 'online' ? (
            <T k="device.status.online" />
          ) : device.status === 'degraded' ? (
            <T k="device.status.degraded" />
          ) : device.status === 'offline' ? (
            <T k="device.status.offline" />
          ) : (
            <T k="device.status.unknown" />
          )}
        </span>
      </td>
      <td className="px-2 py-2.5">
        <CapacityBar enrolled={device.enrolled} capacity={device.capacity} />
      </td>
      <td className="px-2 py-2.5">
        {drifting ? (
          <span className="inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-800">
            {formatDrift(drift)}
          </span>
        ) : drift === null ? (
          <span className="text-xs text-slate-400">—</span>
        ) : (
          <span className="text-xs text-slate-500">
            <T
              k={
                device.clockMode === 'manual'
                  ? 'dashboard.devices.clock.exactManual'
                  : 'dashboard.devices.clock.exact'
              }
            />
          </span>
        )}
      </td>
      <td className="px-2 py-2.5 font-mono text-xs tabular-nums text-slate-600">
        #{device.lastSerialNo}
      </td>
    </tr>
  );
}

/**
 * Capacity is drawn, not just counted.
 *
 * Each terminal stores a fixed number of faces, so with thousands of staff across a
 * handful of units the ceiling is reached during normal use. Without this, a full
 * terminal is discovered only when an enrolment fails.
 */
function CapacityBar({ enrolled, capacity }: { enrolled: number; capacity: number }): ReactNode {
  const { t } = useLabels();
  const safeCapacity = capacity > 0 ? capacity : 1;
  const ratio = enrolled / safeCapacity;
  const percent = Math.min(100, Math.round(ratio * 100));
  const tone = ratio >= 0.95 ? 'bg-rose-500' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200"
        role="img"
        aria-label={t('dashboard.devices.capacity.aria', { percent })}
      >
        <div className={cn('h-full', tone)} style={{ width: `${String(percent)}%` }} />
      </div>
      <span className="font-mono text-xs tabular-nums text-slate-600">
        {enrolled}/{capacity}
      </span>
    </div>
  );
}

function formatTime(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '—';
  return when.toLocaleTimeString('ms-MY', { hour12: false });
}

function formatDateTime(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '—';
  return when.toLocaleString('ms-MY', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDrift(seconds: number): string {
  const absolute = Math.abs(seconds);
  const minutes = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  const magnitude = minutes > 0 ? `${String(minutes)}m ${String(remainder)}s` : `${String(remainder)}s`;
  return `${seconds > 0 ? '+' : '-'}${magnitude}`;
}
