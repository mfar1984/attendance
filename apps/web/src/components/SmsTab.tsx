import { Bell, KeyRound, Loader2, MessageSquare, Save, Send } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { cn } from '../lib/cn';
import {
  channelsApi,
  countSmsSegments,
  type NotificationTrigger,
  type SmsConfig,
} from '../lib/settings-api';
import { T, useLabels } from '../lib/translation';
import {
  CONTROL,
  ChannelHint,
  ChannelSwitch,
  LastTestResult,
  SettingRow,
  TriggerToggles,
} from './ChannelForm';
import { Feedback } from './Dialog';
import {
  PanelActions,
  PanelBody,
  PanelNote,
  PanelSection,
  SettingsGroup,
  SettingsStack,
} from './RecordPanel';
import { Button } from './ui';

/**
 * SMS through Infobip.
 *
 * One gateway rather than several: the sender is a registered short code and Infobip bills
 * per account, so there is nothing to gain from more than one.
 *
 * The test sends a real message, which costs real money. That is stated on the button
 * rather than discovered from an invoice.
 */
export function SmsTab(): ReactNode {
  const [config, setConfig] = useState<SmsConfig | null>(null);
  const [triggers, setTriggers] = useState<NotificationTrigger[]>([]);

  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [senderId, setSenderId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const [to, setTo] = useState('');
  const { t } = useLabels();
  /*
   * Seeded from the registry rather than a literal, so the sample message follows the reader's
   * language. Initialised once: re-seeding on every render would overwrite whatever the operator
   * had typed the moment the dictionary loaded.
   */
  const [text, setText] = useState(() => t('sms.test.default'));

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [current, registry] = await Promise.all([channelsApi.sms(), channelsApi.triggers()]);
      setConfig(current);
      setTriggers(registry.triggers);
      setEnabled(current.enabled);
      setBaseUrl(current.baseUrl);
      setSenderId(current.senderId);
      setSelected(current.triggers);
      setApiKey('');
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('sms.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await channelsApi.saveSms({
        enabled,
        baseUrl: baseUrl.trim(),
        senderId: senderId.trim(),
        ...(apiKey.length > 0 ? { apiKey } : {}),
        triggers: selected,
      });
      setNotice(t('sms.saved'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
    } finally {
      setBusy(false);
    }
  }

  /** Clears the stored key, which also forces the channel off. */
  async function clearKey(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await channelsApi.saveSms({
        enabled: false,
        baseUrl: baseUrl.trim(),
        senderId: senderId.trim(),
        clearApiKey: true,
        triggers: selected,
      });
      setEnabled(false);
      setNotice(t('sms.cleared'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('sms.error.clear'));
    } finally {
      setBusy(false);
    }
  }

  async function runTest(): Promise<void> {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await channelsApi.testSms(to.trim(), text.trim());
      // The gateway's own wording when it has one: it names what to change, which a generic
      // message cannot. The registry line is only the fallback.
      if (result.ok) setNotice(result.lastTestDetail ?? t('sms.test.sent'));
      else setError(result.lastTestDetail ?? t('sms.test.failed'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('sms.error.test'));
    } finally {
      setTesting(false);
    }
  }

  const count = countSmsSegments(text);
  const limit = count.unicode ? 70 : 160;

  if (loading && config === null) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('app.loading')} />
      </div>
    );
  }

  return (
    <>
      <PanelSection
        icon={<MessageSquare className="size-4" aria-hidden />}
        title={<T k="sms.title" />}
        subtitle={<T k="sms.subtitle" />}
        action={<ChannelSwitch enabled={enabled} onChange={setEnabled} />}
      />

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <SettingsStack>
        <SettingsGroup
          title={<T k="sms.group.credentials" />}
          icon={<KeyRound className="size-3.5" aria-hidden />}
          action={
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
                config?.apiKeySet === true
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-slate-100 text-slate-600',
              )}
            >
              <T k={config?.apiKeySet === true ? 'sms.keySet' : 'sms.keyMissing'} />
            </span>
          }
        >
          <ChannelHint>
            {/*
              The scope and the wrong host arrive as nodes rather than as three labels.
              Splitting the sentence would assume the same word order in every language, and the
              `<code>` runs are exactly the parts that must not move relative to the prose.
            */}
            <T
              k="sms.hint"
              vars={{
                scope: <code className="font-mono text-[11px]">sms:message:send</code>,
                wrongHost: <code className="font-mono text-[11px]">api.infobip.com</code>,
              }}
            />
          </ChannelHint>

          <div>
            <SettingRow
              label={<T k="sms.apiKey" />}
              hint={<T k="sms.apiKey.hint" />}
              required
            >
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
                aria-label={t('sms.apiKey.aria')}
                placeholder={config?.apiKeySet === true ? t('sms.apiKey.stored') : ''}
                className={CONTROL}
              />
              {/* The only way out. Blank means keep, so without this a decommissioned
                  gateway's key would stay in the database indefinitely. */}
              {config?.apiKeySet === true && apiKey.length === 0 && (
                <button
                  type="button"
                  onClick={() => void clearKey()}
                  disabled={busy}
                  className="mt-1.5 text-xs font-medium text-rose-700 hover:underline disabled:opacity-50"
                >
                  <T k="sms.apiKey.clear" />
                </button>
              )}
            </SettingRow>

            <SettingRow label={<T k="sms.baseUrl" />} hint={<T k="sms.baseUrl.hint" />} required>
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="xyz123.api.infobip.com"
                aria-label={t('sms.baseUrl')}
                className={cn(CONTROL, 'font-mono')}
              />
            </SettingRow>

            <SettingRow label={<T k="sms.senderId" />} hint={<T k="sms.senderId.hint" />} required>
              <input
                value={senderId}
                onChange={(event) => setSenderId(event.target.value)}
                placeholder="ServiceSMS"
                aria-label={t('sms.senderId')}
                className={cn(CONTROL, 'max-w-48 font-mono')}
              />
            </SettingRow>
          </div>

          {/*
            A registered sender is the difference between a message that arrives and one the
            API accepts and the carrier drops, which produces no error anywhere.
          */}
          <PanelNote className="my-2">
            <T k="sms.senderId.note" />
          </PanelNote>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="sms.group.triggers" />}
          icon={<Bell className="size-3.5" aria-hidden />}
          subtitle={<T k="sms.group.triggers.subtitle" />}
          action={
            <span className="text-[11px] text-slate-400">
              <T k="sms.triggers.count" vars={{ count: selected.length }} />
            </span>
          }
        >
          <TriggerToggles triggers={triggers} selected={selected} onChange={setSelected} />
        </SettingsGroup>
      </SettingsStack>

      <PanelActions hint={enabled ? undefined : <T k="sms.disabled.hint" />}>
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Save className="size-4" aria-hidden />
          )}
          <T k="sms.action.save" />
        </Button>
      </PanelActions>

      <SettingsStack>
        <SettingsGroup
          title={<T k="sms.group.test" />}
          icon={<Send className="size-3.5" aria-hidden />}
          subtitle={<T k="sms.group.test.subtitle" />}
          action={
            <span className="text-[11px] text-slate-400">
              <T k="sms.test.usesStored" />
            </span>
          }
        >
          <SettingRow label={<T k="sms.test.lastResult" />}>
            <LastTestResult
              at={config?.lastTestAt ?? null}
              ok={config?.lastTestOk ?? null}
              detail={config?.lastTestDetail ?? null}
            />
          </SettingRow>

          <SettingRow
            label={<T k="sms.test.phone" />}
            hint={<T k="sms.test.phone.hint" />}
            required
          >
            <input
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="+60123456789"
              aria-label={t('sms.test.phone.aria')}
              className={cn(CONTROL, 'max-w-64 font-mono')}
            />
          </SettingRow>

          <SettingRow label={<T k="sms.test.message" />} required>
            <div className="space-y-1.5">
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={3}
                aria-label={t('sms.test.message.aria')}
                className={cn(CONTROL, 'resize-y')}
              />
              {/*
                Segments, not characters. One accented character drops the limit from 160 to
                70 and turns a single message into three — which is a tripled bill, not an
                error, so it has to be visible while typing.
              */}
              <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="tabular-nums">
                  <T k="sms.segments.characters" vars={{ count: count.length, limit }} />
                </span>
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 font-medium tabular-nums',
                    count.segments > 1
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-slate-100 text-slate-600',
                  )}
                >
                  <T k="sms.segments.billed" vars={{ count: count.segments }} />
                </span>
                {count.unicode && (
                  <span className="text-amber-700">
                    <T k="sms.segments.unicode" />
                  </span>
                )}
              </p>
            </div>
          </SettingRow>

          <div className="my-2 flex flex-wrap items-center gap-3">
            <Button
              variant="ghost"
              onClick={() => void runTest()}
              disabled={testing || !enabled || to.trim() === '' || text.trim() === ''}
            >
              {testing ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Send className="size-4" aria-hidden />
              )}
              <T k="sms.test.submit" />
            </Button>
            {!enabled && (
              <p className="flex items-center gap-1.5 text-xs text-amber-800">
                <MessageSquare className="size-3.5 shrink-0" aria-hidden />
                <T k="sms.test.mustEnable" />
              </p>
            )}
          </div>
        </SettingsGroup>
      </SettingsStack>
    </>
  );
}
