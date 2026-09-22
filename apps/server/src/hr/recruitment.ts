/**
 * Recruitment rules: the vacancy lifecycle and the applicant pipeline.
 *
 * Import-free, so both state machines run without a database. They are worth testing rather
 * than trusting: an applicant who can move from `rejected` back to `offered` is a hiring
 * decision nobody made, and a posting that can be filled past its advertised vacancies is a
 * headcount nobody approved.
 */

export const POSTING_STATUSES = ['draft', 'published', 'closed'] as const;

export type PostingStatus = (typeof POSTING_STATUSES)[number];

export const APPLICANT_STATUSES = [
  'new',
  'screening',
  'interview',
  'offered',
  'hired',
  'rejected',
  'withdrawn',
] as const;

export type ApplicantStatus = (typeof APPLICANT_STATUSES)[number];

/** Statuses from which nothing further happens. */
export const TERMINAL_APPLICANT_STATUSES: readonly ApplicantStatus[] = [
  'hired',
  'rejected',
  'withdrawn',
];

export function isTerminal(status: ApplicantStatus): boolean {
  return TERMINAL_APPLICANT_STATUSES.includes(status);
}

/**
 * The vacancy lifecycle.
 *
 * Forward only. A closed posting does not reopen: applicants filed against it were answering an
 * advertisement with a closing date, and reopening it would quietly extend a deadline some
 * candidates were already told had passed. Publish a new one.
 */
const POSTING_TRANSITIONS: Record<PostingStatus, readonly PostingStatus[]> = {
  draft: ['published'],
  published: ['closed'],
  closed: [],
};

export function canPublish(status: PostingStatus): boolean {
  return POSTING_TRANSITIONS[status].includes('published');
}

export function postingTransitionAllowed(from: PostingStatus, to: PostingStatus): boolean {
  return POSTING_TRANSITIONS[from].includes(to);
}

/**
 * The applicant pipeline.
 *
 * `withdrawn` is reachable from anywhere before a terminal state, because a candidate can pull
 * out at any point and that is their decision rather than the organisation's.
 *
 * `rejected` is likewise reachable from any live stage: somebody can be turned down on the CV,
 * after the interview, or after an offer is declined internally.
 *
 * `hired` is reachable only from `offered`. Hiring somebody who was never offered the post skips
 * the step where terms were agreed, and that step is the one an employment dispute turns on.
 */
const APPLICANT_TRANSITIONS: Record<ApplicantStatus, readonly ApplicantStatus[]> = {
  new: ['screening', 'rejected', 'withdrawn'],
  screening: ['interview', 'rejected', 'withdrawn'],
  interview: ['offered', 'rejected', 'withdrawn'],
  offered: ['hired', 'rejected', 'withdrawn'],
  hired: [],
  rejected: [],
  withdrawn: [],
};

export function applicantTransitionAllowed(from: ApplicantStatus, to: ApplicantStatus): boolean {
  return APPLICANT_TRANSITIONS[from].includes(to);
}

/** Where an applicant can go next, for the screen to offer exactly those and nothing else. */
export function nextApplicantStatuses(from: ApplicantStatus): readonly ApplicantStatus[] {
  return APPLICANT_TRANSITIONS[from];
}

export type Refusal = { key: string; vars?: Record<string, string | number> };

/**
 * Whether a posting can take another hire.
 *
 * Counted against `positions` rather than trusted to whoever is closing the post. A vacancy
 * advertised for two people that quietly hires four is a headcount decision made by nobody, and
 * it surfaces months later as a budget question.
 */
export function checkVacancy(input: { positions: number; hired: number }): Refusal | null {
  if (input.hired >= input.positions) {
    return {
      key: 'recruit.refuse.noVacancy',
      vars: { positions: input.positions, hired: input.hired },
    };
  }
  return null;
}

export interface PostingCheckInput {
  openedOn: string;
  closesOn: string | null;
  /** Today, as `YYYY-MM-DD`. Passed in so this has no clock of its own. */
  today: string;
  positions: number;
  salaryMin: number | null;
  salaryMax: number | null;
}

/** Why this posting cannot stand, or null. */
export function checkPosting(input: PostingCheckInput): Refusal | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.openedOn)) {
    return { key: 'recruit.refuse.badDate' };
  }
  if (input.closesOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.closesOn)) {
    return { key: 'recruit.refuse.badDate' };
  }

  /*
   * Compared as strings. `YYYY-MM-DD` sorts lexicographically in date order, and parsing to a
   * `Date` here would reintroduce the timezone question that date-only values exist to avoid.
   */
  if (input.closesOn !== null && input.closesOn < input.openedOn) {
    return { key: 'recruit.refuse.closesBeforeOpens' };
  }

  if (!Number.isInteger(input.positions) || input.positions < 1) {
    return { key: 'recruit.refuse.noPositions' };
  }
  if (input.positions > 500) {
    return { key: 'recruit.refuse.tooManyPositions' };
  }

  if (input.salaryMin !== null && input.salaryMax !== null && input.salaryMin > input.salaryMax) {
    return { key: 'recruit.refuse.salaryOrder' };
  }
  for (const value of [input.salaryMin, input.salaryMax]) {
    if (value !== null && (!Number.isFinite(value) || value <= 0)) {
      return { key: 'recruit.refuse.badSalary' };
    }
  }

  return null;
}

/**
 * Whether this candidate carries enough to become a staff record.
 *
 * Checked at the moment of hiring rather than when the application is filed. A candidate applies
 * with whatever they have; an employee needs an IC number because it is what payroll and the
 * statutory returns are keyed on. Demanding it up front would turn away applications.
 */
export function checkHireable(input: { icNo: string | null; fullName: string }): Refusal | null {
  if (input.fullName.trim().length === 0) return { key: 'recruit.refuse.noName' };
  if (input.icNo === null || input.icNo.trim().length === 0) {
    return { key: 'recruit.refuse.noIc' };
  }
  return null;
}
