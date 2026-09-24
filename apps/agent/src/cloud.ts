import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  AgentCommandItem,
  AgentCommandOutcome,
  AgentEnrolReply,
  AgentHeartbeat,
  AgentHeartbeatReply,
  AgentSnapshotBatch,
  TerminalEventPayload,
} from '@attendance/shared';

import type { AgentConfig } from './config.js';
import { logger } from './logging.js';

/**
 * Everything this connector says to the cloud.
 *
 * All of it outbound. Nothing listens for the cloud, which is what lets a hospital publish one
 * egress rule and no ingress one — and it is why commands are collected on a timer rather than
 * delivered.
 */

/**
 * How a call failed, because the three cases need three different responses and treating them
 * alike is how a connector either spins forever or throws away evidence.
 *
 * - `unreachable`: network, DNS, timeout, or a 5xx. The cloud may be fine in a minute. Keep the
 *   spool and try again.
 * - `rejected`: a 4xx that is not about the credential. This payload will be refused every time,
 *   so retrying it blocks everything behind it in the spool.
 * - `unauthorised`: 401. Retrying cannot help and hammering it tells an operator nothing. Report
 *   it loudly once per occurrence and keep the data.
 */
export type CallFailure =
  | { kind: 'unreachable'; detail: string }
  | { kind: 'rejected'; status: number; detail: string }
  | { kind: 'unauthorised'; detail: string };

export type CallResult<T> = { ok: true; value: T } | { ok: false; failure: CallFailure };

const CREDENTIAL_FILE = 'credential';

/** A call that has not answered in this long is treated as unreachable rather than waited on. */
const REQUEST_TIMEOUT_MS = 30_000;

export class Cloud {
  private secret: string | null;

  constructor(private readonly config: AgentConfig) {
    this.secret = readCredential(config);
  }

  get enrolled(): boolean {
    return this.secret !== null;
  }

  /**
   * Exchanges the installer's token for a working credential and stores it.
   *
   * Written to a file at `0600` rather than handed back to whoever ran the installer. A secret
   * that has to be pasted into a config file is a secret in an editor's history and in whatever
   * the operator used to copy it.
   */
  async enrol(token: string): Promise<CallResult<AgentEnrolReply>> {
    const result = await this.call<AgentEnrolReply>('POST', '/agent/enrol', {
      token,
      version: this.config.version,
      lanHost: this.config.advertisedHost,
      lanPort: this.config.LISTEN_PORT,
    }, { authenticated: false });

    if (!result.ok) return result;

    writeCredential(this.config, result.value.secret);
    this.secret = result.value.secret;

    logger().info(
      { agentKey: result.value.agentKey, name: result.value.name },
      'Enrolled with the cloud',
    );
    return result;
  }

  heartbeat(payload: AgentHeartbeat): Promise<CallResult<AgentHeartbeatReply>> {
    return this.call<AgentHeartbeatReply>('POST', '/agent/heartbeat', payload);
  }

  /**
   * Reports what one terminal says about its own settings.
   *
   * Its own call rather than part of the heartbeat, because these are large and change rarely.
   * Carrying them on a request that arrives every sixty seconds from every site would spend
   * bandwidth continuously for a value that moves only when somebody edits a setting.
   */
  snapshots(payload: AgentSnapshotBatch): Promise<CallResult<{ stored: number }>> {
    return this.call<{ stored: number }>('POST', '/agent/snapshots', payload);
  }

  /**
   * Takes the wire shape, not the parsed one.
   *
   * What the connector holds is JSON read back from the spool, where `at` is a string. The cloud
   * coerces it to a Date on arrival; asking for a Date here would mean converting twice and
   * losing the distinction the spool depends on.
   */
  postEvents(
    deviceId: number,
    arrivedVia: 'push' | 'pull',
    events: TerminalEventPayload[],
  ): Promise<CallResult<{ stored: number; duplicates: number }>> {
    return this.call('POST', '/agent/events', { deviceId, arrivedVia, events });
  }

  commands(): Promise<CallResult<{ commands: AgentCommandItem[] }>> {
    return this.call('GET', '/agent/commands');
  }

  reportCommand(commandId: string, outcome: AgentCommandOutcome): Promise<CallResult<unknown>> {
    return this.call('POST', `/agent/commands/${commandId}`, outcome);
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    options: { authenticated?: boolean } = {},
  ): Promise<CallResult<T>> {
    const authenticated = options.authenticated ?? true;

    if (authenticated && this.secret === null) {
      return { ok: false, failure: { kind: 'unauthorised', detail: 'belum berdaftar' } };
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (authenticated && this.secret !== null) {
      headers['authorization'] = `Bearer ${this.secret}`;
    }

    let response: Response;
    try {
      response = await fetch(new URL(path, this.config.CLOUD_URL), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      return {
        ok: false,
        failure: {
          kind: 'unreachable',
          detail: error instanceof Error ? error.message : String(error),
        },
      };
    }

    if (response.ok) {
      /*
       * A body that will not parse is treated as unreachable rather than rejected, because the
       * usual cause is something between here and the cloud answering on its behalf — a captive
       * portal, a proxy error page. Discarding a batch over that would lose real events to a
       * transient network condition.
       */
      try {
        return { ok: true, value: (await response.json()) as T };
      } catch (error) {
        return {
          ok: false,
          failure: {
            kind: 'unreachable',
            detail: `balasan bukan JSON: ${error instanceof Error ? error.message : 'ralat'}`,
          },
        };
      }
    }

    const detail = (await response.text().catch(() => '')).slice(0, 300);

    if (response.status === 401) return { ok: false, failure: { kind: 'unauthorised', detail } };

    /*
     * 5xx and 429 are the cloud saying "not now"; everything else in the 4xx range is it saying
     * "not this". A 404 lands in `rejected` deliberately: for the events route it means the
     * terminal is no longer assigned to this connector, and retrying that batch forever would
     * stop the spool draining for every other device.
     */
    if (response.status >= 500 || response.status === 429) {
      return { ok: false, failure: { kind: 'unreachable', detail: `${response.status}: ${detail}` } };
    }

    return { ok: false, failure: { kind: 'rejected', status: response.status, detail } };
  }
}

function credentialPath(config: AgentConfig): string {
  return join(config.STATE_DIR, CREDENTIAL_FILE);
}

function readCredential(config: AgentConfig): string | null {
  const path = credentialPath(config);
  if (!existsSync(path)) return null;

  const value = readFileSync(path, 'utf8').trim();
  return value.length > 0 ? value : null;
}

function writeCredential(config: AgentConfig, secret: string): void {
  const path = credentialPath(config);
  writeFileSync(path, `${secret}\n`, { encoding: 'utf8', mode: 0o600 });
  /*
   * Set again after writing. `mode` on `writeFileSync` is only applied when the file is
   * created, so a re-enrolment onto an existing file would silently keep whatever permissions
   * it already had.
   */
  chmodSync(path, 0o600);
}
