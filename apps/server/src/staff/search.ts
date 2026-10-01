import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requirePermission } from '../auth/plugin.js';
import { db, jsonSafe } from '../db.js';

/**
 * Registers the staff picker endpoint for one module.
 *
 * One endpoint per module, because the gate differs: whoever files overtime is not necessarily
 * whoever assigns appraisals or records a loan, and borrowing another module's search would make
 * this module's form depend on that module's grant. The gate is `create` on the module's own
 * screen, since picking somebody is the first step of creating a record about them.
 *
 * One implementation behind all of them, so the copies cannot drift: the leave and claim forms
 * each grew their own before this existed, and those are the only two that still carry one.
 *
 * Filtered on the server and capped, because this directory holds five thousand people and a
 * select of every one of them is a quarter of a megabyte of options with no way to search it.
 * Active staff only: none of these modules may file anything against a deactivated record.
 */
export function registerStaffSearch(app: FastifyInstance, path: string, screen: string): void {
  app.get(path, { preHandler: requirePermission(screen, 'create') }, async (request) => {
    const query = z
      .object({
        q: z.string().trim().max(128).default(''),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(request.query);

    const rows = await db().staff.findMany({
      where: {
        active: true,
        ...(query.q.length > 0
          ? {
              OR: [{ fullName: { contains: query.q } }, { employeeNo: { contains: query.q } }],
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
      },
    });

    return jsonSafe(rows);
  });
}
