/**
 * Where a driver sends the two things it has to say.
 *
 * The Hikvision adapter used to import the server's pino logger directly, which is what kept
 * this whole layer inside `apps/server` and therefore unavailable to the connector agent. An
 * agent duplicating the adapter would mean two implementations of the same protocol, and the
 * one that drifts is the one talking to the terminals.
 *
 * So the logger is injected rather than imported. Both hosts call `setDriverLogger()` at boot
 * with their own; until one does, the driver is silent.
 *
 * ## Why a settable module-level value and not a constructor argument
 *
 * `new HikvisionDriver(client)` is called from the server's registry, which caches one driver
 * per device and keys the cache on a connection fingerprint. Threading a logger through that
 * would change the signature, the cache key, and every call site, to deliver a value that is
 * identical for every driver in the process. The two log lines this interface carries are
 * diagnostics, not per-device state.
 */
export interface DriverLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

/**
 * Silent by default.
 *
 * A default that wrote to the console would put driver diagnostics on stdout in a process whose
 * operator configured structured logging elsewhere, and interleaving the two makes both harder
 * to read. Silence is recoverable; a second log stream nobody asked for is not.
 */
const SILENT: DriverLogger = {
  info: () => undefined,
  warn: () => undefined,
};

let current: DriverLogger = SILENT;

export function setDriverLogger(logger: DriverLogger): void {
  current = logger;
}

export function driverLogger(): DriverLogger {
  return current;
}
