/**
 * Regression suite for how a connector describes a failed call to the cloud.
 *
 * No server and no network: `describeFetchFailure` is a pure function over the error shapes
 * `fetch` actually produces, and the reason it needs a suite is that its output is the only thing
 * a person has when a site goes dark. A real site reported `fetch failed` on every heartbeat for
 * six minutes while `curl` from the same machine answered 200 — and that string named nothing,
 * because the cause had been thrown away.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/test-agent-failures.mts
 */

import { describeFetchFailure } from '../apps/agent/src/cloud.js';

let failures = 0;

function check(ok: boolean, what: string, detail = ''): void {
  if (ok) {
    console.log(`  [ok]   ${what}`);
  } else {
    failures += 1;
    console.log(`  [FAIL] ${what}${detail === '' ? '' : ` :: ${detail}`}`);
  }
}

/** Builds the nesting undici produces: a wrapper with the reason underneath. */
function wrap(message: string, cause: unknown): Error {
  const error = new TypeError(message);
  (error as { cause?: unknown }).cause = cause;
  return error;
}

function coded(code: string, message: string): Error {
  const error = new Error(message);
  (error as { code?: unknown }).code = code;
  return error;
}

console.log('\nThe shape that cost us six minutes of a dark site');

{
  /*
   * A host with AAAA records and no working IPv6: undici tries every address and collects the
   * per-address failures in an AggregateError. The outer error says only "fetch failed", which is
   * exactly what the journal showed.
   */
  const aggregate = new AggregateError(
    [coded('ENETUNREACH', 'connect ENETUNREACH 2606:4700:3034::ac43:92eb:443')],
    'All attempts to connect failed',
  );
  const detail = describeFetchFailure(wrap('fetch failed', aggregate));

  check(detail.includes('ENETUNREACH'), 'the per-address code survives', detail);
  check(detail.includes('2606:4700'), 'and so does the address, which is what names IPv6', detail);
  check(detail !== 'fetch failed', 'it is no longer just "fetch failed"', detail);
}

console.log('\nThe other conditions, each needing a different repair');

{
  const cases: Array<[string, unknown, string]> = [
    ['DNS temporarily unavailable', coded('EAI_AGAIN', 'getaddrinfo EAI_AGAIN host'), 'EAI_AGAIN'],
    ['nothing listening', coded('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.1:443'), 'ECONNREFUSED'],
    ['name does not resolve', coded('ENOTFOUND', 'getaddrinfo ENOTFOUND host'), 'ENOTFOUND'],
    ['peer closed abruptly', coded('ECONNRESET', 'read ECONNRESET'), 'ECONNRESET'],
    [
      'certificate not yet valid, which is a wrong clock',
      coded('CERT_NOT_YET_VALID', 'certificate is not yet valid'),
      'CERT_NOT_YET_VALID',
    ],
    [
      'self-signed certificate',
      coded('DEPTH_ZERO_SELF_SIGNED_CERT', 'self-signed certificate'),
      'SELF_SIGNED',
    ],
  ];

  for (const [what, cause, needle] of cases) {
    const detail = describeFetchFailure(wrap('fetch failed', cause));
    check(detail.includes(needle), `named: ${what}`, detail);
  }
}

console.log('\nDeeper nesting, because undici wraps more than once');

{
  const detail = describeFetchFailure(
    wrap(
      'fetch failed',
      wrap(
        'Connect Timeout Error',
        new AggregateError([coded('ETIMEDOUT', 'connect ETIMEDOUT 104.21.28.171:443')], 'failed'),
      ),
    ),
  );
  check(detail.includes('ETIMEDOUT'), 'reaches three levels down', detail);
  check(detail.includes('Connect Timeout Error'), 'and keeps the intermediate layer', detail);
}

console.log('\nIt must never make things worse');

{
  check(describeFetchFailure(new Error('plain')).includes('plain'), 'a plain error passes through');
  check(describeFetchFailure('a string').includes('a string'), 'a thrown string is handled');
  check(describeFetchFailure(null).length > 0, 'null does not produce an empty line');
  check(describeFetchFailure(undefined).length > 0, 'nor does undefined');

  /*
   * A cause that points at itself. Contrived, but this runs in a process that must not die while
   * reporting why something else died.
   */
  const loop = new Error('round');
  (loop as { cause?: unknown }).cause = loop;
  check(describeFetchFailure(loop).includes('round'), 'a self-referencing cause terminates');

  // The devices screen stores this; an unbounded string would be truncated by the column instead.
  const long = describeFetchFailure(wrap('fetch failed', coded('EBIG', 'x'.repeat(5000))));
  check(long.length <= 400, 'the result is bounded', String(long.length));
}

console.log(failures === 0 ? '\nSemua lulus\n' : `\n${String(failures)} GAGAL\n`);
process.exit(failures === 0 ? 0 : 1);
