import { HikvisionClient } from '@attendance/hik-isapi';
import { DeviceProtocol, type AgentDeviceAssignment } from '@attendance/shared';
import { HikvisionDriver, type TerminalDriver } from '@attendance/terminal-drivers';

import { logger } from './logging.js';

/**
 * The terminals this connector serves, and one long-lived driver per terminal.
 *
 * The roster arrives with every heartbeat rather than being configured locally. That means a
 * terminal added, moved or re-credentialled on the devices screen reaches the site without
 * anybody visiting it — and it means there is one place where the answer lives, so a connector
 * and the cloud cannot hold different ideas about which units exist.
 *
 * ## Driver caching is not an optimisation
 *
 * Each driver holds a cached Digest challenge, a connection pool, a serialised request queue and
 * the local lockout gate. Losing that gate is how a loop over five thousand staff locks an
 * operator out of their own door controller, because this firmware locks the account for thirty
 * minutes after a handful of refused credentials. So drivers are kept and only rebuilt when the
 * connection details actually change — which is the same reason, and the same fingerprint, as
 * the server's own registry.
 */

interface Entry {
  assignment: AgentDeviceAssignment;
  /**
   * Null for a protocol the connector does not dial.
   *
   * TA Push has the terminal collecting its own work, so there is genuinely nothing to call — and
   * a stub driver that rejected every method would be a lie with a shape, which the puller and
   * the snapshot sweep would both have to interrogate anyway. Null says it once.
   */
  driver: TerminalDriver | null;
  fingerprint: string;
}

export class Roster {
  private entries = new Map<number, Entry>();

  /**
   * Replaces the roster with what the cloud just reported.
   *
   * Terminals no longer listed have their drivers closed, which releases sockets to a unit this
   * connector is no longer responsible for. Leaving them open would keep a session occupied on
   * a device that another connector may now be serving, and these units cap concurrent sessions.
   */
  replace(assignments: AgentDeviceAssignment[]): void {
    const next = new Map<number, Entry>();

    for (const assignment of assignments) {
      const fingerprint = fingerprintOf(assignment);
      const existing = this.entries.get(assignment.deviceId);

      if (existing && existing.fingerprint === fingerprint) {
        // Same connection, so keep the driver and its lockout gate; refresh the cursor only.
        next.set(assignment.deviceId, { ...existing, assignment });
        continue;
      }

      if (existing) void existing.driver?.close();

      const built = buildDriver(assignment);
      if (!built.served) continue;

      next.set(assignment.deviceId, { assignment, driver: built.driver, fingerprint });
    }

    for (const [deviceId, entry] of this.entries) {
      if (!next.has(deviceId)) {
        logger().info({ deviceId }, 'Terminal is no longer assigned to this connector');
        void entry.driver?.close();
      }
    }

    this.entries = next;
  }

  get(deviceId: number): Entry | undefined {
    return this.entries.get(deviceId);
  }

  all(): Entry[] {
    return [...this.entries.values()];
  }

  /**
   * Finds a terminal by the address a push arrived from.
   *
   * Push bodies carry the unit's own view of its address, and the cloud resolves a device by MAC
   * first for that reason. Here the connector has less to go on, so both the reported address
   * and the socket's peer address are tried — a unit behind nothing on a flat LAN will match on
   * either, and a mismatch is worth a log line rather than a silent drop.
   */
  findByAddress(...candidates: Array<string | undefined>): Entry | undefined {
    for (const candidate of candidates) {
      if (!candidate) continue;
      const bare = candidate.replace(/^::ffff:/, '');
      for (const entry of this.entries.values()) {
        if (entry.assignment.host === bare) return entry;
      }
    }
    return undefined;
  }

  /** Finds a terminal by serial number, which is how callback protocols identify themselves. */
  findBySerial(serial: string): Entry | undefined {
    const wanted = serial.trim();
    for (const entry of this.entries.values()) {
      if (entry.assignment.serialNumber === wanted) return entry;
    }
    return undefined;
  }

  async closeAll(): Promise<void> {
    const drivers = this.all()
      .map((entry) => entry.driver)
      .filter((driver): driver is TerminalDriver => driver !== null);
    this.entries.clear();
    await Promise.all(drivers.map((driver) => driver.close()));
  }
}

/**
 * Keyed on everything a connection depends on.
 *
 * The cursor is deliberately excluded: it changes on every heartbeat, and rebuilding the driver
 * each time would discard the lockout gate sixty times an hour.
 */
function fingerprintOf(assignment: AgentDeviceAssignment): string {
  return [
    assignment.protocol,
    assignment.host,
    assignment.port,
    assignment.useHttps,
    assignment.verifyTls,
    assignment.username,
    assignment.password,
    assignment.firmware,
    assignment.serialNumber,
  ].join('|');
}

/** Protocols this build can serve. Reported on every heartbeat so the cloud can flag a mismatch. */
export const SUPPORTED_PROTOCOLS: readonly string[] = [
  DeviceProtocol.isapi,
  DeviceProtocol.taPush,
];

/**
 * Whether this connector serves the terminal at all, and the driver to reach it with.
 *
 * Two outcomes rather than one, because "served with no driver" is a real state. A callback
 * terminal belongs on this roster — the listener matches its serial to find it, and the relay
 * holds its commands — while nothing here ever dials it. Collapsing that into a null driver
 * meaning "not served" is what kept TA Push units off the roster entirely, so their pushes were
 * discarded as coming from a terminal this connector does not serve.
 */
function buildDriver(
  assignment: AgentDeviceAssignment,
): { served: boolean; driver: TerminalDriver | null } {
  /**
   * Served, with nothing to dial.
   *
   * The terminal posts its scans to this connector's own listener and collects its own work, so
   * the connector needs its serial number and nothing else. A unit with no serial cannot be
   * matched to anything it sends, which is a cloud-side configuration gap rather than a connector
   * one — so it is named here and left off the roster, because serving it would mean accepting
   * pushes that can never be attributed.
   */
  if (assignment.protocol === DeviceProtocol.taPush) {
    if (assignment.serialNumber === null || assignment.serialNumber.trim() === '') {
      logger().warn(
        { deviceId: assignment.deviceId },
        'Callback terminal has no serial number, so its pushes could not be matched; not served',
      );
      return { served: false, driver: null };
    }
    return { served: true, driver: null };
  }

  if (assignment.protocol !== DeviceProtocol.isapi) {
    logger().warn(
      { deviceId: assignment.deviceId, protocol: assignment.protocol },
      'This connector has no driver for that protocol, so the terminal is not served here',
    );
    return { served: false, driver: null };
  }

  if (assignment.username === null || assignment.password === null) {
    logger().warn(
      { deviceId: assignment.deviceId },
      'Terminal has no stored credential, so it cannot be reached',
    );
    return { served: false, driver: null };
  }

  const scheme = assignment.useHttps ? 'https' : 'http';
  return {
    served: true,
    driver: new HikvisionDriver(
      new HikvisionClient({
        baseUrl: `${scheme}://${assignment.host}:${assignment.port}`,
        username: assignment.username,
        password: assignment.password,
        verifyTls: assignment.verifyTls,
        timeoutMs: 15_000,
      }),
    ),
  };
}
