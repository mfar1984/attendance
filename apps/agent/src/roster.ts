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
  driver: TerminalDriver;
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

      if (existing) void existing.driver.close();

      const driver = buildDriver(assignment);
      if (!driver) continue;

      next.set(assignment.deviceId, { assignment, driver, fingerprint });
    }

    for (const [deviceId, entry] of this.entries) {
      if (!next.has(deviceId)) {
        logger().info({ deviceId }, 'Terminal is no longer assigned to this connector');
        void entry.driver.close();
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
    const drivers = this.all().map((entry) => entry.driver);
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

/**
 * Builds the driver for one assignment, or refuses with a reason.
 *
 * Only ISAPI for now, and that limit is stated rather than papered over. The ZKTeco TA Push
 * driver performs every write by inserting into the cloud's command queue, which this process
 * has no access to, and its command strings have never been checked against a real SenseFace.
 * A connector that claimed to support it would produce a site that looks healthy and records
 * nothing, which is the failure this whole system exists to prevent.
 */
function buildDriver(assignment: AgentDeviceAssignment): TerminalDriver | null {
  if (assignment.protocol !== DeviceProtocol.isapi) {
    logger().warn(
      { deviceId: assignment.deviceId, protocol: assignment.protocol },
      'This connector has no driver for that protocol, so the terminal is not served here',
    );
    return null;
  }

  if (assignment.username === null || assignment.password === null) {
    logger().warn(
      { deviceId: assignment.deviceId },
      'Terminal has no stored credential, so it cannot be reached',
    );
    return null;
  }

  const scheme = assignment.useHttps ? 'https' : 'http';
  return new HikvisionDriver(
    new HikvisionClient({
      baseUrl: `${scheme}://${assignment.host}:${assignment.port}`,
      username: assignment.username,
      password: assignment.password,
      verifyTls: assignment.verifyTls,
      timeoutMs: 15_000,
    }),
  );
}
