import { defineConfig, env } from 'prisma/config';

/**
 * Prisma CLI configuration.
 *
 * Prisma 7 moved the connection URL out of schema.prisma. The CLI reads it from
 * here for migrations, while the running server supplies a driver adapter
 * instead of a URL.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
