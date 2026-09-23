import { DeviceStatus, type AgentDeviceReport } from '@attendance/shared';

/**
 * What this connector currently knows about each terminal it serves.
 *
 * Exists because the cloud cannot find any of this out for itself — that is the whole reason
 * there is a connector — so the heartbeat is the only channel, and this is what it carries.
 *
 * ## Both a push and a successful pull count as alive
 *
 * A terminal that is actively posting events is plainly working, even if a pull happened to fail
 * a moment ago. Judging liveness only on our ability to call the unit is how the server once
 * marked a device offline while it was delivering attendance, which is both wrong and alarming
 * to whoever is reading the dashboard. So the two are recorded separately and the newer one wins.
 */

interface Observed {
  lastPushAt: Date | null;
  lastPullAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  clockDriftS: number | null;
  serialNumber: string | null;
  firmware: string | null;
  model: string | null;
  /** Order of the last contact and the last failure. See `tick` below. */
  contactSeq: number;
  errorSeq: number;
}

const empty = (): Observed => ({
  lastPushAt: null,
  lastPullAt: null,
  lastError: null,
  lastErrorAt: null,
  clockDriftS: null,
  serialNumber: null,
  firmware: null,
  model: null,
  contactSeq: 0,
  errorSeq: 0,
});

/**
 * Ordering counter, because timestamps are not fine enough to order these events.
 *
 * `Date.now()` has millisecond resolution, and a pull that fails immediately after a push lands
 * in the same millisecond — so comparing the two timestamps found them equal and the terminal
 * kept reporting `online` while its last attempt had failed. A test caught it; a site would have
 * shown a dashboard that was quietly one state behind.
 *
 * Timestamps are still recorded and reported, because "when" is what a person reading the screen
 * wants. They are just not what decides which happened last.
 */
let sequence = 0;
const tick = (): number => (sequence += 1);

export class SiteState {
  private devices = new Map<number, Observed>();

  private entry(deviceId: number): Observed {
    let existing = this.devices.get(deviceId);
    if (!existing) {
      existing = empty();
      this.devices.set(deviceId, existing);
    }
    return existing;
  }

  notePush(deviceId: number): void {
    const state = this.entry(deviceId);
    state.lastPushAt = new Date();
    state.contactSeq = tick();
    // A push that authenticated clears a previous failure: the unit is demonstrably reachable.
    state.lastError = null;
    state.lastErrorAt = null;
    state.errorSeq = 0;
  }

  notePullSuccess(deviceId: number): void {
    const state = this.entry(deviceId);
    state.lastPullAt = new Date();
    state.contactSeq = tick();
    state.lastError = null;
    state.lastErrorAt = null;
    state.errorSeq = 0;
  }

  notePullFailure(deviceId: number, message: string): void {
    const state = this.entry(deviceId);
    state.lastError = message.slice(0, 500);
    state.lastErrorAt = new Date();
    state.errorSeq = tick();
  }

  /** Identity fields read from the unit, so the devices screen stops showing blanks. */
  noteIdentity(
    deviceId: number,
    fields: { serialNumber?: string | null; firmware?: string | null; model?: string | null },
  ): void {
    const state = this.entry(deviceId);
    if (fields.serialNumber !== undefined) state.serialNumber = fields.serialNumber;
    if (fields.firmware !== undefined) state.firmware = fields.firmware;
    if (fields.model !== undefined) state.model = fields.model;
  }

  noteClockDrift(deviceId: number, seconds: number | null): void {
    this.entry(deviceId).clockDriftS = seconds;
  }

  /** Drops terminals no longer assigned here, so a stale row cannot keep being reported. */
  retain(deviceIds: number[]): void {
    const keep = new Set(deviceIds);
    for (const id of [...this.devices.keys()]) {
      if (!keep.has(id)) this.devices.delete(id);
    }
  }

  /**
   * The report for one terminal.
   *
   * `unknown` rather than `offline` when nothing has been observed yet. A connector that has just
   * started has no basis for calling a terminal dead, and reporting one would put a false alarm
   * on the dashboard every time the service restarts.
   */
  report(deviceId: number): AgentDeviceReport {
    const state = this.devices.get(deviceId) ?? empty();

    const lastSeenAt = newer(state.lastPushAt, state.lastPullAt);
    // Ordered on the counter, not the clock. Two of these routinely land in one millisecond.
    const failedMoreRecently = state.errorSeq > state.contactSeq;

    let status: AgentDeviceReport['status'] = DeviceStatus.unknown;
    if (failedMoreRecently) status = DeviceStatus.offline;
    else if (lastSeenAt !== null) status = DeviceStatus.online;

    return {
      deviceId,
      status,
      clockDriftS: state.clockDriftS,
      lastSeenAt,
      lastError: failedMoreRecently ? state.lastError : null,
      serialNumber: state.serialNumber,
      firmware: state.firmware,
      model: state.model,
    };
  }
}

function newer(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() >= b.getTime() ? a : b;
}
