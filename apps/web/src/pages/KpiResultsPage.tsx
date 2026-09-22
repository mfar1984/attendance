import { CircleAlert, Trophy } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Feedback } from '../components/Dialog';
import {
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
import { formatScore, kpiApi, type KpiPeriod, type ResultPage } from '../lib/kpi-api';
import { formatDateTime } from '../lib/operations-api';
import { T, useLabels } from '../lib/translation';

/**
 * Finalised grades, read-only.
 *
 * A screen of its own behind `hr.kpiResults`, separate from the reviews screen. A grade carries a
 * bonus where the payroll module exists, so the people who may read the finished grade are not
 * the people who may reopen the assessment that produced it. Nothing here writes.
 */
export function KpiResultsPage(): ReactNode {
  const [data, setData] = useState<ResultPage | null>(null);
  const [periods, setPeriods] = useState<KpiPeriod[]>([]);
  const [periodId, setPeriodId] = useState('');
  const [gradeCode, setGradeCode] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await kpiApi.results({
          page,
          pageSize,
          ...(periodId === '' ? {} : { periodId: Number(periodId) }),
          ...(gradeCode === '' ? {} : { gradeCode }),
        }),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('kpi.result.error.load'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, periodId, gradeCode, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        setPeriods(await kpiApi.periods());
      } catch {
        // The period filter falls back to all periods, which is the default anyway.
      }
    })();
  }, []);

  const rows = data?.rows ?? [];
  const grades = data?.grades ?? [];

  /**
   * The colour a grade code renders as.
   *
   * Falls back to slate for a code naming a band that has since been deleted. That happens by
   * design: `gradeCode` on a finalised appraisal is a stored string rather than a foreign key, so it
   * keeps naming the grade the person was given even after the band is gone.
   */
  const colorFor = (code: string): string =>
    grades.find((grade) => grade.code === code)?.color ?? '#64748b';

  return (
    <PanelCard title={<T k="kpi.result.title" />} subtitle={<T k="kpi.result.subtitle" />}>
      <PanelSection
        icon={<Trophy className="size-4" aria-hidden />}
        title={<T k="kpi.result.title" />}
      />

      <FilterRow
        dirty={periodId !== '' || gradeCode !== ''}
        onReset={() => {
          setPeriodId('');
          setGradeCode('');
          setPage(1);
        }}
      >
        <FacetSelect
          label={t('kpi.result.filter.period')}
          value={periodId}
          onChange={(value) => {
            setPeriodId(value);
            setPage(1);
          }}
          options={periods.map((row) => ({
            value: String(row.id),
            label: `${row.code} — ${row.name}`,
          }))}
        />
        <FacetSelect
          label={t('kpi.result.filter.grade')}
          value={gradeCode}
          onChange={(value) => {
            setGradeCode(value);
            setPage(1);
          }}
          options={grades.map((grade) => ({
            value: grade.code,
            label: `${grade.code} — ${grade.name}`,
          }))}
        />
      </FilterRow>

      <PanelBody className="pb-0">
        <Feedback error={error} />
      </PanelBody>

      {/*
        The distribution, not just the rows.
        A list of grades answers "what did this person get"; the shape of a period answers
        "is this distribution credible", which is the question somebody signing it off has.
      */}
      {grades.length > 0 && (
        <PanelBody className="pb-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            <T k="kpi.result.distribution" />
          </p>
        </PanelBody>
      )}
      {grades.length > 0 && (
        <PanelBody className="grid gap-3 pb-0 pt-2 sm:grid-cols-2 lg:grid-cols-4">
          {grades.map((grade) => (
            <StatTile
              key={grade.code}
              label={
                <span className="inline-flex items-center gap-1.5">
                  {/* The chip is what makes a distribution scannable rather than countable. */}
                  <span
                    className="inline-flex min-w-5 justify-center rounded px-1 text-[10px] font-semibold uppercase text-white"
                    style={{ backgroundColor: grade.color }}
                  >
                    {grade.code}
                  </span>
                  {grade.name}
                </span>
              }
              value={String(data?.distribution[grade.code] ?? 0)}
              hint={
                <>
                  {`${grade.minScore.toFixed(0)}–${grade.maxScore.toFixed(0)}% · `}
                  {grade.bonusMonths === null ? (
                    <T k="kpi.result.bonusNone" />
                  ) : (
                    <T
                      k="kpi.result.bonusMonths"
                      vars={{ months: grade.bonusMonths.toFixed(2) }}
                    />
                  )}
                </>
              }
            />
          ))}
        </PanelBody>
      )}

      <PanelBody className="pb-0">
        <PanelNote icon={<CircleAlert className="size-3.5" aria-hidden />}>
          <T k="kpi.grade.note.history" />
        </PanelNote>
        {/*
          Bonus is months here, not ringgit. It becomes money only when a payroll period freezes it
          onto a bonus row — an amount on this screen would be a figure nothing has approved that
          moves whenever the person's basic salary does.
        */}
        <PanelNote>
          <T k="kpi.result.note.bonus" />
        </PanelNote>
      </PanelBody>

      <RecordTable
        loading={loading}
        rowCount={rows.length}
        empty={<T k="kpi.result.empty" />}
        columns={[
          { header: <T k="kpi.result.column.period" />, width: 'w-36' },
          { header: <T k="kpi.result.column.staff" /> },
          { header: <T k="kpi.result.column.department" />, width: 'w-40' },
          { header: <T k="kpi.result.column.score" />, width: 'w-24', align: 'right' },
          { header: <T k="kpi.result.column.grade" />, width: 'w-24' },
          { header: <T k="kpi.result.column.bonus" />, width: 'w-40', align: 'right' },
          { header: <T k="kpi.result.column.finalised" />, width: 'w-44' },
        ]}
      >
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/70">
            <td className="px-5 py-2 font-mono text-xs text-slate-700">{row.periodCode}</td>
            <td className="px-2 py-2">
              <span className="block text-slate-800">{row.staffName}</span>
              <span className="block font-mono text-[11px] text-slate-400">{row.employeeNo}</span>
            </td>
            <td className="px-2 py-2 text-xs text-slate-600">{row.departmentName ?? '—'}</td>
            <td className="px-2 py-2 text-right text-xs font-medium tabular-nums text-slate-700">
              {formatScore(row.totalScore)}
            </td>
            <td className="px-2 py-2">
              {row.gradeCode === null ? (
                <span className="text-xs text-slate-400">—</span>
              ) : (
                /*
                 * The grade's own colour, not a fixed green.
                 *
                 * Every grade rendering as `success` made a column of A/B/C/D/E something you had
                 * to read one row at a time. The colour is stored on the band so a distribution can
                 * be scanned.
                 */
                <span
                  className="inline-flex min-w-8 justify-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase text-white"
                  style={{ backgroundColor: colorFor(row.gradeCode) }}
                >
                  {row.gradeCode}
                </span>
              )}
            </td>
            <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-600">
              {row.bonusMonths === null ? (
                <span className="text-slate-400">
                  <T k="kpi.result.bonusNone" />
                </span>
              ) : (
                <T k="kpi.result.bonusMonths" vars={{ months: row.bonusMonths.toFixed(2) }} />
              )}
            </td>
            <td className="px-2 py-2 text-xs whitespace-nowrap text-slate-500">
              {row.finalisedAt === null ? '—' : formatDateTime(row.finalisedAt)}
            </td>
          </tr>
        ))}
      </RecordTable>

      <PanelFooter
        shown={rows.length}
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
    </PanelCard>
  );
}
