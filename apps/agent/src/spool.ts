import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { TerminalEventPayload } from '@attendance/shared';

import type { AgentConfig } from './config.js';

/**
 * Events held on disk until the cloud has accepted them.
 *
 * ## Why there is a spool at all
 *
 * A terminal pushes an event once and never retries — the firmware keeps no queue. So between
 * the moment this connector answers `200` to a unit and the moment the cloud accepts the batch,
 * this process is the only place that event exists. A restart, a power cut, or an hour of
 * upstream outage in that window loses it, and nothing on any screen would say so: a lost scan
 * looks exactly like a quiet morning.
 *
 * With a spool the contract becomes plain. Once accepted from a terminal, the event is written
 * before the response, and it is deleted only after the cloud has taken it. The failure mode
 * left is a duplicate delivery, which the cloud already handles by deduplicating on `eventKey`.
 *
 * ## Why SQLite from `node:sqlite`
 *
 * Built into Node, so there is no native module to compile on an arm64 Raspberry Pi and no
 * prebuild that has to exist for the right glibc. That lesson was paid for once already: the
 * password hash on this project had to be rewritten because a native module's prebuild needed a
 * newer glibc than the host had, and a dependency that cannot load is worse than one that is
 * slower. Only insert, ordered select and delete are used here — the smallest and most settled
 * part of that API.
 *
 * It emits an experimental warning on startup; the systemd unit silences it, because a warning
 * on every boot teaches whoever reads the journal to skip it.
 */

export interface SpooledEvent {
  id: number;
  deviceId: number;
  arrivedVia: 'push' | 'pull';
  event: TerminalEventPayload;
}

/** A homogeneous run of events, which is the shape the cloud endpoint accepts. */
export interface SpoolBatch {
  deviceId: number;
  arrivedVia: 'push' | 'pull';
  ids: number[];
  events: TerminalEventPayload[];
}

export class Spool {
  private readonly db: DatabaseSync;

  constructor(config: AgentConfig) {
    mkdirSync(config.STATE_DIR, { recursive: true });
    this.db = new DatabaseSync(join(config.STATE_DIR, 'spool.sqlite'));

    /*
     * WAL so a reader never blocks the writer, and FULL synchronous because this file exists
     * specifically to survive losing power. NORMAL would leave the most recent transactions at
     * risk, which is precisely the window the spool was added to close. The volume makes it
     * affordable: a site of five thousand staff produces on the order of one write every few
     * seconds, not thousands.
     */
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = FULL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        deviceId   INTEGER NOT NULL,
        arrivedVia TEXT    NOT NULL,
        event      TEXT    NOT NULL,
        createdAt  INTEGER NOT NULL
      )
    `);
    // Delivery is oldest-first across the whole spool, so one terminal that went offline for a
    // day cannot sit behind another's backlog forever.
    this.db.exec('CREATE INDEX IF NOT EXISTS pending_order ON pending (id)');

    /*
     * Pull cursors, kept here rather than only in memory.
     *
     * The cloud reports a cursor with every roster, but that one only advances when the cloud has
     * *stored* events — so it sits behind whatever this connector has spooled and not yet
     * delivered. Re-seeding from it on every restart would re-pull that gap: harmless, because
     * the cloud deduplicates on `eventKey`, but it is a burst of paged ISAPI searches across
     * every terminal at exactly the moment the process is also reconnecting everything else.
     */
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cursor (
        deviceId INTEGER PRIMARY KEY,
        sequence INTEGER,
        since    TEXT
      )
    `);
  }

  /** The furthest point this connector has pulled for a terminal, if it has pulled at all. */
  cursorFor(deviceId: number): { sequence: number | null; since: string | null } | null {
    const row = this.db
      .prepare('SELECT sequence, since FROM cursor WHERE deviceId = ?')
      .get(deviceId) as { sequence: number | null; since: string | null } | undefined;
    return row ?? null;
  }

  saveCursor(deviceId: number, sequence: number | null, since: string | null): void {
    this.db
      .prepare(
        `INSERT INTO cursor (deviceId, sequence, since) VALUES (?, ?, ?)
           ON CONFLICT(deviceId) DO UPDATE SET sequence = excluded.sequence, since = excluded.since`,
      )
      .run(deviceId, sequence, since);
  }

  /**
   * Records one event. Called before the terminal is answered.
   *
   * Synchronous, and that is the point rather than an inconvenience: returning `200` to a unit
   * before the write has landed would mean acknowledging an event this process might not have.
   */
  add(deviceId: number, arrivedVia: 'push' | 'pull', event: TerminalEventPayload): void {
    this.db
      .prepare('INSERT INTO pending (deviceId, arrivedVia, event, createdAt) VALUES (?, ?, ?, ?)')
      .run(deviceId, arrivedVia, JSON.stringify(event), Date.now());
  }

  /**
   * The next batch to send, all from one terminal and one arrival path.
   *
   * Homogeneous because that is what the cloud endpoint accepts, and taken from the oldest row
   * forward so ordering within a terminal is preserved. Events for a device arrive in time
   * order and the suppression window downstream depends on seeing them that way.
   */
  next(limit: number): SpoolBatch | null {
    const head = this.db
      .prepare('SELECT id, deviceId, arrivedVia FROM pending ORDER BY id ASC LIMIT 1')
      .get() as { id: number; deviceId: number; arrivedVia: string } | undefined;

    if (!head) return null;

    const rows = this.db
      .prepare(
        `SELECT id, event FROM pending
          WHERE deviceId = ? AND arrivedVia = ? AND id >= ?
          ORDER BY id ASC
          LIMIT ?`,
      )
      .all(head.deviceId, head.arrivedVia, head.id, limit) as Array<{ id: number; event: string }>;

    const ids: number[] = [];
    const events: TerminalEventPayload[] = [];
    for (const row of rows) {
      ids.push(row.id);
      events.push(JSON.parse(row.event) as TerminalEventPayload);
    }

    return {
      deviceId: head.deviceId,
      arrivedVia: head.arrivedVia === 'pull' ? 'pull' : 'push',
      ids,
      events,
    };
  }

  /** Drops delivered rows. Called only after the cloud answered 200. */
  remove(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`DELETE FROM pending WHERE id IN (${placeholders})`).run(...ids);
  }

  /**
   * Discards a batch the cloud refused as unacceptable.
   *
   * Separate from `remove` so the two reasons for deleting cannot be confused at the call site.
   * A `400` means this event will be refused every time it is offered, so retrying it forever
   * blocks every event behind it — the spool would stop draining and the site would go quiet
   * with a full disk as the only symptom. Dropping it loses one record, and the log line naming
   * it is what makes that recoverable.
   */
  discard(ids: number[]): void {
    this.remove(ids);
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM pending').get() as { n: number };
    return row.n;
  }

  /** Oldest undelivered event, for reporting how far behind a site is. */
  oldestAgeMs(): number | null {
    const row = this.db.prepare('SELECT MIN(createdAt) AS oldest FROM pending').get() as {
      oldest: number | null;
    };
    return row.oldest === null ? null : Date.now() - row.oldest;
  }

  close(): void {
    this.db.close();
  }
}
