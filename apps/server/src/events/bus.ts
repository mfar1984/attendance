import { EventEmitter } from 'node:events';

/**
 * In-process fan-out for live updates.
 *
 * Deliberately not a queue or a broker. Live monitoring is best-effort: a browser
 * that misses a message simply refetches, and the durable record is already in
 * `raw_events`. Introducing Redis here would add a service that must be running
 * for the LAN deployment to boot, in exchange for nothing.
 *
 * This does mean live updates do not survive a horizontal scale-out. If the server
 * is ever run as more than one process, this needs replacing with a shared
 * channel; nothing else in the system depends on it.
 */
export interface LiveScan {
  punchId: number | null;
  rawEventId: string;
  /**
   * Dedup key for this event on this device, and what the monitor keys rows on.
   *
   * Replaces `serialNo` in that role. A callback protocol such as ZKTeco TA Push has
   * no monotonic sequence, so every scan on one device would arrive with the same
   * null sequence and collapse into a single row overwriting itself.
   */
  eventKey: string;
  /** The terminal's own sequence, for display. Null where the protocol has none. */
  serialNo: string | null;
  at: string;
  deviceId: number;
  deviceName: string;
  staffId: number | null;
  employeeNo: string | null;
  name: string | null;
  method: string;
  direction: string;
  suppressed: boolean;
  /** Set when the scan could not be attributed to anybody. */
  problem: string | null;
}

export interface LiveDeviceStatus {
  deviceId: number;
  deviceName: string;
  status: string;
  clockDriftSeconds: number | null;
}

interface Events {
  scan: [LiveScan];
  deviceStatus: [LiveDeviceStatus];
}

class LiveBus extends EventEmitter<Events> {
  constructor() {
    super();
    // One listener per connected browser tab. The default ceiling of ten would
    // start printing warnings with a handful of operators watching the monitor.
    this.setMaxListeners(200);
  }
}

export const liveBus = new LiveBus();
