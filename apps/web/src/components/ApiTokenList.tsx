import { Ban, CalendarOff, CircleCheck, Eye, KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';

import type { LabelKey } from '@attendance/shared';

import { cn } from '../lib/cn';
import { useAuth } from '../lib/auth';
import { formatDate, formatDateTime } from '../lib/operations-api';
import { intlLocale, T, TEnum, useLabels } from '../lib/translation';
import {
  apiAdminApi,
  type ApiScope,
  type ApiTokenRow,
  type ApiTokenStatus,
  type IssuedApiToken,
} from '../lib/settings-api';
import { Dialog, DialogFooter, Feedback } from './Dialog';
import {
  ChipBar,
  Detail,
  DetailGrid,
  ExpandButton,
  FilterRow,
  PanelBody,
  PanelFooter,
  PanelNote,
  PanelSection,
  RecordTable,
  RowAction,
  RowActions,
} from './RecordPanel';
import { RemoveDialog } from './RemoveDialog';
import { RevealSecret } from './RevealSecret';
import { Badge, Button, CheckCard, Field } from './ui';

/**
 * API tokens.
 *
 * Read-only scopes only. A write scope would let a token change attendance with no person attached
 * to the change, and the audit trail is built on there always being one.
 *
 * The reference design had a "rotate daily" switch. That is not implemented here and the omission
 * is deliberate: rotating a static credential on a timer breaks every integration holding it,
 * silently, at whatever hour the timer fires. Rotation is an explicit action with a grace window
 * instead, so a deployment can pick up the new value on its own schedule and the old one stops
 * afterwards.
 */

/** Registry keys, not words. Upper case comes from the badge's class. */
const STATUS_LABELS: Record<ApiTokenStatus, LabelKey> = {
  active: 'tokenStatus.active',
  grace: 'tokenStatus.grace',
  superseded: 'tokenStatus.superseded',
  expired: 'tokenStatus.expired',
  revoked: 'tokenStatus.revoked',
};

const STATUS_TONES: Record<ApiTokenStatus, 'success' | 'warning' | 'neutral' | 'danger'> = {
  active: 'success',
  grace: 'warning',
  superseded: 'neutral',
  expired: 'neutral',
  revoked: 'danger',
};

/** Only two actions are offerable as scopes, so the map is two entries. */
const SCOPE_ACTIONS: Record<string, LabelKey> = {
  view: 'action.view',
  export: 'action.export',
};

export function ApiTokenList({ graceHours }: { graceHours: number }): ReactNode {
  const { can } = useAuth();
  const { t, locale } = useLabels();
  const [rows, setRows] = useState<ApiTokenRow[] | null>(null);
  const [scopes, setScopes] = useState<ApiScope[]>([]);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<ApiTokenRow | null>(null);
  const [revoking, setRevoking] = useState<ApiTokenRow | null>(null);
  const [rotating, setRotating] = useState<ApiTokenRow | null>(null);
  const [revealed, setRevealed] = useState<{ value: IssuedApiToken; rotated: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiAdminApi.tokens();
      setRows(payload.tokens);
      setScopes(payload.scopes);
      setLoadedAt(new Date().toISOString());
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

  const all = rows ?? [];
  const needle = search.trim().toLowerCase();
  const matches = (row: ApiTokenRow): boolean =>
    needle.length === 0 ||
    row.name.toLowerCase().includes(needle) ||
    row.prefix.toLowerCase().includes(needle);
  const searched = all.filter(matches);
  const filtered = searched.filter((row) => {
    if (statusFilter === undefined) return true;
    // Superseded tokens are past their grace window, so they sit with the expired ones.
    if (statusFilter === 'expired') return row.status === 'expired' || row.status === 'superseded';
    return row.status === statusFilter;
  });

  // Counted over the search but not over the chip, so selecting one does not zero the others.
  const counts = {
    active: searched.filter((row) => row.status === 'active').length,
    grace: searched.filter((row) => row.status === 'grace').length,
    revoked: searched.filter((row) => row.status === 'revoked').length,
    expired: searched.filter((row) => row.status === 'expired' || row.status === 'superseded')
      .length,
  };
  const number = new Intl.NumberFormat(intlLocale(locale));

  return (
    <>
      <PanelSection
        title={<T k="token.count" vars={{ count: all.length }} />}
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

      {/* The one note: a lost value cannot be recovered, and rotating is what replaces it. */}
      <PanelBody className="space-y-2 pb-0">
        <Feedback error={error} notice={notice} />
        <PanelNote icon={<KeyRound className="size-3.5" aria-hidden />}>
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
        </PanelNote>
      </PanelBody>

      <RecordTable
        framed
        loading={loading}
        rowCount={filtered.length}
        empty={<T k="token.empty" />}
        columns={[
          { header: <T k="token.column.name" /> },
          { header: <T k="token.column.scopes" />, width: 'w-24', align: 'right' },
          { header: <T k="token.column.lastUsed" />, width: 'w-40' },
          { header: <T k="token.column.expires" />, width: 'w-28' },
          { header: <T k="panel.column.status" />, width: 'w-32' },
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
            <Fragment key={row.id}>
              <tr
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
                <td className="px-2 py-2.5 text-right text-xs text-slate-600 tabular-nums">
                  {row.scopes.length}
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
                <td className="px-2 py-2.5">
                  <Badge tone={STATUS_TONES[row.status]} className="uppercase">
                    <TEnum k={STATUS_LABELS[row.status]} fallback={row.status} />
                  </Badge>
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
                          row.status === 'active' ? 'token.row.rotate' : 'token.row.rotate.blocked',
                        )}
                        tone="edit"
                        disabled={row.status !== 'active'}
                        onClick={() => setRotating(row)}
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
                          row.revokedAt === null ? 'token.row.revoke' : 'token.row.revoke.done',
                        )}
                        tone="warn"
                        disabled={row.revokedAt !== null}
                        onClick={() => setRevoking(row)}
                      />
                    )}
                    {can('settings.integration.api', 'delete') && (
                      <RowAction
                        icon={<Trash2 className="size-4" aria-hidden />}
                        label={t(
                          row.revokedAt === null ? 'token.row.remove.blocked' : 'token.row.remove',
                        )}
                        tone="danger"
                        disabled={row.revokedAt === null}
                        onClick={() => setRemoving(row)}
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
                <tr className="border-b border-slate-200 bg-slate-50">
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
                        value={number.format(row.requestCount)}
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
            </Fragment>
          );
        })}
      </RecordTable>

      <PanelFooter
        shown={filtered.length}
        total={all.length}
        page={1}
        pageSize={Math.max(1, all.length)}
        pageSizes={[Math.max(1, all.length)]}
        generatedAt={loadedAt}
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

      {/*
        Rotating and revoking used to happen on the click. Revoking breaks every integration holding
        the token on its next request and cannot be undone; rotating starts the old token's
        countdown. Both now say so before they happen.
      */}
      {rotating !== null && (
        <RemoveDialog
          title={<T k="token.rotate.title" vars={{ name: rotating.name }} />}
          titleText={t('token.rotate.title', { name: rotating.name })}
          description={
            <T k="token.rotate.body" vars={{ prefix: rotating.prefix, hours: graceHours }} />
          }
          submitLabel={<T k="token.rotate.submit" />}
          onConfirm={async () => {
            const issued = await apiAdminApi.rotateToken(rotating.id);
            setRotating(null);
            setError(null);
            setNotice(null);
            setRevealed({ value: issued, rotated: true });
            await load();
          }}
          onClose={() => setRotating(null)}
        />
      )}

      {revoking !== null && (
        <RemoveDialog
          title={<T k="token.revoke.title" vars={{ name: revoking.name }} />}
          titleText={t('token.revoke.title', { name: revoking.name })}
          description={<T k="token.revoke.body" vars={{ prefix: revoking.prefix }} />}
          submitLabel={<T k="token.revoke.submit" />}
          onConfirm={async () => {
            await apiAdminApi.revokeToken(revoking.id);
            setRevoking(null);
            setError(null);
            setNotice(t('token.notice.revoked', { prefix: revoking.prefix }));
            await load();
          }}
          onClose={() => setRevoking(null)}
        />
      )}

      {removing !== null && (
        <RemoveDialog
          title={<T k="token.remove.title" vars={{ name: removing.name }} />}
          titleText={t('token.remove.title', { name: removing.name })}
          description={
            <T
              k="token.remove.body"
              vars={{ prefix: <span className="font-mono">{removing.prefix}</span> }}
            />
          }
          onConfirm={async () => {
            await apiAdminApi.deleteToken(removing.id);
            setRemoving(null);
            setError(null);
            setNotice(t('token.notice.removed', { prefix: removing.prefix }));
            await load();
          }}
          onClose={() => setRemoving(null)}
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
                  <code className="font-mono text-[11px]">Authorization: Bearer &lt;token&gt;</code>
                ),
                apiKey: <code className="font-mono text-[11px]">X-Api-Key: &lt;token&gt;</code>,
              }}
            />
          }
          onClose={() => setRevealed(null)}
        />
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

  const daysValid = neverExpires || (Number(days) >= 1 && Number(days) <= 3650);

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

        {/* Identity first: what the token is for, then how long it lives. */}
        <div className="grid items-start gap-4 sm:grid-cols-[1fr_10rem]">
          <Field
            label={<T k="token.create.name" />}
            hint={<T k="token.create.name.hint" />}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('token.create.name.placeholder')}
            autoFocus
          />
          <Field
            label={<T k="token.create.days" />}
            inputMode="numeric"
            value={neverExpires ? '' : days}
            onChange={(event) => setDays(event.target.value.replace(/\D/g, ''))}
            disabled={neverExpires}
          />
        </div>

        <CheckCard
          checked={neverExpires}
          onChange={setNeverExpires}
          icon={<CalendarOff className="size-4" aria-hidden />}
          title={<T k="token.create.neverExpires" />}
          hint={<T k="token.create.validity.hint" />}
        />

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="pb-2">
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
          {/* The rule for this one field, as its hint. The two scope names are the values a token
              carries, so they come from the same map the catalogue is rendered with. */}
          <p className="mt-0.5 text-xs text-slate-500">
            <T
              k="token.create.scopes.note"
              vars={{
                view: <strong className="font-medium">{t('action.view')}</strong>,
                export: <strong className="font-medium">{t('action.export')}</strong>,
              }}
            />
          </p>

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
                        {/* Screen name and action composed here: the dash belongs to the label,
                            and the server has no reader to resolve either half for. */}
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
          disabled={name.trim().length === 0 || chosen.length === 0 || !daysValid}
          submitLabel={<T k="token.create.submit" />}
        />
      </div>
    </Dialog>
  );
}
