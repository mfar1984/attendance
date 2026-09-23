import { setDriverLogger } from '@attendance/terminal-drivers';
import { pino, type Logger, type LoggerOptions } from 'pino';

import { loadEnv } from './env.js';

/**
 * Shared pino configuration.
 *
 * Handed to Fastify rather than passing a pre-built instance, which keeps
 * Fastify's own `FastifyBaseLogger` typing intact across route registration.
 */
export function loggerOptions(): LoggerOptions {
  const env = loadEnv();

  return {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    /**
     * Device and session credentials pass through request bodies and config
     * objects. Redaction is declared centrally so a newly added log call cannot
     * leak them by accident.
     */
    redact: {
      paths: [
        'password',
        '*.password',
        'req.body.password',
        'passwordEncrypted',
        '*.passwordEncrypted',
        'doorPin',
        '*.doorPin',
        'totpSecret',
        '*.totpSecret',
        'req.headers.cookie',
        'req.headers.authorization',
      ],
      censor: '[redacted]',
    },
    transport:
      env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
        : undefined,
  };
}

let instance: Logger | null = null;

/** Logger for work outside a request, such as the sync worker and the seed. */
export function logger(): Logger {
  if (instance) return instance;

  instance = pino(loggerOptions());

  /**
   * Hand the same logger to the driver package.
   *
   * The drivers moved out of this application so the connector agent could run them, which cost
   * them their direct import of this file. They now take an injected logger and are silent until
   * one arrives.
   *
   * This is the hook rather than an entry point, and deliberately: there are three entries
   * already — the server, the cron one-shot, and test scripts that build the app or call
   * `syncDevice` directly — and a fourth will be added by somebody who has no reason to know
   * that a driver needs wiring. Three call sites that must agree is three that can drift, and
   * the symptom of drift here is diagnostics quietly missing rather than anything failing.
   *
   * Redaction still applies: it is configured on this instance, not at the call site.
   */
  setDriverLogger({
    info: (fields, message) => instance?.info(fields, message),
    warn: (fields, message) => instance?.warn(fields, message),
  });

  return instance;
}
