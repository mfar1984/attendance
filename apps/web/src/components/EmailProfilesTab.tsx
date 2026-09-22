import {
  CircleCheck,
  CircleX,
  KeyRound,
  Loader2,
  Mail,
  Plus,
  Save,
  Send,
  Server,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { cn } from '../lib/cn';
import { formatDateTime } from '../lib/operations-api';
import {
  ENCRYPTION_LABELS,
  emailProfilesApi,
  type EmailEncryption,
  type EmailProfile,
  type EmailProfilePage,
} from '../lib/settings-api';
import { T, useLabels } from '../lib/translation';
import { CONTROL, SettingRow, Switch } from './ChannelForm';
import { Dialog, DialogFooter, Feedback } from './Dialog';
import {
  PanelActions,
  PanelBody,
  PanelNote,
  PanelSection,
  SettingsGroup,
  SettingsStack,
} from './RecordPanel';
import { Badge, Button } from './ui';

/**
 * SMTP sender profiles.
 *
 * Several named senders rather than one relay, because the mail this system sends comes
 * from different parts of the hospital: a payroll notice from Accounting, a leave
 * decision from HR. One shared address means a recipient cannot tell which, and a reply
 * lands in whoever owns that mailbox.
 *
 * Code selects a profile by its `key`, never by row id, which is why the key is fixed
 * once saved — renaming it would silently detach every notification that names it.
 */

interface Draft {
  key: string;
  name: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  active: boolean;
  provider: string;
  host: string;
  port: string;
  encryption: EmailEncryption;
  timeoutSeconds: string;
  maxRetries: string;
  authenticate: boolean;
  username: string;
}

const BLANK: Draft = {
  key: '',
  name: '',
  fromName: '',
  fromEmail: '',
  replyTo: '',
  active: true,
  provider: 'custom',
  host: '',
  port: '587',
  encryption: 'tls',
  timeoutSeconds: '30',
  maxRetries: '3',
  authenticate: true,
  username: '',
};

function toDraft(profile: EmailProfile): Draft {
  return {
    key: profile.key,
    name: profile.name,
    fromName: profile.fromName,
    fromEmail: profile.fromEmail,
    replyTo: profile.replyTo ?? '',
    active: profile.active,
    provider: profile.provider,
    host: profile.host,
    port: String(profile.port),
    encryption: profile.encryption,
    timeoutSeconds: String(profile.timeoutSeconds),
    maxRetries: String(profile.maxRetries),
    authenticate: profile.authenticate,
    username: profile.username ?? '',
  };
}

export function EmailProfilesTab(): ReactNode {
  const [page, setPage] = useState<EmailProfilePage | null>(null);
  /** A row id, or `'new'` for an unsaved draft. */
  const [selected, setSelected] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [testing, setTesting] = useState(false);
  const [recipient, setRecipient] = useState('');
  const { t } = useLabels();

  const load = useCallback(async (keep?: number) => {
    setLoading(true);
    try {
      const result = await emailProfilesApi.list();
      setPage(result);
      setError(null);

      const target =
        keep !== undefined
          ? result.profiles.find((row) => row.id === keep)
          : (result.profiles[0] ?? undefined);
      if (target) {
        setSelected(target.id);
        setDraft(toDraft(target));
      } else if (result.profiles.length === 0) {
        setSelected(null);
      }
      setPassword('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('emailProfile.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const profiles = page?.profiles ?? [];
  const current = typeof selected === 'number' ? profiles.find((row) => row.id === selected) : null;
  const creating = selected === 'new';

  function set<K extends keyof Draft>(field: K, value: Draft[K]): void {
    setDraft((state) => ({ ...state, [field]: value }));
  }

  /**
   * Applying a preset fills the transport fields only.
   *
   * The stored values remain what actually gets used, so a preset corrected in a later
   * release cannot silently repoint a profile somebody already configured and tested.
   */
  function applyProvider(key: string): void {
    const preset = (page?.providers ?? []).find((row) => row.key === key);
    setDraft((state) => ({
      ...state,
      provider: key,
      ...(preset && preset.host.length > 0
        ? { host: preset.host, port: String(preset.port), encryption: preset.encryption }
        : {}),
    }));
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        name: draft.name.trim(),
        fromName: draft.fromName.trim(),
        fromEmail: draft.fromEmail.trim(),
        replyTo: draft.replyTo.trim(),
        active: draft.active,
        provider: draft.provider,
        host: draft.host.trim(),
        port: Number(draft.port),
        encryption: draft.encryption,
        timeoutSeconds: Number(draft.timeoutSeconds),
        maxRetries: Number(draft.maxRetries),
        authenticate: draft.authenticate,
        username: draft.username.trim(),
        // Blank means "keep the stored one": the value is never shown, so blank cannot
        // mean "clear it".
        ...(password.length > 0 ? { password } : {}),
      };

      if (creating) {
        const created = await emailProfilesApi.create({ ...payload, key: draft.key.trim() });
        setNotice(t('emailProfile.created', { name: created.name }));
        await load(created.id);
      } else if (current) {
        await emailProfilesApi.update(current.id, payload);
        setNotice(t('emailProfile.saved', { name: payload.name }));
        await load(current.id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('emailProfile.error.save'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!current) return;
    setBusy(true);
    try {
      await emailProfilesApi.remove(current.id);
      setConfirming(false);
      setNotice(t('emailProfile.removed', { name: current.name }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('emailProfile.error.remove'));
    } finally {
      setBusy(false);
    }
  }

  async function runTest(): Promise<void> {
    if (!current) return;
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await emailProfilesApi.test(current.id, recipient.trim() || undefined);
      // A refusal is a real answer, not a request failure, so it reads as a warning on
      // the panel rather than as a broken screen.
      if (result.ok) setNotice(t('emailProfile.test.sent', { recipient: result.recipient }));
      else setError(result.lastTestDetail ?? t('emailProfile.test.failed'));
      await load(current.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('emailProfile.error.test'));
    } finally {
      setTesting(false);
    }
  }

  const complete =
    draft.name.trim() !== '' &&
    draft.fromName.trim() !== '' &&
    draft.fromEmail.trim() !== '' &&
    draft.host.trim() !== '' &&
    (!creating || /^[a-z][a-z0-9-]*$/.test(draft.key.trim())) &&
    (!draft.authenticate ||
      (draft.username.trim() !== '' && (password.length > 0 || current?.passwordSet === true)));

  return (
    <>
      <PanelSection
        icon={<Mail className="size-4" aria-hidden />}
        title={<T k="emailProfile.title" />}
        subtitle={<T k="emailProfile.subtitle" />}
      />

      {/* Selector strip. Chips rather than a dropdown: at this count the whole set is
          worth seeing, including which ones are switched off. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/60 px-5 py-3">
        <span className="text-xs font-medium text-slate-500">
          <T k="emailProfile.select" />
        </span>
        {profiles.map((profile) => {
          const active = profile.id === selected;
          return (
            <button
              key={profile.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setSelected(profile.id);
                setDraft(toDraft(profile));
                setPassword('');
                setError(null);
                setNotice(null);
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium',
                active
                  ? 'border-brand-300 bg-brand-100 text-brand-700 shadow-sm'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              <Mail className="size-3.5" aria-hidden />
              {profile.name}
              <span
                aria-hidden
                className={cn(
                  'size-1.5 rounded-full',
                  profile.active ? 'bg-emerald-500' : 'bg-slate-300',
                )}
              />
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => {
            setSelected('new');
            setDraft(BLANK);
            setPassword('');
            setError(null);
            setNotice(null);
          }}
          aria-label={t('emailProfile.action.add.aria')}
          title={t('emailProfile.action.add.aria')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5 text-xs font-medium',
            creating
              ? 'border-brand-400 bg-brand-100 text-brand-700'
              : 'border-slate-400 text-slate-600 hover:bg-white',
          )}
        >
          <Plus className="size-3.5" aria-hidden />
          <T k="emailProfile.action.add" />
        </button>
      </div>

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      {loading && profiles.length === 0 ? (
        <div className="flex min-h-48 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('app.loading')} />
        </div>
      ) : selected === null ? (
        <PanelBody>
          <PanelNote icon={<Mail className="size-3.5" aria-hidden />}>
            <T
              k="emailProfile.none"
              vars={{
                newButton: (
                  <strong className="font-medium">
                    <T k="emailProfile.action.add" />
                  </strong>
                ),
              }}
            />
          </PanelNote>
        </PanelBody>
      ) : (
        <>
          {/* Three groups, one card each: who the mail claims to be from, which relay
              carries it, and how it authenticates. Read in that order when something
              bounces. */}
          <SettingsStack>
            <SettingsGroup
              title={<T k="emailProfile.group.sender" />}
              icon={<UserRound className="size-3.5" aria-hidden />}
              subtitle={creating ? <T k="emailProfile.group.sender.new" /> : undefined}
              action={
                current && (
                  <Button
                    variant="ghost"
                    onClick={() => setConfirming(true)}
                    disabled={busy}
                    className="border-rose-300 text-rose-700 hover:bg-rose-50"
                  >
                    <Trash2 className="size-4" aria-hidden />
                    <T k="emailProfile.action.remove" />
                  </Button>
                )
              }
            >
            <SettingRow
              label={<T k="emailProfile.key" />}
              hint={
                creating ? (
                  <T k="emailProfile.key.hintNew" />
                ) : (
                  <T k="emailProfile.key.hint" />
                )
              }
              required={creating}
            >
              {creating ? (
                <input
                  value={draft.key}
                  onChange={(event) =>
                    set('key', event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                  }
                  placeholder="accounting"
                  aria-label={t('emailProfile.key')}
                  className={cn(CONTROL, 'font-mono')}
                />
              ) : (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-600">
                  {draft.key}
                </p>
              )}
            </SettingRow>

            <SettingRow label={<T k="emailProfile.name" />} required>
              <input
                value={draft.name}
                onChange={(event) => set('name', event.target.value)}
                placeholder="Akaun"
                aria-label={t('emailProfile.name')}
                className={CONTROL}
              />
            </SettingRow>

            <SettingRow
              label={<T k="emailProfile.fromName" />}
              hint={<T k="emailProfile.fromName.hint" />}
              required
            >
              <input
                value={draft.fromName}
                onChange={(event) => set('fromName', event.target.value)}
                placeholder="Jabatan Akaun Hospital Sibu"
                aria-label={t('emailProfile.fromName')}
                className={CONTROL}
              />
            </SettingRow>

            <SettingRow label={<T k="emailProfile.fromEmail" />} required>
              <input
                type="email"
                value={draft.fromEmail}
                onChange={(event) => set('fromEmail', event.target.value)}
                placeholder="akaun@hospital.local"
                aria-label={t('emailProfile.fromEmail')}
                className={CONTROL}
              />
            </SettingRow>

            <SettingRow
              label={<T k="emailProfile.replyTo" />}
              hint={<T k="emailProfile.replyTo.hint" />}
            >
              <input
                type="email"
                value={draft.replyTo}
                onChange={(event) => set('replyTo', event.target.value)}
                aria-label={t('emailProfile.replyTo')}
                className={CONTROL}
              />
            </SettingRow>

            <SettingRow
              label={<T k="emailProfile.status" />}
              hint={<T k="emailProfile.status.hint" />}
            >
              <Switch
                checked={draft.active}
                onChange={(value) => set('active', value)}
                label={t('emailProfile.status.switch')}
              />
            </SettingRow>
            </SettingsGroup>

            <SettingsGroup
              title={<T k="emailProfile.group.smtp" />}
              icon={<Server className="size-3.5" aria-hidden />}
              action={
                <span className="font-mono text-[11px] text-slate-400">
                  {draft.host === '' ? '—' : `${draft.host}:${String(draft.port)}`}
                </span>
              }
            >
            <SettingRow
              label={<T k="emailProfile.provider" />}
              hint={<T k="emailProfile.provider.hint" />}
            >
              <select
                value={draft.provider}
                onChange={(event) => applyProvider(event.target.value)}
                aria-label={t('emailProfile.provider')}
                className={CONTROL}
              >
                {(page?.providers ?? []).map((provider) => (
                  <option key={provider.key} value={provider.key}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </SettingRow>

            <SettingRow label={<T k="emailProfile.host" />} required>
              <input
                value={draft.host}
                onChange={(event) => set('host', event.target.value)}
                placeholder="smtp.hospital.local"
                aria-label={t('emailProfile.host')}
                className={cn(CONTROL, 'font-mono')}
              />
            </SettingRow>

            <SettingRow
              label={<T k="emailProfile.port" />}
              hint={<T k="emailProfile.port.hint" />}
            >
              <input
                inputMode="numeric"
                value={draft.port}
                onChange={(event) => set('port', event.target.value.replace(/\D/g, ''))}
                aria-label={t('emailProfile.port')}
                className={cn(CONTROL, 'font-mono')}
              />
            </SettingRow>

            <SettingRow
              label={<T k="emailProfile.encryption" />}
              hint={<T k="emailProfile.encryption.hint" />}
            >
              <div className="flex flex-wrap gap-4">
                {(['none', 'tls', 'ssl'] as const).map((mode) => (
                  <label key={mode} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="encryption"
                      checked={draft.encryption === mode}
                      onChange={() => set('encryption', mode)}
                    />
                    {/* Through the shared map rather than derived from the enum: `TLS` and
                        `SSL` happen to upper-case cleanly, `none` does not. */}
                    <T k={ENCRYPTION_LABELS[mode]} />
                  </label>
                ))}
              </div>
            </SettingRow>

            <SettingRow
              label={<T k="emailProfile.timeout" />}
              hint={<T k="emailProfile.timeout.hint" />}
            >
              <input
                inputMode="numeric"
                value={draft.timeoutSeconds}
                onChange={(event) => set('timeoutSeconds', event.target.value.replace(/\D/g, ''))}
                aria-label={t('emailProfile.timeout')}
                className={cn(CONTROL, 'font-mono')}
              />
            </SettingRow>

            <SettingRow
              label={<T k="emailProfile.maxRetries" />}
              hint={<T k="emailProfile.maxRetries.hint" />}
            >
              <input
                inputMode="numeric"
                value={draft.maxRetries}
                onChange={(event) => set('maxRetries', event.target.value.replace(/\D/g, ''))}
                aria-label={t('emailProfile.maxRetries')}
                className={cn(CONTROL, 'font-mono')}
              />
            </SettingRow>
            </SettingsGroup>

            <SettingsGroup
              title={<T k="emailProfile.group.auth" />}
              icon={<KeyRound className="size-3.5" aria-hidden />}
              action={
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
                    !draft.authenticate
                      ? 'bg-slate-100 text-slate-600'
                      : current?.passwordSet === true
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-amber-50 text-amber-700',
                  )}
                >
                  <T
                    k={
                      !draft.authenticate
                        ? 'emailProfile.auth.none'
                        : current?.passwordSet === true
                          ? 'emailProfile.auth.stored'
                          : 'emailProfile.auth.needed'
                    }
                  />
                </span>
              }
            >
            <SettingRow
              label={<T k="emailProfile.authenticate" />}
              hint={<T k="emailProfile.authenticate.hint" />}
            >
              <Switch
                checked={draft.authenticate}
                onChange={(value) => set('authenticate', value)}
                label={t('emailProfile.authenticate.switch')}
              />
            </SettingRow>

            {draft.authenticate && (
              <>
                <SettingRow label={<T k="emailProfile.username" />} required>
                  <input
                    value={draft.username}
                    onChange={(event) => set('username', event.target.value)}
                    autoComplete="off"
                    aria-label={t('emailProfile.username')}
                    className={CONTROL}
                  />
                </SettingRow>

                <SettingRow
                  label={<T k="emailProfile.password" />}
                  hint={<T k="emailProfile.password.hint" />}
                  required={creating}
                >
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    aria-label={t('emailProfile.password')}
                    placeholder={
                      current?.passwordSet === true ? t('emailProfile.password.stored') : ''
                    }
                    className={CONTROL}
                  />
                </SettingRow>
              </>
            )}
            </SettingsGroup>
          </SettingsStack>

          <PanelActions
            hint={creating ? <T k="emailProfile.saveFirst" /> : undefined}
          >
            <Button onClick={() => void submit()} disabled={busy || !complete}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Save className="size-4" aria-hidden />
              )}
              <T k={creating ? 'emailProfile.action.create' : 'emailProfile.action.save'} />
            </Button>
          </PanelActions>

          {/*
            Only for a saved profile. Testing a draft would mean sending through values
            the server does not hold, so a pass would prove nothing about what is stored.
          */}
          {current && (
            <SettingsStack>
              <SettingsGroup
                title={<T k="emailProfile.group.test" />}
                icon={<Send className="size-3.5" aria-hidden />}
                subtitle={<T k="emailProfile.group.test.subtitle" />}
              >
                <SettingRow label={<T k="emailProfile.test.lastResult" />}>
                  {current.lastTestAt === null ? (
                    <p className="text-sm text-slate-500">
                      <T k="emailProfile.test.never" />
                    </p>
                  ) : (
                    <div className="space-y-1">
                      <p className="flex items-center gap-2 text-sm">
                        {current.lastTestOk === true ? (
                          <Badge tone="success">
                            <CircleCheck className="size-3" aria-hidden />
                            <T k="emailProfile.test.ok" />
                          </Badge>
                        ) : (
                          <Badge tone="danger">
                            <CircleX className="size-3" aria-hidden />
                            <T k="emailProfile.test.bad" />
                          </Badge>
                        )}
                        <span className="text-xs text-slate-500">
                          {formatDateTime(current.lastTestAt)}
                        </span>
                      </p>
                      {current.lastTestDetail !== null && (
                        <p
                          className={cn(
                            'text-xs',
                            current.lastTestOk === true ? 'text-slate-600' : 'text-rose-700',
                          )}
                        >
                          {current.lastTestDetail}
                        </p>
                      )}
                    </div>
                  )}
                </SettingRow>

                <SettingRow
                  label={<T k="emailProfile.test.recipient" />}
                  hint={
                    <T
                      k="emailProfile.test.recipient.hint"
                      vars={{ address: current.fromEmail }}
                    />
                  }
                >
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="email"
                      value={recipient}
                      onChange={(event) => setRecipient(event.target.value)}
                      placeholder={current.fromEmail}
                      aria-label={t('emailProfile.test.recipient.aria')}
                      className={cn(CONTROL, 'min-w-56 flex-1')}
                    />
                    <Button
                      variant="ghost"
                      onClick={() => void runTest()}
                      disabled={testing || !current.active}
                    >
                      {testing ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <Send className="size-4" aria-hidden />
                      )}
                      <T k="emailProfile.test.submit" />
                    </Button>
                  </div>
                </SettingRow>

                <div className="my-2 space-y-2">
                  {!current.active && (
                    <PanelNote
                      tone="warn"
                      icon={<TriangleAlert className="size-3.5" aria-hidden />}
                    >
                      <T k="emailProfile.test.inactive" />
                    </PanelNote>
                  )}

                  {draft.authenticate && current.passwordSet && (
                    <PanelNote icon={<ShieldCheck className="size-3.5" aria-hidden />}>
                      <T
                        k="emailProfile.test.usesStored"
                        vars={{
                          emphasis: (
                            <strong className="font-medium">
                              <T k="emailProfile.test.usesStored.emphasis" />
                            </strong>
                          ),
                        }}
                      />
                    </PanelNote>
                  )}
                </div>
              </SettingsGroup>
            </SettingsStack>
          )}
        </>
      )}

      {confirming && current && (
        <Dialog
          title={<T k="emailProfile.remove.title" vars={{ name: current.name }} />}
          titleText={t('emailProfile.remove.title', { name: current.name })}
          description={<T k="emailProfile.remove.description" vars={{ key: current.key }} />}
          onClose={() => setConfirming(false)}
        >
          <div className="space-y-3">
            <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T
                k="emailProfile.remove.body"
                vars={{ key: <code className="font-mono">{current.key}</code> }}
              />
            </PanelNote>
            <DialogFooter
              onClose={() => setConfirming(false)}
              onSubmit={() => void remove()}
              busy={busy}
              submitLabel={<T k="emailProfile.remove.submit" />}
            />
          </div>
        </Dialog>
      )}
    </>
  );
}
