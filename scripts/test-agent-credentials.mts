/**
 * Agent credentials: issuing, verifying, single-use enrolment, and scope.
 *
 * Needs a database but no running server. It creates rows prefixed `ujian-agent-` and removes
 * them again; a crash mid-run leaves those behind, and they are safe to delete by hand.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/test-agent-credentials.mts
 *
 * The check that matters most here is the second exchange of one enrolment token. Everything
 * else is shape; that one is the property the whole design rests on, because a token usable
 * twice means two Raspberry Pis holding credentials for one site and only the later one
 * working — with nothing on any screen explaining the first.
 *
 * Note for anyone running this with `npm run dev` active: importing `db.js` builds the Prisma
 * client, which writes into `node_modules/.prisma/client`, which `tsx watch` notices. The dev
 * server will restart. Harmless here because this script talks to the database directly.
 */
import { AgentStatus } from '@attendance/shared';

import { db, disconnectDb } from '../apps/server/src/db.js';
import {
  agentDevice,
  agentDevices,
  exchangeEnrolToken,
  issueAgentKey,
  issueAgentSecret,
  issueEnrolToken,
  readAgentCredential,
  revokeAgent,
  verifyAgentSecret,
} from '../apps/server/src/devices/agents.js';

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

const stamp = Date.now();
const created: number[] = [];
let deviceId: number | null = null;

try {
  // -------------------------------------------------------------------------
  section('issuing');

  const first = issueAgentSecret();
  const second = issueAgentSecret();

  check('an agent secret carries the agent prefix', first.secret.startsWith('hkag_'));
  check('the stored prefix is a prefix of the secret', first.secret.startsWith(first.prefix));
  check('the prefix is too short to be the secret', first.prefix.length < first.secret.length);
  check('the hash is 64 hex characters', /^[0-9a-f]{64}$/.test(first.secretHash));
  check('two secrets differ', first.secret !== second.secret);
  check('two hashes differ', first.secretHash !== second.secretHash);

  const enrol = issueEnrolToken();
  check('an enrolment token carries its own prefix', enrol.token.startsWith('hken_'));
  check(
    'an enrolment token is not mistakable for a working credential',
    !enrol.token.startsWith('hkag_'),
  );
  const ttlMinutes = (enrol.expiresAt.getTime() - Date.now()) / 60_000;
  check('an enrolment token expires within the hour', ttlMinutes > 55 && ttlMinutes <= 60);

  check('an agent key is issued non-empty', issueAgentKey().length > 6);

  // -------------------------------------------------------------------------
  section('reading the credential from a request');

  check(
    'a bearer header is read',
    readAgentCredential({ authorization: 'Bearer hkag_abc' }) === 'hkag_abc',
  );
  check(
    'the scheme is matched case-insensitively',
    readAgentCredential({ authorization: 'bearer hkag_abc' }) === 'hkag_abc',
  );
  check('a missing header yields null', readAgentCredential({}) === null);
  check(
    'a basic credential is not accepted as a bearer token',
    readAgentCredential({ authorization: 'Basic aGk6dGhlcmU=' }) === null,
  );
  check(
    'an api key header is not accepted, unlike for API tokens',
    readAgentCredential({ 'x-api-key': 'hkag_abc' }) === null,
  );

  // -------------------------------------------------------------------------
  section('refusals that never touch the database');

  const missing = await verifyAgentSecret(null);
  check('no credential is refused as missing', !missing.ok && missing.reason === 'missing');

  const wrongPrefix = await verifyAgentSecret('hka_looks-like-an-api-token');
  check(
    'an API token is refused on the prefix, not after a lookup',
    !wrongPrefix.ok && wrongPrefix.reason === 'malformed',
  );

  const enrolAsSecret = await verifyAgentSecret(enrol.token);
  check(
    'an enrolment token cannot be used as a working credential',
    !enrolAsSecret.ok && enrolAsSecret.reason === 'malformed',
  );

  const unknown = await verifyAgentSecret(first.secret);
  check(
    'a well-formed credential nobody issued is unknown',
    !unknown.ok && unknown.reason === 'unknown',
  );

  // -------------------------------------------------------------------------
  section('enrolment is single use');

  const token = issueEnrolToken();
  const pending = await db().deviceAgent.create({
    data: {
      name: `ujian-agent-a-${String(stamp)}`,
      agentKey: issueAgentKey(),
      enrolTokenHash: token.tokenHash,
      enrolExpiresAt: token.expiresAt,
    },
  });
  created.push(pending.id);

  const beforeEnrol = await verifyAgentSecret(first.secret);
  check(
    'a row awaiting enrolment holds no usable credential',
    !beforeEnrol.ok && beforeEnrol.reason === 'unknown',
  );

  const exchanged = await exchangeEnrolToken(token.token, {
    version: '0.1.0-ujian',
    lanHost: '192.168.1.50',
    lanPort: 8080,
    address: '203.0.113.9',
  });
  check('a valid enrolment token is exchanged', exchanged.ok);

  if (!exchanged.ok) throw new Error('enrolment failed, the rest of the run depends on it');

  check('the exchange returns a working credential', exchanged.secret.startsWith('hkag_'));
  check('the agent becomes active', exchanged.agent.status === AgentStatus.active);
  check('the credential hash is stored', exchanged.agent.secretHash !== null);
  check('the prefix is stored for logs', exchanged.agent.secretPrefix !== null);
  check('the enrolment token is cleared', exchanged.agent.enrolTokenHash === null);
  check('the reported LAN address is recorded', exchanged.agent.lanHost === '192.168.1.50');
  check('the reported version is recorded', exchanged.agent.version === '0.1.0-ujian');

  /**
   * The property the design rests on.
   *
   * Asserted as "is refused and issues nothing", not on a particular reason code. A consumed
   * token answers `unknown` because the hash was cleared when it was spent, and `used` is
   * reserved for the race-loser — two installers close enough together that both pass the
   * lookup. Pinning this to one code would make the test fail on a correct refusal.
   */
  const reused = await exchangeEnrolToken(token.token);
  check('the same enrolment token cannot be exchanged twice', !reused.ok);

  const afterReuse = await db().deviceAgent.findUniqueOrThrow({ where: { id: pending.id } });
  check(
    'a second exchange issues no second credential',
    afterReuse.secretHash === exchanged.agent.secretHash,
  );
  check('the first credential still verifies after the refused reuse', (await verifyAgentSecret(exchanged.secret)).ok);

  const neverIssued = await exchangeEnrolToken(`hken_${'x'.repeat(32)}`);
  check(
    'an enrolment token nobody issued is unknown',
    !neverIssued.ok && neverIssued.reason === 'unknown',
  );

  const wrongKind = await exchangeEnrolToken(exchanged.secret);
  check(
    'a working credential cannot be exchanged as an enrolment token',
    !wrongKind.ok && wrongKind.reason === 'malformed',
  );

  // -------------------------------------------------------------------------
  section('an expired token is refused, and says so');

  const stale = issueEnrolToken();
  await db().deviceAgent.update({
    where: { id: pending.id },
    data: {
      enrolTokenHash: stale.tokenHash,
      enrolExpiresAt: new Date(Date.now() - 1000),
    },
  });

  const expired = await exchangeEnrolToken(stale.token);
  check(
    'an expired token is reported as expired, not as unknown',
    !expired.ok && expired.reason === 'expired',
  );

  await db().deviceAgent.update({
    where: { id: pending.id },
    data: { enrolTokenHash: null, enrolExpiresAt: null },
  });

  // -------------------------------------------------------------------------
  section('verifying a working credential');

  const verified = await verifyAgentSecret(exchanged.secret, '203.0.113.9');
  check('the issued credential verifies', verified.ok);
  check(
    'the identity names the agent',
    verified.ok && verified.identity.id === pending.id && verified.identity.name === pending.name,
  );

  const tampered = await verifyAgentSecret(`${exchanged.secret}x`);
  check(
    'a credential with one extra character is refused',
    !tampered.ok && tampered.reason === 'unknown',
  );

  // -------------------------------------------------------------------------
  section('scope is the device assignment itself');

  const otherToken = issueEnrolToken();
  const other = await db().deviceAgent.create({
    data: {
      name: `ujian-agent-b-${String(stamp)}`,
      agentKey: issueAgentKey(),
      enrolTokenHash: otherToken.tokenHash,
      enrolExpiresAt: otherToken.expiresAt,
    },
  });
  created.push(other.id);
  const otherEnrolled = await exchangeEnrolToken(otherToken.token);
  if (!otherEnrolled.ok) throw new Error('second enrolment failed');

  const device = await db().device.create({
    data: {
      name: `ujian-agent-peranti-${String(stamp)}`,
      host: '192.168.1.251',
      agentId: pending.id,
    },
  });
  deviceId = device.id;

  const ownScope = await agentDevice(pending.id, device.id);
  check('an agent resolves a device assigned to it', ownScope?.id === device.id);

  const foreignScope = await agentDevice(other.id, device.id);
  check(
    "another site cannot resolve this agent's device",
    foreignScope === null,
  );

  const listed = await agentDevices(pending.id);
  check('the device appears in the agent list', listed.some((row) => row.id === device.id));

  const otherListed = await agentDevices(other.id);
  check('an agent with no devices lists none of ours', !otherListed.some((r) => r.id === device.id));

  await db().device.update({ where: { id: device.id }, data: { active: false } });
  const inactive = await agentDevice(pending.id, device.id);
  check('a deactivated device leaves the scope', inactive === null);
  await db().device.update({ where: { id: device.id }, data: { active: true } });

  // -------------------------------------------------------------------------
  section('revocation');

  await revokeAgent(other.id);
  const afterRevoke = await verifyAgentSecret(otherEnrolled.secret);
  check('a revoked credential no longer verifies', !afterRevoke.ok);

  const revokedRow = await db().deviceAgent.findUniqueOrThrow({ where: { id: other.id } });
  check('revocation clears the stored hash', revokedRow.secretHash === null);
  check('revocation is timestamped', revokedRow.revokedAt !== null);
  check('revocation sets the status', revokedRow.status === AgentStatus.revoked);

  /**
   * Covers the status branch in `verifyAgentSecret`, which `revokeAgent` never reaches because
   * it removes the hash outright.
   *
   * The branch is there for a row whose status changed by some other route — an SQL fix, a
   * restored backup — where the hash survives. Planting exactly that state is the only way to
   * prove the check is load-bearing rather than decoration.
   */
  const planted = issueAgentSecret();
  await db().deviceAgent.update({
    where: { id: other.id },
    data: { secretHash: planted.secretHash, status: AgentStatus.revoked },
  });
  const plantedRevoked = await verifyAgentSecret(planted.secret);
  check(
    'a revoked row whose hash survived is refused on status',
    !plantedRevoked.ok && plantedRevoked.reason === 'revoked',
  );

  await db().deviceAgent.update({
    where: { id: other.id },
    data: { status: AgentStatus.pending },
  });
  const plantedPending = await verifyAgentSecret(planted.secret);
  check(
    'a pending row whose hash survived is refused on status',
    !plantedPending.ok && plantedPending.reason === 'pending',
  );

  // -------------------------------------------------------------------------
  section('deleting an agent that still owns a terminal');

  let restricted = false;
  try {
    await db().deviceAgent.delete({ where: { id: pending.id } });
  } catch {
    restricted = true;
  }
  check('an agent with devices attached cannot be deleted', restricted);
} finally {
  // Devices first: the foreign key is RESTRICT, so an attached device blocks the agent delete.
  if (deviceId !== null) {
    await db().device.delete({ where: { id: deviceId } }).catch(() => undefined);
  }
  for (const id of created) {
    await db().deviceAgent.delete({ where: { id } }).catch(() => undefined);
  }
  await disconnectDb();
}

console.log(failures === 0 ? '\nSemua lulus' : `\n${String(failures)} semakan GAGAL`);
process.exit(failures === 0 ? 0 : 1);
