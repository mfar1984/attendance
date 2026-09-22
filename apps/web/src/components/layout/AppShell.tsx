import type { LabelKey } from '@attendance/shared';
import { Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';

import { dashboardApi, type DashboardPayload } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { NAV_GROUPS } from '../../lib/nav';
import { T, useLabels } from '../../lib/translation';
import { HeaderMenu } from './HeaderMenu';
import { Sidebar } from './Sidebar';

/**
 * Screens reached from somewhere other than the sidebar.
 *
 * Without these the header falls back to "Dashboard", so a person on their own profile page
 * is told they are looking at the dashboard.
 *
 * Module scope rather than inside the component: it is a constant, and rebuilding it on every
 * render was pointless work.
 */
const OFF_NAV_TITLES: Record<string, LabelKey> = {
  '/profil': 'nav.profile',
  '/tetapan/peranan/baharu': 'nav.settings.roles.new',
};

/** Passed to child routes so the shell and the page share one fetch. */
export interface ShellContext {
  data: DashboardPayload | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function AppShell(): ReactNode {
  const { session, loading: authLoading } = useAuth();
  const { t } = useLabels();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await dashboardApi.load());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('shell.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  if (authLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-100">
        <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('app.loading')} />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const titleKey =
    OFF_NAV_TITLES[location.pathname] ??
    (location.pathname.startsWith('/tetapan/peranan/') ? 'nav.settings.roles.edit' : undefined) ??
    (location.pathname.startsWith('/tetapan/peranti/') ? 'nav.settings.devices.edit' : undefined) ??
    // `/staf/:id` only. The named staff routes are nav entries and resolve below.
    (/^\/staf\/\d+$/.test(location.pathname) ? 'nav.staff.detail' : undefined) ??
    NAV_GROUPS.flatMap((group) => group.items).find((item) => item.to === location.pathname)
      ?.labelKey ??
    'nav.dashboard';

  const threshold = data?.driftThresholdSeconds ?? 30;
  const drifting = (data?.devices ?? []).filter(
    (device) => device.clockDriftSeconds !== null && Math.abs(device.clockDriftSeconds) > threshold,
  );
  const offline = (data?.devices ?? []).filter((device) => device.status === 'offline');

  const context: ShellContext = { data, loading, error, reload: () => void load() };

  return (
    <div className="flex h-dvh overflow-hidden">
      <a href="#kandungan" className="skip-link">
        <T k="shell.skipLink" />
      </a>

      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
        session={session}
        data={data}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-2">
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-slate-800">
            <T k={titleKey} />
          </h1>

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label={t('app.refresh')}
            title={t('app.refresh')}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-60"
          >
            <RefreshCw className={loading ? 'size-5 animate-spin' : 'size-5'} aria-hidden />
          </button>

          {/*
            Logging out moved into the user menu. It was a full-width bordered button beside
            Refresh, which put the most destructive control in the header at the same weight
            as the most routine one.
          */}
          <HeaderMenu />
        </header>

        {error !== null && (
          <div role="alert" className="border-b border-rose-200 bg-rose-50 px-6 py-2.5 text-sm text-rose-800">
            {error}
          </div>
        )}

        {/*
          Clock drift is promoted to a persistent banner because it is the one
          fault that corrupts every record while producing no error anywhere: the
          terminal keeps working, scans keep arriving, and the timestamps are
          simply wrong. Nothing in the terminal's own interface reports it.
        */}
        {drifting.length > 0 && (
          <div
            role="status"
            className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-sm text-amber-900"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              {/*
                Kept as whole sentences with `{name}` slots rather than assembled from
                fragments. The count and the terminal name do not sit in the same position in
                every language, and concatenating around them produces something ungrammatical
                as soon as the clause order differs.
              */}
              {drifting.length === 1
                ? t('shell.drift.one', {
                    name: drifting[0]!.name,
                    drift: formatDrift(drifting[0]!.clockDriftSeconds!, t),
                  })
                : t('shell.drift.many', { count: drifting.length })}
              {/* Not a label: `timeMode` is the device's own field name. */}
              {drifting.some((device) => device.clockMode === 'manual') && ' (timeMode: manual)'}.{' '}
              {t('shell.drift.consequence')}
            </p>
          </div>
        )}

        {offline.length > 0 && (
          <div
            role="status"
            className="border-b border-rose-200 bg-rose-50 px-6 py-2.5 text-sm text-rose-800"
          >
            {t('shell.offline', {
              count: offline.length,
              names: offline.map((device) => device.name).join(', '),
            })}
          </div>
        )}

        <main id="kandungan" className="flex-1 overflow-y-auto bg-slate-100 px-6 py-5">
          <Outlet context={context} />
        </main>
      </div>
    </div>
  );
}

/**
 * Takes `t` rather than reading the registry directly, because it is a plain function and
 * hooks cannot be called from one. The direction words are translatable; `m` and `s` are unit
 * abbreviations and stay as they are.
 */
function formatDrift(seconds: number, t: (key: LabelKey) => string): string {
  const absolute = Math.abs(seconds);
  const minutes = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  const magnitude = minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
  return `${magnitude} ${t(seconds > 0 ? 'shell.drift.forward' : 'shell.drift.backward')}`;
}
