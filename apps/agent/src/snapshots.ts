import { SnapshotKind, type AgentSnapshot } from '@attendance/shared';
import { DriverOperation, supports, type TerminalDriver } from '@attendance/terminal-drivers';

import type { Cloud } from './cloud.js';
import { logger } from './logging.js';
import type { Roster } from './roster.js';

/**
 * Reads what each terminal says about itself and reports it to the cloud.
 *
 * This exists because the cloud cannot ask. A connector collects commands and does not serve
 * reads — a browser request cannot wait for the next poll — so the device editor had nothing to
 * show for a connector site: six tabs of empty fields, each explaining that the value could not
 * be read. Every tab an operator opens has to hold data, and this is what puts it there.
 *
 * ## Why a slow timer of its own
 *
 * These values move when somebody edits a setting, which is rarely, and they are large: identity,
 * door, reader and the option lists together run to several kilobytes per unit. Attaching them to
 * the heartbeat would spend that bandwidth every sixty seconds from every site to carry a value
 * that did not change. So this runs on its own interval, and the cloud stores the last report with
 * the time it was taken.
 *
 * ## One terminal at a time, one kind at a time
 *
 * Not `Promise.all`. These are small embedded boxes that cap concurrent sessions and answer 401
 * without a challenge once that cap is reached — and a full sweep is a dozen reads per unit. The
 * driver serialises per terminal anyway; keeping it sequential here stops a roster-wide sweep
 * opening fifteen units' worth of requests at once on a Raspberry Pi.
 */

export interface SnapshotStats {
  sweeps: number;
  reported: number;
  failed: number;
}

/**
 * One read, wrapped so a refusal becomes a reported condition rather than a thrown sweep.
 *
 * A terminal that cannot answer one of these must not cost the others. Before this was contained,
 * a single unreadable document would abandon the whole pass and leave every tab empty — the exact
 * failure this path was built to remove, reproduced one level up.
 */
async function attempt<T>(
  read: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export class Snapshotter {
  readonly stats: SnapshotStats = { sweeps: 0, reported: 0, failed: 0 };

  constructor(
    private readonly cloud: Cloud,
    private readonly roster: Roster,
  ) {}

  /** One pass over every terminal this connector serves. */
  async runOnce(): Promise<void> {
    this.stats.sweeps += 1;

    for (const entry of this.roster.all()) {
      const snapshots = await this.collect(entry.driver, entry.assignment.doorNo);
      if (snapshots.length === 0) continue;

      const result = await this.cloud.snapshots({
        deviceId: entry.assignment.deviceId,
        snapshots,
      });

      if (!result.ok) {
        /*
         * Not spooled, and that is the difference between this and an event.
         *
         * A missed scan is gone forever, so events are written to disk before they are
         * acknowledged. A snapshot is a re-readable fact: the next sweep produces a fresher one,
         * so holding a stale copy on disk to deliver later would be worse than dropping it.
         */
        if (result.failure.kind !== 'unreachable') {
          logger().warn(
            { deviceId: entry.assignment.deviceId, failure: result.failure },
            'Could not report terminal settings',
          );
        }
        continue;
      }

      this.stats.reported += snapshots.length;
      this.stats.failed += snapshots.filter((snapshot) => snapshot.error !== null).length;
    }
  }

  /**
   * Every kind this driver can produce, grouped the way the editor's tabs are.
   *
   * Grouped by tab rather than by vendor endpoint because the tab is what an operator opens and
   * what has to be either populated or honestly empty. One tab needs several reads — the door tab
   * wants door settings, reader settings and the option lists the firmware publishes — and
   * reporting those separately would leave the screen assembling one picture from parts that
   * arrived at different times.
   */
  private async collect(driver: TerminalDriver, doorNo: number): Promise<AgentSnapshot[]> {
    const out: AgentSnapshot[] = [];

    /** Skipped rather than reported as failed: an unsupported read is not a fault. */
    const can = (operation: DriverOperation): boolean => supports(driver.capabilities, operation);

    const push = (kind: SnapshotKind, result: Awaited<ReturnType<typeof attempt>>): void => {
      out.push(
        result.ok
          ? { kind, payload: result.value, readAt: new Date(), error: null }
          : { kind, readAt: null, error: result.error.slice(0, 500) },
      );
    };

    if (can(DriverOperation.readIdentity)) {
      /*
       * Four reads into one snapshot, and a partial answer is still worth storing.
       *
       * The unit tab shows model, firmware, serial, the credential breakdown and the face
       * libraries together. If capacity is unreadable but identity is not, the screen should show
       * the model rather than nothing — so each piece is attempted and nulls stand for the ones
       * that refused.
       */
      const identity = await attempt(() => driver.identity.read());
      const counts = await attempt(() => driver.identity.counts());
      const capacity = await attempt(() => driver.identity.capacity());
      const faceStores = await attempt(() => driver.identity.faceStores());

      if (!identity.ok && !counts.ok && !capacity.ok) {
        push(SnapshotKind.identity, identity);
      } else {
        out.push({
          kind: SnapshotKind.identity,
          payload: {
            identity: identity.ok ? identity.value : null,
            counts: counts.ok ? counts.value : null,
            capacity: capacity.ok ? capacity.value : null,
            faceStores: faceStores.ok ? faceStores.value : [],
          },
          readAt: new Date(),
          error: null,
        });
      }
    }

    if (can(DriverOperation.readClock)) {
      push(SnapshotKind.clock, await attempt(() => driver.clock.read()));
    }

    if (can(DriverOperation.readAttendanceMode)) {
      push(SnapshotKind.attendance, await attempt(() => driver.attendance.mode()));
    }

    if (can(DriverOperation.readDoorSettings)) {
      const door = await attempt(() => driver.access.door(doorNo));
      const reader = await attempt(() => driver.access.reader(1));
      const options = await attempt(() => driver.access.options());

      if (!door.ok && !reader.ok) {
        push(SnapshotKind.door, door);
      } else {
        out.push({
          kind: SnapshotKind.door,
          payload: {
            door: door.ok ? door.value : null,
            reader: reader.ok ? reader.value : null,
            options: options.ok ? options.value : {},
          },
          readAt: new Date(),
          error: null,
        });
      }
    }

    if (can(DriverOperation.readCallbackTargets)) {
      push(SnapshotKind.push, await attempt(() => driver.lifecycle.callbackTargets()));
    }

    /*
     * Vendor warnings ride the diagnostics snapshot.
     *
     * The contract says `vendorWarnings` must not throw for a diagnostic that is merely
     * unavailable, so an empty list is the honest answer and there is nothing to report as failed.
     * It is the one read here the cloud genuinely cannot substitute: the neutral checks live in
     * the health module, and this is for faults that are real but vendor-shaped.
     */
    const warnings = await attempt(() => driver.vendorWarnings());
    out.push(
      warnings.ok
        ? {
            kind: SnapshotKind.diagnostics,
            payload: { warnings: warnings.value, capabilities: driver.capabilities },
            readAt: new Date(),
            error: null,
          }
        : { kind: SnapshotKind.diagnostics, readAt: null, error: warnings.error.slice(0, 500) },
    );

    return out;
  }
}
