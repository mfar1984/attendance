/**
 * Regression suite for the connector's remembered roster.
 *
 * Exercises the real SQLite spool in a temporary directory, because the point of the cache is that
 * it survives a restart — and a fake store would prove nothing about that.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/test-agent-roster-cache.mts
 *
 * ## What this is defending
 *
 * Attribution needs the roster, and the roster only arrives on a successful heartbeat. A connector
 * that restarts while the cloud is unreachable therefore came up serving nothing and answered 404
 * to every push — and Hikvision firmware keeps no queue and never resends, so those scans stopped
 * existing rather than arriving late. Hospital Sibu's link drops about a quarter of its requests,
 * which makes that window a routine event rather than a theoretical one.
 *
 * ## And the line it must not cross
 *
 * The cache holds identity only. It must be sufficient to spool an event and insufficient to open
 * a socket to a terminal, because the alternative is terminal passwords on the disk of a machine
 * that sits in a corridor. The assertions below check both halves — that a cached device can be
 * attributed, and that it cannot be served.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env['CLOUD_URL'] ??= 'http://127.0.0.1:9/';
process.env['NODE_ENV'] ??= 'development';
process.env['INGEST_PASSWORD'] ??= 'ujianpass123';
process.env['LOG_LEVEL'] ??= 'fatal';

const stateDir = mkdtempSync(join(tmpdir(), 'attendance-roster-'));
process.env['STATE_DIR'] = stateDir;

const { Spool } = await import('../apps/agent/src/spool.js');
const { Roster } = await import('../apps/agent/src/roster.js');
const { loadConfig } = await import('../apps/agent/src/config.js');

let failures = 0;
function check(ok: boolean, what: string, detail = ''): void {
  if (ok) {
    console.log(`  [ok]   ${what}`);
  } else {
    failures += 1;
    console.log(`  [FAIL] ${what}${detail === '' ? '' : ` :: ${detail}`}`);
  }
}

const config = loadConfig();

/**
 * Every spool opened here, so all of them can be closed before the directory is removed.
 *
 * Windows refuses to delete a file with an open handle, so leaving these to the garbage collector
 * made the teardown throw `EPERM` — after every assertion had passed, which meant a suite that was
 * entirely green exited non-zero and printed no summary. Worth the bookkeeping: a test that reports
 * failure when it succeeded is a test people learn to re-run rather than read.
 */
const opened: Array<{ close: () => void }> = [];

function openSpool(): InstanceType<typeof Spool> {
  const spool = new Spool(config);
  opened.push(spool);
  return spool;
}

/** An ISAPI terminal, with a credential, as the cloud would report it. */
const hik = {
  deviceId: 11,
  name: 'Rumah Mayat',
  vendor: 'hikvision',
  protocol: 'isapi',
  host: '192.168.1.250',
  port: 443,
  useHttps: true,
  verifyTls: false,
  username: 'admin',
  password: 'TerminalSecret123',
  serialNumber: 'HIKSERIAL0001',
  firmware: 'V1.0',
  doorNo: 1,
  cursor: { sequence: null, since: null },
};

/** A callback terminal, which has no credential and is matched by serial. */
const zk = {
  ...hik,
  deviceId: 22,
  name: 'Pejabat IT',
  vendor: 'zkteco',
  protocol: 'ta-push',
  host: '192.168.0.32',
  username: null,
  password: null,
  serialNumber: 'VGU6262300102',
};

try {
  // -------------------------------------------------------------------------
  console.log('\nA roster arrives and is remembered');

  const spool = openSpool();
  const roster = new Roster(spool);

  check(roster.cachedCount() === 0, 'nothing remembered on a fresh state directory');
  check(
    roster.identify({ addresses: ['192.168.1.250'] }) === undefined,
    'and nothing can be attributed yet',
  );

  roster.replace([hik, zk]);

  check(roster.all().length === 2, 'both terminals are served', String(roster.all().length));
  check(roster.cachedCount() === 2, 'and both identities are remembered');

  const live = roster.identify({ addresses: ['192.168.1.250'] });
  check(live?.deviceId === 11, 'a served terminal is attributed', JSON.stringify(live));
  check(live?.cached === false, 'and marked as coming from the live roster');

  // -------------------------------------------------------------------------
  console.log('\nThe connector restarts while the cloud is unreachable');

  /*
   * A second `Roster` over the same spool, with `replace` never called — which is exactly the
   * state after a restart whose first heartbeat failed.
   */
  const afterRestart = new Roster(spool);

  check(afterRestart.all().length === 0, 'nothing is served, because no heartbeat has succeeded');
  check(afterRestart.cachedCount() === 2, 'but both identities survived the restart');

  const byAddress = afterRestart.identify({ addresses: ['192.168.1.250'] });
  check(byAddress?.deviceId === 11, 'a push can still be attributed by address', JSON.stringify(byAddress));
  check(byAddress?.cached === true, 'and is flagged as remembered rather than confirmed');

  const bySerial = afterRestart.identify({ serial: 'VGU6262300102' });
  check(bySerial?.deviceId === 22, 'and a callback terminal by serial', JSON.stringify(bySerial));
  check(bySerial?.serialNumber === 'VGU6262300102', 'carrying the serial the decoder needs');

  // IPv4-mapped form, which is how a push arrives on a dual-stack socket.
  check(
    afterRestart.identify({ addresses: ['::ffff:192.168.1.250'] })?.deviceId === 11,
    'an IPv4-mapped address matches too',
  );

  // -------------------------------------------------------------------------
  console.log('\nRemembered is not the same as reachable');

  /*
   * The security property. A cached device must be attributable and must not be servable: the pull,
   * the snapshot sweep and the executor all go through `get`, and every one of them would open a
   * socket using a credential the cache does not hold.
   */
  check(afterRestart.get(11) === undefined, 'get() refuses a cached-only device');
  check(afterRestart.get(22) === undefined, 'for the callback terminal as well');
  check(afterRestart.all().length === 0, 'all() offers nothing to the pull or the snapshot sweep');
  check(
    afterRestart.findByAddress('192.168.1.250') === undefined,
    'findByAddress stays live-only, so nothing can be dialled from memory',
  );
  check(
    afterRestart.findBySerial('VGU6262300102') === undefined,
    'and so does findBySerial',
  );

  // -------------------------------------------------------------------------
  console.log('\nNo credential reaches the disk');

  {
    /*
     * Read back through a fresh handle rather than trusting the API that wrote it. The claim being
     * checked is about the file, so the file is what is inspected.
     */
    const reread = openSpool().cachedRosterIdentity();
    const serialised = JSON.stringify(reread);

    check(reread.length === 2, 'both rows are there', String(reread.length));
    check(
      !serialised.includes('TerminalSecret123'),
      'the terminal password is absent',
      serialised.slice(0, 200),
    );
    check(!serialised.includes('admin'), 'and so is the username');
    check(
      serialised.includes('HIKSERIAL0001') && serialised.includes('192.168.1.250'),
      'while the serial and address — which is all attribution needs — are kept',
    );

    const keys = new Set(Object.keys(reread[0] ?? {}));
    check(
      !keys.has('password') && !keys.has('username') && !keys.has('port'),
      'the stored shape has no credential fields at all',
      [...keys].join(','),
    );
  }

  // -------------------------------------------------------------------------
  console.log('\nA terminal moved to another connector stops being claimed');

  {
    const moved = new Roster(spool);
    moved.replace([hik]);

    check(moved.cachedCount() === 1, 'the cache is replaced wholesale, not merged');
    check(
      moved.identify({ serial: 'VGU6262300102' }) === undefined,
      'the departed terminal is no longer attributed',
    );
    check(moved.identify({ addresses: ['192.168.1.250'] })?.deviceId === 11, 'the remaining one is');

    // And it stays gone across a restart, which is the half a merge would have broken.
    const again = new Roster(spool);
    check(
      again.identify({ serial: 'VGU6262300102' }) === undefined,
      'and it is still gone after a restart',
    );
  }

  // -------------------------------------------------------------------------
  console.log('\nA serial that matches nothing does not fall back to an address');

  {
    const roster2 = new Roster(spool);
    roster2.replace([hik, zk]);

    /*
     * The mistake this guards. On a callback protocol the serial *is* the identity, so resolving an
     * unknown serial by whichever device happens to share its address would file one terminal's
     * attendance against another — permanently, since raw events have no delete path.
     */
    check(
      roster2.identify({ serial: 'NOTAREALSERIAL', addresses: ['192.168.0.32'] }) === undefined,
      'an unknown serial is refused even when the address is known',
    );
    check(
      roster2.identify({ serial: '   ', addresses: ['192.168.1.250'] })?.deviceId === 11,
      'a blank serial falls through to the address, which is the push path',
    );
  }

  // -------------------------------------------------------------------------
  console.log('\nAn empty roster is remembered as empty');

  {
    const emptied = new Roster(spool);
    emptied.replace([]);
    check(emptied.cachedCount() === 0, 'a site with no terminals caches nothing');
    check(
      new Roster(spool).identify({ addresses: ['192.168.1.250'] }) === undefined,
      'and claims nothing after a restart',
    );
  }
} finally {
  for (const spool of opened) {
    try {
      spool.close();
    } catch {
      /* Already closed, or never opened cleanly. Not worth failing a teardown over. */
    }
  }

  try {
    rmSync(stateDir, { recursive: true, force: true });
  } catch (error) {
    /*
     * Reported, not thrown. A temporary directory that outlives the run is untidy; a suite that
     * exits non-zero because of it is misleading, and this one is about data loss.
     */
    console.log(`  note: could not remove ${stateDir} (${error instanceof Error ? error.message : 'error'})`);
  }
}

console.log(failures === 0 ? '\nSemua lulus\n' : `\n${String(failures)} GAGAL\n`);
process.exit(failures === 0 ? 0 : 1);
