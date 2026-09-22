import {
  Ban,
  CircleCheck,
  Eye,
  KeyRound,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { LabelKey } from '@attendance/shared';

import { cn } from '../lib/cn';
import { useAuth } from '../lib/auth';
import { formatDate, formatDateTime } from '../lib/operations-api';
import { T, TEnum, useLabels } from '../lib/translation';
import {
  apiAdminApi,
  type ApiScope,
  type ApiTokenRow,
  type ApiTokenStatus,
  type IssuedApiToken,
} from '../lib/settings-api';
import { CONTROL, SettingRow, Switch } from './ChannelForm';
import { Dialog, DialogFooter, Feedback } from './Dialog';
import {
  ChipBar,
  Detail,
  DetailGrid,
  ExpandButton,
  FilterRow,
  PanelFooter,
  PanelNote,
  PanelSection,
  RecordTable,
  RowAction,
  RowActions,
} from './RecordPanel';
import { RevealSecret } from './RevealSecret';
import { Button } from './ui';

/**
 * API tokens.
 *
 * Read-only scopes only. A write scope would let a token change attendance with no person
 * attached to the change, and the audit trail is built on there always being one.
 *
 * The reference design had a "rotate daily" switch. That is not implemented here and the
 * omission is deliberate: rotating a static credential on a timer breaks every integration
 * holding it, silently, at whatever hour the timer fires. Rotation is an explicit action
 * with a grace window instead, so a deployment can pick up the new value on its own
 * schedule and the old one stops afterwards.
 */

/** Registry keys, not words. Upper case comes from the badge's class. */
const STATUS_LABELS: Record<ApiTokenStatus, LabelKey> = {
  active: 'tokenStatus.active',
  grace: 'tokenStatus.grace',
  superseded: 'tokenStatus.superseded',
  expired: 'tokenStatus.expired',
  revoked: 'tokenStatus.revoked',
};

/** Only two actions are offerable as scopes, so the map is two entries. */
const SCOPE_ACTIONS: Record<string, LabelKey> = {
  view: 'action.view',
  export: 'action.export',
};

const STATUS_TONES: Record<ApiTokenStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  grace: 'bg-amber-50 text-amber-700',
  superseded: 'bg-slate-100 text-slate-600',
  expired: 'bg-slate-100 text-slate-600',
  revoked: 'bg-rose-50 text-rose-700',
};

export function ApiTokenList(): ReactNode {
  const { can } = useAuth();
  const { t } = useLabels();
  const [rows, setRows] = useState<ApiTokenRow[] | null>(null);
  const [scopes, setScopes] = useState<ApiScope[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<ApiTokenRow | null>(null);
  const [revealed, setRevealed] = useState<{ value: IssuedApiToken; rotated: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiAdminApi.tokens();
      setRows(payload.tokens);
      setScopes(payload.scopes);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('token.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(row: ApiTokenRow): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await apiAdminApi.revokeToken(row.id);
      setNotice(t('token.notice.revoked', { prefix: row.prefix }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('token.error.revoke'));
    }
  }

  async function rotate(row: ApiTokenRow): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      const issued = await apiAdminApi.rotateToken(row.id);
      setRevealed({ value: issued, rotated: true });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('token.error.rotate'));
    }
  }

  async function remove(row: ApiTokenRow): Promise<void> {
    setConfirming(null);
    setError(null);
    try {
      await apiAdminApi.deleteToken(row.id);
      setNotice(t('token.notice.removed', { prefix: row.prefix }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('token.error.remove'));
    }
  }

  const all = rows ?? [];
  const needle = search.trim().toLowerCase();
  const filtered = all.filter((row) => {
    if (statusFilter !== undefined && row.status !== statusFilter) return false;
    if (needle.length === 0) return true;
    return (
      row.name.toLowerCase().includes(needle) || row.prefix.toLowerCase().includes(needle)
    );
  });

  // Counted over everything, ignoring the chip's own filter, so selecting one does not
  // zero the others and make the remaining rows look like they vanished.
  const counts = {
    active: all.filter((row) => row.status === 'active').length,
    grace: all.filter((row) => row.status === 'grace').length,
    revoked: all.filter((row) => row.status === 'revoked').length,
    expired: all.filter((row) => row.status === 'expired' || row.status === 'superseded').length,
  };

  return (
    <>
      <PanelSection
        title={<T k="token.title" />}
        subtitle={<T k="token.subtitle" />}
        action={
          can('settings.integration.api', 'create') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              <T k="token.action.new" />
            </Button>
          ) : undefined
        }
      />

      <ChipBar
        active={statusFilter}
        onChange={setStatusFilter}
        chips={[
          {
            id: 'active',
            label: <T k="tokenStatus.active" />,
            count: counts.active,
            dot: 'bg-emerald-500',
          },
          {
            id: 'grace',
            label: <T k="tokenStatus.grace" />,
            count: counts.grace,
            dot: 'bg-amber-500',
          },
          {
            id: 'revoked',
            label: <T k="tokenStatus.revoked" />,
            count: counts.revoked,
            dot: 'bg-rose-500',
          },
          {
            id: 'expired',
            label: <T k="tokenStatus.expired" />,
            count: counts.expired,
            dot: 'bg-slate-400',
          },
        ]}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('token.search')}
        dirty={search.length > 0 || statusFilter !== undefined}
        onReset={() => {
          setSearch('');
          setStatusFilter(undefined);
        }}
      />

      <div className="px-5 pt-3">
        <Feedback error={error} notice={notice} />
      </div>

      <p className="mx-5 mt-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <KeyRound className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
        <span>
          <T
            k="token.hashNote"
            vars={{
              rotate: (
                <strong className="font-medium">
                  <T k="token.hashNote.rotate" />
                </strong>
              ),
            }}
          />
        </span>
      </p>

      <div className="mt-3">
        <RecordTable
          loading={loading}
          rowCount={filtered.length}
          empty={<T k="token.empty" />}
          columns={[
            { header: <T k="token.column.name" /> },
            { header: <T k="token.column.scopes" />, width: 'w-24' },
            { header: <T k="panel.column.status" />, width: 'w-32' },
            { header: <T k="token.column.lastUsed" />, width: 'w-36' },
            { header: <T k="token.column.expires" />, width: 'w-28' },
            { header: <T k="panel.column.actions" />, width: 'w-40', align: 'right' },
          ]}
        >
          {filtered.map((row) => {
            const expanded = open === row.id;
            const dead = row.status === 'revoked' || row.status === 'expired';
            const attention = row.status === 'grace';
            const expiringSoon =
              row.status === 'active' &&
              row.expiresAt !== null &&
              new Date(row.expiresAt).getTime() - Date.now() < 14 * 86_400_000;

            return (
              <>
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-slate-100',
                    expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
                    // The eye finds the colour before it reads the status column.
                    !expanded && dead && 'bg-rose-50/40',
                    !expanded && (attention || expiringSoon) && 'bg-amber-50/40',
                  )}
                >
                  <td className="px-5 py-2.5">
                    <span className="block font-medium text-slate-800">{row.name}</span>
                    <span className="block font-mono text-[11px] text-slate-400">{row.prefix}</span>
                  </td>
                  <td className="px-2 py-2.5 text-xs text-slate-600 tabular-nums">
                    {row.scopes.length}
                  </td>
                  <td className="px-2 py-2.5">
                    <span
                      className={cn(
                        'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
                        STATUS_TONES[row.status],
                      )}
                    >
                      <TEnum k={STATUS_LABELS[row.status]} fallback={row.status} />
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-xs whitespace-nowrap text-slate-500">
                    {row.lastUsedAt === null ? (
                      <span className="text-slate-400">
                        <T k="token.row.neverUsed" />
                      </span>
                    ) : (
                      formatDateTime(row.lastUsedAt)
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-xs whitespace-nowrap text-slate-500">
                    {row.expiresAt === null ? (
                      <span className="text-amber-700">
                        <T k="token.row.noExpiry" />
                      </span>
                    ) : (
                      formatDate(row.expiresAt)
                    )}
                  </td>
                  <td className="px-2 py-2.5 pr-4">
                    <RowActions>
                      <RowAction
                        icon={<Eye className="size-4" aria-hidden />}
                        label={t('token.row.view')}
                        tone="view"
                        onClick={() => setOpen(expanded ? null : row.id)}
                      />
                      {can('settings.integration.api', 'create') && (
                        <RowAction
                          icon={<RefreshCw className="size-4" aria-hidden />}
                          label={t(
                            row.status === 'active'
                              ? 'token.row.rotate'
                              : 'token.row.rotate.blocked',
                          )}
                          tone="edit"
                          disabled={row.status !== 'active'}
                          onClick={() => void rotate(row)}
                        />
                      )}
                      {can('settings.integration.api', 'edit') && (
                        <RowAction
                          icon={
                            row.revokedAt === null ? (
                              <Ban className="size-4" aria-hidden />
                            ) : (
                              <CircleCheck className="size-4" aria-hidden />
                            )
                          }
                          label={t(
                            row.revokedAt === null
                              ? 'token.row.revoke'
                              : 'token.row.revoke.done',
                          )}
                          tone="warn"
                          disabled={row.revokedAt !== null}
                          onClick={() => void revoke(row)}
                        />
                      )}
                      {can('settings.integration.api', 'delete') && (
                        <RowAction
                          icon={<Trash2 className="size-4" aria-hidden />}
                          label={t(
                            row.revokedAt === null
                              ? 'token.row.remove.blocked'
                              : 'token.row.remove',
                          )}
                          tone="danger"
                          disabled={row.revokedAt === null}
                          onClick={() => setConfirming(row)}
                        />
                      )}
                      <ExpandButton
                        expanded={expanded}
                        onClick={() => setOpen(expanded ? null : row.id)}
                        label={t('token.row.expand')}
                      />
                    </RowActions>
                  </td>
                </tr>

                {expanded && (
                  <tr
                    key={`${String(row.id)}-detail`}
                    className="border-b border-slate-200 bg-slate-50"
                  >
                    <td colSpan={6} className="px-5 py-3">
                      <DetailGrid>
                        <Detail label={<T k="token.detail.prefix" />} value={row.prefix} mono />
                        <Detail
                          label={<T k="panel.column.created" />}
                          value={formatDateTime(row.createdAt)}
                        />
                        <Detail
                          label={<T k="token.detail.value" />}
                          value={t('token.detail.value.hashed')}
                        />
                        <Detail
                          label={<T k="token.detail.requests" />}
                          value={new Intl.NumberFormat('ms-MY').format(row.requestCount)}
                        />
                        <Detail
                          label={<T k="token.detail.lastIp" />}
                          value={row.lastUsedIp ?? '—'}
                          mono
                        />
                        <Detail
                          label={<T k="token.detail.rate" />}
                          value={
                            row.rateWindow === null
                              ? t('token.detail.rate.none')
                              : t('token.detail.rate.count', { count: row.rateWindow.count })
                          }
                        />
                        {row.supersededAt !== null && (
                          <>
                            <Detail
                              label={<T k="token.detail.rotatedAt" />}
                              value={formatDateTime(row.supersededAt)}
                            />
                            <Detail
                              label={<T k="token.detail.rotatedTo" />}
                              value={row.rotatedToPrefix ?? '—'}
                              mono
                            />
                            <Detail
                              label={<T k="token.detail.graceEnds" />}
                              value={formatDateTime(row.graceUntil)}
                            />
                          </>
                        )}
                        {row.revokedAt !== null && (
                          <Detail
                            label={<T k="token.detail.revokedAt" />}
                            value={formatDateTime(row.revokedAt)}
                          />
                        )}
                      </DetailGrid>

                      <div className="mt-3">
                        <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                          <T k="token.detail.scopes" />
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {row.scopes.map((scope) => (
                            <span
                              key={scope}
                              className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200"
                            >
                              {scope}
                            </span>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </RecordTable>
      </div>

      <PanelFooter
        shown={filtered.length}
        total={all.length}
        page={1}
        pageSize={Math.max(1, all.length)}
        pageSizes={[Math.max(1, all.length)]}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => void load()}
      />

      {creating && (
        <CreateTokenDialog
          scopes={scopes}
          onClose={() => setCreating(false)}
          onCreated={(issued) => {
            setCreating(false);
            setRevealed({ value: issued, rotated: false });
            void load();
          }}
        />
      )}

      {revealed !== null && (
        <RevealSecret
          title={t(revealed.rotated ? 'token.reveal.rotated' : 'token.reveal.new')}
          label={t('token.reveal.label')}
          value={revealed.value.token}
          note={
            revealed.rotated
              ? revealed.value.graceUntil === undefined
                ? t('token.reveal.note.rotated')
                : t('token.reveal.note.rotated.until', {
                    until: formatDateTime(revealed.value.graceUntil),
                  })
              : t('token.reveal.note.new')
          }
          hint={
            <T
              k="token.reveal.hint"
              vars={{
                bearer: (
                  <code className="font-mono text-[11px]">
                    Authorization: Bearer &lt;token&gt;
                  </code>
                ),
                apiKey: <code className="font-mono text-[11px]">X-Api-Key: &lt;token&gt;</code>,
              }}
            />
          }
          onClose={() => setRevealed(null)}
        />
      )}

      {confirming !== null && (
        <Dialog
          title={<T k="token.remove.title" vars={{ name: confirming.name }} />}
          titleText={t('token.remove.title', { name: confirming.name })}
          onClose={() => setConfirming(null)}
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <T
                k="token.remove.body"
                vars={{ prefix: <span className="font-mono">{confirming.prefix}</span> }}
              />
            </p>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                <T k="dialog.cancel" />
              </Button>
              <Button
                onClick={() => void remove(confirming)}
                className="bg-rose-600 hover:bg-rose-500"
              >
                <T k="app.remove" />
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

/** Groups scopes by their screen prefix, so eighty checkboxes are navigable. */
function groupScopes(scopes: ApiScope[]): Array<{ group: string; entries: ApiScope[] }> {
  const groups = new Map<string, ApiScope[]>();

  for (const entry of scopes) {
    const group = (entry.scope.split(':')[0] ?? '').split('.')[0] ?? 'lain';
    const existing = groups.get(group);
    if (existing === undefined) groups.set(group, [entry]);
    else existing.push(entry);
  }

  return [...groups].map(([group, entries]) => ({ group, entries }));
}

function CreateTokenDialog({
  scopes,
  onClose,
  onCreated,
}: {
  scopes: ApiScope[];
  onClose: () => void;
  onCreated: (issued: IssuedApiToken) => void;
}): ReactNode {
  const { t, tEnum } = useLabels();
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [neverExpires, setNeverExpires] = useState(false);
  const [days, setDays] = useState('90');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(scope: string): void {
    setChosen((current) =>
      current.includes(scope) ? current.filter((entry) => entry !== scope) : [...current, scope],
    );
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await apiAdminApi.createToken({
          name: name.trim(),
          scopes: chosen,
          expiresInDays: neverExpires ? null : Number(days),
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('token.error.create'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={<T k="token.create.title" />}
      titleText={t('token.create.title')}
      description={<T k="token.create.description" />}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <div>
          <SettingRow
            label={<T k="token.create.name" />}
            hint={<T k="token.create.name.hint" />}
            required
          >
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('token.create.name.placeholder')}
              aria-label={t('token.create.name.aria')}
              autoFocus
              className={CONTROL}
            />
          </SettingRow>

          <SettingRow
            label={<T k="token.create.validity" />}
            hint={<T k="token.create.validity.hint" />}
          >
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                  disabled={neverExpires}
                  aria-label={t('token.create.days.aria')}
                  className={cn(CONTROL, 'max-w-28 disabled:bg-slate-50 disabled:text-slate-400')}
                />
                <span className="text-sm text-slate-500">
                  <T k="token.create.days.unit" />
                </span>
              </div>
              <Switch
                checked={neverExpires}
                onChange={setNeverExpires}
                label={t('token.create.neverExpires')}
              />
            </div>
          </SettingRow>
        </div>

        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-slate-700">
              <T k="token.detail.scopes" />
              <span className="text-rose-500" aria-hidden>
                {' *'}
              </span>
            </p>
            <p className="text-xs text-slate-500">
              <T k="token.create.scopes.chosen" vars={{ count: chosen.length }} />
            </p>
          </div>

          <PanelNote className="mt-1.5">
            {/* The two scope names are the values a token carries, so they come from the
                same map the catalogue is rendered with. */}
            <T
              k="token.create.scopes.note"
              vars={{
                view: <strong className="font-medium">{t('action.view')}</strong>,
                export: <strong className="font-medium">{t('action.export')}</strong>,
              }}
            />
          </PanelNote>

          <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-200">
            {groupScopes(scopes).map(({ group, entries }) => (
              <div key={group} className="border-b border-slate-100 last:border-b-0">
                <p className="bg-slate-50 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  {group}
                </p>
                {entries.map((entry) => (
                  <label
                    key={entry.scope}
                    className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={chosen.includes(entry.scope)}
                      onChange={() => toggle(entry.scope)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block font-mono text-xs text-slate-700">{entry.scope}</span>
                      <span className="block text-[11px] text-slate-500">
                        {/* Screen name and action composed here: the dash belongs to the
                            label, and the server has no reader to resolve either half for. */}
                        <T
                          k="token.scope.label"
                          vars={{
                            screen: t(entry.labelKey),
                            action: tEnum(SCOPE_ACTIONS[entry.action], entry.action),
                          }}
                        />
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={name.trim().length === 0 || chosen.length === 0}
          submitLabel={<T k="token.create.submit" />}
        />
      </div>
    </Dialog>
  );
}

/** Kept beside the list so a caller can be told what the token is for. */
export function TokenPolicyNote({ graceHours }: { graceHours: number }): ReactNode {
  return (
    <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
      <T
        k="token.policy.note"
        vars={{
          notAutomatic: (
            <strong className="font-medium">
              <T k="token.policy.note.notAutomatic" />
            </strong>
          ),
          hours: graceHours,
        }}
      />
    </PanelNote>
  );
}
