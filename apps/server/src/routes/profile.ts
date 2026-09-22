import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { SESSION_COOKIE, requireAuth } from '../auth/plugin.js';
import { hashPassword, verifyPassword } from '../auth/service.js';
import { hashSessionToken } from '../crypto.js';
import { db, jsonSafe } from '../db.js';
import { loadEnv } from '../env.js';
import { conflict, notFound, parseBody, unauthorized } from '../http.js';
import { recordActivity } from '../logging/activity.js';
import { assertPasswordAcceptable } from '../security/policy.js';

/**
 * A person's own record.
 *
 * Reached with a session and no screen permission, because the subject is the caller.
 * Everything here reads and writes exactly one staff row — the one the session is bound
 * to — and the row id is never taken from the request.
 *
 * The interesting part of this file is the line between what somebody owns and what the
 * organisation owns:
 *
 * Owned by the person — phone, home address, job title as they'd write it, avatar,
 * password. Nothing downstream computes against these.
 *
 * Owned by HR, and read-only here — employee number, full name, department, location,
 * hire date, account email. The employee number is the join key to every terminal and
 * every attendance row. The department drives payroll subtotals, so somebody retyping
 * their own would move money between cost centres with no approval anywhere. And the name
 * is what appears on the payslip.
 *
 * Making those editable would be the single easiest way to corrupt payroll from a screen
 * that looks like it only changes a phone number.
 */

/** Image formats accepted for an avatar, identified by their leading bytes. */
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
];

const MAX_BYTES = 512 * 1024;

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  const env = loadEnv();
  const directory = resolve(process.cwd(), env.STORAGE_DIR, 'avatars');

  app.get('/api/profile', { preHandler: requireAuth }, async (request) => {
    if (!request.user) throw unauthorized();

    const account = await db().userAccount.findUnique({
      where: { id: request.user.accountId },
      include: {
        role: { select: { name: true } },
        staff: { include: { department: { select: { name: true } }, location: { select: { name: true } } } },
      },
    });
    if (!account) throw notFound('Akaun tidak dijumpai');

    const staff = account.staff;
    const photo = await avatarStatus(directory, staff.photoPath);

    return jsonSafe({
      /** Editable by the person this record belongs to. */
      editable: {
        phone: staff.phone ?? '',
        position: staff.position ?? '',
        addressLine1: staff.addressLine1 ?? '',
        addressLine2: staff.addressLine2 ?? '',
        city: staff.city ?? '',
        state: staff.state ?? '',
        postcode: staff.postcode ?? '',
        country: staff.country ?? '',
        contactEmail: staff.email ?? '',
      },
      /**
       * Shown, not editable. Named `managed` rather than `readOnly` because the point is
       * who owns it, not what the input attribute is.
       */
      managed: {
        employeeNo: staff.employeeNo,
        fullName: staff.fullName,
        icNo: staff.icNo,
        department: staff.department?.name ?? null,
        location: staff.location?.name ?? null,
        hireDate: staff.hireDate,
        /**
         * Their own wage, so no `salary` grant is needed to read it.
         *
         * That action exists to stop a clerk reading a colleague's pay; the subject here is
         * the caller, which is the whole reason this file has no screen permission at all.
         * Writing it is refused by the strict schema below, along with every other HR field.
         */
        basicSalary: staff.basicSalary === null ? null : Number(staff.basicSalary),
        loginEmail: account.email,
        accountType: account.accountType,
        roleName: account.role.name,
        lastLoginAt: account.lastLoginAt,
        twoFactorEnabled: account.totpConfirmedAt !== null,
        /** Terminal credential counts. Not the avatar, and the screen says so. */
        biometrics: { face: staff.numOfFace, fingerprint: staff.numOfFp, card: staff.numOfCard },
      },
      photo,
      language: await languageChoice(account.locale),
      /** So the form can state the rule before somebody trips it. */
      limits: { maxPhotoBytes: MAX_BYTES, passwordMinLength: (await policyMinimum()) },
    });
  });

  app.put('/api/profile', { preHandler: requireAuth }, async (request) => {
    if (!request.user) throw unauthorized();

    /**
     * Strict, not stripping.
     *
     * A plain `z.object` silently discards unknown keys, which would be safe — the field
     * could not be written — but invisible. An attempt to send `employeeNo` or
     * `departmentId` through here is somebody probing the boundary, and it should fail
     * with a message naming the key rather than returning 200 and quietly ignoring it.
     */
    const body = parseBody(
      z.strictObject({
        phone: z.string().trim().max(20),
        position: z.string().trim().max(120),
        addressLine1: z.string().trim().max(190),
        addressLine2: z.string().trim().max(190),
        city: z.string().trim().max(120),
        state: z.string().trim().max(120),
        postcode: z.string().trim().max(12),
        country: z.string().trim().max(120),
        /** Personal contact address. Separate from the login, which HR controls. */
        contactEmail: z.union([z.literal(''), z.email('Emel tidak sah')]),
        /**
         * Optional, unlike every field above it.
         *
         * The others are the nine staff columns this screen has always owned, and the form
         * sends all of them together. This one lives on the account rather than the staff
         * row, and it arrived later — leaving it optional means an older client, and the
         * verification script, can still send the original nine without a 400.
         *
         * Empty string means "follow the deployment default", which is why it is not simply
         * an optional code: absent means "do not touch my choice" and `''` means "clear it".
         * Those are different instructions and a single `undefined` cannot carry both.
         */
        locale: z.union([z.literal(''), z.string().trim().max(8)]).optional(),
      }),
      request.body,
    );

    const blank = (value: string): string | null => (value.length === 0 ? null : value);

    /*
     * A language must be one that is currently on offer.
     *
     * Refused rather than accepted-and-ignored: a code that silently does nothing leaves
     * the screen showing a choice the interface is not honouring, and the person reads that
     * as the translation being broken rather than as the language not being available.
     */
    if (body.locale !== undefined && body.locale.length > 0) {
      const offered = await db().translationLocale.findFirst({
        where: { code: body.locale, active: true },
        select: { code: true },
      });
      if (!offered) {
        throw conflict(
          `Bahasa "${body.locale}" tidak ditawarkan. Pilih satu daripada senarai, atau ` +
            'ikut bahasa lalai.',
        );
      }
    }

    /** Read before the write, so the audit line can say what the language changed from. */
    const before =
      body.locale === undefined
        ? null
        : await db().userAccount.findUnique({
            where: { id: request.user.accountId },
            select: { locale: true },
          });

    /*
     * Two tables, one transaction.
     *
     * The staff details and the language are a single action as far as the person pressing
     * save is concerned. Writing them separately means a failure between the two leaves the
     * screen reporting an error over a save that half happened — and the half that landed
     * would be the one nobody was looking at.
     */
    const staffId = request.user.staffId;
    const accountId = request.user.accountId;
    const chosen = body.locale;

    await db().$transaction(async (tx) => {
      await tx.staff.update({
        where: { id: staffId },
        data: {
          phone: blank(body.phone),
          position: blank(body.position),
          addressLine1: blank(body.addressLine1),
          addressLine2: blank(body.addressLine2),
          city: blank(body.city),
          state: blank(body.state),
          postcode: blank(body.postcode),
          country: blank(body.country),
          email: blank(body.contactEmail),
        },
      });

      // Absent means "leave my choice alone", so the column is only touched when a value
      // actually arrived. `''` is a value: it clears the choice back to the default.
      if (chosen !== undefined) {
        await tx.userAccount.update({ where: { id: accountId }, data: { locale: blank(chosen) } });
      }
    });

    const languageChanged =
      body.locale !== undefined && (before?.locale ?? '') !== body.locale;

    await recordActivity({
      request,
      action: 'profile.update',
      category: 'users',
      detail: languageChanged
        ? `butiran sendiri dikemas kini · bahasa: ${body.locale === '' ? 'ikut lalai' : body.locale}`
        : 'butiran sendiri dikemas kini',
    });

    return { ok: true };
  });

  /**
   * Changes the caller's own password.
   *
   * Separate from `PATCH /api/users/:id`, which an administrator uses and which does not
   * ask for the current password. Here it is required: a session left open on an unlocked
   * machine must not be enough to lock the owner out of their own account.
   */
  app.post('/api/profile/password', { preHandler: requireAuth }, async (request) => {
    if (!request.user) throw unauthorized();

    const body = parseBody(
      z.object({
        currentPassword: z.string().min(1, 'Kata laluan semasa diperlukan'),
        newPassword: z.string().min(1, 'Kata laluan baharu diperlukan'),
      }),
      request.body,
    );

    const account = await db().userAccount.findUnique({ where: { id: request.user.accountId } });
    if (!account?.passwordHash) throw conflict('Akaun ini tiada kata laluan untuk ditukar.');

    if (!(await verifyPassword(account.passwordHash, body.currentPassword))) {
      // Logged, because a run of these against one account is somebody guessing.
      await recordActivity({
        request,
        action: 'profile.password_failed',
        category: 'auth',
        level: 'warn',
        detail: 'kata laluan semasa tidak betul',
      });
      throw conflict('Kata laluan semasa tidak betul.');
    }

    if (body.newPassword === body.currentPassword) {
      throw conflict('Kata laluan baharu sama dengan yang semasa.');
    }

    // The same floor the administrator path enforces, read from the Security policy.
    await assertPasswordAcceptable(body.newPassword);

    const token = request.cookies[SESSION_COOKIE];

    await db().$transaction([
      db().userAccount.update({
        where: { id: request.user.accountId },
        data: {
          passwordHash: await hashPassword(body.newPassword),
          // A change of password is the intervention a lockout was waiting for.
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      /**
       * Every other session ends; this one survives.
       *
       * Revoking all of them would sign the person out mid-action as a result of their own
       * successful change, which reads as the change having failed. The point of revoking
       * the rest is that a session opened with the old password — which is the one a leak
       * would be using — stops working.
       */
      db().session.updateMany({
        where: {
          accountId: request.user.accountId,
          revokedAt: null,
          ...(token === undefined ? {} : { tokenHash: { not: hashSessionToken(token) } }),
        },
        data: { revokedAt: new Date() },
      }),
    ]);

    await recordActivity({
      request,
      action: 'profile.password_change',
      category: 'auth',
      level: 'warn',
      detail: 'kata laluan sendiri ditukar · sesi lain dibatalkan',
    });

    return {
      ok: true,
      note: 'Kata laluan ditukar. Setiap peranti lain yang log masuk dengan kata laluan lama telah dikeluarkan.',
    };
  });

  /**
   * Serves an avatar.
   *
   * Requires a session but no permission: the images are of colleagues, and every screen
   * that lists people would otherwise need to negotiate for them. The id comes from the
   * path, so the file it names is resolved from that person's own row and never from a
   * string in the request.
   */
  app.get('/api/profile/photo/:staffId', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ staffId: z.coerce.number().int().positive() }).safeParse(request.params);
    if (!params.success) throw notFound('Foto tidak dijumpai');

    const staff = await db().staff.findUnique({
      where: { id: params.data.staffId },
      select: { photoPath: true },
    });
    const stored = staff?.photoPath ?? '';
    if (stored.length === 0) throw notFound('Tiada foto');

    const target = join(directory, stored);
    if (!target.startsWith(directory)) throw notFound('Foto tidak dijumpai');

    const info = await stat(target).catch(() => null);
    if (!info) throw notFound('Fail foto hilang dari cakera');

    const match = SIGNATURES.find((entry) => entry.ext === extname(stored).toLowerCase());
    reply.header('content-type', match?.mime ?? 'application/octet-stream');
    reply.header('content-length', String(info.size));
    reply.header('cache-control', 'private, max-age=60');
    return reply.send(createReadStream(target));
  });

  app.post('/api/profile/photo', { preHandler: requireAuth }, async (request) => {
    if (!request.user) throw unauthorized();

    const part = await request.file({ limits: { fileSize: MAX_BYTES, files: 1 } });
    if (!part) throw conflict('Tiada fail dihantar.');

    const bytes = await part.toBuffer().catch(() => null);
    if (bytes === null || bytes.length > MAX_BYTES) {
      throw conflict(`Fail melebihi ${String(MAX_BYTES / 1024)} KB.`);
    }
    if (bytes.length === 0) throw conflict('Fail kosong.');

    // Decided from the bytes. The declared type and the filename are both strings the
    // client chose, and SVG is refused for the same reason as the organisation logo: it is
    // an XML document that can carry a script, served from this origin.
    const match = SIGNATURES.find((entry) => entry.test(bytes));
    if (!match) {
      throw conflict(
        'Fail itu bukan PNG, JPEG atau WEBP. SVG tidak diterima — ia dokumen XML yang boleh ' +
          'membawa skrip, dan ia akan dihidangkan dari origin yang sama dengan aplikasi ini.',
      );
    }

    await mkdir(directory, { recursive: true });

    const name = `staff-${String(request.user.staffId)}-${String(Date.now())}${match.ext}`;
    await writeFile(join(directory, name), bytes);

    const previous = await db().staff.findUnique({
      where: { id: request.user.staffId },
      select: { photoPath: true },
    });

    await db().staff.update({
      where: { id: request.user.staffId },
      data: { photoPath: name },
    });

    // Removed after the row points elsewhere, so a failed write never leaves the column
    // naming a file that is already gone.
    if (previous?.photoPath && previous.photoPath !== name) {
      await unlink(join(directory, previous.photoPath)).catch(() => undefined);
    }

    await recordActivity({
      request,
      action: 'profile.photo',
      category: 'users',
      detail: `${name} · ${String(Math.round(bytes.length / 1024))} KB`,
    });

    return {
      url: `/api/profile/photo/${String(request.user.staffId)}?v=${String(Date.now())}`,
      bytes: bytes.length,
      format: match.mime,
    };
  });

  app.delete('/api/profile/photo', { preHandler: requireAuth }, async (request) => {
    if (!request.user) throw unauthorized();

    const staff = await db().staff.findUnique({
      where: { id: request.user.staffId },
      select: { photoPath: true },
    });
    if (!staff?.photoPath) throw notFound('Tiada foto');

    await db().staff.update({ where: { id: request.user.staffId }, data: { photoPath: null } });
    await unlink(join(directory, staff.photoPath)).catch(() => undefined);

    await recordActivity({
      request,
      action: 'profile.photo_remove',
      category: 'users',
      detail: 'foto profil dibuang',
    });

    return { ok: true };
  });
}

async function avatarStatus(
  directory: string,
  stored: string | null,
): Promise<{ set: boolean; url: string | null; bytes: number | null }> {
  if (stored === null || stored.length === 0) return { set: false, url: null, bytes: null };

  const info = await stat(join(directory, stored)).catch(() => null);
  // A row without a file reads as absent rather than as a broken image with no explanation.
  if (!info) return { set: false, url: null, bytes: null };

  const id = /^staff-(\d+)-/.exec(stored)?.[1];
  return {
    set: true,
    url: id === undefined ? null : `/api/profile/photo/${id}?v=${String(info.mtimeMs)}`,
    bytes: info.size,
  };
}

/** The minimum the Security policy currently enforces, so the form can state it. */
async function policyMinimum(): Promise<number> {
  const { securityPolicy } = await import('../security/policy.js');
  return (await securityPolicy()).passwordMinLength;
}

/**
 * The languages this person may pick from, and which one is in force.
 *
 * Served from here rather than from `/api/translations`, which is gated on
 * `settings.translation:view`. That gate is right for the screen that edits the
 * translations and wrong for a picker: choosing which language you read is not an
 * administrative act, and five thousand staff hold no settings permission at all.
 *
 * Only active languages are offered. An unfinished one in this list is an invitation to a
 * screen that is half Malay and half something else, which is the whole reason `active`
 * exists.
 */
async function languageChoice(stored: string | null): Promise<{
  chosen: string;
  fallback: { code: string; name: string } | null;
  options: { code: string; name: string; isSource: boolean }[];
}> {
  const [locales, fallback] = await Promise.all([
    db().translationLocale.findMany({
      where: { active: true },
      orderBy: [{ isSource: 'desc' }, { name: 'asc' }],
      select: { code: true, name: true, isSource: true },
    }),
    db().translationLocale.findFirst({
      where: { isDefault: true, active: true },
      select: { code: true, name: true },
    }),
  ]);

  /*
   * A stored code that is no longer offered reports as "follow the default".
   *
   * That is what the person is actually seeing — the session resolver falls back for the
   * same reason — and the select has to agree with the screen around it. Showing a language
   * as selected while the interface renders in another one is worse than showing the
   * fallback, because it makes the translation look broken rather than the choice look
   * unavailable. Saving from this state clears the dead code, which is the right repair.
   */
  const chosen =
    stored !== null && locales.some((locale) => locale.code === stored) ? stored : '';

  return { chosen, fallback, options: locales };
}
