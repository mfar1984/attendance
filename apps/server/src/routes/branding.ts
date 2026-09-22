import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requirePermission } from '../auth/plugin.js';
import { db } from '../db.js';
import { loadEnv } from '../env.js';
import { conflict, notFound, unauthorized } from '../http.js';
import { recordActivity } from '../logging/activity.js';

/**
 * Organisation logo and favicon.
 *
 * Uploaded rather than referenced by URL. The previous version took a URL in a text
 * field, which asks the operator to first get a file onto the server by some other
 * means — and on a LAN install with no internet, a URL pointing anywhere else renders
 * as a broken image on every report.
 *
 * Two rules do the security work here:
 *
 * The file type is decided by reading the first bytes, not by trusting the declared
 * content type or the extension. Both of those are strings the client chooses.
 *
 * SVG is refused. It is the obvious format for a logo and it is also an XML document
 * that can carry `<script>`, served from this origin, where the CSP allows scripts from
 * `'self'`. A logo upload that accepts SVG is a stored-XSS hole with an upload form in
 * front of it.
 */

/** What may be stored, keyed by the magic bytes that prove it. */
const SIGNATURES: Array<{ ext: string; mime: string; test: (head: Buffer) => boolean }> = [
  {
    ext: '.png',
    mime: 'image/png',
    test: (head) => head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
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
    ext: '.ico',
    mime: 'image/x-icon',
    test: (head) => head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01 && head[3] === 0x00,
  },
];

/** Generous for a logo, far too small to be a payload delivery mechanism. */
const MAX_BYTES = 1024 * 1024;

type Slot = 'logo' | 'favicon';

const SLOTS: Record<Slot, { key: string; label: string }> = {
  logo: { key: 'organisation.logoPath', label: 'Logo organisasi' },
  favicon: { key: 'organisation.faviconPath', label: 'Favicon' },
};

export async function brandingRoutes(app: FastifyInstance): Promise<void> {
  const env = loadEnv();
  const directory = resolve(process.cwd(), env.STORAGE_DIR, 'branding');

  /**
   * Serves the stored asset. Deliberately unauthenticated.
   *
   * The logo appears on the login page, before anybody has a session, so requiring one
   * would mean the only screen an unauthenticated person sees is the one screen that
   * cannot show it. A hospital logo is not a secret.
   *
   * The filename is never taken from the request: the slot picks one of two rows, and
   * the extension comes from what the upload validated. There is no string from the
   * caller anywhere in the path.
   */
  app.get('/api/branding/:slot', async (request, reply) => {
    const params = z.object({ slot: z.enum(['logo', 'favicon']) }).safeParse(request.params);
    if (!params.success) throw notFound('Aset tidak dijumpai');

    const row = await db().setting.findUnique({ where: { key: SLOTS[params.data.slot].key } });
    const stored = typeof row?.value === 'string' ? row.value : '';
    if (stored.length === 0) throw notFound('Belum dimuat naik');

    const target = join(directory, stored);
    // The stored value is written by this file and nothing else, but this process runs
    // unattended against a database an operator can reach, so it is checked anyway.
    if (!target.startsWith(directory)) throw notFound('Aset tidak dijumpai');

    const info = await stat(target).catch(() => null);
    if (!info) throw notFound('Fail aset hilang dari cakera');

    const match = SIGNATURES.find((entry) => entry.ext === extname(stored).toLowerCase());
    reply.header('content-type', match?.mime ?? 'application/octet-stream');
    reply.header('content-length', String(info.size));
    // Short, because replacing the logo should be visible on the next reload rather than
    // after somebody clears their browser cache.
    reply.header('cache-control', 'public, max-age=60');
    return reply.send(createReadStream(target));
  });

  app.post(
    '/api/branding/:slot',
    { preHandler: requirePermission('settings.general', 'edit') },
    async (request) => {
      if (!request.user) throw unauthorized();

      // `safeParse` and a 404, not `parse`: a bare Zod throw is not an `HttpError`, so it
      // reaches the error handler as an unrecognised failure and answers 500. An unknown
      // path segment is a missing route, not a server fault.
      const params = z.object({ slot: z.enum(['logo', 'favicon']) }).safeParse(request.params);
      if (!params.success) throw notFound('Slot aset tidak dikenali');
      const { slot } = params.data;

      const part = await request.file({ limits: { fileSize: MAX_BYTES, files: 1 } });
      if (!part) throw conflict('Tiada fail dihantar.');

      const bytes = await part.toBuffer().catch(() => null);
      if (bytes === null) throw conflict(`Fail melebihi ${String(MAX_BYTES / 1024)} KB.`);
      if (bytes.length === 0) throw conflict('Fail kosong.');
      if (bytes.length > MAX_BYTES) {
        throw conflict(`Fail melebihi ${String(MAX_BYTES / 1024)} KB.`);
      }

      // Decided from the bytes. `part.mimetype` and the filename are both supplied by
      // the client and neither is evidence of anything.
      const match = SIGNATURES.find((entry) => entry.test(bytes));
      if (!match) {
        throw conflict(
          'Fail itu bukan PNG, JPEG, WEBP atau ICO. SVG tidak diterima dengan sengaja: ' +
            'ia dokumen XML yang boleh membawa skrip, dan ia akan dihidangkan dari origin ' +
            'yang sama dengan aplikasi ini.',
        );
      }

      await mkdir(directory, { recursive: true });

      // Named by slot, so a replacement overwrites rather than accumulating. The counter
      // in the name busts any cache that ignores the header.
      const name = `${slot}-${String(Date.now())}${match.ext}`;
      await writeFile(join(directory, name), bytes);

      const previous = await db().setting.findUnique({ where: { key: SLOTS[slot].key } });
      await db().setting.upsert({
        where: { key: SLOTS[slot].key },
        create: { key: SLOTS[slot].key, value: name, secret: false, updatedBy: request.user.accountId },
        update: { value: name, updatedBy: request.user.accountId },
      });

      // Removed after the row points elsewhere, so a failed write never leaves the
      // setting naming a file that is already gone.
      await removeUnreferenced(directory, previous?.value);

      await recordActivity({
        request,
        action: 'branding.upload',
        category: 'settings',
        detail: `${SLOTS[slot].label} · ${name} · ${String(Math.round(bytes.length / 1024))} KB`,
      });

      return { slot, url: `/api/branding/${slot}`, bytes: bytes.length, format: match.mime };
    },
  );

  app.delete(
    '/api/branding/:slot',
    { preHandler: requirePermission('settings.general', 'edit') },
    async (request) => {
      const params = z.object({ slot: z.enum(['logo', 'favicon']) }).safeParse(request.params);
      if (!params.success) throw notFound('Slot aset tidak dikenali');
      const { slot } = params.data;

      const row = await db().setting.findUnique({ where: { key: SLOTS[slot].key } });
      if (!row) throw notFound('Belum dimuat naik');

      await db().setting.delete({ where: { key: SLOTS[slot].key } });
      await removeUnreferenced(directory, row.value);

      await recordActivity({
        request,
        action: 'branding.remove',
        category: 'settings',
        detail: SLOTS[slot].label,
      });

      return { ok: true };
    },
  );
}

/**
 * Deletes a file that no setting points at any more.
 *
 * Checked against the rows rather than assumed, because both slots share one directory
 * and an operator who uploaded the same file to both would otherwise have it deleted out
 * from under the other one.
 */
async function removeUnreferenced(directory: string, stored: unknown): Promise<void> {
  if (typeof stored !== 'string' || stored.length === 0) return;

  const rows = await db().setting.findMany({
    where: { key: { in: [SLOTS.logo.key, SLOTS.favicon.key] } },
  });
  if (rows.some((row) => row.value === stored)) return;

  const target = join(directory, stored);
  if (!target.startsWith(directory)) return;
  await unlink(target).catch(() => undefined);
}

/** What the settings screen shows without disclosing the path on disk. */
export async function brandingStatus(): Promise<{
  logo: { set: boolean; url: string | null; bytes: number | null };
  favicon: { set: boolean; url: string | null; bytes: number | null };
}> {
  const env = loadEnv();
  const directory = resolve(process.cwd(), env.STORAGE_DIR, 'branding');

  const rows = await db().setting.findMany({
    where: { key: { in: [SLOTS.logo.key, SLOTS.favicon.key] } },
  });
  const byKey = new Map(rows.map((row) => [row.key, row.value]));

  const describe = async (slot: Slot): Promise<{ set: boolean; url: string | null; bytes: number | null }> => {
    const stored = byKey.get(SLOTS[slot].key);
    if (typeof stored !== 'string' || stored.length === 0) {
      return { set: false, url: null, bytes: null };
    }
    const info = await stat(join(directory, stored)).catch(() => null);
    // A row without a file is reported as absent rather than as configured: the screen
    // would otherwise show a broken image and no explanation.
    if (!info) return { set: false, url: null, bytes: null };

    // The mtime is in the query string so replacing the file wins over any cache.
    return {
      set: true,
      url: `/api/branding/${slot}?v=${String(info.mtimeMs)}`,
      bytes: info.size,
    };
  };

  return { logo: await describe('logo'), favicon: await describe('favicon') };
}

/** Files in the branding directory that no row references, for the health panel. */
export async function orphanedBrandingFiles(): Promise<number> {
  const env = loadEnv();
  const directory = resolve(process.cwd(), env.STORAGE_DIR, 'branding');

  const names = await readdir(directory).catch(() => [] as string[]);
  if (names.length === 0) return 0;

  const rows = await db().setting.findMany({
    where: { key: { in: [SLOTS.logo.key, SLOTS.favicon.key] } },
  });
  const referenced = new Set(rows.map((row) => String(row.value)));

  return names.filter((name) => !referenced.has(name)).length;
}
