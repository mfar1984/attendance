/**
 * One-off: emit SQL that refreshes the stored Super Admin role from the permission registry.
 *
 * The registry is code; the grant is a JSON column written once at seed. Adding screens
 * therefore leaves the role row behind, and the new screens stay invisible to the very
 * account meant to hold all of them.
 *
 * SQL rather than Prisma because the dev database authenticates with caching_sha2_password
 * and the adapter refuses the key exchange from a standalone process. The `mysql` client
 * already works, so this writes a statement for it instead of adding connection flags that
 * would only exist to serve this script.
 *
 * Super Admin is defined as full access, so a full overwrite is correct here. Read-only
 * screens stay read-only on their own — they declare no write action, so there is none to
 * grant. Every other role is untouched: those grants are decisions somebody made.
 */
import { writeFileSync } from 'node:fs';

import {
  fullPermissions,
  totalPermissionCount,
  PERMISSION_SECTIONS,
} from '../apps/server/src/auth/permissions.js';

const next = fullPermissions();
const json = JSON.stringify(next);

if (json.includes("'") || json.includes('\\')) {
  throw new Error('Kunci atau tindakan mengandungi aksara yang perlu di-escape — semak registry');
}

const out = new URL('./sync-super-admin.sql', import.meta.url);
writeFileSync(out, `UPDATE roles SET permissions = '${json}' WHERE name = 'Super Admin';\n`);

const hrSections = PERMISSION_SECTIONS.filter((section) => section.key.startsWith('hr.'));

console.log(`Skrin dalam registry: ${Object.keys(next).length}`);
console.log(`Jumlah kotak semak:   ${totalPermissionCount()}`);
for (const section of hrSections) {
  console.log(`  ${section.key} → ${section.screens.map((screen) => screen.key).join(', ')}`);
}
