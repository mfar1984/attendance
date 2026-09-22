import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { assertCan } from '../auth/plugin.js';
import { db, jsonSafe } from '../db.js';
import {
  APPROVAL_MODULES,
  MODULE_SETTING_KEYS,
  NOTIFY_MODULES,
  assertChainIdle,
  assertOneApprover,
  getChain,
  isApprovalModule,
  isNotifyModule,
  moduleSettings,
  renumberChain,
  type ApprovalModule,
  type NotifyModule,
} from '../hr/approval.js';
import {
  EVENT_AUDIENCE,
  defaultTemplate,
  eventsFor,
  isTemplateEvent,
  moduleRaises,
  placeholdersFor,
  renderTemplate,
  unknownPlaceholders,
} from '../hr/email-template.js';
import { conflict, notFound, parseBody, unauthorized } from '../http.js';
import { recordActivity } from '../logging/activity.js';

/**
 * Approval chains and per-module preferences, for every HR request module.
 *
 * One set of routes over a `:module` parameter rather than four near-identical sets. The
 * shape is genuinely the same, and four copies would be four places to fix the next bug in.
 *
 * This is what makes the modules configurable without a release: an organisation adds a
 * second approver by adding a row here, not by asking for a deployment.
 */

/**
 * The permission screen each module's configuration lives behind.
 *
 * Explicit rather than derived from the module name, because `leave` predates the HR
 * section and its key is `schedule.leave` — renaming it would silently drop the grant from
 * every saved role.
 */
const MODULE_SCREEN: Record<NotifyModule, string> = {
  leave: 'schedule.leave',
  overtime: 'hr.overtime',
  claim: 'hr.claims',
  expenses: 'hr.expenses',
  /*
   * The applicant chain is configured on the recruitment settings screen, not on the applicant
   * list — deciding one candidate and deciding who signs off on candidates are different jobs
   * held by different people.
   */
  applicants: 'hr.careerSettings',
  /*
   * Same reasoning for the two that have no chain: their notification settings live on the
   * module's own settings screen, which is a different grant from running a payroll period or
   * reopening an appraisal.
   */
  payroll: 'hr.payrollSettings',
  kpi: 'hr.kpiSettings',
  /*
   * On the justification screen itself, not on a settings page, because there is no settings page —
   * the module has three outcomes, one recipient, and no chain to configure. `edit` on that screen
   * is checked rather than `approve`: choosing the wording of the notice is a different act from
   * deciding somebody's explanation.
   */
  justification: 'attendance.justifications',
};

/**
 * How many of a module's requests are part-way up the chain.
 *
 * Consulted before the chain is edited. A request signed twice out of three times cannot
 * have the rungs moved underneath it: removing one would finalize it retroactively, and
 * adding one would ask a rung to sign after the request had already passed it.
 *
 * `claim` and `expenses` have no table yet, so they report zero — their chains are free to
 * configure ahead of the module, which is the point of allowing it.
 */
async function countPartway(module: ApprovalModule): Promise<number> {
  if (module === 'leave') {
    return db().leaveRequest.count({ where: { status: 'pending', currentLevel: { gt: 0 } } });
  }
  if (module === 'overtime') {
    return db().overtimeRequest.count({ where: { status: 'pending', currentLevel: { gt: 0 } } });
  }
  return 0;
}

export async function hrSettingsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Reads `:module` for the chain routes, which only five modules have.
   *
   * Kept separate from `notifyModuleParam` below so payroll and KPI answer 404 on the chain
   * endpoints. Accepting them would give each a chain screen that nothing consults — a set of
   * rungs somebody configures and no decision ever climbs.
   */
  function moduleParam(params: unknown): ApprovalModule {
    const parsed = z.object({ module: z.string() }).safeParse(params);
    if (!parsed.success || !isApprovalModule(parsed.data.module)) {
      throw notFound('Modul tidak dikenali');
    }
    return parsed.data.module;
  }

  /** Reads `:module` for settings, templates and preview — every module that sends mail. */
  function notifyModuleParam(params: unknown): NotifyModule {
    const parsed = z.object({ module: z.string() }).safeParse(params);
    if (!parsed.success || !isNotifyModule(parsed.data.module)) {
      throw notFound('Modul tidak dikenali');
    }
    return parsed.data.module;
  }

  function idParam(params: unknown): number {
    const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
    if (!parsed.success) throw notFound('Aras tidak dijumpai');
    return parsed.data.id;
  }

  // -------------------------------------------------------------------------
  // Approval chain
  // -------------------------------------------------------------------------

  /**
   * The chain, plus who could be put on it.
   *
   * The candidate lists come back with the chain rather than from a separate endpoint,
   * because the editor cannot render a rung without them and two round trips would let it
   * paint a chain whose approver names had not arrived yet.
   */
  app.get('/api/hr/:module/approval', async (request) => {
    if (!request.user) throw unauthorized();
    const module = moduleParam(request.params);
    assertCan(request.user, MODULE_SCREEN[module], 'view');

    const screen = MODULE_SCREEN[module];

    const [levels, accounts, roles] = await Promise.all([
      db().hrApprovalLevel.findMany({
        where: { module },
        orderBy: { level: 'asc' },
        include: {
          approverAccount: {
            select: { id: true, email: true, staff: { select: { fullName: true } } },
          },
          approverRole: { select: { id: true, name: true } },
        },
      }),
      db().userAccount.findMany({
        where: { status: 'active' },
        orderBy: { staff: { fullName: 'asc' } },
        select: {
          id: true,
          email: true,
          staff: { select: { fullName: true } },
          role: { select: { id: true, name: true, permissions: true } },
        },
      }),
      db().role.findMany({
        where: { status: 'active' },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, permissions: true },
      }),
    ]);

    /*
     * Candidates are filtered to whoever can actually approve this module.
     *
     * Offering an account that would be refused the moment it tried to sign is how a chain
     * gets built that stalls on its second rung, and the person who built it has no way to
     * see why.
     */
    const grants = (permissions: unknown): string[] => {
      const map = (permissions ?? {}) as Record<string, string[]>;
      return map[screen] ?? [];
    };

    return jsonSafe({
      module,
      levels: levels.map((row) => ({
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
        active: row.active,
        note: row.note,
      })),
      candidateAccounts: accounts
        .filter((account) => grants(account.role.permissions).includes('approve'))
        .map((account) => ({
          id: account.id,
          label: account.staff.fullName,
          email: account.email,
          roleName: account.role.name,
        })),
      candidateRoles: roles
        .filter((role) => grants(role.permissions).includes('approve'))
        .map((role) => ({ id: role.id, name: role.name })),
      /** Requests part-way up the chain, which is what blocks an edit. */
      partway: await countPartway(module),
    });
  });

  const levelSchema = z.object({
    approverAccountId: z.number().int().positive().nullable().optional(),
    approverRoleId: z.number().int().positive().nullable().optional(),
    note: z.union([z.literal(''), z.string().trim().max(255)]).optional(),
    active: z.boolean().optional(),
  });

  /** Appends a rung to the end of the chain. */
  app.post('/api/hr/:module/approval', async (request) => {
    if (!request.user) throw unauthorized();
    const module = moduleParam(request.params);
    assertCan(request.user, MODULE_SCREEN[module], 'configure');

    const body = parseBody(levelSchema, request.body);
    assertOneApprover(body);
    await assertChainIdle(module, countPartway);

    if (body.approverAccountId != null) {
      const account = await db().userAccount.findUnique({ where: { id: body.approverAccountId } });
      if (!account) throw notFound('Akaun tidak dijumpai');
    }
    if (body.approverRoleId != null) {
      const role = await db().role.findUnique({ where: { id: body.approverRoleId } });
      if (!role) throw notFound('Peranan tidak dijumpai');
    }

    const highest = await db().hrApprovalLevel.findFirst({
      where: { module },
      orderBy: { level: 'desc' },
      select: { level: true },
    });

    const row = await db().hrApprovalLevel.create({
      data: {
        module,
        level: (highest?.level ?? 0) + 1,
        approverAccountId: body.approverAccountId ?? null,
        approverRoleId: body.approverRoleId ?? null,
        note: body.note ? body.note : null,
        active: body.active ?? true,
      },
    });

    await recordActivity({
      request,
      action: 'hr.approval.level.added',
      category: 'settings',
      level: 'warn',
      detail: `${module}: aras ${row.level} ditambah`,
    });

    return jsonSafe({ id: row.id, level: row.level });
  });

  app.patch('/api/hr/:module/approval/:id', async (request) => {
    if (!request.user) throw unauthorized();
    const module = moduleParam(request.params);
    assertCan(request.user, MODULE_SCREEN[module], 'configure');

    const id = idParam(request.params);
    const body = parseBody(levelSchema, request.body);

    const existing = await db().hrApprovalLevel.findUnique({ where: { id } });
    if (!existing || existing.module !== module) throw notFound('Aras tidak dijumpai');

    // Only checked when the approver is actually changing: flipping `active` or editing a
    // note does not move a rung under a request that has passed it.
    const changingApprover =
      body.approverAccountId !== undefined || body.approverRoleId !== undefined;
    if (changingApprover) {
      assertOneApprover({
        approverAccountId: body.approverAccountId ?? null,
        approverRoleId: body.approverRoleId ?? null,
      });
      await assertChainIdle(module, countPartway);
    }

    const row = await db().hrApprovalLevel.update({
      where: { id },
      data: {
        ...(changingApprover
          ? {
              approverAccountId: body.approverAccountId ?? null,
              approverRoleId: body.approverRoleId ?? null,
            }
          : {}),
        ...(body.note === undefined ? {} : { note: body.note ? body.note : null }),
        ...(body.active === undefined ? {} : { active: body.active }),
      },
    });

    await recordActivity({
      request,
      action: 'hr.approval.level.updated',
      category: 'settings',
      level: 'warn',
      detail: `${module}: aras ${row.level} dikemas kini`,
    });

    return jsonSafe({ ok: true });
  });

  app.delete('/api/hr/:module/approval/:id', async (request) => {
    if (!request.user) throw unauthorized();
    const module = moduleParam(request.params);
    assertCan(request.user, MODULE_SCREEN[module], 'configure');

    const id = idParam(request.params);
    const existing = await db().hrApprovalLevel.findUnique({ where: { id } });
    if (!existing || existing.module !== module) throw notFound('Aras tidak dijumpai');

    await assertChainIdle(module, countPartway);

    await db().hrApprovalLevel.delete({ where: { id } });
    // Levels must stay contiguous: `finalized` compares against the chain length, so a gap
    // would settle a request at a rung nobody is on.
    await renumberChain(module);

    await recordActivity({
      request,
      action: 'hr.approval.level.removed',
      category: 'settings',
      level: 'warn',
      detail: `${module}: aras ${existing.level} dibuang`,
    });

    return { ok: true };
  });

  /**
   * Reorders the whole chain in one call.
   *
   * The full order rather than a move-up/move-down, because two rungs swapping places is a
   * pair of writes that the unique index rejects halfway through. Sending the intended
   * order lets the renumber run inside one transaction.
   */
  app.post('/api/hr/:module/approval/reorder', async (request) => {
    if (!request.user) throw unauthorized();
    const module = moduleParam(request.params);
    assertCan(request.user, MODULE_SCREEN[module], 'configure');

    const body = parseBody(
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(20) }),
      request.body,
    );

    await assertChainIdle(module, countPartway);

    const rows = await db().hrApprovalLevel.findMany({
      where: { module },
      select: { id: true },
    });
    const known = new Set(rows.map((row) => row.id));

    if (body.ids.length !== rows.length || body.ids.some((id) => !known.has(id))) {
      throw conflict('Susunan yang dihantar tidak sepadan dengan aras yang ada. Muat semula.');
    }

    await db().$transaction(async (tx) => {
      // Out of range first: the unique index on (module, level) rejects the intermediate
      // states of any reorder otherwise.
      for (const [index, id] of body.ids.entries()) {
        await tx.hrApprovalLevel.update({ where: { id }, data: { level: -(index + 1) } });
      }
      for (const [index, id] of body.ids.entries()) {
        await tx.hrApprovalLevel.update({ where: { id }, data: { level: index + 1 } });
      }
    });

    await recordActivity({
      request,
      action: 'hr.approval.reordered',
      category: 'settings',
      level: 'warn',
      detail: `${module}: ${body.ids.length} aras disusun semula`,
    });

    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Per-module preferences
  // -------------------------------------------------------------------------

  app.get('/api/hr/:module/settings', async (request) => {
    if (!request.user) throw unauthorized();
    const module = notifyModuleParam(request.params);
    assertCan(request.user, MODULE_SCREEN[module], 'view');

    /*
     * A module with no chain reports length 0, which is the truth rather than a special case.
     *
     * `notifyEveryLevel` and `notifyApprover` describe rungs, so at zero the screen hides them.
     * Payroll has no rungs at all — there is nobody to tell that something awaits their
     * signature, because nothing does.
     */
    const settings = await moduleSettings(module);
    const chainLength = isApprovalModule(module) ? (await getChain(module)).length : 0;

    return jsonSafe({ module, settings, chainLength });
  });

  app.put('/api/hr/:module/settings', async (request) => {
    if (!request.user) throw unauthorized();
    const module = notifyModuleParam(request.params);
    assertCan(request.user, MODULE_SCREEN[module], 'configure');

    const body = parseBody(
      z.object({
        notifyApplicant: z.boolean().optional(),
        notifyApprover: z.boolean().optional(),
        notifyEveryLevel: z.boolean().optional(),
        ccEmail: z.union([z.literal(''), z.email('Emel tidak sah').max(190)]).optional(),
      }),
      request.body,
    );

    const updates: Array<{ key: string; value: string }> = [];
    if (body.notifyApplicant !== undefined) {
      updates.push({ key: 'notifyApplicant', value: body.notifyApplicant ? '1' : '0' });
    }
    if (body.notifyApprover !== undefined) {
      updates.push({ key: 'notifyApprover', value: body.notifyApprover ? '1' : '0' });
    }
    if (body.notifyEveryLevel !== undefined) {
      updates.push({ key: 'notifyEveryLevel', value: body.notifyEveryLevel ? '1' : '0' });
    }
    if (body.ccEmail !== undefined) updates.push({ key: 'ccEmail', value: body.ccEmail });

    for (const update of updates) {
      if (!(MODULE_SETTING_KEYS as string[]).includes(update.key)) continue;
      await db().hrModuleSetting.upsert({
        where: { module_key: { module, key: update.key } },
        create: {
          module,
          key: update.key,
          value: update.value,
          updatedBy: request.user.accountId,
        },
        update: { value: update.value, updatedBy: request.user.accountId },
      });
    }

    await recordActivity({
      request,
      action: 'hr.settings.updated',
      category: 'settings',
      detail: `${module}: ${updates.map((row) => row.key).join(', ') || 'tiada perubahan'}`,
    });

    return jsonSafe({ settings: await moduleSettings(module) });
  });

  // -------------------------------------------------------------------------
  // Email templates
  // -------------------------------------------------------------------------

  /**
   * Every event's wording, plus what a template may refer to and which profiles exist.
   *
   * All three together because the editor cannot be rendered without them: a placeholder list
   * it does not have is a list somebody guesses at, and a profile picker with no options
   * looks broken rather than unconfigured.
   */
  app.get('/api/hr/:module/templates', async (request) => {
    if (!request.user) throw unauthorized();
    const module = notifyModuleParam(request.params);
    assertCan(request.user, MODULE_SCREEN[module], 'view');

    const [stored, profiles] = await Promise.all([
      db().hrEmailTemplate.findMany({ where: { module } }),
      db().emailProfile.findMany({
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
        select: { key: true, name: true, fromName: true, fromEmail: true, active: true },
      }),
    ]);

    const byEvent = new Map(stored.map((row) => [row.event, row]));

    return jsonSafe({
      module,
      // Only the events this module raises. Listing all of them would put `rejected` on the
      // payroll editor, where nothing can ever fire it.
      templates: eventsFor(module).map((event) => {
        const row = byEvent.get(event);
        const seeded = defaultTemplate(module, event);
        return {
          event,
          audience: EVENT_AUDIENCE[event],
          subject: row?.subject ?? seeded.subject,
          body: row?.body ?? seeded.body,
          enabled: row?.enabled ?? true,
          /** False means the wording shown is the seeded default, not something saved. */
          customised: row !== undefined,
          /** So the editor can offer a revert without holding a second copy of the text. */
          defaultSubject: seeded.subject,
          defaultBody: seeded.body,
        };
      }),
      placeholders: placeholdersFor(module),
      profiles,
    });
  });

  app.put('/api/hr/:module/templates/:event', async (request) => {
    if (!request.user) throw unauthorized();
    const module = notifyModuleParam(request.params);
    assertCan(request.user, MODULE_SCREEN[module], 'configure');

    const params = z.object({ event: z.string() }).safeParse(request.params);
    if (!params.success || !isTemplateEvent(params.data.event)) {
      throw notFound('Peristiwa notifikasi tidak dikenali');
    }
    // An event this module never raises is a 404 rather than a stored row nothing reads.
    if (!moduleRaises(module, params.data.event)) {
      throw notFound('Modul ini tidak membangkitkan peristiwa itu');
    }
    const event = params.data.event;

    const body = parseBody(
      z.object({
        subject: z.string().trim().min(1).max(255),
        body: z.string().trim().min(1).max(8000),
        enabled: z.boolean().optional(),
      }),
      request.body,
    );

    /*
     * Unknown placeholders are refused at save time, naming them.
     *
     * This is the only moment the mistake is cheap. Accepted here, `{{staffNmae}}` renders as
     * an em dash in front of a recipient, and the person who typed it has no way to know.
     */
    const unknown = [
      ...new Set([
        ...unknownPlaceholders(body.subject, module),
        ...unknownPlaceholders(body.body, module),
      ]),
    ];
    if (unknown.length > 0) {
      throw conflict(
        `Templat merujuk medan yang modul ini tidak boleh isi: ${unknown
          .map((name) => `{{${name}}}`)
          .join(', ')}. Buang atau betulkannya.`,
      );
    }

    await db().hrEmailTemplate.upsert({
      where: { module_event: { module, event } },
      create: {
        module,
        event,
        subject: body.subject,
        body: body.body,
        enabled: body.enabled ?? true,
        updatedBy: request.user.accountId,
      },
      update: {
        subject: body.subject,
        body: body.body,
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
        updatedBy: request.user.accountId,
      },
    });

    await recordActivity({
      request,
      action: 'hr.template.updated',
      category: 'settings',
      detail: `${module}/${event}`,
    });

    return { ok: true };
  });

  /**
   * Drops the stored row so the seeded default applies again.
   *
   * A revert rather than an overwrite with the default text: an absent row means "not
   * customised", and writing the default back would leave the screen claiming somebody had
   * deliberately chosen it.
   */
  app.delete('/api/hr/:module/templates/:event', async (request) => {
    if (!request.user) throw unauthorized();
    const module = notifyModuleParam(request.params);
    assertCan(request.user, MODULE_SCREEN[module], 'configure');

    const params = z.object({ event: z.string() }).safeParse(request.params);
    if (!params.success || !isTemplateEvent(params.data.event)) {
      throw notFound('Peristiwa notifikasi tidak dikenali');
    }
    // An event this module never raises is a 404 rather than a stored row nothing reads.
    if (!moduleRaises(module, params.data.event)) {
      throw notFound('Modul ini tidak membangkitkan peristiwa itu');
    }

    await db().hrEmailTemplate.deleteMany({
      where: { module, event: params.data.event },
    });

    await recordActivity({
      request,
      action: 'hr.template.reverted',
      category: 'settings',
      level: 'warn',
      detail: `${module}/${params.data.event}`,
    });

    return { ok: true };
  });

  /**
   * Renders one template against sample values, without sending anything.
   *
   * The preview resolves through the same `renderTemplate` the dispatcher uses. A preview
   * built by a second code path is a preview that can disagree with the mail actually sent,
   * which is worse than no preview.
   */
  app.post('/api/hr/:module/templates/:event/preview', async (request) => {
    if (!request.user) throw unauthorized();
    const module = notifyModuleParam(request.params);
    assertCan(request.user, MODULE_SCREEN[module], 'view');

    const params = z.object({ event: z.string() }).safeParse(request.params);
    if (!params.success || !isTemplateEvent(params.data.event)) {
      throw notFound('Peristiwa notifikasi tidak dikenali');
    }
    // An event this module never raises is a 404 rather than a stored row nothing reads.
    if (!moduleRaises(module, params.data.event)) {
      throw notFound('Modul ini tidak membangkitkan peristiwa itu');
    }

    const body = parseBody(
      z.object({
        subject: z.string().max(255),
        body: z.string().max(8000),
      }),
      request.body,
    );

    const vars = sampleVars(module);
    const subject = renderTemplate(body.subject, vars);
    const rendered = renderTemplate(body.body, vars);

    return jsonSafe({
      subject: subject.output,
      body: rendered.output,
      unknown: [...new Set([...subject.unknown, ...rendered.unknown])],
    });
  });

  /**
   * Both lists, so a screen does not hard-code either.
   *
   * `approval` is narrower than `notify` on purpose: payroll and KPI send mail and have no chain.
   * Returning one list would make a caller guess which endpoints a module answers.
   */
  app.get('/api/hr/modules', async (request) => {
    if (!request.user) throw unauthorized();
    return { modules: APPROVAL_MODULES, notify: NOTIFY_MODULES };
  });
}

/**
 * Believable values for the preview.
 *
 * Deliberately obvious as samples — a real-looking name in a preview gets mistaken for real
 * data, and somebody eventually asks why the system emailed Ahmad.
 */
function sampleVars(module: NotifyModule): Record<string, string | number> {
  const common = {
    organisation: 'Hospital Sibu',
    staffName: '[Nama Staf]',
    employeeNo: '[No. Staf]',
    requestNo: 'CONTOH-001',
    status: 'approved',
    decidedBy: '[Nama Pelulus]',
    note: '[Catatan keputusan]',
    level: 1,
    totalLevels: 2,
    awaitingLevel: 2,
    awaitingApprover: '[Pelulus Aras 2]',
  };

  const perModule: Record<NotifyModule, Record<string, string | number>> = {
    leave: { leaveType: 'Cuti Tahunan', fromDate: '2026-09-14', toDate: '2026-09-16', days: 3 },
    overtime: {
      workDate: '2026-09-10',
      hours: '3',
      measuredHours: '3.5',
      multiplier: '1.5×',
      amount: 'RM 67.50',
      dayType: 'weekday',
    },
    claim: {
      claimType: 'Tuntutan Perjalanan',
      incurredOn: '2026-09-08',
      amount: 'RM 72.00',
      approvedAmount: 'RM 72.00',
      quantity: '120',
    },
    expenses: {
      category: 'Alat Tulis',
      incurredOn: '2026-09-05',
      payee: '[Nama Penerima]',
      amount: 'RM 45.90',
      approvedAmount: 'RM 45.90',
    },
    applicants: {
      jobTitle: 'Jururawat U29',
      postingCode: 'IKLAN-001',
      applicantNo: 'PMH-202609-001',
      pipelineStatus: 'offered',
      interviewAt: '2026-09-18 10:00',
    },
    payroll: {
      periodCode: '2026-09',
      periodName: 'Gaji September 2026',
      paymentDate: '2026-09-25',
      gross: '4,320.00',
      deductions: '712.40',
      netPay: '3,607.60',
      payslipNo: 'PS-202609-001',
      amount: '500.00',
      instalment: '200.00',
      balance: '1,000.00',
      startsOn: '2026-10-01',
    },
    kpi: {
      periodName: 'Penilaian Separuh Tahun 2026',
      templateName: 'Kompetensi Klinikal',
      dueOn: '2026-10-15',
      totalScore: '86.50',
      grade: 'A — Cemerlang',
      reviewer: '[Nama Penilai]',
    },
    justification: {
      workDate: '2026-09-12',
      statusKind: 'late',
      shiftName: 'Pagi 08:00–16:00',
      checkInAt: '2026-09-12 08:23',
      checkOutAt: '2026-09-12 16:05',
      lateMinutes: 23,
    },
  };

  return { ...common, ...perModule[module] };
}
