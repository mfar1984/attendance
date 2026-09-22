import { asBoolean, asNumber, asString, dig, requireString, asArray } from '../coerce.js';
import type { IsapiCore } from '../core.js';
import type { AttendanceMode, DeviceInfo, DeviceTime, NtpServer } from '../types.js';

export interface ClockDrift {
  deviceTime: Date;
  serverTime: Date;
  /** Positive when the device runs ahead of the server. */
  driftSeconds: number;
  /** True when NTP is not driving the clock, so drift will keep growing. */
  manualClock: boolean;
  timeZone: string;
}

/**
 * Device identity, clock and terminal-wide behaviour flags.
 *
 * `deviceInfo`, `time` and `ntpServers` answer in XML even when `format=json`
 * is requested, so this module reads through the format-agnostic decoder.
 */
export class SystemModule {
  constructor(private readonly core: IsapiCore) {}

  async deviceInfo(): Promise<DeviceInfo> {
    const body = await this.core.get('/ISAPI/System/deviceInfo');
    const info = dig(body, 'DeviceInfo');
    return {
      deviceName: requireString(dig(info, 'deviceName'), 'deviceName'),
      model: requireString(dig(info, 'model'), 'model'),
      serialNumber: requireString(dig(info, 'serialNumber'), 'serialNumber'),
      macAddress: requireString(dig(info, 'macAddress'), 'macAddress'),
      firmwareVersion: requireString(dig(info, 'firmwareVersion'), 'firmwareVersion'),
      firmwareReleasedDate: asString(dig(info, 'firmwareReleasedDate')) ?? null,
      deviceType: asString(dig(info, 'deviceType')) ?? null,
      subDeviceType: asString(dig(info, 'subDeviceType')) ?? null,
    };
  }

  async time(): Promise<DeviceTime> {
    const body = await this.core.get('/ISAPI/System/time');
    const time = dig(body, 'Time');
    return {
      timeMode: requireString(dig(time, 'timeMode'), 'timeMode'),
      localTime: requireString(dig(time, 'localTime'), 'localTime'),
      timeZone: requireString(dig(time, 'timeZone'), 'timeZone'),
    };
  }

  /**
   * Compares the terminal clock against this host.
   *
   * Clock accuracy is the single failure mode that corrupts every attendance
   * record without producing an error anywhere, so this is measured rather than
   * assumed. A `manual` time mode means nothing is correcting the drift.
   */
  async clockDrift(): Promise<ClockDrift> {
    const serverBefore = Date.now();
    const time = await this.time();
    const serverAfter = Date.now();

    // Midpoint of the request window keeps network latency from being counted
    // as clock error.
    const serverTime = new Date((serverBefore + serverAfter) / 2);
    const deviceTime = new Date(time.localTime);
    if (Number.isNaN(deviceTime.getTime())) {
      throw new TypeError(`Device returned an unparseable localTime: "${time.localTime}"`);
    }

    return {
      deviceTime,
      serverTime,
      driftSeconds: Math.round((deviceTime.getTime() - serverTime.getTime()) / 1000),
      manualClock: time.timeMode.toLowerCase() === 'manual',
      timeZone: time.timeZone,
    };
  }

  async ntpServers(): Promise<NtpServer[]> {
    const body = await this.core.get('/ISAPI/System/time/ntpServers');
    const servers = asArray(dig(body, 'NTPServerList', 'NTPServer') as unknown[]);
    return servers.map((raw) => ({
      id: asString(dig(raw, 'id')) ?? '1',
      addressingFormatType: asString(dig(raw, 'addressingFormatType')) ?? 'ipaddress',
      ipAddress: asString(dig(raw, 'ipAddress')),
      hostName: asString(dig(raw, 'hostName')),
      portNo: asNumber(dig(raw, 'portNo')) ?? 123,
      synchronizeInterval: asNumber(dig(raw, 'synchronizeInterval')) ?? 60,
    }));
  }

  /**
   * Points the terminal at an NTP host and hands the clock over to it.
   *
   * Both calls are required: writing the server alone leaves `timeMode` on
   * `manual`, and the device keeps ignoring NTP.
   */
  async configureNtp(options: {
    host: string;
    /** Hikvision's inverted POSIX form: `CST-8:00:00` means UTC+8. */
    timeZone: string;
    port?: number;
    /** Minutes between synchronisations. */
    intervalMinutes?: number;
    slot?: number;
  }): Promise<void> {
    const slot = options.slot ?? 1;
    const isIpAddress = /^\d{1,3}(\.\d{1,3}){3}$/.test(options.host);
    const addressElement = isIpAddress
      ? `<ipAddress>${escapeXml(options.host)}</ipAddress>`
      : `<hostName>${escapeXml(options.host)}</hostName>`;

    await this.core.putXml(
      `/ISAPI/System/time/ntpServers/${slot}`,
      `<NTPServer><id>${slot}</id>` +
        `<addressingFormatType>${isIpAddress ? 'ipaddress' : 'hostname'}</addressingFormatType>` +
        `${addressElement}` +
        `<portNo>${options.port ?? 123}</portNo>` +
        `<synchronizeInterval>${options.intervalMinutes ?? 60}</synchronizeInterval>` +
        `</NTPServer>`,
    );

    await this.core.putXml(
      '/ISAPI/System/time',
      `<Time><timeMode>NTP</timeMode><timeZone>${escapeXml(options.timeZone)}</timeZone></Time>`,
    );
  }

  /** Writes an absolute time. Only useful when no NTP server is reachable. */
  async setManualTime(when: Date, timeZone: string): Promise<void> {
    await this.core.putXml(
      '/ISAPI/System/time',
      `<Time><timeMode>manual</timeMode>` +
        `<localTime>${formatLocalTime(when)}</localTime>` +
        `<timeZone>${escapeXml(timeZone)}</timeZone></Time>`,
    );
  }

  /**
   * Reads the attendance mode.
   *
   * While `disable` is set the terminal emits no `attendanceStatus` on events,
   * so check-in versus check-out has to be derived from scan order downstream.
   */
  async attendanceMode(): Promise<AttendanceMode> {
    const body = await this.core.get('/ISAPI/AccessControl/Configuration/attendanceMode?format=json');
    const mode = dig(body, 'AttendanceMode');
    return {
      mode: (asString(dig(mode, 'mode')) ?? 'disable') as AttendanceMode['mode'],
      attendanceStatusTime: asNumber(dig(mode, 'attendanceStatusTime')) ?? 20,
      reqAttendanceStatus: asBoolean(dig(mode, 'reqAttendanceStatus')) ?? false,
    };
  }

  async setAttendanceMode(mode: AttendanceMode['mode']): Promise<void> {
    await this.core.put('/ISAPI/AccessControl/Configuration/attendanceMode?format=json', {
      AttendanceMode: { mode },
    });
  }

  /**
   * Restarts the terminal.
   *
   * The firmware often cuts the connection while answering, so a dropped socket here is
   * the expected outcome rather than a failure — the caller has to know the device was
   * reachable *before* the command to tell "it is rebooting" from "it was never there".
   * `devices/terminal.ts` probes first for exactly that reason.
   *
   * Recorded events survive: they live in the terminal's own log against a monotonic
   * serial number, and the pull cursor picks up anything push missed while it was down.
   */
  async reboot(): Promise<void> {
    await this.core.putXml('/ISAPI/System/reboot', '');
  }

  /** Terminal-wide access control flags, including remote verification. */
  async acsConfig(): Promise<Record<string, unknown>> {
    const body = await this.core.get('/ISAPI/AccessControl/AcsCfg?format=json');
    const config = dig(body, 'AcsCfg');
    return typeof config === 'object' && config !== null
      ? (config as Record<string, unknown>)
      : {};
  }

  /**
   * Patches terminal-wide access control flags.
   *
   * A partial body on purpose, unlike `Door/param` and `CardReaderCfg` which are
   * read-modify-write. This endpoint is known to accept one field on this hardware —
   * `disableRemoteCheck` has been doing exactly that since before this method existed —
   * and sending the whole object back would also send fields the device reports but
   * refuses to be told, which fails the write for a setting nobody was changing.
   */
  async setAcsConfig(patch: Record<string, unknown>): Promise<void> {
    await this.core.put('/ISAPI/AccessControl/AcsCfg?format=json', { AcsCfg: patch });
  }

  /**
   * Disables remote door verification.
   *
   * When enabled with an unreachable channel, every authentication waits for
   * `remoteCheckTimeout` seconds and reports `remoteCheckResult: "timeout"`,
   * adding that delay to every scan.
   */
  async disableRemoteCheck(): Promise<void> {
    await this.setAcsConfig({ remoteCheckDoorEnabled: false });
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** ISAPI expects `YYYY-MM-DDTHH:mm:ss` in the device's own local time. */
function formatLocalTime(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
    `T${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`
  );
}
