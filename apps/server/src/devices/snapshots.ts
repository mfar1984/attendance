import { SnapshotKind, type AgentSnapshot } from '@attendance/shared';

import { db } from '../db.js';

/**
 * What a terminal behind a connector last reported about its own settings.
 *
 * This is the answer to a problem the connector topology created and nothing else solves: a
 * connector collects commands and does not serve reads, so the cloud cannot open a socket to a
 * terminal on a hospital LAN. Before this, the device editor had nothing to show for a connector
 * site — six tabs of empty fields, each explaining that the value could not be read. Every tab an
 * operator opens has to hold data.
 *
 * ## A snapshot is not a live reading, and the difference is load-bearing
 *
 * `readAt` records when the *agent* read the terminal. The screen shows it beside the values,
 * because a cached setting presented as live is worse than an empty field: somebody changes the
 * verification mode at the keypad, and this screen stays confidently wrong with nothing saying
 * how old it is.
 *
 * That is also why a direct terminal never gets a row here. Those are read live on every request,
 * and a cache beside a live read is a second version of the truth with nothing deciding which one
 * wins.
 */

/** Shape the editor receives. `payload` is the driver-contract type for that kind. */
export interface StoredSnapshot {
  kind: SnapshotKind;
  payload: unknown;
  readAt: string | null;
  error: string | null;
  errorAt: string | null;
}

/**
 * Records what a connector reported for one terminal.
 *
 * A failed read keeps the previous payload. That is the whole point of holding `error` in its own
 * column rather than replacing the values: a terminal that answered an hour ago and refuses now
 * leaves both facts on the screen — the settings, and the fact they have stopped refreshing.
 * Blanking on failure would turn one bad attempt into the empty tab this exists to remove.
 *
 * A successful read clears the error, because the condition it described is over.
 */
export async function storeSnapshots(
  deviceId: number,
  reported: AgentSnapshot[],
): Promise<number> {
  const prisma = db();
  let stored = 0;

  for (const snapshot of reported) {
    const failed = snapshot.error !== null && snapshot.error !== undefined;

    /*
     * Serialised here rather than by the agent, so the wire carries a JSON value and not a string
     * containing JSON. The agent would otherwise have to stringify, and anything reading the wire
     * — a log, a test, somebody with curl — would see an escaped blob instead of the document.
     */
    const payload = failed ? undefined : JSON.stringify(snapshot.payload ?? null);

    const data = failed
      ? { error: snapshot.error ?? null, errorAt: new Date() }
      : {
          ...(payload === undefined ? {} : { payload }),
          readAt: snapshot.readAt ?? new Date(),
          error: null,
          errorAt: null,
        };

    await prisma.deviceSnapshot.upsert({
      where: { deviceId_kind: { deviceId, kind: snapshot.kind } },
      create: { deviceId, kind: snapshot.kind, ...data },
      update: data,
    });

    stored += 1;
  }

  return stored;
}

/** Every snapshot held for one terminal, keyed by kind so a tab can pick its own. */
export async function snapshotsFor(deviceId: number): Promise<Map<string, StoredSnapshot>> {
  const rows = await db().deviceSnapshot.findMany({ where: { deviceId } });

  return new Map(
    rows.map((row) => [
      row.kind,
      {
        kind: row.kind as SnapshotKind,
        /**
         * Parsed defensively rather than trusted.
         *
         * The column is written by this server from a value the agent sent, so it should always
         * be valid JSON — but a restored backup or a hand-edited row would otherwise throw inside
         * a screen read, turning one malformed row into a failed request for the whole tab.
         */
        payload: parsePayload(row.payload),
        readAt: row.readAt?.toISOString() ?? null,
        error: row.error,
        errorAt: row.errorAt?.toISOString() ?? null,
      },
    ]),
  );
}

/** One snapshot, or null when this terminal has never reported that kind. */
export async function snapshotOf(
  deviceId: number,
  kind: SnapshotKind,
): Promise<StoredSnapshot | null> {
  const row = await db().deviceSnapshot.findUnique({
    where: { deviceId_kind: { deviceId, kind } },
  });
  if (row === null) return null;

  return {
    kind,
    payload: parsePayload(row.payload),
    readAt: row.readAt?.toISOString() ?? null,
    error: row.error,
    errorAt: row.errorAt?.toISOString() ?? null,
  };
}

function parsePayload(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
