import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requirePermission } from '../auth/plugin.js';
import { db, jsonSafe } from '../db.js';
import {
  ASSIGNMENT_STATUSES,
  COMPETENCY_CATEGORIES,
  MAX_BONUS_MONTHS,
  PERIOD_STATUSES,
  SCORE_MAX,
  assignmentTransitionAllowed,
  auditBands,
  auditTemplateItems,
  bandFor,
  checkBands,
  checkBonusMonths,
  checkComplete,
  checkCompetency,
  checkPeriod,
  checkReviewer,
  checkScore,
  checkWeights,
  normaliseCompetencyName,
  periodTransitionAllowed,
  scoringOpen,
  weightedScore,
  type AssignmentStatus,
  type PeriodStatus,
  type Refusal,
} from '../hr/kpi.js';
import { moduleSettings, settingIsOn } from '../hr/approval.js';
import { conflict, forbidden, notFound, parseBody, unauthorized } from '../http.js';
import { recordActivity } from '../logging/activity.js';
import { notify } from '../notify/dispatch.js';
import { asDateOnly, dateOnlyKey } from '../time.js';

/**
 * KPI: the competency catalogue, forms, periods, assignments, scoring, and the grades that come
 * out.
 *
 * ## No approval chain
 *
 * An appraisal is reviewed by the named reviewer on the assignment. An earlier version routed it
 * through `hr_approval_records` with a `currentLevel`, alongside leave and claims, and it had to be
 * unwound: a chain says "anybody holding level 2 may sign this", and the entire claim an appraisal
 * makes is that a particular person who observed the work signed it. The chain also produced rows
 * in a shared table that no KPI screen could show, so a review could be approved from a screen
 * that knew nothing about competencies.
 *
 * ## The employee does not score themselves
 *
 * There is no self-assessment route. There was, guarded so the subject could only write to their
 * own assignment, and it was deleted rather than tightened — a form holding both the employee's
 * figure and the reviewer's figure needs a rule for which one is the grade, and no such rule was
 * ever agreed. Self-assessment is a feature to design, not a permission to loosen.
 *
 * ## The permission split
 *
 * `hr.kpiResults` is read-only and separate from `hr.kpiReviews` because a finished grade and the
 * review behind it are different secrets: a grade may carry a bonus, and the people who may read it
 * are not the people who may reopen the assessment that produced it.
 */

function idParam(params: unknown): number {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
  if (!parsed.success) throw notFound('Rekod tidak dijumpai');
  return parsed.data.id;
}

/**
 * Refusals as prose, on the server.
 *
 * The steering rule is that routes send keys and the web resolves them, and this is the stated
 * exception: an error message is prose, and prose needs words. Screen *content* — the audit banner
 * on the settings page — is sent as `{ key, vars }` and resolved by the web, which is why
 * `auditBands` returns keys and this function is only reached on a 409.
 */
function refusalMessage(refusal: Refusal): string {
  const v = refusal.vars ?? {};
  switch (refusal.key) {
    case 'kpi.refuse.competencyName':
      return 'Nama kompetensi tidak boleh kosong.';
    case 'kpi.refuse.competencyNameLong':
      return 'Nama kompetensi terlalu panjang — maksimum 190 aksara.';
    case 'kpi.refuse.competencyCategory':
      return 'Kategori mesti Teras, Fungsian atau Kepimpinan.';
    case 'kpi.refuse.noItems':
      return 'Borang mesti mempunyai sekurang-kurangnya satu kompetensi.';
    case 'kpi.refuse.badWeight':
      return 'Setiap pemberat mesti lebih daripada sifar.';
    case 'kpi.refuse.weightTooLarge':
      return 'Satu pemberat tidak boleh melebihi 100.';
    case 'kpi.refuse.weightSum':
      return (
        `Pemberat berjumlah ${String(v.total ?? '?')}, bukan 100. Dua orang hanya berada pada ` +
        'skala yang sama jika kedua-dua borang dibaca atas jumlah yang sama.'
      );
    case 'kpi.refuse.badScore':
      return 'Markah mesti nombor.';
    case 'kpi.refuse.scoreRange':
      return `Markah ${String(v.score ?? '?')} di luar 0–${String(v.max ?? SCORE_MAX)}.`;
    case 'kpi.refuse.incomplete':
      return (
        `${String(v.scored ?? '?')} daripada ${String(v.total ?? '?')} kompetensi diberi markah. ` +
        'Kompetensi yang tidak dijawab tercicir dari pengiraan, jadi jumlahnya akan dikira atas ' +
        'borang yang hanya separuh dibaca.'
      );
    case 'kpi.refuse.noBands':
      return 'Sekurang-kurangnya satu jalur gred diperlukan.';
    case 'kpi.refuse.badBand':
      return `Jalur gred ${String(v.code ?? '?')} mempunyai nombor tidak sah.`;
    case 'kpi.refuse.bandOrder':
      return `Gred ${String(v.code ?? '?')}: markah minimum melebihi maksimum.`;
    case 'kpi.refuse.bandRange':
      return `Gred ${String(v.code ?? '?')} berada di luar 0–100.`;
    case 'kpi.refuse.bandDuplicate':
      return `Kod gred "${String(v.code ?? '?')}" digunakan lebih daripada sekali.`;
    case 'kpi.refuse.bandStart':
      return (
        `Jalur terendah bermula pada ${String(v.lowest ?? '?')}, bukan 0. Markah di bawah itu ` +
        'tidak mendapat gred sama sekali.'
      );
    case 'kpi.refuse.bandEnd':
      return (
        `Jalur tertinggi berakhir pada ${String(v.highest ?? '?')}, bukan 100. Markah di atas itu ` +
        'tiada jalur yang memilikinya.'
      );
    case 'kpi.refuse.bandOverlap':
      return (
        `Gred ${String(v.first ?? '?')} dan ${String(v.second ?? '?')} bertindih. Markah yang ` +
        'sama akan mendapat gred berbeza bergantung susunan bacaan.'
      );
    case 'kpi.refuse.bandGap':
      return (
        `Ada jurang antara gred ${String(v.first ?? '?')} dan ${String(v.second ?? '?')}: ` +
        `markah ${String(v.from ?? '?')} hingga ${String(v.to ?? '?')} tidak mendapat gred.`
      );
    case 'kpi.refuse.badBonus':
      return 'Bonus mesti nombor bulan, atau dibiarkan kosong.';
    case 'kpi.refuse.bonusZero':
      return (
        'Bonus 0 bulan sama maksudnya dengan tiada bonus. Biarkan kosong supaya skrin tidak ' +
        'memaparkan amaun yang kelihatan seperti gagal disimpan.'
      );
    case 'kpi.refuse.bonusCeiling':
      return (
        `${String(v.months ?? '?')} bulan melebihi siling ${String(v.max ?? MAX_BONUS_MONTHS)} ` +
        'bulan. Siling itu penjaga tersalah taip, bukan dasar — sifar tersasar menukar satu bulan ' +
        'menjadi sepuluh dan ia hanya kelihatan selepas penyata gaji dijana.'
      );
    case 'kpi.refuse.periodClosed':
      return 'Tempoh ini sudah ditutup — markah hanya boleh ditulis pada tempoh yang dibuka.';
    case 'kpi.refuse.assignmentFinalised':
      return 'Penilaian ini sudah dimuktamadkan dan tidak boleh diubah.';
    case 'kpi.refuse.selfReview':
      return 'Seseorang tidak boleh menilai dirinya sendiri.';
    case 'kpi.refuse.badDate':
      return 'Masukkan tarikh yang sah.';
    case 'kpi.refuse.periodOrder':
      return 'Tarikh hujung tidak boleh sebelum tarikh mula.';
    case 'kpi.refuse.dueBeforeEnd':
      return (
        'Tarikh jatuh tempo tidak boleh sebelum hujung tempoh — itu meminta seseorang menilai ' +
        'kerja yang belum berlaku.'
      );
    default:
      return 'Tindakan ini tidak sah.';
  }
}

/** Grade bands as the rule library wants them. */
async function loadBands(): Promise<Array<{ code: string; minScore: number; maxScore: number }>> {
  const rows = await db().kpiGrade.findMany({ orderBy: { minScore: 'asc' } });
  return rows.map((row) => ({
    code: row.code,
    minScore: Number(row.minScore),
    maxScore: Number(row.maxScore),
  }));
}

export async function kpiRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // Competency catalogue
  // -------------------------------------------------------------------------

  /*
   * Lives under `hr.kpiSettings`, beside the grade bands, and not under `hr.kpiTemplates`.
   *
   * Adding a competency changes what every future form can ask about, and renaming one changes the
   * wording on forms already in use. Building a form from an existing catalogue is a different,
   * smaller decision — and the person who does it several times a week is not the person who
   * should be extending the vocabulary while they do.
   */
  app.get(
    '/api/kpi-competencies',
    { preHandler: requirePermission('hr.kpiSettings', 'view') },
    async () => {
      const rows = await db().kpiCompetency.findMany({
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { templateItems: true } } },
      });

      return jsonSafe(
        rows.map(({ _count, ...row }) => ({
          ...row,
          /*
           * How many forms ask about this.
           *
           * The column the free-text version could not have. It is also the number that makes
           * retiring a competency a decision rather than a click.
           */
          templateCount: _count.templateItems,
        })),
      );
    },
  );

  /**
   * The picker's options: active catalogue entries only.
   *
   * A separate endpoint under `hr.kpiTemplates` rather than widening the one above, because
   * building a form and extending the vocabulary are different jobs held by different people. Somebody
   * who may build forms needs to read the catalogue; they do not need the usage counts, and they
   * should not be given the settings screen to get at a dropdown.
   *
   * Inactive entries are left out: a retired competency must not be selectable on a new form, and
   * the wording it already contributed lives on the rows that use it.
   */
  app.get(
    '/api/kpi-competencies/options',
    { preHandler: requirePermission('hr.kpiTemplates', 'view') },
    async () => {
      const rows = await db().kpiCompetency.findMany({
        where: { active: true },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, category: true, description: true },
      });
      return jsonSafe(rows);
    },
  );

  const competencySchema = z.object({
    name: z.string().trim().min(1).max(190),
    category: z.enum(COMPETENCY_CATEGORIES),
    description: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
    active: z.boolean().optional(),
  });

  app.post(
    '/api/kpi-competencies',
    { preHandler: requirePermission('hr.kpiSettings', 'edit') },
    async (request) => {
      const body = parseBody(competencySchema, request.body);

      const refusal = checkCompetency({ name: body.name, category: body.category });
      if (refusal) throw conflict(refusalMessage(refusal));

      const name = normaliseCompetencyName(body.name);

      const clash = await db().kpiCompetency.findUnique({ where: { name } });
      if (clash) {
        throw conflict(
          `"${name}" sudah ada dalam katalog. Katalog ini wujud supaya satu kompetensi bukan ` +
            'sepuluh ejaan bagi dirinya sendiri.',
        );
      }

      const row = await db().kpiCompetency.create({
        data: {
          name,
          category: body.category,
          description: body.description ? body.description : null,
          active: body.active ?? true,
        },
      });

      await recordActivity({
        request,
        action: 'kpi.competency.created',
        category: 'settings',
        detail: `${name} (${body.category})`,
      });

      return jsonSafe({ id: row.id, name: row.name });
    },
  );

  app.patch(
    '/api/kpi-competencies/:id',
    { preHandler: requirePermission('hr.kpiSettings', 'edit') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(competencySchema.partial(), request.body);

      const existing = await db().kpiCompetency.findUnique({
        where: { id },
        include: { _count: { select: { templateItems: true } } },
      });
      if (!existing) throw notFound('Kompetensi tidak dijumpai');

      const name = body.name === undefined ? undefined : normaliseCompetencyName(body.name);

      if (name !== undefined && name !== existing.name) {
        const refusal = checkCompetency({
          name,
          category: body.category ?? existing.category,
        });
        if (refusal) throw conflict(refusalMessage(refusal));

        const clash = await db().kpiCompetency.findUnique({ where: { name } });
        if (clash) throw conflict(`"${name}" sudah ada dalam katalog.`);
      }

      await db().$transaction(async (tx) => {
        await tx.kpiCompetency.update({
          where: { id },
          data: {
            ...(name === undefined ? {} : { name }),
            ...(body.category === undefined ? {} : { category: body.category }),
            ...(body.description === undefined
              ? {}
              : { description: body.description ? body.description : null }),
            ...(body.active === undefined ? {} : { active: body.active }),
          },
        });

        /*
         * The denormalised name on every form that uses it moves too.
         *
         * A rename is a correction — a spelling, a change of house style — and leaving the old
         * wording on the forms would produce exactly the divergence the catalogue exists to stop.
         *
         * Appraisals already created keep their own snapshot and are deliberately untouched: those
         * rows record the question as it was asked, and somebody signed them.
         */
        if (name !== undefined && name !== existing.name) {
          await tx.kpiTemplateItem.updateMany({
            where: { competencyId: id },
            data: { competencyName: name },
          });
        }
      });

      await recordActivity({
        request,
        action: 'kpi.competency.updated',
        category: 'settings',
        detail:
          name !== undefined && name !== existing.name
            ? `${existing.name} → ${name} (${String(existing._count.templateItems)} borang)`
            : `${existing.name} dikemas kini`,
      });

      return { ok: true };
    },
  );

  app.delete(
    '/api/kpi-competencies/:id',
    { preHandler: requirePermission('hr.kpiSettings', 'edit') },
    async (request) => {
      const id = idParam(request.params);
      const existing = await db().kpiCompetency.findUnique({
        where: { id },
        include: { _count: { select: { templateItems: true } } },
      });
      if (!existing) throw notFound('Kompetensi tidak dijumpai');

      /*
       * Refused while a form still asks about it, rather than allowed with `SetNull`.
       *
       * The FK is `SetNull` so a deletion that happens anyway leaves the form readable rather than
       * blank — but a form quietly losing its link to the catalogue is how "which forms use this"
       * stops being answerable. Deactivating keeps the wording and removes it from the picker,
       * which is what somebody retiring a competency actually wants.
       */
      if (existing._count.templateItems > 0) {
        throw conflict(
          `${String(existing._count.templateItems)} borang masih bertanya tentang "${existing.name}". ` +
            'Nyahaktifkan ia sebagai ganti — perkataannya kekal pada borang itu dan ia hilang dari ' +
            'senarai pilihan.',
        );
      }

      await db().kpiCompetency.delete({ where: { id } });
      await recordActivity({
        request,
        action: 'kpi.competency.deleted',
        category: 'settings',
        level: 'warn',
        detail: existing.name,
      });

      return { ok: true };
    },
  );

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------

  app.get(
    '/api/kpi-templates',
    { preHandler: requirePermission('hr.kpiTemplates', 'view') },
    async () => {
      const rows = await db().kpiTemplate.findMany({
        orderBy: [{ active: 'desc' }, { code: 'asc' }],
        include: {
          items: {
            orderBy: { sortOrder: 'asc' },
            include: { competency: { select: { active: true, category: true } } },
          },
          _count: { select: { assignments: true } },
        },
      });

      return jsonSafe(
        rows.map(({ _count, items, ...row }) => ({
          ...row,
          assignmentCount: _count.assignments,
          items: items.map((item) => ({
            id: item.id,
            competencyId: item.competencyId,
            competencyName: item.competencyName,
            description: item.description,
            weight: Number(item.weight),
            sortOrder: item.sortOrder,
            category: item.competency?.category ?? null,
            /** So the form can flag a row asking about something since retired. */
            competencyRetired: item.competencyId !== null && item.competency?.active === false,
          })),
          weightTotal: Number(
            items.reduce((sum, item) => sum + Number(item.weight), 0).toFixed(2),
          ),
          /** Every fault at once, so one visit fixes the form. */
          faults: auditTemplateItems(
            items.map((item) => ({
              competencyName: item.competencyName,
              weight: Number(item.weight),
            })),
          ),
        })),
      );
    },
  );

  const templateSchema = z.object({
    code: z.string().trim().min(1).max(24),
    name: z.string().trim().min(1).max(190),
    description: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
    active: z.boolean().optional(),
    /**
     * The whole item list, every time.
     *
     * Weights have to sum to 100 across siblings, so they can only be validated together — and a
     * per-item endpoint would let somebody save a valid item that makes the form invalid.
     *
     * `competencyId` and not a name. Free text was what made the catalogue necessary.
     */
    items: z
      .array(
        z.object({
          competencyId: z.coerce.number().int().positive(),
          description: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
          weight: z.coerce.number().positive().max(100),
        }),
      )
      .min(1)
      .max(50),
  });

  /** Resolves competency ids to catalogue rows, refusing anything unknown, inactive or repeated. */
  async function resolveItems(
    items: Array<{ competencyId: number; description?: string; weight: number }>,
  ): Promise<Array<{ competencyId: number; competencyName: string; description: string | null; weight: number }>> {
    const ids = items.map((item) => item.competencyId);
    if (new Set(ids).size !== ids.length) {
      throw conflict(
        'Satu kompetensi disenaraikan lebih daripada sekali. Ia akan diberi pemberat dua kali ' +
          'dan terbaca sebagai dua soalan.',
      );
    }

    const rows = await db().kpiCompetency.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((row) => [row.id, row]));

    return items.map((item) => {
      const competency = byId.get(item.competencyId);
      if (competency === undefined) throw notFound('Satu kompetensi tidak dijumpai dalam katalog');
      if (!competency.active) {
        throw conflict(
          `"${competency.name}" sudah dinyahaktifkan. Borang baharu tidak boleh bertanya ` +
            'tentangnya.',
        );
      }
      return {
        competencyId: competency.id,
        competencyName: competency.name,
        description: item.description ? item.description : null,
        weight: item.weight,
      };
    });
  }

  app.post(
    '/api/kpi-templates',
    { preHandler: requirePermission('hr.kpiTemplates', 'create') },
    async (request) => {
      const body = parseBody(templateSchema, request.body);
      const code = body.code.toUpperCase();

      const clash = await db().kpiTemplate.findUnique({ where: { code } });
      if (clash) throw conflict(`Kod borang "${code}" sudah ada`);

      const refusal = checkWeights(body.items.map((item) => item.weight));
      if (refusal) throw conflict(refusalMessage(refusal));

      const resolved = await resolveItems(body.items);

      const row = await db().kpiTemplate.create({
        data: {
          code,
          name: body.name,
          description: body.description ? body.description : null,
          active: body.active ?? true,
          items: {
            create: resolved.map((item, index) => ({
              competencyId: item.competencyId,
              competencyName: item.competencyName,
              description: item.description,
              weight: item.weight,
              sortOrder: index + 1,
            })),
          },
        },
      });

      await recordActivity({
        request,
        action: 'kpi.template.created',
        category: 'settings',
        detail: `${code}: ${String(resolved.length)} kompetensi`,
      });

      return jsonSafe({ id: row.id, code: row.code });
    },
  );

  /**
   * Edits a form, including one already in use.
   *
   * This used to be refused once any appraisal existed against the form, because the scores read
   * their weights through a foreign key and editing the form regraded reviews somebody had signed.
   * The refusal was correct for that model and it produced a second fault: a form with a typo in it
   * could never be corrected, so the wrong wording was asked for another year.
   *
   * An appraisal now snapshots its own questions and weights when it is created. Nothing downstream
   * reads the form again, so the form is free to change and the appraisals do not move.
   */
  app.patch(
    '/api/kpi-templates/:id',
    { preHandler: requirePermission('hr.kpiTemplates', 'edit') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(templateSchema.partial(), request.body);

      const existing = await db().kpiTemplate.findUnique({
        where: { id },
        include: { _count: { select: { assignments: true } } },
      });
      if (!existing) throw notFound('Borang tidak dijumpai');

      if (body.code !== undefined && body.code.toUpperCase() !== existing.code) {
        const clash = await db().kpiTemplate.findUnique({
          where: { code: body.code.toUpperCase() },
        });
        if (clash) throw conflict(`Kod borang "${body.code.toUpperCase()}" sudah ada`);
      }

      const resolved =
        body.items === undefined
          ? null
          : await (async () => {
              const refusal = checkWeights(body.items!.map((item) => item.weight));
              if (refusal) throw conflict(refusalMessage(refusal));
              return resolveItems(body.items!);
            })();

      await db().$transaction(async (tx) => {
        await tx.kpiTemplate.update({
          where: { id },
          data: {
            ...(body.code === undefined ? {} : { code: body.code.toUpperCase() }),
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.description === undefined
              ? {}
              : { description: body.description ? body.description : null }),
            ...(body.active === undefined ? {} : { active: body.active }),
          },
        });

        // Replaced wholesale rather than diffed: the weights are only valid as a set.
        if (resolved !== null) {
          await tx.kpiTemplateItem.deleteMany({ where: { templateId: id } });
          for (const [index, item] of resolved.entries()) {
            await tx.kpiTemplateItem.create({
              data: {
                templateId: id,
                competencyId: item.competencyId,
                competencyName: item.competencyName,
                description: item.description,
                weight: item.weight,
                sortOrder: index + 1,
              },
            });
          }
        }
      });

      await recordActivity({
        request,
        action: 'kpi.template.updated',
        category: 'settings',
        detail:
          resolved === null
            ? `${existing.code} dikemas kini`
            : `${existing.code}: ${String(resolved.length)} kompetensi ditulis semula ` +
              `(${String(existing._count.assignments)} penilaian sedia ada tidak terjejas)`,
      });

      return { ok: true };
    },
  );

  app.delete(
    '/api/kpi-templates/:id',
    { preHandler: requirePermission('hr.kpiTemplates', 'delete') },
    async (request) => {
      const id = idParam(request.params);
      const existing = await db().kpiTemplate.findUnique({ where: { id } });
      if (!existing) throw notFound('Borang tidak dijumpai');

      const used = await db().kpiAssignment.count({ where: { templateId: id } });
      if (used > 0) {
        throw conflict(
          `${String(used)} penilaian merujuk borang ini. Nyahaktifkan ia sebagai ganti.`,
        );
      }

      await db().kpiTemplate.delete({ where: { id } });
      await recordActivity({
        request,
        action: 'kpi.template.deleted',
        category: 'settings',
        level: 'warn',
        detail: existing.code,
      });

      return { ok: true };
    },
  );

  // -------------------------------------------------------------------------
  // Periods
  // -------------------------------------------------------------------------

  app.get(
    '/api/kpi-periods',
    { preHandler: requirePermission('hr.kpiPeriods', 'view') },
    async () => {
      const rows = await db().kpiPeriod.findMany({
        orderBy: [{ fromDate: 'desc' }],
        include: { _count: { select: { assignments: true } } },
      });

      /*
       * Outstanding reviews per period, in one grouped query.
       *
       * The list needs it to say whether a period can sensibly be closed: closing one with
       * unsubmitted reviews leaves those people ungraded, permanently.
       */
      const outstanding = await db().kpiAssignment.groupBy({
        by: ['periodId'],
        where: { status: { in: ['pending', 'inProgress'] } },
        _count: { _all: true },
      });
      const pendingByPeriod = new Map(outstanding.map((row) => [row.periodId, row._count._all]));

      return jsonSafe(
        rows.map(({ _count, ...row }) => ({
          ...row,
          fromDate: dateOnlyKey(row.fromDate),
          toDate: dateOnlyKey(row.toDate),
          dueOn: dateOnlyKey(row.dueOn),
          assignmentCount: _count.assignments,
          outstanding: pendingByPeriod.get(row.id) ?? 0,
        })),
      );
    },
  );

  const periodSchema = z.object({
    code: z.string().trim().min(1).max(24),
    name: z.string().trim().min(1).max(190),
    fromDate: z.coerce.date(),
    toDate: z.coerce.date(),
    dueOn: z.coerce.date(),
  });

  app.post(
    '/api/kpi-periods',
    { preHandler: requirePermission('hr.kpiPeriods', 'create') },
    async (request) => {
      const body = parseBody(periodSchema, request.body);
      const code = body.code.toUpperCase();

      const clash = await db().kpiPeriod.findUnique({ where: { code } });
      if (clash) throw conflict(`Kod tempoh "${code}" sudah ada`);

      const fromDate = asDateOnly(body.fromDate);
      const toDate = asDateOnly(body.toDate);
      const dueOn = asDateOnly(body.dueOn);

      const refusal = checkPeriod({
        fromDate: dateOnlyKey(fromDate),
        toDate: dateOnlyKey(toDate),
        dueOn: dateOnlyKey(dueOn),
      });
      if (refusal) throw conflict(refusalMessage(refusal));

      /*
       * Created open.
       *
       * There was a `draft` state, and every period sat in it until somebody remembered to press
       * Open — a state whose only behaviour was to refuse the thing the screen was for.
       */
      const row = await db().kpiPeriod.create({
        data: { code, name: body.name, fromDate, toDate, dueOn, status: 'open', openedAt: new Date() },
      });

      await recordActivity({
        request,
        action: 'kpi.period.created',
        category: 'settings',
        detail: `${code}: ${dateOnlyKey(fromDate)} – ${dateOnlyKey(toDate)}`,
      });

      return jsonSafe({ id: row.id, code: row.code });
    },
  );

  app.post(
    '/api/kpi-periods/:id/status',
    { preHandler: requirePermission('hr.kpiPeriods', 'edit') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(
        z.object({
          status: z.enum(PERIOD_STATUSES),
          /**
           * Required to close a period that still has unsubmitted reviews.
           *
           * Not a silent override: closing leaves those people ungraded permanently, and the
           * flag makes that a decision rather than a click.
           */
          acknowledgeOutstanding: z.boolean().optional(),
        }),
        request.body,
      );

      const existing = await db().kpiPeriod.findUnique({ where: { id } });
      if (!existing) throw notFound('Tempoh tidak dijumpai');

      const from = existing.status as PeriodStatus;
      if (!periodTransitionAllowed(from, body.status)) {
        throw conflict(
          'Tempoh yang ditutup tidak dibuka semula. Gred di dalamnya sudah dibaca, dan di mana ' +
            'modul payroll ada ia mungkin sudah memacu bonus — membukanya membenarkan angka yang ' +
            'sudah dibayar berubah di bawah pembayaran itu.',
        );
      }

      if (body.status === 'closed') {
        const outstanding = await db().kpiAssignment.count({
          where: { periodId: id, status: { in: ['pending', 'inProgress'] } },
        });
        if (outstanding > 0 && body.acknowledgeOutstanding !== true) {
          throw conflict(
            `${String(outstanding)} penilaian belum dihantar. Menutup tempoh sekarang ` +
              'meninggalkan mereka tanpa gred secara kekal — sahkan jika itu memang niatnya.',
          );
        }
      }

      await db().kpiPeriod.update({
        where: { id },
        data: { status: body.status, closedAt: new Date() },
      });

      await recordActivity({
        request,
        action: `kpi.period.${body.status}`,
        category: 'settings',
        level: 'warn',
        detail: `${existing.code}: ${from} → ${body.status}`,
      });

      return { ok: true };
    },
  );

  app.delete(
    '/api/kpi-periods/:id',
    { preHandler: requirePermission('hr.kpiPeriods', 'delete') },
    async (request) => {
      const id = idParam(request.params);
      const existing = await db().kpiPeriod.findUnique({
        where: { id },
        include: { _count: { select: { assignments: true } } },
      });
      if (!existing) throw notFound('Tempoh tidak dijumpai');

      /*
       * Gated on having nothing in it, not on a status.
       *
       * The old rule was "only a draft period may be deleted", which stopped meaning anything once
       * `draft` was removed. What actually matters is whether deleting this would take appraisals
       * with it — an empty period created by mistake is a mistake, and a period holding graded
       * people is a record.
       */
      if (existing._count.assignments > 0) {
        throw conflict(
          `${String(existing._count.assignments)} penilaian berada dalam tempoh ini. ` +
            'Membuangnya akan membuang penilaian itu juga.',
        );
      }
      if (existing.status === 'closed') {
        throw conflict('Tempoh yang ditutup ialah rekod sejarah dan tidak boleh dibuang.');
      }

      await db().kpiPeriod.delete({ where: { id } });
      await recordActivity({
        request,
        action: 'kpi.period.deleted',
        category: 'settings',
        level: 'warn',
        detail: existing.code,
      });

      return { ok: true };
    },
  );

  // -------------------------------------------------------------------------
  // Assignments
  // -------------------------------------------------------------------------

  app.get(
    '/api/kpi-assignments',
    { preHandler: requirePermission('hr.kpiAssignments', 'view') },
    async (request) => {
      const query = z
        .object({
          periodId: z.coerce.number().int().positive().optional(),
          staffId: z.coerce.number().int().positive().optional(),
          status: z.enum(ASSIGNMENT_STATUSES).optional(),
          /** The review screen asks for what this account has to fill in. */
          mine: z.enum(['true', 'false']).optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(200).default(25),
        })
        .parse(request.query);

      if (!request.user) throw unauthorized();

      const where = {
        ...(query.periodId === undefined ? {} : { periodId: query.periodId }),
        ...(query.staffId === undefined ? {} : { staffId: query.staffId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.mine === 'true' ? { reviewerAccountId: request.user.accountId } : {}),
      };

      const [rows, total, grouped] = await Promise.all([
        db().kpiAssignment.findMany({
          where,
          orderBy: [{ periodId: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            period: { select: { code: true, name: true, status: true, dueOn: true } },
            staff: {
              select: {
                employeeNo: true,
                fullName: true,
                department: { select: { name: true } },
              },
            },
            template: { select: { code: true, name: true } },
            scores: { select: { score: true } },
          },
        }),
        db().kpiAssignment.count({ where }),
        db().kpiAssignment.groupBy({
          by: ['status'],
          where: { ...where, status: undefined },
          _count: { _all: true },
        }),
      ]);

      return jsonSafe({
        rows: rows.map((row) => ({
          id: row.id,
          periodId: row.periodId,
          periodCode: row.period.code,
          periodName: row.period.name,
          periodStatus: row.period.status,
          dueOn: dateOnlyKey(row.period.dueOn),
          staffId: row.staffId,
          employeeNo: row.staff.employeeNo,
          staffName: row.staff.fullName,
          departmentName: row.staff.department?.name ?? null,
          templateId: row.templateId,
          templateCode: row.template.code,
          templateName: row.template.name,
          /*
           * Both counts come from the appraisal's own snapshot rows, not from the form.
           *
           * The form can have gained or lost competencies since; this appraisal has the questions
           * it was created with, and progress has to be reported against those.
           */
          itemCount: row.scores.length,
          scoredCount: row.scores.filter((score) => score.score !== null).length,
          reviewerAccountId: row.reviewerAccountId,
          status: row.status,
          totalScore: row.totalScore === null ? null : Number(row.totalScore),
          gradeCode: row.gradeCode,
          submittedAt: row.submittedAt?.toISOString() ?? null,
          finalisedAt: row.finalisedAt?.toISOString() ?? null,
          decisionNote: row.decisionNote,
        })),
        total,
        counts: Object.fromEntries(grouped.map((row) => [row.status, row._count._all])),
        generatedAt: new Date().toISOString(),
      });
    },
  );

  app.post(
    '/api/kpi-assignments',
    { preHandler: requirePermission('hr.kpiAssignments', 'create') },
    async (request) => {
      const body = parseBody(
        z.object({
          periodId: z.number().int().positive(),
          staffId: z.number().int().positive(),
          templateId: z.number().int().positive(),
          reviewerAccountId: z.number().int().positive(),
        }),
        request.body,
      );

      const [period, staff, template, reviewer] = await Promise.all([
        db().kpiPeriod.findUnique({ where: { id: body.periodId } }),
        db().staff.findUnique({
          where: { id: body.staffId },
          select: { fullName: true, employeeNo: true, active: true },
        }),
        db().kpiTemplate.findUnique({
          where: { id: body.templateId },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        }),
        db().userAccount.findUnique({
          where: { id: body.reviewerAccountId },
          select: { staffId: true, status: true },
        }),
      ]);

      if (!period) throw notFound('Tempoh tidak dijumpai');
      if (period.status === 'closed') throw conflict('Tempoh ini sudah ditutup.');
      if (!staff) throw notFound('Staf tidak dijumpai');
      if (!staff.active) throw conflict(`${staff.fullName} tidak aktif`);
      if (!template) throw notFound('Borang tidak dijumpai');
      if (!template.active) throw conflict(`${template.name} tidak aktif.`);
      if (template.items.length === 0) {
        throw conflict('Borang ini tiada kompetensi. Tambah kompetensi dahulu.');
      }
      if (!reviewer) throw notFound('Akaun penilai tidak dijumpai');
      if (reviewer.status !== 'active') throw conflict('Akaun penilai tidak aktif.');

      /*
       * The form's weights are checked again here, at the moment they are copied.
       *
       * They were checked when the form was saved, and the form is now editable while in use — so
       * this is the last point before a snapshot is taken that nothing revisits. A form that has
       * drifted must not be frozen onto somebody's appraisal.
       */
      const weightFault = checkWeights(template.items.map((item) => Number(item.weight)));
      if (weightFault) {
        throw conflict(
          `${template.name}: ${refusalMessage(weightFault)} Betulkan borang sebelum menugaskannya.`,
        );
      }

      const refusal = checkReviewer({
        subjectStaffId: body.staffId,
        reviewerStaffId: reviewer.staffId,
      });
      if (refusal) throw conflict(refusalMessage(refusal));

      const clash = await db().kpiAssignment.findUnique({
        where: { periodId_staffId: { periodId: body.periodId, staffId: body.staffId } },
      });
      // Two assessments of one person in one period produce two grades and no way to say which
      // counts.
      if (clash) throw conflict(`${staff.fullName} sudah mempunyai penilaian untuk tempoh ini.`);

      /*
       * The questions are copied onto the appraisal now, unanswered.
       *
       * This is the whole design. From here the review form is read from these rows and never from
       * the template again, so editing the template cannot regrade a signed appraisal — and the
       * client addresses a line by the row's own id, so a weight is never sent by a caller and
       * never accepted from one.
       */
      const row = await db().kpiAssignment.create({
        data: {
          periodId: body.periodId,
          staffId: body.staffId,
          templateId: body.templateId,
          reviewerAccountId: body.reviewerAccountId,
          status: 'pending',
          scores: {
            create: template.items.map((item, index) => ({
              competencyId: item.competencyId,
              competencyName: item.competencyName,
              description: item.description,
              weight: item.weight,
              score: null,
              sortOrder: index + 1,
            })),
          },
        },
      });

      /*
       * The reviewer is told, not the person being assessed.
       *
       * Being assigned a review is work arriving; being assessed is not something to announce
       * before it has happened. `notifyApprover` gates it because the reviewer is the one being
       * asked to act, even though KPI has no approval chain.
       */
      const settings = await moduleSettings('kpi');
      if (settingIsOn(settings, 'notifyApprover')) {
        const reviewerAccount = await db().userAccount.findUnique({
          where: { id: body.reviewerAccountId },
          select: { email: true, fullName: true, staff: { select: { phone: true } } },
        });
        notify({
          trigger: 'kpi.reviewAssigned',
          mobile: reviewerAccount?.staff?.phone ?? null,
          summary: `Penilaian ${period.name}: ${staff.fullName} ditugaskan kepada anda.`,
          lines: [`Borang: ${template.name}`, `Jatuh tempo: ${dateOnlyKey(period.dueOn)}`],
          email: {
            module: 'kpi',
            event: 'reviewAssigned',
            to: reviewerAccount?.email ?? null,
            vars: {
              // `staffName` is the person being assessed, as it is everywhere else: the subject of
              // the record, not the recipient of the mail.
              staffName: staff.fullName,
              employeeNo: staff.employeeNo,
              requestNo: period.code,
              status: 'pending',
              periodName: period.name,
              templateName: template.name,
              dueOn: dateOnlyKey(period.dueOn),
              reviewer: reviewerAccount?.fullName ?? null,
            },
          },
        });
      }

      await recordActivity({
        request,
        action: 'kpi.assignment.created',
        category: 'staff',
        detail: `${period.code}: ${staff.fullName} atas borang ${template.code} (${String(template.items.length)} kompetensi)`,
      });

      return jsonSafe({ id: row.id });
    },
  );

  app.delete(
    '/api/kpi-assignments/:id',
    { preHandler: requirePermission('hr.kpiAssignments', 'delete') },
    async (request) => {
      const id = idParam(request.params);
      const existing = await db().kpiAssignment.findUnique({ where: { id } });
      if (!existing) throw notFound('Penilaian tidak dijumpai');
      if (existing.status === 'finalised') {
        throw conflict('Penilaian yang dimuktamadkan tidak boleh dibuang — ia rekod gred.');
      }

      // Scores cascade. There are no approval records to clean up: KPI does not write any.
      await db().kpiAssignment.delete({ where: { id } });

      await recordActivity({
        request,
        action: 'kpi.assignment.deleted',
        category: 'staff',
        level: 'warn',
        detail: `Penilaian #${String(id)} dibuang`,
      });

      return { ok: true };
    },
  );

  // -------------------------------------------------------------------------
  // Scoring
  // -------------------------------------------------------------------------

  /** The form: this appraisal's own questions, with whatever has been answered so far. */
  app.get(
    '/api/kpi-assignments/:id/review',
    { preHandler: requirePermission('hr.kpiReviews', 'view') },
    async (request) => {
      const id = idParam(request.params);

      const row = await db().kpiAssignment.findUnique({
        where: { id },
        include: {
          period: { select: { code: true, name: true, status: true, dueOn: true } },
          staff: { select: { employeeNo: true, fullName: true } },
          template: { select: { code: true, name: true } },
          scores: { orderBy: { sortOrder: 'asc' } },
        },
      });
      if (!row) throw notFound('Penilaian tidak dijumpai');

      const lines = row.scores.map((score) => ({
        score: score.score === null ? null : Number(score.score),
        weight: Number(score.weight),
      }));

      return jsonSafe({
        id: row.id,
        periodCode: row.period.code,
        periodName: row.period.name,
        periodStatus: row.period.status,
        dueOn: dateOnlyKey(row.period.dueOn),
        employeeNo: row.staff.employeeNo,
        staffName: row.staff.fullName,
        templateCode: row.template.code,
        templateName: row.template.name,
        status: row.status,
        scoreMax: SCORE_MAX,
        totalScore: row.totalScore === null ? null : Number(row.totalScore),
        gradeCode: row.gradeCode,
        decisionNote: row.decisionNote,
        reviewerAccountId: row.reviewerAccountId,
        /**
         * The running total over what has been answered.
         *
         * Sent by the server so the figure on the screen and the figure that gets stored come from
         * one implementation. The web recomputes it live while typing; this is what it agrees with
         * on load.
         */
        runningScore: (() => {
          const value = weightedScore(lines);
          return Number.isFinite(value) ? value : null;
        })(),
        items: row.scores.map((score) => ({
          /** The snapshot row's own id. What the client sends back. */
          scoreId: score.id,
          competencyId: score.competencyId,
          competencyName: score.competencyName,
          description: score.description,
          weight: Number(score.weight),
          score: score.score === null ? null : Number(score.score),
          comment: score.comment,
          sortOrder: score.sortOrder,
        })),
      });
    },
  );

  /**
   * Saves answers, without submitting.
   *
   * Partial saves are allowed and expected: a reviewer works through a form over more than one
   * sitting. Completeness is checked at submission instead, which is the point where an omission
   * would become permanent.
   *
   * The body carries `scoreId` and a score. It does not carry a weight, and there is no shape of
   * request that would let it — the weight was frozen onto the row when the appraisal was created.
   */
  app.put(
    '/api/kpi-assignments/:id/review',
    { preHandler: requirePermission('hr.kpiReviews', 'edit') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const id = idParam(request.params);

      const body = parseBody(
        z.object({
          scores: z
            .array(
              z.object({
                scoreId: z.number().int().positive(),
                score: z.coerce.number(),
                comment: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
              }),
            )
            .max(50),
        }),
        request.body,
      );

      const existing = await db().kpiAssignment.findUnique({
        where: { id },
        include: {
          period: { select: { status: true } },
          scores: { select: { id: true } },
        },
      });
      if (!existing) throw notFound('Penilaian tidak dijumpai');

      const closed = scoringOpen({
        periodStatus: existing.period.status as PeriodStatus,
        assignmentStatus: existing.status as AssignmentStatus,
      });
      if (closed) throw conflict(refusalMessage(closed));

      /*
       * Only the assigned reviewer may score, regardless of the screen permission.
       *
       * `hr.kpiReviews:edit` says somebody may fill in reviews; it does not say whose. A review
       * written by somebody who never observed the work is not an assessment.
       */
      if (existing.reviewerAccountId !== request.user.accountId) {
        throw forbidden(
          'Hanya penilai yang ditugaskan boleh mengisi penilaian ini. Tukar penugasan jika ' +
            'penilai perlu berubah.',
        );
      }

      const ownRows = new Set(existing.scores.map((score) => score.id));
      for (const entry of body.scores) {
        if (!ownRows.has(entry.scoreId)) {
          // Addressing another appraisal's row, whether by mistake or on purpose.
          throw conflict('Satu markah merujuk baris yang bukan pada penilaian ini.');
        }
        const refusal = checkScore(entry.score);
        if (refusal) throw conflict(refusalMessage(refusal));
      }

      await db().$transaction(async (tx) => {
        for (const entry of body.scores) {
          await tx.kpiScore.update({
            where: { id: entry.scoreId },
            data: {
              score: entry.score,
              comment: entry.comment ? entry.comment : null,
            },
          });
        }

        // Entered by the first score being saved, not by a button: a reviewer who has started is
        // in progress whether or not they pressed anything.
        if (existing.status === 'pending' && body.scores.length > 0) {
          await tx.kpiAssignment.update({ where: { id }, data: { status: 'inProgress' } });
        }
      });

      return { ok: true, saved: body.scores.length };
    },
  );

  /**
   * Submits a complete review, computing the total and freezing the grade.
   *
   * The grade is resolved now and stored, not derived on read. Bands can be edited, and a review
   * somebody signed must keep the grade it was signed with.
   */
  app.post(
    '/api/kpi-assignments/:id/submit',
    { preHandler: requirePermission('hr.kpiReviews', 'edit') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const id = idParam(request.params);

      const existing = await db().kpiAssignment.findUnique({
        where: { id },
        include: {
          period: { select: { status: true } },
          scores: { orderBy: { sortOrder: 'asc' } },
          staff: { select: { fullName: true } },
        },
      });
      if (!existing) throw notFound('Penilaian tidak dijumpai');

      const closed = scoringOpen({
        periodStatus: existing.period.status as PeriodStatus,
        assignmentStatus: existing.status as AssignmentStatus,
      });
      if (closed) throw conflict(refusalMessage(closed));

      if (!assignmentTransitionAllowed(existing.status as AssignmentStatus, 'submitted')) {
        throw conflict(`Penilaian pada status "${existing.status}" tidak boleh dihantar.`);
      }

      if (existing.reviewerAccountId !== request.user.accountId) {
        throw forbidden('Hanya penilai yang ditugaskan boleh menghantar penilaian ini.');
      }

      const incomplete = checkComplete({
        lineCount: existing.scores.length,
        scoredCount: existing.scores.filter((score) => score.score !== null).length,
      });
      if (incomplete) throw conflict(refusalMessage(incomplete));

      // Read entirely from the appraisal's own frozen rows.
      const total = weightedScore(
        existing.scores.map((score) => ({
          score: score.score === null ? null : Number(score.score),
          weight: Number(score.weight),
        })),
      );
      if (!Number.isFinite(total)) {
        throw conflict('Jumlah tidak dapat dikira. Semak markah dan pemberat pada borang ini.');
      }

      const bands = await loadBands();
      const bandFault = checkBands(bands);
      /*
       * Refused rather than stored with a blank grade.
       *
       * A misconfigured band set is a settings fault, and the person submitting a review cannot
       * fix it — but storing the review without a grade would leave a signed assessment that
       * nobody can explain. The message names what to fix.
       */
      if (bandFault) throw conflict(refusalMessage(bandFault));

      const grade = bandFor(total, bands);
      if (grade === null) {
        throw conflict(
          `Jumlah ${total.toFixed(2)} tidak jatuh dalam mana-mana jalur gred. Semak Tetapan KPI.`,
        );
      }

      await db().kpiAssignment.update({
        where: { id },
        data: {
          status: 'submitted',
          totalScore: total,
          gradeCode: grade,
          submittedAt: new Date(),
        },
      });

      await recordActivity({
        request,
        action: 'kpi.review.submitted',
        category: 'staff',
        detail: `${existing.staff.fullName}: ${total.toFixed(2)}% → ${grade}`,
      });

      return jsonSafe({ ok: true, totalScore: total, gradeCode: grade });
    },
  );

  /**
   * Sends a submitted review back for correction.
   *
   * The total and grade are cleared, because leaving them would show a figure for a review that is
   * being changed. The answers themselves are kept — the reviewer is being asked to look again, not
   * to start over. Only possible before it is finalised.
   */
  app.post(
    '/api/kpi-assignments/:id/reopen',
    { preHandler: requirePermission('hr.kpiReviews', 'approve') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const id = idParam(request.params);

      const body = parseBody(z.object({ note: z.string().trim().min(3).max(500) }), request.body);

      const existing = await db().kpiAssignment.findUnique({ where: { id } });
      if (!existing) throw notFound('Penilaian tidak dijumpai');
      if (!assignmentTransitionAllowed(existing.status as AssignmentStatus, 'inProgress')) {
        throw conflict(
          `Penilaian pada status "${existing.status}" tidak boleh dibuka semula. ` +
            'Yang dimuktamadkan adalah rekod gred.',
        );
      }

      await db().kpiAssignment.update({
        where: { id },
        data: {
          status: 'inProgress',
          totalScore: null,
          gradeCode: null,
          submittedAt: null,
          decisionNote: body.note,
        },
      });

      await recordActivity({
        request,
        action: 'kpi.review.reopened',
        category: 'staff',
        level: 'warn',
        detail: `Penilaian #${String(id)} dibuka semula: ${body.note}`,
      });

      return { ok: true };
    },
  );

  /** Finalises a submitted review. The grade becomes a record from here. */
  app.post(
    '/api/kpi-assignments/:id/finalise',
    { preHandler: requirePermission('hr.kpiReviews', 'approve') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const id = idParam(request.params);

      const body = parseBody(
        z.object({ note: z.union([z.literal(''), z.string().trim().max(500)]).optional() }),
        request.body,
      );

      const existing = await db().kpiAssignment.findUnique({
        where: { id },
        include: { staff: { select: { fullName: true } } },
      });
      if (!existing) throw notFound('Penilaian tidak dijumpai');
      if (!assignmentTransitionAllowed(existing.status as AssignmentStatus, 'finalised')) {
        throw conflict(
          `Hanya penilaian yang sudah dihantar boleh dimuktamadkan. Ini "${existing.status}".`,
        );
      }

      await db().kpiAssignment.update({
        where: { id },
        data: {
          status: 'finalised',
          finalisedAt: new Date(),
          decidedBy: request.user.accountId,
          ...(body.note ? { decisionNote: body.note } : {}),
        },
      });

      await db().auditLog.create({
        data: {
          accountId: request.user.accountId,
          actorLabel: request.user.fullName,
          action: 'update',
          entityType: 'KpiAssignment',
          entityId: String(id),
          changes: JSON.parse(
            JSON.stringify({
              status: { before: existing.status, after: 'finalised' },
              gradeCode: existing.gradeCode,
              totalScore: existing.totalScore === null ? null : Number(existing.totalScore),
            }),
          ) as object,
          reason: body.note ?? null,
        },
      });

      /*
       * Now the person assessed is told, and only now.
       *
       * A submitted review can still be reopened, so telling them at submission would announce a
       * grade that may yet change. Finalisation is the point it becomes a record.
       */
      const settings = await moduleSettings('kpi');
      if (settingIsOn(settings, 'notifyApplicant')) {
        const subject = await db().kpiAssignment.findUnique({
          where: { id },
          select: {
            totalScore: true,
            gradeCode: true,
            period: { select: { name: true } },
            template: { select: { name: true } },
            staff: { select: { fullName: true, employeeNo: true, email: true, phone: true } },
          },
        });
        if (subject !== null) {
          const score = subject.totalScore === null ? null : Number(subject.totalScore).toFixed(2);
          notify({
            trigger: 'kpi.finalised',
            mobile: subject.staff.phone,
            summary: `Penilaian ${subject.period.name} dimuktamadkan. Gred ${subject.gradeCode ?? '—'}.`,
            lines: [`Markah: ${score ?? '—'}%`, ...(body.note ? [`Catatan: ${body.note}`] : [])],
            email: {
              module: 'kpi',
              event: 'appraisalFinalised',
              to: subject.staff.email,
              vars: {
                staffName: subject.staff.fullName,
                employeeNo: subject.staff.employeeNo,
                requestNo: subject.gradeCode,
                status: 'finalised',
                decidedBy: request.user.fullName,
                note: body.note ?? null,
                periodName: subject.period.name,
                templateName: subject.template.name,
                totalScore: score,
                grade: subject.gradeCode,
                reviewer: request.user.fullName,
              },
            },
          });
        }
      }

      await recordActivity({
        request,
        action: 'kpi.review.finalised',
        category: 'staff',
        detail: `${existing.staff.fullName}: gred ${existing.gradeCode ?? '—'} dimuktamadkan`,
      });

      return { ok: true };
    },
  );

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------

  /**
   * Finalised grades, and nothing else.
   *
   * A separate screen behind a separate permission. A grade carries a bonus where the payroll
   * module exists, and the people who may read the finished grade are not the people who may
   * reopen the assessment behind it.
   */
  app.get(
    '/api/kpi-results',
    { preHandler: requirePermission('hr.kpiResults', 'view') },
    async (request) => {
      const query = z
        .object({
          periodId: z.coerce.number().int().positive().optional(),
          gradeCode: z.string().trim().max(16).optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(500).default(50),
        })
        .parse(request.query);

      const where = {
        status: 'finalised',
        ...(query.periodId === undefined ? {} : { periodId: query.periodId }),
        ...(query.gradeCode === undefined || query.gradeCode === ''
          ? {}
          : { gradeCode: query.gradeCode }),
      };

      const [rows, total, byGrade, grades] = await Promise.all([
        db().kpiAssignment.findMany({
          where,
          orderBy: [{ totalScore: 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            period: { select: { code: true, name: true } },
            /*
             * No `basicSalary`. This screen shows months, and a salary read here would be a
             * salary read without `staff.directory:salary` — the permission that exists precisely
             * so a pay figure is not incidental to some other screen.
             */
            staff: {
              select: {
                employeeNo: true,
                fullName: true,
                department: { select: { name: true } },
              },
            },
            template: { select: { code: true } },
          },
        }),
        db().kpiAssignment.count({ where }),
        db().kpiAssignment.groupBy({
          by: ['gradeCode'],
          where: { ...where, gradeCode: undefined },
          _count: { _all: true },
        }),
        db().kpiGrade.findMany({ orderBy: { minScore: 'desc' } }),
      ]);

      const monthsByGrade = new Map(
        grades.map((grade) => [
          grade.code,
          grade.bonusMonths === null ? null : Number(grade.bonusMonths),
        ]),
      );

      return jsonSafe({
        rows: rows.map((row) => ({
          id: row.id,
          periodCode: row.period.code,
          periodName: row.period.name,
          employeeNo: row.staff.employeeNo,
          staffName: row.staff.fullName,
          departmentName: row.staff.department?.name ?? null,
          templateCode: row.template.code,
          totalScore: row.totalScore === null ? null : Number(row.totalScore),
          gradeCode: row.gradeCode,
          /*
           * Months, not an amount.
           *
           * The bonus is only money once a payroll period freezes it onto a bonus row. Sending an
           * amount here would put a figure on a screen that nothing has approved and that changes
           * whenever the person's basic salary does.
           */
          bonusMonths: row.gradeCode === null ? null : monthsByGrade.get(row.gradeCode) ?? null,
          finalisedAt: row.finalisedAt?.toISOString() ?? null,
        })),
        total,
        /** Distribution across grades, for the screen to show the shape of a period. */
        distribution: Object.fromEntries(
          byGrade
            .filter((row) => row.gradeCode !== null)
            .map((row) => [row.gradeCode as string, row._count._all]),
        ),
        grades: grades.map((row) => ({
          code: row.code,
          name: row.name,
          minScore: Number(row.minScore),
          maxScore: Number(row.maxScore),
          bonusMonths: row.bonusMonths === null ? null : Number(row.bonusMonths),
          color: row.color,
        })),
        generatedAt: new Date().toISOString(),
      });
    },
  );

  // -------------------------------------------------------------------------
  // Grade bands
  // -------------------------------------------------------------------------

  app.get(
    '/api/kpi-grades',
    { preHandler: requirePermission('hr.kpiSettings', 'view') },
    async () => {
      const rows = await db().kpiGrade.findMany({ orderBy: { minScore: 'desc' } });
      const bands = rows.map((row) => ({
        code: row.code,
        minScore: Number(row.minScore),
        maxScore: Number(row.maxScore),
      }));

      return jsonSafe({
        grades: rows.map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          minScore: Number(row.minScore),
          maxScore: Number(row.maxScore),
          bonusMonths: row.bonusMonths === null ? null : Number(row.bonusMonths),
          color: row.color,
          sortOrder: row.sortOrder,
        })),
        /*
         * Every coverage fault, sent with the list as `{ key, vars }`.
         *
         * A gap or an overlap is invisible in a table of numbers — it only shows when somebody
         * submits a review and gets refused, which is both the wrong person and the wrong screen.
         * Listing all of them means one visit fixes the table.
         */
        faults: auditBands(bands),
        maxBonusMonths: MAX_BONUS_MONTHS,
      });
    },
  );

  /**
   * Replaces the whole grade set.
   *
   * All of them at once, for the same reason form weights are: bands are only valid as a set, and a
   * per-grade endpoint would let somebody save a valid band that leaves a gap.
   */
  app.put(
    '/api/kpi-grades',
    { preHandler: requirePermission('hr.kpiSettings', 'edit') },
    async (request) => {
      const body = parseBody(
        z.object({
          grades: z
            .array(
              z.object({
                code: z.string().trim().min(1).max(16),
                name: z.string().trim().min(1).max(120),
                minScore: z.coerce.number().min(0).max(100),
                maxScore: z.coerce.number().min(0).max(100),
                bonusMonths: z
                  .union([z.null(), z.coerce.number().min(0).max(MAX_BONUS_MONTHS)])
                  .optional(),
                /** `#rrggbb`, lower or upper case. Validated here so the column can trust it. */
                color: z
                  .string()
                  .trim()
                  .regex(/^#[0-9a-fA-F]{6}$/)
                  .optional(),
              }),
            )
            .min(1)
            .max(20),
        }),
        request.body,
      );

      const codes = body.grades.map((grade) => grade.code.toUpperCase());

      for (const grade of body.grades) {
        const refusal = checkBonusMonths(grade.bonusMonths ?? null);
        if (refusal) {
          throw conflict(`${grade.code.toUpperCase()}: ${refusalMessage(refusal)}`);
        }
      }

      const refusal = checkBands(
        body.grades.map((grade) => ({
          code: grade.code.toUpperCase(),
          minScore: grade.minScore,
          maxScore: grade.maxScore,
        })),
      );
      if (refusal) throw conflict(refusalMessage(refusal));

      /*
       * Replaced rather than diffed, but the grade *codes* on finished reviews are stored strings
       * rather than foreign keys — so removing a grade does not orphan a review. It does mean a
       * finalised review can name a grade that no longer exists, which is correct: it names the
       * grade it was given.
       */
      await db().$transaction(async (tx) => {
        await tx.kpiGrade.deleteMany({});
        // Highest band first, so `sortOrder` reads the way a grade table is read.
        const ordered = [...body.grades].sort((left, right) => right.minScore - left.minScore);
        for (const [index, grade] of ordered.entries()) {
          await tx.kpiGrade.create({
            data: {
              code: grade.code.toUpperCase(),
              name: grade.name,
              minScore: grade.minScore,
              maxScore: grade.maxScore,
              bonusMonths: grade.bonusMonths ?? null,
              color: grade.color?.toLowerCase() ?? '#64748b',
              sortOrder: index + 1,
            },
          });
        }
      });

      await recordActivity({
        request,
        action: 'kpi.grades.updated',
        category: 'settings',
        level: 'warn',
        detail: `${String(body.grades.length)} gred: ${codes.join(', ')}`,
      });

      return jsonSafe({ ok: true });
    },
  );
}
