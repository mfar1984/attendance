/**
 * Regression suite for the connector's listener — both protocols, end to end.
 *
 * Built with a real `Roster` and a real SQLite `Spool` in a temporary directory, so what is being
 * asserted is that an event actually lands on disk attributed to the right device. Fakes would
 * prove the handlers call something; this proves the thing that keeps a scan from disappearing.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/test-agent-listener.mts
 *
 * ## Why this is permanent
 *
 * It was written once as a throwaway, passed, and was deleted — and the listener's attribution
 * path was then rewritten, leaving the behaviour that carries Hospital Sibu's attendance with no
 * test over it. The cost of keeping a suite is that it has to be maintained; the cost of deleting
 * one is that the next change to the same code is unverified.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env['CLOUD_URL'] ??= 'http://127.0.0.1:9/';
process.env['NODE_ENV'] ??= 'development';
process.env['INGEST_PASSWORD'] ??= 'ujianpass123';
process.env['INGEST_USERNAME'] ??= 'hikpush';
process.env['LOG_LEVEL'] ??= 'fatal';

const stateDir = mkdtempSync(join(tmpdir(), 'attendance-listener-'));
process.env['STATE_DIR'] = stateDir;

const { createListener } = await import('../apps/agent/src/listener.js');
const { Relay } = await import('../apps/agent/src/relay.js');
const { Roster } = await import('../apps/agent/src/roster.js');
const { Spool } = await import('../apps/agent/src/spool.js');
const { SiteState } = await import('../apps/agent/src/state.js');
const { loadConfig } = await import('../apps/agent/src/config.js');
const { noteOrgOffsetMinutes, resetClockForTests } = await import('../apps/agent/src/clock.js');

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
const md5 = (value: string): string => createHash('md5').update(value, 'utf8').digest('hex');

/** The realm the connector's own Digest helper issues. Fixed, not configurable. */
const REALM = 'attendance-ingest';

/**
 * Answers a Digest challenge the way the firmware does.
 *
 * Computed rather than captured, so the push path is tested as authenticated rather than only as
 * refused. The nonce count increments per call because the connector rejects a repeat — that
 * replay guard is what stands between a sixteen-character password and an open endpoint.
 */
let nc = 0;
function digestHeader(challenge: string, method: string, uri: string): string {
  const nonce = /nonce="([^"]+)"/.exec(challenge)?.[1] ?? '';
  const cnonce = randomBytes(8).toString('hex');
  nc += 1;
  const ncHex = nc.toString(16).padStart(8, '0');

  const ha1 = md5(`${config.INGEST_USERNAME}:${REALM}:${config.INGEST_PASSWORD}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = md5(`${ha1}:${nonce}:${ncHex}:${cnonce}:auth:${ha2}`);

  return (
    `Digest username="${config.INGEST_USERNAME}", realm="${REALM}", nonce="${nonce}", ` +
    `uri="${uri}", qop=auth, nc=${ncHex}, cnonce="${cnonce}", response="${response}"`
  );
}

const HIK = {
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

const ZK = {
  ...HIK,
  deviceId: 22,
  name: 'Pejabat IT',
  vendor: 'zkteco',
  protocol: 'ta-push',
  host: '192.168.0.32',
  username: null,
  password: null,
  serialNumber: 'VGU6262300102',
};

/** One ACS event in the shape the firmware posts it. */
function acsPush(serialNo: number, employeeNo: string): string {
  return JSON.stringify({
    ipAddress: '192.168.1.250',
    eventType: 'AccessControllerEvent',
    dateTime: '2026-10-21T08:03:00+08:00',
    AccessControllerEvent: {
      majorEventType: 5,
      subEventType: 75,
      serialNo,
      employeeNoString: employeeNo,
      name: 'Siti Ujian',
      currentVerifyMode: 'face',
    },
  });
}

const opened: Array<{ close: () => void }> = [];

try {
  // -------------------------------------------------------------------------
  console.log('\nHikvision push, with a live roster');

  {
    const spool = new Spool(config);
    opened.push(spool);
    const roster = new Roster(spool);
    roster.replace([HIK, ZK]);

    const { app, stats } = createListener(
      config,
      roster,
      spool,
      new SiteState(),
      new Relay(),
      { reportCommand: async () => ({ ok: true as const, value: {} }) } as never,
    );

    const refused = await app.inject({
      method: 'POST',
      url: '/hik/events',
      headers: { 'content-type': 'application/json' },
      payload: acsPush(1, '1001'),
    });
    check(refused.statusCode === 401, 'an unauthenticated push is refused', String(refused.statusCode));

    const challenge = String(refused.headers['www-authenticate'] ?? '');
    check(challenge.startsWith('Digest '), 'and a challenge is issued so the unit can retry');

    const before = spool.count();
    const accepted = await app.inject({
      method: 'POST',
      url: '/hik/events',
      headers: {
        'content-type': 'application/json',
        authorization: digestHeader(challenge, 'POST', '/hik/events'),
      },
      payload: acsPush(2, '1001'),
    });
    check(accepted.statusCode === 200, 'an authenticated push is accepted', accepted.body);
    check(spool.count() === before + 1, 'and the event reaches the spool before the response');

    const batch = spool.next(10);
    check(batch?.deviceId === 11, 'attributed to the terminal at that address', String(batch?.deviceId));
    check(batch?.arrivedVia === 'push', 'recorded as a push');
    check(
      batch?.events[0]?.employeeNo === '1001',
      'carrying the employee number',
      String(batch?.events[0]?.employeeNo),
    );
    check(stats.attributedFromCache === 0, 'and not counted as a cached attribution');

    await app.close();
  }

  // -------------------------------------------------------------------------
  console.log('\nHikvision push after a restart the cloud did not answer');

  {
    /*
     * The condition that lost scans at Hospital Sibu: the process came up, the first heartbeat
     * failed, so nothing was served — and every push was answered 404 by a connector sitting right
     * next to a working terminal. The firmware keeps no queue, so those events ended there.
     */
    const spool = new Spool(config);
    opened.push(spool);
    const roster = new Roster(spool);
    check(roster.all().length === 0, 'nothing is served');
    check(roster.cachedCount() === 2, 'but the previous roster is remembered', String(roster.cachedCount()));

    const { app, stats } = createListener(
      config,
      roster,
      spool,
      new SiteState(),
      new Relay(),
      { reportCommand: async () => ({ ok: true as const, value: {} }) } as never,
    );

    const challenge = String(
      (
        await app.inject({
          method: 'POST',
          url: '/hik/events',
          headers: { 'content-type': 'application/json' },
          payload: acsPush(3, '1002'),
        })
      ).headers['www-authenticate'] ?? '',
    );

    const before = spool.count();
    const accepted = await app.inject({
      method: 'POST',
      url: '/hik/events',
      headers: {
        'content-type': 'application/json',
        authorization: digestHeader(challenge, 'POST', '/hik/events'),
      },
      payload: acsPush(4, '1002'),
    });

    check(accepted.statusCode === 200, 'the push is accepted rather than refused', accepted.body);
    check(spool.count() === before + 1, 'and held for delivery', String(spool.count()));
    check(stats.attributedFromCache === 1, 'counted as attributed from memory');
    check(stats.unknownDevice === 0, 'and not as an unknown device');

    await app.close();
  }

  // -------------------------------------------------------------------------
  console.log('\nA terminal this connector has never heard of');

  {
    const spool = new Spool(config);
    opened.push(spool);
    const roster = new Roster(spool);
    roster.replace([HIK]);

    const { app, stats } = createListener(
      config,
      roster,
      spool,
      new SiteState(),
      new Relay(),
      { reportCommand: async () => ({ ok: true as const, value: {} }) } as never,
    );

    const challenge = String(
      (
        await app.inject({
          method: 'POST',
          url: '/hik/events',
          headers: { 'content-type': 'application/json' },
          payload: '{}',
        })
      ).headers['www-authenticate'] ?? '',
    );

    const stranger = await app.inject({
      method: 'POST',
      url: '/hik/events',
      headers: {
        'content-type': 'application/json',
        authorization: digestHeader(challenge, 'POST', '/hik/events'),
      },
      // An address on neither the live roster nor the cache.
      payload: JSON.stringify({ ipAddress: '10.9.9.9', eventType: 'heartBeat' }),
    });

    check(stranger.statusCode === 404, 'is refused', String(stranger.statusCode));
    check(stats.unknownDevice === 1, 'and counted as unknown');

    await app.close();
  }

  // -------------------------------------------------------------------------
  console.log('\nZKTeco callback, attributed from memory');

  {
    const spool = new Spool(config);
    opened.push(spool);
    const roster = new Roster(spool);
    roster.replace([HIK, ZK]);

    // A second roster over the same spool, never given a roster: the post-restart state again.
    const cachedOnly = new Roster(spool);

    const { app, stats } = createListener(
      config,
      cachedOnly,
      spool,
      new SiteState(),
      new Relay(),
      { reportCommand: async () => ({ ok: true as const, value: {} }) } as never,
    );

    resetClockForTests();
    noteOrgOffsetMinutes(480);

    const handshake = await app.inject({
      method: 'GET',
      url: '/iclock/cdata?SN=VGU6262300102&Stamp=77',
    });
    check(handshake.statusCode === 200, 'the handshake is answered from memory', String(handshake.statusCode));
    check(handshake.body.includes('Stamp=77'), "and echoes the terminal's own cursor");
    check(
      handshake.body.includes('GET OPTION FROM: VGU6262300102'),
      'naming the serial it remembered',
      handshake.body.split('\n')[0] ?? '',
    );

    const before = spool.count();
    const attlog = await app.inject({
      method: 'POST',
      url: '/iclock/cdata?SN=VGU6262300102&table=ATTLOG',
      headers: { 'content-type': 'text/plain' },
      payload: '1001\t2026-10-21 08:03:00\t0\t15\t0\n',
    });
    check(attlog.body.trim() === 'OK: 1', 'attendance is acknowledged', attlog.body);
    check(spool.count() === before + 1, 'and spooled');

    const unknown = await app.inject({ method: 'GET', url: '/iclock/cdata?SN=NOTMINE' });
    check(unknown.statusCode === 404, 'an unknown serial is still refused', String(unknown.statusCode));
    check(stats.callback.unknownSerial === 1, 'and counted');

    await app.close();
  }

  // -------------------------------------------------------------------------
  console.log('\nNo timezone means no decoding');

  {
    const spool = new Spool(config);
    opened.push(spool);
    const roster = new Roster(spool);
    roster.replace([ZK]);

    const { app, stats } = createListener(
      config,
      roster,
      spool,
      new SiteState(),
      new Relay(),
      { reportCommand: async () => ({ ok: true as const, value: {} }) } as never,
    );

    // The state a connector is in when the cloud has never answered, or is older than this build.
    resetClockForTests();

    const before = spool.count();
    const refused = await app.inject({
      method: 'POST',
      url: '/iclock/cdata?SN=VGU6262300102&table=ATTLOG',
      headers: { 'content-type': 'text/plain' },
      payload: '1001\t2026-10-21 08:03:00\t0\t15\t0\n',
    });

    /*
     * Refusing is safe here and nowhere else: this protocol re-offers after `ErrorDelay`, so
     * nothing is lost — whereas guessing the zone would file a Malaysian morning against the
     * previous evening, permanently, since raw events have no delete path.
     */
    check(refused.statusCode === 503, 'attendance is refused, not guessed at', String(refused.statusCode));
    check(spool.count() === before, 'and nothing is written');
    check(stats.callback.noTimezone === 1, 'counted so the cause is visible');

    noteOrgOffsetMinutes(480);
    await app.close();
  }

  // -------------------------------------------------------------------------
  console.log('\nA path this build does not serve');

  {
    const spool = new Spool(config);
    opened.push(spool);
    const roster = new Roster(spool);
    roster.replace([ZK]);

    const { app, stats } = createListener(
      config,
      roster,
      spool,
      new SiteState(),
      new Relay(),
      { reportCommand: async () => ({ ok: true as const, value: {} }) } as never,
    );

    /*
     * ZKTeco ships several push protocols and a unit may be configured for one this build does not
     * answer — which used to produce a bare 404 and nothing in the journal, the worst shape for the
     * only question somebody has during bring-up.
     */
    const odd = await app.inject({
      method: 'POST',
      url: '/cgi-bin/attendance?SN=VGU6262300102',
      headers: { 'content-type': 'text/plain' },
      payload: 'something a different protocol would send',
    });

    check(odd.statusCode === 404, 'is answered 404', String(odd.statusCode));
    check(stats.unmatched === 1, 'and counted');
    check(
      stats.lastUnmatchedPath?.includes('/cgi-bin/attendance') === true,
      'with the path recorded, which is what identifies the protocol',
      String(stats.lastUnmatchedPath),
    );

    const health = JSON.parse(
      (await app.inject({ method: 'GET', url: '/healthz' })).body,
    ) as { devices: number; known: number };
    check(health.devices === 1 && health.known === 1, 'healthz reports served and known', JSON.stringify(health));

    await app.close();
  }
} finally {
  for (const spool of opened) {
    try {
      spool.close();
    } catch {
      /* Already closed. Not worth failing a teardown over. */
    }
  }
  try {
    rmSync(stateDir, { recursive: true, force: true });
  } catch (error) {
    console.log(`  note: could not remove ${stateDir} (${error instanceof Error ? error.message : 'error'})`);
  }
}

console.log(failures === 0 ? '\nSemua lulus\n' : `\n${String(failures)} GAGAL\n`);
process.exit(failures === 0 ? 0 : 1);
