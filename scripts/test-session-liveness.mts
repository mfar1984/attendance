/**
 * The session liveness stamp, under the concurrency a real screen produces.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/test-session-liveness.mts
 *
 * Needs a database but no running server and no admin password: it creates one session row for an
 * existing active account, drives `resolveSession` directly, and removes the row again.
 *
 * ## The regression this holds
 *
 * `resolveSession` runs on every authenticated request, and a screen opening fires several at
 * once. All of them read the same session row, all of them find `lastSeenAt` older than a minute,
 * and all of them then wrote to that one row at the same moment — which MariaDB refuses with 1020,
 * `Record has changed since last read`. The write was awaited and unguarded, so the refusal
 * propagated and answered 500 to a request that had nothing wrong with it.
 *
 * Two properties fix it, and both are asserted below: the cutoff lives in the `WHERE` so
 * concurrent writers after the first match nothing, and the statement cannot fail the request it
 * is attached to.
 *
 * ## What this script cannot do, stated because it would otherwise be trusted too far
 *
 * **The burst section passes against the broken code on MySQL.** 1020 is MariaDB raising
 * `ER_CHECKREAD`; MySQL 8 serialises the same concurrent statements behind a row lock and returns
 * success. The development machine here runs MySQL 8.0.45 and production runs MariaDB, so the
 * failure this was written for cannot be reproduced locally at all.
 *
 * That is why the compare-and-swap section exists. It asserts the *shape* of the fix rather than
 * the symptom — a second claim against the same cutoff has to report zero rows — and that check
 * does fail if somebody moves the condition back out of the statement. It is engine-independent,
 * so it is the one that actually guards this on either database.
 */
import { hashSessionToken, newSessionToken } from '../apps/server/src/crypto.js';
import { db, disconnectDb } from '../apps/server/src/db.js';
import { resolveSession } from '../apps/server/src/auth/service.js';

let failures = 0;

function check(label: string, passed: boolean): void {
  if (passed) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}`);
}

function section(name: string): void {
  console.log(`\n=== ${name} ===`);
}

/** Enough parallel calls to lose the race reliably; a screen opening fires about this many. */
const BURST = 8;

const prisma = db();
let tokenHash: string | null = null;

try {
  section('setup');

  /*
   * An existing account rather than a created one. The chain behind a session is account → role →
   * staff, and inventing all three to test a timestamp would leave three kinds of fixture to clean
   * up — each of which is a row somebody could later mistake for real.
   */
  const account = await prisma.userAccount.findFirst({
    where: { status: 'active', role: { status: 'active' } },
    include: { role: true, staff: true },
  });

  if (account === null) throw new Error('No active account to test with');
  check('an active account exists to hang a session on', true);

  const token = newSessionToken();
  tokenHash = hashSessionToken(token);

  /** Stamped well past the throttle, so the first burst is guaranteed to want a write. */
  const stale = new Date(Date.now() - 5 * 60_000);

  await prisma.session.create({
    data: {
      tokenHash,
      accountId: account.id,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      lastSeenAt: stale,
      ipAddress: '127.0.0.1',
      userAgent: 'ujian-session-liveness',
    },
  });

  // -------------------------------------------------------------------------
  section('a burst of concurrent requests');

  const results = await Promise.allSettled(
    Array.from({ length: BURST }, () => resolveSession(token)),
  );

  const rejected = results.filter((entry) => entry.status === 'rejected');
  /*
   * The assertion that matters. Before the fix, the losers of the race threw MariaDB 1020 out of
   * `resolveSession` — which is called from the auth hook, so every one of them became a 500 on a
   * request the operator had no reason to expect to fail.
   */
  check(`all ${String(BURST)} concurrent resolutions succeed`, rejected.length === 0);
  if (rejected.length > 0) {
    for (const entry of rejected.slice(0, 2)) {
      console.log(
        `       ${entry.status === 'rejected' ? String((entry.reason as Error).message) : ''}`,
      );
    }
  }

  const resolved = results.filter(
    (entry): entry is PromiseFulfilledResult<Awaited<ReturnType<typeof resolveSession>>> =>
      entry.status === 'fulfilled',
  );
  check('every one of them returns the authenticated user', resolved.every((r) => r.value !== null));

  const afterBurst = await prisma.session.findUniqueOrThrow({ where: { tokenHash } });
  check('the liveness stamp moved forward', afterBurst.lastSeenAt > stale);

  // -------------------------------------------------------------------------
  /*
   * The throttle still has to hold, because it is the reason this is not a write per request.
   *
   * With the cutoff in the `WHERE`, a second burst arriving immediately finds nothing to match and
   * writes nothing — so the stamp is unchanged rather than rewritten eight more times.
   */
  section('the throttle still holds');

  const before = afterBurst.lastSeenAt;
  const second = await Promise.allSettled(
    Array.from({ length: BURST }, () => resolveSession(token)),
  );
  check(
    'a second burst inside the throttle window also succeeds',
    second.every((entry) => entry.status === 'fulfilled'),
  );

  const afterSecond = await prisma.session.findUniqueOrThrow({ where: { tokenHash } });
  check(
    'and writes nothing, so the stamp is untouched',
    afterSecond.lastSeenAt.getTime() === before.getTime(),
  );

  // -------------------------------------------------------------------------
  /*
   * The compare-and-swap itself, asserted without depending on the engine.
   *
   * This is the check that can actually fail if the fix is undone. The burst above cannot: on
   * MySQL the broken version passes, because only MariaDB turns two concurrent writes to one row
   * into 1020. Here the claim is structural — with the cutoff inside the statement, exactly one
   * writer matches and the rest match nothing — and that holds on any engine.
   */
  section('the cutoff in the statement is what stops the second writer');

  const cutoff = new Date(Date.now() - 60_000);
  await prisma.session.update({
    where: { tokenHash },
    data: { lastSeenAt: new Date(Date.now() - 5 * 60_000) },
  });

  const firstClaim = await prisma.session.updateMany({
    where: { tokenHash, lastSeenAt: { lt: cutoff } },
    data: { lastSeenAt: new Date() },
  });
  const secondClaim = await prisma.session.updateMany({
    where: { tokenHash, lastSeenAt: { lt: cutoff } },
    data: { lastSeenAt: new Date() },
  });

  check('the first claim writes the row', firstClaim.count === 1);
  check('the second claim matches nothing, so there is no race to lose', secondClaim.count === 0);

  // -------------------------------------------------------------------------
  section('a revoked session still resolves to nothing');

  await prisma.session.update({ where: { tokenHash }, data: { revokedAt: new Date() } });
  check('a revoked session is refused', (await resolveSession(token)) === null);
} finally {
  if (tokenHash !== null) {
    await prisma.session.delete({ where: { tokenHash } }).catch(() => undefined);
  }
  await disconnectDb();
}

console.log(failures === 0 ? '\nSemua lulus' : `\n${String(failures)} semakan GAGAL`);
process.exit(failures === 0 ? 0 : 1);
