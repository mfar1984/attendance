/**
 * KPI rules: competency weights, weighted scoring, grade bands, bonus policy, and the two
 * lifecycles.
 *
 * Import-free, so every rule runs without a database.
 *
 * Three decisions here replaced earlier ones that were wrong in ways nothing would have reported:
 *
 *   Every competency is scored 0–100. There is no configurable scale. A per-template scale meant
 *   two people on different forms could not be compared, and it had to be frozen onto every
 *   assignment and every score to stay meaningful — a second number that has to agree with the
 *   first, in three places.
 *
 *   The weighted total divides by the weights actually present, not by 100. A form summing to 90
 *   still produces a score out of 100. `checkWeights` still asks for 100 on save, but it asks for
 *   comparability across forms rather than for the arithmetic to work — so a form that slips
 *   through cannot silently score everybody 10% low.
 *
 *   A grade is found by the highest band whose floor the score reaches. Reading `min <= x <= max`
 *   over an ascending list makes the answer depend on list order wherever two bands touch, so the
 *   same score could grade differently on two screens.
 */

/**
 * Period lifecycle states.
 *
 * There is no `draft`. It existed, and every period sat in it until somebody remembered to press
 * Open — a state whose only behaviour was to refuse the thing the screen was for.
 */
export const PERIOD_STATUSES = ['open', 'closed'] as const;

export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export const ASSIGNMENT_STATUSES = ['pending', 'inProgress', 'submitted', 'finalised'] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/**
 * How the competency catalogue is grouped.
 *
 * Presentation for the picker, not arithmetic. Weight is the only thing that decides what a
 * competency is worth, and a leadership item at 10% counts exactly as much as a core item at 10%.
 */
export const COMPETENCY_CATEGORIES = ['core', 'functional', 'leadership'] as const;

export type CompetencyCategory = (typeof COMPETENCY_CATEGORIES)[number];

/** Every competency is scored out of this. Fixed, not configurable — see the file comment. */
export const SCORE_MAX = 100;

/** Weights are percentages, so they sum to this. */
export const TOTAL_WEIGHT = 100;

/**
 * Tolerance on the weight sum.
 *
 * Thirds cannot be expressed exactly in two decimals: 33.33 + 33.33 + 33.34 is 100.00, but
 * 33.33 × 3 is 99.99. One sen of slack accepts the honest rounding without accepting a form that
 * is genuinely short.
 */
export const WEIGHT_TOLERANCE = 0.01;

/**
 * Ceiling on a grade's bonus, in months of basic salary.
 *
 * Not a policy limit — it is a typo guard. `bonusMonths` is the number a payroll run multiplies
 * basic salary by, so a stray zero turns one month into ten and the mistake is only visible after
 * the payslips are generated. Twelve is above any real appraisal bonus and below any plausible
 * slip of the finger.
 */
export const MAX_BONUS_MONTHS = 12;

export type Refusal = { key: string; vars?: Record<string, string | number> };

/** Money-style rounding, reused so a score and a weight round the same way. */
function round2(value: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  return Math.round(Number((value * 100).toPrecision(12))) / 100;
}

// ---------------------------------------------------------------------------
// Competency catalogue
// ---------------------------------------------------------------------------

/**
 * Whether a catalogue name can stand.
 *
 * Trimmed and collapsed before comparison, because `"Komunikasi "` and `"Komunikasi"` are the
 * same competency to everybody except a unique index. The catalogue exists to stop one competency
 * being ten spellings of itself, and whitespace is the cheapest way to defeat that.
 */
export function normaliseCompetencyName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function checkCompetency(input: { name: string; category: string }): Refusal | null {
  const name = normaliseCompetencyName(input.name);
  if (name.length === 0) return { key: 'kpi.refuse.competencyName' };
  if (name.length > 190) return { key: 'kpi.refuse.competencyNameLong' };
  if (!(COMPETENCY_CATEGORIES as readonly string[]).includes(input.category)) {
    return { key: 'kpi.refuse.competencyCategory' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Template weights
// ---------------------------------------------------------------------------

/**
 * Whether a form's weights add up.
 *
 * Refused on save. The arithmetic no longer depends on it — `weightedScore` divides by the
 * weights present — but comparability does: two people are only on the same scale if both forms
 * are read out of the same total. A form summing to 90 is a form whose author lost track, and the
 * message says the number so they can see where.
 */
export function checkWeights(weights: number[]): Refusal | null {
  if (weights.length === 0) return { key: 'kpi.refuse.noItems' };

  for (const weight of weights) {
    if (!Number.isFinite(weight) || weight <= 0) return { key: 'kpi.refuse.badWeight' };
    if (weight > TOTAL_WEIGHT) return { key: 'kpi.refuse.weightTooLarge' };
  }

  const total = round2(weights.reduce((sum, weight) => sum + weight, 0));

  /*
   * The difference is rounded before it is compared.
   *
   * `Math.abs(99.99 - 100)` is 0.010000000000005 in IEEE-754, which exceeds a tolerance of
   * exactly 0.01 — so the naive comparison refuses the very rounding the tolerance exists to
   * accept. Same class of fault as rounding money by scaling and truncating.
   */
  if (round2(Math.abs(total - TOTAL_WEIGHT)) > WEIGHT_TOLERANCE) {
    return { key: 'kpi.refuse.weightSum', vars: { total: total.toFixed(2) } };
  }
  return null;
}

/**
 * Weights spread as evenly as two decimals allow, summing to exactly 100.
 *
 * The remainder goes on the last row rather than being spread, so the numbers a reader sees are
 * `33.33 / 33.33 / 33.34` and not three values that each look slightly wrong. Exposed because
 * "make these equal" is what somebody actually wants from a form builder, and doing it by hand
 * across seven rows is where the sum stops being 100.
 */
export function equaliseWeights(count: number): number[] {
  if (!Number.isInteger(count) || count <= 0) return [];

  const base = Math.floor((TOTAL_WEIGHT * 100) / count) / 100;
  const weights = Array.from({ length: count }, () => base);
  const shortfall = round2(TOTAL_WEIGHT - base * count);
  weights[count - 1] = round2(base + shortfall);
  return weights;
}

/**
 * Everything wrong with a form's competency list, not just the first thing.
 *
 * Separate from `checkWeights` because it answers a different question. `checkWeights` gates a
 * save and stops at the first fault; this one feeds a banner on a form somebody is looking at, and
 * a banner that reveals its second problem only after you fix the first is a banner that gets
 * ignored.
 */
export function auditTemplateItems(
  items: Array<{ competencyName: string; weight: number }>,
): Refusal[] {
  const faults: Refusal[] = [];

  if (items.length === 0) {
    faults.push({ key: 'kpi.audit.noItems' });
    return faults;
  }

  const total = round2(items.reduce((sum, item) => sum + item.weight, 0));
  if (round2(Math.abs(total - TOTAL_WEIGHT)) > WEIGHT_TOLERANCE) {
    faults.push({
      key: total > TOTAL_WEIGHT ? 'kpi.audit.weightOver' : 'kpi.audit.weightUnder',
      vars: { total: total.toFixed(2), difference: Math.abs(round2(total - TOTAL_WEIGHT)).toFixed(2) },
    });
  }

  const seen = new Set<string>();
  for (const item of items) {
    const name = normaliseCompetencyName(item.competencyName).toLowerCase();
    if (name.length === 0) continue;
    if (seen.has(name)) {
      faults.push({
        key: 'kpi.audit.duplicateCompetency',
        vars: { name: normaliseCompetencyName(item.competencyName) },
      });
    }
    seen.add(name);
  }

  return faults;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoredLine {
  /** 0–100, or null when the reviewer has not answered this line yet. */
  score: number | null;
  /** Percent this line is worth. */
  weight: number;
}

/**
 * The weighted score, 0–100.
 *
 * `SUM(score × weight) / SUM(weight)`, rounded once at the end. Rounding each contribution first
 * drifts by a few hundredths, which is enough to move somebody across a grade boundary — and a
 * grade boundary is where a bonus changes.
 *
 * Unanswered lines are left out of both halves rather than counted as zero. This function feeds
 * the running total on a form being filled in, and counting the unanswered as zero would show a
 * reviewer 12% after their first answer of 60 — a number that is not wrong so much as about a
 * different question. Submission is where completeness is enforced, so by the time the figure is
 * stored there is nothing to leave out.
 */
export function weightedScore(lines: ScoredLine[]): number {
  let weighted = 0;
  let weight = 0;

  for (const line of lines) {
    if (line.score === null) continue;
    if (!Number.isFinite(line.score) || !Number.isFinite(line.weight)) return Number.NaN;
    if (line.weight <= 0) continue;
    weighted += line.score * line.weight;
    weight += line.weight;
  }

  if (weight <= 0) return Number.NaN;
  return round2(weighted / weight);
}

/** Whether one score is inside 0–100. */
export function checkScore(score: number): Refusal | null {
  if (!Number.isFinite(score)) return { key: 'kpi.refuse.badScore' };
  if (score < 0 || score > SCORE_MAX) {
    return { key: 'kpi.refuse.scoreRange', vars: { score, max: SCORE_MAX } };
  }
  return null;
}

/**
 * Whether every line on the form has been answered.
 *
 * A partial review must not be submittable. An unanswered line drops out of the weighted score,
 * so submitting early produces a real-looking percentage computed over a form the reviewer only
 * half read — and once signed, nothing on the record says which lines were skipped.
 */
export function checkComplete(input: { lineCount: number; scoredCount: number }): Refusal | null {
  if (input.lineCount <= 0) return { key: 'kpi.refuse.noItems' };
  if (input.scoredCount < input.lineCount) {
    return {
      key: 'kpi.refuse.incomplete',
      vars: { scored: input.scoredCount, total: input.lineCount },
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Grade bands
// ---------------------------------------------------------------------------

export interface GradeBand {
  code: string;
  /** Inclusive at both ends. */
  minScore: number;
  maxScore: number;
}

/**
 * Whether a set of bands covers 0–100 exactly once. First fault only; gates a save.
 *
 * Two failures, and the second is the one that hurts. Overlapping bands make the grade depend on
 * which band is read first. A gap means a score that earns no grade at all, which appears as a
 * blank on a review somebody has already signed and cannot be explained without reading the table.
 */
export function checkBands(bands: GradeBand[]): Refusal | null {
  const faults = auditBands(bands);
  return faults[0] ?? null;
}

/**
 * Every fault in a band set, in the order a reader would find them.
 *
 * Feeds the banner on the settings screen. Coverage faults are invisible in a table of numbers —
 * they surface when somebody submits a review and is refused, which is both the wrong person and
 * the wrong screen. Listing all of them means one visit fixes the table.
 */
export function auditBands(bands: GradeBand[]): Refusal[] {
  const faults: Refusal[] = [];

  if (bands.length === 0) return [{ key: 'kpi.refuse.noBands' }];

  for (const band of bands) {
    if (!Number.isFinite(band.minScore) || !Number.isFinite(band.maxScore)) {
      faults.push({ key: 'kpi.refuse.badBand', vars: { code: band.code } });
      continue;
    }
    if (band.minScore > band.maxScore) {
      faults.push({ key: 'kpi.refuse.bandOrder', vars: { code: band.code } });
    }
    if (band.minScore < 0 || band.maxScore > TOTAL_WEIGHT) {
      faults.push({ key: 'kpi.refuse.bandRange', vars: { code: band.code } });
    }
  }

  // Ordering faults are not meaningful once a band carries a nonsense number.
  if (faults.length > 0) return faults;

  const codes = bands.map((band) => band.code.toUpperCase());
  const seen = new Set<string>();
  for (const code of codes) {
    if (seen.has(code)) faults.push({ key: 'kpi.refuse.bandDuplicate', vars: { code } });
    seen.add(code);
  }

  const sorted = [...bands].sort((left, right) => left.minScore - right.minScore);

  const first = sorted[0];
  if (first !== undefined && first.minScore !== 0) {
    faults.push({ key: 'kpi.refuse.bandStart', vars: { lowest: first.minScore.toFixed(2) } });
  }

  const last = sorted[sorted.length - 1];
  if (last !== undefined && last.maxScore !== TOTAL_WEIGHT) {
    faults.push({ key: 'kpi.refuse.bandEnd', vars: { highest: last.maxScore.toFixed(2) } });
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;

    if (current.minScore <= previous.maxScore) {
      faults.push({
        key: 'kpi.refuse.bandOverlap',
        vars: { first: previous.code, second: current.code },
      });
      continue;
    }
    /*
     * Bands are inclusive, so the next one must start exactly one hundredth above the previous
     * one's top. Anything wider is a gap; `0–59.99` then `60–100` is contiguous, `0–59` then
     * `60–100` leaves every score between them ungraded.
     *
     * Rounded before comparing, for the same float reason as the weight sum above.
     */
    if (round2(current.minScore - previous.maxScore) > WEIGHT_TOLERANCE) {
      faults.push({
        key: 'kpi.refuse.bandGap',
        vars: {
          first: previous.code,
          second: current.code,
          from: round2(previous.maxScore + 0.01).toFixed(2),
          to: round2(current.minScore - 0.01).toFixed(2),
        },
      });
    }
  }

  return faults;
}

/**
 * The grade a score earns: the highest band whose floor it reaches.
 *
 * Only `minScore` is consulted. Reading `min <= x <= max` over an ascending list makes the answer
 * depend on list order wherever two bands touch — write A as 85–100 and B as 70–85 and a score of
 * exactly 85 grades as whichever came first, which is a different answer on the results screen
 * than on the review form. Descending by floor, a score on a boundary always takes the better
 * grade, which is also the answer somebody would defend out loud.
 *
 * A score above every ceiling still grades, rather than returning null: `auditBands` is where a
 * top band that stops short of 100 gets reported, and refusing to grade a perfect score is not the
 * way to report a settings fault.
 */
export function bandFor(total: number, bands: GradeBand[]): string | null {
  if (!Number.isFinite(total)) return null;
  const descending = [...bands].sort((left, right) => right.minScore - left.minScore);
  const match = descending.find((band) => total >= band.minScore);
  return match?.code ?? null;
}

// ---------------------------------------------------------------------------
// Bonus policy
// ---------------------------------------------------------------------------

/**
 * Whether a grade's bonus can stand, in months of basic salary.
 *
 * Null is a legitimate answer — a grade that carries no bonus — and is not this function's
 * business. Zero is refused because it is the same statement written in a way that reads as an
 * amount, and `0.00 bulan` on a screen invites somebody to wonder whether it failed to save.
 */
export function checkBonusMonths(months: number | null): Refusal | null {
  if (months === null) return null;
  if (!Number.isFinite(months)) return { key: 'kpi.refuse.badBonus' };
  if (months <= 0) return { key: 'kpi.refuse.bonusZero' };
  if (months > MAX_BONUS_MONTHS) {
    return { key: 'kpi.refuse.bonusCeiling', vars: { months, max: MAX_BONUS_MONTHS } };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lifecycles
// ---------------------------------------------------------------------------

/**
 * The period lifecycle. Forward only.
 *
 * A closed period does not reopen. The grades in it have been read, and where the payroll module
 * exists they may already have driven a bonus — reopening would let a figure that was paid on
 * change underneath the payment.
 */
const PERIOD_TRANSITIONS: Record<PeriodStatus, readonly PeriodStatus[]> = {
  open: ['closed'],
  closed: [],
};

export function periodTransitionAllowed(from: PeriodStatus, to: PeriodStatus): boolean {
  return PERIOD_TRANSITIONS[from].includes(to);
}

/**
 * The assignment lifecycle.
 *
 * `inProgress` is entered by the first score being saved rather than by a button, because a
 * reviewer who has started is in progress whether or not they pressed anything. `submitted` can
 * go back to `inProgress` — that is the reviewer being asked to look again — and `finalised` is
 * where it stops.
 */
const ASSIGNMENT_TRANSITIONS: Record<AssignmentStatus, readonly AssignmentStatus[]> = {
  pending: ['inProgress'],
  inProgress: ['submitted'],
  submitted: ['finalised', 'inProgress'],
  finalised: [],
};

export function assignmentTransitionAllowed(
  from: AssignmentStatus,
  to: AssignmentStatus,
): boolean {
  return ASSIGNMENT_TRANSITIONS[from].includes(to);
}

/** True once nothing further happens to an assignment. */
export function assignmentSettled(status: AssignmentStatus): boolean {
  return status === 'finalised';
}

/**
 * Whether scores may still be written.
 *
 * Both conditions, not either. A finished review is closed to edits, and a closed period is
 * closed to everything — including reviews inside it that were never submitted, which stay
 * unsubmitted rather than being quietly completed later.
 */
export function scoringOpen(input: {
  periodStatus: PeriodStatus;
  assignmentStatus: AssignmentStatus;
}): Refusal | null {
  if (input.periodStatus !== 'open') {
    return { key: 'kpi.refuse.periodClosed' };
  }
  if (input.assignmentStatus === 'finalised') {
    return { key: 'kpi.refuse.assignmentFinalised' };
  }
  return null;
}

/**
 * Whether this reviewer may be assigned to this subject.
 *
 * One reviewer, named on the assignment. There was a second, and a level chain behind it, and
 * both were removed: an appraisal is signed by a particular person who observed the work, and
 * "anybody at level 2" is the opposite of that claim.
 *
 * Reviewing yourself is the one conflict of interest cheap enough to check that there is no
 * reason not to.
 */
export function checkReviewer(input: {
  subjectStaffId: number;
  reviewerStaffId: number | null;
}): Refusal | null {
  if (input.reviewerStaffId !== null && input.reviewerStaffId === input.subjectStaffId) {
    return { key: 'kpi.refuse.selfReview' };
  }
  return null;
}

export interface PeriodCheckInput {
  fromDate: string;
  toDate: string;
  dueOn: string;
}

/** Why this period cannot stand, or null. */
export function checkPeriod(input: PeriodCheckInput): Refusal | null {
  for (const value of [input.fromDate, input.toDate, input.dueOn]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { key: 'kpi.refuse.badDate' };
  }

  // Compared as strings: `YYYY-MM-DD` sorts in date order and involves no timezone.
  if (input.toDate < input.fromDate) return { key: 'kpi.refuse.periodOrder' };

  /*
   * Reviews are due after the span being assessed, not during it. A due date inside the period
   * asks somebody to grade work that has not happened yet.
   */
  if (input.dueOn < input.toDate) return { key: 'kpi.refuse.dueBeforeEnd' };

  return null;
}
