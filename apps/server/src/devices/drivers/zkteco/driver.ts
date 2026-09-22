import { DeviceProtocol } from '@attendance/shared';
import type { Device } from '@prisma/client';

import { loadEnv } from '../../../env.js';
import { conflict } from '../../../http.js';
import { zoneOffsetMinutes } from '../../../time.js';
import { CommandKind, enqueue, enqueueReplacing } from '../../driver/commands.js';
import {
  APPLIED,
  DriverOperation,
  type DriverCapabilities,
  type PullCursor,
  type PullResult,
  type TerminalDriver,
  type WriteAck,
} from '../../driver/index.js';
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
} from '../../driver/types.js';
import {
  deleteFaceCommand,
  deleteUserCommand,
  faceCommand,
  REBOOT_COMMAND,
  userInfoCommand,
} from './protocol.js';

/**
 * SenseFace 3A capacities, from the datasheet.
 *
 * Read from the document rather than from the unit, because TA Push publishes no capability
 * endpoint — the protocol has no way to ask. So these are model facts, and a different ZKTeco
 * model will need its own entry rather than these being treated as the vendor's numbers.
 */
const SENSEFACE_3A = {
  people: 6000,
  faces: 3000,
  fingerprints: 6000,
} as const;

/**
 * ZKTeco TA Push (ADMS) as an implementation of the driver contract.
 *
 * ## The two things that make this driver shaped differently
 *
 * **Every write is queued.** The server cannot call this terminal; the terminal calls the
 * server and asks whether there is work. So each write records a command and returns an
 * unconfirmed acknowledgement, and the outcome arrives later through `/iclock/devicecmd` — or
 * never, if the unit stays offline. Callers that report an outcome to an operator read
 * `ack.confirmed` and say so.
 *
 * **Most reads do not exist.** There is nothing to call, so a read cannot block waiting for the
 * unit to next dial in. Anything the terminal does not volunteer is declared absent in
 * `capabilities` and the screen says the protocol has no such concept — which is the honest
 * answer, and a different statement from the unit being unreachable.
 *
 * ## Not verified against hardware
 *
 * No SenseFace unit was available. The structure here is sound — a queue and a decoder are what
 * this protocol needs regardless — but the command strings and the `ATTLOG` column order come
 * from third-party transcriptions and need confirming against a real unit before this is relied
 * on. `protocol.ts` states that in more detail and is where any correction goes.
 */
export class ZktecoTaPushDriver implements TerminalDriver {
  readonly protocol = DeviceProtocol.taPush;

  /**
   * What TA Push can do, and what it cannot.
   *
   * The absences are the useful part. Every operation left out of this list is one the screen
   * now greys out with an explanation instead of attempting and reporting as a fault.
   */
  readonly capabilities: DriverCapabilities;

  constructor(private readonly device: Device) {
    this.capabilities = {
      operations: [
        // The terminal reports its own identity on handshake, so this is served from the record.
        DriverOperation.readIdentity,
        DriverOperation.readCapacity,
        // Queued writes.
        DriverOperation.upsertPerson,
        DriverOperation.removePerson,
        DriverOperation.removeFace,
        DriverOperation.reboot,
        DriverOperation.enrolFace,
        // Events arrive by push only. `pullEvents` is deliberately absent: the unit buffers its
        // own transactions and re-sends what we never acknowledged, so there is no gap for a
        // reconcile pull to close and nothing to call in order to run one.
        DriverOperation.readDiagnostics,
      ],
      writeModel: 'queued',
      reachability: 'deviceInitiated',
      unavailable: {
        /**
         * Face upload needs firmware V1.5 or newer.
         *
         * Declared unavailable when the firmware is older or not yet known, rather than queued
         * and left to fail. A face is what somebody scans with, so a command that silently
         * never applies means they cannot clock in tomorrow — and nothing on any screen would
         * say why. The alternative is the screen saying plainly that the face must be enrolled
         * at the terminal itself, which is a thing an operator can act on.
         */
        ...(supportsPushedFace(device.firmware)
          ? {}
          : {
              [DriverOperation.enrolFace]:
                device.firmware === null
                  ? 'Versi firmware belum diketahui. Muat naik wajah memerlukan V1.5 atau lebih baharu, ' +
                    'jadi daftarkan wajah di terminal itu sendiri sehingga terminal melaporkan versinya.'
                  : `Firmware ${device.firmware} tidak menerima muat naik wajah (perlukan V1.5 atau lebih baharu). ` +
                    'Wajah mesti didaftarkan di terminal itu sendiri.',
            }),
      },
    };
  }

  /** Nothing to release: this driver holds no socket, because it never opens one. */
  async close(): Promise<void> {
    return Promise.resolve();
  }

  readonly identity = {
    /**
     * Served from the device record, which the handshake fills in.
     *
     * Not a live read — there is nothing to call. The values are what the terminal last told us
     * when it dialled in, and for a callback protocol that is the only version that exists.
     */
    read: (): Promise<TerminalIdentity> =>
      Promise.resolve({
        name: this.device.name,
        model: this.device.model,
        serialNumber: this.device.serialNumber,
        macAddress: this.device.macAddress,
        firmware: this.device.firmware,
      }),

    counts: (): Promise<TerminalCounts> =>
      Promise.reject(this.unsupported('kiraan pengguna pada terminal')),

    capacity: (): Promise<TerminalCapacity> => Promise.resolve({ ...SENSEFACE_3A }),

    /** One implicit store, and no endpoint that enumerates it. */
    faceStores: (): Promise<FaceStore[]> => Promise.resolve([]),
  };

  readonly clock = {
    /**
     * Rejected rather than answered from the record.
     *
     * Clock drift is measured, not remembered: the whole value of the reading is that it
     * compares the terminal's clock against this server *now*. A stored figure from the last
     * handshake would be reported as a current measurement, and clock drift is the one fault
     * that corrupts every record while leaving the unit fully functional.
     *
     * The handshake does carry the unit's time, so drift is recorded there instead — measured
     * at the one moment this protocol offers.
     */
    read: (): Promise<ClockReading> => Promise.reject(this.unsupported('bacaan jam atas permintaan')),

    setManually: (): Promise<WriteAck> => Promise.reject(this.unsupported('menetapkan jam')),

    configureNtp: (): Promise<WriteAck> => Promise.reject(this.unsupported('konfigurasi NTP')),
  };

  readonly people = {
    upsert: (person: PersonUpsert): Promise<WriteAck> =>
      enqueueReplacing(
        this.device.id,
        CommandKind.personUpsert,
        person.employeeNo,
        userInfoCommand({
          employeeNo: person.employeeNo,
          name: person.name,
          pin: person.pin,
          validFrom: person.validFrom,
          validTo: person.validTo,
          offsetMinutes: this.offsetMinutes(),
        }),
      ),

    /**
     * One command per person rather than one for the batch.
     *
     * The protocol deletes by a single PIN, and a terminal that collects a partial batch would
     * otherwise leave no record of which people it actually removed. One row each means the
     * queue says exactly what is outstanding.
     */
    remove: async (employeeNos: string[]): Promise<WriteAck> => {
      let ack: WriteAck = APPLIED;
      for (const employeeNo of employeeNos) {
        ack = await enqueueReplacing(
          this.device.id,
          CommandKind.personRemove,
          employeeNo,
          deleteUserCommand(employeeNo),
        );
      }
      return ack;
    },

    /**
     * Rejected, because a lookup cannot be queued.
     *
     * A query command would eventually produce an answer through `/iclock/cdata`, but the
     * caller needs it now — `refreshCredentialCounts` reads it to decide what to store. Making
     * this wait for the terminal's next poll would hold an HTTP request open for up to a minute.
     *
     * The callers already tolerate the rejection: they catch it and keep the counts they have,
     * which is correct for a unit whose credentials nothing here can currently read.
     */
    find: (): Promise<TerminalPerson | null> =>
      Promise.reject(this.unsupported('mencari seorang pada terminal')),

    list: (): AsyncIterable<TerminalPerson> => {
      const error = this.unsupported('membaca senarai pengguna terminal');
      return {
        // eslint-disable-next-line @typescript-eslint/require-await
        async *[Symbol.asyncIterator]() {
          throw error;
        },
      };
    },
  };

  readonly biometrics = {
    enrolFace: (employeeNo: string, jpeg: Buffer): Promise<WriteAck> =>
      enqueueReplacing(
        this.device.id,
        CommandKind.faceEnrol,
        employeeNo,
        faceCommand(employeeNo, jpeg),
      ),

    removeFace: (employeeNo: string): Promise<WriteAck> =>
      enqueueReplacing(
        this.device.id,
        CommandKind.faceRemove,
        employeeNo,
        deleteFaceCommand(employeeNo),
      ),

    /**
     * Rejected: the protocol has no way to read a stored template back.
     *
     * Which means the staff screen cannot show the enrolled face for a person on a ZKTeco
     * terminal. The caller already tries the next terminal and returns null if none answer, so
     * a person enrolled on a mixed pair still shows the copy from the Hikvision unit.
     */
    readFace: (): Promise<Buffer> => Promise.reject(this.unsupported('membaca wajah tersimpan')),
  };

  readonly events = {
    /**
     * Rejected, and declared unsupported so nothing calls it.
     *
     * Not an omission. The terminal holds its own transaction log — 150,000 records on this
     * model — and re-sends what the server never acknowledged, so push is the reliable path
     * rather than an optimisation. That is the opposite of Hikvision, whose firmware keeps no
     * queue and is why the reconcile pull exists at all.
     */
    pull: (_cursor: PullCursor): Promise<PullResult> =>
      Promise.reject(this.unsupported('menarik event')),

    picture: (): Promise<Buffer> => Promise.reject(this.unsupported('gambar event')),
  };

  readonly access = {
    door: (): Promise<DoorSettings | null> => Promise.resolve(null),
    setDoor: (_doorNo: number, _patch: DoorPatch): Promise<WriteAck> =>
      Promise.reject(this.unsupported('tetapan pintu')),
    reader: (): Promise<ReaderSettings | null> => Promise.resolve(null),
    setReader: (_readerNo: number, _patch: ReaderPatch): Promise<WriteAck> =>
      Promise.reject(this.unsupported('tetapan pembaca')),
    /**
     * Rejected rather than queued.
     *
     * Remote door release is an action somebody takes while standing at a screen watching a
     * person at the door. A queued one opens the door whenever the terminal next polls, which
     * could be a minute later and with nobody there — so this is a case where queueing is worse
     * than refusing.
     */
    open: (): Promise<WriteAck> => Promise.reject(this.unsupported('membuka pintu dari jauh')),
    options: (): Promise<OptionSets> => Promise.resolve({}),
  };

  readonly attendance = {
    mode: (): Promise<AttendanceModeSetting | null> => Promise.resolve(null),
    setMode: (): Promise<WriteAck> => Promise.reject(this.unsupported('mod kehadiran')),
  };

  readonly lifecycle = {
    reboot: (): Promise<WriteAck> =>
      enqueue(this.device.id, CommandKind.reboot, REBOOT_COMMAND),

    /**
     * Where the terminal is pointed, which this server cannot read.
     *
     * The address is configured on the unit's own keypad, and nothing in the protocol reports it
     * back. An empty list is the honest answer; the screen shows the slots as unknown rather
     * than as free.
     */
    callbackTargets: (): Promise<CallbackTarget[]> => Promise.resolve([]),

    configureCallback: (_config: CallbackConfig): Promise<WriteAck> =>
      Promise.reject(
        conflict(
          `Terminal "${this.device.name}" mesti dikonfigurasi di keypadnya sendiri. ` +
            'Protokol ini tidak membenarkan pelayan menetapkan alamat yang terminal hubungi — ' +
            'terminal yang memulakan sambungan, jadi ia perlu tahu alamat pelayan sebelum ia ' +
            'boleh dihubungi sama sekali.',
        ),
      ),

    clearCallback: (): Promise<WriteAck> =>
      Promise.reject(this.unsupported('membuang sasaran push')),
  };

  vendorWarnings(): Promise<DeviceWarning[]> {
    const warnings: DeviceWarning[] = [];

    /**
     * No serial number means no way to recognise this unit when it calls.
     *
     * Every TA Push request identifies itself by serial and nothing else, so a record without
     * one cannot be matched to incoming scans — they are rejected as coming from an unregistered
     * terminal. Surfaced as a warning because the record otherwise looks complete.
     */
    if (this.device.serialNumber === null) {
      warnings.push({ key: 'device.warning.noSerial' });
    }

    if (!supportsPushedFace(this.device.firmware)) {
      warnings.push({ key: 'device.warning.faceAtTerminal' });
    }

    return Promise.resolve(warnings);
  }

  diagnostics(): Promise<Record<string, unknown>> {
    return Promise.resolve({
      /**
       * What the unit last told us, rather than what it says now.
       *
       * Labelled as such in the payload so the diagnostics tab does not present a stored copy
       * as a live reading — the distinction matters most here, because this is the tab somebody
       * opens when they already suspect the record is stale.
       */
      reported: {
        serialNumber: this.device.serialNumber,
        model: this.device.model,
        firmware: this.device.firmware,
        lastSeenAt: this.device.lastSeenAt,
      },
    });
  }

  /**
   * The terminal's UTC offset, for reading its zone-less timestamps.
   *
   * Taken from the organisation timezone via the stored drift is not possible — drift is not an
   * offset. So this uses the organisation's own offset, which is correct for every site in one
   * country and is the assumption the rest of the application already makes.
   *
   * A deployment spanning zones would need this per device. Stated rather than silently assumed,
   * because getting it wrong shifts every punch by whole hours and reads as staff arriving at
   * dawn rather than as a configuration mistake.
   */
  private offsetMinutes(): number {
    return orgOffsetMinutes();
  }

  private unsupported(what: string): Error {
    return conflict(
      `Terminal "${this.device.name}" menggunakan ${DeviceProtocol.taPush}, yang tidak menyokong ${what}. ` +
        'Protokol ini hanya membenarkan terminal menghubungi pelayan, jadi tiada apa untuk dipanggil.',
    );
  }
}

/**
 * Whether this firmware accepts a pushed face photograph.
 *
 * V1.5 is the reported threshold. Parsed leniently because firmware strings from this vendor
 * have been seen in several shapes, and the safe direction when the version cannot be read is
 * to treat the feature as absent — that produces a screen telling somebody to enrol at the
 * terminal, which works, rather than a queued command that never applies.
 */
function supportsPushedFace(firmware: string | null): boolean {
  if (firmware === null) return false;

  const match = /(\d+)\.(\d+)/.exec(firmware);
  if (!match) return false;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;

  return major > 1 || (major === 1 && minor >= 5);
}

/**
 * The organisation's current offset from UTC, in minutes.
 *
 * Computed through `Intl` rather than stored, so it stays correct across a DST boundary for a
 * zone that observes one. Malaysia does not, but the terminals this driver serves are not
 * guaranteed to stay in Malaysia.
 */
export function orgOffsetMinutes(): number {
  return zoneOffsetMinutes(new Date(), loadEnv().ORG_TIMEZONE);
}
