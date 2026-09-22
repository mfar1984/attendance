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
  instance ??= pino(loggerOptions());
  return instance;
}
