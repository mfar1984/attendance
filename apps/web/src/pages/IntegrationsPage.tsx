import {
  CalendarDays,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Plug,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { ApiWebhookTab } from '../components/ApiWebhookTab';
import { Feedback } from '../components/Dialog';
import { EmailProfilesTab } from '../components/EmailProfilesTab';
import { SecurityTab } from '../components/SecurityTab';
import { SmsTab } from '../components/SmsTab';
import { TelegramTab } from '../components/TelegramTab';
import {
  PanelActions,
  PanelBody,
  PanelCard,
  PanelNote,
  PanelSection,
  PanelTabs,
  FilterRow,
  RecordTable,
  SettingsGroup,
  SettingsStack,
} from '../components/RecordPanel';
import { SelectControl, SettingRow, Switch } from '../components/ChannelForm';
import { Badge, Button } from '../components/ui';
import { useAuth } from '../lib/auth';
import { formatDate as formatDateTime, formatDateOnly } from '../lib/operations-api';
import {
  asText,
  holidayApi,
  settingsApi,
  type HolidayListPayload,
  type SettingsPayload,
} from '../lib/settings-api';
import { T, useLabels } from '../lib/translation';
import { STATES, parseStateCodes, stateLabel } from '@attendance/shared';

/**
 * Outbound integrations.
 *
 * Every one of these reaches the public internet. In `direct` mode the server sits on
 * the hospital LAN, which is the deployment that keeps working when the line drops, so
 * the mode is stated at the top rather than left for someone to discover from a silent
 * failure two weeks later.
 */
export function IntegrationsPage(): ReactNode {
  const { can } = useAuth();
  const { t } = useLabels();
  const [tab, setTab] = useState('email');
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
        setNotice(t('integration.notice.saved'));
        await reload();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('app.error.save'));
      } finally {
        setBusy(false);
      }
    },
    [reload, t],
  );

  if (!data) {
    return (
      <PanelCard title={<T k="integration.title" />}>
        <div className="flex min-h-48 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('app.loading')} />
        </div>
      </PanelCard>
    );
  }

  const shared = { data, busy, save };
  const lan = data.environment.connectorMode === 'direct';

  return (
    <PanelCard title={<T k="integration.title" />} subtitle={<T k="integration.subtitle" />}>
      <PanelTabs
        label={t('integration.tabs.aria')}
        active={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'email',
            label: <T k="integration.tab.email" />,
            labelText: t('integration.tab.email'),
            icon: <Mail className="size-4" aria-hidden />,
          },
          {
            id: 'sms',
            label: <T k="integration.tab.sms" />,
            labelText: t('integration.tab.sms'),
            icon: <MessageSquare className="size-4" aria-hidden />,
          },
          {
            id: 'telegram',
            label: <T k="integration.tab.telegram" />,
            labelText: t('integration.tab.telegram'),
            icon: <Send className="size-4" aria-hidden />,
          },
          ...(can('settings.integration.api', 'view')
            ? [
                {
                  id: 'api',
                  label: <T k="integration.tab.api" />,
                  labelText: t('integration.tab.api'),
                  icon: <Plug className="size-4" aria-hidden />,
                },
              ]
            : []),
          // A separate grant from the one above: deciding the lockout policy and deciding
          // who may mint API tokens are different jobs.
          ...(can('settings.security', 'view')
            ? [
                {
                  id: 'security',
                  label: <T k="integration.tab.security" />,
                  labelText: t('integration.tab.security'),
                  icon: <ShieldCheck className="size-4" aria-hidden />,
                },
              ]
            : []),
          {
            id: 'holidays',
            label: <T k="integration.tab.holidays" />,
            labelText: t('integration.tab.holidays'),
            icon: <CalendarDays className="size-4" aria-hidden />,
          },
        ]}
      />

      {/*
        Stated once, above the tabs, rather than repeated per channel. It is a property
        of the deployment, not of any one integration.
      */}
      {lan && (
        <div className="border-b border-slate-200 bg-amber-50/60 px-5 py-2.5">
          <p className="flex items-start gap-2 text-xs text-amber-900">
            <WifiOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              <T
                k="integration.lan.note"
                vars={{
                  emphasis: (
                    <strong className="font-medium">
                      <T k="integration.lan.note.emphasis" />
                    </strong>
                  ),
                }}
              />
            </span>
          </p>
        </div>
      )}

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      {/* Owns its own loading and feedback: it talks to `/api/email-profiles`, not to
          the shared settings payload the other tabs read from. */}
      {tab === 'email' && <EmailProfilesTab />}
      {tab === 'sms' && <SmsTab />}
      {tab === 'telegram' && <TelegramTab />}
      {tab === 'api' && can('settings.integration.api', 'view') && <ApiWebhookTab />}
      {tab === 'security' && can('settings.security', 'view') && <SecurityTab />}
      {tab === 'holidays' && <HolidayFeedTab {...shared} />}
    </PanelCard>
  );
}

interface TabProps {
  data: SettingsPayload;
  busy: boolean;
  save: (values: Record<string, string | number | boolean | null>) => Promise<void>;
}

// Emel lives in `components/EmailProfilesTab.tsx`: it manages several stored profiles
// with their own endpoints, rather than reading and writing flat setting keys like the
// tabs below, and it had outgrown sitting inline beside them.

// SMS dan Telegram tinggal dalam `components/SmsTab.tsx` dan `components/TelegramTab.tsx`.
// Kedua-duanya bercakap dengan endpoint sendiri dan bukan dengan muatan tetapan yang tab di
// bawah baca, sebab senarai pencetus adalah tatasusunan dan PUT /api/settings hanya menerima
// nilai skalar.

// API & Webhook tinggal dalam `components/ApiWebhookTab.tsx`, dan Keselamatan dalam
// `components/SecurityTab.tsx`. Kedua-duanya bercakap dengan endpoint sendiri
// (`/api/api-config`, `/api/api-tokens`, `/api/webhooks`, `/api/security-config`) dan bukan
// dengan muatan tetapan rata yang tab di bawah baca.

// ---------------------------------------------------------------------------
// Cuti Umum
// ---------------------------------------------------------------------------

/**
 * Public holidays: sync settings, the office list, and the synced result.
 *
 * This tab used to hold a single box for an iCal feed URL that nothing fetched. The list itself was
 * whatever somebody had typed in by hand on `/jadual/cuti-umum`, which for 2026 alone is about
 * twenty rows a year, every year, transcribed off a gazette.
 *
 * `Aktifkan` and `Auto-sync` are two switches because they answer two questions. Turning the first
 * off stops leave treating gazetted days as holidays at all; turning the second off only stops the
 * list refreshing and leaves it exactly as it stands. One switch would mean somebody stopping the
 * nightly refresh silently changed how every leave request is counted.
 */
function HolidayFeedTab({ data, busy, save }: TabProps): ReactNode {
  const { t } = useLabels();
  const [enabled, setEnabled] = useState(false);
  const [autoSync, setAutoSync] = useState(false);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [cacheMinutes, setCacheMinutes] = useState('1440');
  const [states, setStates] = useState<string[]>([]);

  const [list, setList] = useState<HolidayListPayload | null>(null);
  const [listYear, setListYear] = useState(String(new Date().getFullYear()));
  const [showAll, setShowAll] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [listNotice, setListNotice] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(data.values['integration.holidays.enabled'] === true);
    setAutoSync(data.values['integration.holidays.autoSync'] === true);
    const storedYear = asText(data.values['integration.holidays.syncYear']);
    setYear(storedYear.length > 0 ? storedYear : String(new Date().getFullYear()));
    const storedCache = asText(data.values['integration.holidays.cacheMinutes']);
    setCacheMinutes(storedCache.length > 0 ? storedCache : '1440');
    // Parsed rather than taken as text: the stored value is a JSON array of letter codes.
    setStates(parseStateCodes(data.values['integration.holidays.includeStates']));
  }, [data]);

  const loadList = useCallback(async () => {
    try {
      setList(await holidayApi.list(Number(listYear), showAll ? 'all' : 'offices'));
      setListError(null);
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : t('integration.holiday.error.list'));
    }
  }, [listYear, showAll, t]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  /*
   * True when the ticks on screen differ from what is stored. Sync reads the saved list, so running
   * it against unsaved ticks writes holidays for the old selection and the screen then shows a
   * result nobody asked for. Refused with the reason rather than silently saving first.
   */
  const storedStates = parseStateCodes(data.values['integration.holidays.includeStates']);
  const dirtyStates =
    storedStates.length !== states.length || storedStates.some((code) => !states.includes(code));

  /**
   * Syncs the year the list is showing, not the year in the settings above.
   *
   * It used to sync the stored `syncYear`, which put two year controls on one screen where the
   * button was wired to the far one. With the list set to 2027 the button read "Sync 2026" and
   * pulled 2026 — correct to the code and wrong to anybody looking at it. The dropdown beside the
   * button is now the year it acts on, so the button needs no number of its own.
   *
   * The stored `syncYear` keeps its job: it is the year the scheduled refresh pulls, with nobody
   * watching.
   */
  async function runSync(): Promise<void> {
    setSyncing(true);
    setListError(null);
    setListNotice(null);
    try {
      const result = await holidayApi.sync(Number(listYear));
      setListNotice(
        t('integration.holiday.synced', { count: result.written, year: String(result.year) }),
      );
      await loadList();
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : t('integration.holiday.error.sync'));
    } finally {
      setSyncing(false);
    }
  }

  const lastSync = asText(data.values['integration.holidays.lastSync']);

  return (
    <>
      <PanelSection
        icon={<CalendarDays className="size-4" aria-hidden />}
        title={<T k="integration.holiday.title" />}
        subtitle={<T k="integration.holiday.subtitle" />}
      />

      <SettingsStack>
        <SettingsGroup
          title={<T k="integration.holiday.group" />}
          icon={<CalendarDays className="size-3.5" aria-hidden />}
          action={
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
              {lastSync.length > 0 ? formatDateTime(lastSync) : t('integration.holiday.never')}
            </span>
          }
        >
          <SettingRow
            label={<T k="integration.holiday.enabled" />}
            hint={<T k="integration.holiday.enabled.hint" />}
          >
            <Switch
              checked={enabled}
              onChange={setEnabled}
              label={t('integration.holiday.enabled')}
            />
          </SettingRow>

          <SettingRow
            label={<T k="integration.holiday.autoSync" />}
            hint={<T k="integration.holiday.autoSync.hint" />}
          >
            <Switch
              checked={autoSync}
              onChange={setAutoSync}
              label={t('integration.holiday.autoSync')}
            />
          </SettingRow>

          <SettingRow
            label={<T k="integration.holiday.year" />}
            hint={<T k="integration.holiday.year.hint" />}
          >
            <SelectControl
              label={t('integration.holiday.year')}
              value={year}
              onChange={(event) => setYear(event.target.value)}
            >
              {yearOptions().map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </SelectControl>
          </SettingRow>

          <SettingRow
            label={<T k="integration.holiday.cache" />}
            hint={<T k="integration.holiday.cache.hint" />}
          >
            <input
              inputMode="numeric"
              value={cacheMinutes}
              onChange={(event) => setCacheMinutes(event.target.value.replace(/\D/g, ''))}
              aria-label={t('integration.holiday.cache')}
              className="w-28 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800"
            />
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="integration.holiday.offices" />}
          icon={<MapPin className="size-3.5" aria-hidden />}
          action={
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
              <T k="integration.holiday.offices.count" vars={{ count: states.length }} />
            </span>
          }
        >
          <div className="my-2 space-y-3">
            {/*
              Sixteen checkboxes rather than a multi-select, because the whole set is short enough to
              show and the question is "which of these do we have an office in" — answered by
              looking down a list, not by opening one.
            */}
            <div className="grid gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
              {STATES.map((state) => (
                <label
                  key={state.code}
                  className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={states.includes(state.code)}
                    onChange={(event) =>
                      setStates((current) =>
                        event.target.checked
                          ? [...current, state.code]
                          : current.filter((code) => code !== state.code),
                      )
                    }
                  />
                  {state.label}
                </label>
              ))}
            </div>

            <PanelNote icon={<MapPin className="size-3.5" aria-hidden />}>
              <T k="integration.holiday.offices.note" />
            </PanelNote>

            {/*
              The one caveat that costs money if it is missed, so it is a warn strip and not a hint.
              The library's "national" list includes days some states do not gazette.
            */}
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="integration.holiday.offices.warning" />
            </PanelNote>

            <PanelNote icon={<CalendarDays className="size-3.5" aria-hidden />}>
              <T
                k="integration.holiday.managed"
                vars={{
                  link: (
                    <Link
                      to="/jadual/cuti-umum"
                      className="text-brand-600 font-medium hover:underline"
                    >
                      <T k="integration.holiday.managed.link" />
                    </Link>
                  ),
                }}
              />
            </PanelNote>
          </div>
        </SettingsGroup>
      </SettingsStack>

      <PanelActions
        hint={<T k="integration.holiday.timezone" vars={{ timezone: data.environment.timezone }} />}
      >
        <Button
          onClick={() =>
            void save({
              'integration.holidays.enabled': enabled,
              'integration.holidays.autoSync': autoSync,
              'integration.holidays.syncYear': Number(year),
              'integration.holidays.cacheMinutes': Number(cacheMinutes),
              'integration.holidays.includeStates': JSON.stringify(states),
            })
          }
          disabled={busy || states.length === 0}
        >
          <Save className="size-4" aria-hidden />
          <T k="settings.save" />
        </Button>
      </PanelActions>

      <PanelSection
        title={
          <T
            k="integration.holiday.list.title"
            vars={{ year: listYear, count: list?.rows.length ?? 0 }}
          />
        }
        subtitle={
          (list?.hidden ?? 0) > 0 ? (
            <T k="integration.holiday.list.hidden" vars={{ count: list?.hidden ?? 0 }} />
          ) : undefined
        }
        /*
          One action, which is what this slot is for.
          The year and the scope were in here too, three controls deep, and `PanelSection` is itself
          a wrapping flex container — so the cluster broke onto a line each and rendered as a
          vertical stack. They are filters, so they belong in `FilterRow` below, which is where every
          other screen in this application puts them.
        */
        action={
          <Button
            onClick={() => void runSync()}
            disabled={syncing || busy || dirtyStates}
            title={dirtyStates ? t('integration.holiday.dirty') : undefined}
          >
            {syncing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-4" aria-hidden />
            )}
            {/*
              No year on the label. The year facet below is what it acts on, so repeating the number
              would say the same thing twice — and while the button was wired to the settings year
              instead, the two could disagree outright.
            */}
            <T k="integration.holiday.sync" />
          </Button>
        }
      />

      {/*
        No search box: this list is at most a few dozen rows a year and nobody scans it by name. A
        box that accepts typing and filters nothing teaches the operator the screen is broken.
      */}
      <FilterRow
        dirty={showAll || listYear !== String(new Date().getFullYear())}
        onReset={() => {
          setShowAll(false);
          setListYear(String(new Date().getFullYear()));
        }}
      >
        {/*
          `SelectControl`, not `FacetSelect`. The latter prepends a blank option as its own label,
          which is right for a filter where empty means "no filter" — but both of these always hold
          a value, so a blank entry would be a selectable state that breaks the list.
        */}
        <SelectControl
          label={t('integration.holiday.list.year')}
          value={listYear}
          onChange={(event) => setListYear(event.target.value)}
        >
          {yearOptions().map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </SelectControl>
        <SelectControl
          label={t('integration.holiday.list.scope')}
          value={showAll ? 'all' : 'offices'}
          onChange={(event) => setShowAll(event.target.value === 'all')}
        >
          <option value="offices">{t('integration.holiday.list.scope.offices')}</option>
          <option value="all">{t('integration.holiday.list.scope.all')}</option>
        </SelectControl>
      </FilterRow>

      {(listError !== null || listNotice !== null || dirtyStates) && (
        <PanelBody className="pb-0">
          {dirtyStates && (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="integration.holiday.dirty" />
            </PanelNote>
          )}
          <Feedback error={listError} notice={listNotice} />
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={false}
        rowCount={list?.rows.length ?? 0}
        empty={<T k="integration.holiday.list.empty" />}
        columns={[
          { header: <T k="integration.holiday.column.date" />, width: 'w-32' },
          { header: <T k="integration.holiday.column.day" />, width: 'w-28' },
          { header: <T k="integration.holiday.column.name" /> },
          { header: <T k="integration.holiday.column.type" />, width: 'w-28' },
          { header: <T k="integration.holiday.column.states" />, width: 'w-48' },
        ]}
      >
        {(list?.rows ?? []).map((row) => (
          <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/70">
            {/* `formatDateOnly`, not `formatDate`: these are calendar dates with no zone. */}
            <td className="px-5 py-2.5 text-xs tabular-nums text-slate-700">
              {formatDateOnly(row.date)}
            </td>
            <td className="px-2 py-2.5 text-xs text-slate-500">{weekdayOf(row.date)}</td>
            <td className="px-2 py-2.5 text-sm font-medium text-slate-800">{row.name}</td>
            {/*
              "Semua pejabat" rather than "Kebangsaan". The distinction is real: this list only ever
              holds days the selected states gazette, so a day every office observes is not
              necessarily federal — and calling it federal would be a claim the data cannot support.
            */}
            <td className="px-2 py-2.5">
              <Badge
                tone={row.companyDeclared ? 'warning' : row.allOffices ? 'success' : 'info'}
              >
                <T
                  k={
                    row.companyDeclared
                      ? 'integration.holiday.type.company'
                      : row.allOffices
                        ? 'integration.holiday.type.national'
                        : 'integration.holiday.type.state'
                  }
                />
              </Badge>
            </td>
            <td className="px-2 py-2.5 text-xs text-slate-600">
              {row.allOffices ? (
                <T k="integration.holiday.allStates" />
              ) : (
                row.states.map((code) => stateLabel(code)).join(', ')
              )}
            </td>
          </tr>
        ))}
      </RecordTable>
    </>
  );
}

/** Two years back, three forward — the range somebody realistically syncs. */
function yearOptions(): string[] {
  const now = new Date().getFullYear();
  const out: string[] = [];
  for (let year = now - 2; year <= now + 3; year += 1) out.push(String(year));
  return out;
}

/**
 * Weekday name for a calendar date.
 *
 * Built from the date parts rather than parsed as an instant: `new Date(iso)` on a date-only value
 * lands on the previous day for anyone west of the server, and the day name would be wrong by one.
 */
function weekdayOf(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return '—';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'long',
    timeZone: 'UTC',
  });
}
