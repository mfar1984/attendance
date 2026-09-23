import { setDriverLogger } from '@attendance/terminal-drivers';
import { pino, type Logger } from 'pino';

import { loadConfig } from './config.js';

let instance: Logger | null = null;

/**
 * The connector's logger.
 *
 * Redaction mirrors the server's, and the list is not shorter here despite this process holding
 * fewer kinds of secret. It holds the two that matter most on a machine in a corridor: the
 * terminal passwords that arrive in every roster, and its own cloud credential in an
 * Authorization header. A roster logged at debug level while somebody diagnoses a site would
 * otherwise put every door credential for that site into the journal.
 */
export function logger(): Logger {
  if (instance) return instance;

  const config = loadConfig();

  instance = pino({
    level: config.LOG_LEVEL,
    base: { agent: config.version },
    redact: {
      paths: [
        'password',
        '*.password',
        'devices[*].password',
        'secret',
        '*.secret',
        'headers.authorization',
        'req.headers.authorization',
      ],
      censor: '[redacted]',
    },
  });

  // The drivers are silent until given a logger. Same wiring as the server, same reason.
  setDriverLogger({
    info: (fields, message) => instance?.info(fields, message),
    warn: (fields, message) => instance?.warn(fields, message),
  });

  return instance;
}
