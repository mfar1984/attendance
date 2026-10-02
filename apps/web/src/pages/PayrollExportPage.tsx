import type { LabelKey } from '@attendance/shared';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Download,
  TriangleAlert,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { Feedback } from '../components/Dialog';
import {
  DateBox,
  Detail,
  DetailGrid,
  ExpandButton,
  FacetSelect,
  FilterRow,
  PanelActions,
  PanelBody,
  PanelCard,
  PanelFooter,
  PanelNote,
  PanelSection,
  RecordTable,
  RowAction,
  RowActions,
} from '../components/RecordPanel';
import { Badge, StatTile } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { EXCEPTION_LABELS, lookupsApi, type Lookups } from '../lib/operations-api';
import {
  formatHours,
  monthRange,
  reportsApi,
  type PayrollPreview,
  type PeriodFilters,
} from '../lib/reports-api';
import { intlLocale, T, useLabels } from '../lib/translation';

const SCREEN = 'reports.payroll';

/**
 * The checks the server runs, whether they failed or not, and where each one is fixed.
 *
 * Listed even when clear: a check that only appears when it fails is a check nobody signs off
 * against. The link is offered only to somebody who can open the screen it points at — a link
 * that lands on a refusal teaches the operator the report is broken.
 */
const CHECKS: Array<{
  kind: string;
  labelKey: LabelKey;
  clearKey: LabelKey;
  fix: { to: string; screen: string; navKey: LabelKey };
}> = [
  {
    kind: 'unresolved_exceptions',
    labelKey: 'payroll.check.unresolvedExceptions',
    clearKey: 'payroll.check.unresolvedExceptions.clear',
    fix: {
      to: '/kehadiran/pengecualian',
      screen: 'attendance.exceptions',
      navKey: 'nav.attendance.exceptions',
    },
  },
  {
    kind: 'staff_without_records',
    labelKey: 'payroll.check.staffWithoutRecords',
    clearKey: 'payroll.check.staffWithoutRecords.clear',
    // Nobody with a record usually means nobody who can scan.
    fix: { to: '/staf/biometrik', screen: 'staff.biometrics', navKey: 'nav.staff.biometrics' },
  },
  {
    kind: 'pending_overtime',
    labelKey: 'payroll.check.pendingOvertime',
    clearKey: 'payroll.check.pendingOvertime.clear',
    fix: { to: '/hr/permohonan/lebih-masa', screen: 'hr.overtime', navKey: 'nav.hr.overtime' },
  },
  {
    kind: 'clock_drift',
    labelKey: 'payroll.check.clockDrift',
    clearKey: 'payroll.check.clockDrift.clear',
    fix: { to: '/tetapan/peranti', screen: 'settings.devices', navKey: 'nav.settings.devices' },
  },
];

interface CheckRow {
  kind: string;
  label: ReactNode;
  count: number;
  detail: ReactNode;
  fix: (typeof CHECKS)[number]['fix'] | null;
}

/**
 * Payroll export.
 *
 * The download is never blocked. Payroll has a deadline, and a screen that refuses to produce a
 * file until every exception is settled gets worked around by someone exporting from the database
 * directly, which is worse than exporting a file that states what is wrong with it.
 *
 * So the checks are stated instead: on this screen before the download, and again as comment rows
 * inside the CSV, because a spreadsheet gets forwarded and whoever opens it next never saw this
 * page.
 */
export function PayrollExportPage(): ReactNode {
  const { can } = useAuth();
  const { t, tEnum, locale } = useLabels();
  const navigate = useNavigate();
  const now = new Date();
  const initial = monthRange(now.getFullYear(), now.getMonth());

  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [departmentId, setDepartmentId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [data, setData] = useState<PayrollPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    void lookupsApi
      .load()
      .then(setLookups)
      .catch(() => undefined);
  }, []);

  const filters = useMemo<PeriodFilters>(
    () => ({
      from,
      to,
      departmentId: departmentId === '' ? undefined : Number(departmentId),
      locationId: locationId === '' ? undefined : Number(locationId),
    }),
    [from, to, departmentId, locationId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await reportsApi.payrollPreview(filters));
      setError(null);
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : t('payroll.error.load'));
    } finally {
      setLoading(false);
    }
  }, [filters, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Shifts the period by whole months.
   *
   * Kept alongside the free date boxes rather than replacing them: a payroll cycle running the 26th
   * to the 25th is common enough that a month-only picker would push people into exporting the
   * wrong range and correcting it in the spreadsheet.
   */
  const shiftMonth = (delta: number): void => {
    const [year, month] = from.split('-').map(Number) as [number, number];
    const moved = monthRange(year, month - 1 + delta);
    setFrom(moved.from);
    setTo(moved.to);
  };

  const intl = intlLocale(locale);
  const number = new Intl.NumberFormat(intl);
  const org = data?.organisation;

  const byKind = new Map((data?.blockers ?? []).map((row) => [row.kind, row]));
  const checks: CheckRow[] = [
    ...CHECKS.map((entry) => {
      const blocker = byKind.get(entry.kind);
      return {
        kind: entry.kind,
        label: <T k={entry.labelKey} />,
        count: blocker?.count ?? 0,
        detail: <T k={blocker?.detailKey ?? entry.clearKey} vars={blocker?.vars ?? {}} />,
        fix: entry.fix,
      };
    }),
    // A blocker the client has no label for is still shown. Dropping it would hide the one
    // thing nobody anticipated.
    ...(data?.blockers ?? [])
      .filter((row) => !CHECKS.some((entry) => entry.kind === row.kind))
      .map((row) => ({
        kind: row.kind,
        label: row.kind,
        count: row.count,
        detail: <T k={row.detailKey} vars={row.vars ?? {}} />,
        fix: null,
      })),
  ];
  const failing = checks.filter((check) => check.count > 0).length;
  const breakdown = Object.entries(data?.unresolvedExceptions.byKind ?? {}).sort(
    (left, right) => right[1] - left[1],
  );
  const mayExport = can(SCREEN, 'export');

  return (
    <PanelCard title={<T k="payroll.title" />} subtitle={<T k="payroll.subtitle" />}>
      <PanelSection
        title={<T k="payroll.staffCount" vars={{ count: number.format(data?.staffCount ?? 0) }} />}
        subtitle={
          <T
            k="payroll.period.withDays"
            vars={{
              from: data?.period.from ?? from,
              to: data?.period.to ?? to,
              days: data?.period.workingDays ?? 0,
            }}
          />
        }
      />

      <FilterRow
        dirty={
          departmentId !== '' || locationId !== '' || from !== initial.from || to !== initial.to
        }
        onReset={() => {
          setFrom(initial.from);
          setTo(initial.to);
          setDepartmentId('');
          setLocationId('');
        }}
      >
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label={t('payroll.filter.previousMonth')}
          title={t('payroll.filter.previousMonth')}
          className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
        </button>
        <DateBox label={t('payroll.filter.fromDate')} value={from} onChange={setFrom} />
        <span className="text-xs text-slate-400">
          <T k="payroll.filter.between" />
        </span>
        <DateBox label={t('payroll.filter.toDate')} value={to} onChange={setTo} />
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label={t('payroll.filter.nextMonth')}
          title={t('payroll.filter.nextMonth')}
          className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
        >
          <ChevronRight className="size-3.5" aria-hidden />
        </button>
        <FacetSelect
          label={t('staff.filter.allDepartments')}
          value={departmentId}
          onChange={setDepartmentId}
          options={(lookups?.departments ?? []).map((row) => ({
            value: String(row.id),
            label: row.name,
          }))}
        />
        <FacetSelect
          label={t('staff.filter.allLocations')}
          value={locationId}
          onChange={setLocationId}
          options={(lookups?.locations ?? []).map((row) => ({
            value: String(row.id),
            label: row.name,
          }))}
        />
      </FilterRow>

      <PanelBody className="space-y-4 pb-0">
        <Feedback error={error} />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile
            label={<T k="payroll.stat.scheduledDays" />}
            value={number.format(org?.scheduledDays ?? 0)}
            hint={<T k="payroll.stat.scheduledDays.hint" />}
          />
          <StatTile
            label={<T k="payroll.stat.presentDays" />}
            value={number.format(org?.presentDays ?? 0)}
            hint={
              <T
                k="payroll.stat.presentDays.hint"
                vars={{ late: number.format(org?.lateDays ?? 0) }}
              />
            }
            tone="success"
          />
          <StatTile
            label={<T k="payroll.stat.absentDays" />}
            value={number.format(org?.absentDays ?? 0)}
            hint={
              <T
                k="payroll.stat.absentDays.hint"
                vars={{ leave: number.format(org?.leaveDays ?? 0) }}
              />
            }
            tone={(org?.absentDays ?? 0) > 0 ? 'danger' : 'neutral'}
          />
          <StatTile
            label={<T k="payroll.stat.workedHours" />}
            value={formatHours(org?.workedMinutes ?? 0)}
            hint={
              <T
                k="payroll.stat.workedHours.hint"
                vars={{ decimal: ((org?.workedMinutes ?? 0) / 60).toFixed(2) }}
              />
            }
          />
          <StatTile
            label={<T k="payroll.stat.overtimeHours" />}
            value={formatHours(org?.overtimeMinutes ?? 0)}
            hint={
              <T
                k="payroll.stat.overtimeHours.hint"
                vars={{ minutes: number.format(org?.lateMinutes ?? 0) }}
              />
            }
            tone={(org?.overtimeMinutes ?? 0) > 0 ? 'warning' : 'neutral'}
          />
        </div>

        {/* The one note: whether the file about to be produced can be trusted. */}
        {data !== null &&
          (data.safeToExport ? (
            <PanelNote tone="success" icon={<CircleCheck className="size-3.5" aria-hidden />}>
              <T k="payroll.safe" />
            </PanelNote>
          ) : (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T
                k="payroll.unsafe.note"
                vars={{
                  emphasis: (
                    <strong className="font-medium">
                      <T k="payroll.unsafe.count" vars={{ failing, total: checks.length }} />
                    </strong>
                  ),
                }}
              />
            </PanelNote>
          ))}
      </PanelBody>

      {/*
        Passing checks are listed too. An empty table would leave the reader unable to tell a clean
        period from a check that never ran.
      */}
      <RecordTable
        framed
        loading={loading}
        rowCount={checks.length}
        empty={<T k="payroll.check.empty" />}
        columns={[
          { header: <T k="payroll.check.column.name" />, width: 'w-64' },
          { header: <T k="payroll.check.column.effect" /> },
          { header: <T k="payroll.check.column.count" />, width: 'w-24', align: 'right' },
          { header: <T k="panel.column.status" />, width: 'w-36' },
          { header: <T k="panel.column.actions" />, width: 'w-24', align: 'right' },
        ]}
      >
        {checks.map((check) => {
          const failed = check.count > 0;
          const expandable = check.kind === 'unresolved_exceptions' && breakdown.length > 0;
          const expanded = expandable && open === check.kind;
          const fix = check.fix;
          return (
            <Fragment key={check.kind}>
              <tr
                className={cn(
                  'border-b border-slate-100',
                  expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
                  failed && !expanded && 'bg-amber-50/40',
                )}
              >
                <td className="px-5 py-2.5 font-medium text-slate-800">{check.label}</td>
                <td className="px-2 py-2.5 text-xs text-slate-600">{check.detail}</td>
                <td className="px-2 py-2.5 text-right text-xs tabular-nums">
                  {failed ? (
                    <span className="font-medium text-amber-700">{number.format(check.count)}</span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-2 py-2.5">
                  <Badge tone={failed ? 'warning' : 'success'} className="uppercase">
                    <T k={failed ? 'payroll.check.status.failing' : 'payroll.check.status.clear'} />
                  </Badge>
                </td>
                <td className="px-2 py-2.5 pr-4">
                  <RowActions>
                    {failed && fix !== null && can(fix.screen, 'view') && (
                      <RowAction
                        icon={<ArrowUpRight className="size-4" aria-hidden />}
                        label={t('payroll.check.open', { screen: t(fix.navKey) })}
                        tone="view"
                        onClick={() => void navigate(fix.to)}
                      />
                    )}
                    {expandable && (
                      <ExpandButton
                        expanded={expanded}
                        onClick={() => setOpen(expanded ? null : check.kind)}
                        label={t('payroll.check.breakdown')}
                      />
                    )}
                  </RowActions>
                </td>
              </tr>

              {expanded && (
                <tr className="border-b border-slate-200 bg-slate-50">
                  <td colSpan={5} className="px-5 py-3">
                    <DetailGrid>
                      {breakdown.map(([kind, count]) => (
                        <Detail
                          key={kind}
                          label={tEnum(EXCEPTION_LABELS[kind], kind)}
                          value={number.format(count)}
                        />
                      ))}
                    </DetailGrid>
                    <PanelNote className="mt-3">
                      <T k="payroll.exceptions.note" />
                    </PanelNote>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </RecordTable>

      <PanelFooter
        shown={checks.length}
        total={checks.length}
        page={1}
        pageSize={Math.max(1, checks.length)}
        pageSizes={[Math.max(1, checks.length)]}
        generatedAt={data?.generatedAt ?? null}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => void load()}
      />

      {/*
        Reading the preview and producing the file are separate grants, so the button is absent
        rather than present and refused: an export that 403s teaches the operator the report is
        broken, not that they lack the permission. The hint says which grant it is.
      */}
      <PanelActions
        hint={
          mayExport ? (
            <>
              <T k="payroll.export.hint" vars={{ hash: <code className="font-mono text-[11px]">#</code> }} />
              {data !== null && (
                <>
                  {' '}
                  <T k="payroll.export.zone" vars={{ zone: data.timeZone }} />
                </>
              )}
            </>
          ) : (
            <T
              k="payroll.export.denied"
              vars={{
                permission: (
                  <span className="font-medium">
                    <T k="payroll.export.permission" />
                  </span>
                ),
              }}
            />
          )
        }
      >
        {mayExport && (
          <a
            href={reportsApi.payrollExportUrl(filters)}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium whitespace-nowrap text-white',
              data?.safeToExport === false
                ? 'bg-amber-600 hover:bg-amber-500'
                : 'bg-brand-600 hover:bg-brand-500',
            )}
          >
            {data?.safeToExport === false ? (
              <TriangleAlert className="size-4" aria-hidden />
            ) : (
              <Download className="size-4" aria-hidden />
            )}
            <T k="payroll.export.submit" />
          </a>
        )}
      </PanelActions>
    </PanelCard>
  );
}
