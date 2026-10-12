import { ArrowRight, FileClock, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { LabelKey } from '@attendance/shared';

import { Feedback } from '../components/Dialog';
import {
  ChipBar,
  DateBox,
  Detail,
  DetailGrid,
  ExpandButton,
  FacetSelect,
  FilterRow,
  PanelBody,
  PanelCard,
  PanelFooter,
  PanelSection,
  PanelTabs,
  RecordTable,
  RowActions,
} from '../components/RecordPanel';
import { Badge } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { formatDateTime } from '../lib/operations-api';
import {
  AUDIT_ACTION_LABELS,
  CATEGORY_LABELS,
  ENTITY_LABELS,
  LEVEL_LABELS,
  SOURCE_LABELS,
  logsApi,
  type ActivityFilters,
  type ActivityLogPage,
  type ActivityLogRow,
  type ActorFacet,
  type AuditFilters,
  type AuditLogPage,
  type AuditLogRow,
  type LogLevel,
} from '../lib/settings-api';
import { T, TEnum, useLabels } from '../lib/translation';

const ACTIVITY_SCREEN = 'settings.logs.activity';
const AUDIT_SCREEN = 'settings.logs.audit';

/** Counts read as numbers, not digit strings: "12,480 entri" rather than "12480 entri". */
const COUNT = new Intl.NumberFormat('ms-MY');

/**
 * Activity and audit logs.
 *
 * Two logs kept apart on purpose. Activity records what people did, including
 * reads. Audit records what changed and to what. Merged into one stream, the
 * handful of entries that actually settle a payroll dispute sit buried under
 * thousands of logins.
 *
 * Each is its own permission, so each tab is offered only to somebody who can open it — a tab
 * that answers 403 teaches people the log is broken rather than that it is not theirs to read.
 */
export function LogsPage(): ReactNode {
  const { t } = useLabels();
  const { can } = useAuth();

  const tabs = [
    ...(can(ACTIVITY_SCREEN, 'view')
      ? [
          {
            id: 'activity',
            label: <T k="logs.tab.activity" />,
            labelText: t('logs.tab.activity'),
            icon: <FileClock className="size-4" aria-hidden />,
          },
        ]
      : []),
    ...(can(AUDIT_SCREEN, 'view')
      ? [
          {
            id: 'audit',
            label: <T k="logs.tab.audit" />,
            labelText: t('logs.tab.audit'),
            icon: <ShieldCheck className="size-4" aria-hidden />,
          },
        ]
      : []),
  ];

  const [chosen, setChosen] = useState<string | null>(null);
  // The first tab this account can open, until one is chosen.
  const tab = chosen ?? tabs[0]?.id ?? 'activity';

  return (
    <PanelCard title={<T k="logs.title" />} subtitle={<T k="logs.subtitle" />}>
      <PanelTabs label={t('logs.tabs.aria')} active={tab} onChange={setChosen} tabs={tabs} />

      {tab === 'activity' ? <ActivityPanel /> : <AuditPanel />}
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

const LEVEL_DOT: Record<LogLevel, string> = {
  info: 'bg-sky-500',
  warn: 'bg-amber-500',
  error: 'bg-rose-500',
  debug: 'bg-slate-400',
};

/** Severity, so `danger` and `warning` mean what they mean everywhere else. */
const LEVEL_TONES: Record<LogLevel, 'info' | 'warning' | 'danger' | 'neutral'> = {
  info: 'info',
  warn: 'warning',
  error: 'danger',
  debug: 'neutral',
};

/**
 * Category is a coloured word, not a badge.
 *
 * There is one on every row, and forty stacked pills turn the column into a block
 * of colour that the eye cannot scan. Colour still groups them; weight does not.
 */
const CATEGORY_TEXT: Record<string, string> = {
  auth: 'text-indigo-600',
  attendance: 'text-teal-600',
  staff: 'text-blue-600',
  schedule: 'text-cyan-700',
  reports: 'text-violet-600',
  devices: 'text-fuchsia-700',
  users: 'text-blue-600',
  roles: 'text-purple-600',
  settings: 'text-amber-700',
  backup: 'text-emerald-700',
  retention: 'text-orange-700',
  system: 'text-slate-500',
};

function ActivityPanel(): ReactNode {
  const [filters, setFilters] = useState<ActivityFilters>({ page: 1, pageSize: 30 });
  const [search, setSearch] = useState('');
  const [data, setData] = useState<ActivityLogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const { t, tEnum } = useLabels();
  const { can } = useAuth();

  // Debounced so typing in the search box does not fire a query per keystroke.
  useEffect(() => {
    const timer = setTimeout(
      () => setFilters((current) => ({ ...current, search, page: 1 })),
      300,
    );
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await logsApi.activity(filters));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('logs.activity.error.load'));
    } finally {
      setLoading(false);
    }
  }, [filters, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = useCallback((patch: Partial<ActivityFilters>): void => {
    setFilters((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  }, []);

  const dirty =
    filters.level !== undefined ||
    filters.category !== undefined ||
    filters.source !== undefined ||
    filters.accountId !== undefined ||
    filters.from !== undefined ||
    filters.to !== undefined ||
    search.length > 0;

  return (
    <>
      <PanelSection
        title={
          <T k="logs.activity.count" vars={{ count: COUNT.format(data?.total ?? 0) }} />
        }
        subtitle={<T k="logs.activity.subtitle" />}
      />

      <ChipBar
        active={filters.level}
        onChange={(id) => set({ level: id as LogLevel | undefined })}
        chips={(Object.keys(LEVEL_LABELS) as LogLevel[]).map((level) => ({
          id: level,
          label: <T k={LEVEL_LABELS[level]} />,
          count: data?.levels[level] ?? 0,
          dot: LEVEL_DOT[level],
        }))}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('logs.activity.search')}
        dirty={dirty}
        onReset={() => {
          setSearch('');
          setFilters({ page: 1, pageSize: filters.pageSize });
        }}
        // Hidden without the grant: an export that answers 403 reads as a broken report.
        {...(can(ACTIVITY_SCREEN, 'export')
          ? { exportUrl: logsApi.activityExportUrl(filters) }
          : {})}
      >
        {/* `<option>` cannot hold a node, so every facet label resolves to plain text. */}
        <FacetSelect
          label={t('logs.filter.allCategories')}
          value={filters.category ?? ''}
          onChange={(value) => set({ category: value === '' ? undefined : value })}
          options={(data?.categories ?? []).map((facet) => ({
            value: facet.key,
            label: t('logs.facet.withCount', {
              label: tEnum(CATEGORY_LABELS[facet.key], facet.key),
              count: facet.count,
            }),
          }))}
        />
        <FacetSelect
          label={t('logs.filter.allSources')}
          value={filters.source ?? ''}
          onChange={(value) => set({ source: value === '' ? undefined : value })}
          options={Object.entries(SOURCE_LABELS).map(([value, key]) => ({
            value,
            label: tEnum(key, value),
          }))}
        />
        <ActorSelect
          actors={data?.actors ?? []}
          value={filters.accountId}
          onChange={(accountId) => set({ accountId })}
        />
        <DateBox
          label={t('filter.from')}
          value={filters.from ?? ''}
          onChange={(from) => set({ from: from || undefined })}
        />
        <DateBox
          label={t('filter.to')}
          value={filters.to ?? ''}
          onChange={(to) => set({ to: to || undefined })}
        />
      </FilterRow>

      {error !== null && (
        <PanelBody className="pb-0">
          <Feedback error={error} />
        </PanelBody>
      )}

      <RecordTable
        framed
        columns={[
          { header: <T k="logs.activity.column.time" />, width: 'w-40' },
          { header: <T k="logs.activity.column.level" />, width: 'w-24' },
          { header: <T k="logs.activity.column.category" />, width: 'w-36' },
          { header: <T k="logs.activity.column.message" /> },
          { header: <T k="logs.activity.column.actor" />, width: 'w-48' },
          { header: <T k="logs.activity.column.ip" />, width: 'w-32' },
          // The expander column has no heading: the control names itself.
          { header: '', width: 'w-12' },
        ]}
        loading={loading}
        empty={<T k="logs.activity.empty" />}
        rowCount={data?.rows.length ?? 0}
      >
        {(data?.rows ?? []).map((row) => (
          <ActivityRow
            key={row.id}
            row={row}
            expanded={open === row.id}
            onToggle={() => setOpen(open === row.id ? null : row.id)}
          />
        ))}
      </RecordTable>

      <PanelFooter
        shown={data?.rows.length ?? 0}
        total={data?.total ?? 0}
        page={filters.page}
        pageSize={filters.pageSize}
        generatedAt={data?.generatedAt}
        loading={loading}
        onPage={(page) => setFilters((current) => ({ ...current, page }))}
        onPageSize={(pageSize) => set({ pageSize })}
        onRefresh={() => void load()}
      />
    </>
  );
}

function ActivityRow({
  row,
  expanded,
  onToggle,
}: {
  row: ActivityLogRow;
  expanded: boolean;
  onToggle: () => void;
}): ReactNode {
  const { t } = useLabels();

  return (
    <>
      <tr
        className={cn(
          'border-b border-slate-100',
          expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
          // Tinted by severity, so a failure in a page of logins is found before it is read.
          !expanded && row.level === 'error' && 'bg-rose-50/40',
          !expanded && row.level === 'warn' && 'bg-amber-50/40',
        )}
      >
        <td className="px-5 py-2 text-xs whitespace-nowrap tabular-nums text-slate-600">
          {formatDateTime(row.createdAt)}
        </td>
        <td className="px-2 py-2">
          <Badge tone={LEVEL_TONES[row.level] ?? 'neutral'} className="uppercase">
            <T k={LEVEL_LABELS[row.level]} />
          </Badge>
        </td>
        <td className="px-2 py-2">
          <span className={cn('text-xs font-medium', CATEGORY_TEXT[row.category] ?? 'text-slate-500')}>
            <TEnum k={CATEGORY_LABELS[row.category]} fallback={row.category} />
          </span>
        </td>
        <td className="px-2 py-2 text-slate-700">
          <span className="line-clamp-1">{row.detail ?? row.action}</span>
        </td>
        {/* Truncated with the full value in the tooltip: emails are long and the
            column has to stay narrow enough to leave the message room. */}
        <td className="px-2 py-2 text-xs text-slate-500" title={row.actorLabel}>
          <span className="block max-w-44 truncate">{row.actorLabel}</span>
        </td>
        <td className="px-2 py-2 font-mono text-xs text-slate-500">{row.ipAddress ?? '—'}</td>
        <td className="px-2 py-2 pr-4">
          <RowActions>
            <ExpandButton
              expanded={expanded}
              onClick={onToggle}
              label={t('logs.activity.row.expand')}
            />
          </RowActions>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={7} className="px-5 py-3">
            <DetailGrid>
              <Detail label={<T k="logs.activity.detail.action" />} value={row.action} mono />
              <Detail
                label={<T k="logs.activity.detail.source" />}
                value={<TEnum k={SOURCE_LABELS[row.source]} fallback={row.source} />}
              />
              <Detail label={<T k="logs.activity.detail.path" />} value={row.path ?? '—'} mono />
              <Detail label={<T k="logs.activity.detail.entryId" />} value={row.id} mono />
              <Detail
                label={<T k="logs.activity.detail.accountId" />}
                value={
                  row.accountId === null ? (
                    <T k="logs.activity.detail.system" />
                  ) : (
                    String(row.accountId)
                  )
                }
              />
              <Detail label={<T k="logs.activity.detail.fullTime" />} value={row.createdAt} mono />
            </DetailGrid>
            {/* The whole message, which the row clamps to one line. Inside a `dl`, as a `dt`
                and `dd` have to be. */}
            {row.detail !== null && (
              <dl className="mt-3 border-t border-slate-200 pt-2 text-sm">
                <Detail label={<T k="logs.activity.detail.message" />} value={row.detail} />
              </dl>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

const ACTION_DOT: Record<string, string> = {
  create: 'bg-emerald-500',
  update: 'bg-amber-500',
  delete: 'bg-rose-500',
};

const ACTION_TONES: Record<string, 'success' | 'warning' | 'danger'> = {
  create: 'success',
  update: 'warning',
  delete: 'danger',
};

function AuditPanel(): ReactNode {
  const [filters, setFilters] = useState<AuditFilters>({ page: 1, pageSize: 30 });
  const [search, setSearch] = useState('');
  const [data, setData] = useState<AuditLogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const { t, tEnum } = useLabels();
  const { can } = useAuth();

  useEffect(() => {
    const timer = setTimeout(
      () => setFilters((current) => ({ ...current, search, page: 1 })),
      300,
    );
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await logsApi.audit(filters));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('logs.audit.error.load'));
    } finally {
      setLoading(false);
    }
  }, [filters, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = useCallback((patch: Partial<AuditFilters>): void => {
    setFilters((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  }, []);

  const dirty =
    filters.action !== undefined ||
    filters.entityType !== undefined ||
    filters.accountId !== undefined ||
    filters.from !== undefined ||
    filters.to !== undefined ||
    search.length > 0;

  return (
    <>
      {/*
        The append-only fact is the tab's description rather than a strip under the filters. It is
        what this log is, and it explains the `[redacted]` values somebody meets in the expansion.
      */}
      <PanelSection
        title={<T k="logs.audit.count" vars={{ count: COUNT.format(data?.total ?? 0) }} />}
        subtitle={
          <T
            k="logs.audit.appendOnly"
            vars={{
              redacted: (
                <code className="font-mono">
                  <T k="logs.audit.redacted" />
                </code>
              ),
            }}
          />
        }
      />

      <ChipBar
        active={filters.action}
        onChange={(id) => set({ action: id })}
        chips={['create', 'update', 'delete'].map((action) => ({
          id: action,
          label: <TEnum k={AUDIT_ACTION_LABELS[action]} fallback={action} />,
          count: data?.actions[action] ?? 0,
          dot: ACTION_DOT[action] ?? 'bg-slate-400',
        }))}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('logs.audit.search')}
        dirty={dirty}
        onReset={() => {
          setSearch('');
          setFilters({ page: 1, pageSize: filters.pageSize });
        }}
        {...(can(AUDIT_SCREEN, 'export') ? { exportUrl: logsApi.auditExportUrl(filters) } : {})}
      >
        <FacetSelect
          label={t('logs.filter.allEntities')}
          value={filters.entityType ?? ''}
          onChange={(value) => set({ entityType: value === '' ? undefined : value })}
          options={(data?.entityTypes ?? []).map((facet) => ({
            value: facet.key,
            label: t('logs.facet.withCount', {
              label: tEnum(ENTITY_LABELS[facet.key], facet.key),
              count: facet.count,
            }),
          }))}
        />
        <ActorSelect
          actors={data?.actors ?? []}
          value={filters.accountId}
          onChange={(accountId) => set({ accountId })}
        />
        <DateBox
          label={t('filter.from')}
          value={filters.from ?? ''}
          onChange={(from) => set({ from: from || undefined })}
        />
        <DateBox
          label={t('filter.to')}
          value={filters.to ?? ''}
          onChange={(to) => set({ to: to || undefined })}
        />
      </FilterRow>

      {error !== null && (
        <PanelBody className="pb-0">
          <Feedback error={error} />
        </PanelBody>
      )}

      <RecordTable
        framed
        columns={[
          { header: <T k="logs.activity.column.time" />, width: 'w-40' },
          { header: <T k="logs.audit.column.action" />, width: 'w-28' },
          { header: <T k="logs.audit.column.record" />, width: 'w-44' },
          { header: <T k="logs.audit.column.changes" /> },
          { header: <T k="logs.audit.column.actor" />, width: 'w-48' },
          { header: <T k="logs.activity.column.ip" />, width: 'w-32' },
          // The expander column has no heading: the control names itself.
          { header: '', width: 'w-12' },
        ]}
        loading={loading}
        empty={<T k="logs.audit.empty" />}
        rowCount={data?.rows.length ?? 0}
      >
        {(data?.rows ?? []).map((row) => (
          <AuditRow
            key={row.id}
            row={row}
            expanded={open === row.id}
            onToggle={() => setOpen(open === row.id ? null : row.id)}
          />
        ))}
      </RecordTable>

      <PanelFooter
        shown={data?.rows.length ?? 0}
        total={data?.total ?? 0}
        page={filters.page}
        pageSize={filters.pageSize}
        generatedAt={data?.generatedAt}
        loading={loading}
        onPage={(page) => setFilters((current) => ({ ...current, page }))}
        onPageSize={(pageSize) => set({ pageSize })}
        onRefresh={() => void load()}
      />
    </>
  );
}

function AuditRow({
  row,
  expanded,
  onToggle,
}: {
  row: AuditLogRow;
  expanded: boolean;
  onToggle: () => void;
}): ReactNode {
  const { t } = useLabels();
  const fields = Object.entries(row.changes ?? {});

  return (
    <>
      <tr className={cn('border-b border-slate-100', expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70')}>
        <td className="px-5 py-2 text-xs whitespace-nowrap tabular-nums text-slate-600">
          {formatDateTime(row.createdAt)}
        </td>
        <td className="px-2 py-2">
          {/* Upper case comes from the class: `.toUpperCase()` on a translated word is not safe. */}
          <Badge tone={ACTION_TONES[row.action] ?? 'neutral'} className="uppercase">
            <TEnum k={AUDIT_ACTION_LABELS[row.action]} fallback={row.action} />
          </Badge>
        </td>
        <td className="px-2 py-2">
          <span className="block text-xs font-medium text-slate-700">
            <TEnum k={ENTITY_LABELS[row.entityType]} fallback={row.entityType} />
          </span>
          <span className="block font-mono text-[11px] text-slate-400">#{row.entityId}</span>
        </td>
        {/* One line in the row; the full before-and-after grid lives in the
            expansion, where it has the width to be read. */}
        <td className="px-2 py-2 text-xs text-slate-600">
          {fields.length === 0 ? (
            <span className="text-slate-400">—</span>
          ) : (
            <span className="line-clamp-1">
              {fields.map(([field]) => field).join(', ')}
              <span className="text-slate-400">
                {' '}
                <T k="logs.audit.fieldCount" vars={{ count: fields.length }} />
              </span>
            </span>
          )}
        </td>
        <td className="px-2 py-2 text-xs text-slate-500" title={row.actorLabel}>
          <span className="block max-w-44 truncate">{row.actorLabel}</span>
        </td>
        <td className="px-2 py-2 font-mono text-xs text-slate-500">{row.ipAddress ?? '—'}</td>
        <td className="px-2 py-2 pr-4">
          <RowActions>
            <ExpandButton expanded={expanded} onClick={onToggle} label={t('logs.audit.row.expand')} />
          </RowActions>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={7} className="px-5 py-3">
            {fields.length === 0 ? (
              <p className="text-xs text-slate-500">
                <T k="logs.audit.noFields" />
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left tracking-wide text-slate-500 uppercase">
                      <th scope="col" className="px-3 py-1.5 font-medium">
                        <T k="logs.audit.change.field" />
                      </th>
                      <th scope="col" className="px-3 py-1.5 font-medium">
                        <T k="logs.audit.change.before" />
                      </th>
                      <th scope="col" className="w-6 py-1.5">
                        <span className="sr-only">{t('logs.audit.change.becomes')}</span>
                      </th>
                      <th scope="col" className="px-3 py-1.5 font-medium">
                        <T k="logs.audit.change.after" />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map(([field, movement]) => (
                      <tr key={field} className="border-b border-slate-100 last:border-0">
                        <th scope="row" className="px-3 py-1.5 text-left font-medium text-slate-600">
                          {field}
                        </th>
                        <td className="px-3 py-1.5">
                          <code className="rounded bg-rose-50 px-1.5 py-0.5 break-all text-rose-800">
                            {renderValue(movement.before, t)}
                          </code>
                        </td>
                        <td className="py-1.5 text-center">
                          <ArrowRight
                            className="inline size-3 text-slate-400"
                            aria-label={t('logs.audit.change.becomes')}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <code className="rounded bg-emerald-50 px-1.5 py-0.5 break-all text-emerald-800">
                            {renderValue(movement.after, t)}
                          </code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-3">
              <DetailGrid>
                <Detail label={<T k="logs.audit.detail.reason" />} value={row.reason ?? '—'} />
                <Detail label={<T k="logs.activity.detail.entryId" />} value={row.id} mono />
                <Detail
                  label={<T k="logs.activity.detail.accountId" />}
                  value={
                    row.accountId === null ? (
                      <T k="logs.activity.detail.system" />
                    ) : (
                      String(row.accountId)
                    )
                  }
                />
              </DetailGrid>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Users who actually appear in the log, ordered by how often. */
function ActorSelect({
  actors,
  value,
  onChange,
}: {
  actors: ActorFacet[];
  value: number | undefined;
  onChange: (accountId: number | undefined) => void;
}): ReactNode {
  const { t } = useLabels();

  return (
    <FacetSelect
      label={t('logs.filter.allActors')}
      value={value === undefined ? '' : String(value)}
      onChange={(next) => onChange(next === '' ? undefined : Number(next))}
      options={actors.map((actor) => ({
        value: String(actor.accountId),
        // The actor's own name is data; only the count wrapper is wording.
        label: t('logs.facet.withCount', { label: actor.label, count: actor.count }),
      }))}
      className="min-w-40"
    />
  );
}

/**
 * Compact one-line rendering of any stored JSON value.
 *
 * Takes `t` because it is a plain function. `∅` is a symbol rather than a word, so it is not
 * a label; the two booleans are words and are.
 */
function renderValue(value: unknown, t: (key: LabelKey) => string): string {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'boolean') return t(value ? 'logs.value.true' : 'logs.value.false');
  if (typeof value === 'object') {
    const text = JSON.stringify(value);
    return text.length > 200 ? `${text.slice(0, 197)}…` : text;
  }
  const text = String(value);
  return text.length === 0 ? '∅' : text;
}
