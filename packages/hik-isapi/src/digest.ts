import { createHash, randomBytes } from 'node:crypto';
import { Agent, request as undiciRequest } from 'undici';

import {
  AuthChallengeMissingError,
  AuthenticationError,
  DeviceLockedError,
  DeviceUnreachableError,
} from './errors.js';

export interface DigestHttpOptions {
  /** Base URL of the terminal, e.g. `https://192.168.1.250`. */
  baseUrl: string;
  username: string;
  password: string;
  /**
   * Terminals ship with self-signed certificates, so this defaults to false.
   * Enable it only when the device presents a certificate you actually trust.
   */
  verifyTls?: boolean;
  timeoutMs?: number;
}

export interface RawRequestInit {
  method?: string;
  /** Path including query string, e.g. `/ISAPI/System/time`. */
  path: string;
  headers?: Record<string, string>;
  body?: Buffer | string;
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  contentType: string;
}

interface Challenge {
  realm: string;
  nonce: string;
  qop: string | null;
  opaque: string | null;
  algorithm: string;
}

const md5 = (input: string): string =>
  createHash('md5').update(input, 'utf8').digest('hex');

/**
 * HTTP transport that speaks Digest auth against a single Hikvision device.
 *
 * The challenge is cached and reused across requests so that steady-state
 * traffic costs one round trip instead of two. A cached challenge that has
 * gone stale produces a single 401, which we transparently re-authenticate.
 */
export class DigestHttpClient {
  private readonly origin: string;
  private readonly agent: Agent;
  private readonly timeoutMs: number;
  private challenge: Challenge | null = null;
  private nonceCount = 0;
  /**
   * Set when the device reports a lockout. Blocks further requests locally so
   * that a caller looping over 5000 staff cannot extend the lockout window.
   */
  private lockedUntil: number | null = null;
  /**
   * Tail of the request queue.
   *
   * Digest state is a single shared counter, so overlapping requests can hand the
   * device out-of-order `nc` values, which it rejects. Serialising per device
   * removes that class of failure entirely, and costs nothing here: these are
   * small embedded units that are slower than the network anyway.
   */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: DigestHttpOptions) {
    this.origin = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.agent = new Agent({
      connect: { rejectUnauthorized: options.verifyTls ?? false },
      headersTimeout: this.timeoutMs,
      bodyTimeout: this.timeoutMs,
      // One socket per device. Terminals cap concurrent sessions and answer 401
      // without a challenge once that cap is reached.
      connections: 1,
      pipelining: 1,
    });
  }

  get host(): string {
    return this.origin;
  }

  async close(): Promise<void> {
    await this.agent.close();
  }

  /**
   * Queues a request so only one is in flight against this device at a time.
   *
   * The chain is kept alive on failure so one rejected request does not poison
   * every request queued behind it.
   */
  async request(init: RawRequestInit): Promise<RawResponse> {
    const run = this.queue.then(
      () => this.execute(init),
      () => this.execute(init),
    );
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Runs a request, retrying only the transient session-limit case.
   *
   * These terminals cap concurrent ISAPI sessions and answer 401 with no Digest
   * challenge once that cap is reached - which happens whenever a second tool is
   * talking to the same unit, or while it is busy pushing events. That is a
   * capacity condition, not a credential one, so a short bounded retry is correct.
   *
   * `AuthenticationError` is never retried: repeating a genuinely rejected
   * credential is what triggers the firmware's thirty minute lockout. The attempt
   * ceiling stays below the lockout threshold as a second line of defence in case
   * this reasoning is ever wrong.
   */
  private async execute(init: RawRequestInit): Promise<RawResponse> {
    const delaysMs = [400, 1200];
    let lastError: unknown;

    for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
      try {
        return await this.attempt(init);
      } catch (error) {
        if (!(error instanceof AuthChallengeMissingError)) throw error;
        lastError = error;

        const delay = delaysMs[attempt];
        if (delay === undefined) break;
        await sleep(delay);
      }
    }

    throw lastError;
  }

  private async attempt(init: RawRequestInit): Promise<RawResponse> {
    this.assertNotLocked();

    const method = init.method ?? 'GET';
    const first = await this.send(method, init, this.buildAuthHeader(method, init.path));

    if (first.status !== 401) {
      return first;
    }

    // 401 means either we had no challenge yet, or the cached nonce went
    // stale. Either way we get exactly one more attempt - never a loop.
    const bodyText = first.body.toString('utf8');
    this.throwIfLocked(bodyText);

    const challenge = parseChallenge(headerValue(first.headers['www-authenticate']));
    if (!challenge) {
      // No challenge offered. Reported separately from a credential failure so a
      // transient session limit is not mistaken for a wrong password, and so the
      // caller can back off instead of retrying into a real lockout.
      this.challenge = null;
      throw new AuthChallengeMissingError(this.origin, first.status);
    }
    this.challenge = challenge;
    this.nonceCount = 0;

    const second = await this.send(method, init, this.buildAuthHeader(method, init.path));
    if (second.status === 401) {
      const secondBody = second.body.toString('utf8');
      this.throwIfLocked(secondBody);
      this.challenge = null;

      // Only now are the credentials genuinely suspect: we answered a fresh
      // challenge and were still refused.
      if (!parseChallenge(headerValue(second.headers['www-authenticate']))) {
        throw new AuthChallengeMissingError(this.origin, second.status);
      }
      throw new AuthenticationError(this.origin, this.options.username);
    }
    return second;
  }

  private async send(
    method: string,
    init: RawRequestInit,
    authorization: string | null,
  ): Promise<RawResponse> {
    const headers: Record<string, string> = { ...init.headers };
    if (authorization) {
      headers['authorization'] = authorization;
    }

    try {
      const res = await undiciRequest(`${this.origin}${init.path}`, {
        method: method as 'GET',
        headers,
        body: init.body,
        dispatcher: this.agent,
      });
      const body = Buffer.from(await res.body.arrayBuffer());
      return {
        status: res.statusCode,
        headers: res.headers,
        body,
        contentType: headerValue(res.headers['content-type']) ?? '',
      };
    } catch (cause) {
      throw new DeviceUnreachableError(this.origin, cause);
    }
  }

  private buildAuthHeader(method: string, path: string): string | null {
    const challenge = this.challenge;
    if (!challenge) return null;

    this.nonceCount += 1;
    const nc = this.nonceCount.toString(16).padStart(8, '0');
    const cnonce = randomBytes(8).toString('hex');
    const { username, password } = this.options;

    const ha1 = md5(`${username}:${challenge.realm}:${password}`);
    const ha2 = md5(`${method}:${path}`);
    const response = challenge.qop
      ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop}:${ha2}`)
      : md5(`${ha1}:${challenge.nonce}:${ha2}`);

    const parts = [
      `username="${username}"`,
      `realm="${challenge.realm}"`,
      `nonce="${challenge.nonce}"`,
      `uri="${path}"`,
      `response="${response}"`,
      `algorithm=${challenge.algorithm}`,
    ];
    if (challenge.qop) {
      parts.push(`qop=${challenge.qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
    }
    if (challenge.opaque) {
      parts.push(`opaque="${challenge.opaque}"`);
    }
    return `Digest ${parts.join(', ')}`;
  }

  private assertNotLocked(): void {
    if (this.lockedUntil === null) return;
    const remainingMs = this.lockedUntil - Date.now();
    if (remainingMs <= 0) {
      this.lockedUntil = null;
      return;
    }
    throw new DeviceLockedError(this.origin, Math.ceil(remainingMs / 1000));
  }

  /**
   * Hikvision reports lockout in the 401 body rather than a header, e.g.
   * `<lockStatus>locked</lockStatus><unlockTime>1740</unlockTime>`.
   */
  private throwIfLocked(body: string): void {
    if (!body.includes('lockStatus')) return;
    if (!/<lockStatus>\s*lock/i.test(body)) return;

    const seconds = Number(/<unlockTime>\s*(\d+)\s*<\/unlockTime>/i.exec(body)?.[1]);
    const unlockInSeconds = Number.isFinite(seconds) ? seconds : null;
    this.lockedUntil = Date.now() + (unlockInSeconds ?? 1800) * 1000;
    this.challenge = null;
    throw new DeviceLockedError(this.origin, unlockInSeconds);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseChallenge(header: string | undefined): Challenge | null {
  if (!header) return null;
  const scheme = /^\s*Digest\s+/i.exec(header);
  if (!scheme) return null;

  const params: Record<string, string> = {};
  const pattern = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^\s,]+))/g;
  for (const match of header.slice(scheme[0].length).matchAll(pattern)) {
    const key = match[1];
    if (!key) continue;
    params[key.toLowerCase()] = match[2] ?? match[3] ?? '';
  }

  const realm = params['realm'];
  const nonce = params['nonce'];
  if (realm === undefined || nonce === undefined) return null;

  // Devices may advertise `qop="auth,auth-int"`; we only implement `auth`.
  const qopRaw = params['qop'];
  const qop = qopRaw
    ? (qopRaw.split(',').map((q) => q.trim()).find((q) => q === 'auth') ?? null)
    : null;

  return {
    realm,
    nonce,
    qop,
    opaque: params['opaque'] ?? null,
    algorithm: params['algorithm'] ?? 'MD5',
  };
}
