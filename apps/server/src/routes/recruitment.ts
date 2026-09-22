import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requirePermission } from '../auth/plugin.js';
import { can } from '../auth/service.js';
import { db, jsonSafe } from '../db.js';
import {
  applyApprovalAction,
  checkApproverTurn,
  getChain,
  getTrail,
  moduleSettings,
  shouldNotifyApplicant,
} from '../hr/approval.js';
import {
  APPLICANT_STATUSES,
  POSTING_STATUSES,
  applicantTransitionAllowed,
  checkHireable,
  checkPosting,
  checkVacancy,
  isTerminal,
  nextApplicantStatuses,
  postingTransitionAllowed,
  type ApplicantStatus,
  type PostingStatus,
  type Refusal,
} from '../hr/recruitment.js';
import { yearMonthOf } from '../hr/request-number.js';
import { conflict, forbidden, notFound, parseBody, unauthorized } from '../http.js';
import { recordActivity } from '../logging/activity.js';
import { notify } from '../notify/dispatch.js';
import { asDateOnly, dateOnlyKey } from '../time.js';

/**
 * Recruitment: vacancies, candidates, and the hire that turns one into the other.
 *
 * The approval chain here decides offers, not applications. A candidate moving from interview to
 * offered is the decision somebody signs for — everything before it is screening, and everything
 * after it is paperwork.
 *
 * The status column is a pipeline rather than an approval verdict, so the shared engine is given
 * explicit `statusWords`. Without them it would write `approved` into a column where that means
 * nothing.
 */

/** What the shared engine writes into the applicant pipeline for each outcome. */
const APPLICANT_STATUS_WORDS = {
  /** Still climbing the chain: the candidate stays at interview until the last rung signs. */
  pending: 'interview',
  approved: 'offered',
  rejected: 'rejected',
} as const;

function todayKey(): string {
  return dateOnlyKey(asDateOnly(new Date()));
}

function idParam(params: unknown): number {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
  if (!parsed.success) throw notFound('Rekod tidak dijumpai');
  return parsed.data.id;
}

function refusalMessage(refusal: Refusal): string {
  const v = refusal.vars ?? {};
  switch (refusal.key) {
    case 'recruit.refuse.badDate':
      return 'Masukkan tarikh yang sah.';
    case 'recruit.refuse.closesBeforeOpens':
      return 'Tarikh tutup tidak boleh sebelum tarikh buka.';
    case 'recruit.refuse.noPositions':
      return 'Bilangan kekosongan mesti sekurang-kurangnya satu, dan mesti nombor bulat.';
    case 'recruit.refuse.tooManyPositions':
      return 'Bilangan kekosongan melebihi 500 — semak semula.';
    case 'recruit.refuse.salaryOrder':
      return 'Gaji minimum tidak boleh melebihi gaji maksimum.';
    case 'recruit.refuse.badSalary':
      return 'Gaji mesti nombor positif.';
    case 'recruit.refuse.noVacancy':
      return (
        `Iklan ini mengiklankan ${String(v.positions ?? '?')} kekosongan dan ` +
        `${String(v.hired ?? '?')} sudah diambil. Tambah kekosongan atau tutup iklan.`
      );
    case 'recruit.refuse.noName':
      return 'Nama penuh diperlukan.';
    case 'recruit.refuse.noIc':
      return (
        'No. kad pengenalan diperlukan sebelum pemohon boleh menjadi rekod staf — payroll dan ' +
        'penyata statutori berkunci padanya.'
      );
    default:
      return 'Tindakan ini tidak sah.';
  }
}

export async function recruitmentRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // Job postings
  // -------------------------------------------------------------------------

  const postingSchema = z.object({
    code: z.string().trim().min(1).max(24),
    title: z.string().trim().min(1).max(190),
    departmentId: z.union([z.null(), z.number().int().positive()]).optional(),
    locationId: z.union([z.null(), z.number().int().positive()]).optional(),
    summary: z.union([z.literal(''), z.string().trim().max(4000)]).optional(),
    requirements: z.union([z.literal(''), z.string().trim().max(4000)]).optional(),
    positions: z.coerce.number().int().min(1).max(500),
    employmentType: z.enum(['permanent', 'contract', 'temporary', 'internship']),
    salaryMin: z.union([z.null(), z.coerce.number().positive().max(1_000_000)]).optional(),
    salaryMax: z.union([z.null(), z.coerce.number().positive().max(1_000_000)]).optional(),
    openedOn: z.coerce.date(),
    closesOn: z.union([z.null(), z.coerce.date()]).optional(),
  });

  app.get(
    '/api/job-postings',
    { preHandler: requirePermission('hr.career', 'view') },
    async (request) => {
      const query = z
        .object({
          status: z.enum(POSTING_STATUSES).optional(),
          /**
           * The archive screen asks for closed postings and the live screen asks for the rest.
           * One endpoint over a flag rather than two, because the row shape is identical.
           */
          archived: z.enum(['true', 'false']).optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(200).default(25),
        })
        .parse(request.query);

      const where = {
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.archived === undefined
          ? {}
          : query.archived === 'true'
            ? { status: 'closed' }
            : { status: { not: 'closed' } }),
      };

      const [rows, total, grouped] = await Promise.all([
        db().jobPosting.findMany({
          where,
          orderBy: [{ openedOn: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            department: { select: { name: true } },
            location: { select: { name: true } },
            _count: { select: { applicants: true } },
          },
        }),
        db().jobPosting.count({ where }),
        db().jobPosting.groupBy({ by: ['status'], _count: { _all: true } }),
      ]);

      /*
       * Hires are counted per posting in one grouped query rather than per row.
       *
       * The alternative is a count inside the row loop, which at a page of twenty-five postings
       * is twenty-five extra round trips for a number the list always shows.
       */
      const hires = await db().jobApplicant.groupBy({
        by: ['postingId'],
        where: { postingId: { in: rows.map((row) => row.id) }, status: 'hired' },
        _count: { _all: true },
      });
      const hiredByPosting = new Map(hires.map((row) => [row.postingId, row._count._all]));

      return jsonSafe({
        rows: rows.map((row) => ({
          id: row.id,
          code: row.code,
          title: row.title,
          departmentName: row.department?.name ?? null,
          locationName: row.location?.name ?? null,
          positions: row.positions,
          hired: hiredByPosting.get(row.id) ?? 0,
          applicantCount: row._count.applicants,
          employmentType: row.employmentType,
          salaryMin: row.salaryMin === null ? null : Number(row.salaryMin),
          salaryMax: row.salaryMax === null ? null : Number(row.salaryMax),
          openedOn: dateOnlyKey(row.openedOn),
          closesOn: row.closesOn === null ? null : dateOnlyKey(row.closesOn),
          status: row.status,
          summary: row.summary,
          requirements: row.requirements,
          createdAt: row.createdAt.toISOString(),
        })),
        total,
        counts: Object.fromEntries(grouped.map((row) => [row.status, row._count._all])),
        generatedAt: new Date().toISOString(),
      });
    },
  );

  app.post(
    '/api/job-postings',
    { preHandler: requirePermission('hr.career', 'create') },
    async (request) => {
      const body = parseBody(postingSchema, request.body);
      const code = body.code.toUpperCase();

      const clash = await db().jobPosting.findUnique({ where: { code } });
      if (clash) throw conflict(`Kod iklan "${code}" sudah digunakan`);

      const openedOn = asDateOnly(body.openedOn);
      const closesOn = body.closesOn == null ? null : asDateOnly(body.closesOn);

      const refusal = checkPosting({
        openedOn: dateOnlyKey(openedOn),
        closesOn: closesOn === null ? null : dateOnlyKey(closesOn),
        today: todayKey(),
        positions: body.positions,
        salaryMin: body.salaryMin ?? null,
        salaryMax: body.salaryMax ?? null,
      });
      if (refusal) throw conflict(refusalMessage(refusal));

      const row = await db().jobPosting.create({
        data: {
          code,
          title: body.title,
          departmentId: body.departmentId ?? null,
          locationId: body.locationId ?? null,
          summary: body.summary ? body.summary : null,
          requirements: body.requirements ? body.requirements : null,
          positions: body.positions,
          employmentType: body.employmentType,
          salaryMin: body.salaryMin ?? null,
          salaryMax: body.salaryMax ?? null,
          openedOn,
          closesOn,
          // Created as a draft always: publishing is a separate, deliberate act.
          status: 'draft',
        },
      });

      await recordActivity({
        request,
        action: 'career.posting.created',
        category: 'staff',
        detail: `${code}: ${body.title}, ${String(body.positions)} kekosongan`,
      });

      return jsonSafe({ id: row.id, code: row.code });
    },
  );

  app.patch(
    '/api/job-postings/:id',
    { preHandler: requirePermission('hr.career', 'edit') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(postingSchema.partial(), request.body);

      const existing = await db().jobPosting.findUnique({ where: { id } });
      if (!existing) throw notFound('Iklan tidak dijumpai');
      /*
       * A closed posting is a historical record. Candidates applied against what it said, and
       * editing it afterwards would rewrite the advertisement they answered.
       */
      if (existing.status === 'closed') {
        throw conflict('Iklan yang sudah ditutup tidak boleh disunting — ia rekod sejarah.');
      }

      const openedOn = body.openedOn === undefined ? existing.openedOn : asDateOnly(body.openedOn);
      const closesOn =
        body.closesOn === undefined
          ? existing.closesOn
          : body.closesOn == null
            ? null
            : asDateOnly(body.closesOn);

      const refusal = checkPosting({
        openedOn: dateOnlyKey(openedOn),
        closesOn: closesOn === null ? null : dateOnlyKey(closesOn),
        today: todayKey(),
        positions: body.positions ?? existing.positions,
        salaryMin:
          body.salaryMin === undefined
            ? existing.salaryMin === null
              ? null
              : Number(existing.salaryMin)
            : body.salaryMin,
        salaryMax:
          body.salaryMax === undefined
            ? existing.salaryMax === null
              ? null
              : Number(existing.salaryMax)
            : body.salaryMax,
      });
      if (refusal) throw conflict(refusalMessage(refusal));

      // Reducing vacancies below what is already hired would make the count read as over-filled.
      if (body.positions !== undefined) {
        const hired = await db().jobApplicant.count({ where: { postingId: id, status: 'hired' } });
        if (body.positions < hired) {
          throw conflict(
            `${String(hired)} pemohon sudah diambil, jadi kekosongan tidak boleh dikurangkan ` +
              `ke ${String(body.positions)}.`,
          );
        }
      }

      await db().jobPosting.update({
        where: { id },
        data: {
          ...(body.code === undefined ? {} : { code: body.code.toUpperCase() }),
          ...(body.title === undefined ? {} : { title: body.title }),
          ...(body.departmentId === undefined ? {} : { departmentId: body.departmentId }),
          ...(body.locationId === undefined ? {} : { locationId: body.locationId }),
          ...(body.summary === undefined ? {} : { summary: body.summary ? body.summary : null }),
          ...(body.requirements === undefined
            ? {}
            : { requirements: body.requirements ? body.requirements : null }),
          ...(body.positions === undefined ? {} : { positions: body.positions }),
          ...(body.employmentType === undefined ? {} : { employmentType: body.employmentType }),
          ...(body.salaryMin === undefined ? {} : { salaryMin: body.salaryMin }),
          ...(body.salaryMax === undefined ? {} : { salaryMax: body.salaryMax }),
          ...(body.openedOn === undefined ? {} : { openedOn }),
          ...(body.closesOn === undefined ? {} : { closesOn }),
        },
      });

      await recordActivity({
        request,
        action: 'career.posting.updated',
        category: 'staff',
        detail: `${existing.code} dikemas kini`,
      });

      return { ok: true };
    },
  );

  /** Moves a posting along its lifecycle. Forward only; the rule library says which way. */
  app.post(
    '/api/job-postings/:id/status',
    { preHandler: requirePermission('hr.career', 'edit') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(z.object({ status: z.enum(POSTING_STATUSES) }), request.body);

      const existing = await db().jobPosting.findUnique({ where: { id } });
      if (!existing) throw notFound('Iklan tidak dijumpai');

      const from = existing.status as PostingStatus;
      if (!postingTransitionAllowed(from, body.status)) {
        throw conflict(
          `Iklan tidak boleh bertukar dari "${from}" ke "${body.status}". ` +
            'Kitaran hayat iklan bergerak ke hadapan sahaja.',
        );
      }

      await db().jobPosting.update({
        where: { id },
        data: {
          status: body.status,
          ...(body.status === 'published' ? { publishedAt: new Date() } : {}),
          ...(body.status === 'closed' ? { closedAt: new Date() } : {}),
        },
      });

      await recordActivity({
        request,
        action: `career.posting.${body.status}`,
        category: 'staff',
        level: body.status === 'closed' ? 'warn' : 'info',
        detail: `${existing.code}: ${from} → ${body.status}`,
      });

      return { ok: true };
    },
  );

  app.delete(
    '/api/job-postings/:id',
    { preHandler: requirePermission('hr.career', 'delete') },
    async (request) => {
      const id = idParam(request.params);

      const existing = await db().jobPosting.findUnique({ where: { id } });
      if (!existing) throw notFound('Iklan tidak dijumpai');

      const applicants = await db().jobApplicant.count({ where: { postingId: id } });
      // Applicants have to be able to name the post they applied for.
      if (applicants > 0) {
        throw conflict(
          `${String(applicants)} pemohon merujuk iklan ini. Tutup iklan itu sebagai ganti.`,
        );
      }

      await db().jobPosting.delete({ where: { id } });
      await recordActivity({
        request,
        action: 'career.posting.deleted',
        category: 'staff',
        level: 'warn',
        detail: existing.code,
      });

      return { ok: true };
    },
  );

  // -------------------------------------------------------------------------
  // Applicants
  // -------------------------------------------------------------------------

  app.get(
    '/api/job-applicants',
    { preHandler: requirePermission('hr.applicants', 'view') },
    async (request) => {
      const query = z
        .object({
          postingId: z.coerce.number().int().positive().optional(),
          status: z.enum(APPLICANT_STATUSES).optional(),
          /** The archive screen wants candidates on closed postings. */
          archived: z.enum(['true', 'false']).optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(200).default(25),
        })
        .parse(request.query);

      const where = {
        ...(query.postingId === undefined ? {} : { postingId: query.postingId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.archived === undefined
          ? {}
          : query.archived === 'true'
            ? { posting: { status: 'closed' } }
            : { posting: { status: { not: 'closed' } } }),
      };

      const [rows, total, grouped, chain] = await Promise.all([
        db().jobApplicant.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            posting: { select: { code: true, title: true, status: true } },
            staff: { select: { id: true, employeeNo: true } },
          },
        }),
        db().jobApplicant.count({ where }),
        db().jobApplicant.groupBy({
          by: ['status'],
          where: { ...where, status: undefined },
          _count: { _all: true },
        }),
        getChain('applicants'),
      ]);

      return jsonSafe({
        rows: rows.map(serialiseApplicant),
        total,
        counts: Object.fromEntries(grouped.map((row) => [row.status, row._count._all])),
        chainLength: chain.length,
        generatedAt: new Date().toISOString(),
      });
    },
  );

  app.post(
    '/api/job-applicants',
    { preHandler: requirePermission('hr.applicants', 'edit') },
    async (request) => {
      const body = parseBody(
        z.object({
          postingId: z.number().int().positive(),
          fullName: z.string().trim().min(1).max(190),
          icNo: z.union([z.literal(''), z.string().trim().max(20)]).optional(),
          email: z.union([z.literal(''), z.email('Emel tidak sah').max(190)]).optional(),
          phone: z.union([z.literal(''), z.string().trim().max(20)]).optional(),
          coverNote: z.union([z.literal(''), z.string().trim().max(4000)]).optional(),
        }),
        request.body,
      );

      const posting = await db().jobPosting.findUnique({ where: { id: body.postingId } });
      if (!posting) throw notFound('Iklan tidak dijumpai');
      /*
       * Only a published posting takes applications. A draft is not advertised, and a closed one
       * had a deadline that has passed.
       */
      if (posting.status !== 'published') {
        throw conflict(
          `Iklan ini "${posting.status}" — hanya iklan yang diterbitkan menerima permohonan.`,
        );
      }

      const yearMonth = yearMonthOf(asDateOnly(new Date()));
      const row = await db().$transaction(async (tx) => {
        const latest = await tx.jobApplicant.findMany({
          where: { applicantNo: { startsWith: `PMH-${yearMonth}-` } },
          select: { applicantNo: true },
        });
        const highest = latest.reduce((max, item) => {
          const match = /-(\d+)$/.exec(item.applicantNo);
          return Math.max(max, match?.[1] === undefined ? 0 : Number(match[1]));
        }, 0);

        return tx.jobApplicant.create({
          data: {
            applicantNo: `PMH-${yearMonth}-${String(highest + 1).padStart(3, '0')}`,
            postingId: body.postingId,
            fullName: body.fullName,
            icNo: body.icNo ? body.icNo : null,
            email: body.email ? body.email : null,
            phone: body.phone ? body.phone : null,
            coverNote: body.coverNote ? body.coverNote : null,
            status: 'new',
          },
        });
      });

      await recordActivity({
        request,
        action: 'career.applicant.created',
        category: 'staff',
        detail: `${row.applicantNo}: ${body.fullName} → ${posting.code}`,
      });

      return jsonSafe({ id: row.id, applicantNo: row.applicantNo });
    },
  );

  /**
   * Moves a candidate through the pipeline, for the stages the chain does not own.
   *
   * `offered` is deliberately not settable here: that is the decision the approval chain exists
   * for, and it goes through `/decide`. Everything else — screening, interview scheduling,
   * rejection, withdrawal — is administrative movement.
   */
  app.post(
    '/api/job-applicants/:id/status',
    { preHandler: requirePermission('hr.applicants', 'edit') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const id = idParam(request.params);

      const body = parseBody(
        z.object({
          status: z.enum(APPLICANT_STATUSES),
          note: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
          interviewAt: z.union([z.null(), z.coerce.date()]).optional(),
        }),
        request.body,
      );

      const existing = await db().jobApplicant.findUnique({
        where: { id },
        include: { posting: { select: { code: true, title: true } } },
      });
      if (!existing) throw notFound('Pemohon tidak dijumpai');

      const from = existing.status as ApplicantStatus;
      if (isTerminal(from)) {
        throw conflict(
          `Pemohon ini sudah "${from}", yang merupakan keadaan akhir. Ia tidak boleh diubah.`,
        );
      }
      if (!applicantTransitionAllowed(from, body.status)) {
        throw conflict(
          `Pemohon tidak boleh bertukar dari "${from}" ke "${body.status}". ` +
            `Langkah yang dibenarkan: ${nextApplicantStatuses(from).join(', ')}.`,
        );
      }
      if (body.status === 'offered') {
        throw conflict(
          'Tawaran dibuat melalui kelulusan, bukan di sini — itu keputusan yang aliran ' +
            'kelulusan wujud untuknya.',
        );
      }
      if (body.status === 'hired') {
        throw conflict('Pengambilan dibuat melalui endpoint pengambilan, yang mencipta rekod staf.');
      }
      if (body.status === 'rejected' && (body.note ?? '').trim().length < 3) {
        throw conflict('Penolakan memerlukan sebab bertulis.');
      }

      await db().jobApplicant.update({
        where: { id },
        data: {
          status: body.status,
          ...(body.interviewAt === undefined ? {} : { interviewAt: body.interviewAt }),
          ...(body.note === undefined
            ? {}
            : { interviewNote: body.note ? body.note : null }),
          ...(body.status === 'rejected'
            ? {
                decidedBy: request.user.accountId,
                decidedAt: new Date(),
                decisionNote: body.note ?? null,
              }
            : {}),
        },
      });

      await recordActivity({
        request,
        action: `career.applicant.${body.status}`,
        category: 'staff',
        level: body.status === 'rejected' ? 'warn' : 'info',
        detail: `${existing.applicantNo}: ${from} → ${body.status}`,
      });

      return { ok: true };
    },
  );

  /**
   * The offer decision, through the shared chain.
   *
   * Approving writes `offered`, rejecting writes `rejected`, and an intermediate rung leaves the
   * candidate at `interview` — because until the last signature the offer has not been made and
   * saying otherwise to a candidate would be worse than saying nothing.
   */
  app.post(
    '/api/job-applicants/:id/decide',
    { preHandler: requirePermission('hr.applicants', 'approve') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const id = idParam(request.params);

      const body = parseBody(
        z.object({
          decision: z.enum(['approved', 'rejected']),
          note: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
        }),
        request.body,
      );

      const existing = await db().jobApplicant.findUnique({
        where: { id },
        include: { posting: { select: { code: true, title: true, positions: true, id: true } } },
      });
      if (!existing) throw notFound('Pemohon tidak dijumpai');

      const from = existing.status as ApplicantStatus;
      // Only a candidate who has reached interview can be offered.
      if (from !== 'interview') {
        throw conflict(
          `Hanya pemohon pada peringkat temuduga boleh diputuskan. Ini "${from}".`,
        );
      }
      if (body.decision === 'rejected' && (body.note ?? '').trim().length < 3) {
        throw conflict('Penolakan memerlukan sebab bertulis.');
      }

      const outOfTurn = await checkApproverTurn({
        module: 'applicants',
        currentLevel: existing.currentLevel,
        accountId: request.user.accountId,
        roleId: request.user.roleId,
        mayOverride: can(request.user, 'hr.careerSettings', 'configure'),
      });
      if (outOfTurn !== null) throw forbidden(outOfTurn);

      // Checked before the offer, not at hire: offering a post that is already full is a promise
      // somebody has to withdraw.
      if (body.decision === 'approved') {
        const hired = await db().jobApplicant.count({
          where: { postingId: existing.postingId, status: 'hired' },
        });
        const refusal = checkVacancy({ positions: existing.posting.positions, hired });
        if (refusal) throw conflict(refusalMessage(refusal));
      }

      const outcome = await applyApprovalAction({
        module: 'applicants',
        applicationId: id,
        action: body.decision === 'approved' ? 'approve' : 'reject',
        actor: { accountId: request.user.accountId, label: request.user.fullName },
        remarks: body.note ?? null,
        currentLevel: existing.currentLevel,
        statusWords: APPLICANT_STATUS_WORDS,
      });

      await db().jobApplicant.update({
        where: { id },
        data: {
          // The pipeline word, not the approval verdict.
          status: outcome.writtenStatus,
          currentLevel: outcome.level,
          decidedBy: request.user.accountId,
          decidedAt: new Date(),
          decisionNote: body.note && body.note.length > 0 ? body.note : null,
        },
      });

      await db().auditLog.create({
        data: {
          accountId: request.user.accountId,
          actorLabel: request.user.fullName,
          action: 'update',
          entityType: 'JobApplicant',
          entityId: String(id),
          changes: JSON.parse(
            JSON.stringify({
              status: { before: from, after: outcome.writtenStatus },
              level: { before: existing.currentLevel, after: outcome.level },
            }),
          ) as object,
          reason: body.note ?? null,
        },
      });

      const settings = await moduleSettings('applicants');
      if (shouldNotifyApplicant(settings, outcome)) {
        notify({
          trigger: outcome.status === 'approved' ? 'applicant.offered' : 'applicant.rejected',
          mobile: existing.phone,
          summary: outcome.finalized
            ? outcome.status === 'approved'
              ? `Tawaran untuk ${existing.posting.title} telah diluluskan.`
              : `Permohonan untuk ${existing.posting.title} tidak berjaya.`
            : `Permohonan ${existing.applicantNo} diluluskan pada aras ${String(outcome.level)} ` +
              `daripada ${String(outcome.totalLevels)}.`,
          email: {
            module: 'applicants',
            event:
              outcome.status === 'rejected'
                ? 'rejected'
                : outcome.finalized
                  ? 'approved'
                  : 'levelApproved',
            to: existing.email,
            vars: {
              staffName: existing.fullName,
              employeeNo: null,
              requestNo: existing.applicantNo,
              status: outcome.writtenStatus,
              decidedBy: request.user.fullName,
              note: body.note ?? null,
              level: outcome.level,
              totalLevels: outcome.totalLevels,
              awaitingLevel: outcome.awaitingLevel,
              awaitingApprover: outcome.awaitingLabel,
              jobTitle: existing.posting.title,
              postingCode: existing.posting.code,
              applicantNo: existing.applicantNo,
              pipelineStatus: outcome.writtenStatus,
              interviewAt:
                existing.interviewAt === null ? null : existing.interviewAt.toISOString(),
            },
          },
        });
      }

      await recordActivity({
        request,
        action: `career.applicant.${outcome.writtenStatus}`,
        category: 'staff',
        level: outcome.status === 'rejected' ? 'warn' : 'info',
        detail: `${existing.applicantNo}: aras ${String(outcome.level)} → ${outcome.writtenStatus}`,
      });

      return jsonSafe({
        ok: true,
        status: outcome.writtenStatus,
        level: outcome.level,
        totalLevels: outcome.totalLevels,
        finalized: outcome.finalized,
        awaitingLevel: outcome.awaitingLevel,
        awaitingLabel: outcome.awaitingLabel,
      });
    },
  );

  /**
   * Turns an offered candidate into a staff record.
   *
   * This is the reason the two tables are linked rather than the applicant simply being deleted:
   * the name, IC, email and phone are already here, and retyping them is where transcription
   * errors enter a directory that every terminal and every attendance row keys on.
   *
   * The staff record is created inactive with no `employeeNo` guessed — the operator supplies
   * that, because it is the join key to every device and it has to match whatever the
   * organisation's numbering already is.
   */
  app.post(
    '/api/job-applicants/:id/hire',
    { preHandler: requirePermission('hr.applicants', 'approve') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const id = idParam(request.params);

      const body = parseBody(
        z.object({
          employeeNo: z
            .string()
            .trim()
            .min(1)
            .max(32)
            .regex(/^[A-Za-z0-9._-]+$/, 'Hanya huruf, nombor, titik, sengkang'),
          departmentId: z.union([z.null(), z.number().int().positive()]).optional(),
          locationId: z.union([z.null(), z.number().int().positive()]).optional(),
          hireDate: z.coerce.date(),
          position: z.union([z.literal(''), z.string().trim().max(120)]).optional(),
        }),
        request.body,
      );

      const existing = await db().jobApplicant.findUnique({
        where: { id },
        include: { posting: { select: { id: true, code: true, title: true, positions: true } } },
      });
      if (!existing) throw notFound('Pemohon tidak dijumpai');
      if (existing.status !== 'offered') {
        throw conflict(
          `Hanya pemohon yang sudah ditawarkan boleh diambil. Ini "${existing.status}".`,
        );
      }
      if (existing.staffId !== null) {
        throw conflict('Pemohon ini sudah mempunyai rekod staf.');
      }

      const hireable = checkHireable({ icNo: existing.icNo, fullName: existing.fullName });
      if (hireable) throw conflict(refusalMessage(hireable));

      const hired = await db().jobApplicant.count({
        where: { postingId: existing.postingId, status: 'hired' },
      });
      const vacancy = checkVacancy({ positions: existing.posting.positions, hired });
      if (vacancy) throw conflict(refusalMessage(vacancy));

      const clash = await db().staff.findUnique({ where: { employeeNo: body.employeeNo } });
      if (clash) throw conflict(`No. Staf "${body.employeeNo}" sudah digunakan`);

      /*
       * One transaction: the staff row and the applicant's link to it are one fact. A crash
       * between them would leave a hired candidate with no record, or a staff row nobody knows
       * came from a hire.
       */
      const staff = await db().$transaction(async (tx) => {
        const created = await tx.staff.create({
          data: {
            employeeNo: body.employeeNo,
            fullName: existing.fullName,
            icNo: existing.icNo,
            email: existing.email,
            phone: existing.phone,
            departmentId: body.departmentId ?? null,
            locationId: body.locationId ?? null,
            hireDate: asDateOnly(body.hireDate),
            position: body.position ? body.position : existing.posting.title,
            /*
             * Inactive until somebody enrols them on a terminal and checks the record. An
             * active staff member who cannot scan is reported absent from their first day.
             */
            active: false,
          },
        });

        await tx.jobApplicant.update({
          where: { id },
          data: { status: 'hired', staffId: created.id, decidedAt: new Date() },
        });

        return created;
      });

      await db().auditLog.create({
        data: {
          accountId: request.user.accountId,
          actorLabel: request.user.fullName,
          action: 'create',
          entityType: 'Staff',
          entityId: String(staff.id),
          changes: JSON.parse(
            JSON.stringify({
              employeeNo: { before: null, after: staff.employeeNo },
              fullName: { before: null, after: staff.fullName },
              fromApplicant: existing.applicantNo,
            }),
          ) as object,
          reason: `Diambil dari iklan ${existing.posting.code}`,
        },
      });

      await recordActivity({
        request,
        action: 'career.applicant.hired',
        category: 'staff',
        detail:
          `${existing.applicantNo} → staf ${staff.employeeNo} (${staff.fullName}), ` +
          `iklan ${existing.posting.code}`,
      });

      return jsonSafe({
        ok: true,
        staffId: staff.id,
        employeeNo: staff.employeeNo,
        /*
         * Stated rather than left for the operator to discover: the record exists but the person
         * cannot scan yet, and nothing has been pushed to a terminal.
         */
        staffInactive: true,
      });
    },
  );

  app.get(
    '/api/job-applicants/:id',
    { preHandler: requirePermission('hr.applicants', 'view') },
    async (request) => {
      const id = idParam(request.params);
      const row = await db().jobApplicant.findUnique({
        where: { id },
        include: {
          posting: { select: { code: true, title: true, status: true } },
          staff: { select: { id: true, employeeNo: true } },
        },
      });
      if (!row) throw notFound('Pemohon tidak dijumpai');

      return jsonSafe({
        ...serialiseApplicant(row),
        coverNote: row.coverNote,
        trail: await getTrail('applicants', id),
      });
    },
  );

  app.delete(
    '/api/job-applicants/:id',
    { preHandler: requirePermission('hr.applicants', 'delete') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const id = idParam(request.params);

      const existing = await db().jobApplicant.findUnique({ where: { id } });
      if (!existing) throw notFound('Pemohon tidak dijumpai');
      // A hired candidate is attached to a staff record; deleting the application would orphan it.
      if (existing.staffId !== null) {
        throw conflict('Pemohon yang sudah diambil tidak boleh dibuang — rekod staf merujuknya.');
      }

      /*
       * A real delete, not a flag. This is a member of the public's personal data: name, IC,
       * phone, CV. Retaining it indefinitely because the schema found it convenient is the kind
       * of decision that has to be deliberate, and here it is deliberately the other way.
       */
      await db().$transaction(async (tx) => {
        await tx.hrApprovalRecord.deleteMany({ where: { module: 'applicants', applicationId: id } });
        await tx.jobApplicant.delete({ where: { id } });
      });

      await recordActivity({
        request,
        action: 'career.applicant.deleted',
        category: 'staff',
        level: 'warn',
        detail: `${existing.applicantNo} dibuang bersama jejak keputusannya`,
      });

      return { ok: true };
    },
  );
}

type ApplicantRecord = {
  id: number;
  applicantNo: string;
  postingId: number;
  fullName: string;
  icNo: string | null;
  email: string | null;
  phone: string | null;
  resumePath: string | null;
  status: string;
  currentLevel: number;
  interviewAt: Date | null;
  interviewNote: string | null;
  staffId: number | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
  posting: { code: string; title: string; status: string };
  staff: { id: number; employeeNo: string } | null;
};

/** `resumePath` stays on the server; `hasResume` is what the screen needs. */
function serialiseApplicant(row: ApplicantRecord): Record<string, unknown> {
  return {
    id: row.id,
    applicantNo: row.applicantNo,
    postingId: row.postingId,
    postingCode: row.posting.code,
    postingTitle: row.posting.title,
    postingStatus: row.posting.status,
    fullName: row.fullName,
    icNo: row.icNo,
    email: row.email,
    phone: row.phone,
    hasResume: row.resumePath !== null,
    status: row.status,
    currentLevel: row.currentLevel,
    /** A timestamp, not a calendar date: an interview happens at a time. */
    interviewAt: row.interviewAt?.toISOString() ?? null,
    interviewNote: row.interviewNote,
    staffId: row.staffId,
    employeeNo: row.staff?.employeeNo ?? null,
    /** What the pipeline allows next, so the screen offers exactly those. */
    nextStatuses: isTerminal(row.status as ApplicantStatus)
      ? []
      : nextApplicantStatuses(row.status as ApplicantStatus),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
  };
}
