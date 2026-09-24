import {
  agentFaceEnrolArgs,
  agentFaceRemoveArgs,
  agentPersonRemoveArgs,
  agentPersonUpsertArgs,
  agentAttendanceModeArgs,
  agentCallbackClearArgs,
  agentDoorArgs,
  agentNtpArgs,
  agentReaderArgs,
  SnapshotKind,
} from '@attendance/shared';
import {
  DriverOperation,
  type DriverCapabilities,
  type PullCursor,
  type PullResult,
  type TerminalDriver,
  type WriteAck,
} from '@attendance/terminal-drivers';
import type {
  AttendanceModeSetting,
  CallbackConfig,
  CallbackTarget,
  ClockReading,
  DeviceWarning,
  DoorPatch,
  DoorSettings,
  FaceStore,
  OptionSets,
  PersonUpsert,
  ReaderPatch,
  ReaderSettings,
  TerminalCapacity,
  TerminalCounts,
  TerminalIdentity,
  TerminalPerson,
} from '@attendance/terminal-drivers';
import type { Device } from '@prisma/client';

import { conflict } from '../../http.js';
import { CommandKind, enqueue, enqueueReplacing } from '../driver/commands.js';
import { snapshotOf } from '../snapshots.js';

/**
 * A terminal this server cannot reach, reached through its on-site connector.
 *
 * ## Why this exists at all
 *
 * The Hikvision driver is `inline`: every write opens a socket to the unit and returns once the
 * firmware confirmed. From a cloud host that socket cannot be opened — `192.168.1.250` is not
 * routable from the public internet — so enrolling a face for a terminal behind a connector
 * failed with a network error, and the screen reported it as a device fault.
 *
 * The queue was already the answer, it just had no user for this case: it was built for ZKTeco
 * TA Push, where the *terminal* collects its own work. Here the *connector* collects it, runs the
 * same driver the server would have run, and reports back. Same table, same lifecycle, same
 * re-offer sweep.
 *
 * ## Reads answer from the connector's last report
 *
 * A read cannot be queued — there is nothing to hand back — so this returns what the connector
 * last swept from the terminal, with the time it was taken. Not live, and the screen says so:
 * a cached setting presented as current is worse than an empty field, because somebody changes
 * the verification mode at the keypad and this stays confidently wrong.
 *
 * Every read used to be declared unavailable, which left the device editor as six tabs of empty
 * fields for a site that was working perfectly.
 *
 * ## Three writes stay refused, and queueing would break each rather than fix it
 *
 * `setClockManually` — the connector already sets terminal clocks from the cloud time on every
 * heartbeat. A queued timestamp is stale when collected, and writing a stale time bakes in the
 * drift this was meant to correct. An NTP *host* is queued instead, because a configuration is as
 * correct later as it was when typed.
 *
 * `openDoor` — releasing a lock fifteen seconds after somebody pressed the button is not a slow
 * success, it is a door opening when nobody expects it, and the person who pressed it has already
 * assumed it failed and walked away.
 *
 * `configureCallback` — the push target for a terminal behind a connector is the connector's own
 * LAN address, which it knows and this server does not. Queueing an address from here would point
 * the unit at a host it cannot reach. Clearing a slot *is* allowed, because that needs only the
 * slot number.
 */
export class AgentProxyDriver implements TerminalDriver {
  readonly protocol: string;
  readonly capabilities: DriverCapabilities;

  constructor(private readonly device: Device) {
    // Still the unit's own protocol. It is the same terminal speaking the same language; only the
    // thing holding the socket has moved.
    this.protocol = device.protocol;

    this.capabilities = {
      operations: [
        DriverOperation.upsertPerson,
        DriverOperation.removePerson,
        DriverOperation.enrolFace,
        DriverOperation.removeFace,
        DriverOperation.reboot,

        /*
         * Reads, answered from the connector's last sweep rather than live.
         *
         * Declared because the screen uses this list to decide whether to render a control at all.
         * Leaving them out would keep the tabs blank even though the values are held — which is
         * how "the data exists but nothing shows it" happens.
         */
        DriverOperation.readIdentity,
        DriverOperation.readCounts,
        DriverOperation.readCapacity,
        DriverOperation.readFaceStores,
        DriverOperation.readClock,
        DriverOperation.readAttendanceMode,
        DriverOperation.readDoorSettings,
        DriverOperation.readReaderSettings,
        DriverOperation.readCallbackTargets,
        DriverOperation.readDiagnostics,

        /* Settings writes, queued and collected. */
        DriverOperation.configureNtp,
        DriverOperation.writeDoorSettings,
        DriverOperation.writeReaderSettings,
        DriverOperation.writeAttendanceMode,
        DriverOperation.clearCallback,
      ],
      writeModel: 'queued',
      reachability: 'deviceInitiated',
      unavailable: {
        [DriverOperation.openDoor]:
          'Terminal ini dicapai melalui connector tapak, jadi arahan mengambil beberapa saat ' +
          'untuk sampai. Membuka pintu dengan lengah begitu tidak selamat - buka di terminal itu ' +
          'sendiri.',

        /*
         * Stated rather than silently absent, because the screen shows these reasons on the
         * control itself. A greyed button with no explanation reads as a permission somebody
         * lacks, which sends them to ask for one they already have.
         */
        [DriverOperation.setClockManually]:
          'Connector menetapkan jam terminal sendiri daripada masa cloud yang ia terima pada ' +
          'setiap heartbeat. Cap masa yang dibariskan dari sini sudah lapuk ketika ia dikutip, ' +
          'dan menulis masa lapuk ke jam mengekalkan hanyutan yang sepatutnya dibetulkan. ' +
          'Tetapkan hos NTP sebaliknya.',
        [DriverOperation.configureCallback]:
          'Sasaran push untuk terminal di belakang connector ialah alamat LAN connector itu ' +
          'sendiri, yang ia tahu dan pelayan ini tidak. Connector menetapkannya sendiri.',
      },
    };
  }

  close(): Promise<void> {
    // Nothing is held open. The connector owns the connection to the unit.
    return Promise.resolve();
  }

  /**
   * One message for every read, naming the connector as the reason.
   *
   * Written once rather than at each call site so a screen cannot end up with one operation
   * explaining itself and the next one saying "not supported".
   */
  private unreachable(what: string): never {
    throw conflict(
      `Tidak boleh ${what} pada "${this.device.name}" dari sini: terminal itu dicapai melalui ` +
        'connector tapak, yang menghantar arahan dan bukan menjawab bacaan. Status, hanyutan jam ' +
        'dan versi firmware datang dari laporan connector pada skrin Peranti.',
    );
  }

  /**
   * A value the connector last read from the terminal, rather than a refusal.
   *
   * This is what stopped the device editor being six tabs of empty fields. A browser request
   * cannot wait for the connector's next poll, so it cannot be a live read — but it does not have
   * to be nothing either. The connector sweeps its terminals on a timer and reports, and this
   * returns the newest report.
   *
   * ## Three outcomes, and they are not the same
   *
   * Never reported means the connector has not swept yet, or has only just enrolled: the answer is
   * to wait, and the message says so. Reported-but-failed means the terminal itself refused, and
   * the connector's own reason is worth more than anything this layer could say. A stored value is
   * returned even when the newest attempt failed, because last known settings beside a stale
   * timestamp beat an empty tab — the screen carries the timestamp so nobody mistakes it for live.
   */
  private async fromSnapshot<T>(
    kind: SnapshotKind,
    what: string,
    pick: (payload: Record<string, unknown>) => T,
  ): Promise<T> {
    const snapshot = await snapshotOf(this.device.id, kind);

    if (snapshot === null || (snapshot.payload === null && snapshot.error === null)) {
      throw conflict(
        `Connector belum melaporkan ${what} untuk "${this.device.name}". Ia membaca terminal ` +
          'pada pemasangnya sendiri, jadi ini terisi selepas sapuan pertama selesai.',
      );
    }

    if (snapshot.payload === null) {
      throw conflict(
        `Connector tidak dapat membaca ${what} pada "${this.device.name}": ${snapshot.error ?? ''}`,
      );
    }

    return pick(snapshot.payload as Record<string, unknown>);
  }

  /**
   * Composite snapshots exist because the editor's tabs are composite, not the endpoints.
   *
   * The unit tab shows identity, credential counts, capacity and the face libraries together, so
   * the connector reports them as one document read at one moment. Splitting them on the wire
   * would let the screen assemble one picture from four reads taken minutes apart, each with its
   * own timestamp and no way to show four of them.
   *
   * So each accessor here picks its field back out, and a piece the terminal refused is null
   * rather than an exception — which is the same thing the direct path does with `.catch(() => null)`
   * on the advisory reads.
   */
  identity = {
    read: (): Promise<TerminalIdentity> =>
      this.fromSnapshot(SnapshotKind.identity, 'identiti terminal', (payload) => {
        const value = payload['identity'];
        if (value === null || value === undefined) {
          this.unreachable('membaca identiti terminal');
        }
        return value as TerminalIdentity;
      }),
    counts: (): Promise<TerminalCounts> =>
      this.fromSnapshot(SnapshotKind.identity, 'kiraan pendaftaran', (payload) => {
        const value = payload['counts'];
        if (value === null || value === undefined) this.unreachable('membaca kiraan pendaftaran');
        return value as TerminalCounts;
      }),
    capacity: (): Promise<TerminalCapacity> =>
      this.fromSnapshot(SnapshotKind.identity, 'kapasiti', (payload) => {
        const value = payload['capacity'];
        if (value === null || value === undefined) this.unreachable('membaca kapasiti');
        return value as TerminalCapacity;
      }),
    faceStores: (): Promise<FaceStore[]> =>
      this.fromSnapshot(SnapshotKind.identity, 'simpanan wajah', (payload) =>
        Array.isArray(payload['faceStores']) ? (payload['faceStores'] as FaceStore[]) : [],
      ),
  };

  clock = {
    /** The whole payload is the reading, so there is no field to pick out. */
    read: (): Promise<ClockReading> =>
      this.fromSnapshot(
        SnapshotKind.clock,
        'jam terminal',
        (payload) => payload as unknown as ClockReading,
      ),
    /**
     * Refused rather than queued, and this one is worth stating.
     *
     * The connector sets terminal clocks itself, from the cloud time it receives on every
     * heartbeat. Queueing a timestamp from here would deliver an instant that is already minutes
     * stale by the time the connector collects it, and writing a stale time to a clock is how the
     * drift this is meant to fix gets baked in instead.
     */
    setManually: (): Promise<WriteAck> =>
      this.unreachable('menetapkan jam terminal secara manual'),
    /**
     * Queued, unlike setting the clock by hand.
     *
     * The distinction is what the value means. A timestamp is only correct at the instant it is
     * produced, so queueing one delivers a time that is already wrong. An NTP host is a
     * configuration — it says where to ask, not what the answer is — so it is as correct fifteen
     * seconds later as it was when somebody typed it.
     */
    configureNtp: (config: {
      host: string;
      timeZone: string;
      port?: number;
      intervalMinutes?: number;
    }): Promise<WriteAck> =>
      enqueueReplacing(
        this.device.id,
        CommandKind.configureNtp,
        'clock',
        JSON.stringify(agentNtpArgs.parse(config)),
      ),
  };

  people = {
    upsert: (person: PersonUpsert): Promise<WriteAck> => {
      const args = agentPersonUpsertArgs.parse({
        employeeNo: person.employeeNo,
        name: person.name,
        ...(person.validFrom === undefined ? {} : { validFrom: person.validFrom.toISOString() }),
        ...(person.validTo === undefined ? {} : { validTo: person.validTo.toISOString() }),
        ...(person.pin === undefined ? {} : { pin: person.pin }),
        ...(person.doorNo === undefined ? {} : { doorNo: person.doorNo }),
      });

      /*
       * Superseded by subject, so saving a staff record three times leaves one command waiting
       * rather than three. Without it a face replaced by a newer photograph would still be
       * collected, and whichever arrived last would win — not necessarily the one somebody just
       * uploaded.
       */
      return enqueueReplacing(
        this.device.id,
        CommandKind.personUpsert,
        args.employeeNo,
        JSON.stringify(args),
      );
    },

    remove: (employeeNos: string[]): Promise<WriteAck> => {
      const args = agentPersonRemoveArgs.parse({ employeeNos });
      /*
       * Keyed on the first identifier when there is exactly one, and unkeyed for a batch.
       * A batch has no single subject, and inventing one would let an unrelated removal supersede
       * it.
       */
      return employeeNos.length === 1 && employeeNos[0] !== undefined
        ? enqueueReplacing(
            this.device.id,
            CommandKind.personRemove,
            employeeNos[0],
            JSON.stringify(args),
          )
        : enqueue(this.device.id, CommandKind.personRemove, JSON.stringify(args));
    },

    find: (): Promise<TerminalPerson | null> => this.unreachable('mencari seorang pada terminal'),
    /**
     * Rejects on the first `next()` rather than throwing when the iterable is created.
     *
     * `for await` over a generator that threw at construction would surface the refusal at a
     * different point than every other unavailable read, so the message would arrive from a
     * stack a caller does not recognise. Rejecting on iteration keeps it in the same place.
     */
    list: (): AsyncIterable<TerminalPerson> => {
      const refuse = (): Promise<IteratorResult<TerminalPerson>> => {
        try {
          this.unreachable('membaca senarai pengguna terminal');
        } catch (error) {
          return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
      };

      return { [Symbol.asyncIterator]: () => ({ next: refuse }) };
    },
  };

  biometrics = {
    enrolFace: (employeeNo: string, jpeg: Buffer): Promise<WriteAck> => {
      const args = agentFaceEnrolArgs.parse({
        employeeNo,
        jpegBase64: jpeg.toString('base64'),
      });
      return enqueueReplacing(
        this.device.id,
        CommandKind.faceEnrol,
        employeeNo,
        JSON.stringify(args),
      );
    },

    removeFace: (employeeNo: string): Promise<WriteAck> => {
      const args = agentFaceRemoveArgs.parse({ employeeNo });
      return enqueueReplacing(
        this.device.id,
        CommandKind.faceRemove,
        employeeNo,
        JSON.stringify(args),
      );
    },

    readFace: (): Promise<Buffer> => this.unreachable('membaca wajah tersimpan'),
  };

  events = {
    /**
     * Declared unsupported, so the reconcile worker treats it as a clean no-op.
     *
     * The connector performs the pull on the LAN. This method existing and throwing would put a
     * healthy terminal into the worker's backoff map and then mark it offline.
     */
    pull: (_cursor: PullCursor): Promise<PullResult> => this.unreachable('menarik peristiwa'),
    picture: (): Promise<Buffer> => this.unreachable('membaca gambar peristiwa'),
  };

  access = {
    door: (): Promise<DoorSettings | null> =>
      this.fromSnapshot(
        SnapshotKind.door,
        'tetapan pintu',
        (payload) => (payload['door'] ?? null) as DoorSettings | null,
      ),
    /**
     * Keyed on the door so a second edit supersedes the first rather than queueing behind it.
     *
     * Saving the same tab twice should leave one pending change, not two applied in order — and
     * with a patch the second would win anyway, so the queue may as well say so.
     */
    setDoor: (doorNo: number, patch: DoorPatch): Promise<WriteAck> =>
      enqueueReplacing(
        this.device.id,
        CommandKind.setDoor,
        `door:${String(doorNo)}`,
        JSON.stringify(agentDoorArgs.parse({ doorNo, patch })),
      ),
    reader: (): Promise<ReaderSettings | null> =>
      this.fromSnapshot(
        SnapshotKind.door,
        'tetapan pembaca',
        (payload) => (payload['reader'] ?? null) as ReaderSettings | null,
      ),
    setReader: (readerNo: number, patch: ReaderPatch): Promise<WriteAck> =>
      enqueueReplacing(
        this.device.id,
        CommandKind.setReader,
        `reader:${String(readerNo)}`,
        JSON.stringify(agentReaderArgs.parse({ readerNo, patch })),
      ),
    open: (): Promise<WriteAck> => this.unreachable('membuka pintu'),
    /**
     * Empty rather than a refusal when the firmware published nothing.
     *
     * These lists build real controls on the door tab, and the direct path already treats their
     * absence as "no published options" instead of a fault. A refusal here would take down the
     * whole tab over a document the unit is not obliged to serve.
     */
    options: (): Promise<OptionSets> =>
      this.fromSnapshot(SnapshotKind.door, 'senarai pilihan terminal', (payload) =>
        payload['options'] === null || payload['options'] === undefined
          ? {}
          : (payload['options'] as OptionSets),
      ),
  };

  attendance = {
    mode: (): Promise<AttendanceModeSetting | null> =>
      this.fromSnapshot(
        SnapshotKind.attendance,
        'mod kehadiran',
        (payload) => payload as unknown as AttendanceModeSetting | null,
      ),
    setMode: (mode: AttendanceModeSetting['mode']): Promise<WriteAck> =>
      enqueueReplacing(
        this.device.id,
        CommandKind.setAttendanceMode,
        'attendance',
        JSON.stringify(agentAttendanceModeArgs.parse({ mode })),
      ),
  };

  lifecycle = {
    reboot: (): Promise<WriteAck> =>
      enqueue(this.device.id, CommandKind.reboot, JSON.stringify({})),
    callbackTargets: (): Promise<CallbackTarget[]> =>
      this.fromSnapshot(SnapshotKind.push, 'sasaran panggil balik', (payload) =>
        Array.isArray(payload) ? (payload as CallbackTarget[]) : [],
      ),
    /**
     * Refused rather than queued.
     *
     * The push target for a terminal behind a connector is the connector's own LAN address, which
     * the connector knows and this server does not. Queueing an address from here would point the
     * unit at the cloud, which it cannot reach — producing a terminal that has stopped delivering
     * with nothing on any screen saying why.
     */
    configureCallback: (_config: CallbackConfig): Promise<WriteAck> =>
      this.unreachable('menetapkan sasaran panggil balik'),
    /**
     * Allowed where setting one is not, and the asymmetry is the point.
     *
     * Setting a target needs an address the cloud does not know. Clearing needs only the slot
     * number, and it is how a decommissioned listener stops being pushed to.
     */
    clearCallback: (slot: number): Promise<WriteAck> =>
      enqueueReplacing(
        this.device.id,
        CommandKind.clearCallback,
        `push:${String(slot)}`,
        JSON.stringify(agentCallbackClearArgs.parse({ slot })),
      ),
  };

  /**
   * Vendor findings the connector reported, or none.
   *
   * Empty rather than a refusal when nothing has been reported yet, because the contract says this
   * must not throw for a diagnostic that is merely unavailable — and an empty list is a real
   * answer here: the absence of a vendor-shaped fault is itself a finding.
   */
  async vendorWarnings(): Promise<DeviceWarning[]> {
    const snapshot = await snapshotOf(this.device.id, SnapshotKind.diagnostics);
    if (snapshot === null || snapshot.payload === null) return [];

    const warnings = (snapshot.payload as Record<string, unknown>)['warnings'];
    return Array.isArray(warnings) ? (warnings as DeviceWarning[]) : [];
  }

  diagnostics(): Promise<Record<string, unknown>> {
    return Promise.resolve({
      reachedVia: 'agent',
      agentId: this.device.agentId,
      note:
        'Terminal ini dicapai melalui connector tapak. Diagnostik peranti datang dari laporan ' +
        'connector, bukan dari bacaan langsung.',
    });
  }
}
