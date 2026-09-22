import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth, requirePermission } from '../auth/plugin.js';
import { db, jsonSafe } from '../db.js';
import { conflict, notFound, parseBody, unauthorized } from '../http.js';
import { recordActivity } from '../logging/activity.js';
import { LABEL_GROUPS, labelEntries } from '@attendance/shared';

/**
 * Interface wording.
 *
 * Two things are stored: the languages on offer, and the operator's wording for each label
 * in each of them. The Malay source is not stored as a translation of itself — see the
 * schema comment on `TranslationLocale.isSource`.
 */

/** The source language, created on first read so the list is never empty. */
const SOURCE = { code: 'ms', name: 'Bahasa Melayu' };

export async function translationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Registers the code registry into the database, assigning ids.
   *
   * Idempotent, and run on read rather than in the seed so a label added in code appears
   * without anybody remembering to re-seed. Ids come from the autoincrement, so they are
   * assigned once per key and survive every later change to this list.
   */
  async function sync(): Promise<void> {
    const registry = labelEntries();
    const existing = await db().translationLabel.findMany({
      select: { id: true, key: true, sourceText: true, retiredAt: true },
    });
    const byKey = new Map(existing.map((row) => [row.key, row]));
    const inCode = new Set(registry.map((label) => label.key));

    /**
     * Inserted in registry order in one batch, so the numbers a reader sees follow the order
     * the labels are written in the registry rather than whatever order the rows happen to
     * come back in. `createMany` keeps that order and skips keys already present.
     */
    const missing = registry.filter((label) => !byKey.has(label.key));
    if (missing.length > 0) {
      await db().translationLabel.createMany({ data: missing, skipDuplicates: true });
    }

    for (const label of registry) {
      const row = byKey.get(label.key);
      if (row === undefined) continue;

      // The Malay wording may have been corrected in the registry. Updated so the screen
      // shows what the label says now, and un-retired if the key came back.
      if (row.sourceText !== label.sourceText || row.retiredAt !== null) {
        await db().translationLabel.update({
          where: { id: row.id },
          data: { groupKey: label.groupKey, sourceText: label.sourceText, retiredAt: null },
        });
      }
    }

    /**
     * A key that has left the code is marked, not deleted.
     *
     * Its id may already have been written down, and deleting the row would take the
     * translations somebody wrote with it — which is exactly what you want back if the
     * label returns.
     */
    const gone = existing.filter((row) => !inCode.has(row.key) && row.retiredAt === null);
    if (gone.length > 0) {
      await db().translationLabel.updateMany({
        where: { id: { in: gone.map((row) => row.id) } },
        data: { retiredAt: new Date() },
      });
    }
  }

  /**
   * Creates the source language if it is missing, and makes sure exactly one default
   * exists.
   *
   * There is always a default, because "no default" would mean the interface has no
   * language to open in and every screen would have to invent a fallback of its own. When
   * none is set the source language takes it: that is what the interface is written in.
   */
  async function ensureSource(): Promise<void> {
    await db().translationLocale.upsert({
      where: { code: SOURCE.code },
      create: { ...SOURCE, isSource: true, active: true, isDefault: true },
      update: { isSource: true, active: true },
    });

    const defaults = await db().translationLocale.count({ where: { isDefault: true } });
    if (defaults === 1) return;

    // Either none is set, or an old row left more than one. Both are repaired by handing
    // it to the source, which is the only language guaranteed to be complete.
    await db().translationLocale.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    await db().translationLocale.update({ where: { code: SOURCE.code }, data: { isDefault: true } });
  }

  /** Moves the default, clearing the previous holder in the same transaction. */
  async function setDefault(code: string): Promise<void> {
    await db().$transaction([
      db().translationLocale.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
      db().translationLocale.update({ where: { code }, data: { isDefault: true } }),
    ]);
  }

  // -------------------------------------------------------------------------
  // Languages
  // -------------------------------------------------------------------------

  app.get(
    '/api/translations',
    { preHandler: requirePermission('settings.translation', 'view') },
    async () => {
      await ensureSource();
      await sync();

      const [locales, labelCount, valueCounts] = await Promise.all([
        db().translationLocale.findMany({ orderBy: [{ isSource: 'desc' }, { name: 'asc' }] }),
        db().translationLabel.count({ where: { retiredAt: null } }),
        /*
         * Counted against live labels only, matching `labelCount` above.
         *
         * Without the filter this counts translations attached to labels that have since been retired.
         * A retired label is never rendered, so those rows are not coverage — and the screen read
         * `4130 / 4112` with a bar past its own end once a rework retired eighteen keys that already
         * had English. Both sides of the fraction have to be the same population.
         */
        db().translationValue.groupBy({
          by: ['locale'],
          where: { label: { retiredAt: null } },
          _count: { _all: true },
        }),
      ]);

      const translated = new Map(valueCounts.map((row) => [row.locale, row._count._all]));

      return jsonSafe({
        /** Total labels a language has to cover. */
        labelCount,
        locales: locales.map((locale) => ({
          code: locale.code,
          name: locale.name,
          isSource: locale.isSource,
          active: locale.active,
          isDefault: locale.isDefault,
          /**
           * The source language is complete by definition — its wording *is* the label.
           * Reporting it as 0 of N translated would be reporting a job that does not exist.
           */
          translated: locale.isSource ? labelCount : (translated.get(locale.code) ?? 0),
          createdAt: locale.createdAt,
        })),
      });
    },
  );

  const localeSchema = z.object({
    // Short and restricted: it becomes part of a URL and a database key.
    code: z
      .string()
      .trim()
      .min(2)
      .max(8)
      .regex(/^[a-z]{2}(-[A-Za-z]{2,4})?$/, 'Kod bahasa mesti seperti "en" atau "zh-Hans"'),
    name: z.string().trim().min(1).max(64),
  });

  app.post(
    '/api/translations/locales',
    { preHandler: requirePermission('settings.translation', 'edit') },
    async (request) => {
      const body = parseBody(localeSchema, request.body);

      const clash = await db().translationLocale.findUnique({ where: { code: body.code } });
      if (clash) throw conflict(`Bahasa dengan kod "${body.code}" sudah ada.`);

      // Added switched off. Nothing has been translated yet, so offering it would show a
      // screen that is half one language and half another.
      const row = await db().translationLocale.create({
        data: { code: body.code, name: body.name, isSource: false, active: false },
      });

      await recordActivity({
        request,
        action: 'translation.locale_create',
        category: 'settings',
        detail: `${row.name} (${row.code})`,
      });

      return jsonSafe({ code: row.code, name: row.name });
    },
  );

  app.patch(
    '/api/translations/locales/:code',
    { preHandler: requirePermission('settings.translation', 'edit') },
    async (request) => {
      const params = z.object({ code: z.string().trim().max(8) }).safeParse(request.params);
      if (!params.success) throw notFound('Bahasa tidak dijumpai');

      const body = parseBody(
        z.strictObject({
          name: z.string().trim().min(1).max(64).optional(),
          active: z.boolean().optional(),
          /** Only ever `true`. Clearing it would leave no default at all. */
          isDefault: z.literal(true).optional(),
        }),
        request.body,
      );

      const existing = await db().translationLocale.findUnique({ where: { code: params.data.code } });
      if (!existing) throw notFound('Bahasa tidak dijumpai');

      // The source language is always on. Switching it off would leave the interface with
      // no language at all.
      if (existing.isSource && body.active === false) {
        throw conflict('Bahasa sumber tidak boleh dimatikan — ia bahasa asal antara muka.');
      }

      /**
       * The default cannot be switched off directly.
       *
       * Turning off the language the interface opens in would leave every screen without a
       * language. Move the default elsewhere first, and this row stops being it as a
       * consequence.
       */
      if (existing.isDefault && body.active === false) {
        throw conflict(
          'Ini bahasa lalai. Jadikan bahasa lain sebagai lalai dahulu, kemudian barulah ' +
            'yang ini boleh dimatikan.',
        );
      }

      if (body.isDefault === true && !existing.isDefault) {
        /**
         * Only an active language may be the default.
         *
         * The default is what the interface opens in for everybody. Pointing it at a
         * language nobody has finished shows the same half-and-half screen that `active`
         * exists to prevent, except to every user rather than to whoever chose it.
         */
        const willBeActive = body.active ?? existing.active;
        if (!willBeActive) {
          throw conflict(
            `${existing.name} tidak aktif. Hidupkannya dahulu — bahasa lalai adalah yang ` +
              'dibuka oleh setiap pengguna, jadi ia tidak boleh menunjuk ke bahasa yang belum ditawarkan.',
          );
        }
      }

      const row = await db().translationLocale.update({
        where: { code: params.data.code },
        data: {
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.active === undefined ? {} : { active: body.active }),
        },
      });

      // After the update, so the activation above counts towards the check.
      if (body.isDefault === true) await setDefault(params.data.code);

      await recordActivity({
        request,
        action: 'translation.locale_update',
        category: 'settings',
        // A change of default is what everybody sees, so it is not routine.
        level: body.isDefault === true ? 'warn' : 'info',
        detail:
          `${row.name} (${row.code}) · ` +
          (body.isDefault === true
            ? 'dijadikan bahasa lalai'
            : body.active === undefined
              ? 'nama ditukar'
              : row.active
                ? 'dihidupkan'
                : 'dimatikan'),
      });

      return jsonSafe({ ok: true });
    },
  );

  app.delete(
    '/api/translations/locales/:code',
    { preHandler: requirePermission('settings.translation', 'edit') },
    async (request) => {
      const params = z.object({ code: z.string().trim().max(8) }).safeParse(request.params);
      if (!params.success) throw notFound('Bahasa tidak dijumpai');

      const existing = await db().translationLocale.findUnique({ where: { code: params.data.code } });
      if (!existing) throw notFound('Bahasa tidak dijumpai');
      if (existing.isSource) {
        throw conflict('Bahasa sumber tidak boleh dibuang — label ditulis dalam bahasa ini.');
      }

      /**
       * Refused rather than quietly handing the default back to the source.
       *
       * A silent fallback would change what every user opens the application in as a side
       * effect of deleting something, and nobody would connect the two. The source language
       * can never be deleted, so there is always a valid language to move it to first.
       */
      if (existing.isDefault) {
        throw conflict(
          'Ini bahasa lalai. Jadikan bahasa lain sebagai lalai dahulu — jika tidak, membuang ' +
            'yang ini akan menukar bahasa yang setiap pengguna buka tanpa sesiapa memilihnya.',
        );
      }

      const written = await db().translationValue.count({ where: { locale: params.data.code } });

      await db().translationValue.deleteMany({ where: { locale: params.data.code } });
      await db().translationLocale.delete({ where: { code: params.data.code } });

      await recordActivity({
        request,
        action: 'translation.locale_delete',
        category: 'settings',
        // Stated as a count, because this is the number somebody loses.
        level: written > 0 ? 'warn' : 'info',
        detail: `${existing.name} (${existing.code}) · ${String(written)} terjemahan dibuang`,
      });

      return jsonSafe({ ok: true, removed: written });
    },
  );

  // -------------------------------------------------------------------------
  // Dictionary
  // -------------------------------------------------------------------------

  /**
   * Every label, keyed for rendering.
   *
   * Needs a session but no permission: this is the text of the interface, and every screen
   * draws from it. Gating it behind the translation permission would mean a clerk sees a
   * different language from an administrator.
   *
   * The id travels with each entry because the interface can be asked to stamp the numbers
   * onto itself — that is how somebody finds which string `#1` refers to without hunting
   * through screens.
   */
  app.get('/api/translations/dictionary', { preHandler: requireAuth }, async (request) => {
    const query = z
      .object({ locale: z.string().trim().max(8).optional() })
      .safeParse(request.query);

    await ensureSource();
    await sync();

    const wanted = query.success ? query.data.locale : undefined;
    const locale =
      (wanted === undefined
        ? null
        : await db().translationLocale.findUnique({ where: { code: wanted } })) ??
      (await db().translationLocale.findFirst({ where: { isDefault: true } }));

    const [labels, values] = await Promise.all([
      db().translationLabel.findMany({
        where: { retiredAt: null },
        select: { id: true, key: true, sourceText: true },
      }),
      locale === null || locale.isSource
        ? Promise.resolve([])
        : db().translationValue.findMany({ where: { locale: locale.code } }),
    ]);

    const byLabel = new Map(values.map((row) => [row.labelId, row.text]));

    return jsonSafe({
      locale: locale?.code ?? SOURCE.code,
      isSource: locale?.isSource ?? true,
      entries: Object.fromEntries(
        labels.map((label) => [
          label.key,
          {
            id: label.id,
            // The translation where there is one, the Malay source otherwise. A missing
            // translation must not render as an empty string.
            text: byLabel.get(label.id) ?? label.sourceText,
            /** So a screen can show that this string is still the untranslated source. */
            translated: byLabel.has(label.id),
          },
        ]),
      ),
    });
  });

  // -------------------------------------------------------------------------
  // Labels
  // -------------------------------------------------------------------------

  app.get(
    '/api/translations/:code/labels',
    { preHandler: requirePermission('settings.translation', 'view') },
    async (request) => {
      const params = z.object({ code: z.string().trim().max(8) }).safeParse(request.params);
      if (!params.success) throw notFound('Bahasa tidak dijumpai');

      await sync();

      const locale = await db().translationLocale.findUnique({ where: { code: params.data.code } });
      if (!locale) throw notFound('Bahasa tidak dijumpai');

      const [labels, values] = await Promise.all([
        db().translationLabel.findMany({
          where: { retiredAt: null },
          orderBy: { id: 'asc' },
        }),
        db().translationValue.findMany({ where: { locale: locale.code } }),
      ]);

      const byLabel = new Map(values.map((row) => [row.labelId, row.text]));

      return jsonSafe({
        locale: {
          code: locale.code,
          name: locale.name,
          isSource: locale.isSource,
          active: locale.active,
          isDefault: locale.isDefault,
        },
        groups: LABEL_GROUPS,
        labels: labels.map((label) => ({
          /** The number an operator can write down. */
          id: label.id,
          key: label.key,
          groupKey: label.groupKey,
          /** The Malay wording, shown on the left of every row. */
          sourceText: label.sourceText,
          context: label.context,
          /** Empty means "not translated"; the source is used. */
          text: byLabel.get(label.id) ?? '',
        })),
      });
    },
  );

  app.put(
    '/api/translations/:code/labels',
    { preHandler: requirePermission('settings.translation', 'edit') },
    async (request) => {
      if (!request.user) throw unauthorized();

      const params = z.object({ code: z.string().trim().max(8) }).safeParse(request.params);
      if (!params.success) throw notFound('Bahasa tidak dijumpai');

      const body = parseBody(
        z.strictObject({
          values: z
            .array(z.strictObject({ id: z.number().int().positive(), text: z.string().max(2000) }))
            .max(2000),
        }),
        request.body,
      );

      const locale = await db().translationLocale.findUnique({ where: { code: params.data.code } });
      if (!locale) throw notFound('Bahasa tidak dijumpai');
      if (locale.isSource) {
        // The source wording lives in the code. Accepting an edit here would create a
        // second place it is defined, and the stored copy would then win over any later
        // correction made in the source.
        throw conflict(
          'Bahasa sumber tidak boleh disunting di sini — perkataannya datang dari kod aplikasi.',
        );
      }

      const known = new Set(
        (await db().translationLabel.findMany({ where: { retiredAt: null }, select: { id: true } })).map(
          (row) => row.id,
        ),
      );
      const unknown = body.values.filter((entry) => !known.has(entry.id)).map((entry) => entry.id);
      if (unknown.length > 0) {
        throw conflict(`Label tidak dikenali: ${unknown.join(', ')}`);
      }

      let written = 0;
      let cleared = 0;

      for (const entry of body.values) {
        const text = entry.text.trim();

        if (text.length === 0) {
          // Blank removes the row rather than storing an empty string, so "not translated"
          // has one representation and the source is used.
          const removed = await db().translationValue.deleteMany({
            where: { labelId: entry.id, locale: locale.code },
          });
          cleared += removed.count;
          continue;
        }

        await db().translationValue.upsert({
          where: { labelId_locale: { labelId: entry.id, locale: locale.code } },
          create: { labelId: entry.id, locale: locale.code, text, updatedBy: request.user.accountId },
          update: { text, updatedBy: request.user.accountId },
        });
        written += 1;
      }

      await recordActivity({
        request,
        action: 'translation.save',
        category: 'settings',
        detail: `${locale.name} (${locale.code}) · ${String(written)} disimpan · ${String(cleared)} dikosongkan`,
      });

      return jsonSafe({ ok: true, written, cleared });
    },
  );
}
