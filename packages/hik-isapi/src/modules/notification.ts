import { asArray, asNumber, asString, dig } from '../coerce.js';
import type { IsapiCore } from '../core.js';
import { DEVICE_LIMITS, type HttpHostNotification } from '../types.js';

export interface IngestTarget {
  /** Slot number. This firmware exposes only two. */
  slot?: number;
  /** Hostname or IPv4 address the device will post to. */
  host: string;
  port: number;
  /** Path component, e.g. `/hik/events`. */
  path: string;
  useHttps?: boolean;
  /**
   * Leave undefined only for an isolated network. With `none`, anything that can
   * reach the ingest endpoint can forge attendance punches.
   */
  auth?: { username: string; password: string };
  /** Seconds between keep-alive posts, 1-30. */
  heartbeatSeconds?: number;
}

export class NotificationModule {
  constructor(private readonly core: IsapiCore) {}

  /** Reads all notification slots. This endpoint answers in XML. */
  async hosts(): Promise<HttpHostNotification[]> {
    const body = await this.core.get('/ISAPI/Event/notification/httpHosts');
    const hosts = asArray(dig(body, 'HttpHostNotificationList', 'HttpHostNotification') as unknown[]);
    return hosts.map((raw) => {
      const host: HttpHostNotification = {
        id: asString(dig(raw, 'id')) ?? '1',
        url: asString(dig(raw, 'url')) ?? '',
        protocolType: (asString(dig(raw, 'protocolType')) ?? 'HTTP') as HttpHostNotification['protocolType'],
        parameterFormatType: (asString(dig(raw, 'parameterFormatType')) ??
          'JSON') as HttpHostNotification['parameterFormatType'],
        addressingFormatType: (asString(dig(raw, 'addressingFormatType')) ??
          'ipaddress') as HttpHostNotification['addressingFormatType'],
        portNo: asNumber(dig(raw, 'portNo')) ?? 0,
        httpAuthenticationMethod: (asString(dig(raw, 'httpAuthenticationMethod')) ??
          'none') as HttpHostNotification['httpAuthenticationMethod'],
      };

      const ipAddress = asString(dig(raw, 'ipAddress'));
      const hostName = asString(dig(raw, 'hostName'));
      const heartbeat = asNumber(dig(raw, 'SubscribeEvent', 'heartbeat'));
      if (ipAddress !== undefined) host.ipAddress = ipAddress;
      if (hostName !== undefined) host.hostName = hostName;
      if (heartbeat !== undefined) host.heartbeat = heartbeat;

      return host;
    });
  }

  /**
   * Points a notification slot at our ingest endpoint.
   *
   * Push delivery is fire-and-forget: the terminal keeps no queue and performs
   * no retry, so anything missed while the listener is down is only recoverable
   * through a serial-cursor pull. Configure this alongside the pull worker, not
   * instead of it.
   */
  async configureIngest(target: IngestTarget): Promise<void> {
    const slot = target.slot ?? 1;
    if (slot < 1 || slot > DEVICE_LIMITS.notificationHostSlots) {
      throw new RangeError(
        `Notification slot must be 1-${DEVICE_LIMITS.notificationHostSlots} on this firmware`,
      );
    }

    const { min, max } = DEVICE_LIMITS.ingestPasswordLength;
    if (target.auth && (target.auth.password.length < min || target.auth.password.length > max)) {
      throw new RangeError(
        `Ingest password must be ${min}-${max} characters to satisfy the device, received ${target.auth.password.length}`,
      );
    }

    const isIpAddress = /^\d{1,3}(\.\d{1,3}){3}$/.test(target.host);
    const path = target.path.startsWith('/') ? target.path : `/${target.path}`;
    if (path.length > 128) {
      throw new RangeError(`Ingest path exceeds the device's 128 character limit: ${path.length}`);
    }

    const elements = [
      `<id>${slot}</id>`,
      `<url>${escapeXml(path)}</url>`,
      `<protocolType>${target.useHttps ? 'HTTPS' : 'HTTP'}</protocolType>`,
      `<parameterFormatType>JSON</parameterFormatType>`,
      `<addressingFormatType>${isIpAddress ? 'ipaddress' : 'hostname'}</addressingFormatType>`,
      isIpAddress
        ? `<ipAddress>${escapeXml(target.host)}</ipAddress>`
        : `<hostName>${escapeXml(target.host)}</hostName>`,
      `<portNo>${target.port}</portNo>`,
      `<httpAuthenticationMethod>${target.auth ? 'MD5digest' : 'none'}</httpAuthenticationMethod>`,
    ];

    if (target.auth) {
      elements.push(
        `<userName>${escapeXml(target.auth.username)}</userName>`,
        `<password>${escapeXml(target.auth.password)}</password>`,
      );
    }
    elements.push(
      `<SubscribeEvent><heartbeat>${clampHeartbeat(target.heartbeatSeconds)}</heartbeat>` +
        `<eventMode>all</eventMode></SubscribeEvent>`,
    );

    await this.core.putXml(
      `/ISAPI/Event/notification/httpHosts/${slot}`,
      `<HttpHostNotification>${elements.join('')}</HttpHostNotification>`,
    );
  }

  /** Clears a slot so the terminal stops pushing to a decommissioned listener. */
  async clear(slot: number): Promise<void> {
    await this.core.putXml(
      `/ISAPI/Event/notification/httpHosts/${slot}`,
      `<HttpHostNotification><id>${slot}</id><url></url>` +
        `<protocolType>HTTP</protocolType><parameterFormatType>JSON</parameterFormatType>` +
        `<addressingFormatType>ipaddress</addressingFormatType>` +
        `<ipAddress>0.0.0.0</ipAddress><portNo>0</portNo>` +
        `<httpAuthenticationMethod>none</httpAuthenticationMethod></HttpHostNotification>`,
    );
  }
}

/** Firmware accepts 1-30 seconds. */
function clampHeartbeat(seconds: number | undefined): number {
  if (seconds === undefined) return 30;
  return Math.min(30, Math.max(1, Math.trunc(seconds)));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
