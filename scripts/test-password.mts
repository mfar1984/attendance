/**
 * Password hashing regression.
 *
 * No server and no database needed. This covers the one change that can lock every
 * account out of the system at once, so it is worth a suite of its own:
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/test-password.mts
 */
import { hashPassword, needsRehash, verifyPassword } from '../apps/server/src/auth/password.js';

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failures += 1;
  }
}

console.log('\n=== scrypt hashes round-trip ===');

const password = 'K4ta!LaluanYangPanjang';
const hash = await hashPassword(password);

check('a hash is produced', hash.length > 0);
check('it names the function and its cost', hash.startsWith('scrypt$32768$8$1$'));
// The column is VarChar(255); a format that outgrows it truncates silently on write.
check('it fits the passwordHash column', hash.length < 255);
check('the correct password verifies', await verifyPassword(hash, password));
check('a wrong password does not', !(await verifyPassword(hash, 'K4ta!LaluanYangPanjan')));
check('an empty password does not', !(await verifyPassword(hash, '')));

/*
 * Two hashes of one password must differ, or the salt is not doing its job and identical
 * passwords become visibly identical rows.
 */
const second = await hashPassword(password);
check('the same password hashes differently each time', hash !== second);
check('and the second one still verifies', await verifyPassword(second, password));

console.log('\n=== rehash detection ===');

check('a current hash needs no rehash', !needsRehash(hash));
check('an Argon2 hash needs one', needsRehash('$argon2id$v=19$m=19456,t=2,p=1$abc$def'));
// A cost change must be detected, otherwise raising it would silently apply to new
// accounts only and the old ones would never be upgraded.
check('a hash at a different cost needs one', needsRehash('scrypt$16384$8$1$abc$def'));
check('a malformed hash needs one', needsRehash('nonsense'));

console.log('\n=== malformed stored hashes read as "wrong password" ===');

/*
 * Never as success. Each of these is a row that could exist after a bad migration, a
 * truncated write, or a tampered database, and every one of them must fail closed.
 */
for (const [label, stored] of [
  ['empty string', ''],
  ['unknown scheme', 'bcrypt$whatever'],
  ['too few fields', 'scrypt$32768$8$1$onlysalt'],
  ['non-numeric cost', 'scrypt$abc$8$1$c2FsdA==$aGFzaA=='],
  ['empty key', 'scrypt$32768$8$1$c2FsdA==$'],
  ['an Argon2 hash that cannot be verified here', '$argon2id$v=19$m=19456,t=2,p=1$YWJj$ZGVm'],
] as const) {
  check(label, !(await verifyPassword(stored, password)));
}

console.log('\n=== a tampered cost cannot exhaust memory ===');

/*
 * The stored cost is attacker-controlled if the database is. Without bounds, one row
 * naming a huge N turns every login attempt into a memory exhaustion.
 */
check(
  'an absurd cost is refused rather than attempted',
  !(await verifyPassword('scrypt$99999999$8$1$c2FsdA==$aGFzaA==', password)),
);

console.log('\n=== timing ===');

const started = Date.now();
await verifyPassword(hash, password);
const elapsed = Date.now() - started;
console.log(`  satu pengesahan: ${String(elapsed)}ms`);
// Not an assertion: hardware differs. Reported because a cost that has drifted to
// milliseconds is a cost that no longer protects anything, and this is where somebody
// would notice.
check('the cost is doing real work (>20ms)', elapsed > 20);

console.log(`\n${failures === 0 ? 'Semua lulus' : `${String(failures)} gagal`}\n`);
process.exit(failures === 0 ? 0 : 1);
