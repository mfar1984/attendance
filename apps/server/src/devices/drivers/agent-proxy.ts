import {
  agentFaceEnrolArgs,
  agentFaceRemoveArgs,
  agentPersonRemoveArgs,
  agentPersonUpsertArgs,
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
 * ## What it refuses, and why refusing is better than waiting
 *
 * Every read is declared unavailable. A read cannot be queued — there is nothing to hand back —
 * so the alternatives were to block a browser request until the connector next polls, or invent a
 * value. Both are worse than a screen that says where to look: device status, clock drift and
 * firmware already arrive on the connector's heartbeat, which is the honest source for them.
 *
 * `openDoor` is refused separately and deliberately. Releasing a lock fifteen seconds after
 * somebody pressed the button is not a slow success, it is a door opening when nobody is
 * expecting it — and the person who pressed it has already assumed it failed and walked away.
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
      ],
      writeModel: 'queued',
      reachability: 'deviceInitiated',
      unavailable: {
        [DriverOperation.openDoor]:
          'Terminal ini dicapai melalui connector tapak, jadi arahan mengambil beberapa saat ' +
          'untuk sampai. Membuka pintu dengan lengah begitu tidak selamat - buka di terminal itu ' +
          'sendiri.',
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

  identity = {
    read: (): Promise<TerminalIdentity> => this.unreachable('membaca identiti terminal'),
    counts: (): Promise<TerminalCounts> => this.unreachable('membaca kiraan pendaftaran'),
    capacity: (): Promise<TerminalCapacity> => this.unreachable('membaca kapasiti'),
    faceStores: (): Promise<FaceStore[]> => this.unreachable('membaca simpanan wajah'),
  };

  clock = {
    read: (): Promise<ClockReading> => this.unreachable('membaca jam terminal'),
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
    configureNtp: (): Promise<WriteAck> => this.unreachable('mengkonfigurasi NTP'),
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
    door: (): Promise<DoorSettings | null> => this.unreachable('membaca tetapan pintu'),
    setDoor: (_doorNo: number, _patch: DoorPatch): Promise<WriteAck> =>
      this.unreachable('menukar tetapan pintu'),
    reader: (): Promise<ReaderSettings | null> => this.unreachable('membaca tetapan pembaca'),
    setReader: (_readerNo: number, _patch: ReaderPatch): Promise<WriteAck> =>
      this.unreachable('menukar tetapan pembaca'),
    open: (): Promise<WriteAck> => this.unreachable('membuka pintu'),
    options: (): Promise<OptionSets> => this.unreachable('membaca senarai pilihan terminal'),
  };

  attendance = {
    mode: (): Promise<AttendanceModeSetting | null> => this.unreachable('membaca mod kehadiran'),
    setMode: (): Promise<WriteAck> => this.unreachable('menukar mod kehadiran'),
  };

  lifecycle = {
    reboot: (): Promise<WriteAck> =>
      enqueue(this.device.id, CommandKind.reboot, JSON.stringify({})),
    callbackTargets: (): Promise<CallbackTarget[]> =>
      this.unreachable('membaca sasaran panggil balik'),
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
    clearCallback: (): Promise<WriteAck> => this.unreachable('mengosongkan sasaran panggil balik'),
  };

  /** Vendor checks need live reads, so there are none to report from here. */
  vendorWarnings(): Promise<DeviceWarning[]> {
    return Promise.resolve([]);
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
