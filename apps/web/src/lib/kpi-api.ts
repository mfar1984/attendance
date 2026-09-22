import type { LabelKey } from '@attendance/shared';

import { api } from './api';

/**
 * KPI: the competency catalogue, forms, periods, assignments, scoring and results.
 *
 * Forms and grades are saved as whole sets rather than row by row. Both carry a constraint across
 * siblings — weights sum to 100, bands cover 0–100 exactly once — so a per-row endpoint would let
 * somebody save a valid row that makes the set invalid.
 */

/** Every competency is scored out of this. Fixed, not configurable. */
export const SCORE_MAX = 100;

export type PeriodStatus = 'open' | 'closed';

export const PERIOD_STATUS_LABELS: Record<PeriodStatus, LabelKey> = {
  open: 'kpi.period.status.open',
  closed: 'kpi.period.status.closed',
};

export type AssignmentStatus = 'pending' | 'inProgress' | 'submitted' | 'finalised';

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, LabelKey> = {
  pending: 'kpi.assignment.status.pending',
  inProgress: 'kpi.assignment.status.inProgress',
  submitted: 'kpi.assignment.status.submitted',
  finalised: 'kpi.assignment.status.finalised',
};

export type CompetencyCategory = 'core' | 'functional' | 'leadership';

export const CATEGORY_LABELS: Record<CompetencyCategory, LabelKey> = {
  core: 'kpi.competency.category.core',
  functional: 'kpi.competency.category.functional',
  leadership: 'kpi.competency.category.leadership',
};

export const CATEGORY_HINTS: Record<CompetencyCategory, LabelKey> = {
  core: 'kpi.competency.category.core.hint',
  functional: 'kpi.competency.category.functional.hint',
  leadership: 'kpi.competency.category.leadership.hint',
};

export const CATEGORY_ORDER: CompetencyCategory[] = ['core', 'functional', 'leadership'];

/**
 * A fault the server found, as a registry key plus its variables.
 *
 * The key is a `LabelKey` rather than a string because the server emits exactly the keys the
 * registry holds — `kpi.audit.weightOver`, `kpi.refuse.bandGap` — so the banner is one label and
 * not a sentence assembled on the screen. A prose message would have to be built by the route,
 * which runs without a reader whose language can be looked up.
 */
export interface Fault {
  key: LabelKey;
  vars?: Record<string, string | number>;
}

export interface Competency {
  id: number;
  name: string;
  category: CompetencyCategory;
  description: string | null;
  active: boolean;
  /** How many forms ask about this. The column free text could not have produced. */
  templateCount: number;
}

export interface CompetencyInput {
  name: string;
  category: CompetencyCategory;
  description?: string;
  active?: boolean;
}

export interface TemplateItem {
  id?: number;
  competencyId: number | null;
  competencyName: string;
  description: string | null;
  /** Percent of the total. The set must sum to 100. */
  weight: number;
  sortOrder?: number;
  category: CompetencyCategory | null;
  /** The catalogue entry has since been deactivated; the wording here stays. */
  competencyRetired?: boolean;
}

export interface KpiTemplate {
  id: number;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  assignmentCount: number;
  items: TemplateItem[];
  /** Sent so the list can flag a form whose weights no longer add up. */
  weightTotal: number;
  faults: Fault[];
}

export interface KpiPeriod {
  id: number;
  code: string;
  name: string;
  /** Calendar dates. */
  fromDate: string;
  toDate: string;
  /** When reviews are due, normally after `toDate`. */
  dueOn: string;
  status: PeriodStatus;
  assignmentCount: number;
  /** Reviews not yet submitted. Non-zero makes closing a decision rather than a click. */
  outstanding: number;
  openedAt: string | null;
  closedAt: string | null;
}

export interface KpiAssignmentRow {
  id: number;
  periodId: number;
  periodCode: string;
  periodName: string;
  periodStatus: PeriodStatus;
  dueOn: string;
  staffId: number;
  employeeNo: string;
  staffName: string;
  departmentName: string | null;
  templateId: number;
  templateCode: string;
  templateName: string;
  /** Both counted from the appraisal's own snapshot rows, not from the form. */
  itemCount: number;
  scoredCount: number;
  reviewerAccountId: number;
  status: AssignmentStatus;
  /** Written at submission, cleared on reopen. */
  totalScore: number | null;
  gradeCode: string | null;
  submittedAt: string | null;
  finalisedAt: string | null;
  decisionNote: string | null;
}

export interface KpiAssignmentPage {
  rows: KpiAssignmentRow[];
  total: number;
  counts: Partial<Record<AssignmentStatus, number>>;
  generatedAt: string;
}

export interface ReviewLine {
  /**
   * The snapshot row's own id, issued by the server.
   *
   * What a save sends back. The weight is not sent and there is no shape of request that would
   * carry one — it was frozen onto this row when the appraisal was created.
   */
  scoreId: number;
  competencyId: number | null;
  competencyName: string;
  description: string | null;
  weight: number;
  /** 0–100, or null when this line has not been answered. */
  score: number | null;
  comment: string | null;
  sortOrder: number;
}

export interface ReviewForm {
  id: number;
  periodCode: string;
  periodName: string;
  periodStatus: PeriodStatus;
  dueOn: string;
  employeeNo: string;
  staffName: string;
  templateCode: string;
  templateName: string;
  status: AssignmentStatus;
  scoreMax: number;
  totalScore: number | null;
  gradeCode: string | null;
  decisionNote: string | null;
  reviewerAccountId: number;
  /** The weighted score over answered lines, computed by the server on load. */
  runningScore: number | null;
  items: ReviewLine[];
}

export interface KpiGrade {
  id?: number;
  code: string;
  name: string;
  minScore: number;
  maxScore: number;
  /** Months of basic salary. Null carries no bonus. */
  bonusMonths: number | null;
  /** `#rrggbb`. The chip behind the grade letter. */
  color: string;
  sortOrder?: number;
}

export interface GradePayload {
  grades: KpiGrade[];
  /**
   * Every coverage fault, not just the first.
   *
   * A gap or overlap is invisible in a table of numbers — it only surfaces when somebody submits a
   * review and is refused, which is both the wrong person and the wrong screen.
   */
  faults: Fault[];
  maxBonusMonths: number;
}

export interface ResultRow {
  id: number;
  periodCode: string;
  periodName: string;
  employeeNo: string;
  staffName: string;
  departmentName: string | null;
  templateCode: string;
  totalScore: number | null;
  gradeCode: string | null;
  /** Months, not an amount. It becomes money only when a payroll period freezes it. */
  bonusMonths: number | null;
  finalisedAt: string | null;
}

export interface ResultPage {
  rows: ResultRow[];
  total: number;
  /** Count per grade, for the shape of a period at a glance. */
  distribution: Record<string, number>;
  grades: Array<{
    code: string;
    name: string;
    minScore: number;
    maxScore: number;
    bonusMonths: number | null;
    color: string;
  }>;
  generatedAt: string;
}

function toQuery(query: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    const text = String(value);
    if (text !== '') params.set(key, text);
  }
  return params.toString();
}

export interface TemplateInput {
  code: string;
  name: string;
  description?: string;
  active?: boolean;
  /** Competency ids, not names. Free text is what made the catalogue necessary. */
  items: Array<{ competencyId: number; description?: string; weight: number }>;
}

export interface CompetencyOption {
  id: number;
  name: string;
  category: CompetencyCategory;
  description: string | null;
}

export const kpiApi = {
  competencies: () => api.get<Competency[]>('/api/kpi-competencies'),

  /**
   * Active catalogue entries, for the form builder's picker.
   *
   * Behind `hr.kpiTemplates` rather than `hr.kpiSettings`, so somebody who builds forms is not
   * handed the settings screen to get at a dropdown.
   */
  competencyOptions: () => api.get<CompetencyOption[]>('/api/kpi-competencies/options'),

  createCompetency: (body: CompetencyInput) =>
    api.post<{ id: number; name: string }>('/api/kpi-competencies', body),

  updateCompetency: (id: number, body: Partial<CompetencyInput>) =>
    api.patch<{ ok: true }>(`/api/kpi-competencies/${id}`, body),

  deleteCompetency: (id: number) => api.delete<{ ok: true }>(`/api/kpi-competencies/${id}`),

  templates: () => api.get<KpiTemplate[]>('/api/kpi-templates'),

  createTemplate: (body: TemplateInput) =>
    api.post<{ id: number; code: string }>('/api/kpi-templates', body),

  updateTemplate: (id: number, body: Partial<TemplateInput>) =>
    api.patch<{ ok: true }>(`/api/kpi-templates/${id}`, body),

  deleteTemplate: (id: number) => api.delete<{ ok: true }>(`/api/kpi-templates/${id}`),

  periods: () => api.get<KpiPeriod[]>('/api/kpi-periods'),

  createPeriod: (body: {
    code: string;
    name: string;
    fromDate: string;
    toDate: string;
    dueOn: string;
  }) => api.post<{ id: number; code: string }>('/api/kpi-periods', body),

  /** `acknowledgeOutstanding` is required to close a period with unsubmitted reviews. */
  setPeriodStatus: (id: number, status: PeriodStatus, acknowledgeOutstanding?: boolean) =>
    api.post<{ ok: true }>(`/api/kpi-periods/${id}/status`, {
      status,
      ...(acknowledgeOutstanding === undefined ? {} : { acknowledgeOutstanding }),
    }),

  deletePeriod: (id: number) => api.delete<{ ok: true }>(`/api/kpi-periods/${id}`),

  assignments: (query: {
    periodId?: number;
    staffId?: number;
    status?: AssignmentStatus;
    mine?: boolean;
    page?: number;
    pageSize?: number;
  }) => api.get<KpiAssignmentPage>(`/api/kpi-assignments?${toQuery(query)}`),

  createAssignment: (body: {
    periodId: number;
    staffId: number;
    templateId: number;
    reviewerAccountId: number;
  }) => api.post<{ id: number }>('/api/kpi-assignments', body),

  deleteAssignment: (id: number) => api.delete<{ ok: true }>(`/api/kpi-assignments/${id}`),

  review: (id: number) => api.get<ReviewForm>(`/api/kpi-assignments/${id}/review`),

  /** Partial saves are expected: a reviewer works through a form over more than one sitting. */
  saveScores: (id: number, scores: Array<{ scoreId: number; score: number; comment?: string }>) =>
    api.put<{ ok: true; saved: number }>(`/api/kpi-assignments/${id}/review`, { scores }),

  submitReview: (id: number) =>
    api.post<{ ok: true; totalScore: number; gradeCode: string }>(
      `/api/kpi-assignments/${id}/submit`,
    ),

  reopenReview: (id: number, note: string) =>
    api.post<{ ok: true }>(`/api/kpi-assignments/${id}/reopen`, { note }),

  finaliseReview: (id: number, note?: string) =>
    api.post<{ ok: true }>(`/api/kpi-assignments/${id}/finalise`, {
      ...(note === undefined ? {} : { note }),
    }),

  results: (query: { periodId?: number; gradeCode?: string; page?: number; pageSize?: number }) =>
    api.get<ResultPage>(`/api/kpi-results?${toQuery(query)}`),

  grades: () => api.get<GradePayload>('/api/kpi-grades'),

  /** The whole set, because bands are only valid together. */
  saveGrades: (grades: Array<Omit<KpiGrade, 'id' | 'sortOrder'>>) =>
    api.put<{ ok: true }>('/api/kpi-grades', { grades }),
};

/** Percentage to two decimals, or a dash. */
export function formatScore(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(Math.round(value * 100) / 100).toFixed(2)}%`;
}

/**
 * Months to two decimals.
 *
 * Two, not one: a bonus of 1.5 months and one of 1.25 are different policies, and a screen that
 * rounds them together makes the smaller one unwritable.
 */
export function formatMonths(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return value.toFixed(2);
}

/**
 * Weights spread as evenly as two decimals allow, summing to exactly 100.
 *
 * Mirrors `equaliseWeights` in `apps/server/src/hr/kpi.ts`. Duplicated rather than fetched because
 * this runs on every keystroke of the row count, and a form builder that has to wait for a round
 * trip to show a total is a form builder people fight.
 */
export function equaliseWeights(count: number): number[] {
  if (!Number.isInteger(count) || count <= 0) return [];
  const base = Math.floor(10000 / count) / 100;
  const weights = Array.from({ length: count }, () => base);
  const shortfall = Math.round((100 - base * count) * 100) / 100;
  weights[count - 1] = Math.round((base + shortfall) * 100) / 100;
  return weights;
}

/**
 * The weighted score over answered lines.
 *
 * Mirrors `weightedScore` in `apps/server/src/hr/kpi.ts`, for the live total while typing. The
 * server sends `runningScore` on load and recomputes at submission, so this never decides anything
 * — it only has to agree.
 */
export function runningScore(lines: Array<{ score: number | null; weight: number }>): number | null {
  let weighted = 0;
  let weight = 0;
  for (const line of lines) {
    if (line.score === null || !Number.isFinite(line.score)) continue;
    if (line.weight <= 0) continue;
    weighted += line.score * line.weight;
    weight += line.weight;
  }
  if (weight <= 0) return null;
  return Math.round((weighted / weight) * 100) / 100;
}
