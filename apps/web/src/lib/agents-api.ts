import type { LabelKey } from '@attendance/shared';

import { api } from './api';

/**
 * On-site connectors.
 *
 * Kept out of `operations-api.ts` for the same reason `agent-admin.ts` is kept out of
 * `devices/routes.ts`: a terminal and the machine that reaches one are different subjects, and
 * that file is already the length where a reader stops scrolling.
 */

export interface AgentRow {
  id: number;
  name: string;
  /** Stable public identifier. Appears in the connector's own log lines. */
  agentKey: string;
  /** `pending` | `active` | `revoked`. Three states, not a boolean. */
  status: string;
  /** Prefix only. The credential itself is never returned by any endpoint. */
  secretPrefix: string | null;
  enrolledAt: string | null;
  revokedAt: string | null;
  version: string | null;
  lanHost: string | null;
  lanPort: number | null;
  lastSeenAt: string | null;
  lastAddress: string | null;
  createdAt: string;
  /** Terminals assigned to this connector. */
  devices: number;
  /** Commands waiting to be collected. A rising number against terminals means trouble. */
  queued: number;
}

/**
 * The reply to creating or reissuing. Carries the token, and nothing else does.
 *
 * There is no endpoint that returns it again — an endpoint that repeats a stored credential is
 * the easiest way to extract one, so a lost token is reissued rather than revealed.
 */
export interface IssuedAgentToken {
  id: number;
  name: string;
  agentKey: string;
  token: string;
  expiresAt: string;
  ttlMinutes: number;
  /** Where the connector should be pointed, derived from `INGEST_PUBLIC_URL` on the server. */
  cloudUrl: string;
  /** Only on reissue: true when this replaces a credential that is currently working. */
  replacesWorking?: boolean;
}

export const AGENT_STATUS_LABELS: Record<string, LabelKey> = {
  pending: 'agent.status.pending',
  active: 'agent.status.active',
  revoked: 'agent.status.revoked',
};

/** Where the working credential lands on the site machine. Shown so nobody looks for it here. */
export const AGENT_CREDENTIAL_PATH = '/var/lib/attendance-agent/credential';

/**
 * The command an operator runs on the site machine.
 *
 * Assembled here rather than on the server because it is presentation: the pieces the server
 * owns are the token and the address it answers on, and building the shell line from them in
 * one place means the screen and the installer documentation cannot drift into two spellings.
 */
export function agentInstallCommand(issued: IssuedAgentToken): string {
  const cloud = issued.cloudUrl.replace(/\/+$/, '');
  return [
    `curl -fsSL ${cloud}/install-agent.sh | sudo bash -s -- \\`,
    `    --cloud ${cloud} \\`,
    `    --token ${issued.token}`,
  ].join('\n');
}

export const agentsApi = {
  list: () => api.get<AgentRow[]>('/api/agents'),
  create: (name: string) => api.post<IssuedAgentToken>('/api/agents', { name }),
  reissue: (id: number) => api.post<IssuedAgentToken>(`/api/agents/${String(id)}/reissue`),
  revoke: (id: number) => api.post<{ ok: true }>(`/api/agents/${String(id)}/revoke`),
};
