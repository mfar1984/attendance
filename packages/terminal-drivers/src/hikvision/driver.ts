import {
  CAPABILITY_DOCUMENTS,
  type HikvisionClient,
  type Person,
} from '@attendance/hik-isapi';
import { DeviceProtocol } from '@attendance/shared';

import { driverLogger } from '../logging.js';
import {
  APPLIED,
  DriverOperation,
  type DriverCapabilities,
  type PullCursor,
  type PullResult,
  type TerminalDriver,
  type WriteAck,
} from '../contract.js';
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
} from '../types.js';
import { hikvisionEventKey, toTerminalEvent } from './events.js';

/**
 * Reader fields whose option list the screen needs.
 *
 * Asked for together in one capability read. `defaultVerifyMode` is included knowing this
 * firmware does not publish it, because a firmware that does should light the control up
 * without another change here.
 */
const READER_OPTION_FIELDS = [
  'defaultVerifyMode',
  'fingerPrintCheckLevel',
  'liveDetLevelSet',
  'cardReaderFunction',
] as const;

/**
 * Hikvision ISAPI as an implementation of the driver contract.
 *
 * Written to change no behaviour at all. Every method below performs the same calls, in the
 * same order, with the same error handling as the code that called `HikvisionClient` directly
 * — which is the point: if satisfying the contract had required stretching it, the contract
 * would be wrong, and better to discover that here than after a second vendor is built on it.
 *
 * The three behavioural contracts the interface documents are inherited rather than
 * reimplemented. One-request-in-flight, the bounded retry for a session limit, and the local
 * lockout gate all live inside `DigestHttpClient`, which this wraps. That is why the client
 * is cached per device and shared: a fresh one per call would discard the lockout state that
 * stops a loop over 5000 staff from locking the device account.
 */
export class HikvisionDriver implements TerminalDriver {
  readonly protocol = DeviceProtocol.isapi;

  /**
   * Everything ISAPI can do, which on this vendor is every operation the server has.
   *
   * Hikvision is the protocol the application was built against, so its capability list is
   * necessarily complete. The value of declaring it is in what the *other* drivers leave out.
   */
  readonly capabilities: DriverCapabilities = {
    operations: Object.values(DriverOperation),
    writeModel: 'inline',
    reachability: 'serverInitiated',
  };

  constructor(private readonly client: HikvisionClient) {}

  /**
   * The underlying ISAPI client.
   *
   * Exposed only so `clientFor` can keep serving call sites that have not moved to the
   * contract yet, which let the migration happen in reviewable steps instead of one change
   * touching all 26 device operations at once. Nothing new should reach for this: a caller
   * holding the raw client is a caller that stops working on the next vendor.
   */
  get rawClient(): HikvisionClient {
    return this.client;
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  readonly identity = {
    read: async (): Promise<TerminalIdentity> => {
      const info = await this.client.system.deviceInfo();
      return {
        name: info.deviceName,
        model: info.model,
        serialNumber: info.serialNumber,
        macAddress: info.macAddress,
        firmware: info.firmwareVersion,
      };
    },

    counts: async (): Promise<TerminalCounts> => {
      const counts = await this.client.persons.counts();
      return {
        people: counts.userNumber,
        withFace: counts.bindFaceUserNumber,
        withFingerprint: counts.bindFingerprintUserNumber,
        withCard: counts.bindCardUserNumber,
      };
    },

    capacity: async (): Promise<TerminalCapacity> => {
      const capacity = await this.client.faces.capacity();
      return {
        /**
         * Null rather than the face figure.
         *
         * This endpoint reports the face library ceiling, and person capacity is a different
         * limit the unit does not publish here. Copying one into the other would have the
         * enrolment guard refuse people on a number that describes something else.
         */
        people: null,
        faces: capacity.maxRecords,
        fingerprints: null,
      };
    },

    faceStores: async (): Promise<FaceStore[]> => {
      const libraries = await this.client.faces.libraries();
      // `FDID` is Hikvision's name for it and stops here.
      return libraries.map((library) => ({ id: library.FDID, name: library.name }));
    },
  };

  readonly clock = {
    read: async (): Promise<ClockReading> => {
      const drift = await this.client.system.clockDrift();
      return {
        deviceTime: drift.deviceTime,
        serverTime: drift.serverTime,
        driftSeconds: drift.driftSeconds,
        source: drift.manualClock ? 'manual' : 'ntp',
        utcOffsetMinutes: parseHikvisionTimeZone(drift.timeZone),
        rawTimeZone: drift.timeZone,
      };
    },

    setManually: async (when: Date, timeZone: string): Promise<WriteAck> => {
      await this.client.system.setManualTime(when, timeZone);
      return APPLIED;
    },

    configureNtp: async (config: {
      host: string;
      timeZone: string;
      port?: number;
      intervalMinutes?: number;
    }): Promise<WriteAck> => {
      await this.client.system.configureNtp(config);
      return APPLIED;
    },
  };

  readonly people = {
    upsert: async (person: PersonUpsert): Promise<WriteAck> => {
      await this.client.persons.upsert({
        employeeNo: person.employeeNo,
        name: person.name,
        userType: 'normal',
        ...(person.validFrom ? { validFrom: person.validFrom } : {}),
        ...(person.validTo ? { validTo: person.validTo } : {}),
        ...(person.pin ? { password: person.pin } : {}),
        ...(person.doorNo === undefined ? {} : { doorNo: person.doorNo }),
      });
      return APPLIED;
    },

    remove: async (employeeNos: string[]): Promise<WriteAck> => {
      await this.client.persons.remove(employeeNos);
      return APPLIED;
    },

    find: async (employeeNo: string): Promise<TerminalPerson | null> => {
      const person = await this.client.persons.find(employeeNo);
      return person === null ? null : toTerminalPerson(person);
    },

    list: (): AsyncIterable<TerminalPerson> => {
      const client = this.client;
      return {
        async *[Symbol.asyncIterator]() {
          for await (const person of client.persons.iterate()) {
            yield toTerminalPerson(person);
          }
        },
      };
    },
  };

  readonly biometrics = {
    enrolFace: async (employeeNo: string, jpeg: Buffer): Promise<WriteAck> => {
      /**
       * Replaced rather than added, and the delete is deliberately swallowed.
       *
       * The firmware keeps one face per person, and uploading over an existing record can
       * fail instead of overwriting — which leaves the old face in place and the new one
       * silently ignored. A person whose photograph was updated would keep matching against
       * the picture they replaced.
       */
      await this.client.faces.remove(employeeNo).catch(() => undefined);
      await this.client.faces.enroll(employeeNo, jpeg);
      return APPLIED;
    },

    removeFace: async (employeeNo: string): Promise<WriteAck> => {
      await this.client.faces.remove(employeeNo);
      return APPLIED;
    },

    readFace: async (pointer: string): Promise<Buffer> => this.client.faces.image(pointer),
  };

  readonly events = {
    pull: async (cursor: PullCursor): Promise<PullResult> => {
      const from = cursor.sequence ?? 0;
      const acsEvents = await this.client.events.since(from);

      const events = acsEvents.flatMap((event) => {
        const mapped = toTerminalEvent(event);
        if (mapped) return [mapped];
        driverLogger().warn(
          { serialNo: event.serialNo, time: event.time, eventKey: hikvisionEventKey(event.serialNo) },
          'Skipping a pulled event with an unparseable timestamp',
        );
        return [];
      });

      /**
       * Advanced from the raw batch, not the decoded one.
       *
       * An event dropped for a bad timestamp must still move the cursor past itself, or the
       * pull re-fetches it forever and never reaches anything newer.
       */
      const highest = acsEvents.reduce(
        (max, event) => (event.serialNo > max ? event.serialNo : max),
        from,
      );

      return { events, cursor: { sequence: highest, since: null } };
    },

    picture: async (pointer: string): Promise<Buffer> => this.client.events.picture(pointer),
  };

  readonly access = {
    door: async (doorNo: number): Promise<DoorSettings | null> => {
      const door = await this.client.access.doorParam(doorNo);
      if (door === null) return null;
      return {
        doorNo: door.doorNo,
        name: door.doorName,
        openSeconds: door.openDuration,
        extendedOpenSeconds: door.disabledOpenDuration,
        heldOpenAlarmSeconds: door.magneticAlarmTimeout,
        sensorRestState: door.magneticType,
        exitButtonRestState: door.openButtonType,
        heldOpenAlarmEnabled: door.doorNotClosedAlarmEnabled,
        raw: door.raw,
      };
    },

    setDoor: async (doorNo: number, patch: DoorPatch): Promise<WriteAck> => {
      /**
       * Translated onto the names this firmware actually uses.
       *
       * Not guessable from the ISAPI reference: the held-open alarm is `magneticAlarmTimeout`
       * here, not `doorOpenTimeout`. A write to a name the device has never heard of is
       * accepted and ignored, which is the worst of the possible outcomes.
       */
      await this.client.access.setDoorParam(doorNo, {
        ...(patch.openSeconds === undefined ? {} : { openDuration: patch.openSeconds }),
        ...(patch.extendedOpenSeconds === undefined
          ? {}
          : { disabledOpenDuration: patch.extendedOpenSeconds }),
        ...(patch.heldOpenAlarmSeconds === undefined
          ? {}
          : { magneticAlarmTimeout: patch.heldOpenAlarmSeconds }),
        ...(patch.heldOpenAlarmEnabled === undefined
          ? {}
          : { doorNotClosedAlarmEnabled: patch.heldOpenAlarmEnabled }),
        ...(patch.sensorRestState === undefined ? {} : { magneticType: patch.sensorRestState }),
      });
      return APPLIED;
    },

    reader: async (readerNo: number): Promise<ReaderSettings | null> => {
      const reader = await this.client.access.cardReaderConfig(readerNo);
      if (reader === null) return null;
      return {
        readerNo: reader.readerNo,
        enabled: reader.enabled,
        verifyMode: reader.defaultVerifyMode,
        functions: reader.functions,
        faceThreshold: reader.faceMatchThresholdN,
        livenessEnabled: reader.livingBodyDetect,
        /**
         * Read as `liveDetLevel` but written as `liveDetLevelSet`.
         *
         * The firmware genuinely uses different names for the two directions. Matching them
         * up in the neutral type is the whole reason this translation exists.
         */
        livenessLevel: reader.liveDetLevel,
        fingerprintLevel: reader.fingerprintLevel,
        raw: reader.raw,
      };
    },

    setReader: async (readerNo: number, patch: ReaderPatch): Promise<WriteAck> => {
      await this.client.access.setCardReaderConfig(readerNo, {
        ...(patch.verifyMode === undefined ? {} : { defaultVerifyMode: patch.verifyMode }),
        ...(patch.fingerprintLevel === undefined
          ? {}
          : { fingerPrintCheckLevel: patch.fingerprintLevel }),
        ...(patch.faceThreshold === undefined ? {} : { faceMatchThresholdN: patch.faceThreshold }),
        ...(patch.livenessEnabled === undefined
          ? {}
          : { livingBodyDetect: patch.livenessEnabled }),
        ...(patch.livenessLevel === undefined ? {} : { liveDetLevelSet: patch.livenessLevel }),
      });
      return APPLIED;
    },

    open: async (doorNo: number): Promise<WriteAck> => {
      await this.client.access.openDoor(doorNo);
      return APPLIED;
    },

    options: async (): Promise<OptionSets> =>
      this.client.access.optionSets(CAPABILITY_DOCUMENTS.cardReader, READER_OPTION_FIELDS),
  };

  readonly attendance = {
    mode: async (): Promise<AttendanceModeSetting | null> => {
      const mode = await this.client.system.attendanceMode();
      return {
        mode: mode.mode,
        /**
         * The other two fields are read and displayed but never written.
         *
         * The firmware treats them as part of the mode's own definition and nothing in this
         * application consumes them — and writing settings nothing reads is how a screen
         * grows controls that appear to work and change nothing.
         */
        raw: {
          attendanceStatusTime: mode.attendanceStatusTime,
          reqAttendanceStatus: mode.reqAttendanceStatus,
        },
      };
    },

    setMode: async (mode: AttendanceModeSetting['mode']): Promise<WriteAck> => {
      await this.client.system.setAttendanceMode(mode);
      return APPLIED;
    },
  };

  readonly lifecycle = {
    reboot: async (): Promise<WriteAck> => {
      /**
       * A dropped connection is the expected outcome, not a failure.
       *
       * The firmware stops answering mid-reply. The caller probes reachability first, so by
       * the time this runs the unit answered a moment ago and a thrown socket error means the
       * restart is starting rather than that the terminal was never there.
       */
      try {
        await this.client.system.reboot();
      } catch (error) {
        driverLogger().info(
          { err: error instanceof Error ? error.message : String(error) },
          'Terminal dropped the connection while rebooting, which is expected',
        );
      }
      return APPLIED;
    },

    callbackTargets: async (): Promise<CallbackTarget[]> => {
      const hosts = await this.client.notifications.hosts();
      // The password is dropped here rather than at the route, so no caller can reach it.
      return hosts.map((host) => {
        const scheme = host.protocolType.toLowerCase() === 'https' ? 'https' : 'http';
        const address = host.ipAddress ?? host.hostName ?? '';
        /**
         * An unconfigured slot answers with a zero address and port rather than an empty
         * record, so those are collapsed to an empty string. A slot rendered as
         * `http://0.0.0.0:0/` reads as a misconfiguration somebody should fix, when in fact
         * it is simply free.
         */
        const configured = address !== '' && address !== '0.0.0.0' && host.portNo > 0;

        return {
          slot: Number(host.id),
          url: configured ? `${scheme}://${address}:${String(host.portNo)}${host.url}` : '',
          authMethod: host.httpAuthenticationMethod,
          authUser: host.userName ?? null,
          format: host.parameterFormatType,
          heartbeatSeconds: host.heartbeat ?? null,
        };
      });
    },

    configureCallback: async (config: CallbackConfig): Promise<WriteAck> => {
      await this.client.notifications.configureIngest({
        host: config.host,
        port: config.port,
        path: config.path,
        ...(config.slot === undefined ? {} : { slot: config.slot }),
        ...(config.useHttps ? { useHttps: true } : {}),
        ...(config.auth ? { auth: config.auth } : {}),
        ...(config.heartbeatSeconds === undefined
          ? {}
          : { heartbeatSeconds: config.heartbeatSeconds }),
      });
      return APPLIED;
    },

    clearCallback: async (slot: number): Promise<WriteAck> => {
      await this.client.notifications.clear(slot);
      return APPLIED;
    },
  };

  async vendorWarnings(): Promise<DeviceWarning[]> {
    /**
     * A remote verification channel that always times out adds its timeout to every single
     * scan, which is felt as a queue at the door each morning and reported by nothing on the
     * terminal itself.
     *
     * Swallowed on failure rather than thrown: this is an optional diagnostic, and a firmware
     * that hides `AcsCfg` must not make the whole health check report the unit as offline.
     */
    const config = await this.client.system.acsConfig().catch(() => null);
    if (config === null) return [];
    if (config['remoteCheckDoorEnabled'] !== true) return [];

    return [
      {
        key: 'device.warning.remoteCheck',
        vars: {
          channel: String(config['checkChannelType']),
          timeout: String(config['remoteCheckTimeout']),
        },
      },
    ];
  }

  async diagnostics(): Promise<Record<string, unknown>> {
    const acs = await this.client.system.acsConfig().catch(() => null);
    const capabilities: Record<string, unknown> = {};

    // Sequential rather than in parallel: these are modest boxes, and five simultaneous
    // Digest handshakes is a good way to make one look unreachable.
    for (const [name, path] of Object.entries(CAPABILITY_DOCUMENTS)) {
      capabilities[name] = await this.client.access.capabilities(path).catch(() => null);
    }

    return { acsConfig: acs, capabilities };
  }
}

function toTerminalPerson(person: Person): TerminalPerson {
  return {
    employeeNo: person.employeeNo,
    name: person.name,
    /**
     * `Valid.enable` decides whether the window means anything.
     *
     * A disabled window still carries dates on this firmware, and reading them as a real
     * validity period would show a person expiring on a date the terminal is ignoring.
     */
    validFrom: person.Valid.enable ? parseLocal(person.Valid.beginTime) : null,
    validTo: person.Valid.enable ? parseLocal(person.Valid.endTime) : null,
    hasPin: (person.password ?? '').length > 0,
    credentials: {
      faces: person.numOfFace ?? null,
      fingerprints: person.numOfFP ?? null,
      cards: person.numOfCard ?? null,
    },
    facePointer: person.faceURL ?? null,
  };
}

function parseLocal(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Hikvision's timezone notation, which inverts the sign.
 *
 * `CST-8:00:00` denotes UTC+8. Getting this backwards puts a terminal sixteen hours out,
 * which reads as a broken clock rather than as a wrong setting — so it is parsed once here
 * and every caller above this line receives plain minutes east of UTC.
 *
 * The matching writer is `toHikvisionTimeZone` in `time.ts`, kept there because
 * `scripts/test-time.mts` asserts on it.
 */
export function parseHikvisionTimeZone(value: string): number | null {
  const match = /^[A-Za-z]*([+-])(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  const magnitude = hours * 60 + minutes;
  // Inverted on purpose: a leading `-` means east of UTC.
  return match[1] === '-' ? magnitude : -magnitude;
}
