import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';

import { loadEnv, parseDatabaseUrl } from './env.js';

/**
 * Prisma client.
 *
 * Prisma 7 requires a driver adapter rather than a connection URL in the schema.
 * The MariaDB adapter speaks the MySQL protocol and is the supported path for
 * MySQL 8 on this version.
 */
let client: PrismaClient | null = null;

/**
 * Whether the database is on this machine.
 *
 * Decides one thing: whether the driver may fetch the server's RSA public key over an
 * unencrypted connection. See `db()` below for why that matters.
 */
function isLoopback(host: string): boolean {
  const lower = host.toLowerCase();
  return (
    lower === 'localhost' ||
    lower === '::1' ||
    lower === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower)
  );
}

export function db(): PrismaClient {
  if (client) return client;

  const env = loadEnv();
  const connection = parseDatabaseUrl(env.DATABASE_URL);

  /*
   * MySQL 8 defaults to `caching_sha2_password`, and that plugin has two handshake paths.
   *
   * The fast one uses a scramble against a password the *server* is holding in memory from a
   * previous successful login. The slow one has to send the password itself, so it needs either
   * TLS or the server's RSA public key to encrypt it with.
   *
   * That memory is a cache, and it is empty every time MySQL starts. So a server that has been
   * running happily for days fails on the first connection after a MySQL restart — the driver
   * needs the public key, refuses to ask for it over plaintext, and every connection dies during
   * the handshake. The pool then reports `active=0 idle=0 limit=10` and every request waits the
   * full ten seconds before returning 500, including the login route. Nothing in the Prisma error
   * says any of this; the cause is four levels down in `driverAdapterError`.
   *
   * Enabling retrieval is only safe because the connection cannot leave this machine. Asking an
   * unauthenticated server for a public key and then encrypting a password with it is exactly the
   * shape of a machine-in-the-middle attack, which is why the driver refuses by default.
   *
   * **Gated on loopback deliberately.** Pointing `DATABASE_URL` at another host makes this fail
   * again with the same message, and that is correct: the answer there is TLS, not a flag. Doing
   * it unconditionally would turn a deployment decision into a line nobody reads.
   */
  const local = isLoopback(connection.host);

  const adapter = new PrismaMariaDb({
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password,
    database: connection.database,
    connectionLimit: 10,
    allowPublicKeyRetrieval: local,
    // Attendance maths is done in minutes; returning DECIMAL as a JS number
    // avoids scattering string coercion through the engine.
    decimalAsNumber: true,
  });

  client = new PrismaClient({ adapter });
  return client;
}

export async function disconnectDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}

/**
 * Serialises BigInt for JSON responses.
 *
 * Serial numbers are BigInt because the device range overflows INT32, and
 * `JSON.stringify` throws on BigInt rather than degrading. Converting to string
 * keeps precision, which a JS number would not guarantee at the top of the range.
 */
export function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, inner) => (typeof inner === 'bigint' ? inner.toString() : inner)),
  ) as T;
}
