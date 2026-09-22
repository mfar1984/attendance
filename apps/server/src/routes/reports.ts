import { LABELS, type LabelKey } from '@attendance/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requirePermission } from '../auth/plugin.js';
import { db, jsonSafe } from '../db.js';
import { loadEnv } from '../env.js';
import { conflict, parseBody } from '../http.js';
import { recordActivity } from '../logging/activity.js';
import type { Period, StaffSummary } from '../reports/aggregate.js';
import { hours, sendCsv, toCsvRow } from '../reports/csv.js';
import {
  approvedOvertime,
  countPendingOvertime,
  emptySummary,
  parsePeriod,
  staffFilter,
  summarise,
} from '../reports/aggregate.js';
import { dateOnlyKey, zonedDateKey } from '../time.js';

/**
 * Reporting and payroll export.
 *
 * These are the figures that turn into money, so the design principle throughout is
 * that a number is never presented without what qualifies it. An export carrying an
 * unresolved missing-checkout is a short day somebody will be paid for; the count of
 * those travels with the report rather than being left for the reader to discover.
 *
 * Every figure is derived from `AttendanceRecord`, which is itself derived from the
 * immutable raw log. Nothing here writes.
 */
export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  const timeZone = loadEnv().ORG_TIMEZONE;

  const periodQuery = z.object({
    from: z.string().trim().min(10).max(10),
    to: z.string().trim().min(10).max(10),
    departmentId: z.coerce.number().int().positive().optional(),
    locationId: z.coerce.number().int().positive().optional(),
    search: z.string().trim().max(128).optional(),
  });

  // -------------------------------------------------------------------------
  // Monthly summary
  // -------------------------------------------------------------------------

  app.get('/api/reports/monthly', { preHandler: requirePermission('reports.monthly', 'view') }, async (request) => {
    const query = periodQuery
      .extend({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(30),
      })
      .parse(request.query);

    const period = parsePeriod(query.from, query.to, timeZone);
    const staffWhere = staffFilter(query);

    const [total, staff] = await Promise.all([
      db().staff.count({ where: staffWhere }),
      db().staff.findMany({
        where: staffWhere,
        orderBy: [{ employeeNo: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          employeeNo: true,
          fullName: true,
          department: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
        },
      }),
    ]);

    const rows = await summarise(
      staff.map((row) => row.id),
      period,
    );
    const byStaff = new Map(rows.map((row) => [row.staffId, row]));

    const [organisation, byDepartment, unresolved] = await Promise.all([
      organisationTotals(staffWhere, period),
      departmentTotals(staffWhere, period),
      countUnresolved(staffWhere, period),
    ]);

    return jsonSafe({
      period: { from: period.fromKey, to: period.toKey, workingDays: period.dayCount },
      total,
      page: query.page,
      pageSize: query.pageSize,
      rows: staff.map((person) => ({
        staff: person,
        ...(byStaff.get(person.id) ?? emptySummary(person.id)),
      })),
      organisation,
      byDepartment,
      /** Records inside the period that a human still has to settle. */
      unresolvedExceptions: unresolved,
      timeZone,
      generatedAt: new Date().toISOString(),
    });
  });

  // -------------------------------------------------------------------------
  // Payroll export
  // -------------------------------------------------------------------------

  /**
   * What the export would contain, and what is wrong with it.
   *
   * Read separately from the download so the blockers are visible before the file
   * reaches a payroll clerk's inbox. Once it is a spreadsheet, nobody rechecks it.
   */
  app.get('/api/reports/payroll/preview', { preHandler: requirePermission('reports.payroll', 'view') }, async (request) => {
    const query = periodQuery.parse(request.query);
    const period = parsePeriod(query.from, query.to, timeZone);
    const staffWhere = staffFilter(query);

    const [staffCount, organisation, unresolved, noRecords, drifting] = await Promise.all([
      db().staff.count({ where: staffWhere }),
      organisationTotals(staffWhere, period),
      countUnresolved(staffWhere, period),
      countStaffWithoutRecords(staffWhere, period),
      countDriftingDays(period),
    ]);

    const blockers: Array<{ kind: string; count: number; detail: string }> = [];

    if (unresolved.total > 0) {
      blockers.push({
        kind: 'unresolved_exceptions',
        count: unresolved.total,
        detail:
          'Setiap satu adalah hari yang enjin tidak dapat selesaikan. Yang paling kerap ialah ' +
          'tiada scan keluar, yang menjadikan hari itu pendek — dan gaji pendek.',
      });
    }
    if (noRecords > 0) {
      blockers.push({
        kind: 'staff_without_records',
        count: noRecords,
        detail:
          'Staf aktif tanpa satu pun rekod dalam tempoh ini. Biasanya bermakna mereka tidak ' +
          'boleh scan sama sekali, bukan bahawa mereka tidak bekerja.',
      });
    }
    if (drifting > 0) {
      blockers.push({
        kind: 'clock_drift',
        count: drifting,
        detail:
          'Scan yang direkod ketika jam terminal tersasar melebihi ambang. Cap masanya mewarisi ' +
          'kesilapan itu, dan membetulkan jam kemudian tidak membetulkan rekod ini.',
      });
    }

    /*
     * Undecided overtime is money the file will not contain.
     *
     * Stated rather than blocked, like every other entry here — but it belongs on the list,
     * because this is the one the person who filed the claim will notice on payday and
     * nobody reading the spreadsheet would.
     */
    const staffIds = (
      await db().staff.findMany({ where: staffWhere, select: { id: true } })
    ).map((row) => row.id);
    const pendingOvertime = await countPendingOvertime(staffIds, period);

    if (pendingOvertime.count > 0) {
      blockers.push({
        kind: 'pending_overtime',
        count: pendingOvertime.count,
        detail:
          `${hours(pendingOvertime.minutes)} jam lebih masa dalam tempoh ini masih menunggu ` +
          'keputusan. Export hanya membawa yang diluluskan, jadi jam itu tidak akan dibayar ' +
          'sampai seseorang memutuskannya.',
      });
    }

    return jsonSafe({
      period: { from: period.fromKey, to: period.toKey, workingDays: period.dayCount },
      staffCount,
      organisation,
      unresolvedExceptions: unresolved,
      blockers,
      /** Never a hard block — payroll has a deadline. Stated, not enforced. */
      safeToExport: blockers.length === 0,
      timeZone,
      generatedAt: new Date().toISOString(),
    });
  });

  app.get('/api/reports/payroll/export', { preHandler: requirePermission('reports.payroll', 'export') }, async (request, reply) => {
    const query = periodQuery
      .extend({ format: z.enum(['csv', 'detail']).default('csv') })
      .parse(request.query);

    const period = parsePeriod(query.from, query.to, timeZone);
    const staffWhere = staffFilter(query);

    const staff = await db().staff.findMany({
      where: staffWhere,
      orderBy: [{ employeeNo: 'asc' }],
      select: {
        id: true,
        employeeNo: true,
        fullName: true,
        icNo: true,
        department: { select: { name: true } },
        location: { select: { name: true } },
      },
    });

    const summaries = await summarise(
      staff.map((row) => row.id),
      period,
    );
    const byStaff = new Map(summaries.map((row) => [row.staffId, row]));
    const unresolved = await countUnresolved(staffWhere, period);

    const headers = [
      'No. Staf',
      'Nama',
      'No. KP',
      'Jabatan',
      'Lokasi',
      'Hari dijadualkan',
      'Hari hadir',
      'Hari lewat',
      'Hari tidak hadir',
      'Hari bercuti',
      'Hari rehat',
      'Hari cuti umum',
      'Hari tidak lengkap',
      'Jam bekerja',
      'Minit lewat',
      'Minit keluar awal',
      'Jam kerja lebih masa',
      /*
       * Two more columns, not a replacement for the one above.
       *
       * "Jam kerja lebih masa" is what the engine measured. These two are what somebody
       * approved and what it costs. A payroll clerk needs both: the gap between them is
       * overtime that was worked and never signed for.
       */
      'Jam lebih masa diluluskan',
      'Amaun lebih masa (RM)',
      'Pengecualian belum selesai',
    ];

    const approved = await approvedOvertime(
      staff.map((person) => person.id),
      period,
    );

    const body = staff.map((person) => {
      const summary = byStaff.get(person.id) ?? emptySummary(person.id);
      const claim = approved.get(person.id) ?? { minutes: 0, amount: 0 };
      return [
        person.employeeNo,
        person.fullName,
        person.icNo ?? '',
        person.department?.name ?? '',
        person.location?.name ?? '',
        String(summary.scheduledDays),
        String(summary.presentDays),
        String(summary.lateDays),
        String(summary.absentDays),
        String(summary.leaveDays),
        String(summary.restDays),
        String(summary.holidayDays),
        String(summary.incompleteDays),
        hours(summary.workedMinutes),
        String(summary.lateMinutes),
        String(summary.earlyLeaveMinutes),
        hours(summary.overtimeMinutes),
        hours(claim.minutes),
        claim.amount.toFixed(2),
        String(summary.openExceptions),
      ];
    });

    /**
     * The caveat is inside the file, not only on the screen that produced it.
     *
     * A spreadsheet gets forwarded, and whoever opens it next did not see the
     * warning banner. Written as leading comment rows, which Excel shows as text and
     * which no importer will mistake for data.
     */
    const preamble = [
      `# Export payroll — ${period.fromKey} hingga ${period.toKey}`,
      `# Dijana ${new Date().toISOString()} · zon waktu ${timeZone}`,
      `# ${String(staff.length)} staf · ${String(period.dayCount)} hari kalendar dalam tempoh`,
      unresolved.total > 0
        ? `# AMARAN: ${String(unresolved.total)} pengecualian belum diselesaikan dalam tempoh ini. ` +
          'Jam bekerja bagi hari tersebut mungkin kurang daripada yang sebenar.'
        : '# Tiada pengecualian belum diselesaikan dalam tempoh ini.',
      '#',
    ];

    await recordActivity({
      request,
      action: 'reports.payroll_export',
      category: 'reports',
      // A warning, not routine information: this is the read that becomes money.
      level: unresolved.total > 0 ? 'warn' : 'info',
      detail:
        `${period.fromKey}–${period.toKey} · ${String(staff.length)} staf · ` +
        `${String(unresolved.total)} pengecualian belum selesai`,
    });

    return sendCsv(
      reply,
      `payroll-${period.fromKey}-${period.toKey}`,
      [...preamble, toCsvRow(headers), ...body.map(toCsvRow)].join('\r\n'),
    );
  });

  app.get('/api/reports/monthly/export', { preHandler: requirePermission('reports.monthly', 'export') }, async (request, reply) => {
    const query = periodQuery.parse(request.query);
    const period = parsePeriod(query.from, query.to, timeZone);
    const staffWhere = staffFilter(query);

    const staff = await db().staff.findMany({
      where: staffWhere,
      orderBy: [{ employeeNo: 'asc' }],
      select: {
        id: true,
        employeeNo: true,
        fullName: true,
        department: { select: { name: true } },
      },
    });

    const summaries = await summarise(
      staff.map((row) => row.id),
      period,
    );
    const byStaff = new Map(summaries.map((row) => [row.staffId, row]));

    const headers = [
      'No. Staf',
      'Nama',
      'Jabatan',
      'Hadir',
      'Lewat',
      'Tidak hadir',
      'Bercuti',
      'Tidak lengkap',
      'Jam bekerja',
      'Minit lewat',
      'Jam OT',
    ];

    const body = staff.map((person) => {
      const summary = byStaff.get(person.id) ?? emptySummary(person.id);
      return [
        person.employeeNo,
        person.fullName,
        person.department?.name ?? '',
        String(summary.presentDays),
        String(summary.lateDays),
        String(summary.absentDays),
        String(summary.leaveDays),
        String(summary.incompleteDays),
        hours(summary.workedMinutes),
        String(summary.lateMinutes),
        hours(summary.overtimeMinutes),
      ];
    });

    await recordActivity({
      request,
      action: 'reports.monthly_export',
      category: 'reports',
      detail: `${period.fromKey}–${period.toKey} · ${String(staff.length)} staf`,
    });

    return sendCsv(
      reply,
      `ringkasan-${period.fromKey}-${period.toKey}`,
      [toCsvRow(headers), ...body.map(toCsvRow)].join('\r\n'),
    );
  });

  // -------------------------------------------------------------------------
  // Report builder
  // -------------------------------------------------------------------------

  /**
   * Fields the builder can offer.
   *
   * Served from the server so the picker cannot offer a column the query does not
   * know how to produce. Every entry maps to something already stored; there is no
   * free-form expression language here, deliberately — a report that computes its own
   * arithmetic is a second payroll engine nobody reconciles against the first.
   */
  app.get('/api/reports/fields', { preHandler: requirePermission('reports.builder', 'view') }, async () => ({
    /*
      Registry keys rather than words. These describe the column picker, which is interface
      text, so it goes through the translation registry like every other label — the client
      resolves `labelKey` and stamps its number when label numbers are on.
    */
    datasets: [
      {
        key: 'attendance',
        labelKey: 'records.title',
        noteKey: 'reportDataset.attendance.note',
        fields: [
          { key: 'workDate', labelKey: 'reportField.workDate', kind: 'date' },
          { key: 'employeeNo', labelKey: 'reportField.employeeNo', kind: 'text' },
          { key: 'fullName', labelKey: 'reportField.fullName', kind: 'text' },
          { key: 'department', labelKey: 'reportField.department', kind: 'text' },
          { key: 'location', labelKey: 'reportField.location', kind: 'text' },
          { key: 'shift', labelKey: 'reportField.shift', kind: 'text' },
          { key: 'status', labelKey: 'reportField.status', kind: 'text' },
          { key: 'scheduledStart', labelKey: 'reportField.scheduledStart', kind: 'time' },
          { key: 'scheduledEnd', labelKey: 'reportField.scheduledEnd', kind: 'time' },
          { key: 'checkInAt', labelKey: 'reportField.checkInAt', kind: 'time' },
          { key: 'checkOutAt', labelKey: 'reportField.checkOutAt', kind: 'time' },
          { key: 'lateMinutes', labelKey: 'reportField.lateMinutes', kind: 'number' },
          { key: 'earlyLeaveMinutes', labelKey: 'reportField.earlyLeaveMinutes', kind: 'number' },
          { key: 'workedMinutes', labelKey: 'reportField.workedMinutes', kind: 'number' },
          { key: 'overtimeMinutes', labelKey: 'reportField.overtimeMinutes', kind: 'number' },
        ],
        groupBy: [
          { key: 'none', labelKey: 'reportGroup.none.attendance' },
          { key: 'staff', labelKey: 'reportGroup.staff' },
          { key: 'department', labelKey: 'reportGroup.department' },
          { key: 'status', labelKey: 'reportGroup.status' },
          { key: 'workDate', labelKey: 'reportGroup.workDate' },
        ],
      },
      {
        key: 'exceptions',
        labelKey: 'exceptions.title',
        noteKey: 'reportDataset.exceptions.note',
        fields: [
          { key: 'occurredAt', labelKey: 'reportField.occurredAt', kind: 'datetime' },
          // Named "work date" here rather than plain "date", because this dataset also
          // carries the moment it happened and the two would otherwise be indistinguishable.
          { key: 'workDate', labelKey: 'reportField.workDateOfWork', kind: 'date' },
          { key: 'kind', labelKey: 'reportField.kind', kind: 'text' },
          { key: 'employeeNo', labelKey: 'reportField.employeeNo', kind: 'text' },
          { key: 'fullName', labelKey: 'reportField.fullName', kind: 'text' },
          { key: 'deviceName', labelKey: 'reportField.deviceName', kind: 'text' },
          { key: 'detail', labelKey: 'reportField.detail', kind: 'text' },
          { key: 'resolvedAt', labelKey: 'reportField.resolvedAt', kind: 'datetime' },
          { key: 'resolutionNote', labelKey: 'reportField.resolutionNote', kind: 'text' },
        ],
        groupBy: [
          { key: 'none', labelKey: 'reportGroup.none.exceptions' },
          { key: 'kind', labelKey: 'reportGroup.kind' },
          { key: 'staff', labelKey: 'reportGroup.staff' },
          { key: 'workDate', labelKey: 'reportGroup.workDate' },
        ],
      },
      {
        key: 'leave',
        labelKey: 'leave.title',
        noteKey: 'reportDataset.leave.note',
        fields: [
          { key: 'fromDate', labelKey: 'reportField.fromDate', kind: 'date' },
          { key: 'toDate', labelKey: 'reportField.toDate', kind: 'date' },
          { key: 'employeeNo', labelKey: 'reportField.employeeNo', kind: 'text' },
          { key: 'fullName', labelKey: 'reportField.fullName', kind: 'text' },
          { key: 'department', labelKey: 'reportField.department', kind: 'text' },
          { key: 'leaveType', labelKey: 'reportField.leaveType', kind: 'text' },
          { key: 'days', labelKey: 'reportField.days', kind: 'number' },
          { key: 'status', labelKey: 'reportField.status', kind: 'text' },
          { key: 'reason', labelKey: 'reportField.reason', kind: 'text' },
          { key: 'decisionNote', labelKey: 'reportField.decisionNote', kind: 'text' },
        ],
        groupBy: [
          { key: 'none', labelKey: 'reportGroup.none.leave' },
          { key: 'leaveType', labelKey: 'reportGroup.leaveType' },
          { key: 'staff', labelKey: 'reportGroup.staff' },
          { key: 'status', labelKey: 'reportGroup.status' },
        ],
      },
    ] satisfies Array<{
      key: string;
      labelKey: LabelKey;
      noteKey: LabelKey;
      fields: Array<{ key: string; labelKey: LabelKey; kind: string }>;
      groupBy: Array<{ key: string; labelKey: LabelKey }>;
    }>,
  }));

  const builderSchema = z.object({
    dataset: z.enum(['attendance', 'exceptions', 'leave']),
    from: z.string().trim().min(10).max(10),
    to: z.string().trim().min(10).max(10),
    columns: z.array(z.string().trim().max(32)).min(1).max(20),
    groupBy: z.string().trim().max(20).default('none'),
    departmentId: z.coerce.number().int().positive().optional(),
    status: z.string().trim().max(32).optional(),
    search: z.string().trim().max(128).optional(),
    limit: z.coerce.number().int().min(1).max(5000).default(200),
  });

  app.post('/api/reports/run', { preHandler: requirePermission('reports.builder', 'view') }, async (request) => {
    const body = parseBody(builderSchema, request.body);
    const result = await runBuilder(body, timeZone);
    return jsonSafe({ ...result, generatedAt: new Date().toISOString() });
  });

  app.post('/api/reports/run/export', { preHandler: requirePermission('reports.builder', 'export') }, async (request, reply) => {
    const body = parseBody(builderSchema.extend({ limit: z.coerce.number().int().min(1).max(50_000).default(20_000) }), request.body);
    const result = await runBuilder(body, timeZone);

    await recordActivity({
      request,
      action: 'reports.builder_export',
      category: 'reports',
      detail: `${body.dataset} · ${body.from}–${body.to} · ${String(result.rows.length)} baris`,
    });

    /**
     * Same reasoning as the payroll export: a cap that was hit is stated inside the
     * file. A truncated report read as a complete one is the failure mode here, and the
     * screen that produced it is not attached to the spreadsheet.
     */
    const preamble = [
      `# Laporan ${body.dataset} — ${body.from} hingga ${body.to}`,
      `# Dijana ${new Date().toISOString()} · zon waktu ${timeZone}`,
      body.groupBy === 'none'
        ? `# ${String(result.rows.length)} baris`
        : `# ${String(result.rows.length)} kumpulan · dikumpulkan mengikut ${body.groupBy}`,
      result.truncated
        ? `# AMARAN: had ${String(result.limit)} baris dicapai. Fail ini adalah sebahagian, ` +
          'bukan keseluruhan tempoh. Sempitkan tempoh atau penapis.'
        : '# Tiada had baris dicapai.',
      '#',
    ];

    return sendCsv(
      reply,
      `laporan-${body.dataset}-${body.from}-${body.to}`,
      [
        ...preamble,
        toCsvRow(result.columns.map((column) => column.label)),
        ...result.rows.map((row) => toCsvRow(result.columns.map((column) => row[column.key] ?? ''))),
      ].join('\r\n'),
    );
  });
}

// ---------------------------------------------------------------------------
// Aggregation
//
// The period shape and the per-person figures live in `reports/aggregate.ts`, because the
// payroll module builds payslips from the same numbers. One implementation on purpose: a
// payroll run that counted its own hours would be a second attendance engine.
// ---------------------------------------------------------------------------

async function organisationTotals(
  staffWhere: Record<string, unknown>,
  period: Period,
): Promise<StaffSummary & { staffCount: number }> {
  const staff = await db().staff.findMany({ where: staffWhere, select: { id: true } });
  const summaries = await summarise(
    staff.map((row) => row.id),
    period,
  );

  const total = summaries.reduce<StaffSummary>((running, row) => {
    running.scheduledDays += row.scheduledDays;
    running.presentDays += row.presentDays;
    running.lateDays += row.lateDays;
    running.absentDays += row.absentDays;
    running.leaveDays += row.leaveDays;
    running.restDays += row.restDays;
    running.holidayDays += row.holidayDays;
    running.incompleteDays += row.incompleteDays;
    running.workedMinutes += row.workedMinutes;
    running.lateMinutes += row.lateMinutes;
    running.earlyLeaveMinutes += row.earlyLeaveMinutes;
    running.overtimeMinutes += row.overtimeMinutes;
    running.openExceptions += row.openExceptions;
    return running;
  }, emptySummary(0));

  return { ...total, staffCount: staff.length };
}

async function departmentTotals(
  staffWhere: Record<string, unknown>,
  period: Period,
): Promise<
  Array<{
    departmentId: number | null;
    name: string;
    staffCount: number;
    presentDays: number;
    lateDays: number;
    absentDays: number;
    leaveDays: number;
    incompleteDays: number;
    workedMinutes: number;
    overtimeMinutes: number;
    openExceptions: number;
  }>
> {
  const staff = await db().staff.findMany({
    where: staffWhere,
    select: { id: true, departmentId: true, department: { select: { name: true } } },
  });

  const summaries = await summarise(
    staff.map((row) => row.id),
    period,
  );
  const byStaff = new Map(summaries.map((row) => [row.staffId, row]));

  const groups = new Map<
    string,
    {
      departmentId: number | null;
      name: string;
      staffCount: number;
      presentDays: number;
      lateDays: number;
      absentDays: number;
      leaveDays: number;
      incompleteDays: number;
      workedMinutes: number;
      overtimeMinutes: number;
      openExceptions: number;
    }
  >();

  for (const person of staff) {
    const key = person.departmentId === null ? 'none' : String(person.departmentId);
    const existing = groups.get(key) ?? {
      departmentId: person.departmentId,
      name: person.department?.name ?? 'Tiada jabatan',
      staffCount: 0,
      presentDays: 0,
      lateDays: 0,
      absentDays: 0,
      leaveDays: 0,
      incompleteDays: 0,
      workedMinutes: 0,
      overtimeMinutes: 0,
      openExceptions: 0,
    };

    const summary = byStaff.get(person.id) ?? emptySummary(person.id);
    existing.staffCount += 1;
    existing.presentDays += summary.presentDays;
    existing.lateDays += summary.lateDays;
    existing.absentDays += summary.absentDays;
    existing.leaveDays += summary.leaveDays;
    existing.incompleteDays += summary.incompleteDays;
    existing.workedMinutes += summary.workedMinutes;
    existing.overtimeMinutes += summary.overtimeMinutes;
    existing.openExceptions += summary.openExceptions;

    groups.set(key, existing);
  }

  return [...groups.values()].sort((left, right) => right.absentDays - left.absentDays);
}

async function countUnresolved(
  staffWhere: Record<string, unknown>,
  period: Period,
): Promise<{ total: number; byKind: Record<string, number> }> {
  const staff = await db().staff.findMany({ where: staffWhere, select: { id: true } });
  if (staff.length === 0) return { total: 0, byKind: {} };

  const rows = await db().attendanceException.groupBy({
    by: ['kind'],
    where: {
      staffId: { in: staff.map((row) => row.id) },
      resolvedAt: null,
      workDate: { gte: period.from, lte: period.to },
    },
    _count: { _all: true },
  });

  const byKind: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    byKind[row.kind] = row._count._all;
    total += row._count._all;
  }

  return { total, byKind };
}

/**
 * Active staff with no attendance record at all in the period.
 *
 * Usually means they cannot scan rather than that they did not work, which is why it
 * is a blocker on the export rather than a zero row inside it.
 */
async function countStaffWithoutRecords(
  staffWhere: Record<string, unknown>,
  period: Period,
): Promise<number> {
  const staff = await db().staff.findMany({ where: staffWhere, select: { id: true } });
  if (staff.length === 0) return 0;

  const withRecords = await db().attendanceRecord.groupBy({
    by: ['staffId'],
    where: {
      staffId: { in: staff.map((row) => row.id) },
      workDate: { gte: period.from, lte: period.to },
    },
  });

  return staff.length - withRecords.length;
}

/** Punches whose raw event was recorded while its terminal clock was out. */
async function countDriftingDays(period: Period): Promise<number> {
  const threshold = loadEnv().CLOCK_DRIFT_WARN_SECONDS;

  return db().rawEvent.count({
    where: {
      eventTime: { gte: period.startsAt, lt: period.endsAt },
      OR: [{ deviceDriftS: { gt: threshold } }, { deviceDriftS: { lt: -threshold } }],
    },
  });
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

interface BuilderResult {
  /**
   * Carries both forms.
   *
   * `labelKey` is what the preview table renders, so a column heading is translatable and
   * carries its label number. `label` is the resolved source wording, and it is what the CSV
   * header row uses — the file is written here and has no reader whose language to consult.
   */
  columns: Array<{ key: string; labelKey: LabelKey; label: string }>;
  rows: Array<Record<string, string>>;
  truncated: boolean;
  limit: number;
}

/** Field key to registry key. The wording itself lives in `packages/shared`. */
const FIELD_LABELS: Record<string, LabelKey> = {
  workDate: 'reportField.workDate',
  employeeNo: 'reportField.employeeNo',
  fullName: 'reportField.fullName',
  department: 'reportField.department',
  location: 'reportField.location',
  shift: 'reportField.shift',
  status: 'reportField.status',
  scheduledStart: 'reportField.scheduledStart',
  scheduledEnd: 'reportField.scheduledEnd',
  checkInAt: 'reportField.checkInAt',
  checkOutAt: 'reportField.checkOutAt',
  lateMinutes: 'reportField.lateMinutes',
  earlyLeaveMinutes: 'reportField.earlyLeaveMinutes',
  workedMinutes: 'reportField.workedMinutes',
  overtimeMinutes: 'reportField.overtimeMinutes',
  occurredAt: 'reportField.occurredAt',
  kind: 'reportField.kind',
  deviceName: 'reportField.deviceName',
  detail: 'reportField.detail',
  resolvedAt: 'reportField.resolvedAt',
  resolutionNote: 'reportField.resolutionNote',
  fromDate: 'reportField.fromDate',
  toDate: 'reportField.toDate',
  leaveType: 'reportField.leaveType',
  days: 'reportField.days',
  reason: 'reportField.reason',
  decisionNote: 'reportField.decisionNote',
  count: 'reportField.count',
  group: 'reportField.group',
};

/**
 * One builder column, in both forms.
 *
 * A key with no registry entry falls back to the raw field name, which is still
 * diagnosable — better than an empty heading.
 */
function builderColumn(key: string): { key: string; labelKey: LabelKey; label: string } {
  const labelKey = FIELD_LABELS[key];
  if (labelKey === undefined) return { key, labelKey: 'reportField.group', label: key };
  return { key, labelKey, label: LABELS[labelKey] };
}

/**
 * Runs a builder query.
 *
 * Grouping aggregates in memory over a capped row set rather than in SQL. That is a
 * deliberate limit: the cap is visible in the response, so a truncated report says so
 * instead of quietly reporting a subtotal as a total.
 */
async function runBuilder(
  input: {
    dataset: 'attendance' | 'exceptions' | 'leave';
    from: string;
    to: string;
    columns: string[];
    groupBy: string;
    departmentId?: number;
    status?: string;
    search?: string;
    limit: number;
  },
  timeZone: string,
): Promise<BuilderResult> {
  const period = parsePeriod(input.from, input.to, timeZone);
  const time = (value: Date | null): string =>
    value === null ? '' : value.toISOString().slice(11, 19);
  // `date` reads a calendar column, `stamp` reads a timestamp: the first is already in
  // UTC by definition, the second has to be converted into the organisation's zone.
  const date = (value: Date | null): string => (value === null ? '' : dateOnlyKey(value));
  const stamp = (value: Date | null): string =>
    value === null ? '' : `${zonedDateKey(value, timeZone)} ${value.toISOString().slice(11, 19)}`;

  let flat: Array<Record<string, string>> = [];

  if (input.dataset === 'attendance') {
    const rows = await db().attendanceRecord.findMany({
      where: {
        workDate: { gte: period.from, lte: period.to },
        ...(input.status ? { status: input.status } : {}),
        staff: {
          active: true,
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
          ...(input.search
            ? {
                OR: [
                  { fullName: { contains: input.search } },
                  { employeeNo: { contains: input.search } },
                ],
              }
            : {}),
        },
      },
      orderBy: [{ workDate: 'asc' }, { staffId: 'asc' }],
      take: input.limit + 1,
      include: {
        staff: {
          select: {
            employeeNo: true,
            fullName: true,
            department: { select: { name: true } },
            location: { select: { name: true } },
          },
        },
        shift: { select: { code: true } },
      },
    });

    flat = rows.map((row) => ({
      workDate: date(row.workDate),
      employeeNo: row.staff.employeeNo,
      fullName: row.staff.fullName,
      department: row.staff.department?.name ?? '',
      location: row.staff.location?.name ?? '',
      shift: row.shift?.code ?? '',
      status: row.status,
      scheduledStart: time(row.scheduledStart),
      scheduledEnd: time(row.scheduledEnd),
      checkInAt: time(row.checkInAt),
      checkOutAt: time(row.checkOutAt),
      lateMinutes: String(row.lateMinutes),
      earlyLeaveMinutes: String(row.earlyLeaveMinutes),
      workedMinutes: String(row.workedMinutes),
      overtimeMinutes: String(row.overtimeMinutes),
    }));
  } else if (input.dataset === 'exceptions') {
    const rows = await db().attendanceException.findMany({
      where: {
        occurredAt: { gte: period.startsAt, lt: period.endsAt },
        ...(input.status === 'open' ? { resolvedAt: null } : {}),
        ...(input.status === 'resolved' ? { resolvedAt: { not: null } } : {}),
        ...(input.search ? { kind: { contains: input.search } } : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: input.limit + 1,
      include: {
        staff: {
          select: {
            employeeNo: true,
            fullName: true,
            department: { select: { name: true } },
          },
        },
      },
    });

    const devices = await db().device.findMany({ select: { id: true, name: true } });
    const deviceById = new Map(devices.map((row) => [row.id, row.name]));

    flat = rows.map((row) => ({
      occurredAt: stamp(row.occurredAt),
      workDate: date(row.workDate),
      kind: row.kind,
      employeeNo: row.staff?.employeeNo ?? '',
      fullName: row.staff?.fullName ?? '',
      department: row.staff?.department?.name ?? '',
      deviceName: row.deviceId === null ? '' : (deviceById.get(row.deviceId) ?? ''),
      detail: row.detail ?? '',
      resolvedAt: stamp(row.resolvedAt),
      resolutionNote: row.resolutionNote ?? '',
    }));
  } else {
    const rows = await db().leaveRequest.findMany({
      where: {
        fromDate: { lte: period.to },
        toDate: { gte: period.from },
        ...(input.status ? { status: input.status } : {}),
        staff: {
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
          ...(input.search
            ? {
                OR: [
                  { fullName: { contains: input.search } },
                  { employeeNo: { contains: input.search } },
                ],
              }
            : {}),
        },
      },
      orderBy: { fromDate: 'desc' },
      take: input.limit + 1,
      include: {
        staff: {
          select: {
            employeeNo: true,
            fullName: true,
            department: { select: { name: true } },
          },
        },
        leaveType: { select: { code: true, name: true } },
      },
    });

    flat = rows.map((row) => ({
      fromDate: date(row.fromDate),
      toDate: date(row.toDate),
      employeeNo: row.staff.employeeNo,
      fullName: row.staff.fullName,
      department: row.staff.department?.name ?? '',
      leaveType: `${row.leaveType.code} — ${row.leaveType.name}`,
      days: String(row.days),
      status: row.status,
      reason: row.reason ?? '',
      decisionNote: row.decisionNote ?? '',
    }));
  }

  const truncated = flat.length > input.limit;
  if (truncated) flat = flat.slice(0, input.limit);

  if (input.groupBy === 'none') {
    return {
      columns: input.columns.map(builderColumn),
      rows: flat.map((row) =>
        Object.fromEntries(input.columns.map((key) => [key, row[key] ?? ''])),
      ),
      truncated,
      limit: input.limit,
    };
  }

  const groupKey = groupField(input.dataset, input.groupBy);
  const numeric = input.columns.filter((key) => NUMERIC_FIELDS.has(key));

  const groups = new Map<string, Record<string, number> & { count: number }>();
  for (const row of flat) {
    const label = row[groupKey] ?? '';
    const bucket = groups.get(label) ?? ({ count: 0 } as Record<string, number> & { count: number });
    bucket.count += 1;
    for (const key of numeric) bucket[key] = (bucket[key] ?? 0) + Number(row[key] ?? 0);
    groups.set(label, bucket);
  }

  return {
    columns: [
      // The grouped column keeps the key `group` but is named after whatever it grouped on,
      // so the heading says "Per jabatan" rather than a generic "Kumpulan".
      { ...builderColumn(groupKey), key: 'group' },
      builderColumn('count'),
      ...numeric.map(builderColumn),
    ],
    rows: [...groups.entries()]
      .map(([label, bucket]) => ({
        group: label.length === 0 ? '(tiada)' : label,
        count: String(bucket.count),
        ...Object.fromEntries(numeric.map((key) => [key, String(bucket[key] ?? 0)])),
      }))
      .sort((left, right) => Number(right.count) - Number(left.count)),
    truncated,
    limit: input.limit,
  };
}

const NUMERIC_FIELDS = new Set([
  'lateMinutes',
  'earlyLeaveMinutes',
  'workedMinutes',
  'overtimeMinutes',
  'days',
]);

function groupField(dataset: string, groupBy: string): string {
  if (groupBy === 'staff') return 'fullName';
  if (groupBy === 'department') return 'department';
  if (groupBy === 'workDate') return dataset === 'leave' ? 'fromDate' : 'workDate';
  return groupBy;
}

// The CSV helpers live in `reports/csv.ts`, because the payroll module writes a file too and
// the UTF-8 BOM is not something a second implementation should be able to forget.
