import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Feedback } from '../components/Dialog';
import {
  CodePill,
  FacetSelect,
  FilterRow,
  PanelBody,
  PanelCard,
  PanelFooter,
  PanelSection,
  RecordTable,
} from '../components/RecordPanel';
import { StatTile } from '../components/ui';
import { formatScore, kpiApi, type ResultPage } from '../lib/kpi-api';
import { formatDateTime } from '../lib/operations-api';
import { T, useLabels } from '../lib/translation';

/**
 * Finalised grades, read-only.
 *
 * A screen of its own behind `hr.kpiResults`, separate from the reviews screen. A grade carries a
 * bonus where the payroll module exists, so the people who may read the finished grade are not
 * the people who may reopen the assessment that produced it. Nothing here writes.
 *
 * The period filter is fed by the results reply rather than the period list, which is behind
 * `hr.kpiPeriods` — a results-only role used to get a filter with nothing in it.
 */
export function KpiResultsPage(): ReactNode {
  const [data, setData] = useState<ResultPage | null>(null);
  const [periodId, setPeriodId] = useState('');
  const [gradeCode, setGradeCode] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();
  // Which load is the latest, so a filter answered out of order cannot replace the current rows.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    try {
      const result = await kpiApi.results({
        page,
        pageSize,
        ...(periodId === '' ? {} : { periodId: Number(periodId) }),
        ...(gradeCode === '' ? {} : { gradeCode }),
      });
      if (mine !== latest.current) return;
      setData(result);
      setError(null);
    } catch (cause) {
      if (mine !== latest.current) return;
      setError(cause instanceof Error ? cause.message : t('kpi.result.error.load'));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [page, pageSize, periodId, gradeCode, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];
  const grades = data?.grades ?? [];
  const periods = data?.periods ?? [];

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
      <PanelSection title={<T k="kpi.result.count" vars={{ count: data?.total ?? 0 }} />} />

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

      {error !== null && (
        <PanelBody className="pb-0">
          <Feedback error={error} />
        </PanelBody>
      )}

      {/*
        The distribution, not just the rows.

        A list of grades answers "what did this person get"; the shape of a period answers "is this
        distribution credible", which is the question somebody signing it off has. Counted across
        every grade whatever the grade filter, so choosing one does not zero the others.
      */}
      {grades.length > 0 && (
        <PanelBody className="space-y-2 pb-0">
          <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
            <T k="kpi.result.distribution" />
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {grades.map((grade) => (
              <StatTile
                key={grade.code}
                label={
                  <span className="inline-flex items-center gap-1.5">
                    {/* The chip is what makes a distribution scannable rather than countable. */}
                    <span
                      className="inline-flex min-w-5 justify-center rounded px-1 text-[10px] font-semibold text-white uppercase"
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
                    <T
                      k="kpi.grade.band"
                      vars={{ min: grade.minScore.toFixed(0), max: grade.maxScore.toFixed(0) }}
                    />
                    {' · '}
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
          </div>
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={rows.length}
        empty={<T k="kpi.result.empty" />}
        columns={[
          { header: <T k="kpi.result.column.period" />, width: 'w-32' },
          { header: <T k="kpi.result.column.staff" /> },
          { header: <T k="kpi.result.column.department" />, width: 'w-44' },
          { header: <T k="kpi.result.column.score" />, width: 'w-24', align: 'right' },
          { header: <T k="kpi.result.column.grade" />, width: 'w-20' },
          { header: <T k="kpi.result.column.bonus" />, width: 'w-44', align: 'right' },
          { header: <T k="kpi.result.column.finalised" />, width: 'w-40' },
        ]}
      >
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/70">
            <td className="px-5 py-2">
              <CodePill code={row.periodCode} />
            </td>
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
                  className="inline-flex min-w-8 justify-center rounded px-1.5 py-0.5 text-[11px] font-semibold text-white uppercase"
                  style={{ backgroundColor: colorFor(row.gradeCode) }}
                >
                  {row.gradeCode}
                </span>
              )}
            </td>
            {/*
              Months of basic salary, never ringgit: the bonus becomes money only when a payroll
              period freezes it onto a bonus row, and the cell names the unit so it cannot be read
              as an amount.
            */}
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
