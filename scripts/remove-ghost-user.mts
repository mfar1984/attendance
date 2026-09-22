/**
 * Removes a terminal user that holds no credential.
 *
 * One-off cleanup for the ghost `pushStaffToDevices` left behind before it learned to reuse
 * the identifier a person already carries: the ISAPI write landed, then the database write
 * failed on `@@unique([deviceId, staffId])`, so the terminal kept a record nobody owns and
 * nobody can scan with.
 *
 * Deliberately does not import `db.js`. Building the Prisma client writes into
 * `node_modules/.prisma/client`, which `tsx watch` notices and restarts the dev server on —
 * and a one-off cleanup has no business bouncing a running server. The mapping side was
 * checked with SQL instead.
 *
 * Refuses anything holding a face, fingerprint or card. A record with a credential is
 * somebody who can scan, and deleting it takes their attendance away.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/remove-ghost-user.mts <employeeNo>
 */
import { HikvisionClient } from '@attendance/hik-isapi';

const employeeNo = process.argv[2];
if (!employeeNo) throw new Error('Guna: remove-ghost-user.mts <employeeNo>');

const client = new HikvisionClient({
  baseUrl: requireEnv('HIK_HOST'),
  username: requireEnv('HIK_USERNAME'),
  password: requireEnv('HIK_PASSWORD'),
  verifyTls: process.env['HIK_VERIFY_TLS'] === 'true',
});

let failed = false;

try {
  print('terminal', client.host);
  print('sasaran', `employeeNo ${employeeNo}`);

  const person = await client.persons.find(employeeNo);
  if (person === null) {
    print('hasil', 'ID itu sudah tiada pada terminal. Tiada apa dibuang.');
  } else {
    const credentials = (person.numOfFace ?? 0) + (person.numOfFP ?? 0) + (person.numOfCard ?? 0);
    print('nama di terminal', person.name || '(tiada nama)');
    print('kredensial', String(credentials));

    if (credentials > 0) {
      print('hasil', 'DITOLAK — ia memegang kredensial, jadi seseorang boleh scan dengannya.');
      print('tindakan', 'Petakan ia di Staf › Pemetaan ID Terminal, jangan buang.');
      failed = true;
    } else {
      await client.persons.remove([employeeNo]);
      const after = await client.persons.find(employeeNo);
      print('hasil', after === null ? 'DIBUANG' : 'GAGAL — masih ada pada terminal');
      failed = after !== null;
    }
  }
} finally {
  await client.close();
}

process.exit(failed ? 1 : 0);

function print(label: string, value: string): void {
  console.log(`  ${label.padEnd(20)} ${value}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}
