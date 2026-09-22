import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';

import { decryptSecret } from '../crypto.js';
import { db } from '../db.js';
import { logger } from '../logger.js';
import { sanitiseTriggers } from '../notify/triggers.js';
import { addressMatches } from './guard.js';

/**
 * Outbound webhooks.
 *
 * Two things make these safe to ship. The first is the signature: the receiver can prove a
 * request came from us and was not replayed, which is the difference between a webhook and
 * an unauthenticated POST that anybody can forge once they know the URL. The second is the
 * target check, because a webhook is the one feature that lets an administrator make this
 * server issue requests to an address of their choosing.
 */

const SIGNATURE_HEADER = 'x-kehadiran-signature';

/** How long a receiver should accept a signature for. Stated in the docs panel. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** Consecutive failures before a subscription is switched off. */
const FAILURE_LIMIT = 20;

const ATTEMPTS = 3;

export function generateWebhookSecret(): string {
  // `whsec_` mirrors the convention receivers already recognise from other systems, and
  // makes a leaked secret greppable.
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

/**
 * The signature a receiver verifies.
 *
 * `t=<unix>,v1=<hmac>` over `"<t>.<body>"`, which is the scheme most payment and platform
 * APIs use. The timestamp is inside the signed material on purpose: without it a captured
 * request stays valid forever, because a signature over the body alone is still correct
 * when replayed a month later.
 *
 * `v1` is a version tag so the algorithm can change later without receivers guessing.
 */
export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${String(timestamp)}.${body}`).digest('hex');
}

/**
 * Verifies a signature the way a receiver should.
 *
 * Exported because it is what the documentation panel describes and what the verification
 * script asserts — a scheme nobody has checked from the outside is a scheme with a typo in
 * it. Compared in constant time: a byte-by-byte early exit leaks how much of a forged
 * signature was correct.
 */
export function verifySignature(
  secret: string,
  header: string,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): { ok: boolean; reason?: string } {
  const parts = new Map(
    header
      .split(',')
      .map((piece) => piece.trim().split('='))
      .filter((pair): pair is [string, string] => pair.length === 2)
      .map(([key, value]) => [key, value]),
  );

  const timestamp = Number(parts.get('t'));
  const provided = parts.get('v1');
  if (!Number.isFinite(timestamp) || provided === undefined) {
    return { ok: false, reason: 'malformed' };
  }
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'stale' };
  }

  const expected = signPayload(secret, timestamp, body);
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(provided, 'utf8');
  if (left.length !== right.length) return { ok: false, reason: 'mismatch' };

  return timingSafeEqual(left, right) ? { ok: true } : { ok: false, reason: 'mismatch' };
}

// ---------------------------------------------------------------------------
// Target checks
// ---------------------------------------------------------------------------

/**
 * Addresses a webhook must never reach.
 *
 * The cloud metadata endpoints are the reason this check exists: on a hosted deployment
 * they hand out instance credentials to anything that asks, with no authentication at all.
 * Everything else here is an address that cannot be a legitimate webhook receiver.
 */
const BLOCKED = [
  '169.254.0.0/16', // link-local, includes 169.254.169.254 (AWS, Azure, GCP metadata)
  '0.0.0.0/8',
  '100.64.0.0/10', // carrier NAT
  '224.0.0.0/4', // multicast
  '240.0.0.0/4',
  'fe80::/10', // IPv6 link-local
  'ff00::/8', // IPv6 multicast
];

/** Ranges where plain HTTP is tolerated, because the traffic never leaves the site. */
const PRIVATE = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '::1/128',
  'fc00::/7',
];

export interface TargetVerdict {
  ok: boolean;
  reason?: string;
  /** The address the hostname resolved to, recorded so a later change is visible. */
  resolved?: string;
}

/**
 * Decides whether a URL may be posted to.
 *
 * The hostname is resolved before the decision, not pattern-matched. A check against the
 * text of the URL is bypassed by any name that resolves to a blocked address, and setting
 * one up costs an attacker a DNS record.
 */
export async function checkTarget(rawUrl: string): Promise<TargetVerdict> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'URL tidak sah.' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: `Skema "${url.protocol}" tidak dibenarkan. Gunakan https.` };
  }

  let address: string;
  try {
    address = (await lookup(url.hostname)).address;
  } catch {
    return { ok: false, reason: `Nama host "${url.hostname}" tidak dapat diselesaikan.` };
  }

  if (BLOCKED.some((range) => addressMatches(address, range))) {
    return {
      ok: false,
      resolved: address,
      reason:
        `"${url.hostname}" menyelesai ke ${address}, yang tidak dibenarkan. ` +
        'Julat link-local memegang endpoint metadata awan yang memberikan kredensial ' +
        'instance kepada sesiapa yang bertanya.',
    };
  }

  const isPrivate = PRIVATE.some((range) => addressMatches(address, range));
  if (url.protocol === 'http:' && !isPrivate) {
    return {
      ok: false,
      resolved: address,
      reason:
        `${address} adalah alamat awam, jadi http akan menghantar muatan dan tandatangan ` +
        'dalam bentuk jelas. Gunakan https.',
    };
  }

  return { ok: true, resolved: address };
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export interface WebhookEvent {
  trigger: string;
  /** Serialisable. Sent as `data` inside the envelope. */
  data: Record<string, unknown>;
}

/**
 * Posts an event to every subscription that wants it.
 *
 * Never throws, for the same reason the notification dispatcher does not: this runs after
 * something has already succeeded, and failing that operation because a receiver was down
 * would turn a missed webhook into a missed approval.
 */
export function dispatchWebhooks(event: WebhookEvent): void {
  void deliverAll(event).catch((cause: unknown) => {
    logger().error({ err: cause, trigger: event.trigger }, 'Webhook dispatch crashed');
  });
}

async function deliverAll(event: WebhookEvent): Promise<void> {
  const hooks = await db().webhook.findMany({ where: { active: true } });

  for (const hook of hooks) {
    if (!sanitiseTriggers(hook.events).includes(event.trigger)) continue;
    await deliver(hook.id, event);
  }
}

export interface DeliveryOutcome {
  ok: boolean;
  attempt: number;
  httpStatus: number | null;
  error: string | null;
  durationMs: number;
}

/**
 * Delivers one event to one subscription, retrying transient failures.
 *
 * A 4xx is not retried: the receiver understood the request and refused it, so sending it
 * again three times only produces three more entries in their log. A 5xx or a network
 * failure is retried, because those are the ones that succeed on a second try.
 */
export async function deliver(webhookId: number, event: WebhookEvent): Promise<DeliveryOutcome> {
  const hook = await db().webhook.findUnique({ where: { id: webhookId } });
  if (hook === null) return { ok: false, attempt: 0, httpStatus: null, error: 'tiada', durationMs: 0 };

  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    id: `evt_${randomBytes(9).toString('base64url')}`,
    event: event.trigger,
    createdAt: new Date().toISOString(),
    data: event.data,
  });

  const secret = decryptSecret(hook.secretEncrypted);
  let outcome: DeliveryOutcome = {
    ok: false,
    attempt: 0,
    httpStatus: null,
    error: 'tidak dijalankan',
    durationMs: 0,
  };

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    // Re-checked on every attempt, not only at save time: DNS can be repointed after a
    // subscription is created, which is the whole point of resolving rather than matching.
    const target = await checkTarget(hook.url);
    if (!target.ok) {
      outcome = {
        ok: false,
        attempt,
        httpStatus: null,
        error: target.reason ?? 'sasaran tidak dibenarkan',
        durationMs: 0,
      };
      /**
       * Recorded here, where the refusal happens.
       *
       * This is the one failure mode with no HTTP exchange behind it, so without a line of
       * its own the delivery log would be empty and the screen would show a webhook that
       * simply never fires. It is also the most alarming entry in the log — the target
       * resolved somewhere it should not — which is the last thing to leave unwritten.
       */
      await record(hook.id, event.trigger, attempt, outcome, body, null);
      break;
    }

    const startedAt = Date.now();
    try {
      const response = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'SistemKehadiran-Webhook/1',
          [SIGNATURE_HEADER]: `t=${String(timestamp)},v1=${signPayload(secret, timestamp, body)}`,
          'x-kehadiran-event': event.trigger,
          'x-kehadiran-attempt': String(attempt),
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });

      const text = (await response.text()).slice(0, 1000);
      outcome = {
        ok: response.ok,
        attempt,
        httpStatus: response.status,
        error: response.ok ? null : `HTTP ${String(response.status)}`,
        durationMs: Date.now() - startedAt,
      };

      await record(hook.id, event.trigger, attempt, outcome, body, text);

      // A refusal the receiver understood is final.
      if (response.ok || (response.status >= 400 && response.status < 500)) break;
    } catch (cause) {
      outcome = {
        ok: false,
        attempt,
        httpStatus: null,
        error: describeDeliveryError(cause),
        durationMs: Date.now() - startedAt,
      };
      await record(hook.id, event.trigger, attempt, outcome, body, null);
    }

    if (attempt < ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }

  await settle(hook.id, outcome);
  return outcome;
}

async function record(
  webhookId: number,
  event: string,
  attempt: number,
  outcome: DeliveryOutcome,
  requestBody: string,
  responseBody: string | null,
): Promise<void> {
  await db()
    .webhookDelivery.create({
      data: {
        webhookId,
        event,
        attempt,
        ok: outcome.ok,
        httpStatus: outcome.httpStatus,
        durationMs: outcome.durationMs,
        error: outcome.error?.slice(0, 500) ?? null,
        requestBody,
        responseBody,
      },
    })
    .catch((cause: unknown) => {
      // A log that cannot be written must not fail the delivery it was describing.
      logger().warn({ err: cause, webhookId }, 'Could not record webhook delivery');
    });
}

/**
 * Updates the subscription's health, switching it off once it has failed enough.
 *
 * An endless retry loop against a host that has been gone for a week is indistinguishable
 * from an outbound scan, and it is the receiver's firewall that notices first.
 */
async function settle(webhookId: number, outcome: DeliveryOutcome): Promise<void> {
  if (outcome.ok) {
    await db().webhook.update({
      where: { id: webhookId },
      data: {
        failureCount: 0,
        disabledReason: null,
        lastDeliveryAt: new Date(),
        lastStatus: outcome.httpStatus,
      },
    });
    return;
  }

  const current = await db().webhook.findUnique({
    where: { id: webhookId },
    select: { failureCount: true },
  });
  const failures = (current?.failureCount ?? 0) + 1;
  const exhausted = failures >= FAILURE_LIMIT;

  await db().webhook.update({
    where: { id: webhookId },
    data: {
      failureCount: failures,
      lastDeliveryAt: new Date(),
      lastStatus: outcome.httpStatus,
      ...(exhausted
        ? {
            active: false,
            disabledReason:
              `Dimatikan automatik selepas ${String(failures)} kegagalan berturut-turut. ` +
              `Kegagalan terakhir: ${outcome.error ?? 'tidak diketahui'}`,
          }
        : {}),
    },
  });

  if (exhausted) {
    logger().warn({ webhookId, failures }, 'Webhook disabled after repeated failures');
  }
}

function describeDeliveryError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const name = cause instanceof Error ? cause.name : '';

  if (name === 'TimeoutError' || /timeout|aborted/i.test(raw)) {
    return 'Penerima tidak menjawab dalam 15 saat.';
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) return 'Nama host tidak dapat diselesaikan.';
  if (/ECONNREFUSED/i.test(raw)) return 'Sambungan ditolak — tiada apa mendengar pada port itu.';
  if (/ECONNRESET/i.test(raw)) return 'Penerima menutup sambungan secara mendadak.';
  if (/certificate|CERT_|self.signed/i.test(raw)) {
    return 'Sertifikat TLS penerima tidak dipercayai.';
  }
  return raw.slice(0, 300);
}
