import { isIP } from 'node:net';

import type { FastifyRequest } from 'fastify';

import { loadEnv } from '../env.js';

/**
 * Where a request came from, and the arithmetic for deciding whether an address is inside a range.
 *
 * ## Why this module exists
 *
 * Four modules had grown their own copy of the same eight lines, and all four were wrong in the
 * same way:
 *
 * ```ts
 * const forwarded = request.headers['x-forwarded-for'];
 * if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
 * ```
 *
 * That takes the **leftmost** entry of a header the client writes, from any peer, with no check
 * that a proxy put it there. Three access controls were resolving the address they filter on that
 * way — the public API whitelist, the maintenance-mode allow list, and the callback ingest allow
 * list — so each of them could be satisfied by sending one header:
 *
 * ```
 * curl -H 'X-Forwarded-For: 10.0.0.5' https://host/api/public/...
 * ```
 *
 * The leftmost entry is specifically the wrong end. A proxy chain **appends**, so the left is
 * whatever the original client chose to send and the right is what the nearest proxy observed.
 * Cloudflare documents this: it appends the connecting address to any `X-Forwarded-For` already
 * present, so the left stays attacker-controlled all the way through.
 *
 * It also meant every login audit row and every rate-limit bucket could be attributed to an
 * address of the caller's choosing.
 */

// ---------------------------------------------------------------------------
// Range arithmetic
// ---------------------------------------------------------------------------

/**
 * Whether an address falls inside an allowed entry.
 *
 * Supports a bare address or CIDR notation, for both IPv4 and IPv6. Written here rather
 * than pulled in as a dependency because the whole of it is thirty lines and a supply
 * chain addition to an access control is a poor trade.
 */
export function addressMatches(address: string, entry: string): boolean {
  const candidate = normaliseAddress(address);
  const [range, bitsText] = entry.trim().split('/');
  if (range === undefined || range.length === 0) return false;

  const target = normaliseAddress(range);
  if (bitsText === undefined) return candidate === target;

  const bits = Number(bitsText);
  if (!Number.isInteger(bits) || bits < 0) return false;

  const left = toBytes(candidate);
  const right = toBytes(target);
  // A v4 address never matches a v6 range, and comparing them byte-wise would silently
  // produce a wrong answer rather than a refusal.
  if (left === null || right === null || left.length !== right.length) return false;
  if (bits > left.length * 8) return false;

  const wholeBytes = Math.floor(bits / 8);
  for (let index = 0; index < wholeBytes; index += 1) {
    if (left[index] !== right[index]) return false;
  }

  const remainder = bits % 8;
  if (remainder === 0) return true;

  const mask = 0xff << (8 - remainder);
  return ((left[wholeBytes] ?? 0) & mask) === ((right[wholeBytes] ?? 0) & mask);
}

/**
 * Ranges that never leave the site.
 *
 * Two callers ask the same question for opposite reasons — webhooks tolerate plain HTTP to these,
 * and the callback ingest path trusts them without an allow list — and two copies of this list is
 * one copy that drifts, in a place where drifting means a hole.
 */
const PRIVATE_RANGES = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '::1/128',
  'fc00::/7',
  // Link-local, including the cloud metadata address. Not routable, so not public.
  '169.254.0.0/16',
  'fe80::/10',
];

/** Whether an address is one this traffic could only have reached us from inside a network. */
export function isPrivateAddress(address: string): boolean {
  return PRIVATE_RANGES.some((range) => addressMatches(address, range));
}

/** IPv4-mapped IPv6 (`::ffff:10.0.0.1`) is how Node reports v4 on a dual-stack socket. */
export function normaliseAddress(address: string): string {
  const trimmed = address.trim().replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(trimmed);
  return mapped?.[1] ?? trimmed;
}

function toBytes(address: string): number[] | null {
  const kind = isIP(address);
  if (kind === 4) {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return null;
    }
    return parts;
  }
  if (kind !== 6) return null;

  // Expands `::` so every group is present before splitting into bytes.
  const [head, tail] = address.split('::');
  const left = head === undefined || head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;

  const groups = [...left, ...Array.from({ length: address.includes('::') ? missing : 0 }, () => '0'), ...right];
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    const value = Number.parseInt(group === '' ? '0' : group, 16);
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) return null;
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Resolving the caller
// ---------------------------------------------------------------------------

/** Parsed once. `TRUSTED_PROXY_IPS` is fixed at boot, like everything else in the environment. */
let trusted: string[] | null = null;

export function trustedProxies(): string[] {
  if (trusted === null) {
    trusted = loadEnv()
      .TRUSTED_PROXY_IPS.split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return trusted;
}

/** Only the peer we are actually talking to can be checked against the trust list. */
function peerAddress(request: FastifyRequest): string {
  return normaliseAddress(request.socket.remoteAddress ?? '');
}

function isTrustedProxy(address: string): boolean {
  return trustedProxies().some((entry) => addressMatches(address, entry));
}

/**
 * The address this request genuinely came from.
 *
 * The rule in one line: **a forwarded header is read only when the peer that sent it is a
 * configured proxy.** A client connecting to this server directly can write whatever it likes into
 * that header and it is ignored, because the socket says where it really is.
 *
 * For a multi-value header the chain is walked from the **right** — the end the nearest proxy
 * wrote — stopping at the first address that is not itself a trusted proxy. That is the last hop
 * nobody in the trusted path vouched for, which is the furthest back the chain can be believed.
 * `CLIENT_IP_HEADER` can name a single-value header instead (`cf-connecting-ip`), which an edge
 * overwrites rather than appends and is therefore the honest choice behind one.
 *
 * Falls back to the peer address, never to the header, so a misconfiguration under-reports rather
 * than over-trusts.
 */
export function clientAddress(request: FastifyRequest): string {
  return resolveClientAddress(request).address;
}

/**
 * The address, and whether it was asserted by a header rather than observed on the socket.
 *
 * The distinction matters wherever a private address is treated as trustworthy on its own. A
 * socket address cannot be forged: a caller that appears to be on 192.168.0.0/16 genuinely is,
 * because that is where the packets came from. A **forwarded** private address is a different
 * claim entirely — a private address cannot route to a public edge, so one arriving in a header
 * was made up.
 *
 * That gap was live: the callback ingest guard let any private address through without consulting
 * the allow list, so one header closed the whole thing —
 * `CF-Connecting-IP: 192.168.1.50` — with no knowledge of what the list contained.
 */
export function resolveClientAddress(request: FastifyRequest): {
  address: string;
  forwarded: boolean;
} {
  const peer = peerAddress(request);
  if (!isTrustedProxy(peer)) return { address: peer, forwarded: false };

  const header = request.headers[loadEnv().CLIENT_IP_HEADER.toLowerCase()];
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { address: peer, forwarded: false };
  }

  const chain = raw
    .split(',')
    .map((entry) => normaliseAddress(entry))
    .filter((entry) => entry.length > 0);

  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const candidate = chain[index];
    if (candidate === undefined) continue;
    if (!isTrustedProxy(candidate)) return { address: candidate, forwarded: true };
  }

  /*
    Every hop named itself a trusted proxy, so there is no client address in here to find.

    Still reported as forwarded, and that distinction is the difference between a hole and a
    closed door. A header **was** present and could not be resolved, so this address is asserted
    rather than observed — claiming otherwise let `CF-Connecting-IP: 127.0.0.1` sent straight at
    the origin resolve to loopback, which the callback ingest guard then waved through as a
    private source needing no allow list.

    A genuine local caller sends no such header at all and returns above, unaffected.
  */
  return { address: peer, forwarded: true };
}
