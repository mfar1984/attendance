import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig, env } from 'prisma/config';

/**
 * Prisma CLI configuration.
 *
 * Prisma 7 moved the connection URL out of schema.prisma. The CLI reads it from
 * here for migrations, while the running server supplies a driver adapter
 * instead of a URL.
 *
 * ## Why this file loads `.env` itself
 *
 * The CLI does not read the repository-root `.env`, so every Prisma command used to need
 * `DATABASE_URL` exported by hand or it failed with `PrismaConfigEnvError`. That turned a
 * routine step into a two-line ritual, and it made `prisma generate` impossible to call
 * from a build script — which is how a production build once ran `tsc` against a Prisma
 * client that had never been generated, producing three hundred type errors that named
 * everything except the real cause.
 *
 * Existing variables win, so a shell that already exported a URL still overrides the file.
 */
if (process.env['DATABASE_URL'] === undefined) {
  for (const candidate of [
    // Prisma commands run from `apps/server`, so the repository root is two levels up.
    resolve(process.cwd(), '../../.env'),
    resolve(process.cwd(), '.env'),
  ]) {
    if (!existsSync(candidate)) continue;
    process.loadEnvFile(candidate);
    break;
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    /*
     * Still `env()` and not a fallback string. A missing URL must fail by name, because the
     * alternative is `db push` quietly reconciling against the wrong database.
     */
    url: env('DATABASE_URL'),
  },
});
