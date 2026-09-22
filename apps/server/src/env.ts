import { z } from 'zod';

/**
 * Environment validation.
 *
 * Parsed once at boot and allowed to fail loudly. A server that starts with a
 * missing encryption key and only discovers it when the first device password is
 * written has already accepted traffic it cannot serve.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /** Chosen at install: `direct` for a LAN server, `agent` for cloud. */
  CONNECTOR_MODE: z.enum(['direct', 'agent']).default('direct'),

  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),

  /**
   * Whether this process runs the background timers.
   *
   * On by default, because a LAN install is one process that owns everything. Set to
   * false where a supervisor stops the application when it goes idle — the timers die
   * with it, and a reconcile pull that silently stopped is harder to notice than one
   * that was never started. Those hosts run the work from cron instead.
   */
  RUN_WORKERS: z.stringbool().default(true),

  /**
   * 32 bytes hex. Encrypts device passwords, TOTP secrets and door PINs at rest,
   * so a database dump does not hand over door access.
   */
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),

  /**
   * Whether administrator logins must present a TOTP code.
   *
   * Defaults to on. An admin account can rewrite the attendance of thousands of
   * people, so a second factor is warranted in production. It is switchable
   * because during development it is pure friction, and friction is what leads
   * to someone hardcoding a bypass instead.
   */
  REQUIRE_ADMIN_2FA: z.stringbool().default(true),

  /** Credentials the terminal uses when posting events to us. */
  INGEST_USERNAME: z.string().min(1).default('hikpush'),
  INGEST_PASSWORD: z.string().min(8).max(16),
  INGEST_PUBLIC_URL: z.string().optional(),

  /** Seconds between reconcile pulls. Push is unreliable, so this always runs. */
  SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
  /** Drift above which a device's data is flagged as untrustworthy. */
  CLOCK_DRIFT_WARN_SECONDS: z.coerce.number().int().min(1).default(30),

  /**
   * Timezone all attendance dates are computed in.
   *
   * Independent of the server's own clock setting on purpose. A cloud server
   * running in UTC must still file a 01:00 night shift against the local work
   * date, not the previous UTC day.
   */
  ORG_TIMEZONE: z.string().default('Asia/Kuala_Lumpur'),

  /** Directory for downloaded event snapshots. */
  STORAGE_DIR: z.string().default('storage'),

  /** Directory for database dumps. Separate so it can point at another volume. */
  BACKUP_DIR: z.string().default('backups'),

  /** Built web bundle to serve. Absent in development, where Vite serves it. */
  WEB_DIST_DIR: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = z
      .flattenError(parsed.error)
      .fieldErrors;
    const lines = Object.entries(issues)
      .map(([key, messages]) => `  ${key}: ${messages?.join('; ')}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }

  cached = parsed.data;
  return cached;
}

/** Splits a MySQL URL into the parts the driver adapter needs. */
export function parseDatabaseUrl(url: string): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
  };
}
