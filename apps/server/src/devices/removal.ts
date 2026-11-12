import type { LabelKey } from '@attendance/shared';

import { db } from '../db.js';
import { conflict } from '../http.js';

/**
 * Whether a terminal record may be deleted, and what refuses it.
 *
 * One module because the list and the delete route have to answer the same question. The screen
 * greys the control out and names the reason, and the route refuses — if those two read different
 * rules, the control is enabled on a terminal the server will not delete, which is exactly the
 * pattern `ui-layout` forbids ("Tindakan memusnah dimatikan dengan sebab dalam tooltip. Bukan
 * hidup lalu pulangkan 409").
 *
 * ## Why this counts instead of letting the cascade work
 *
 * Seven tables reference `devices` with `onDelete: Cascade`, and `punches` with `SetNull`. So a
 * bare `prisma.device.delete()` would take the raw event log with it, silently — the log this
 * system treats as append-only evidence, and the only thing that settles a payroll dispute. The
 * refusal therefore comes from counting rows here, before anything is deleted. The database
 * constraint cannot be the guard: its job is to cascade, and it does it without being asked.
 *
 * **`attendance_exceptions` has no foreign key at all.** `deviceId` there is a plain integer
 * column — the model declares no `device` relation, and `Device` declares no `exceptions`. So
 * nothing in the database would refuse, and nothing would cascade: the rows would simply be left
 * pointing at an id that no longer resolves, and the exceptions screen — which maps ids to names
 * with its own `device.findMany` — would stop naming the terminal that raised them. That makes
 * the check below the only thing standing between a delete and a reviewed exception losing its
 * provenance.
 *
 * ## What blocks, and what goes with the terminal
 *
 * The line is whether a row holds something a human wrote or a terminal reported that nothing can
 * reconstruct.
 *
 * | Table | | Why |
 * |---|---|---|
 * | `raw_events` | blocks | The verbatim device log. No update or delete path exists for it anywhere in the application, by design. |
 * | `punches` | blocks | What the terminal reported, as attendance. Its relation is `SetNull`, so a cascade would not delete these — it would orphan them, and a punch that no longer says which terminal recorded it is evidence with its provenance removed. |
 * | `attendance_exceptions` | blocks | Carries `resolutionNote`, written by a person, which is what answers a dispute later. Not re-derivable, and not protected by a constraint (above). |
 * | `device_enrolments` | blocks | The only record of who was pushed onto a unit, and each row carries a human's `confirmed`/`confirmedBy`. A terminal may still be on a wall holding those faces. The count is already on screen as the Didaftar column, so the blocker can name a number the operator recognises. It names no remedy, deliberately: nothing on any screen clears a mapping. `DELETE /api/identity/map/:deviceId/:deviceEmployeeNo` has no caller in the web app, `mapDeviceUser` upserts so re-pairing does not lower the count, and `GET /api/identity/devices` filters `active: true` — by the time this blocker is the one standing, the terminal has been deactivated and is no longer on that screen at all. The rows do go when the *staff member* is deactivated (`staff/sync.ts`), which is not a step anybody should take to tidy up a device row. So a duplicate that auto-paired staff during a user-list import stays undeletable, and the wording states that instead of sending somebody to a screen that cannot act on it. |
 * | `device_commands` | deleted | A work queue and its receipts. Every row is either a command nothing will ever collect or the acknowledgement of one already applied to hardware being taken off the register. Nothing derives from it, and a write can be queued again. |
 * | `device_snapshots` | deleted | Declared a cache in the schema: what a connector last read, kept only because the cloud cannot open a socket to a hospital LAN. Re-readable by definition. |
 * | `unmapped_device_users` | deleted | A review queue of identifiers on the terminal's own user list. `scanCount` is a counter, not a record — the scans it counted are raw events, and those block while they exist. The queue points at a terminal that will not exist. |
 * | `device_sync_state` | deleted | The pull cursor and the single-flight flag, one row per device, recreated on demand. Verified in production: the stale row removed by hand had seven zero counts and exactly one of these. |
 *
 * **A new relation to `Device` has to be decided here.** Adding one with `onDelete: Cascade` and
 * not naming it below means it is destroyed by this route without anybody choosing that — which
 * is the failure this whole module exists to prevent.
 *
 * ## A real terminal is never deletable, and that is the intended outcome
 *
 * Both live units hold raw events, so their control stays greyed out with its reason for good.
 * What becomes deletable is a mistake: a row created by a typo that never saw a scan. The wording
 * says so, because a control that is permanently disabled without an explanation reads as a
 * broken feature.
 */

/** Why a terminal cannot be deleted: a registry key, and the count where one is cheap to get. */
export interface RemovalBlocker {
  key: LabelKey;
  vars?: Record<string, number>;
}

export interface DeviceRemoval {
  removable: boolean;
  /** Empty when removable. Evidence first, then the deactivation step — see `blockersFor`. */
  blockers: RemovalBlocker[];
}

/** Bookkeeping rows removed with the terminal, reported so the notice can name what went. */
export interface RemovalSweep {
  syncState: number;
  commands: number;
  snapshots: number;
  unmapped: number;
}

interface Candidate {
  id: number;
  active: boolean;
  /** `_count.enrolments`, which the list query already has. */
  enrolled: number;
}

function blockersFor(
  candidate: Candidate,
  found: { rawEvents: boolean; punches: boolean; exceptions: number },
): RemovalBlocker[] {
  const blockers: RemovalBlocker[] = [];

  /*
   * Evidence before the deactivation step, deliberately.
   *
   * Only the first blocker reaches the tooltip, and "deactivate this first" on a terminal that
   * will still refuse afterwards sends somebody to do a thing that does not help. Ordered this
   * way, a live terminal reads its scan history as the reason, and only a mistake row that is
   * still switched on is told to deactivate.
   */
  if (found.rawEvents) blockers.push({ key: 'device.remove.blocked.rawEvents' });
  if (found.punches) blockers.push({ key: 'device.remove.blocked.punches' });
  if (found.exceptions > 0) {
    blockers.push({ key: 'device.remove.blocked.exceptions', vars: { count: found.exceptions } });
  }
  if (candidate.enrolled > 0) {
    blockers.push({ key: 'device.remove.blocked.enrolments', vars: { count: candidate.enrolled } });
  }
  if (candidate.active) blockers.push({ key: 'device.remove.blocked.active' });

  return blockers;
}

/**
 * Answers for a whole list in a fixed number of queries.
 *
 * `raw_events` and `punches` are asked per device as an existence probe: `deviceId` is the leading
 * column of an index on both, so each is an index seek that stops at the first row. A `COUNT(*)`
 * would be a range scan over however many events that terminal has recorded — unbounded, on a
 * screen three tabs load — which is why those two blockers name no number.
 *
 * `attendance_exceptions` has no index on `deviceId`, so asking per device would be one table scan
 * per row. It is asked once for the whole list instead, and the aggregate hands over the count for
 * free.
 */
export async function removalForAll(
  candidates: Candidate[],
): Promise<Map<number, DeviceRemoval>> {
  const result = new Map<number, DeviceRemoval>();
  if (candidates.length === 0) return result;

  const prisma = db();
  const ids = candidates.map((candidate) => candidate.id);

  const [exceptionGroups, probes] = await Promise.all([
    prisma.attendanceException.groupBy({
      by: ['deviceId'],
      where: { deviceId: { in: ids } },
      _count: { _all: true },
    }),
    Promise.all(
      candidates.map(async (candidate) => {
        const [rawEvent, punch] = await Promise.all([
          prisma.rawEvent.findFirst({ where: { deviceId: candidate.id }, select: { id: true } }),
          prisma.punch.findFirst({ where: { deviceId: candidate.id }, select: { id: true } }),
        ]);
        return { id: candidate.id, rawEvents: rawEvent !== null, punches: punch !== null };
      }),
    ),
  ]);

  const exceptions = new Map<number, number>();
  for (const group of exceptionGroups) {
    if (group.deviceId !== null) exceptions.set(group.deviceId, group._count._all);
  }
  const probed = new Map(probes.map((probe) => [probe.id, probe]));

  for (const candidate of candidates) {
    const blockers = blockersFor(candidate, {
      rawEvents: probed.get(candidate.id)?.rawEvents ?? false,
      punches: probed.get(candidate.id)?.punches ?? false,
      exceptions: exceptions.get(candidate.id) ?? 0,
    });
    result.set(candidate.id, { removable: blockers.length === 0, blockers });
  }

  return result;
}

/**
 * Refuses the delete, in prose, naming every count.
 *
 * Counted exactly here rather than probed, because this runs once on a deliberate action and the
 * message is read by a person deciding what to do about it. The same reason the connector delete
 * counts its assigned terminals: a refusal that does not name a number is not actionable.
 */
export async function assertRemovable(device: {
  id: number;
  name: string;
  active: boolean;
}): Promise<void> {
  const prisma = db();

  const [rawEvents, punches, exceptions, enrolments] = await Promise.all([
    prisma.rawEvent.count({ where: { deviceId: device.id } }),
    prisma.punch.count({ where: { deviceId: device.id } }),
    prisma.attendanceException.count({ where: { deviceId: device.id } }),
    prisma.deviceEnrolment.count({ where: { deviceId: device.id } }),
  ]);

  const referring: string[] = [];
  if (rawEvents > 0) referring.push(`${String(rawEvents)} log scan mentah`);
  if (punches > 0) referring.push(`${String(punches)} punch`);
  if (exceptions > 0) referring.push(`${String(exceptions)} pengecualian kehadiran`);
  if (enrolments > 0) referring.push(`${String(enrolments)} pemetaan staf`);

  if (referring.length > 0) {
    throw conflict(
      `"${device.name}" masih dirujuk oleh ${referring.join(', ')}, jadi ia tidak boleh dibuang. ` +
        'Baris itu adalah bukti bagi kehadiran yang dikira daripadanya, dan tiada laluan ' +
        'memadamnya di mana-mana dalam sistem ini. Terminal yang pernah merekod kekal dalam ' +
        'senarai, dinyahaktifkan.',
    );
  }

  /*
   * Checked after the references, so the message names the permanent reason where there is one.
   * Telling somebody to deactivate a terminal that will refuse anyway wastes the one step they
   * were given.
   */
  if (device.active) {
    throw conflict(
      `"${device.name}" masih aktif. Nyahaktifkannya dahulu — buang hanya ditawarkan selepas ` +
        'terminal itu tidak lagi merekod, supaya pemadaman bukan satu klik daripada senarai.',
    );
  }
}

/**
 * Deletes the terminal and the bookkeeping that belongs to it.
 *
 * Every dependent is deleted by name rather than left to the cascade, so the set is written down
 * where somebody adding a table will read it, and so the reply can report what went. One
 * transaction: a terminal half-removed leaves a row that no longer has its cursor, which the
 * reconcile pull would recreate and go on polling an address nobody maintains.
 */
export async function removeDevice(id: number): Promise<RemovalSweep> {
  return db().$transaction(async (tx) => {
    const commands = await tx.deviceCommand.deleteMany({ where: { deviceId: id } });
    const snapshots = await tx.deviceSnapshot.deleteMany({ where: { deviceId: id } });
    const unmapped = await tx.unmappedDeviceUser.deleteMany({ where: { deviceId: id } });
    const syncState = await tx.deviceSyncState.deleteMany({ where: { deviceId: id } });

    await tx.device.delete({ where: { id } });

    return {
      commands: commands.count,
      snapshots: snapshots.count,
      unmapped: unmapped.count,
      syncState: syncState.count,
    };
  });
}
