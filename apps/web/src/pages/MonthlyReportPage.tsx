import { Building2, TriangleAlert, UserRound } from 'lucide-react';
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { Feedback } from '../components/Dialog';
import {
  DateBox,
  Detail,
  DetailGrid,
  ExpandButton,
  FacetSelect,
  FilterRow,
  PanelBody,
  PanelCard,
  PanelFooter,
  PanelNote,
  PanelSection,
  PanelTabs,
  RecordTable,
  RowActions,
} from '../components/RecordPanel';
import { StatTile } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { EXCEPTION_LABELS, lookupsApi, todayIso, type Lookups } from '../lib/operations-api';
import {
  formatHours,
  monthRange,
  reportsApi,
  type DepartmentTotal,
  type MonthlyReport,
  type MonthlyRow,
} from '../lib/reports-api';
import { intlLocale, T, useLabels } from '../lib/translation';

const SCREEN = 'reports.monthly';

/**
 * Monthly attendance summary.
 *
 * Every figure here is derived from `AttendanceRecord`, which is itself derived from the immutable
 * raw log. The unresolved-exception count travels with the report rather than sitting on another
 * screen, because a summary that looks complete while ten days are still unsettled is a summary
 * somebody will act on.
 *
 * Two subjects — people and departments — so two tabs over one read. The filters and the totals
 * are shared, because the department subtotals are computed over the same filtered set and have
 * to add up to the same organisation figure.
 */
export function MonthlyReportPage(): ReactNode {
  const { can } = useAuth();
  const { t, tEnum, locale } = useLabels();
  const thisMonth = todayIso().slice(0, 7);
  const [tab, setTab] = useState('staff');
  const [month, setMonth] = useState(thisMonth);
  const [departmentId, setDepartmentId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [data, setData] = useState<MonthlyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    void lookupsApi
      .load()
      .then(setLookups)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const range = monthRange(year, monthNumber - 1);
  const filters = {
    from: range.from,
    to: range.to,
    departmentId: departmentId ? Number(departmentId) : undefined,
    locationId: locationId ? Number(locationId) : undefined,
    search: debounced.length > 0 ? debounced : undefined,
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await reportsApi.monthly({ ...filters, page, pageSize }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('monthly.error.load'));
    } finally {
      setLoading(false);
    }
    // The filter object is rebuilt each render; its parts are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, departmentId, locationId, debounced, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const intl = intlLocale(locale);
  const number = new Intl.NumberFormat(intl);
  // From `Intl`, so already in the reader's language — not a label.
  const monthName = new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString(intl, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const org = data?.organisation;
  const unresolved = data?.unresolvedExceptions.total ?? 0;
  const departments = data?.byDepartment ?? [];

  return (
    <PanelCard title={<T k="monthly.title" />} subtitle={<T k="monthly.subtitle" />}>
      <PanelTabs
        label={t('monthly.tabs.aria')}
        active={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'staff',
            label: <T k="monthly.tab.staff" />,
            labelText: t('monthly.tab.staff'),
            icon: <UserRound className="size-4" aria-hidden />,
            count: data?.total,
          },
          {
            id: 'departments',
            label: <T k="monthly.tab.departments" />,
            labelText: t('monthly.tab.departments'),
            icon: <Building2 className="size-4" aria-hidden />,
            count: data === null ? undefined : departments.length,
          },
        ]}
      />

      {tab === 'staff' ? (
        <PanelSection
          title={<T k="monthly.count" vars={{ count: number.format(data?.total ?? 0) }} />}
          subtitle={
            <T
              k="monthly.period"
              vars={{ month: monthName, days: data?.period.workingDays ?? 0 }}
            />
          }
        />
      ) : (
        <PanelSection
          title={<T k="monthly.byDept.count" vars={{ count: departments.length }} />}
          subtitle={<T k="monthly.byDept.subtitle" vars={{ month: monthName }} />}
        />
      )}

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('staff.search')}
        dirty={
          search.length > 0 ||
          departmentId.length > 0 ||
          locationId.length > 0 ||
          month !== thisMonth
        }
        onReset={() => {
          setSearch('');
          setDepartmentId('');
          setLocationId('');
          setMonth(thisMonth);
          setPage(1);
        }}
        // The file is one row per person, so it belongs to the people tab. Reading the summary and
        // producing a file are separate grants: the control is absent rather than present and refused.
        {...(tab === 'staff' && can(SCREEN, 'export')
          ? { exportUrl: reportsApi.monthlyExportUrl(filters) }
          : {})}
      >
        <FacetSelect
          label={t('staff.filter.allDepartments')}
          value={departmentId}
          onChange={(value) => {
            setDepartmentId(value);
            setPage(1);
          }}
          options={(lookups?.departments ?? []).map((row) => ({
            value: String(row.id),
            label: row.name,
          }))}
        />
        <FacetSelect
          label={t('staff.filter.allLocations')}
          value={locationId}
          onChange={(value) => {
            setLocationId(value);
            setPage(1);
          }}
          options={(lookups?.locations ?? []).map((row) => ({
            value: String(row.id),
            label: row.name,
          }))}
        />
        <DateBox
          type="month"
          label={t('app.month')}
          value={month}
          onChange={(value) => {
            // A cleared month box would leave the report with no period at all.
            if (/^\d{4}-\d{2}$/.test(value)) {
              setMonth(value);
              setPage(1);
            }
          }}
        />
      </FilterRow>

      {/* The totals for whatever the filters above select, so they sit under them. */}
      <PanelBody className="space-y-4 pb-0">
        <Feedback error={error} />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile
            label={<T k="monthly.stat.presentDays" />}
            value={number.format(org?.presentDays ?? 0)}
            hint={
              <T
                k="monthly.stat.presentDays.hint"
                vars={{ total: number.format(org?.scheduledDays ?? 0) }}
              />
            }
            tone="success"
          />
          <StatTile
            label={<T k="monthly.stat.lateDays" />}
            value={number.format(org?.lateDays ?? 0)}
            hint={
              <T
                k="monthly.stat.lateDays.hint"
                vars={{ hours: formatHours(org?.lateMinutes ?? 0) }}
              />
            }
            tone={(org?.lateDays ?? 0) > 0 ? 'warning' : 'neutral'}
          />
          <StatTile
            label={<T k="monthly.stat.absentDays" />}
            value={number.format(org?.absentDays ?? 0)}
            tone={(org?.absentDays ?? 0) > 0 ? 'danger' : 'neutral'}
          />
          <StatTile
            label={<T k="monthly.stat.workedHours" />}
            value={formatHours(org?.workedMinutes ?? 0)}
            hint={
              <T
                k="monthly.stat.workedHours.hint"
                vars={{ hours: formatHours(org?.overtimeMinutes ?? 0) }}
              />
            }
          />
          <StatTile
            label={<T k="monthly.stat.incompleteDays" />}
            value={number.format(org?.incompleteDays ?? 0)}
            hint={<T k="monthly.stat.incompleteDays.hint" />}
            tone={(org?.incompleteDays ?? 0) > 0 ? 'warning' : 'neutral'}
          />
        </div>

        {/*
          The one note: the caveat sits with the figures, not on another screen. An incomplete day
          is a short day, and a short day is short pay.
        */}
        {unresolved > 0 && (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            {/*
              One sentence with three slots rather than prose broken around a `<strong>`, a
              conditional clause and a `<Link>`. Splitting it would fix where each piece sits, and in
              another language they do not sit there.
            */}
            <T
              k="monthly.unresolved.note"
              vars={{
                emphasis: (
                  <strong className="font-medium">
                    <T k="monthly.unresolved.count" vars={{ count: unresolved }} />
                  </strong>
                ),
                // Carries its own leading separator, so an unavailable breakdown leaves no
                // stranded dash.
                kinds:
                  data !== null && Object.keys(data.unresolvedExceptions.byKind).length > 0
                    ? ` — ${Object.entries(data.unresolvedExceptions.byKind)
                        .map(
                          ([kind, count]) =>
                            `${tEnum(EXCEPTION_LABELS[kind], kind)} (${String(count)})`,
                        )
                        .join(', ')}`
                    : '',
                link: (
                  <Link
                    to="/kehadiran/pengecualian"
                    className="text-brand-600 font-medium hover:underline"
                  >
                    <T k="monthly.unresolved.link" />
                  </Link>
                ),
              }}
            />
          </PanelNote>
        )}
      </PanelBody>

      {tab === 'staff' ? (
        <>
          <RecordTable
            framed
            loading={loading}
            rowCount={data?.rows.length ?? 0}
            empty={<T k="monthly.empty" />}
            columns={[
              { header: <T k="monthly.column.staff" /> },
              { header: <T k="monthly.column.department" />, width: 'w-40' },
              { header: <T k="monthly.column.present" />, width: 'w-20', align: 'right' },
              { header: <T k="monthly.column.late" />, width: 'w-20', align: 'right' },
              { header: <T k="monthly.column.absent" />, width: 'w-24', align: 'right' },
              { header: <T k="monthly.column.onLeave" />, width: 'w-20', align: 'right' },
              { header: <T k="monthly.column.workedHours" />, width: 'w-28', align: 'right' },
              { header: <T k="monthly.column.overtime" />, width: 'w-24', align: 'right' },
              { header: <T k="panel.column.actions" />, width: 'w-20', align: 'right' },
            ]}
          >
            {(data?.rows ?? []).map((row) => (
              <SummaryRow
                key={row.staff.id}
                row={row}
                expanded={open === row.staff.id}
                onToggle={() => setOpen(open === row.staff.id ? null : row.staff.id)}
              />
            ))}
          </RecordTable>

          <PanelFooter
            shown={data?.rows.length ?? 0}
            total={data?.total ?? 0}
            page={page}
            pageSize={pageSize}
            generatedAt={data?.generatedAt}
            loading={loading}
            onPage={setPage}
            onPageSize={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            onRefresh={() => void load()}
          />
        </>
      ) : (
        <>
          <RecordTable
            framed
            loading={loading}
            rowCount={departments.length}
            empty={<T k="monthly.byDept.empty" />}
            columns={[
              { header: <T k="monthly.column.department" /> },
              { header: <T k="monthly.column.staff" />, width: 'w-20', align: 'right' },
              { header: <T k="monthly.column.present" />, width: 'w-20', align: 'right' },
              { header: <T k="monthly.column.late" />, width: 'w-20', align: 'right' },
              { header: <T k="monthly.column.absent" />, width: 'w-24', align: 'right' },
              { header: <T k="monthly.byDept.column.incomplete" />, width: 'w-28', align: 'right' },
              { header: <T k="monthly.column.workedHours" />, width: 'w-28', align: 'right' },
              { header: <T k="monthly.byDept.column.exceptions" />, width: 'w-28', align: 'right' },
            ]}
          >
            {departments.map((row) => (
              <DepartmentRow key={row.departmentId ?? 'none'} row={row} />
            ))}
          </RecordTable>

          <PanelFooter
            shown={departments.length}
            total={departments.length}
            page={1}
            pageSize={Math.max(1, departments.length)}
            pageSizes={[Math.max(1, departments.length)]}
            generatedAt={data?.generatedAt}
            loading={loading}
            onPage={() => undefined}
            onPageSize={() => undefined}
            onRefresh={() => void load()}
          />
        </>
      )}
    </PanelCard>
  );
}

/** A count cell: zero is a dash, so the rows that differ are found by looking. */
function CountCell({ value, tone }: { value: number; tone: string }): ReactNode {
  return (
    <td className="px-2 py-2.5 text-right text-xs tabular-nums">
      {value === 0 ? <span className="text-slate-300">—</span> : <span className={tone}>{value}</span>}
    </td>
  );
}

function DepartmentRow({ row }: { row: DepartmentTotal }): ReactNode {
  return (
    <tr
      className={cn(
        'border-b border-slate-100 hover:bg-slate-50/70',
        (row.absentDays > 0 || row.openExceptions > 0) && 'bg-amber-50/40',
      )}
    >
      <td className="px-5 py-2.5 font-medium text-slate-800">{row.name}</td>
      <td className="px-2 py-2.5 text-right text-xs text-slate-600 tabular-nums">
        {row.staffCount}
      </td>
      <td className="px-2 py-2.5 text-right text-xs text-emerald-700 tabular-nums">
        {row.presentDays}
      </td>
      <CountCell value={row.lateDays} tone="text-amber-700" />
      <CountCell value={row.absentDays} tone="font-medium text-rose-700" />
      <CountCell value={row.incompleteDays} tone="text-orange-700" />
      <td className="px-2 py-2.5 text-right font-mono text-xs text-slate-700 tabular-nums">
        {formatHours(row.workedMinutes)}
      </td>
      <CountCell value={row.openExceptions} tone="font-medium text-amber-700" />
    </tr>
  );
}

function SummaryRow({
  row,
  expanded,
  onToggle,
}: {
  row: MonthlyRow;
  expanded: boolean;
  onToggle: () => void;
}): ReactNode {
  const { t } = useLabels();
  const problem = row.absentDays > 0 || row.incompleteDays > 0 || row.openExceptions > 0;
  // A person with no records at all in the period usually cannot scan rather than did not work,
  // so it reads differently from a zero.
  const noRecords = row.scheduledDays === 0 && row.leaveDays === 0 && row.restDays === 0;

  return (
    <Fragment>
      <tr
        className={cn(
          'border-b border-slate-100',
          expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
          problem && !expanded && 'bg-amber-50/40',
          noRecords && !expanded && 'bg-rose-50/40',
        )}
      >
        <td className="px-5 py-2.5">
          <span className="block font-medium text-slate-800">{row.staff.fullName}</span>
          <span className="block font-mono text-[11px] text-slate-400">{row.staff.employeeNo}</span>
        </td>
        <td className="px-2 py-2.5 text-xs text-slate-600">{row.staff.department?.name ?? '—'}</td>
        <td className="px-2 py-2.5 text-right text-xs text-emerald-700 tabular-nums">
          {row.presentDays}
        </td>
        <CountCell value={row.lateDays} tone="text-amber-700" />
        <CountCell value={row.absentDays} tone="font-medium text-rose-700" />
        <CountCell value={row.leaveDays} tone="text-slate-600" />
        <td className="px-2 py-2.5 text-right font-mono text-xs text-slate-700 tabular-nums">
          {formatHours(row.workedMinutes)}
        </td>
        <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums">
          {row.overtimeMinutes === 0 ? (
            <span className="text-slate-300">—</span>
          ) : (
            <span className="text-emerald-700">{formatHours(row.overtimeMinutes)}</span>
          )}
        </td>
        <td className="px-2 py-2.5 pr-4">
          <RowActions>
            <ExpandButton expanded={expanded} onClick={onToggle} label={t('monthly.row.expand')} />
          </RowActions>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={9} className="px-5 py-3">
            <DetailGrid>
              <Detail
                label={<T k="monthly.detail.scheduledDays" />}
                value={String(row.scheduledDays)}
              />
              <Detail label={<T k="monthly.detail.presentDays" />} value={String(row.presentDays)} />
              <Detail label={<T k="monthly.detail.lateDays" />} value={String(row.lateDays)} />
              <Detail label={<T k="monthly.detail.absentDays" />} value={String(row.absentDays)} />
              <Detail
                label={<T k="monthly.detail.incompleteDays" />}
                value={String(row.incompleteDays)}
              />
              <Detail label={<T k="monthly.detail.leaveDays" />} value={String(row.leaveDays)} />
              <Detail label={<T k="monthly.detail.restDays" />} value={String(row.restDays)} />
              <Detail label={<T k="monthly.detail.holidayDays" />} value={String(row.holidayDays)} />
              <Detail
                label={<T k="monthly.detail.workedHours" />}
                value={formatHours(row.workedMinutes)}
              />
              <Detail label={<T k="monthly.detail.lateMinutes" />} value={String(row.lateMinutes)} />
              <Detail
                label={<T k="monthly.detail.earlyLeaveMinutes" />}
                value={String(row.earlyLeaveMinutes)}
              />
              <Detail
                label={<T k="monthly.detail.overtimeHours" />}
                value={formatHours(row.overtimeMinutes)}
              />
              <Detail
                label={<T k="monthly.detail.exceptions" />}
                value={String(row.openExceptions)}
              />
              <Detail label={<T k="staff.detail.location" />} value={row.staff.location?.name ?? '—'} />
              <Detail label={<T k="staff.detail.staffId" />} value={String(row.staff.id)} mono />
            </DetailGrid>

            {/*
              One note, the most serious that applies. Three stacked strips read as three problems
              of equal weight, when no records at all usually explains the other two.
            */}
            {noRecords ? (
              <PanelNote
                tone="danger"
                className="mt-3"
                icon={<TriangleAlert className="size-3.5" aria-hidden />}
              >
                <T k="monthly.detail.noRecords" />
              </PanelNote>
            ) : row.openExceptions > 0 ? (
              <PanelNote tone="warn" className="mt-3">
                <T k="monthly.detail.openExceptions" vars={{ count: row.openExceptions }} />
              </PanelNote>
            ) : row.incompleteDays > 0 ? (
              <PanelNote className="mt-3">
                <T k="monthly.detail.incompleteNote" vars={{ count: row.incompleteDays }} />
              </PanelNote>
            ) : null}
          </td>
        </tr>
      )}
    </Fragment>
  );
}
