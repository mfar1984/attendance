import type { LabelKey } from '@attendance/shared';
import { ChevronDown, ChevronsLeft, ChevronsRight, ScanFace } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';

import type { DashboardPayload, SessionUser } from '../../lib/api';
import { cn } from '../../lib/cn';
import { groupByDomain } from '@attendance/shared';

import { NAV_GROUPS, visibleGroups, type NavGroup, type NavItem } from '../../lib/nav';
import { T, useLabels } from '../../lib/translation';

/**
 * Light rail rather than a dark one.
 *
 * The application body is white cards on a light grey field, and a dark rail beside it
 * reads as a separate application docked to the side. Sharing the surface makes the whole
 * window one object, and it gives the active entry somewhere to stand out — on a dark rail
 * every row already looks emphasised, so the selected one has to shout.
 *
 * Groups collapse. An earlier version listed all twenty-two entries at once under six
 * headings, which meant the rail was a wall of rows and finding one was reading rather than
 * scanning. Each heading is now the row itself, so the closed rail is six rows and you open
 * the one you are working in.
 *
 * This is the point the original "no expand chevrons" rule anticipated: a chevron that
 * opens nothing is a trap, and these open something. Every chevron here sits on a row that
 * genuinely has children, and no row carries one otherwise.
 */

const BADGE_TONES = {
  neutral: 'bg-slate-100 text-slate-600',
  warning: 'bg-amber-100 text-amber-800',
  live: 'bg-emerald-100 text-emerald-700',
} as const;

/** Survives navigation and reloads, so the rail does not reset while somebody works. */
const STORAGE_KEY = 'sidebar.expanded';

export function Sidebar({
  collapsed,
  onToggle,
  session,
  data,
}: {
  collapsed: boolean;
  onToggle: () => void;
  session: SessionUser;
  data: DashboardPayload | null;
}): ReactNode {
  const location = useLocation();
  const { t } = useLabels();
  const badges = liveBadges(data);
  const groups = visibleGroups(session.permissions);

  /**
   * Partitioned into domains from the shared mapping, which the permission matrix reads too.
   *
   * `ungrouped` is Dashboard: it belongs to no domain because it summarises all of them, and it
   * sits above the first heading.
   */
  const { ungrouped: standalone, domains } = groupByDomain(groups, (group) => group.titleKey);
  const sections = domains.flatMap((domain) => domain.groups);

  /**
   * The group holding the current route, which is always shown open.
   *
   * Identified by its registry key rather than its visible title. The key is stable across
   * languages; the title is not, so keying the open set on the words would collapse every
   * open group the moment somebody switched language.
   */
  const activeKey = sections.find((group) =>
    group.items.some((item) => isCurrent(item.to, location.pathname)),
  )?.titleKey;

  const [open, setOpen] = useState<Set<string>>(() => restore());

  /**
   * Opens the group containing the current route.
   *
   * Without this, arriving on a deep link leaves every group shut and nothing on screen
   * says where you are. Added to the set rather than replacing it, so a group somebody
   * opened deliberately is not closed by navigating elsewhere.
   */
  useEffect(() => {
    if (activeKey === undefined) return;
    setOpen((current) => (current.has(activeKey) ? current : new Set(current).add(activeKey)));
  }, [activeKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...open]));
    } catch {
      // A rail that cannot remember its state is still a working rail.
    }
  }, [open]);

  const toggleSection = useCallback((key: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <nav
      aria-label={t('shell.nav.aria')}
      className={cn(
        'flex h-full flex-col border-r border-slate-200 bg-white transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      {/*
        Padded to the same rhythm as the content header beside it — `py-3` around a 32px
        child — so the two bottom rules meet as one line across the window without either
        height being hardcoded to match the other.
      */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-slate-200 px-3 py-3">
        {collapsed ? (
          /*
            Only the toggle when collapsed. There is room for the mark or the toggle, not
            both, and dropping the toggle would leave no way back to the full rail.
          */
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={false}
            aria-label={t('shell.sidebar.open')}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <ChevronsRight className="size-4" aria-hidden />
          </button>
        ) : (
          <>
            <span
              aria-hidden
              className="bg-brand-600 grid size-8 shrink-0 place-items-center rounded-lg text-white shadow-sm"
            >
              <ScanFace className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-800">
                <T k="app.brand" />
              </p>
              <p className="truncate text-[11px] text-slate-500">
                {t('shell.mode', { mode: data?.connectorMode ?? '—' })}
              </p>
            </div>
            <button
              type="button"
              onClick={onToggle}
              aria-expanded
              aria-label={t('shell.sidebar.close')}
              className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <ChevronsLeft className="size-4" aria-hidden />
            </button>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {/* Dashboard and anything else ungrouped, then a rule. It is not one of the
            sections and should not read as the first item of one. */}
        {standalone.map((group, index) => (
          <ul key={`standalone-${String(index)}`} className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.to}>
                <TopRow
                  item={item}
                  badge={badges[item.to] ?? item.badge}
                  collapsed={collapsed}
                  active={isCurrent(item.to, location.pathname)}
                />
              </li>
            ))}
          </ul>
        ))}

        {standalone.length > 0 && sections.length > 0 && (
          <hr className="mx-1 my-2 border-slate-200" />
        )}

        {domains.map((domain, domainIndex) => (
          <div
            key={domain.key}
            /*
              Less top margin when collapsed, because the rule below is doing the separating
              there and the two together would leave a gap wide enough to read as a missing row.
            */
            className={cn(domainIndex > 0 && (collapsed ? 'mt-2' : 'mt-4'))}
          >
            {/*
              The heading is omitted entirely when the rail is collapsed.

              There is no room for it on 64px, and a truncated one would be three letters of a
              word. The collapsed rail separates domains with a rule instead, which is what the
              eye uses at that width.

              `slate-500`, not `slate-400`: at 11px this is still text somebody reads to find a
              domain, and `slate-400` on white is around 3:1 — the same reason the group titles
              use 500.
            */}
            {!collapsed && (
              <p className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                <T k={domain.labelKey} />
              </p>
            )}

            {collapsed && domainIndex > 0 && (
              <hr className="mx-1 mb-2 border-slate-200" aria-hidden />
            )}

            <ul className="space-y-0.5">
              {domain.groups.map((group) => {
                // Non-null: every group in a domain was matched on this field.
                const key = group.titleKey!;

                return (
                  <li key={key}>
                    <Section
                      group={group}
                      titleKey={key}
                      badges={badges}
                      collapsed={collapsed}
                      expanded={open.has(key)}
                      onToggle={() => toggleSection(key)}
                      pathname={location.pathname}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/*
        The sync cursor is shown permanently rather than buried in a settings page. Push
        delivery from the terminal has no retry, so silence does not mean healthy: a serial
        number that stops advancing while people are still scanning is the only visible
        symptom.
      */}
      {!collapsed && <Footer session={session} data={data} />}
    </nav>
  );
}

// ---------------------------------------------------------------------------

/** A row that navigates on its own, with no children. */
function TopRow({
  item,
  badge,
  collapsed,
  active,
}: {
  item: NavItem;
  badge: NavItem['badge'];
  collapsed: boolean;
  active: boolean;
}): ReactNode {
  const Icon = item.icon;
  const { t } = useLabels();

  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      title={collapsed ? t(item.labelKey) : undefined}
      className={cn(
        'group relative flex items-center gap-2.5 rounded-lg py-2 text-sm',
        collapsed ? 'justify-center px-0' : 'px-2.5',
        active
          ? 'bg-brand-100 text-brand-700 font-medium'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      )}
    >
      {/* A bar on the leading edge, so the selected row is identifiable without relying
          on the tint alone. */}
      <span
        aria-hidden
        className={cn(
          'bg-brand-600 absolute top-1.5 bottom-1.5 -left-2 w-0.5 rounded-r',
          active ? 'opacity-100' : 'opacity-0',
        )}
      />
      <Icon
        className={cn(
          'size-4 shrink-0',
          active ? 'text-brand-700' : 'text-slate-500 group-hover:text-slate-700',
        )}
        aria-hidden
      />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">
            <T k={item.labelKey} />
          </span>
          {badge && (
            <span
              className={cn(
                'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                BADGE_TONES[badge.tone],
              )}
            >
              {badge.value}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

/**
 * One collapsible section.
 *
 * The heading is a button rather than a link: it has no page of its own, and giving it one
 * would mean guessing which child is the section's front door.
 */
function Section({
  group,
  titleKey,
  badges,
  collapsed,
  expanded,
  onToggle,
  pathname,
}: {
  group: NavGroup;
  titleKey: LabelKey;
  badges: Record<string, NavItem['badge']>;
  collapsed: boolean;
  expanded: boolean;
  onToggle: () => void;
  pathname: string;
}): ReactNode {
  const Icon = group.icon;
  const { t } = useLabels();
  const holdsCurrent = group.items.some((item) => isCurrent(item.to, pathname));

  /**
   * Whether anything inside needs attention.
   *
   * A closed section hides its children's badges, so a warning would vanish the moment
   * somebody tidied the rail. Rolled up as a dot rather than a number: the counts inside
   * are different kinds of thing — a count of exceptions, a ratio of terminals — and adding
   * them together would produce a figure that means nothing.
   */
  const warns = group.items.some((item) => (badges[item.to] ?? item.badge)?.tone === 'warning');

  if (collapsed) {
    return (
      <CollapsedSection
        group={group}
        titleKey={titleKey}
        badges={badges}
        holdsCurrent={holdsCurrent}
        warns={warns}
        pathname={pathname}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={cn(
          'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm',
          holdsCurrent ? 'text-brand-700 font-medium' : 'text-slate-700 hover:bg-slate-100',
        )}
      >
        <Icon
          className={cn(
            'size-4 shrink-0',
            holdsCurrent ? 'text-brand-700' : 'text-slate-500 group-hover:text-slate-700',
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-left">
          <T k={titleKey} />
        </span>

        {warns && !expanded && (
          <span
            aria-label={t('shell.sidebar.attention')}
            className="size-1.5 shrink-0 rounded-full bg-amber-500"
          />
        )}

        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-slate-400 transition-transform',
            expanded && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {expanded && (
        <ul className="mt-0.5 mb-1 space-y-0.5">
          {group.items.map((item) => {
            const badge = badges[item.to] ?? item.badge;
            const active = isCurrent(item.to, pathname);

            return (
              <li key={item.to} className="relative pl-[2.05rem]">
                {/* The connector. Drawn per row rather than as one border on the list so
                    it stays put whatever a row's height turns out to be. */}
                <span
                  aria-hidden
                  className="absolute top-0 bottom-0 left-[1.1rem] w-px bg-slate-200"
                />
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-1/2 left-[calc(1.1rem-2.5px)] size-1.5 -translate-y-1/2 rounded-full ring-2 ring-white',
                    active ? 'bg-brand-600' : 'bg-slate-300',
                  )}
                />

                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={cn(
                    'flex items-center gap-2 rounded-lg py-1.5 pr-2 pl-2 text-[13px]',
                    active
                      ? 'bg-brand-100 text-brand-700 font-medium'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <T k={item.labelKey} />
                  </span>
                  {badge && (
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                        BADGE_TONES[badge.tone],
                      )}
                    >
                      {badge.value}
                    </span>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/**
 * A section on the icon rail.
 *
 * Its children cannot expand inline — there is no room for a label — so the icon opens a
 * flyout instead. Without one the collapsed rail would be decorative: you would have to
 * reopen the whole rail to reach anything, which is not a minimised rail, it is a hidden
 * one.
 */
function CollapsedSection({
  group,
  titleKey,
  badges,
  holdsCurrent,
  warns,
  pathname,
}: {
  group: NavGroup;
  titleKey: LabelKey;
  badges: Record<string, NavItem['badge']>;
  holdsCurrent: boolean;
  warns: boolean;
  pathname: string;
}): ReactNode {
  const Icon = group.icon;
  const { t } = useLabels();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }
    function onPointer(event: MouseEvent): void {
      if (container.current && !container.current.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t(titleKey)}
        title={t(titleKey)}
        className={cn(
          'relative flex w-full items-center justify-center rounded-lg py-2',
          holdsCurrent ? 'bg-brand-100 text-brand-700' : 'text-slate-500 hover:bg-slate-100',
        )}
      >
        <Icon className="size-4" aria-hidden />
        {warns && (
          <span
            aria-hidden
            className="absolute top-1 right-1.5 size-1.5 rounded-full bg-amber-500"
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-0 left-full z-40 ml-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        >
          <p className="border-b border-slate-200 px-3 py-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
            <T k={titleKey} />
          </p>
          <ul className="py-1">
            {group.items.map((item) => {
              const badge = badges[item.to] ?? item.badge;
              const active = isCurrent(item.to, pathname);

              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 text-sm',
                      active
                        ? 'bg-brand-100 text-brand-700 font-medium'
                        : 'text-slate-600 hover:bg-slate-50',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <T k={item.labelKey} />
                    </span>
                    {badge && (
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                          BADGE_TONES[badge.tone],
                        )}
                      >
                        {badge.value}
                      </span>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Footer({
  session,
  data,
}: {
  session: SessionUser;
  data: DashboardPayload | null;
}): ReactNode {
  const tip = (data?.devices ?? []).reduce((highest, device) => {
    const serial = Number(device.lastSerialNo);
    return serial > highest ? serial : highest;
  }, 0);

  const lastSync = (data?.devices ?? [])
    .map((device) => device.lastSyncAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);

  const { t } = useLabels();

  return (
    <footer className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-3 text-xs">
      <p className="truncate font-medium text-slate-700">{session.fullName}</p>
      <p className="truncate text-[11px] text-slate-500">{session.roleName}</p>
      <p className="mt-1.5 truncate font-mono text-[11px] text-slate-500">
        {lastSync
          ? t('shell.sync.at', { time: formatClock(lastSync) })
          : t('shell.sync.never')}{' '}
        · {t('shell.serial', { serial: tip })}
      </p>
    </footer>
  );
}

// ---------------------------------------------------------------------------

/**
 * Every nav destination, longest first.
 *
 * Derived from the nav data rather than listed here, so an entry added there cannot be
 * missing from the resolution below. Sorted by length because the winner is the most
 * specific match, and `find` on a descending list is that.
 */
const NAV_PATHS = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.to))
  .filter((to) => to !== '/')
  .sort((a, b) => b.length - a.length);

/**
 * Whether a nav entry owns the current path.
 *
 * Subtree matching, but only for the **most specific** entry that matches. The Roles entry
 * still owns `/tetapan/peranan/3` because no other entry is closer to it, and the Staff
 * Directory owns `/staf/5` for the same reason.
 *
 * The specificity check is what was missing. `/staf` is a prefix of `/staf/pemetaan`,
 * `/staf/biometrik` and three more, so plain subtree matching had it claim all of them —
 * and the rail marked two rows active at once on every staff sub-page. Comparing against
 * the resolved owner rather than testing each entry in isolation is what fixes it for any
 * future entry whose path nests under another.
 *
 * A path no entry owns marks nothing, which is right for `/profil`: it is reached from the
 * header menu and is deliberately not in the rail.
 */
function isCurrent(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/';
  return owningNavPath(pathname) === to;
}

function owningNavPath(pathname: string): string | undefined {
  return NAV_PATHS.find((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function restore(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Derives badge values from live data instead of hardcoding them. */
function liveBadges(data: DashboardPayload | null): Record<string, NavItem['badge']> {
  if (!data) return {};

  const badges: Record<string, NavItem['badge']> = {};

  if (data.exceptions.length > 0) {
    badges['/kehadiran/pengecualian'] = {
      value: String(data.exceptions.length),
      tone: 'warning',
    };
  }

  if (data.today.staffTotal > 0) {
    badges['/staf'] = {
      value: new Intl.NumberFormat('ms-MY').format(data.today.staffTotal),
      tone: 'neutral',
    };
  }

  const online = data.devices.filter((device) => device.status !== 'offline').length;
  if (data.devices.length > 0) {
    badges['/tetapan/peranti'] = {
      value: `${online}/${data.devices.length}`,
      tone: online === data.devices.length ? 'neutral' : 'warning',
    };
  }

  return badges;
}

function formatClock(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '—';
  return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
}
