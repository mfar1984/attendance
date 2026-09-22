import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requirePermission } from '../auth/plugin.js';
import { db } from '../db.js';
import { loadEnv } from '../env.js';
import { conflict, notFound, unauthorized } from '../http.js';
import { recordActivity } from '../logging/activity.js';

/**
 * Receipt files for claims and expenses.
 *
 * A plugin of its own so it can live in the multipart scope alongside the branding and avatar
 * uploads. `@fastify/multipart` installs a parser for `multipart/form-data`, and the ingest
 * route installs its own raw parser for the same type — two parsers for one type is a boot
 * failure, so the encapsulation is load-bearing rather than tidiness.
 *
 * The rules are the same three the other uploads follow, for the same reasons:
 *
 *   type decided from the leading bytes, not from the declared content-type or the filename,
 *   because both are strings the client chose
 *
 *   SVG refused — it is an XML document that can carry a script, and it would be served from
 *   this origin where CSP allows scripts from 'self'
 *
 *   filename derived by the server, never accepted, so nothing can point the stored path at
 *   somewhere else on disk
 */

/** Formats a receipt may be in, identified by their leading bytes. */
const SIGNATURES: Array<{ ext: string; mime: string; test: (head: Buffer) => boolean }> = [
  {
    ext: '.png',
    mime: 'image/png',
    test: (head) =>
      head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: '.jpg',
    mime: 'image/jpeg',
    test: (head) => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
  },
  {
    ext: '.webp',
    mime: 'image/webp',
    test: (head) =>
      head.subarray(0, 4).toString('ascii') === 'RIFF' &&
      head.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    /*
     * PDF is accepted here and not for avatars, because a receipt routinely arrives as one —
     * a scanner or a bank statement produces PDF, and refusing it would push people into
     * photographing a screen.
     */
    ext: '.pdf',
    mime: 'application/pdf',
    test: (head) => head.subarray(0, 5).toString('ascii') === '%PDF-',
  },
];

/** Larger than an avatar: a scanned receipt is a photograph, sometimes several pages. */
const MAX_BYTES = 4 * 1024 * 1024;

export async function hrReceiptRoutes(app: FastifyInstance): Promise<void> {
  const directory = resolve(process.cwd(), loadEnv().STORAGE_DIR, 'receipts');

  function idParam(params: unknown): number {
    const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
    if (!parsed.success) throw notFound('Tuntutan tidak dijumpai');
    return parsed.data.id;
  }

  /**
   * Attached to a line, not to the claim.
   *
   * `:id` is a `ClaimItem` id. A claim covers several costs on several dates — a hotel bill and three
   * toll slips are four documents — so `ClaimType.requiresReceipt` means "every line needs one", and
   * a claim-level upload could satisfy that rule with a single piece of paper standing in for lines
   * that had none.
   *
   * The claim's status still governs: the gate is on the parent, because that is what carries the
   * decision the evidence was weighed for.
   */
  app.post(
    '/api/claim-items/:id/receipt',
    { preHandler: requirePermission('hr.claims', 'create') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const id = idParam(request.params);

      const existing = await db().claimItem.findUnique({
        where: { id },
        include: { claim: { select: { id: true, requestNo: true, status: true } } },
      });
      if (!existing) throw notFound('Baris tuntutan tidak dijumpai');
      /*
       * Refused once the claim is decided.
       *
       * The receipt is the evidence the decision was made against. Replacing it afterwards
       * would leave an approved amount justified by a document nobody who approved it saw.
       */
      if (existing.claim.status !== 'pending') {
        throw conflict(
          `Tuntutan ini sudah ${existing.claim.status}. Resit tidak boleh ditukar selepas keputusan.`,
        );
      }

      const part = await request.file({ limits: { fileSize: MAX_BYTES, files: 1 } });
      if (!part) throw conflict('Tiada fail dihantar.');

      const bytes = await part.toBuffer().catch(() => null);
      if (bytes === null || bytes.length > MAX_BYTES) {
        throw conflict(`Fail melebihi ${String(MAX_BYTES / 1024 / 1024)} MB.`);
      }
      if (bytes.length === 0) throw conflict('Fail kosong.');

      const match = SIGNATURES.find((entry) => entry.test(bytes));
      if (!match) {
        throw conflict(
          'Fail itu bukan PDF, PNG, JPEG atau WEBP. SVG tidak diterima — ia dokumen XML yang ' +
            'boleh membawa skrip, dan ia akan dihidangkan dari origin yang sama dengan ' +
            'aplikasi ini.',
        );
      }

      await mkdir(directory, { recursive: true });

      const name = `claim-${String(existing.claimRequestId)}-${String(id)}-${String(Date.now())}${match.ext}`;
      await writeFile(join(directory, name), bytes);

      const previous = existing.receiptPath;
      await db().claimItem.update({ where: { id }, data: { receiptPath: name } });

      // Removed only after the row points elsewhere, so a failed write never leaves the line
      // naming a file that is already gone.
      if (previous !== null && previous !== name) {
        await unlink(join(directory, previous)).catch(() => undefined);
      }

      await recordActivity({
        request,
        action: 'claim.receipt.uploaded',
        category: 'schedule',
        detail: `${existing.claim.requestNo} baris #${String(id)}: ${match.mime}, ${String(Math.round(bytes.length / 1024))} KB`,
      });

      return { ok: true, contentType: match.mime };
    },
  );

  /**
   * Serves the file.
   *
   * Behind the module's `view` permission, unlike an avatar which needs none. A receipt is a
   * financial document naming a payee and an amount, not a picture of a colleague.
   */
  app.get(
    '/api/claim-items/:id/receipt',
    { preHandler: requirePermission('hr.claims', 'view') },
    async (request, reply) => {
      const id = idParam(request.params);

      const row = await db().claimItem.findUnique({
        where: { id },
        select: { receiptPath: true },
      });
      if (!row || row.receiptPath === null) throw notFound('Tiada resit dilampirkan');

      const mime =
        SIGNATURES.find((entry) => row.receiptPath?.endsWith(entry.ext))?.mime ??
        'application/octet-stream';

      return reply
        .header('content-type', mime)
        // Private: a shared cache must not hold somebody's receipt.
        .header('cache-control', 'private, max-age=0, must-revalidate')
        /*
         * Inline rather than an attachment, so a reviewer sees it without a download step —
         * but with `nosniff` and a filename the server chose, so nothing here can be coaxed
         * into being interpreted as something else.
         */
        .header('x-content-type-options', 'nosniff')
        .send(createReadStream(join(directory, row.receiptPath)));
    },
  );

  app.delete(
    '/api/claim-items/:id/receipt',
    { preHandler: requirePermission('hr.claims', 'edit') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const id = idParam(request.params);

      const existing = await db().claimItem.findUnique({
        where: { id },
        include: { claim: { select: { requestNo: true, status: true } } },
      });
      if (!existing) throw notFound('Baris tuntutan tidak dijumpai');
      if (existing.claim.status !== 'pending') {
        throw conflict(`Tuntutan ini sudah ${existing.claim.status}. Resit tidak boleh dibuang.`);
      }
      if (existing.receiptPath === null) throw notFound('Tiada resit dilampirkan');

      await db().claimItem.update({ where: { id }, data: { receiptPath: null } });
      await unlink(join(directory, existing.receiptPath)).catch(() => undefined);

      await recordActivity({
        request,
        action: 'claim.receipt.removed',
        category: 'schedule',
        level: 'warn',
        detail: `${existing.claim.requestNo} baris #${String(id)}`,
      });

      return { ok: true };
    },
  );
}

/**
 * Expense receipts.
 *
 * The same three endpoints over a different table. Not folded into a generic helper because
 * the Prisma models are separate types and the indirection needed to unify them would be
 * longer than the duplication — and each module's permission screen differs anyway.
 *
 * One rule is stricter here: an expense has no rated category to derive an amount from, so the
 * receipt is the entire basis of the figure. There is no such thing as an expense that does
 * not need one.
 */
export async function expenseReceiptRoutes(app: FastifyInstance): Promise<void> {
  const directory = resolve(process.cwd(), loadEnv().STORAGE_DIR, 'receipts');

  function idParam(params: unknown): number {
    const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
    if (!parsed.success) throw notFound('Permohonan perbelanjaan tidak dijumpai');
    return parsed.data.id;
  }

  app.post(
    '/api/expense-requests/:id/receipt',
    { preHandler: requirePermission('hr.expenses', 'create') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const id = idParam(request.params);

      const existing = await db().expenseRequest.findUnique({ where: { id } });
      if (!existing) throw notFound('Permohonan perbelanjaan tidak dijumpai');
      if (existing.status !== 'pending') {
        throw conflict(
          `Permohonan ini sudah ${existing.status}. Resit tidak boleh ditukar selepas keputusan.`,
        );
      }

      const part = await request.file({ limits: { fileSize: MAX_BYTES, files: 1 } });
      if (!part) throw conflict('Tiada fail dihantar.');

      const bytes = await part.toBuffer().catch(() => null);
      if (bytes === null || bytes.length > MAX_BYTES) {
        throw conflict(`Fail melebihi ${String(MAX_BYTES / 1024 / 1024)} MB.`);
      }
      if (bytes.length === 0) throw conflict('Fail kosong.');

      const match = SIGNATURES.find((entry) => entry.test(bytes));
      if (!match) {
        throw conflict(
          'Fail itu bukan PDF, PNG, JPEG atau WEBP. SVG tidak diterima — ia dokumen XML yang ' +
            'boleh membawa skrip, dan ia akan dihidangkan dari origin yang sama dengan ' +
            'aplikasi ini.',
        );
      }

      await mkdir(directory, { recursive: true });

      const name = `expense-${String(id)}-${String(Date.now())}${match.ext}`;
      await writeFile(join(directory, name), bytes);

      const previous = existing.receiptPath;
      await db().expenseRequest.update({ where: { id }, data: { receiptPath: name } });

      if (previous !== null && previous !== name) {
        await unlink(join(directory, previous)).catch(() => undefined);
      }

      await recordActivity({
        request,
        action: 'expense.receipt.uploaded',
        category: 'schedule',
        detail: `${existing.requestNo}: ${match.mime}, ${String(Math.round(bytes.length / 1024))} KB`,
      });

      return { ok: true, contentType: match.mime };
    },
  );

  app.get(
    '/api/expense-requests/:id/receipt',
    { preHandler: requirePermission('hr.expenses', 'view') },
    async (request, reply) => {
      const id = idParam(request.params);

      const row = await db().expenseRequest.findUnique({
        where: { id },
        select: { receiptPath: true },
      });
      if (!row || row.receiptPath === null) throw notFound('Tiada resit dilampirkan');

      const mime =
        SIGNATURES.find((entry) => row.receiptPath?.endsWith(entry.ext))?.mime ??
        'application/octet-stream';

      return reply
        .header('content-type', mime)
        .header('cache-control', 'private, max-age=0, must-revalidate')
        .header('x-content-type-options', 'nosniff')
        .send(createReadStream(join(directory, row.receiptPath)));
    },
  );

  app.delete(
    '/api/expense-requests/:id/receipt',
    { preHandler: requirePermission('hr.expenses', 'edit') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const id = idParam(request.params);

      const existing = await db().expenseRequest.findUnique({ where: { id } });
      if (!existing) throw notFound('Permohonan perbelanjaan tidak dijumpai');
      if (existing.status !== 'pending') {
        throw conflict(`Permohonan ini sudah ${existing.status}. Resit tidak boleh dibuang.`);
      }
      if (existing.receiptPath === null) throw notFound('Tiada resit dilampirkan');

      await db().expenseRequest.update({ where: { id }, data: { receiptPath: null } });
      await unlink(join(directory, existing.receiptPath)).catch(() => undefined);

      await recordActivity({
        request,
        action: 'expense.receipt.removed',
        category: 'schedule',
        level: 'warn',
        detail: existing.requestNo,
      });

      return { ok: true };
    },
  );
}
/**
 * Supporting documents for leave applications.
 *
 * The same three endpoints again, over `LeaveRequest.documentPath`. Duplicated rather than
 * unified for the reason stated above the expense block: the Prisma models are separate types
 * and the indirection to fold them together would run longer than the repetition.
 *
 * Two things differ, and both come from leave not being a money module.
 *
 * The directory is `leave` rather than `receipts`. A medical certificate is a health record;
 * sitting it in the same folder as expense receipts would mean the retention rule that governs
 * financial documents silently governs it too.
 *
 * Whether a document is required at all is per category — `LeaveType.requiresDocument`. Annual
 * leave needs nothing, sick leave needs the certificate. A claim always has a receipt or a rate
 * behind it; leave has neither for most of its categories.
 */
export async function leaveDocumentRoutes(app: FastifyInstance): Promise<void> {
  const directory = resolve(process.cwd(), loadEnv().STORAGE_DIR, 'leave');

  function idParam(params: unknown): number {
    const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(params);
    if (!parsed.success) throw notFound('Permohonan cuti tidak dijumpai');
    return parsed.data.id;
  }

  app.post(
    '/api/leave-requests/:id/document',
    { preHandler: requirePermission('schedule.leave', 'create') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const id = idParam(request.params);

      const existing = await db().leaveRequest.findUnique({ where: { id } });
      if (!existing) throw notFound('Permohonan cuti tidak dijumpai');
      /*
       * Refused once decided, same as a claim receipt: the document is what the decision was
       * made against, and replacing it afterwards would leave an approved absence justified by
       * a certificate nobody who approved it saw.
       */
      if (existing.status !== 'pending') {
        throw conflict(
          `Permohonan ini sudah ${existing.status}. Dokumen tidak boleh ditukar selepas keputusan.`,
        );
      }

      const part = await request.file({ limits: { fileSize: MAX_BYTES, files: 1 } });
      if (!part) throw conflict('Tiada fail dihantar.');

      const bytes = await part.toBuffer().catch(() => null);
      if (bytes === null || bytes.length > MAX_BYTES) {
        throw conflict(`Fail melebihi ${String(MAX_BYTES / 1024 / 1024)} MB.`);
      }
      if (bytes.length === 0) throw conflict('Fail kosong.');

      const match = SIGNATURES.find((entry) => entry.test(bytes));
      if (!match) {
        throw conflict(
          'Fail itu bukan PDF, PNG, JPEG atau WEBP. SVG tidak diterima — ia dokumen XML yang ' +
            'boleh membawa skrip, dan ia akan dihidangkan dari origin yang sama dengan ' +
            'aplikasi ini.',
        );
      }

      await mkdir(directory, { recursive: true });

      const name = `leave-${String(id)}-${String(Date.now())}${match.ext}`;
      await writeFile(join(directory, name), bytes);

      const previous = existing.documentPath;
      await db().leaveRequest.update({ where: { id }, data: { documentPath: name } });

      if (previous !== null && previous !== name) {
        await unlink(join(directory, previous)).catch(() => undefined);
      }

      await recordActivity({
        request,
        action: 'leave.document.uploaded',
        category: 'schedule',
        detail: `Cuti #${String(id)}: ${match.mime}, ${String(Math.round(bytes.length / 1024))} KB`,
      });

      return { ok: true, contentType: match.mime };
    },
  );

  app.get(
    '/api/leave-requests/:id/document',
    { preHandler: requirePermission('schedule.leave', 'view') },
    async (request, reply) => {
      const id = idParam(request.params);

      const row = await db().leaveRequest.findUnique({
        where: { id },
        select: { documentPath: true },
      });
      if (!row || row.documentPath === null) throw notFound('Tiada dokumen dilampirkan');

      const mime =
        SIGNATURES.find((entry) => row.documentPath?.endsWith(entry.ext))?.mime ??
        'application/octet-stream';

      return reply
        .header('content-type', mime)
        .header('cache-control', 'private, max-age=0, must-revalidate')
        .header('x-content-type-options', 'nosniff')
        .send(createReadStream(join(directory, row.documentPath)));
    },
  );

  app.delete(
    '/api/leave-requests/:id/document',
    { preHandler: requirePermission('schedule.leave', 'edit') },
    async (request) => {
      if (!request.user) throw unauthorized();
      const id = idParam(request.params);

      const existing = await db().leaveRequest.findUnique({ where: { id } });
      if (!existing) throw notFound('Permohonan cuti tidak dijumpai');
      if (existing.status !== 'pending') {
        throw conflict(`Permohonan ini sudah ${existing.status}. Dokumen tidak boleh dibuang.`);
      }
      if (existing.documentPath === null) throw notFound('Tiada dokumen dilampirkan');

      await db().leaveRequest.update({ where: { id }, data: { documentPath: null } });
      await unlink(join(directory, existing.documentPath)).catch(() => undefined);

      await recordActivity({
        request,
        action: 'leave.document.removed',
        category: 'schedule',
        level: 'warn',
        detail: `Cuti #${String(id)}`,
      });

      return { ok: true };
    },
  );
}
