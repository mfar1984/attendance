import { staffInputSchema, staffUpdateSchema } from '@attendance/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requirePermission } from '../auth/plugin.js';
import { can, type AuthenticatedUser } from '../auth/service.js';
import { encryptSecret } from '../crypto.js';
import { db, jsonSafe } from '../db.js';
import { conflict, forbidden, notFound, parseBody, unauthorized } from '../http.js';
import { recordActivity } from '../logging/activity.js';
import { enrolFace, readEnrolledFace, removeFace } from './faces.js';
import { getImportJob, importTemplate, previewImport, startImport } from './import.js';
import {
  pushStaffToDevices,
  refreshCredentialCounts,
  removeStaffFromDevices,
} from './sync.js';

/** Terminals to enrol on when creating. Absent means none. */
const createAssignment = z.object({
  deviceIds: z.array(z.number().int().positive()).default([]),
});

/**
 * Terminal assignment when updating.
 *
 * No default, and genuinely optional. A default of `[]` here would be read as
 * "assign to no terminals" on any update that does not mention devices, which
 * means editing a phone number would quietly remove that person from every door.
 * Omitting the field must leave the existing assignment alone.
 */
const updateAssignment = z.object({
  deviceIds: z.array(z.number().int().positive()).optional(),
});

export async function staffRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Accepts raw JPEG bodies for face enrolment.
   *
   * Registered on this plugin scope only, so the JSON parser stays the default
   * everywhere else.
   */
  app.addContentTypeParser(
    'image/jpeg',
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );

  /** CSV uploads arrive as text rather than JSON. */
  app.addContentTypeParser(
    ['text/csv', 'text/plain'],
    { parseAs: 'string' },
    (_request, body, done) => done(null, body),
  );

  app.get('/api/staff/:id', { preHandler: requirePermission('staff.directory', 'view') }, async (request) => {
    if (!request.user) throw unauthorized();
    const id = idParam(request.params);

    const staff = await db().staff.findUnique({
      where: { id },
      include: {
        department: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        workPattern: { select: { id: true, name: true } },
        account: { select: { id: true, email: true, status: true, allowAppCheckIn: true } },
        enrolments: {
          include: { device: { select: { id: true, name: true, status: true } } },
        },
      },
    });
    if (!staff) throw notFound('Staf tidak dijumpai');

    // The door PIN is never returned, not even encrypted. Nothing in the UI needs
    // to read it back, and the terminal already exposes it in cleartext on its own
    // search endpoint - one leak is enough.
    const { doorPinEncrypted: _omitted, basicSalary, ...rest } = staff;

    /*
     * The wage is dropped for a caller without the `salary` action rather than sent
     * and hidden by the screen. A field the client is trusted to conceal is a field
     * anybody can read out of the network tab.
     *
     * `canReadSalary` goes with it so the screen can say the figure is withheld
     * instead of showing an empty row that reads as "no wage recorded".
     */
    const canReadSalary = can(request.user, 'staff.directory', 'salary');

    return jsonSafe({
      ...rest,
      ...(canReadSalary ? { basicSalary: basicSalary === null ? null : Number(basicSalary) } : {}),
      canReadSalary,
      hasDoorPin: staff.doorPinEncrypted !== null,
    });
  });

  /**
   * Creates a staff member and enrols them on the chosen terminals.
   *
   * The database write and the device push are deliberately not one transaction:
   * a terminal cannot participate in one. The record is committed first, then each
   * terminal is attempted, and per-terminal failures come back in the response so
   * the operator sees exactly which doors this person cannot yet use.
   */
  app.post('/api/staff', { preHandler: requirePermission('staff.directory', 'create') }, async (request) => {
    if (!request.user) throw unauthorized();

    const body = parseBody(staffInputSchema.and(createAssignment), request.body);
    assertMaySetSalary(request.user, body.basicSalary);

    const clash = await db().staff.findUnique({ where: { employeeNo: body.employeeNo } });
    if (clash) throw conflict(`No. Staf "${body.employeeNo}" sudah digunakan`);

    const staff = await db().staff.create({
      data: {
        employeeNo: body.employeeNo,
        fullName: body.fullName,
        icNo: body.icNo ?? null,
        gender: body.gender ?? null,
        phone: body.phone ?? null,
        email: body.email ?? null,
        departmentId: body.departmentId ?? null,
        locationId: body.locationId ?? null,
        hireDate: body.hireDate ?? null,
        basicSalary: body.basicSalary ?? null,
        validFrom: body.validFrom ?? null,
        validTo: body.validTo ?? null,
        doorPinEncrypted: body.doorPin ? encryptSecret(body.doorPin) : null,
        active: body.active,
        notes: body.notes ?? null,
      },
    });

    const sync = await pushStaffToDevices(staff, body.deviceIds);

    await writeAudit(request.user, 'create', staff.id, {
      employeeNo: { before: null, after: staff.employeeNo },
      fullName: { before: null, after: staff.fullName },
    });

    return jsonSafe({ id: staff.id, sync });
  });

  app.patch('/api/staff/:id', { preHandler: requirePermission('staff.directory', 'edit') }, async (request) => {
    if (!request.user) throw unauthorized();

    const id = idParam(request.params);
    const body = parseBody(staffUpdateSchema.and(updateAssignment), request.body);

    assertMaySetSalary(request.user, body.basicSalary);

    const existing = await db().staff.findUnique({ where: { id } });
    if (!existing) throw notFound('Staf tidak dijumpai');

    /**
     * Renaming the identifier is refused.
     *
     * `employeeNo` is the join key to every terminal and to historical raw events.
     * Changing it would orphan the mapping rows and silently detach the person
     * from their own attendance history. Create a new record instead.
     */
    if (body.employeeNo !== undefined && body.employeeNo !== existing.employeeNo) {
      throw conflict(
        'No. Staf tidak boleh ditukar selepas dicipta kerana ia menjadi kunci ke terminal dan ' +
          'sejarah kehadiran. Cipta rekod baharu jika perlu.',
      );
    }

    const staff = await db().staff.update({
      where: { id },
      data: {
        ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
        ...(body.icNo !== undefined ? { icNo: body.icNo } : {}),
        ...(body.gender !== undefined ? { gender: body.gender } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.departmentId !== undefined ? { departmentId: body.departmentId } : {}),
        ...(body.locationId !== undefined ? { locationId: body.locationId } : {}),
        ...(body.hireDate !== undefined ? { hireDate: body.hireDate } : {}),
        ...(body.basicSalary !== undefined ? { basicSalary: body.basicSalary } : {}),
        ...(body.validFrom !== undefined ? { validFrom: body.validFrom } : {}),
        ...(body.validTo !== undefined ? { validTo: body.validTo } : {}),
        ...(body.doorPin !== undefined ? { doorPinEncrypted: encryptSecret(body.doorPin) } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      },
    });

    const changes: Record<string, { before: unknown; after: unknown }> = {};
    if (body.fullName !== undefined && body.fullName !== existing.fullName) {
      changes['fullName'] = { before: existing.fullName, after: staff.fullName };
    }
    if (body.active !== undefined && body.active !== existing.active) {
      changes['active'] = { before: existing.active, after: staff.active };
    }
    /*
     * Audited even though it is not an identity field. The wage prices every overtime
     * claim this person files, so a change here moves money and the trail has to name
     * who moved it.
     */
    if (body.basicSalary !== undefined) {
      const before = existing.basicSalary === null ? null : Number(existing.basicSalary);
      const after = staff.basicSalary === null ? null : Number(staff.basicSalary);
      if (before !== after) changes['basicSalary'] = { before, after };
    }
    if (Object.keys(changes).length > 0) {
      await writeAudit(request.user, 'update', staff.id, changes);
    }

    const currentDevices = (
      await db().deviceEnrolment.findMany({
        where: { staffId: id },
        select: { deviceId: true },
      })
    ).map((row) => row.deviceId);

    // Re-pushed so a name or validity change reaches the doors, otherwise the
    // terminal keeps showing the old name on its screen.
    const targets = body.deviceIds ?? currentDevices;
    const sync = await pushStaffToDevices(staff, targets);

    /**
     * Un-enrolment only happens when the caller actually sent an assignment.
     *
     * Treating an absent field as an empty assignment would make any unrelated
     * edit remove the person from every terminal, which is both destructive and
     * invisible until they are turned away at the door.
     */
    const removal =
      body.deviceIds === undefined
        ? []
        : await removeStaffFromDevices(
            staff,
            currentDevices.filter((deviceId) => !body.deviceIds!.includes(deviceId)),
          );

    return jsonSafe({ id: staff.id, sync, removal });
  });

  /**
   * Deactivates a staff member.
   *
   * A soft delete by default. Hard-deleting would cascade their punches away, and
   * those are the evidence behind pay that has already been issued.
   */
  app.delete('/api/staff/:id', { preHandler: requirePermission('staff.directory', 'delete') }, async (request) => {
    if (!request.user) throw unauthorized();

    const id = idParam(request.params);
    const query = z.object({ removeFromDevices: z.stringbool().default(true) }).parse(request.query);

    const staff = await db().staff.findUnique({ where: { id } });
    if (!staff) throw notFound('Staf tidak dijumpai');

    const removal = query.removeFromDevices ? await removeStaffFromDevices(staff) : [];

    await db().staff.update({ where: { id }, data: { active: false } });

    await writeAudit(request.user, 'update', id, {
      active: { before: staff.active, after: false },
    });

    // No explanatory note in the response: the screen states the same thing in the confirm
    // dialog, from the registry, where it can be translated. Two copies of one sentence is
    // one copy too many, and the one in a route cannot be translated at all.
    return jsonSafe({ id, removal });
  });

  /** Re-reads credential counts from the terminals for one staff member. */
  app.post(
    '/api/staff/:id/refresh-credentials',
    { preHandler: requirePermission('staff.directory', 'view') },
    async (request) => {
      const id = idParam(request.params);
      const staff = await db().staff.findUnique({ where: { id }, select: { id: true } });
      if (!staff) throw notFound('Staf tidak dijumpai');
      return jsonSafe(await refreshCredentialCounts(id));
    },
  );

  /**
   * Everything the terminals reported about one person, and what became of it.
   *
   * Guarded by `attendance.rawLog` rather than `staff.directory`: this serves the untouched
   * device log, which is what settles a dispute over a computed record. Somebody granted the
   * directory so they could correct a phone number has not been granted the evidence table.
   *
   * Two queries merged, because neither alone is the whole story:
   *
   *  - Punches, which include app check-ins and manual entries that have no device event at
   *    all. A raw-events-only view would show nothing for a day somebody clocked in on their
   *    phone, which reads as an absence.
   *  - Raw events that never became a punch — an unmapped identifier, an unrecognised face,
   *    a door event. Those are the ones somebody is looking for when attendance is missing.
   *
   * The raw side is resolved through the person's per-device identifiers, not through
   * `staff.employeeNo`. That is the whole subtlety: the same person routinely carries a
   * different `employeeNo` on each terminal, so filtering by the canonical number would
   * silently drop every scan from the units where it differs.
   */
  app.get(
    '/api/staff/:id/scans',
    { preHandler: requirePermission('attendance.rawLog', 'view') },
    async (request) => {
      const id = idParam(request.params);
      const query = z
        .object({
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
          limit: z.coerce.number().int().min(1).max(500).default(200),
        })
        .parse(request.query);

      const staff = await db().staff.findUnique({
        where: { id },
        select: { id: true, employeeNo: true },
      });
      if (!staff) throw notFound('Staf tidak dijumpai');

      const range = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: endOfDay(query.to) } : {}),
      };
      const hasRange = query.from !== undefined || query.to !== undefined;

      const enrolments = await db().deviceEnrolment.findMany({
        where: { staffId: id },
        select: { deviceId: true, deviceEmployeeNo: true },
      });

      const punches = await db().punch.findMany({
        where: { staffId: id, ...(hasRange ? { punchAt: range } : {}) },
        orderBy: { punchAt: 'desc' },
        take: query.limit,
        include: {
          device: { select: { id: true, name: true } },
          rawEvent: {
            select: {
              id: true,
              serialNo: true,
              major: true,
              minor: true,
              employeeNo: true,
              verifyMode: true,
              deviceDriftS: true,
              arrivedVia: true,
              pictureUrl: true,
            },
          },
        },
      });

      /**
       * Unresolved events, keyed on the exact `(deviceId, employeeNo)` pairs this person
       * holds. An empty enrolment list means there is nothing to match, and an empty `OR`
       * in Prisma matches every row rather than none — so it is skipped outright.
       */
      const orphans =
        enrolments.length === 0
          ? []
          : await db().rawEvent.findMany({
              where: {
                punch: null,
                OR: enrolments.map((row) => ({
                  deviceId: row.deviceId,
                  employeeNo: row.deviceEmployeeNo,
                })),
                ...(hasRange ? { eventTime: range } : {}),
              },
              orderBy: { eventTime: 'desc' },
              take: query.limit,
              select: {
                id: true,
                serialNo: true,
                major: true,
                minor: true,
                eventTime: true,
                employeeNo: true,
                verifyMode: true,
                deviceDriftS: true,
                arrivedVia: true,
                pictureUrl: true,
                device: { select: { id: true, name: true } },
              },
            });

      const timeline = [
        ...punches.map((punch) => ({
          at: punch.punchAt,
          source: punch.source,
          punchId: punch.id,
          method: punch.method,
          direction: punch.direction,
          suppressed: punch.suppressed,
          note: punch.note,
          deviceName: punch.device?.name ?? null,
          rawEventId: punch.rawEvent === null ? null : String(punch.rawEvent.id),
          /**
           * Null-checked on the value, not just on the row.
           *
           * `String(null)` is the string `"null"`, so a terminal whose protocol has no
           * event sequence would print `#null` on the timeline. Callback protocols have
           * no sequence at all, which makes that the normal case rather than an edge one.
           */
          serialNo:
            punch.rawEvent?.serialNo === null || punch.rawEvent?.serialNo === undefined
              ? null
              : String(punch.rawEvent.serialNo),
          deviceEmployeeNo: punch.rawEvent?.employeeNo ?? null,
          major: punch.rawEvent?.major ?? null,
          minor: punch.rawEvent?.minor ?? null,
          verifyMode: punch.rawEvent?.verifyMode ?? null,
          driftSeconds: punch.rawEvent?.deviceDriftS ?? null,
          arrivedVia: punch.rawEvent?.arrivedVia ?? null,
          hasPicture: (punch.rawEvent?.pictureUrl ?? null) !== null,
        })),
        ...orphans.map((event) => ({
          at: event.eventTime,
          source: 'terminal',
          punchId: null,
          method: null,
          direction: null,
          suppressed: false,
          note: null,
          deviceName: event.device.name,
          rawEventId: String(event.id),
          serialNo: event.serialNo === null ? null : String(event.serialNo),
          deviceEmployeeNo: event.employeeNo,
          major: event.major,
          minor: event.minor,
          verifyMode: event.verifyMode,
          driftSeconds: event.deviceDriftS,
          arrivedVia: event.arrivedVia,
          hasPicture: event.pictureUrl !== null,
        })),
      ]
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, query.limit);

      return jsonSafe({
        canonicalEmployeeNo: staff.employeeNo,
        /** The identifiers the raw side was matched on, so the screen can say so. */
        deviceEmployeeNos: [...new Set(enrolments.map((row) => row.deviceEmployeeNo))],
        limit: query.limit,
        /** True when the cap was reached, so a partial list is not read as the whole. */
        truncated: timeline.length >= query.limit,
        rows: timeline,
      });
    },
  );

  /**
   * Uploads a face picture.
   *
   * The body is raw JPEG bytes, not multipart. The browser has already cropped and
   * compressed the image to satisfy the terminal, so wrapping it adds a parsing
   * step and a dependency for no benefit.
   */
  app.post(
    '/api/staff/:id/face',
    {
      preHandler: requirePermission('staff.biometrics', 'create'),
      // Comfortably above the terminal's 200 KB ceiling, so an oversized upload is
      // rejected with a message naming the real limit instead of a bare 413.
      bodyLimit: 2 * 1024 * 1024,
    },
    async (request) => {
      if (!request.user) throw unauthorized();

      const id = idParam(request.params);
      const staff = await db().staff.findUnique({ where: { id } });
      if (!staff) throw notFound('Staf tidak dijumpai');

      const body = request.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw conflict('Badan permintaan mesti mengandungi bait JPEG');
      }

      const results = await enrolFace(staff, body);

      await db().auditLog.create({
        data: {
          accountId: request.user.accountId,
          actorLabel: request.user.fullName,
          action: 'update',
          entityType: 'Staff',
          entityId: String(id),
          changes: { face: { before: null, after: 'didaftar' } },
        },
      });

      return jsonSafe({ results });
    },
  );

  app.delete(
    '/api/staff/:id/face',
    { preHandler: requirePermission('staff.biometrics', 'delete') },
    async (request) => {
      const id = idParam(request.params);
      const staff = await db().staff.findUnique({ where: { id } });
      if (!staff) throw notFound('Staf tidak dijumpai');
      return jsonSafe({ results: await removeFace(staff) });
    },
  );

  /** Returns the enrolled face, read back from a terminal. */
  app.get(
    '/api/staff/:id/face',
    { preHandler: requirePermission('staff.biometrics', 'view') },
    async (request, reply) => {
      const image = await readEnrolledFace(idParam(request.params));
      if (!image) throw notFound('Tiada muka didaftar untuk staf ini');

      return reply
        .header('content-type', 'image/jpeg')
        .header('cache-control', 'private, max-age=300')
        .send(image);
    },
  );

  // ---------------------------------------------------------------------------
  // Bulk import
  // ---------------------------------------------------------------------------

  /** Downloadable template, so the expected columns are never guessed at. */
  app.get(
    '/api/staff/import/template',
    { preHandler: requirePermission('staff.import', 'template') },
    async (request, reply) => {
      if (!request.user) throw unauthorized();
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="template-staf.csv"')
        // A BOM so Excel opens the file as UTF-8 and does not mangle Malay names.
        .send(
          `\uFEFF${importTemplate({
            maySetSalary: can(request.user, 'staff.directory', 'salary'),
          })}\n`,
        );
    },
  );

  /**
   * Validates an upload and reports what would happen, writing nothing.
   *
   * Separate from the commit on purpose: with thousands of rows, a bad column
   * discovered halfway through leaves the directory partly populated.
   */
  app.post(
    '/api/staff/import/preview',
    {
      preHandler: requirePermission('staff.import', 'create'),
      // Roughly 5000 rows of the widest realistic line.
      bodyLimit: 8 * 1024 * 1024,
    },
    async (request) => {
      if (!request.user) throw unauthorized();
      const csv = typeof request.body === 'string' ? request.body : String(request.body ?? '');
      if (csv.trim().length === 0) throw conflict('Fail kosong');
      return jsonSafe(
        await previewImport(csv, {
          maySetSalary: can(request.user, 'staff.directory', 'salary'),
        }),
      );
    },
  );

  /** Starts the import in the background and returns a job to poll. */
  app.post(
    '/api/staff/import/commit',
    { preHandler: requirePermission('staff.import', 'create'), bodyLimit: 8 * 1024 * 1024 },
    async (request) => {
      if (!request.user) throw unauthorized();

      const body = parseBody(
        z.object({
          csv: z.string().min(1),
          deviceIds: z.array(z.number().int().positive()).default([]),
          /** Rows already in the directory are skipped, never overwritten. */
          skipExisting: z.boolean().default(true),
        }),
        request.body,
      );

      const preview = await previewImport(body.csv, {
        maySetSalary: can(request.user, 'staff.directory', 'salary'),
      });
      if (preview.problems.length > 0) {
        throw conflict(
          `Fail masih mempunyai ${preview.problems.length} ralat. Betulkan dahulu sebelum import.`,
        );
      }

      const rows = body.skipExisting
        ? preview.valid.filter((row) => !preview.existing.includes(row.employeeNo))
        : preview.valid;

      const job = startImport(rows, body.deviceIds);

      await recordActivity({
        request,
        action: 'staff.import',
        category: 'staff',
        detail: `${rows.length} baris, ${body.deviceIds.length} terminal`,
      });

      return jsonSafe(job);
    },
  );

  app.get(
    '/api/staff/import/status/:jobId',
    { preHandler: requirePermission('staff.import', 'view') },
    async (request) => {
      const params = z.object({ jobId: z.string().min(1) }).parse(request.params);
      const job = getImportJob(params.jobId);
      if (!job) throw notFound('Job import tidak dijumpai atau sudah luput');
      return jsonSafe(job);
    },
  );

  /** Retries a push that previously failed. */
  app.post(
    '/api/staff/:id/resync',
    { preHandler: requirePermission('staff.directory', 'resync') },
    async (request) => {
      const id = idParam(request.params);
      const staff = await db().staff.findUnique({ where: { id } });
      if (!staff) throw notFound('Staf tidak dijumpai');

      const enrolments = await db().deviceEnrolment.findMany({
        where: { staffId: id },
        select: { deviceId: true },
      });

      return jsonSafe({
        sync: await pushStaffToDevices(
          staff,
          enrolments.map((row) => row.deviceId),
        ),
      });
    },
  );
}

/**
 * Records what changed, from what, to what.
 *
 * Only the fields that actually moved are stored. A full before-and-after snapshot
 * buries the one field somebody is asking about, which defeats the purpose of the
 * trail.
 */
async function writeAudit(
  user: { accountId: number; fullName: string },
  action: 'create' | 'update' | 'delete',
  staffId: number,
  changes: Record<string, { before: unknown; after: unknown }>,
): Promise<void> {
  await db().auditLog.create({
    data: {
      accountId: user.accountId,
      actorLabel: user.fullName,
      action,
      entityType: 'Staff',
      entityId: String(staffId),
      // Serialised through JSON so Date and other non-primitive values satisfy
      // Prisma's Json input type.
      changes: JSON.parse(JSON.stringify(changes)) as object,
    },
  });
}

/**
 * Refuses a wage from a caller who only holds `edit`.
 *
 * Named rather than stripped. A silently discarded field would leave somebody who
 * typed a salary, saved, and saw the form close believing the figure was recorded —
 * and the next overtime claim priced from a wage that was never stored.
 */
function assertMaySetSalary(
  user: AuthenticatedUser,
  basicSalary: number | null | undefined,
): void {
  if (basicSalary === undefined) return;
  if (can(user, 'staff.directory', 'salary')) return;
  throw forbidden(
    'Gaji bulanan memerlukan kebenaran "Gaji Bulanan" pada Direktori Staf, berasingan ' +
      'daripada Ubah.',
  );
}

function idParam(params: unknown): number {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
  if (!parsed.success) throw notFound('Staf tidak dijumpai');
  return parsed.data.id;
}

/**
 * Inclusive upper bound for a date-only filter against a timestamp column.
 *
 * `punchAt` and `eventTime` are instants, so a bare `lte: 2026-09-30` would cut the day off
 * at midnight and lose everything after it.
 */
function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}
