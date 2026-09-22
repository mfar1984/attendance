import { ChevronLeft, ChevronRight, Download, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { Feedback } from '../components/Dialog';
import {
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
  RecordTable,
} from '../components/RecordPanel';
import { StatTile } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { EXCEPTION_LABELS, lookupsApi, type Lookups } from '../lib/operations-api';
import {
  formatHours,
  monthRange,
  reportsApi,
  type MonthlyReport,
  type MonthlyRow,
} from '../lib/reports-api';
import { T, useLabels } from '../lib/translation';

/**
 * Monthly attendance summary.
 *
 * Every figure here is derived from `AttendanceRecord`, which is itself derived from
 * the immutable raw log. The unresolved-exception count travels with the report rather
 * than sitting on another screen, because a summary that looks complete while ten days
 * are still unsettled is a summary somebody will act on.
 */
export function MonthlyReportPage(): ReactNode {
  const { can } = useAuth();
  const { t, tEnum } = useLabels();
  const now = new Date();
  const [month, setMonth] = useState({ year: now.getFullYear(), month: now.getMonth() });
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

  const range = monthRange(month.year, month.month);
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

  const monthName = new Date(month.year, month.month, 1).toLocaleDateString('ms-MY', {
    month: 'long',
    year: 'numeric',
  });

  const org = data?.organisation;
  const unresolved = data?.unresolvedExceptions.total ?? 0;

  return (
    <PanelCard title={<T k="monthly.title" />} subtitle={<T k="monthly.subtitle" />}>
      <PanelSection
        // The month name comes from `Intl`, so it is already in the reader's language.
        title={monthName}
        subtitle={
          data === null ? (
            <T k="monthly.loading" />
          ) : (
            <T
              k="monthly.section.subtitle"
              vars={{ staff: data.total, days: data.period.workingDays }}
            />
          )
        }
        action={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  setMonth(({ year, month: current }) =>
                    current === 0 ? { year: year - 1, month: 11 } : { year, month: current - 1 },
                  )
                }
                aria-label={t('roster.month.previous')}
                className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() =>
                  setMonth(({ year, month: current }) =>
                    current === 11 ? { year: year + 1, month: 0 } : { year, month: current + 1 },
                  )
                }
                aria-label={t('roster.month.next')}
                className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
            {/* Reading the summary and producing a file are separate grants, so the
                control is absent rather than present and refused. */}
            {can('reports.monthly', 'export') && (
              <a
                href={reportsApi.monthlyExportUrl(filters)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Download className="size-3.5" aria-hidden />
                <T k="monthly.export" />
              </a>
            )}
          </div>
        }
      />

      <PanelBody className="space-y-4">
        <Feedback error={error} />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile
            label={<T k="monthly.stat.presentDays" />}
            value={new Intl.NumberFormat('ms-MY').format(org?.presentDays ?? 0)}
            hint={
              <T
                k="monthly.stat.presentDays.hint"
                vars={{
                  total: new Intl.NumberFormat('ms-MY').format(org?.scheduledDays ?? 0),
                }}
              />
            }
            tone="success"
          />
          <StatTile
            label={<T k="monthly.stat.lateDays" />}
            value={new Intl.NumberFormat('ms-MY').format(org?.lateDays ?? 0)}
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
            value={new Intl.NumberFormat('ms-MY').format(org?.absentDays ?? 0)}
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
            value={new Intl.NumberFormat('ms-MY').format(org?.incompleteDays ?? 0)}
            hint={<T k="monthly.stat.incompleteDays.hint" />}
            tone={(org?.incompleteDays ?? 0) > 0 ? 'warning' : 'neutral'}
          />
        </div>

        {/*
          The caveat sits with the figures, not on another screen. An incomplete day is
          a short day, and a short day is short pay.
        */}
        {unresolved > 0 && (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            {/*
              One sentence with three slots rather than prose broken around a `<strong>`, a
              conditional clause and a `<Link>`. Splitting it would fix where each piece sits,
              and in another language they do not sit there.
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

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('staff.search')}
        dirty={search.length > 0 || departmentId.length > 0 || locationId.length > 0}
        onReset={() => {
          setSearch('');
          setDepartmentId('');
          setLocationId('');
          setPage(1);
        }}
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
      </FilterRow>

      <RecordTable
        loading={loading}
        rowCount={data?.rows.length ?? 0}
        empty={<T k="monthly.empty" />}
        columns={[
          { header: <T k="monthly.column.staff" /> },
          { header: <T k="monthly.column.department" />, width: 'w-40' },
          { header: <T k="monthly.column.present" />, width: 'w-20' },
          { header: <T k="monthly.column.late" />, width: 'w-20' },
          { header: <T k="monthly.column.absent" />, width: 'w-24' },
          { header: <T k="monthly.column.onLeave" />, width: 'w-20' },
          { header: <T k="monthly.column.workedHours" />, width: 'w-28' },
          { header: <T k="monthly.column.overtime" />, width: 'w-24' },
          { header: '', width: 'w-10' },
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

      {data !== null && data.byDepartment.length > 0 && (
        <>
          <PanelSection
            title={<T k="monthly.byDept.title" />}
            subtitle={<T k="monthly.byDept.subtitle" />}
          />

          <RecordTable
            loading={false}
            rowCount={data.byDepartment.length}
            empty={<T k="monthly.byDept.empty" />}
            columns={[
              { header: <T k="monthly.column.department" /> },
              { header: <T k="monthly.column.staff" />, width: 'w-20' },
              { header: <T k="monthly.column.present" />, width: 'w-20' },
              { header: <T k="monthly.column.late" />, width: 'w-20' },
              { header: <T k="monthly.column.absent" />, width: 'w-24' },
              { header: <T k="monthly.byDept.column.incomplete" />, width: 'w-28' },
              { header: <T k="monthly.column.workedHours" />, width: 'w-28' },
              { header: <T k="monthly.byDept.column.exceptions" />, width: 'w-28' },
            ]}
          >
            {data.byDepartment.map((row) => (
              <tr
                key={row.departmentId ?? 'none'}
                className={cn(
                  'border-b border-slate-100 hover:bg-slate-50/70',
                  row.absentDays > 0 && 'bg-rose-50/30',
                )}
              >
                <td className="px-5 py-2.5 font-medium text-slate-800">{row.name}</td>
                <td className="px-2 py-2.5 text-xs tabular-nums text-slate-600">{row.staffCount}</td>
                <td className="px-2 py-2.5 text-xs tabular-nums text-emerald-700">
                  {row.presentDays}
                </td>
                <td className="px-2 py-2.5 text-xs tabular-nums text-amber-700">{row.lateDays}</td>
                <td className="px-2 py-2.5 text-xs tabular-nums text-rose-700">{row.absentDays}</td>
                <td className="px-2 py-2.5 text-xs tabular-nums text-orange-700">
                  {row.incompleteDays}
                </td>
                <td className="px-2 py-2.5 font-mono text-xs tabular-nums text-slate-700">
                  {formatHours(row.workedMinutes)}
                </td>
                <td className="px-2 py-2.5 text-xs tabular-nums">
                  {row.openExceptions === 0 ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    <span className="font-medium text-amber-700">{row.openExceptions}</span>
                  )}
                </td>
              </tr>
            ))}
          </RecordTable>
        </>
      )}
    </PanelCard>
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
  // A person with no records at all in the period usually cannot scan rather than did
  // not work, so it reads differently from a zero.
  const noRecords = row.scheduledDays === 0 && row.leaveDays === 0 && row.restDays === 0;

  return (
    <>
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
          <span className="block font-mono text-[11px] text-slate-400">
            {row.staff.employeeNo}
          </span>
        </td>
        <td className="px-2 py-2.5 text-xs text-slate-600">{row.staff.department?.name ?? '—'}</td>
        <td className="px-2 py-2.5 text-xs tabular-nums text-emerald-700">{row.presentDays}</td>
        <td className="px-2 py-2.5 text-xs tabular-nums">
          {row.lateDays === 0 ? (
            <span className="text-slate-300">—</span>
          ) : (
            <span className="text-amber-700">{row.lateDays}</span>
          )}
        </td>
        <td className="px-2 py-2.5 text-xs tabular-nums">
          {row.absentDays === 0 ? (
            <span className="text-slate-300">—</span>
          ) : (
            <span className="font-medium text-rose-700">{row.absentDays}</span>
          )}
        </td>
        <td className="px-2 py-2.5 text-xs tabular-nums text-slate-600">
          {row.leaveDays === 0 ? <span className="text-slate-300">—</span> : row.leaveDays}
        </td>
        <td className="px-2 py-2.5 font-mono text-xs tabular-nums text-slate-700">
          {formatHours(row.workedMinutes)}
        </td>
        <td className="px-2 py-2.5 font-mono text-xs tabular-nums">
          {row.overtimeMinutes === 0 ? (
            <span className="text-slate-300">—</span>
          ) : (
            <span className="text-emerald-700">{formatHours(row.overtimeMinutes)}</span>
          )}
        </td>
        <td className="w-10 pr-4">
          <ExpandButton expanded={expanded} onClick={onToggle} label={t('monthly.row.expand')} />
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
              <Detail
                label={<T k="monthly.detail.presentDays" />}
                value={String(row.presentDays)}
              />
              <Detail label={<T k="monthly.detail.lateDays" />} value={String(row.lateDays)} />
              <Detail
                label={<T k="monthly.detail.absentDays" />}
                value={String(row.absentDays)}
              />
              <Detail
                label={<T k="monthly.detail.incompleteDays" />}
                value={String(row.incompleteDays)}
              />
              <Detail label={<T k="monthly.detail.leaveDays" />} value={String(row.leaveDays)} />
              <Detail label={<T k="monthly.detail.restDays" />} value={String(row.restDays)} />
              <Detail
                label={<T k="monthly.detail.holidayDays" />}
                value={String(row.holidayDays)}
              />
              <Detail
                label={<T k="monthly.detail.workedHours" />}
                value={formatHours(row.workedMinutes)}
              />
              <Detail
                label={<T k="monthly.detail.lateMinutes" />}
                value={String(row.lateMinutes)}
              />
              <Detail
                label={<T k="monthly.detail.earlyLeaveMinutes" />}
                value={String(row.earlyLeaveMinutes)}
              />
              <Detail
                label={<T k="monthly.detail.overtimeHours" />}
                value={formatHours(row.overtimeMinutes)}
              />
              <Detail
                label={<T k="staff.detail.location" />}
                value={row.staff.location?.name ?? '—'}
              />
              <Detail
                label={<T k="staff.detail.staffId" />}
                value={String(row.staff.id)}
                mono
              />
            </DetailGrid>

            {noRecords && (
              <PanelNote
                tone="danger"
                className="mt-3"
                icon={<TriangleAlert className="size-3.5" aria-hidden />}
              >
                <T k="monthly.detail.noRecords" />
              </PanelNote>
            )}

            {row.openExceptions > 0 && (
              <PanelNote tone="warn" className="mt-3">
                <T
                  k="monthly.detail.openExceptions"
                  vars={{ count: row.openExceptions }}
                />
              </PanelNote>
            )}

            {row.incompleteDays > 0 && (
              <PanelNote className="mt-3">
                <T
                  k="monthly.detail.incompleteNote"
                  vars={{ count: row.incompleteDays }}
                />
              </PanelNote>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
