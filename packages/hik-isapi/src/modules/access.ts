import { asArray, asBoolean, asNumber, asString, dig, isRecord } from '../coerce.js';
import type { IsapiCore } from '../core.js';
import { isUnavailable } from '../parse.js';
import type { CardReaderConfig, DoorParam, TerminalOptions } from '../types.js';

/**
 * The capability documents worth reading.
 *
 * ISAPI has no index of these, so they are named rather than discovered. Each entry is
 * here because a control somewhere is built from it, which means an empty answer explains
 * why that control is disabled.
 *
 * Exported and shared by the settings route and the probe script. Two copies of this list
 * would drift, and the one that drifted would be the one being used to decide whether a
 * firmware supports something.
 */
export const CAPABILITY_DOCUMENTS = {
  acsConfig: '/ISAPI/AccessControl/AcsCfg/capabilities?format=json',
  cardReader: '/ISAPI/AccessControl/CardReaderCfg/capabilities?format=json',
  door: '/ISAPI/AccessControl/Door/param/capabilities?format=json',
  attendanceMode: '/ISAPI/AccessControl/Configuration/attendanceMode/capabilities?format=json',
  faceLibrary: '/ISAPI/Intelligent/FDLib/capabilities?format=json',
} as const;

/**
 * Door and reader configuration.
 *
 * Separate from `SystemModule` because these are per-door and per-reader, while that
 * module holds terminal-wide state. They also differ in how much can be trusted:
 * `deviceInfo` and `time` are answered identically by every unit, whereas the fields
 * below vary by firmware version. So every read here tolerates the endpoint being
 * absent, and every enumerated field asks the device for its own option list.
 */
export class AccessModule {
  constructor(private readonly core: IsapiCore) {}

  /**
   * Reads door behaviour, or null when this firmware has no such endpoint.
   *
   * Null rather than a throw. This feeds a settings tab, and a unit that does not
   * expose door parameters should render as "not supported on this firmware" beside
   * the settings that do work, instead of failing the tab and hiding all of them.
   */
  async doorParam(doorNo = 1): Promise<DoorParam | null> {
    const body = await this.readOptional(`/ISAPI/AccessControl/Door/param/${String(doorNo)}?format=json`);
    if (body === null) return null;

    const raw = recordAt(body, 'DoorParam');

    return {
      doorNo,
      doorName: asString(raw['doorName']) ?? null,
      openDuration: asNumber(raw['openDuration']) ?? null,
      disabledOpenDuration: asNumber(raw['disabledOpenDuration']) ?? null,
      magneticAlarmTimeout: asNumber(raw['magneticAlarmTimeout']) ?? null,
      magneticType: asString(raw['magneticType']) ?? null,
      openButtonType: asString(raw['openButtonType']) ?? null,
      doorNotClosedAlarmEnabled: asBoolean(raw['doorNotClosedAlarmEnabled']) ?? null,
      raw,
    };
  }

  /**
   * Writes door behaviour by reading it, merging, and putting the whole object back.
   *
   * A partial PUT is not safe here. `Door/param` is documented as a full-object
   * endpoint, and firmware that accepts a partial body resets the fields the body
   * omitted — which would mean changing the open duration silently clears the alarm
   * timeout, because this application does not model every field the door has.
   *
   * `AcsCfg` is the exception and is patched directly; see `SystemModule.setAcsConfig`.
   */
  async setDoorParam(doorNo: number, patch: Record<string, unknown>): Promise<void> {
    const current = await this.doorParam(doorNo);
    if (current === null) {
      throw new Error(
        `Terminal ini tidak menyokong konfigurasi pintu (Door/param/${String(doorNo)})`,
      );
    }

    await this.core.put(`/ISAPI/AccessControl/Door/param/${String(doorNo)}?format=json`, {
      DoorParam: { ...current.raw, ...patch },
    });
  }

  /** Momentarily releases the lock. Returns nothing: the door either opened or threw. */
  async openDoor(doorNo = 1): Promise<void> {
    await this.core.put(`/ISAPI/AccessControl/RemoteControl/door/${String(doorNo)}?format=json`, {
      RemoteControlDoor: { cmd: 'open' },
    });
  }

  async cardReaderConfig(readerNo = 1): Promise<CardReaderConfig | null> {
    const body = await this.readOptional(
      `/ISAPI/AccessControl/CardReaderCfg/${String(readerNo)}?format=json`,
    );
    if (body === null) return null;

    const raw = recordAt(body, 'CardReaderCfg');

    return {
      readerNo,
      enabled: asBoolean(raw['enable']) ?? null,
      defaultVerifyMode: asString(raw['defaultVerifyMode']) ?? null,
      functions: asArray(raw['cardReaderFunction'] as unknown[])
        .map((entry) => asString(entry))
        .filter((entry): entry is string => entry !== undefined),
      faceMatchThresholdN: asNumber(raw['faceMatchThresholdN']) ?? null,
      livingBodyDetect: asBoolean(raw['livingBodyDetect']) ?? null,
      liveDetLevel: asString(raw['liveDetLevelSet']) ?? null,
      fingerprintLevel: asNumber(raw['fingerPrintCheckLevel']) ?? null,
      raw,
    };
  }

  /** Read-modify-write, for the same reason as `setDoorParam`. */
  async setCardReaderConfig(readerNo: number, patch: Record<string, unknown>): Promise<void> {
    const current = await this.cardReaderConfig(readerNo);
    if (current === null) {
      throw new Error(
        `Terminal ini tidak menyokong konfigurasi pembaca (CardReaderCfg/${String(readerNo)})`,
      );
    }

    await this.core.put(`/ISAPI/AccessControl/CardReaderCfg/${String(readerNo)}?format=json`, {
      CardReaderCfg: { ...current.raw, ...patch },
    });
  }

  /**
   * Asks the terminal which values it accepts for an enumerated field.
   *
   * This is what stops the authentication mode list from being a guess. ISAPI encodes
   * an enum in its capability document as an `opt` attribute holding a comma-separated
   * list, so a control built from this offers exactly the modes the unit implements —
   * no more, and no fewer.
   */
  async options(capabilityPath: string, field: string): Promise<TerminalOptions | null> {
    const body = await this.readOptional(capabilityPath);
    if (body === null) return null;

    const found = findOptions(body, field);
    return found === null ? null : { field, values: found };
  }

  /**
   * Several fields' option lists from one capability document.
   *
   * One read rather than one per field. These terminals are modest hardware and the door
   * settings tab needs three enumerations to draw itself, which as three separate requests
   * is three Digest handshakes for one screen.
   */
  async optionSets(
    capabilityPath: string,
    fields: readonly string[],
  ): Promise<Record<string, string[]>> {
    const body = await this.readOptional(capabilityPath);
    if (body === null) return {};

    const found: Record<string, string[]> = {};
    for (const field of fields) {
      const values = findOptions(body, field);
      if (values !== null) found[field] = values;
    }
    return found;
  }

  /** Raw capability document, for the diagnostics tab. */
  capabilities(path: string): Promise<unknown | null> {
    return this.readOptional(path);
  }

  /**
   * GET that answers null when the terminal has nothing at this address.
   *
   * Only the two "nothing here" codes are swallowed — see `isUnavailable`. An
   * authentication failure or an unreachable terminal still throws, because those are
   * faults to report rather than features to hide: reporting them as "not supported"
   * would send somebody looking at the wrong firmware instead of at the network.
   */
  private async readOptional(path: string): Promise<unknown | null> {
    try {
      return await this.core.get(path);
    } catch (error) {
      if (isUnavailable(error)) return null;
      throw error;
    }
  }
}

function recordAt(body: unknown, key: string): Record<string, unknown> {
  const found = dig(body, key);
  return isRecord(found) ? found : {};
}

/**
 * Finds a field's `opt` list anywhere in a capability document.
 *
 * Searched recursively rather than at a fixed path because ISAPI nests capability
 * fields differently per endpoint, and hardcoding one path per field would break on
 * the next firmware that moves it one level deeper.
 */
function findOptions(node: unknown, field: string): string[] | null {
  if (!isRecord(node)) return null;

  const direct = node[field];
  if (isRecord(direct)) {
    const opt = asString(direct['@opt']);
    if (opt !== undefined) {
      const values = opt
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      if (values.length > 0) return values;
    }
  }

  for (const value of Object.values(node)) {
    const nested = findOptions(value, field);
    if (nested !== null) return nested;
  }
  return null;
}
