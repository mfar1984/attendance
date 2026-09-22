import { Bell, ChevronDown, LogOut, TriangleAlert, User } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';

import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatDateTime } from '../../lib/operations-api';
import { alertsApi, profileApi, type AlertsPayload } from '../../lib/settings-api';
import { T, useLabels } from '../../lib/translation';

/**
 * The right-hand end of the header: what needs attention, and who you are.
 *
 * Both are popovers rather than pages because both are things you check in passing. Each
 * closes on Escape and on a click outside, and each is reachable from the keyboard —
 * a menu that can only be opened with a mouse hides logging out from anybody using one.
 */
export function HeaderMenu(): ReactNode {
  return (
    <div className="flex items-center gap-1">
      <AlertBell />
      <UserMenu />
    </div>
  );
}

/**
 * Closes a popover on Escape and on a click outside it.
 *
 * Extracted because getting this wrong is the usual reason a menu has to be dismissed by
 * clicking the trigger again — which nobody discovers.
 */
function useDismiss(open: boolean, onClose: () => void): React.RefObject<HTMLDivElement | null> {
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    function onPointer(event: MouseEvent): void {
      if (container.current && !container.current.contains(event.target as Node)) onClose();
    }

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open, onClose]);

  return container;
}

const TONE_DOTS: Record<string, string> = {
  danger: 'bg-rose-500',
  warn: 'bg-amber-500',
  info: 'bg-sky-500',
};

function AlertBell(): ReactNode {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AlertsPayload | null>(null);
  const { t } = useLabels();
  const navigate = useNavigate();

  const close = useCallback(() => setOpen(false), []);
  const container = useDismiss(open, close);

  const load = useCallback(async () => {
    try {
      setData(await alertsApi.load());
    } catch {
      // A failed alert poll is not worth an error strip across the top of every screen.
      setData(null);
    }
  }, []);

  useEffect(() => {
    void load();
    // Every two minutes. These are conditions rather than messages, so the exact moment
    // one appears does not matter; polling harder would just add load for no decision.
    const timer = setInterval(() => void load(), 120_000);
    return () => clearInterval(timer);
  }, [load]);

  const total = data?.total ?? 0;
  const worst = data?.worst ?? null;

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void load();
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={
          total === 0 ? t('shell.alerts.none') : t('shell.alerts.aria', { count: total })
        }
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      >
        <Bell className="size-5" aria-hidden />
        {total > 0 && (
          <span
            aria-hidden
            className={cn(
              'absolute top-1 right-1 grid size-4 place-items-center rounded-full text-[10px] font-semibold text-white',
              worst === 'danger' ? 'bg-rose-600' : worst === 'warn' ? 'bg-amber-600' : 'bg-sky-600',
            )}
          >
            {total}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 w-96 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-800">
              <T k="shell.alerts.title" />
            </p>
            {data !== null && (
              <span className="text-[11px] text-slate-400">
                {formatDateTime(data.generatedAt).slice(-8)}
              </span>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {data === null ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                <T k="shell.alerts.unreadable" />
              </p>
            ) : data.alerts.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                <T k="shell.alerts.empty" />
              </p>
            ) : (
              data.alerts.map((alert) => (
                <button
                  key={alert.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    void navigate(alert.to);
                  }}
                  className="flex w-full items-start gap-2.5 border-b border-slate-100 px-4 py-2.5 text-left last:border-b-0 hover:bg-slate-50"
                >
                  <span
                    aria-hidden
                    className={cn('mt-1.5 size-2 shrink-0 rounded-full', TONE_DOTS[alert.tone])}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-800">{alert.title}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{alert.detail}</span>
                  </span>
                </button>
              ))
            )}
          </div>

          {/*
            Said outright. Anything else invites somebody to dismiss an offline terminal and
            wonder later why the badge went quiet while the terminal stayed offline.
          */}
          <p className="flex items-start gap-1.5 border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
            <T k="shell.alerts.note" />
          </p>
        </div>
      )}
    </div>
  );
}

function UserMenu(): ReactNode {
  const { session, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);

  const close = useCallback(() => setOpen(false), []);
  const container = useDismiss(open, close);

  // Read once. The avatar is not worth polling for, and the profile screen refreshes it
  // through its own load when it changes.
  useEffect(() => {
    let cancelled = false;
    void profileApi
      .load()
      .then((payload) => {
        if (!cancelled) setPhoto(payload.photo.url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!session) return null;

  const initial = session.fullName.trim().charAt(0).toUpperCase() || '?';

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-lg py-1 pr-2 pl-1 text-sm text-slate-700 hover:bg-slate-100"
      >
        <Avatar url={photo} initial={initial} />
        <span className="hidden max-w-48 truncate font-medium sm:block">{session.email}</span>
        <ChevronDown
          className={cn('size-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        >
          <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
            <Avatar url={photo} initial={initial} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800">{session.fullName}</p>
              <p className="truncate text-xs text-slate-500">{session.email}</p>
              {/* The role is here because it is the answer to "why can I not see X". */}
              <p className="mt-0.5 truncate text-[11px] text-slate-400">{session.roleName}</p>
            </div>
          </div>

          <Link
            to="/profil"
            role="menuitem"
            onClick={close}
            className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            <User className="size-4 text-slate-400" aria-hidden />
            <T k="shell.user.profile" />
          </Link>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              void signOut();
            }}
            className="flex w-full items-center gap-2.5 border-t border-slate-200 px-4 py-2.5 text-left text-sm text-rose-700 hover:bg-rose-50"
          >
            <LogOut className="size-4" aria-hidden />
            <T k="shell.user.signOut" />
          </button>
        </div>
      )}
    </div>
  );
}

function Avatar({
  url,
  initial,
  size = 'md',
}: {
  url: string | null;
  initial: string;
  size?: 'md' | 'lg';
}): ReactNode {
  const dimension = size === 'lg' ? 'size-10' : 'size-7';

  if (url !== null) {
    return (
      <img
        src={url}
        alt=""
        className={cn(dimension, 'shrink-0 rounded-full object-cover')}
        // A stored row whose file has gone should fall back to the initial rather than
        // leaving a browser's broken-image glyph in the header.
        onError={(event) => {
          event.currentTarget.style.display = 'none';
        }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        dimension,
        'bg-brand-600 grid shrink-0 place-items-center rounded-full font-semibold text-white',
        size === 'lg' ? 'text-sm' : 'text-xs',
      )}
    >
      {initial}
    </span>
  );
}
