import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requirePermission } from '../auth/plugin.js';
import { db, jsonSafe } from '../db.js';
import { conflict, forUpdate, notFound, parseBody } from '../http.js';

const departmentSchema = z.object({
  name: z.string().trim().min(1, 'Nama diperlukan').max(120),
  code: z.union([z.literal(''), z.string().trim().max(32)]).optional(),
  parentId: z.number().int().positive().nullable().optional(),
});

const locationSchema = z.object({
  name: z.string().trim().min(1, 'Nama diperlukan').max(120),
  address: z.union([z.literal(''), z.string().trim().max(500)]).optional(),
  /** Range checks match real coordinates, so a swapped pair is caught. */
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  /**
   * Radius the mobile app will accept a check-in within.
   *
   * Stored now even though app check-in comes later, because the value belongs to
   * the location rather than to the app, and collecting it while somebody is
   * already editing these records saves a second pass over every site.
   */
  geofenceRadiusM: z.coerce.number().int().min(20).max(5000).default(200),
});

/**
 * Departments and locations.
 *
 * Both are referenced by staff with `onDelete: SetNull`, so removing one detaches
 * staff rather than deleting them. That is still disruptive at this headcount, so
 * a delete is refused while anyone is attached.
 */
export async function orgRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // Departments
  // -------------------------------------------------------------------------

  app.get('/api/departments', { preHandler: requirePermission('staff.departments', 'view') }, async () => {
    const rows = await db().department.findMany({
      orderBy: { name: 'asc' },
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { staff: true, children: true } },
      },
    });

    return jsonSafe(
      rows.map(({ _count, ...row }) => ({
        ...row,
        staffCount: _count.staff,
        childCount: _count.children,
      })),
    );
  });

  app.post(
    '/api/departments',
    { preHandler: requirePermission('staff.departments', 'create') },
    async (request) => {
      const body = parseBody(departmentSchema, request.body);

      const clash = await db().department.findFirst({ where: { name: body.name } });
      if (clash) throw conflict(`Jabatan "${body.name}" sudah ada`);

      const row = await db().department.create({
        data: {
          name: body.name,
          code: body.code && body.code.length > 0 ? body.code : null,
          parentId: body.parentId ?? null,
        },
      });
      return jsonSafe({ id: row.id });
    },
  );

  app.patch(
    '/api/departments/:id',
    { preHandler: requirePermission('staff.departments', 'edit') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(forUpdate(departmentSchema), request.body);

      const existing = await db().department.findUnique({ where: { id } });
      if (!existing) throw notFound('Jabatan tidak dijumpai');

      // A department cannot be its own parent, and a cycle would make the tree
      // walk in reports recurse forever.
      if (body.parentId !== undefined && body.parentId !== null) {
        if (body.parentId === id) throw conflict('Jabatan tidak boleh menjadi induk kepada dirinya');
        if (await createsCycle(id, body.parentId)) {
          throw conflict('Pilihan ini akan mencipta kitaran dalam hierarki jabatan');
        }
      }

      await db().department.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.code !== undefined ? { code: body.code.length > 0 ? body.code : null } : {}),
          ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
        },
      });

      return jsonSafe({ id });
    },
  );

  app.delete(
    '/api/departments/:id',
    { preHandler: requirePermission('staff.departments', 'delete') },
    async (request) => {
      const id = idParam(request.params);

      const [staffCount, childCount] = await Promise.all([
        db().staff.count({ where: { departmentId: id } }),
        db().department.count({ where: { parentId: id } }),
      ]);

      // Refused rather than cascading. Detaching staff in bulk is not something to
      // do as a side effect of a delete click.
      if (staffCount > 0) {
        throw conflict(
          `${staffCount} staf masih dalam jabatan ini. Pindahkan mereka dahulu.`,
        );
      }
      if (childCount > 0) {
        throw conflict(`Jabatan ini mempunyai ${childCount} sub-jabatan. Buang atau pindahkan dahulu.`);
      }

      await db().department.delete({ where: { id } });
      return { ok: true };
    },
  );

  // -------------------------------------------------------------------------
  // Locations
  // -------------------------------------------------------------------------

  app.get('/api/locations', { preHandler: requirePermission('staff.locations', 'view') }, async () => {
    const rows = await db().location.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { staff: true, devices: true } } },
    });

    return jsonSafe(
      rows.map(({ _count, ...row }) => ({
        ...row,
        staffCount: _count.staff,
        deviceCount: _count.devices,
      })),
    );
  });

  app.post(
    '/api/locations',
    { preHandler: requirePermission('staff.locations', 'create') },
    async (request) => {
      const body = parseBody(locationSchema, request.body);

      const clash = await db().location.findFirst({ where: { name: body.name } });
      if (clash) throw conflict(`Lokasi "${body.name}" sudah ada`);

      const row = await db().location.create({
        data: {
          name: body.name,
          address: body.address && body.address.length > 0 ? body.address : null,
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
          geofenceRadiusM: body.geofenceRadiusM,
        },
      });
      return jsonSafe({ id: row.id });
    },
  );

  app.patch(
    '/api/locations/:id',
    { preHandler: requirePermission('staff.locations', 'edit') },
    async (request) => {
      const id = idParam(request.params);
      const body = parseBody(forUpdate(locationSchema), request.body);

      const existing = await db().location.findUnique({ where: { id } });
      if (!existing) throw notFound('Lokasi tidak dijumpai');

      await db().location.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.address !== undefined
            ? { address: body.address.length > 0 ? body.address : null }
            : {}),
          ...(body.latitude !== undefined ? { latitude: body.latitude } : {}),
          ...(body.longitude !== undefined ? { longitude: body.longitude } : {}),
          ...(body.geofenceRadiusM !== undefined ? { geofenceRadiusM: body.geofenceRadiusM } : {}),
        },
      });

      return jsonSafe({ id });
    },
  );

  app.delete(
    '/api/locations/:id',
    { preHandler: requirePermission('staff.locations', 'delete') },
    async (request) => {
      const id = idParam(request.params);

      const [staffCount, deviceCount] = await Promise.all([
        db().staff.count({ where: { locationId: id } }),
        db().device.count({ where: { locationId: id } }),
      ]);

      if (staffCount > 0) throw conflict(`${staffCount} staf masih di lokasi ini.`);
      if (deviceCount > 0) throw conflict(`${deviceCount} terminal masih di lokasi ini.`);

      await db().location.delete({ where: { id } });
      return { ok: true };
    },
  );
}

/** Walks up the proposed parent chain looking for the node being edited. */
async function createsCycle(departmentId: number, proposedParentId: number): Promise<boolean> {
  const prisma = db();
  let cursor: number | null = proposedParentId;
  // Bounded so malformed existing data cannot hang the request.
  for (let depth = 0; depth < 64 && cursor !== null; depth += 1) {
    if (cursor === departmentId) return true;
    const parent: { parentId: number | null } | null = await prisma.department.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = parent?.parentId ?? null;
  }
  return false;
}

function idParam(params: unknown): number {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
  if (!parsed.success) throw notFound('Rekod tidak dijumpai');
  return parsed.data.id;
}
