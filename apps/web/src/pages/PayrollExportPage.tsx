import type { LabelKey } from '@attendance/shared';
import { ChevronLeft, ChevronRight, CircleCheck, Download, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { Feedback } from '../components/Dialog';
import {
  DateBox,
  FacetSelect,
  FilterRow,
  PanelActions,
  PanelBody,
  PanelCard,
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
  type PayrollPreview,
  type PeriodFilters,
} from '../lib/reports-api';
import { T, TEnum, useLabels } from '../lib/translation';

/**
 * Payroll export.
 *
 * The download is never blocked. Payroll has a deadline, and a screen that refuses to
 * produce a file until every exception is settled gets worked around by someone
 * exporting from the database directly, which is worse than exporting a file that
 * states what is wrong with it.
 *
 * So the checks are stated instead: on this screen before the download, and again as
 * comment rows inside the CSV, because a spreadsheet gets forwarded and whoever opens
 * it next never saw this page.
 */
export function PayrollExportPage(): ReactNode {
  const { can } = useAuth();
  const { t } = useLabels();
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
   * Kept alongside the free date boxes rather than replacing them: a payroll cycle
   * running the 26th to the 25th is common enough that a month-only picker would push
   * people into exporting the wrong range and correcting it in the spreadsheet.
   */
  const shiftMonth = (delta: number): void => {
    const anchor = new Date(`${from}T00:00:00`);
    const moved = monthRange(anchor.getFullYear(), anchor.getMonth() + delta);
    setFrom(moved.from);
    setTo(moved.to);
  };

  const org = data?.organisation;
  const number = new Intl.NumberFormat('ms-MY');
  const checks = buildChecks(data, t);
  const failing = checks.filter((check) => check.count > 0).length;

  return (
    <PanelCard title={<T k="payroll.title" />} subtitle={<T k="payroll.subtitle" />}>
      <PanelSection
        title={
          data === null ? (
            <T k="payroll.period" vars={{ from, to }} />
          ) : (
            <T
              k="payroll.period.withDays"
              vars={{
                from: data.period.from,
                to: data.period.to,
                days: data.period.workingDays,
              }}
            />
          )
        }
        subtitle={
          data === null ? (
            <T k="monthly.loading" />
          ) : (
            <T k="payroll.staffCount" vars={{ count: number.format(data.staffCount) }} />
          )
        }
        action={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label={t('roster.month.previous')}
              className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label={t('roster.month.next')}
              className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        }
      />

      <PanelBody className="space-y-4">
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
                      <T
                        k="payroll.unsafe.count"
                        vars={{ failing, total: checks.length }}
                      />
                    </strong>
                  ),
                }}
              />
            </PanelNote>
          ))}
      </PanelBody>

      <FilterRow
        dirty={
          departmentId !== '' ||
          locationId !== '' ||
          from !== initial.from ||
          to !== initial.to
        }
        onReset={() => {
          setFrom(initial.from);
          setTo(initial.to);
          setDepartmentId('');
          setLocationId('');
        }}
      >
        <DateBox label={t('payroll.filter.fromDate')} value={from} onChange={setFrom} />
        <span className="text-xs text-slate-400">
          <T k="payroll.filter.between" />
        </span>
        <DateBox label={t('payroll.filter.toDate')} value={to} onChange={setTo} />
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

      {/*
        Passing checks are listed too. An empty table would leave the reader unable to
        tell a clean period from a check that never ran.
      */}
      <RecordTable
        loading={loading}
        rowCount={checks.length}
        empty={<T k="payroll.check.empty" />}
        columns={[
          { header: <T k="payroll.check.column.name" /> },
          { header: <T k="payroll.check.column.count" />, width: 'w-24' },
          { header: <T k="payroll.check.column.effect" /> },
        ]}
      >
        {checks.map((check) => {
          const failed = check.count > 0;
          return (
            <tr
              key={check.kind}
              className={cn('border-b border-slate-100', failed && 'bg-amber-50/40')}
            >
              <td className="px-5 py-2.5">
                <span className="flex items-center gap-2">
                  {failed ? (
                    <TriangleAlert className="size-4 shrink-0 text-amber-500" aria-hidden />
                  ) : (
                    <CircleCheck className="size-4 shrink-0 text-emerald-500" aria-hidden />
                  )}
                  <span className="font-medium text-slate-800">{check.label}</span>
                </span>
              </td>
              <td className="px-2 py-2.5 text-xs tabular-nums">
                {failed ? (
                  <span className="font-medium text-amber-700">{number.format(check.count)}</span>
                ) : (
                  <span className="text-emerald-700">0</span>
                )}
              </td>
              <td className="px-2 py-2.5 pr-5 text-xs text-slate-600">{check.detail}</td>
            </tr>
          );
        })}
      </RecordTable>

      {data !== null && data.unresolvedExceptions.total > 0 && (
        <>
          <PanelSection
            title={<T k="payroll.exceptions.title" />}
            subtitle={<T k="payroll.exceptions.subtitle" />}
            action={
              <Link
                to="/kehadiran/pengecualian"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <T k="payroll.exceptions.open" />
              </Link>
            }
          />

          <RecordTable
            loading={false}
            rowCount={Object.keys(data.unresolvedExceptions.byKind).length}
            empty={<T k="payroll.exceptions.empty" />}
            columns={[
              { header: <T k="payroll.exceptions.column.kind" /> },
              { header: <T k="payroll.exceptions.column.count" />, width: 'w-24' },
            ]}
          >
            {Object.entries(data.unresolvedExceptions.byKind)
              .sort((left, right) => right[1] - left[1])
              .map(([kind, count]) => (
                <tr key={kind} className="border-b border-slate-100 hover:bg-slate-50/70">
                  <td className="px-5 py-2.5 text-slate-700">
                    <TEnum k={EXCEPTION_LABELS[kind]} fallback={kind} />
                  </td>
                  <td className="px-2 py-2.5 text-xs font-medium tabular-nums text-amber-700">
                    {number.format(count)}
                  </td>
                </tr>
              ))}
          </RecordTable>
        </>
      )}

      <PanelActions
        hint={
          <>
            <T
              k="payroll.export.hint"
              vars={{ hash: <code className="font-mono text-[11px]">#</code> }}
            />
            {data !== null && (
              <T
                k="payroll.export.readAt"
                vars={{
                  time: (
                    <time dateTime={data.generatedAt}>
                      {new Date(data.generatedAt).toLocaleTimeString('ms-MY', { hour12: false })}
                    </time>
                  ),
                  zone: data.timeZone,
                }}
              />
            )}
          </>
        }
      >
        {/*
          Reading the preview and producing the file are separate grants, so the button
          is absent rather than present and refused: an export that 403s teaches the
          operator the report is broken, not that they lack the permission.
        */}
        {can('reports.payroll', 'export') ? (
          <a
            href={reportsApi.payrollExportUrl(filters)}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white',
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
        ) : (
          <PanelNote tone="warn" className="flex-1">
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
          </PanelNote>
        )}
      </PanelActions>
    </PanelCard>
  );
}

interface Check {
  kind: string;
  label: string;
  count: number;
  detail: string;
}

/**
 * The three checks the server runs, whether they failed or not.
 *
 * Registry keys rather than words. The counts and the failure text come from the response, so
 * a check the server stops reporting still appears — at zero — rather than silently
 * disappearing from the list somebody signs off against.
 */
const CHECK_LABELS: Array<{ kind: string; labelKey: LabelKey; clearKey: LabelKey }> = [
  {
    kind: 'unresolved_exceptions',
    labelKey: 'payroll.check.unresolvedExceptions',
    clearKey: 'payroll.check.unresolvedExceptions.clear',
  },
  {
    kind: 'staff_without_records',
    labelKey: 'payroll.check.staffWithoutRecords',
    clearKey: 'payroll.check.staffWithoutRecords.clear',
  },
  {
    /*
     * Listed even when clear, like the rest. Overtime nobody decided is money the file does
     * not carry, and a check that only appears when it fails is a check nobody signs off.
     */
    kind: 'pending_overtime',
    labelKey: 'payroll.check.pendingOvertime',
    clearKey: 'payroll.check.pendingOvertime.clear',
  },
  {
    kind: 'clock_drift',
    labelKey: 'payroll.check.clockDrift',
    clearKey: 'payroll.check.clockDrift.clear',
  },
];

/** Takes `t` because this is a plain function and hooks cannot be called from one. */
function buildChecks(data: PayrollPreview | null, t: (key: LabelKey) => string): Check[] {
  const byKind = new Map((data?.blockers ?? []).map((row) => [row.kind, row]));

  const known = CHECK_LABELS.map((entry) => {
    const blocker = byKind.get(entry.kind);
    return {
      kind: entry.kind,
      label: t(entry.labelKey),
      count: blocker?.count ?? 0,
      // A failing check's detail is the server's own wording, so it is not a label.
      detail: blocker?.detail ?? t(entry.clearKey),
    };
  });

  // A blocker kind the client does not have a label for is still shown, using the
  // server's own wording. Dropping it would hide the one thing nobody anticipated.
  const extra = (data?.blockers ?? [])
    .filter((row) => !CHECK_LABELS.some((entry) => entry.kind === row.kind))
    .map((row) => ({
      kind: row.kind,
      label: row.kind,
      count: row.count,
      detail: row.detail,
    }));

  return [...known, ...extra];
}
