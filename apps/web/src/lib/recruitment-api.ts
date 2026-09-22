import type { LabelKey } from '@attendance/shared';

import { api } from './api';
import type { ApprovalTrailEntry } from './hr-api';

/**
 * Recruitment: vacancies and candidates.
 *
 * A candidate is not a `Staff` row and this client keeps them apart. Hiring is the one call that
 * crosses over, and it returns the staff id it created so the screen can link to it.
 */

export type PostingStatus = 'draft' | 'published' | 'closed';

export const POSTING_STATUS_LABELS: Record<PostingStatus, LabelKey> = {
  draft: 'recruit.posting.status.draft',
  published: 'recruit.posting.status.published',
  closed: 'recruit.posting.status.closed',
};

export type ApplicantStatus =
  | 'new'
  | 'screening'
  | 'interview'
  | 'offered'
  | 'hired'
  | 'rejected'
  | 'withdrawn';

export const APPLICANT_STATUS_LABELS: Record<ApplicantStatus, LabelKey> = {
  new: 'recruit.applicant.status.new',
  screening: 'recruit.applicant.status.screening',
  interview: 'recruit.applicant.status.interview',
  offered: 'recruit.applicant.status.offered',
  hired: 'recruit.applicant.status.hired',
  rejected: 'recruit.applicant.status.rejected',
  withdrawn: 'recruit.applicant.status.withdrawn',
};

export type EmploymentType = 'permanent' | 'contract' | 'temporary' | 'internship';

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, LabelKey> = {
  permanent: 'recruit.employment.permanent',
  contract: 'recruit.employment.contract',
  temporary: 'recruit.employment.temporary',
  internship: 'recruit.employment.internship',
};

export interface PostingRow {
  id: number;
  code: string;
  title: string;
  departmentName: string | null;
  locationName: string | null;
  positions: number;
  /** Hires counted against `positions`, so an over-filled post is visible. */
  hired: number;
  applicantCount: number;
  employmentType: EmploymentType;
  salaryMin: number | null;
  salaryMax: number | null;
  /** Calendar dates, `YYYY-MM-DD`. */
  openedOn: string;
  closesOn: string | null;
  status: PostingStatus;
  summary: string | null;
  requirements: string | null;
  createdAt: string;
}

export interface PostingPage {
  rows: PostingRow[];
  total: number;
  counts: Partial<Record<PostingStatus, number>>;
  generatedAt: string;
}

export interface ApplicantRow {
  id: number;
  applicantNo: string;
  postingId: number;
  postingCode: string;
  postingTitle: string;
  postingStatus: PostingStatus;
  fullName: string;
  icNo: string | null;
  email: string | null;
  phone: string | null;
  hasResume: boolean;
  status: ApplicantStatus;
  currentLevel: number;
  /** A timestamp: an interview happens at a time, not on a date. */
  interviewAt: string | null;
  interviewNote: string | null;
  /** Set once hired. */
  staffId: number | null;
  employeeNo: string | null;
  /**
   * What the pipeline allows next, computed on the server.
   *
   * The screen offers exactly these. Deriving them on the client would put the state machine in
   * two places, and the copy that drifts is the one that lets somebody hire a rejected candidate.
   */
  nextStatuses: ApplicantStatus[];
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface ApplicantPage {
  rows: ApplicantRow[];
  total: number;
  counts: Partial<Record<ApplicantStatus, number>>;
  chainLength: number;
  generatedAt: string;
}

/**
 * Named rather than inlined, because the update variant is its `Partial`.
 *
 * Written as `Parameters<typeof recruitmentApi.createPosting>[0]` it referenced the object it was
 * being declared inside, which makes the whole client implicitly `any` — every call site loses
 * its types and nothing complains.
 */
export interface PostingInput {
  code: string;
  title: string;
  departmentId?: number | null;
  locationId?: number | null;
  summary?: string;
  requirements?: string;
  positions: number;
  employmentType: EmploymentType;
  salaryMin?: number | null;
  salaryMax?: number | null;
  openedOn: string;
  closesOn?: string | null;
}

/**
 * Query values to a search string, dropping what was not asked for.
 *
 * Booleans are stringified rather than skipped: `archived=false` is a real filter meaning "live
 * postings", not the absence of one.
 */
function toQuery(query: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    const text = String(value);
    if (text !== '') params.set(key, text);
  }
  return params.toString();
}

export const recruitmentApi = {
  postings: (query: {
    status?: PostingStatus;
    archived?: boolean;
    page?: number;
    pageSize?: number;
  }) => api.get<PostingPage>(`/api/job-postings?${toQuery(query)}`),

  createPosting: (body: PostingInput) =>
    api.post<{ id: number; code: string }>('/api/job-postings', body),

  updatePosting: (id: number, body: Partial<PostingInput>) =>
    api.patch<{ ok: true }>(`/api/job-postings/${id}`, body),

  /** Forward only: the server refuses anything the lifecycle does not allow. */
  setPostingStatus: (id: number, status: PostingStatus) =>
    api.post<{ ok: true }>(`/api/job-postings/${id}/status`, { status }),

  deletePosting: (id: number) => api.delete<{ ok: true }>(`/api/job-postings/${id}`),

  applicants: (query: {
    postingId?: number;
    status?: ApplicantStatus;
    archived?: boolean;
    page?: number;
    pageSize?: number;
  }) => api.get<ApplicantPage>(`/api/job-applicants?${toQuery(query)}`),

  applicantDetail: (id: number) =>
    api.get<ApplicantRow & { coverNote: string | null; trail: ApprovalTrailEntry[] }>(
      `/api/job-applicants/${id}`,
    ),

  createApplicant: (body: {
    postingId: number;
    fullName: string;
    icNo?: string;
    email?: string;
    phone?: string;
    coverNote?: string;
  }) => api.post<{ id: number; applicantNo: string }>('/api/job-applicants', body),

  /** Administrative movement. `offered` and `hired` are refused here by design. */
  setApplicantStatus: (
    id: number,
    body: { status: ApplicantStatus; note?: string; interviewAt?: string | null },
  ) => api.post<{ ok: true }>(`/api/job-applicants/${id}/status`, body),

  /** The offer decision, through the shared approval chain. */
  decideApplicant: (id: number, body: { decision: 'approved' | 'rejected'; note?: string }) =>
    api.post<{
      ok: true;
      status: string;
      level: number;
      totalLevels: number;
      finalized: boolean;
      awaitingLevel: number | null;
      awaitingLabel: string | null;
    }>(`/api/job-applicants/${id}/decide`, body),

  hire: (
    id: number,
    body: {
      employeeNo: string;
      departmentId?: number | null;
      locationId?: number | null;
      hireDate: string;
      position?: string;
    },
  ) =>
    api.post<{ ok: true; staffId: number; employeeNo: string; staffInactive: boolean }>(
      `/api/job-applicants/${id}/hire`,
      body,
    ),

  deleteApplicant: (id: number) => api.delete<{ ok: true }>(`/api/job-applicants/${id}`),
};

/** Advertised range, or a dash when none is published. */
export function formatSalaryRange(min: number | null, max: number | null): string {
  const money = (value: number): string =>
    `RM ${value.toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  if (min === null && max === null) return '—';
  if (min !== null && max !== null) {
    return min === max ? money(min) : `${money(min)} – ${money(max)}`;
  }
  return money((min ?? max) as number);
}
