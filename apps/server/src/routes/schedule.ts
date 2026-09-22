import type { LabelKey } from '@attendance/shared';
import { normaliseStateCode, parseStateCodes } from '@attendance/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requirePermission } from '../auth/plugin.js';
import { db, jsonSafe } from '../db.js';
import { conflict, forUpdate, notFound, parseBody } from '../http.js';
import { loadEnv } from '../env.js';
import { recordActivity } from '../logging/activity.js';
import { gazettedHolidays } from '../schedule/gazette.js';
import { asDateOnly } from '../time.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const timeBlockSchema = z.object({
  blockOrder: z.coerce.number().int().min(1).max(6),
  startTime: z.string().regex(HHMM, 'Format mesti HH:mm'),
  endTime: z.string().regex(HHMM, 'Format mesti HH:mm'),
  /**
   * True when the block finishes on the following calendar day.
   *
   * Without this a night shift reads as a negative duration. The engine also
   * infers it when the end is not after the start, but storing it explicitly keeps
   * the intent visible in the UI.
   */
  endsNextDay: z.boolean().default(false),
  breakMinutes: z.coerce.number().int().min(0).max(480).default(0),
  /** Window before the start within which a scan still counts for this block. */
  graceBeforeMinutes: z.coerce.number().int().min(0).max(720).default(30),
  graceAfterMinutes: z.coerce.number().int().min(0).max(720).default(30),
});

const workPatternSchema = z.object({
  name: z.string().trim().min(1, 'Nama diperlukan').max(120),
  description: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
  kind: z.enum(['regular', 'shift', 'standby']).default('regular'),
  active: z.boolean().default(true),
  timeBlocks: z.array(timeBlockSchema).min(1, 'Sekurang-kurangnya satu blok masa diperlukan'),
});

const shiftSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  colour: z.union([z.literal(''), z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Warna mesti #RRGGBB')]).optional(),
  workPatternId: z.coerce.number().int().positive(),
  active: z.boolean().default(true),
});

export async function scheduleRoutes(app: FastifyInstance): Promise<void> {
  const env = loadEnv();

  // -------------------------------------------------------------------------
  // Work patterns
  // -------------------------------------------------------------------------

  app.get('/api/work-patterns', { preHandler: requirePermission('schedule.workPatterns', 'view') }, async () => {
    const rows = await db().workPattern.findMany({
      orderBy: { name: 'asc' },
      include: {
        timeBlocks: { orderBy: { blockOrder: 'asc' } },
        _count: { select: { staff: true, shifts: true } },
      },
    });

    return jsonSafe(
      rows.map(({ _count, ...row }) => ({
        ...row,
        staffCount: _count.staff,
        shiftCount: _count.shifts,
        /** Scheduled minutes per day, break excluded. */
        dailyMinutes: row.timeBlocks.reduce(
          (total, block) => total + blockMinutes(block) - block.breakMinutes,
          0,
        ),
      })),
    );
  });

  app.post(
    '/api/work-patterns',
    { preHandler: requirePermission('schedule.workPatterns', 'create') },
    async (request) => {
      const body = parseBody(workPatternSchema, request.body);
      assertBlocksDoNotOverlap(body.timeBlocks);

      const row = await db().workPattern.create({
        data: {
          name: body.name,
          description: body.description && body.description.length > 0 ? body.description : null,
          kind: body.kind,
          active: body.active,
          timeBlocks: { create: body.timeBlocks },
        },
      });

      return jsonSafe({ id: row.id });
    },
  );

  app.patch(
    '/api/work-patterns/:id',
    { preHandler: requirePermission('schedule.workPatterns', 'edit') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(forUpdate(workPatternSchema), request.body);

      const existing = await db().workPattern.findUnique({ where: { id } });
      if (!existing) throw notFound('Pola kerja tidak dijumpai');

      if (body.timeBlocks !== undefined) {
        assertBlocksDoNotOverlap(body.timeBlocks);
      }

      await db().workPattern.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined
            ? { description: body.description.length > 0 ? body.description : null }
            : {}),
          ...(body.kind !== undefined ? { kind: body.kind } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
          // Blocks are replaced wholesale rather than merged. Merging leaves
          // orphaned rows behind when a pattern loses a block, which then show up
          // as phantom worked hours in reports.
          ...(body.timeBlocks !== undefined
            ? { timeBlocks: { deleteMany: {}, create: body.timeBlocks } }
            : {}),
        },
      });

      return jsonSafe({
        id,
        noteKey:
          body.timeBlocks !== undefined
            ? ('shifts.pattern.blocksChanged' satisfies LabelKey)
            : undefined,
      });
    },
  );

  app.delete(
    '/api/work-patterns/:id',
    { preHandler: requirePermission('schedule.workPatterns', 'delete') },
    async (request) => {
      const id = idParam(request.params);

      const [staffCount, shiftCount] = await Promise.all([
        db().staff.count({ where: { workPatternId: id } }),
        db().shift.count({ where: { workPatternId: id } }),
      ]);

      if (staffCount > 0) throw conflict(`${staffCount} staf masih menggunakan pola ini.`);
      if (shiftCount > 0) throw conflict(`${shiftCount} shift masih merujuk pola ini.`);

      await db().workPattern.delete({ where: { id } });
      return { ok: true };
    },
  );

  // -------------------------------------------------------------------------
  // Shifts
  // -------------------------------------------------------------------------

  app.get('/api/shifts', { preHandler: requirePermission('schedule.shifts', 'view') }, async () => {
    const rows = await db().shift.findMany({
      orderBy: { code: 'asc' },
      include: {
        workPattern: {
          select: {
            id: true,
            name: true,
            timeBlocks: { orderBy: { blockOrder: 'asc' } },
          },
        },
        _count: { select: { rosters: true } },
      },
    });

    return jsonSafe(
      rows.map(({ _count, ...row }) => ({ ...row, rosterCount: _count.rosters })),
    );
  });

  app.post('/api/shifts', { preHandler: requirePermission('schedule.shifts', 'create') }, async (request) => {
    const body = parseBody(shiftSchema, request.body);

    const clash = await db().shift.findUnique({ where: { code: body.code } });
    if (clash) throw conflict(`Kod shift "${body.code}" sudah digunakan`);

    const row = await db().shift.create({
      data: {
        code: body.code,
        name: body.name,
        colour: body.colour && body.colour.length > 0 ? body.colour : null,
        workPatternId: body.workPatternId,
        active: body.active,
      },
    });

    return jsonSafe({ id: row.id });
  });

  app.patch(
    '/api/shifts/:id',
    { preHandler: requirePermission('schedule.shifts', 'edit') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(forUpdate(shiftSchema), request.body);

      const existing = await db().shift.findUnique({ where: { id } });
      if (!existing) throw notFound('Shift tidak dijumpai');

      await db().shift.update({
        where: { id },
        data: {
          ...(body.code !== undefined ? { code: body.code } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.colour !== undefined ? { colour: body.colour.length > 0 ? body.colour : null } : {}),
          ...(body.workPatternId !== undefined ? { workPatternId: body.workPatternId } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        },
      });

      return jsonSafe({ id });
    },
  );

  app.delete(
    '/api/shifts/:id',
    { preHandler: requirePermission('schedule.shifts', 'delete') },
    async (request) => {
      const id = idParam(request.params);
      const rosterCount = await db().rosterEntry.count({ where: { shiftId: id } });

      // Roster entries carry historical assignments, and attendance records point
      // at the shift they were computed against.
      if (rosterCount > 0) {
        throw conflict(
          `${rosterCount} catatan jadual masih menggunakan shift ini. Nyahaktifkan shift ini ` +
            'daripada membuangnya, supaya sejarah kekal boleh ditafsir.',
        );
      }

      await db().shift.delete({ where: { id } });
      return { ok: true };
    },
  );

  // -------------------------------------------------------------------------
  // Roster
  // -------------------------------------------------------------------------

  /** One month of roster for a set of staff, shaped for a calendar grid. */
  app.get('/api/roster', { preHandler: requirePermission('schedule.roster', 'view') }, async (request) => {
    const query = z
      .object({
        from: z.coerce.date(),
        to: z.coerce.date(),
        departmentId: z.coerce.number().int().positive().optional(),
        /**
         * One person, for the staff detail screen.
         *
         * `search` cannot stand in for this: it matches with `contains`, so asking for
         * "100" also returns 1001 and 1002. A screen showing one person's roster has to be
         * able to name that person exactly.
         */
        staffId: z.coerce.number().int().positive().optional(),
        search: z.string().trim().max(128).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      })
      .parse(request.query);

    // Calendar dates: `workDate` is a `@db.Date`, and the grid keys its cells off
    // the `YYYY-MM-DD` these serialise to.
    const from = asDateOnly(query.from);
    const to = asDateOnly(query.to);

    /**
     * Asking for one person drops the `active` filter.
     *
     * The calendar lists who is on shift, so it shows active staff. But somebody opening a
     * deactivated person's record is asking what that person was rostered for — and
     * answering with an empty month would read as "never rostered" rather than as
     * "no longer employed".
     */
    const where =
      query.staffId === undefined
        ? {
            active: true,
            ...(query.departmentId ? { departmentId: query.departmentId } : {}),
            ...(query.search
              ? {
                  OR: [
                    { fullName: { contains: query.search } },
                    { employeeNo: { contains: query.search } },
                  ],
                }
              : {}),
          }
        : { id: query.staffId };

    const [total, staff] = await Promise.all([
      db().staff.count({ where }),
      db().staff.findMany({
        where,
        orderBy: { employeeNo: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          employeeNo: true,
          fullName: true,
          workPattern: { select: { id: true, name: true } },
          rosters: {
            where: { workDate: { gte: from, lte: to } },
            select: { workDate: true, shiftId: true, entryType: true, notes: true },
          },
        },
      }),
    ]);

    return jsonSafe({ total, page: query.page, pageSize: query.pageSize, from, to, rows: staff });
  });

  /**
   * Assigns roster entries in bulk.
   *
   * Upserted per staff and date, because a roster is edited repeatedly as a month
   * takes shape rather than written once.
   */
  app.post('/api/roster', { preHandler: requirePermission('schedule.roster', 'edit') }, async (request) => {
    const body = parseBody(
      z.object({
        staffIds: z.array(z.number().int().positive()).min(1),
        dates: z.array(z.coerce.date()).min(1).max(62),
        shiftId: z.number().int().positive().nullable(),
        entryType: z.enum(['work', 'rest', 'leave']).default('work'),
        notes: z.union([z.literal(''), z.string().trim().max(255)]).optional(),
      }),
      request.body,
    );

    // A working day without a shift has nothing to measure attendance against.
    if (body.entryType === 'work' && body.shiftId === null) {
      throw conflict('Hari kerja memerlukan shift. Pilih shift atau tukar jenis ke rehat/cuti.');
    }

    let written = 0;

    for (const staffId of body.staffIds) {
      for (const date of body.dates) {
        const workDate = asDateOnly(date);
        await db().rosterEntry.upsert({
          where: { staffId_workDate: { staffId, workDate } },
          create: {
            staffId,
            workDate,
            shiftId: body.shiftId,
            entryType: body.entryType,
            notes: body.notes && body.notes.length > 0 ? body.notes : null,
          },
          update: {
            shiftId: body.shiftId,
            entryType: body.entryType,
            notes: body.notes && body.notes.length > 0 ? body.notes : null,
          },
        });
        written += 1;
      }
    }

    return jsonSafe({ written });
  });

  app.delete(
    '/api/roster',
    { preHandler: requirePermission('schedule.roster', 'delete') },
    async (request) => {
      const body = parseBody(
        z.object({
          staffIds: z.array(z.number().int().positive()).min(1),
          dates: z.array(z.coerce.date()).min(1).max(62),
        }),
        request.body,
      );

      const removed = await db().rosterEntry.deleteMany({
        where: {
          staffId: { in: body.staffIds },
          workDate: { in: body.dates.map(asDateOnly) },
        },
      });

      return jsonSafe({ removed: removed.count });
    },
  );

  // -------------------------------------------------------------------------
  // Holidays
  // -------------------------------------------------------------------------

  app.get('/api/holidays', { preHandler: requirePermission('schedule.holidays', 'view') }, async (request) => {
    const query = z
      .object({
        year: z.coerce.number().int().min(2000).max(2100).optional(),
        /**
         * `offices` shows the national days plus the states this organisation operates in.
         * `all` shows every row.
         *
         * Defaulting to `offices` because a list that includes days belonging to states with no
         * office here — left over from an earlier sync, or from a wider selection since narrowed —
         * puts rows in front of somebody that apply to nobody, with nothing on the row saying so.
         * `hidden` reports how many were held back, so the list never looks short without reason.
         */
        mode: z.enum(['offices', 'all']).default('offices'),
      })
      .parse(request.query);

    const year = query.year ?? new Date().getFullYear();
    const rows = await db().holiday.findMany({
      where: {
        date: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lte: new Date(Date.UTC(year, 11, 31)),
        },
      },
      orderBy: { date: 'asc' },
    });

    const offices = parseStateCodes(
      (await db().setting.findUnique({ where: { key: 'integration.holidays.includeStates' } }))
        ?.value ?? [],
    );

    /*
     * `stateCode: null` means the organisation declared the day for every office, so it is always
     * shown. A company-declared day is shown for the same reason whatever state it names: somebody
     * here created it deliberately.
     */
    const visible =
      query.mode === 'all' || offices.length === 0
        ? rows
        : rows.filter((row) => {
            if (row.stateCode === null || row.companyDeclared) return true;
            const code = normaliseStateCode(row.stateCode);
            return code !== null && offices.includes(code);
          });

    /**
     * Grouped by date, because the table reads one line per day and not one per state.
     *
     * The gazette writes a row per observing state, which is what makes the office filter and the
     * yearly replace work. Ungrouped, a day observed in four states would be four identical-looking
     * lines — the screen would read as duplicated data rather than as one holiday.
     *
     * `states` carries the codes so the screen can decide what to call it: every office state
     * present means "all offices", and that is computed here from the saved list rather than stored
     * on the row, because it stops being true the moment the office list changes.
     */
    const byDate = new Map<
      string,
      { id: number; name: string; date: Date; states: string[]; companyDeclared: boolean }
    >();

    for (const row of visible) {
      const key = row.date.toISOString().slice(0, 10);
      const found = byDate.get(key);
      const code = row.stateCode === null ? null : normaliseStateCode(row.stateCode);

      if (found) {
        if (code !== null && !found.states.includes(code)) found.states.push(code);
        // A company-declared day anywhere on this date marks the whole line as the organisation's.
        if (row.companyDeclared) found.companyDeclared = true;
        continue;
      }

      byDate.set(key, {
        id: row.id,
        name: row.name,
        date: row.date,
        states: code === null ? [] : [code],
        companyDeclared: row.companyDeclared,
      });
    }

    const grouped = [...byDate.values()].map((entry) => ({
      ...entry,
      /** True when every office state observes it, so the screen need not list sixteen names. */
      allOffices:
        entry.states.length === 0 ||
        (offices.length > 0 && offices.every((code) => entry.states.includes(code))),
    }));

    return jsonSafe({
      year,
      mode: query.mode,
      offices,
      rows: grouped,
      /** Days held back entirely, counted after grouping so it matches what the screen shows. */
      hidden: new Set(rows.map((row) => row.date.toISOString().slice(0, 10))).size - grouped.length,
    });
  });

  /**
   * Pulls the gazetted list for one year from `date-holidays`.
   *
   * National days plus every state in the saved office list, in one pass. An earlier design sent a
   * state only when exactly one was selected, which meant selecting two quietly fetched the
   * national list alone.
   *
   * ## Why the saved list and not the request
   *
   * The states come from the stored setting, never from the body. Syncing against ticks that have
   * not been saved is how a database ends up holding holidays for states the settings screen does
   * not list — the run looks successful and the filter above then hides what it wrote.
   *
   * ## What it will not touch
   *
   * `companyDeclared` rows are never deleted or overwritten. They are the organisation's own
   * shutdown days; a sync that removed them would silently delete something no external source can
   * put back.
   */
  app.post('/api/holidays/sync', { preHandler: requirePermission('schedule.holidays', 'create') }, async (request) => {
    const body = parseBody(
      z.object({ year: z.coerce.number().int().min(2000).max(2100) }),
      request.body ?? {},
    );

    const offices = parseStateCodes(
      (await db().setting.findUnique({ where: { key: 'integration.holidays.includeStates' } }))
        ?.value ?? [],
    );
    if (offices.length === 0) {
      throw conflict(
        'Tiada negeri dipilih. Tandakan negeri tempat organisasi ini beroperasi dan simpan dahulu — ' +
          'sync menyimpan cuti terhadap senarai yang disimpan, bukan tanda pada skrin.',
      );
    }

    const found = gazettedHolidays(body.year, offices);

    const yearStart = new Date(Date.UTC(body.year, 0, 1));
    const yearEnd = new Date(Date.UTC(body.year, 11, 31));

    /**
     * Replaces the gazetted set for the year, rather than adding to it.
     *
     * An earlier version only upserted. Removing a state from the office list then left its holidays
     * in the table for ever — switching from Sarawak to Melaka kept Gawai Dayak and Hari Kemerdekaan
     * Sarawak as live holidays, and the leave engine went on excluding them from working days. A
     * sync that can only add is a sync whose result depends on every selection ever made.
     *
     * In one transaction, so the table is never momentarily empty. The leave engine reads it live;
     * a request priced during a gap would charge working days for a public holiday.
     *
     * `companyDeclared` rows are excluded from the delete. They are the organisation's own shutdown
     * days and no external source can put them back.
     */
    const written = await db().$transaction(async (tx) => {
      await tx.holiday.deleteMany({
        where: { date: { gte: yearStart, lte: yearEnd }, companyDeclared: false },
      });

      const created = await tx.holiday.createMany({
        data: found.map((holiday) => ({
          name: holiday.name,
          date: holiday.date,
          stateCode: holiday.stateCode,
          companyDeclared: false,
        })),
        /*
         * A company-declared day may already hold this `(date, stateCode)`. It survived the delete
         * above, so the insert would collide — skipped rather than failing the run, because the
         * operator's own entry outranks the gazette's.
         */
        skipDuplicates: true,
      });

      return created.count;
    });

    const syncedAt = new Date().toISOString();
    await db().setting.upsert({
      where: { key: 'integration.holidays.lastSync' },
      create: { key: 'integration.holidays.lastSync', value: syncedAt },
      update: { value: syncedAt },
    });

    await recordActivity({
      request,
      action: 'holiday.sync',
      category: 'schedule',
      detail: `${String(body.year)}: ${String(written)} hari, negeri ${offices.join(', ')}`,
    });

    return jsonSafe({ year: body.year, written, offices, lastSync: syncedAt });
  });

  app.post('/api/holidays', { preHandler: requirePermission('schedule.holidays', 'create') }, async (request) => {
    const body = parseBody(
      z.object({
        name: z.string().trim().min(1).max(120),
        date: z.coerce.date(),
        /** Null for nationwide; otherwise a state code. */
        stateCode: z.union([z.literal(''), z.string().trim().max(8)]).optional(),
        /** True for company-declared days, which no public API will return. */
        companyDeclared: z.boolean().default(false),
      }),
      request.body,
    );

    const date = asDateOnly(body.date);
    const stateCode = body.stateCode && body.stateCode.length > 0 ? body.stateCode : null;

    const clash = await db().holiday.findFirst({ where: { date, stateCode } });
    if (clash) throw conflict(`Cuti pada tarikh ini sudah ada: ${clash.name}`);

    const row = await db().holiday.create({
      data: { name: body.name, date, stateCode, companyDeclared: body.companyDeclared },
    });

    return jsonSafe({ id: row.id });
  });

  app.delete(
    '/api/holidays/:id',
    { preHandler: requirePermission('schedule.holidays', 'delete') },
    async (request) => {
      await db().holiday.delete({ where: { id: idParam(request.params) } });
      return { ok: true };
    },
  );
}

/** Scheduled length of a block, accounting for a midnight crossing. */
function blockMinutes(block: { startTime: string; endTime: string; endsNextDay: boolean }): number {
  const start = toMinutes(block.startTime);
  let end = toMinutes(block.endTime);
  if (block.endsNextDay || end <= start) end += 24 * 60;
  return end - start;
}

function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/**
 * Rejects blocks whose grace windows overlap.
 *
 * Overlapping windows make block assignment ambiguous: one scan would qualify for
 * two blocks, and which one wins would depend on iteration order rather than on
 * anything an operator could reason about.
 */
function assertBlocksDoNotOverlap(
  blocks: Array<z.infer<typeof timeBlockSchema>>,
): void {
  const windows = [...blocks]
    .sort((a, b) => a.blockOrder - b.blockOrder)
    .map((block) => {
      const start = toMinutes(block.startTime) - block.graceBeforeMinutes;
      const end = start + block.graceBeforeMinutes + blockMinutes(block) + block.graceAfterMinutes;
      return { order: block.blockOrder, start, end };
    });

  for (let index = 1; index < windows.length; index += 1) {
    const previous = windows[index - 1]!;
    const current = windows[index]!;
    if (current.start < previous.end) {
      throw conflict(
        `Blok ${previous.order} dan ${current.order} bertindih setelah mengambil kira tetingkap ` +
          'toleransi. Kurangkan toleransi atau jarakkan waktu blok.',
      );
    }
  }
}

function idParam(params: unknown): number {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
  if (!parsed.success) throw notFound('Rekod tidak dijumpai');
  return parsed.data.id;
}
