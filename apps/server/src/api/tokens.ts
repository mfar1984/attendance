import { createHash, randomBytes } from 'node:crypto';

import type { LabelKey } from '@attendance/shared';

import { db } from '../db.js';
import { PERMISSION_SECTIONS } from '../auth/permissions.js';

/**
 * API tokens.
 *
 * Only a hash is stored, so a database dump does not hand over API access and the value
 * cannot be re-read even by an administrator. It is shown once, at creation, and if it is
 * lost the answer is to rotate rather than to reveal.
 */

/** Identifies our tokens on sight, and makes a leaked one greppable in a log or a repo. */
const PREFIX = 'hka_';

/** 24 bytes is 192 bits. Long enough that guessing is not a threat model. */
const SECRET_BYTES = 24;

export interface IssuedToken {
  /** The only time the full value exists outside the caller's hands. */
  token: string;
  prefix: string;
  tokenHash: string;
}

/**
 * Hashes a token with SHA-256.
 *
 * A fast hash on purpose, unlike a password. A slow KDF exists to make guessing a
 * low-entropy human choice expensive; this value is 192 bits of randomness, where a slow
 * hash would add latency to every request and buy nothing. Storing the hash also makes
 * verification a single indexed lookup rather than a scan-and-compare.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function issueToken(): IssuedToken {
  // base64url so the value survives a header, a query string and a shell argument
  // without escaping.
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const token = `${PREFIX}${secret}`;

  return {
    token,
    // Enough to recognise which token a log line refers to, far too little to use.
    prefix: `${PREFIX}${secret.slice(0, 8)}`,
    tokenHash: hashToken(token),
  };
}

export interface TokenIdentity {
  id: number;
  name: string;
  prefix: string;
  scopes: string[];
  /** True while this token is living out its rotation grace window. */
  superseded: boolean;
  graceUntil: Date | null;
}

export type TokenRejection =
  | 'missing'
  | 'malformed'
  | 'unknown'
  | 'revoked'
  | 'expired'
  | 'grace_expired';

export type TokenResult =
  | { ok: true; identity: TokenIdentity }
  | { ok: false; reason: TokenRejection };

/**
 * Reads the credential out of a request.
 *
 * `Authorization: Bearer <token>` is the form documented for callers. `X-Api-Key` is also
 * accepted because a surprising number of integration tools cannot set an Authorization
 * header, and refusing them achieves nothing except a token pasted into a query string,
 * where it ends up in access logs.
 */
export function readTokenFromHeaders(headers: Record<string, unknown>): string | null {
  const authorization = headers['authorization'];
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    if (match?.[1] !== undefined) return match[1];
  }

  const apiKey = headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim().length > 0) return apiKey.trim();

  return null;
}

/**
 * Verifies a token and records the use.
 *
 * Every rejection is distinguished internally so the activity log can say why, but the
 * caller is told only that the credential was refused — telling an unauthenticated
 * client the difference between "unknown" and "expired" confirms which of its guesses
 * named a real token.
 */
export async function verifyToken(raw: string | null, ipAddress?: string): Promise<TokenResult> {
  if (raw === null || raw.length === 0) return { ok: false, reason: 'missing' };
  if (!raw.startsWith(PREFIX)) return { ok: false, reason: 'malformed' };

  const token = await db().apiToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!token) return { ok: false, reason: 'unknown' };

  if (token.revokedAt !== null) return { ok: false, reason: 'revoked' };

  const now = new Date();
  if (token.expiresAt !== null && token.expiresAt <= now) {
    return { ok: false, reason: 'expired' };
  }

  /**
   * A rotated token keeps working until its grace window closes.
   *
   * Without the window, rotating a credential means every call fails between the moment
   * the new token is issued and the moment the last deployment picks it up. With it, the
   * old value simply stops one day later.
   */
  if (token.supersededAt !== null) {
    if (token.graceUntil === null || token.graceUntil <= now) {
      return { ok: false, reason: 'grace_expired' };
    }
  }

  // Fire-and-forget: the counter is for visibility, and failing a request because a
  // statistics update failed would be the wrong trade.
  void db()
    .apiToken.update({
      where: { id: token.id },
      data: {
        lastUsedAt: now,
        requestCount: { increment: 1 },
        ...(ipAddress === undefined ? {} : { lastUsedIp: ipAddress.slice(0, 64) }),
      },
    })
    .catch(() => undefined);

  return {
    ok: true,
    identity: {
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      scopes: normaliseScopes(token.scopes),
      superseded: token.supersededAt !== null,
      graceUntil: token.graceUntil,
    },
  };
}

/**
 * Every scope the registry can express, as `screen.key:action`.
 *
 * Derived rather than typed out, so a token cannot be granted something the application
 * does not have, and a screen added later becomes offerable without a second list to
 * remember.
 */
export function availableScopes(): Array<{ scope: string; labelKey: LabelKey; action: string }> {
  const scopes: Array<{ scope: string; labelKey: LabelKey; action: string }> = [];

  for (const section of PERMISSION_SECTIONS) {
    for (const screen of section.screens) {
      const actions = [
        ...screen.actions,
        ...(screen.custom ?? []).map((action) => action.id),
      ];

      for (const action of actions) {
        // Read-only for now. A write scope would let a token change attendance without a
        // person attached to the change, and the audit trail is built around there being
        // one. Offering it before that is resolved would be offering a hole.
        if (action !== 'view' && action !== 'export') continue;
        /*
          The screen's registry key and the bare action, not a composed sentence. The list
          is prose the token's owner reads, so the wording has to resolve per reader — and
          the em dash between the two halves is punctuation the label owns, not this loop.
        */
        scopes.push({
          scope: `${screen.key}:${action}`,
          labelKey: screen.labelKey,
          action,
        });
      }
    }
  }

  return scopes;
}

const VALID_SCOPES = new Set(availableScopes().map((entry) => entry.scope));

/** Drops anything the registry does not define, so a stale stored scope cannot revive. */
export function sanitiseScopes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const kept = new Set<string>();
  for (const entry of value) {
    if (typeof entry === 'string' && VALID_SCOPES.has(entry)) kept.add(entry);
  }
  return [...kept];
}

function normaliseScopes(value: unknown): string[] {
  return sanitiseScopes(value);
}

/** Whether a token may perform one action on one screen. */
export function tokenCan(identity: TokenIdentity, screen: string, action: string): boolean {
  return identity.scopes.includes(`${screen}:${action}`);
}
