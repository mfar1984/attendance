import type { LabelKey } from '@attendance/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requirePermission } from '../auth/plugin.js';
import { db, jsonSafe } from '../db.js';
import { notFound, parseBody, unauthorized } from '../http.js';
import { importDeviceUsers, mapDeviceUser } from './resolve.js';

export async function identityRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Reads a terminal's roster and builds mappings from it.
   *
   * Run when adopting a terminal that somebody else populated. Exact identifier
   * matches are paired automatically but left unconfirmed; the rest are queued
   * for review rather than guessed at.
   */
  app.post(
    '/api/devices/:id/import-users',
    { preHandler: requirePermission('staff.mapping', 'import') },
    async (request) => {
      const device = await db().device.findUnique({ where: { id: idParam(request.params) } });
      if (!device) throw notFound('Peranti tidak dijumpai');
      return jsonSafe(await importDeviceUsers(device));
    },
  );

  /** Device identifiers awaiting a human pairing, busiest first. */
  app.get(
    '/api/identity/unmapped',
    { preHandler: requirePermission('staff.mapping', 'view') },
    async () => {
      const rows = await db().unmappedDeviceUser.findMany({
        where: { dismissedAt: null },
        // Highest scan count first: those are people clocking in every day whose
        // attendance is currently going nowhere.
        orderBy: [{ scanCount: 'desc' }, { lastSeenAt: 'desc' }],
        include: { device: { select: { id: true, name: true } } },
      });
      return jsonSafe(rows);
    },
  );

  /** Mappings that were auto-paired on import and still need a human to agree. */
  app.get(
    '/api/identity/unconfirmed',
    { preHandler: requirePermission('staff.mapping', 'view') },
    async () => {
      const rows = await db().deviceEnrolment.findMany({
        where: { confirmed: false },
        orderBy: { createdAt: 'asc' },
        include: {
          device: { select: { id: true, name: true } },
          staff: { select: { id: true, employeeNo: true, fullName: true } },
        },
      });
      return jsonSafe(rows);
    },
  );

  /**
   * Pairs a terminal identifier with a staff record.
   *
   * Also regenerates punches for scans that arrived before the mapping existed,
   * so resolving a mapping recovers the history rather than only fixing tomorrow.
   */
  app.post(
    '/api/identity/map',
    { preHandler: requirePermission('staff.mapping', 'create') },
    async (request) => {
      if (!request.user) throw unauthorized();

      const body = parseBody(
        z.object({
          deviceId: z.coerce.number().int().positive(),
          deviceEmployeeNo: z.string().trim().min(1).max(32),
          staffId: z.coerce.number().int().positive(),
        }),
        request.body,
      );

      const result = await mapDeviceUser({
        ...body,
        confirmedBy: request.user.accountId,
      });

      /**
       * A key and its count, not a finished sentence.
       *
       * The screen renders this beside the staff name, so it has to resolve in the reader's
       * language. The count travels separately because the sentence puts it in a different
       * place in different languages.
       */
      return jsonSafe({
        ...result,
        noteKey: (result.backfilled > 0
          ? 'mapping.confirmed.backfilled'
          : 'mapping.confirmed.nothingToBackfill') satisfies LabelKey,
      });
    },
  );

  /** Removes a mapping. Existing punches are kept; only future scans stop resolving. */
  app.delete(
    '/api/identity/map/:deviceId/:deviceEmployeeNo',
    { preHandler: requirePermission('staff.mapping', 'delete') },
    async (request) => {
      const params = z
        .object({
          deviceId: z.coerce.number().int().positive(),
          deviceEmployeeNo: z.string().trim().min(1).max(32),
        })
        .safeParse(request.params);
      if (!params.success) throw notFound('Pemetaan tidak dijumpai');

      await db().deviceEnrolment.deleteMany({
        where: {
          deviceId: params.data.deviceId,
          deviceEmployeeNo: params.data.deviceEmployeeNo,
        },
      });
      return { ok: true };
    },
  );

  /**
   * Staff lookup for the mapping picker.
   *
   * Returns whether each candidate already holds an identity on the terminal in
   * question, so the operator can see the clash before attempting the pairing
   * rather than after being refused.
   */
  app.get(
    '/api/identity/staff-search',
    { preHandler: requirePermission('staff.mapping', 'view') },
    async (request) => {
      const query = z
        .object({
          q: z.string().trim().max(128).default(''),
          deviceId: z.coerce.number().int().positive().optional(),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        })
        .parse(request.query);

      const rows = await db().staff.findMany({
        where: {
          active: true,
          ...(query.q.length > 0
            ? {
                OR: [
                  { fullName: { contains: query.q } },
                  { employeeNo: { contains: query.q } },
                  { icNo: { contains: query.q } },
                ],
              }
            : {}),
        },
        orderBy: { fullName: 'asc' },
        take: query.limit,
        select: {
          id: true,
          employeeNo: true,
          fullName: true,
          department: { select: { name: true } },
          enrolments: query.deviceId
            ? {
                where: { deviceId: query.deviceId },
                select: { deviceEmployeeNo: true },
              }
            : false,
        },
      });

      return jsonSafe(
        rows.map(({ enrolments, ...staff }) => ({
          ...staff,
          existingDeviceEmployeeNo:
            Array.isArray(enrolments) && enrolments[0] ? enrolments[0].deviceEmployeeNo : null,
        })),
      );
    },
  );

  /** Dismisses an identifier that will never belong to anybody. */
  app.post(
    '/api/identity/unmapped/:id/dismiss',
    { preHandler: requirePermission('staff.mapping', 'delete') },
    async (request) => {
      const id = idParam(request.params);
      await db().unmappedDeviceUser.update({
        where: { id },
        data: { dismissedAt: new Date() },
      });
      return { ok: true };
    },
  );

  /**
   * Every terminal identity held by one person.
   *
   * This is the view that answers "which id is this person on each door", which
   * is otherwise impossible to see once the numbers differ per unit.
   */
  app.get(
    '/api/staff/:id/identities',
    { preHandler: requirePermission('staff.directory', 'view') },
    async (request) => {
      const staffId = idParam(request.params);

      const staff = await db().staff.findUnique({
        where: { id: staffId },
        select: {
          id: true,
          employeeNo: true,
          fullName: true,
          numOfFace: true,
          numOfFp: true,
          numOfCard: true,
          enrolments: {
            include: { device: { select: { id: true, name: true, host: true, status: true } } },
          },
        },
      });
      if (!staff) throw notFound('Staf tidak dijumpai');

      return jsonSafe({
        staffId: staff.id,
        canonicalEmployeeNo: staff.employeeNo,
        fullName: staff.fullName,
        credentials: {
          face: staff.numOfFace,
          fingerprint: staff.numOfFp,
          card: staff.numOfCard,
        },
        identities: staff.enrolments.map((enrolment) => ({
          deviceId: enrolment.device.id,
          deviceName: enrolment.device.name,
          deviceStatus: enrolment.device.status,
          deviceEmployeeNo: enrolment.deviceEmployeeNo,
          confirmed: enrolment.confirmed,
          faceEnrolledAt: enrolment.faceEnrolledAt,
        })),
      });
    },
  );
}

function idParam(params: unknown): number {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
  if (!parsed.success) throw notFound('Rekod tidak dijumpai');
  return parsed.data.id;
}
