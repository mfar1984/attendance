/**
 * The approval chain, shared by every HR request module.
 *
 * One engine rather than one per module, because the question is the same in each: who
 * signs, in what order, and what happens when the last one does. Four copies would be four
 * chances for the fourth to disagree — and the one that disagrees is the one nobody tests.
 *
 * The whole point is that the chain is data. An organisation adds a second approver by
 * adding a row, not by asking for a release.
 */
import { db } from '../db.js';
import { conflict, forbidden } from '../http.js';
import { defaultTemplate, type TemplateEvent } from './email-template.js';

/**
 * Modules that have an approval chain.
 *
 * `leave` and `overtime` are wired. `claim` and `expenses` have their tables still to
 * build; they are listed so the settings screen can be configured ahead of the module, the
 * way the reference does — a chain saved before the module exists is simply not consulted
 * yet, which is different from a chain that cannot be saved.
 */
export const APPROVAL_MODULES = ['leave', 'overtime', 'claim', 'expenses', 'applicants'] as const;

export type ApprovalModule = (typeof APPROVAL_MODULES)[number];

export function isApprovalModule(value: string): value is ApprovalModule {
  return (APPROVAL_MODULES as readonly string[]).includes(value);
}

/**
 * Modules that send mail, which is a wider set than modules that have an approval chain.
 *
 * Payroll and KPI belong here and not above, and the distinction is not bookkeeping. A chain is
 * `pending → approved | rejected` with a rung somebody is currently on. A payroll period is
 * `draft → processing → approved → paid → closed` with no rung and no rejection, and a KPI
 * assignment moves through scoring rather than through signatures. Giving either one a chain
 * would produce a screen of rungs that no code path ever consults — the reference tried exactly
 * that for payroll and had to delete the permission rows again.
 *
 * They still have people to notify, an email profile to nominate, and wording somebody wants to
 * own. That is what this list is for.
 */
export const NOTIFY_MODULES = [...APPROVAL_MODULES, 'payroll', 'kpi', 'justification'] as const;

export type NotifyModule = (typeof NOTIFY_MODULES)[number];

export function isNotifyModule(value: string): value is NotifyModule {
  return (NOTIFY_MODULES as readonly string[]).includes(value);
}

export interface ChainLevel {
  id: number;
  level: number;
  approverAccountId: number | null;
  approverRoleId: number | null;
  /** Name of the account or the role, whichever this rung names. */
  approverLabel: string;
  /** True when the rung names a role rather than one person. */
  byRole: boolean;
  note: string | null;
}

/**
 * The active chain for a module, lowest rung first.
 *
 * Inactive rungs are dropped rather than kept as gaps. A suspended rung should shorten the
 * chain, not stall every request at a rung nobody is on.
 */
export async function getChain(module: ApprovalModule): Promise<ChainLevel[]> {
  const rows = await db().hrApprovalLevel.findMany({
    where: { module, active: true },
    orderBy: { level: 'asc' },
    include: {
      approverAccount: { select: { id: true, email: true, staff: { select: { fullName: true } } } },
      approverRole: { select: { id: true, name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    level: row.level,
    approverAccountId: row.approverAccountId,
    approverRoleId: row.approverRoleId,
    approverLabel:
      row.approverAccount?.staff.fullName ??
      row.approverAccount?.email ??
      row.approverRole?.name ??
      '—',
    byRole: row.approverRoleId !== null,
    note: row.note,
  }));
}

/** Decision history for one request, oldest first. */
export async function getTrail(
  module: ApprovalModule,
  applicationId: number,
): Promise<
  Array<{
    id: number;
    level: number;
    action: string;
    actorLabel: string;
    remarks: string | null;
    createdAt: string;
  }>
> {
  const rows = await db().hrApprovalRecord.findMany({
    where: { module, applicationId },
    orderBy: { id: 'asc' },
  });

  return rows.map((row) => ({
    id: row.id,
    level: row.level,
    action: row.action,
    actorLabel: row.actorLabel,
    remarks: row.remarks,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * Trail rows for a request that is being deleted.
 *
 * `applicationId` has no foreign key — it means a different table per module — so nothing
 * cascades. Without this call the trail survives the request and then attaches itself to
 * whichever row next takes that id.
 */
export async function deleteTrail(
  module: ApprovalModule,
  applicationId: number,
): Promise<number> {
  const result = await db().hrApprovalRecord.deleteMany({ where: { module, applicationId } });
  return result.count;
}

/**
 * Where a decision leaves a request, as arithmetic only.
 *
 * Split from the write so it can be tested without a database. This is the part the
 * reference got wrong twice — a rejection recorded at rung 1 while the request stayed at
 * rung 0, and a chain whose length disagreed with its highest rung — and both were silent.
 */
export function resolveOutcome(input: {
  action: 'approve' | 'reject';
  currentLevel: number;
  chainLength: number;
}): {
  status: 'pending' | 'approved' | 'rejected';
  level: number;
  finalized: boolean;
  awaitingLevel: number | null;
} {
  if (input.action === 'reject') {
    // Terminal wherever it happened. Rung 1 when nothing had been signed yet, so the trail
    // never records a decision at rung 0.
    const level = input.currentLevel > 0 ? input.currentLevel : 1;
    return { status: 'rejected', level, finalized: true, awaitingLevel: null };
  }

  if (input.chainLength === 0) {
    return { status: 'approved', level: 1, finalized: true, awaitingLevel: null };
  }

  const level = input.currentLevel + 1;
  const finalized = level >= input.chainLength;
  return {
    status: finalized ? 'approved' : 'pending',
    level,
    finalized,
    awaitingLevel: finalized ? null : level + 1,
  };
}

/**
 * The words a module stores in its own status column for each outcome.
 *
 * Four of the five modules hold literally `pending | approved | rejected`, and that is the
 * default. `applicants` does not: its status column is a recruitment pipeline, and there is no
 * such thing as an "approved" candidate. Writing that word would either be coerced to
 * something meaningless or rejected outright, and either way the register would lose track of
 * where the person is. It maps the same three outcomes onto `interview | offered | rejected`.
 *
 * Passed in rather than looked up from the module, because the mapping is a property of the
 * decision being made — the same table could one day carry a chain over a different question —
 * and a lookup here would be a second place the module list lives.
 */
export interface StatusWords {
  /** Written while the chain is still climbing. */
  pending: string;
  /** Written when the last rung signs. */
  approved: string;
  /** Written on a rejection at any rung. */
  rejected: string;
}

const DEFAULT_STATUS_WORDS: StatusWords = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
};

export interface ApprovalOutcome {
  /** What the decision means, regardless of the word the module stores. */
  status: 'pending' | 'approved' | 'rejected';
  /** The word the caller should actually write to its own column. */
  writtenStatus: string;
  /** The rung just recorded. */
  level: number;
  /** Length of the configured chain. Zero when none is configured. */
  totalLevels: number;
  /** True when this decision settled the request for good. */
  finalized: boolean;
  /** The rung now waiting, or null when nothing is. */
  awaitingLevel: number | null;
  /** Who that rung belongs to, for the message the caller returns. */
  awaitingLabel: string | null;
}

/**
 * Is this account allowed to act on the rung this request is waiting for?
 *
 * Holding the module's `approve` action is not enough once a chain exists: rung 2 must not
 * be able to sign before rung 1 has. Returns a refusal message, or null when allowed.
 *
 * ── The override, and why it is a permission rather than a role name ──
 *
 * Without a way past the chain, a request stalls forever the day an approver leaves the
 * organisation. The reference solves this by exempting Super Admin, but a name comparison
 * is not a capability — it breaks when somebody renames the role, and it cannot be granted
 * to anybody else.
 *
 * Here the override is the module's own `configure` action: whoever may rewrite the chain
 * may also step past it. That is the same authority expressed once instead of twice, and it
 * is already audited.
 *
 * Unlike the reference, an account that is merely absent from the chain is NOT waved
 * through. Holding `approve` while sitting off the chain would make the chain advisory for
 * everybody it does not name, which is most people.
 */
export async function checkApproverTurn(options: {
  module: ApprovalModule;
  currentLevel: number;
  accountId: number;
  roleId: number;
  /** Holder of the module's `configure` action. */
  mayOverride: boolean;
}): Promise<string | null> {
  if (options.mayOverride) return null;

  const chain = await getChain(options.module);
  if (chain.length === 0) return null;

  const mine = chain
    .filter(
      (rung) =>
        rung.approverAccountId === options.accountId || rung.approverRoleId === options.roleId,
    )
    .map((rung) => rung.level);

  const nextLevel = options.currentLevel + 1;

  if (mine.length === 0) {
    const waiting = chain.find((rung) => rung.level === nextLevel);
    return (
      `Aliran kelulusan untuk modul ini menetapkan siapa menandatangani, dan anda tiada pada ` +
      `mana-mana arasnya. Aras ${nextLevel}` +
      `${waiting ? ` (${waiting.approverLabel})` : ''} yang perlu memutuskan ini.`
    );
  }


  if (mine.includes(nextLevel)) return null;

  const lowest = Math.min(...mine);
  if (lowest > nextLevel) {
    const waiting = chain.find((rung) => rung.level === nextLevel);
    return (
      `Permohonan ini menunggu kelulusan aras ${nextLevel}` +
      `${waiting ? ` (${waiting.approverLabel})` : ''}. Anda meluluskan pada aras ${lowest}.`
    );
  }
  return 'Anda sudah meluluskan permohonan ini pada aras anda.';
}

/**
 * Records a decision and moves the request along.
 *
 * Writes the trail row and returns what the caller should store. It deliberately does not
 * touch the module's own table: the status column, the amount, the roster side effect and
 * the audit entry all differ per module, and folding them in here would make this the
 * place every module's rules leak into.
 *
 * ── The rung on the request must equal the rung in the trail ──
 *
 * The reference implementation recorded rejections and no-chain approvals at rung 1 while
 * leaving the request's `currentLevel` at 0. Two records of one decision, disagreeing — and
 * to this engine a settled request at rung 0 reads as unsigned, which is what
 * `checkApproverTurn` consults. Both branches below return the rung they wrote, and the
 * caller stores exactly that.
 */
export async function applyApprovalAction(options: {
  module: ApprovalModule;
  applicationId: number;
  action: 'approve' | 'reject';
  actor: { accountId: number; label: string };
  remarks?: string | null;
  currentLevel: number;
  /** Omit for the four modules whose column holds `pending | approved | rejected`. */
  statusWords?: StatusWords;
}): Promise<ApprovalOutcome> {
  const chain = await getChain(options.module);
  const words = options.statusWords ?? DEFAULT_STATUS_WORDS;
  const remarks = (options.remarks ?? '').trim().slice(0, 500) || null;

  const record = async (level: number, action: 'approved' | 'rejected'): Promise<void> => {
    await db().hrApprovalRecord.create({
      data: {
        module: options.module,
        applicationId: options.applicationId,
        level,
        action,
        actorAccountId: options.actor.accountId,
        actorLabel: options.actor.label,
        remarks,
      },
    });
  };

  const outcome = resolveOutcome({
    action: options.action,
    currentLevel: options.currentLevel,
    chainLength: chain.length,
  });

  // The rung written to the trail is the rung the caller stores on the request.
  await record(outcome.level, outcome.status === 'rejected' ? 'rejected' : 'approved');

  const awaiting =
    outcome.awaitingLevel === null
      ? null
      : (chain.find((rung) => rung.level === outcome.awaitingLevel) ?? null);

  return {
    ...outcome,
    writtenStatus: words[outcome.status],
    totalLevels: chain.length,
    awaitingLabel: awaiting?.approverLabel ?? null,
  };
}

// ---------------------------------------------------------------------------
// Per-module preferences
// ---------------------------------------------------------------------------

/**
 * The switches each request module carries.
 *
 * Booleans are stored as `'1'` and `'0'`. Defaults are the behaviour before any of this was
 * configurable, so an installation that never opens the settings screen keeps working the
 * way it did.
 */
export const MODULE_SETTING_DEFAULTS = {
  /**
   * Which email profile this module's mail goes out through, by `EmailProfile.key`.
   *
   * Blank means no email — and that is the honest default, because there may be no profile
   * configured at all. Nominating one is what makes email answerable: `notify/dispatch.ts`
   * deliberately refused to send any until a module could say which sender to use, since
   * picking whichever profile happened to be first would put hospital mail out under a
   * sender nobody chose and land the replies in that department's inbox.
   *
   * Stored as the key, not the row id, matching how `sendMail` selects a profile. A profile
   * can then be repointed at a different relay without touching what names it.
   */
  emailProfileKey: '',
  /** Tell the applicant when the request is settled. */
  notifyApplicant: '1',
  /** Tell the rung now waiting that something needs signing. */
  notifyApprover: '1',
  /**
   * Off by default, and that is the point.
   *
   * Telling somebody "approved" at rung 1 of 3 tells them something untrue: the request is
   * still pending and could be refused higher up.
   */
  notifyEveryLevel: '0',
  /** Extra address copied on every decision. Blank for none. */
  ccEmail: '',
} as const;

export type ModuleSettingKey = keyof typeof MODULE_SETTING_DEFAULTS;

export const MODULE_SETTING_KEYS = Object.keys(MODULE_SETTING_DEFAULTS) as ModuleSettingKey[];

export type ModuleSettings = Record<ModuleSettingKey, string>;

/** Stored values over the defaults, so a missing row is the default rather than empty. */
export async function moduleSettings(module: NotifyModule): Promise<ModuleSettings> {
  const rows = await db().hrModuleSetting.findMany({ where: { module } });
  const result: ModuleSettings = { ...MODULE_SETTING_DEFAULTS };

  for (const row of rows) {
    if ((MODULE_SETTING_KEYS as string[]).includes(row.key)) {
      result[row.key as ModuleSettingKey] = row.value;
    }
  }
  return result;
}

export function settingIsOn(settings: ModuleSettings, key: ModuleSettingKey): boolean {
  return settings[key] === '1';
}

/**
 * The wording for one event, falling back to the seeded default.
 *
 * A missing row is not a missing template. Defaults are code, so an installation that never
 * opens the editor still sends readable mail, and a stored row means somebody has deliberately
 * changed it.
 *
 * Returns null when the event has been switched off, so the caller sends nothing rather than
 * sending an empty message.
 */
export async function emailTemplateFor(
  module: NotifyModule,
  event: TemplateEvent,
): Promise<{ subject: string; body: string; customised: boolean } | null> {
  const row = await db().hrEmailTemplate.findUnique({
    where: { module_event: { module, event } },
  });

  if (row !== null && !row.enabled) return null;
  if (row !== null) return { subject: row.subject, body: row.body, customised: true };

  const seeded = defaultTemplate(module, event);
  return { ...seeded, customised: false };
}

/**
 * Whether a decision at this rung should be announced to the applicant.
 *
 * A settled request always is. An intermediate rung only when the installation asked for
 * it, because the honest description of rung 1 of 3 is "still waiting", not "approved".
 */
export function shouldNotifyApplicant(
  settings: ModuleSettings,
  outcome: ApprovalOutcome,
): boolean {
  if (!settingIsOn(settings, 'notifyApplicant')) return false;
  if (outcome.finalized) return true;
  return settingIsOn(settings, 'notifyEveryLevel');
}

// ---------------------------------------------------------------------------
// Chain editing
// ---------------------------------------------------------------------------

/**
 * Rejects a rung that names both an approver and a role, or neither.
 *
 * A rung naming neither is a rung nothing can satisfy, which stalls every request that
 * reaches it. A rung naming both leaves the engine to pick, and whichever it picked would
 * be a rule nobody wrote down.
 */
export function assertOneApprover(input: {
  approverAccountId?: number | null;
  approverRoleId?: number | null;
}): void {
  const hasAccount = input.approverAccountId !== null && input.approverAccountId !== undefined;
  const hasRole = input.approverRoleId !== null && input.approverRoleId !== undefined;

  if (hasAccount && hasRole) {
    throw conflict('Satu aras menamakan seorang pengguna ATAU satu peranan, bukan kedua-duanya.');
  }
  if (!hasAccount && !hasRole) {
    throw conflict('Satu aras mesti menamakan seorang pengguna atau satu peranan.');
  }
}

/**
 * Renumbers a module's rungs to 1..n after an insert, delete or reorder.
 *
 * Contiguous levels are not cosmetic. `finalized` is `nextLevel >= chain.length`, so a
 * chain numbered 1, 2, 4 would report length 3 and settle at rung 3 — which nobody is on.
 *
 * Done in a transaction, moving every row out of range first: the unique index on
 * `(module, level)` would otherwise reject the intermediate states of any reorder.
 */
export async function renumberChain(module: ApprovalModule): Promise<void> {
  await db().$transaction(async (tx) => {
    const rows = await tx.hrApprovalLevel.findMany({
      where: { module },
      orderBy: { level: 'asc' },
      select: { id: true },
    });

    // Negative levels are free of collisions and cannot match a real rung.
    for (const [index, row] of rows.entries()) {
      await tx.hrApprovalLevel.update({ where: { id: row.id }, data: { level: -(index + 1) } });
    }
    for (const [index, row] of rows.entries()) {
      await tx.hrApprovalLevel.update({ where: { id: row.id }, data: { level: index + 1 } });
    }
  });
}

/**
 * Refuses a chain change while requests are part-way through it.
 *
 * A request sitting at rung 2 of 3 has already been signed twice. Removing a rung would
 * make it finalized retroactively, and inserting one would ask a rung to sign after the
 * request had passed it. Neither is a decision anybody made.
 */
export async function assertChainIdle(
  module: ApprovalModule,
  countPartway: (module: ApprovalModule) => Promise<number>,
): Promise<void> {
  const inFlight = await countPartway(module);
  if (inFlight > 0) {
    throw forbidden(
      `${inFlight} permohonan sudah separuh melalui rantaian ini. Selesaikan atau tolaknya ` +
        'dahulu — mengubah aras sekarang akan menukar keputusan yang sudah dibuat.',
    );
  }
}
