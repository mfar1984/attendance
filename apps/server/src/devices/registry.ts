import { HikvisionClient } from '@attendance/hik-isapi';
import { DeviceProtocol } from '@attendance/shared';
import type { Device } from '@prisma/client';

import { decryptSecret } from '../crypto.js';
import { conflict } from '../http.js';
import type { TerminalDriver } from '@attendance/terminal-drivers';
import { HikvisionDriver } from '@attendance/terminal-drivers';
import { AgentProxyDriver } from './drivers/agent-proxy.js';
import { ZktecoTaPushDriver } from './drivers/zkteco/driver.js';

/**
 * One long-lived driver per terminal.
 *
 * The single place in the server that decides how to talk to a unit, which is what makes
 * multi-vendor support a routing question rather than a rewrite. Nothing else constructs a
 * client or a driver.
 *
 * Caching is not an optimisation. Each driver holds a cached auth challenge, a connection
 * pool, a request queue and — on Hikvision — the local lockout gate. A fresh driver per call
 * would discard all four, and losing the lockout gate is how a loop over 5000 staff locks an
 * operator out of their own door controller.
 */
const drivers = new Map<number, { driver: TerminalDriver; fingerprint: string }>();

/**
 * The driver for a terminal, or a refusal explaining why there is none.
 *
 * Dispatches on `protocol` rather than `vendor`, because one manufacturer ships several and
 * they are not interchangeable — ZKTeco alone has TA Push, AC Push, BEST and a legacy binary
 * protocol, and a SenseFace 3A supports a different subset than an older unit.
 */
export function driverFor(device: Device): TerminalDriver {
  const fingerprint = connectionFingerprint(device);

  const existing = drivers.get(device.id);
  if (existing && existing.fingerprint === fingerprint) {
    return existing.driver;
  }

  // Connection details changed, so the cached driver points somewhere stale.
  if (existing) void existing.driver.close();

  const driver = build(device);
  drivers.set(device.id, { driver, fingerprint });
  return driver;
}

function build(device: Device): TerminalDriver {
  /**
   * A terminal behind an on-site connector is not ours to reach, whatever it speaks.
   *
   * Checked before the protocol switch, because the protocol is still ISAPI — it is the same unit
   * speaking the same language, and only the thing holding the socket has moved. Dispatching on
   * protocol first would build a Hikvision driver that opens a socket to a private address this
   * host cannot route, and every write would fail as a device fault.
   *
   * The proxy queues instead. The connector collects the work and runs the real driver on the LAN.
   */
  if (device.agentId !== null) return new AgentProxyDriver(device);

  switch (device.protocol) {
    case DeviceProtocol.isapi:
      return new HikvisionDriver(isapiClient(device));

    case DeviceProtocol.taPush:
      /**
       * Built from the device row rather than a connection.
       *
       * There is nothing to connect to: this protocol has the terminal calling us. The driver
       * needs the record because every read it can answer is served from what the unit last
       * reported, and because its capability list depends on the firmware version stored there.
       *
       * Which also means the cache fingerprint has to include the fields the capabilities are
       * derived from — otherwise a unit that reports a newer firmware on its next handshake
       * would keep the driver that declared face upload unavailable.
       */
      return new ZktecoTaPushDriver(device);

    default:
      /**
       * A registered vendor whose driver is not built yet, or a value written by hand.
       *
       * Named in the message on purpose. The alternative — a driver that silently does
       * nothing — produces a terminal that reports healthy, accepts enrolments, and never
       * sees anybody, which is worse than one that plainly refuses.
       */
      throw conflict(
        `Terminal "${device.name}" menggunakan protokol "${device.protocol}", ` +
          'yang belum ada pemandu dalam sistem ini. Pilih protokol yang disokong di ' +
          'Tetapan › Senarai Peranti.',
      );
  }
}

function isapiClient(device: Device): HikvisionClient {
  /**
   * Credentials are nullable on `Device` because callback protocols have none — TA Push
   * identifies a unit by its serial number. So their absence is a legitimate state to
   * describe rather than one to paper over with an empty string, which would reach the wire,
   * fail authentication, and count towards the firmware's lockout threshold.
   */
  if (device.username === null || device.passwordEncrypted === null) {
    throw conflict(
      `Terminal "${device.name}" tiada kredensial ISAPI tersimpan, jadi ia tidak boleh ` +
        'dihubungi. Kemas kini nama pengguna dan kata laluan peranti di ' +
        'Tetapan › Senarai Peranti.',
    );
  }

  const scheme = device.useHttps ? 'https' : 'http';
  return new HikvisionClient({
    baseUrl: `${scheme}://${device.host}:${device.port}`,
    username: device.username,
    password: decryptSecret(device.passwordEncrypted),
    verifyTls: device.verifyTls,
    timeoutMs: 15_000,
  });
}

/**
 * What a cached driver is keyed on.
 *
 * `protocol` is included so that changing it rebuilds the driver rather than reusing one that
 * speaks the wrong language to the same address.
 */
function connectionFingerprint(device: Device): string {
  return [
    /**
     * Included so moving a terminal between direct and connector rebuilds the driver.
     *
     * Without it, a device reassigned to a connector would keep the cached Hikvision driver and
     * keep trying to open a socket to an address this host cannot route — and reassigning it back
     * would keep the proxy, queueing commands nobody will ever collect.
     */
    device.agentId,
    device.protocol,
    device.host,
    device.port,
    device.useHttps,
    device.verifyTls,
    device.username,
    device.passwordEncrypted,
    /**
     * Included because a callback driver derives its capability list from these.
     *
     * A ZKTeco unit reporting a newer firmware on its next handshake must get a driver that
     * knows face upload is now available. Keyed only on connection details, the cached driver
     * would keep declaring it unavailable until the process restarted — and the screen would
     * keep telling somebody to walk to the terminal.
     */
    device.firmware,
    device.serialNumber,
  ].join('|');
}

/**
 * The raw ISAPI client for a terminal.
 *
 * Retained for the call sites that have not moved to the driver contract yet, and it now
 * refuses anything that is not an ISAPI unit rather than attempting a Digest handshake
 * against a device speaking a different protocol entirely.
 *
 * New code should use `driverFor`. This exists so the migration could be done in reviewable
 * steps instead of one change touching every device operation at once.
 */
export function clientFor(device: Device): HikvisionClient {
  if (device.protocol !== DeviceProtocol.isapi) {
    throw conflict(
      `Terminal "${device.name}" menggunakan protokol "${device.protocol}", ` +
        'yang tidak dihubungi melalui ISAPI. Operasi ini belum disokong untuk protokol itu.',
    );
  }

  const driver = driverFor(device);
  if (!(driver instanceof HikvisionDriver)) {
    throw conflict(`Terminal "${device.name}" bukan unit ISAPI.`);
  }
  return driver.rawClient;
}

export async function releaseClient(deviceId: number): Promise<void> {
  const entry = drivers.get(deviceId);
  if (!entry) return;
  drivers.delete(deviceId);
  await entry.driver.close();
}

export async function releaseAllClients(): Promise<void> {
  const entries = [...drivers.values()];
  drivers.clear();
  await Promise.all(entries.map((entry) => entry.driver.close()));
}
