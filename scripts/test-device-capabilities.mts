/**
 * What `GET /api/devices` says each terminal can do, exercised through the real route stack.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/test-device-capabilities.mts
 *
 * Uses `app.inject()` rather than a listening server, so this needs no port, no `npm run dev` and
 * no admin password — it builds the application in-process and dispatches through the actual
 * handlers and guards. Sessions are written straight into `sessions`, which is the only part login
 * does that matters here.
 *
 * ## Why this has to be run and not merely compiled
 *
 * The Device List screen renders two fleet tabs from `DeviceRow.capabilities`: the clock columns
 * state that a protocol has no clock to read, the per-row NTP button is drawn only where the
 * protocol has NTP to configure, and the push-target buttons only where it has a callback to
 * write. All three decisions are a `declares()` against a field the **server** derives per row.
 *
 * `tsc` cannot defend any of that. It does not reject a field missing from a Prisma `select`, and
 * it will certify a non-optional web type against a route that never sends the field — which is
 * exactly how a page gets blanked. A capability list that arrived `undefined` here would not throw:
 * every helper answers "not declared", so every clock cell would read "not on this protocol" and
 * every button would vanish, on every terminal, with nothing in any log.
 *
 * So what is proved is the shape and the answers together, per protocol, including the two cases
 * that exist only on a connector site. Every row is prefixed `ujian-keupayaan-` and removed at the
 * end.
 */
import { DeviceProtocol, DeviceStatus, DeviceVendor, DriverOperation, declares } from '@attendance/shared';
import type { DriverCapabilities } from '@attendance/shared';

import { buildApp } from '../apps/server/src/app.js';
import { encryptSecret, hashSessionToken, newSessionToken } from '../apps/server/src/crypto.js';
import { db, disconnectDb } from '../apps/server/src/db.js';

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
const app = await buildApp();

const roles: number[] = [];
const staffIds: number[] = [];
const devices: number[] = [];
const agents: number[] = [];

/** The row as the device list reports it, which is what the two fleet tabs render from. */
interface ListedDevice {
  id: number;
  name: string;
  protocol: string;
  agentId: number | null;
  agent: { id: number; name: string; status: string } | null;
  capabilities?: DriverCapabilities | null;
}

async function session(): Promise<string> {
  const role = await db().role.create({
    data: {
      name: `ujian-keupayaan-${String(stamp)}`,
      permissions: { 'settings.devices': ['view', 'edit', 'clock', 'sync'] },
    },
  });
  roles.push(role.id);

  const staff = await db().staff.create({
    data: {
      employeeNo: `UJIANKEUPAYAAN-${String(stamp)}`,
      fullName: 'Ujian Keupayaan',
    },
  });
  staffIds.push(staff.id);

  const account = await db().userAccount.create({
    data: {
      staffId: staff.id,
      accountType: 'admin',
      status: 'active',
      email: `ujian-keupayaan-${String(stamp)}@contoh.local`,
      roleId: role.id,
    },
  });

  const token = newSessionToken();
  await db().session.create({
    data: {
      tokenHash: hashSessionToken(token),
      accountId: account.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });

  return `attendance_session=${token}`;
}

async function makeAgent(label: string): Promise<number> {
  const agent = await db().deviceAgent.create({
    data: {
      name: `ujian-keupayaan-${label}-${String(stamp)}`,
      agentKey: `hka_ujian_${label}_${String(stamp)}`,
      status: 'active',
      lanHost: '192.168.1.87',
      lanPort: 8080,
    },
  });
  agents.push(agent.id);
  return agent.id;
}

/**
 * A terminal of one shape.
 *
 * `password` is encrypted rather than omitted where the protocol needs one: `capabilitiesFor`
 * answers null for an ISAPI row with no stored credential, which is a legitimate state and a
 * different test than this one.
 */
async function makeDevice(options: {
  label: string;
  vendor: string;
  protocol: string;
  agentId?: number;
  withCredential?: boolean;
}): Promise<number> {
  const device = await db().device.create({
    data: {
      name: `ujian-keupayaan-${options.label}-${String(stamp)}`,
      vendor: options.vendor,
      protocol: options.protocol,
      host: `10.254.${String(devices.length)}.${String((stamp % 200) + 1)}`,
      serialNumber: `UJIANKEUPAYAAN-${options.label.toUpperCase()}-${String(stamp)}`,
      status: DeviceStatus.unknown,
      active: true,
      ...(options.agentId === undefined ? {} : { agentId: options.agentId }),
      ...(options.withCredential === true
        ? { username: 'admin', passwordEncrypted: encryptSecret('ujian-keupayaan') }
        : {}),
    },
  });
  devices.push(device.id);
  return device.id;
}

/** Does this protocol have the operation at all — the question that decides what is drawn. */
function has(row: ListedDevice | undefined, operation: DriverOperation): boolean {
  const capabilities = row?.capabilities;
  if (capabilities === null || capabilities === undefined) return false;
  return declares(capabilities, operation);
}

try {
  const cookie = await session();

  const sibu = await makeAgent('sibu');

  const hikDirect = await makeDevice({
    label: 'hik-terus',
    vendor: DeviceVendor.hikvision,
    protocol: DeviceProtocol.isapi,
    withCredential: true,
  });
  const hikViaAgent = await makeDevice({
    label: 'hik-connector',
    vendor: DeviceVendor.hikvision,
    protocol: DeviceProtocol.isapi,
    agentId: sibu,
    withCredential: true,
  });
  const zkDirect = await makeDevice({
    label: 'zk-terus',
    vendor: DeviceVendor.zkteco,
    protocol: DeviceProtocol.taPush,
  });
  const zkViaAgent = await makeDevice({
    label: 'zk-connector',
    vendor: DeviceVendor.zkteco,
    protocol: DeviceProtocol.taPush,
    agentId: sibu,
  });
  const noDriver = await makeDevice({
    label: 'tiada-pemandu',
    vendor: DeviceVendor.dahua,
    protocol: DeviceProtocol.dahuaCgi,
  });

  const listed = await app.inject({ method: 'GET', url: '/api/devices', headers: { cookie } });
  check('the device list answers 200', listed.statusCode === 200);

  const rows = listed.json() as ListedDevice[];
  const row = (id: number): ListedDevice | undefined => rows.find((entry) => entry.id === id);

  // -------------------------------------------------------------------------
  section('the field is there at all');

  check(
    'every row carries a `capabilities` key',
    rows.length > 0 && rows.every((entry) => 'capabilities' in entry),
  );
  check(
    'the five test terminals are all listed',
    [hikDirect, hikViaAgent, zkDirect, zkViaAgent, noDriver].every(
      (id) => row(id) !== undefined,
    ),
  );
  check(
    'a connector terminal carries its connector name, which the ingest note prints',
    row(zkViaAgent)?.agent?.name === `ujian-keupayaan-sibu-${String(stamp)}`,
  );

  // -------------------------------------------------------------------------
  section('Hikvision ISAPI, reached directly');

  check('declares a clock read, so no marker is drawn', has(row(hikDirect), DriverOperation.readClock));
  check(
    'declares NTP, so the row keeps its clock button',
    has(row(hikDirect), DriverOperation.configureNtp),
  );
  check(
    'declares the callback write, so it keeps its push button',
    has(row(hikDirect), DriverOperation.configureCallback),
  );

  // -------------------------------------------------------------------------
  section('ZKTeco TA Push, reached directly');

  check(
    'declares no clock read, so the clock columns say so instead of going blank',
    !has(row(zkDirect), DriverOperation.readClock),
  );
  check(
    'declares no NTP, so the row carries no clock button',
    !has(row(zkDirect), DriverOperation.configureNtp),
  );
  check(
    'declares no callback write, so it is not offered a push target',
    !has(row(zkDirect), DriverOperation.configureCallback),
  );

  // -------------------------------------------------------------------------
  section('ZKTeco TA Push, through a connector');

  /*
    The same answers as the direct unit, and that is the point: `driverFor` keeps the real TA Push
    driver for a callback terminal whoever is holding the wire, because the terminal collects its
    own work and only the handover moves. A proxy driver here would have reported a clock read this
    protocol does not have.
  */
  check(
    'still declares no clock read',
    !has(row(zkViaAgent), DriverOperation.readClock),
  );
  check('still declares no NTP', !has(row(zkViaAgent), DriverOperation.configureNtp));
  check(
    'still declares no callback write',
    !has(row(zkViaAgent), DriverOperation.configureCallback),
  );

  // -------------------------------------------------------------------------
  section('Hikvision ISAPI, through a connector');

  check(
    'declares a clock read, answered from the connector snapshot',
    has(row(hikViaAgent), DriverOperation.readClock),
  );
  check(
    'declares NTP, which the connector queues',
    has(row(hikViaAgent), DriverOperation.configureNtp),
  );
  /*
    Deliberately absent on the proxy: the editor replaces the push form with the connector's own
    rather than greying it, so there is nothing to explain. The fleet tab must not offer it either
    — this server cannot reach the unit to write one.
  */
  check(
    'declares no callback write, so the fleet push list leaves it out',
    !has(row(hikViaAgent), DriverOperation.configureCallback),
  );

  // -------------------------------------------------------------------------
  section('a protocol with no driver');

  check(
    'answers null rather than an empty capability list',
    row(noDriver)?.capabilities === null,
  );

  // -------------------------------------------------------------------------
  section('the ingest counters the Connection tab reads');

  const ingest = await app.inject({
    method: 'GET',
    url: '/api/ingest/stats',
    headers: { cookie },
  });
  check('the stats endpoint answers 200', ingest.statusCode === 200);

  const stats = ingest.json() as {
    pushedEvents?: unknown;
    pulledEvents?: unknown;
    lastContactAt?: unknown;
    callback?: { path?: unknown; records?: unknown; handshakes?: unknown };
  };

  /*
    The two durable totals decide the wording of "last contact", which is the contradiction this
    pass fixed: they come from `raw_events` and survive a restart, while `lastContactAt` does not.
    A string or a missing value here would silently pick the wrong sentence.
  */
  check('`pushedEvents` is a number', typeof stats.pushedEvents === 'number');
  check('`pulledEvents` is a number', typeof stats.pulledEvents === 'number');
  check(
    '`lastContactAt` is a timestamp or null, never absent',
    'lastContactAt' in stats && (stats.lastContactAt === null || typeof stats.lastContactAt === 'string'),
  );
  check('the callback block names its path', stats.callback?.path === '/iclock/cdata');
  check('the callback block counts records', typeof stats.callback?.records === 'number');
  check('the callback block counts handshakes', typeof stats.callback?.handshakes === 'number');
} finally {
  await app.close();

  /**
   * Cleanup reports what it could not remove.
   *
   * A cleanup that hides its own failures turns every leftover row into the same investigation
   * later, so each table is named rather than swept behind one `try`.
   */
  const sweep = async (what: string, run: () => Promise<unknown>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      failures += 1;
      console.log(`  FAIL cleanup: ${what} — ${error instanceof Error ? error.message : 'ralat'}`);
    }
  };

  const prisma = db();
  if (devices.length > 0) {
    await sweep('sync state', () =>
      prisma.deviceSyncState.deleteMany({ where: { deviceId: { in: devices } } }),
    );
    await sweep('devices', () => prisma.device.deleteMany({ where: { id: { in: devices } } }));
  }
  if (agents.length > 0) {
    await sweep('connectors', () => prisma.deviceAgent.deleteMany({ where: { id: { in: agents } } }));
  }
  if (staffIds.length > 0) {
    // Accounts and their sessions cascade from the staff row.
    await sweep('staff', () => prisma.staff.deleteMany({ where: { id: { in: staffIds } } }));
  }
  if (roles.length > 0) {
    await sweep('roles', () => prisma.role.deleteMany({ where: { id: { in: roles } } }));
  }

  await disconnectDb();
}

console.log(failures === 0 ? '\nSemua lulus' : `\n${String(failures)} semakan GAGAL`);
process.exit(failures === 0 ? 0 : 1);
