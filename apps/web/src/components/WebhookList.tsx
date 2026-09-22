import {
  Ban,
  CircleCheck,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Send,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { formatDateTime } from '../lib/operations-api';
import {
  apiAdminApi,
  type NotificationTrigger,
  type WebhookDelivery,
  type WebhookRow,
  type WebhookSignatureDoc,
} from '../lib/settings-api';
import { T, useLabels } from '../lib/translation';
import { CONTROL, SettingRow, Switch, TriggerToggles } from './ChannelForm';
import { Dialog, DialogFooter, Feedback } from './Dialog';
import {
  ChipBar,
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
import { RevealSecret } from './RevealSecret';
import { Button } from './ui';

/**
 * Outbound webhook subscriptions.
 *
 * Two things make these safe. The signature, so a receiver can prove a request came from
 * us and was not replayed — the difference between a webhook and an unauthenticated POST
 * anybody can forge once they learn the URL. And the target check, because a webhook is
 * the one feature that makes this server issue requests to an address somebody chooses.
 */
export function WebhookList(): ReactNode {
  const { can } = useAuth();
  const { t } = useLabels();
  const [rows, setRows] = useState<WebhookRow[] | null>(null);
  const [triggers, setTriggers] = useState<NotificationTrigger[]>([]);
  const [signature, setSignature] = useState<WebhookSignatureDoc | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<WebhookRow | 'new' | null>(null);
  const [confirming, setConfirming] = useState<WebhookRow | null>(null);
  const [revealed, setRevealed] = useState<{ secret: string; regenerated: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiAdminApi.webhooks();
      setRows(payload.webhooks);
      setTriggers(payload.triggers);
      setSignature(payload.signature);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('webhook.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runTest(row: WebhookRow): Promise<void> {
    setTesting(row.id);
    setError(null);
    setNotice(null);
    try {
      const outcome = await apiAdminApi.testWebhook(row.id);
      if (outcome.ok) {
        setNotice(
          t('webhook.test.ok', {
            name: row.name,
            // Both are nullable on the wire even for a success, so a dash rather than the word
            // "null" reaching a notice somebody reads.
            status: outcome.httpStatus ?? '—',
            duration: outcome.durationMs ?? '—',
          }),
        );
      } else {
        setError(
          t('webhook.test.failed', {
            name: row.name,
            attempt: outcome.attempt,
            // The receiver's own wording when it gave one: it names what to fix.
            reason: outcome.error ?? t('webhook.test.unknownReason'),
          }),
        );
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('webhook.error.test'));
    } finally {
      setTesting(null);
    }
  }

  async function setActive(row: WebhookRow, active: boolean): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await apiAdminApi.updateWebhook(row.id, { active });
      setNotice(
        active
          ? t('webhook.enabled', { name: row.name })
          : t('webhook.disabled', { name: row.name }),
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('webhook.error.status'));
    }
  }

  async function regenerate(row: WebhookRow): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      const outcome = await apiAdminApi.regenerateWebhookSecret(row.id);
      setRevealed({ secret: outcome.secret, regenerated: true });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('webhook.error.regenerate'));
    }
  }

  async function remove(row: WebhookRow): Promise<void> {
    setConfirming(null);
    setError(null);
    try {
      await apiAdminApi.deleteWebhook(row.id);
      setNotice(t('webhook.removed', { name: row.name }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('webhook.error.remove'));
    }
  }

  const all = rows ?? [];
  const needle = search.trim().toLowerCase();
  const filtered = all.filter((row) => {
    const state = row.active ? 'active' : row.disabledReason === null ? 'off' : 'broken';
    if (statusFilter !== undefined && state !== statusFilter) return false;
    if (needle.length === 0) return true;
    return row.name.toLowerCase().includes(needle) || row.url.toLowerCase().includes(needle);
  });

  const counts = {
    active: all.filter((row) => row.active).length,
    off: all.filter((row) => !row.active && row.disabledReason === null).length,
    broken: all.filter((row) => !row.active && row.disabledReason !== null).length,
  };

  return (
    <>
      <PanelSection
        title={<T k="webhook.title" />}
        subtitle={<T k="webhook.subtitle" />}
        action={
          can('settings.integration.api', 'create') ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden />
              <T k="webhook.action.add" />
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
            label: <T k="webhook.chip.active" />,
            count: counts.active,
            dot: 'bg-emerald-500',
          },
          {
            id: 'off',
            label: <T k="webhook.chip.off" />,
            count: counts.off,
            dot: 'bg-slate-400',
          },
          {
            id: 'broken',
            label: <T k="webhook.chip.broken" />,
            count: counts.broken,
            dot: 'bg-rose-500',
          },
        ]}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('webhook.search')}
        dirty={search.length > 0 || statusFilter !== undefined}
        onReset={() => {
          setSearch('');
          setStatusFilter(undefined);
        }}
      />

      <div className="px-5 pt-3">
        <Feedback error={error} notice={notice} />
      </div>

      {signature !== null && (
        <div className="mx-5 mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <p className="flex items-start gap-2 text-xs text-slate-600">
            <KeyRound className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
            {/*
              One sentence with the three signed parts as nodes. Splitting it into five labels
              would assume the same word order in every language, and the <code> runs are
              exactly what must not move relative to the prose around them.
            */}
            <span>
              <T
                k="webhook.signature"
                vars={{
                  header: (
                    <code className="font-mono text-[11px] text-slate-800">{signature.header}</code>
                  ),
                  format: <code className="font-mono text-[11px]">{signature.format}</code>,
                  payload: (
                    <code className="font-mono text-[11px]">{signature.signedPayload}</code>
                  ),
                  seconds: signature.toleranceSeconds,
                }}
              />
            </span>
          </p>
        </div>
      )}

      <div className="mt-3">
        <RecordTable
          loading={loading}
          rowCount={filtered.length}
          empty={<T k="webhook.empty" />}
          columns={[
            { header: <T k="webhook.column.name" /> },
            { header: <T k="webhook.column.events" />, width: 'w-24' },
            { header: <T k="panel.column.status" />, width: 'w-36' },
            { header: <T k="webhook.column.lastSent" />, width: 'w-40' },
            { header: <T k="panel.column.actions" />, width: 'w-44', align: 'right' },
          ]}
        >
          {filtered.map((row) => {
            const expanded = open === row.id;
            const autoOff = !row.active && row.disabledReason !== null;
            const failing = row.active && row.failureCount > 0;

            return (
              <>
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-slate-100',
                    expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
                    !expanded && autoOff && 'bg-rose-50/40',
                    !expanded && failing && 'bg-amber-50/40',
                  )}
                >
                  <td className="px-5 py-2.5">
                    <span className="block font-medium text-slate-800">{row.name}</span>
                    <span className="block truncate font-mono text-[11px] text-slate-400">
                      {row.url}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-xs tabular-nums text-slate-600">
                    {row.events.length}
                  </td>
                  <td className="px-2 py-2.5">
                    <span
                      className={cn(
                        'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
                        autoOff
                          ? 'bg-rose-50 text-rose-700'
                          : row.active
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-600',
                      )}
                    >
                      <T
                        k={
                          autoOff
                            ? 'webhook.status.autoOff'
                            : row.active
                              ? 'webhook.status.active'
                              : 'webhook.status.off'
                        }
                      />
                    </span>
                    {failing && (
                      <span className="mt-0.5 block text-[11px] text-amber-700">
                        <T k="webhook.failures" vars={{ count: row.failureCount }} />
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-xs whitespace-nowrap text-slate-500">
                    {row.lastDeliveryAt === null ? (
                      <span className="text-slate-400">
                        <T k="webhook.never" />
                      </span>
                    ) : (
                      <>
                        {formatDateTime(row.lastDeliveryAt)}
                        {row.lastStatus !== null && (
                          <span
                            className={cn(
                              'ml-1.5 font-mono',
                              row.lastStatus >= 200 && row.lastStatus < 300
                                ? 'text-emerald-700'
                                : 'text-rose-700',
                            )}
                          >
                            {row.lastStatus}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-2 py-2.5 pr-4">
                    <RowActions>
                      {can('settings.integration.api', 'test') && (
                        <RowAction
                          icon={
                            testing === row.id ? (
                              <Loader2 className="size-4 animate-spin" aria-hidden />
                            ) : (
                              <Send className="size-4" aria-hidden />
                            )
                          }
                          label={t('webhook.action.test')}
                          tone="view"
                          disabled={testing !== null}
                          onClick={() => void runTest(row)}
                        />
                      )}
                      {can('settings.integration.api', 'edit') && (
                        <RowAction
                          icon={<Pencil className="size-4" aria-hidden />}
                          label={t('webhook.action.edit')}
                          tone="edit"
                          onClick={() => setEditing(row)}
                        />
                      )}
                      {can('settings.integration.api', 'edit') && (
                        <RowAction
                          icon={<KeyRound className="size-4" aria-hidden />}
                          label={t('webhook.action.regenerate')}
                          tone="warn"
                          onClick={() => void regenerate(row)}
                        />
                      )}
                      {can('settings.integration.api', 'edit') && (
                        <RowAction
                          icon={
                            row.active ? (
                              <Ban className="size-4" aria-hidden />
                            ) : (
                              <CircleCheck className="size-4" aria-hidden />
                            )
                          }
                          label={
                            row.active
                              ? t('webhook.action.disable')
                              : t('webhook.action.enable')
                          }
                          tone="warn"
                          onClick={() => void setActive(row, !row.active)}
                        />
                      )}
                      {can('settings.integration.api', 'delete') && (
                        <RowAction
                          icon={<Trash2 className="size-4" aria-hidden />}
                          label={t('webhook.action.remove')}
                          tone="danger"
                          onClick={() => setConfirming(row)}
                        />
                      )}
                      <ExpandButton
                        expanded={expanded}
                        onClick={() => setOpen(expanded ? null : row.id)}
                        label={t('webhook.expand')}
                      />
                    </RowActions>
                  </td>
                </tr>

                {expanded && (
                  <tr
                    key={`${String(row.id)}-detail`}
                    className="border-b border-slate-200 bg-slate-50"
                  >
                    <td colSpan={5} className="px-5 py-3">
                      <WebhookDetail row={row} triggers={triggers} />
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

      <PanelBody className="pt-0">
        <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
          <T
            k="webhook.retry.note"
            vars={{
              noRetry: (
                <strong className="font-medium">
                  <T k="webhook.retry.note.noRetry" />
                </strong>
              ),
              retried: (
                <strong className="font-medium">
                  <T k="webhook.retry.note.retried" />
                </strong>
              ),
            }}
          />
        </PanelNote>
      </PanelBody>

      {editing !== null && (
        <WebhookDialog
          row={editing === 'new' ? null : editing}
          triggers={triggers}
          onClose={() => setEditing(null)}
          onSaved={(secret) => {
            setEditing(null);
            if (secret !== null) setRevealed({ secret, regenerated: false });
            void load();
          }}
        />
      )}

      {revealed !== null && (
        <RevealSecret
          title={
            revealed.regenerated
              ? t('webhook.secret.titleRegenerated')
              : t('webhook.secret.titleNew')
          }
          label={t('webhook.secret.label')}
          value={revealed.secret}
          note={
            revealed.regenerated
              ? t('webhook.secret.noteRegenerated')
              : t('webhook.secret.noteNew')
          }
          hint={<T k="webhook.secret.hint" />}
          onClose={() => setRevealed(null)}
        />
      )}

      {confirming !== null && (
        <Dialog
          title={<T k="webhook.remove.title" vars={{ name: confirming.name }} />}
          titleText={t('webhook.remove.title', { name: confirming.name })}
          onClose={() => setConfirming(null)}
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <T k="webhook.remove.body" />
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

/** The expanded row: what it is subscribed to, and what actually happened. */
function WebhookDetail({
  row,
  triggers,
}: {
  row: WebhookRow;
  triggers: NotificationTrigger[];
}): ReactNode {
  const { t } = useLabels();
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiAdminApi
      .deliveries(row.id, 15)
      .then((payload) => setDeliveries(payload.deliveries))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : t('webhook.error.deliveries')),
      );
    // 	 is deliberately absent from the deps: refetching the log because the dictionary
    // loaded would replay the request for no new information.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, row.lastDeliveryAt]);

  // Resolved through the registry: the catalogue carries keys, not words.
  const labelFor = (key: string): string => {
    const labelKey = triggers.find((trigger) => trigger.key === key)?.labelKey;
    return labelKey === undefined ? key : t(labelKey);
  };

  return (
    <div className="space-y-3">
      {row.disabledReason !== null && (
        <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
          {row.disabledReason}
        </PanelNote>
      )}

      <div>
        <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
          <T k="webhook.detail.subscribed" />
        </p>
        <div className="mt-1 flex flex-wrap gap-1">
          {row.events.map((event) => {
            const wired = triggers.find((trigger) => trigger.key === event)?.wired ?? false;
            return (
              <span
                key={event}
                className="inline-flex items-center gap-1.5 rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200"
              >
                {labelFor(event)}
                {/* Marked rather than hidden: a subscription to something nothing raises
                    yet would otherwise read as a webhook that silently never fires. */}
                {!wired && (
                  <span className="text-[10px] text-slate-400">
                    <T k="trigger.notWired" />
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
          <T k="webhook.detail.recent" />
        </p>

        {error !== null && <p className="mt-1 text-xs text-rose-700">{error}</p>}

        {deliveries === null && error === null && (
          <p className="mt-1 text-xs text-slate-500">
            <T k="webhook.detail.loading" />
          </p>
        )}

        {deliveries !== null && deliveries.length === 0 && (
          <p className="mt-1 text-xs text-slate-500">
            <T k="webhook.detail.none" />
          </p>
        )}

        {deliveries !== null && deliveries.length > 0 && (
          <ul className="mt-1 divide-y divide-slate-200 overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
            {deliveries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-2.5 py-1.5">
                <span
                  className={cn(
                    'inline-block w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-semibold',
                    entry.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
                  )}
                >
                  {entry.httpStatus ?? t('webhook.detail.error')}
                </span>
                <span className="font-mono text-[11px] text-slate-600">{entry.event}</span>
                <span className="text-[11px] text-slate-400">
                  <T k="webhook.detail.attempt" vars={{ count: entry.attempt }} />
                </span>
                <span className="text-[11px] text-slate-400">
                  {entry.durationMs === null ? (
                    '—'
                  ) : (
                    <T k="webhook.detail.duration" vars={{ ms: entry.durationMs }} />
                  )}
                </span>
                <span className="ml-auto text-[11px] whitespace-nowrap text-slate-400">
                  {formatDateTime(entry.createdAt)}
                </span>
                {entry.error !== null && (
                  <span className="w-full text-[11px] break-words text-rose-700">{entry.error}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function WebhookDialog({
  row,
  triggers,
  onClose,
  onSaved,
}: {
  row: WebhookRow | null;
  triggers: NotificationTrigger[];
  onClose: () => void;
  /** Carries the signing key on creation, since that is the only moment it exists. */
  onSaved: (secret: string | null) => void;
}): ReactNode {
  const [name, setName] = useState(row?.name ?? '');
  const [url, setUrl] = useState(row?.url ?? '');
  const [events, setEvents] = useState<string[]>(row?.events ?? []);
  const [active, setActive] = useState(row?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (row === null) {
        const created = await apiAdminApi.createWebhook({
          name: name.trim(),
          url: url.trim(),
          events,
          active,
        });
        onSaved(created.secret);
      } else {
        await apiAdminApi.updateWebhook(row.id, {
          name: name.trim(),
          url: url.trim(),
          events,
          active,
        });
        onSaved(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('webhook.error.save'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={
        row === null ? (
          <T k="webhook.form.titleNew" />
        ) : (
          <T k="webhook.form.titleEdit" vars={{ name: row.name }} />
        )
      }
      titleText={
        row === null
          ? t('webhook.form.titleNew')
          : t('webhook.form.titleEdit', { name: row.name })
      }
      description={<T k="webhook.form.description" />}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <div>
          <SettingRow
            label={<T k="webhook.form.name" />}
            hint={<T k="webhook.form.name.hint" />}
            required
          >
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('webhook.form.name.placeholder')}
              aria-label={t('webhook.form.name.aria')}
              autoFocus
              className={CONTROL}
            />
          </SettingRow>

          <SettingRow
            label={<T k="webhook.form.url" />}
            hint={<T k="webhook.form.url.hint" />}
            required
          >
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://portal.hospital.local/webhook/kehadiran"
              aria-label={t('webhook.form.url')}
              className={cn(CONTROL, 'font-mono')}
            />
          </SettingRow>

          <SettingRow
            label={<T k="webhook.form.active" />}
            hint={<T k="webhook.form.active.hint" />}
          >
            <Switch
              checked={active}
              onChange={setActive}
              label={t('webhook.form.active.switch')}
            />
          </SettingRow>
        </div>

        <PanelNote>
          <T
            k="webhook.form.ssrf"
            vars={{
              address: <code className="font-mono text-[11px]">169.254.169.254</code>,
            }}
          />
        </PanelNote>

        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-slate-700">
              <T k="webhook.form.events" />
              <span className="text-rose-500" aria-hidden>
                {' *'}
              </span>
            </p>
            <p className="text-xs text-slate-500">
              <T k="webhook.form.events.count" vars={{ count: events.length }} />
            </p>
          </div>
          <div className="mt-1">
            <TriggerToggles triggers={triggers} selected={events} onChange={setEvents} />
          </div>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={name.trim().length === 0 || url.trim().length === 0 || events.length === 0}
          submitLabel={
            row === null ? <T k="webhook.form.submitNew" /> : <T k="dialog.save" />
          }
        />
      </div>
    </Dialog>
  );
}
