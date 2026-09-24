import { AGENT_VERSION } from '@attendance/shared';
import { z } from 'zod';

/**
 * Connector configuration.
 *
 * Validated once at boot and allowed to fail loudly, for the same reason the server's is: a
 * connector that starts with no cloud URL and only discovers it when the first batch is ready
 * has already accepted events it cannot deliver.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),

  /** Where the cloud lives. Must be HTTPS outside development — see `assertSecureCloud`. */
  CLOUD_URL: z.string().url(),

  /**
   * Single-use token from the installer. Present on a first boot, ignored afterwards.
   *
   * Kept out of the credential file deliberately: this value reaches the machine through a
   * shell command and therefore through shell history, so it expires within the hour and is
   * worth nothing once exchanged.
   */
  ENROL_TOKEN: z.string().optional(),

  /**
   * Where the working credential and the spool live.
   *
   * Outside the clone, and not in the unit file. The credential is written here after
   * enrolment rather than handed back to whoever ran the installer, because a secret pasted
   * into a config file by hand is a secret in somebody's editor history.
   */
  STATE_DIR: z.string().default('/var/lib/attendance-agent'),

  /**
   * Address the terminals push to.
   *
   * Defaults to every interface because the connector's whole job is to be reachable by the
   * units on its LAN, and on a Raspberry Pi with one NIC the distinction is academic. Narrow
   * it where the machine has more than one.
   */
  LISTEN_HOST: z.string().default('0.0.0.0'),
  LISTEN_PORT: z.coerce.number().int().min(1).max(65535).default(8080),

  /**
   * Address reported to the cloud as where terminals should be pointed.
   *
   * Separate from `LISTEN_HOST` because `0.0.0.0` is not an address anything can be pointed at.
   * The devices screen shows this value for every terminal behind this connector, so a wrong
   * one produces a unit configured to push somewhere unreachable — which then reads as a
   * hardware fault.
   */
  LAN_HOST: z.string().optional(),

  /** Digest credentials the terminals use when posting here. Firmware caps the password at 16. */
  INGEST_USERNAME: z.string().min(1).default('hikpush'),
  INGEST_PASSWORD: z.string().min(8).max(16),

  /** Liveness and roster refresh. Also how the connector learns the cloud's clock. */
  HEARTBEAT_SECONDS: z.coerce.number().int().min(10).max(900).default(60),

  /**
   * How often to read each terminal's own settings and report them.
   *
   * Slow on purpose. These values move when somebody edits a setting, and they are large: a full
   * sweep is about a dozen reads per unit. The cloud cannot ask for them on demand — a browser
   * request cannot wait for the next poll — so the trade is freshness against load on firmware
   * that caps concurrent sessions. Ten minutes keeps the device editor populated without a
   * Raspberry Pi hammering fifteen door controllers.
   */
  SNAPSHOT_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),

  /** Reconcile pull cadence. Push is unreliable, so this always runs. */
  PULL_SECONDS: z.coerce.number().int().min(15).max(3600).default(60),

  /** How often to ask for queued work. Enrolments feel as slow as this number. */
  COMMAND_POLL_SECONDS: z.coerce.number().int().min(5).max(300).default(15),

  /**
   * Terminals pulled at once.
   *
   * Two, not fifteen. Each pull is a paged ISAPI search at thirty records a page, so fifteen at
   * once is a repeating spike on a small machine, and one slow terminal holds the others behind
   * it. A low ceiling with devices taken in rotation keeps a busy unit from starving a quiet one.
   */
  PULL_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),

  /** Events sent per request. The cloud refuses more than 200. */
  BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(100),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type AgentConfig = z.infer<typeof schema> & {
  /** Resolved from `LAN_HOST`, falling back to `LISTEN_HOST` when it is a real address. */
  advertisedHost: string | null;
  version: string;
};

/**
 * Re-exported rather than declared here.
 *
 * It moved to `@attendance/shared` because the cloud needs the same value: it compares what a
 * connector reports against what this installation would install, which is how the update button
 * knows whether a site is behind. Two copies of a version number is one copy that disagrees, and
 * the one that disagrees decides whether somebody is told their site is out of date.
 */
export { AGENT_VERSION };

let cached: AgentConfig | null = null;

export function loadConfig(): AgentConfig {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fields = z.flattenError(parsed.error).fieldErrors;
    const lines = Object.entries(fields)
      .map(([key, messages]) => `  ${key}: ${messages?.join('; ')}`)
      .join('\n');
    throw new Error(`Konfigurasi connector tidak sah:\n${lines}`);
  }

  const data = parsed.data;

  cached = {
    ...data,
    advertisedHost: data.LAN_HOST ?? (isBindAll(data.LISTEN_HOST) ? null : data.LISTEN_HOST),
    version: AGENT_VERSION,
  };
  return cached;
}

function isBindAll(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '';
}

/**
 * Refuses a plaintext cloud URL outside development.
 *
 * Everything this connector sends is attendance for identifiable people, and everything it
 * receives includes the door credentials for its own terminals. Over plain HTTP that crosses
 * the public internet readable, and the credential in the Authorization header goes with it.
 *
 * Checked separately from the schema so development against a loopback cloud stays possible
 * without a flag that could be left switched on.
 */
export function assertSecureCloud(config: AgentConfig): void {
  const url = new URL(config.CLOUD_URL);
  if (url.protocol === 'https:') return;

  const local =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (local && config.NODE_ENV !== 'production') return;

  throw new Error(
    `CLOUD_URL mesti HTTPS. Ia sekarang "${url.protocol}//${url.host}", yang menghantar ` +
      'kredensial connector dan kehadiran setiap staf dalam bentuk jelas.',
  );
}
