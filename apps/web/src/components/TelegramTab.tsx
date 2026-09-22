import { BadgeCheck, Bell, Bot, Loader2, Save, Send, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { cn } from '../lib/cn';
import {
  channelsApi,
  type NotificationTrigger,
  type TelegramConfig,
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
import { Badge, Button } from './ui';

/**
 * Telegram notifications through a bot.
 *
 * Verifying the token and posting to the channel are separate buttons, because they fail
 * for different reasons and that difference is the whole diagnosis: a token that verifies
 * but cannot post means the bot was never made an administrator of the channel, and no
 * amount of retyping the token fixes it.
 */
export function TelegramTab(): ReactNode {
  const [config, setConfig] = useState<TelegramConfig | null>(null);
  const [triggers, setTriggers] = useState<NotificationTrigger[]>([]);

  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [ownerUsername, setOwnerUsername] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { t } = useLabels();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [current, registry] = await Promise.all([
        channelsApi.telegram(),
        channelsApi.triggers(),
      ]);
      setConfig(current);
      setTriggers(registry.triggers);
      setEnabled(current.enabled);
      setChatId(current.chatId);
      setOwnerUserId(current.ownerUserId);
      setOwnerUsername(current.ownerUsername);
      setSelected(current.triggers);
      setBotToken('');
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('telegram.error.load'));
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
      const result = await channelsApi.saveTelegram({
        enabled,
        ...(botToken.length > 0 ? { botToken } : {}),
        chatId: chatId.trim(),
        ownerUserId: ownerUserId.trim(),
        ownerUsername: ownerUsername.trim(),
        triggers: selected,
      });
      setNotice(
        result.botUsername === null
          ? t('telegram.saved.unverified')
          : t('telegram.saved.withBot', { username: result.botUsername }),
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
    } finally {
      setBusy(false);
    }
  }

  /** Clears the stored token, which also forces the channel off. */
  async function clearToken(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await channelsApi.saveTelegram({
        enabled: false,
        clearBotToken: true,
        chatId: chatId.trim(),
        ownerUserId: ownerUserId.trim(),
        ownerUsername: ownerUsername.trim(),
        triggers: selected,
      });
      setEnabled(false);
      setNotice(t('telegram.cleared'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('telegram.error.clear'));
    } finally {
      setBusy(false);
    }
  }

  async function verify(): Promise<void> {
    setVerifying(true);
    setError(null);
    setNotice(null);
    try {
      const result = await channelsApi.verifyTelegram();
      if (result.ok && result.bot) {
        setNotice(
          t('telegram.verify.ok', {
            name:
              result.bot.firstName +
              (result.bot.username === null ? '' : ` (@${result.bot.username})`),
          }),
        );
      } else {
        setError(result.detail ?? t('telegram.verify.failed'));
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('telegram.error.verify'));
    } finally {
      setVerifying(false);
    }
  }

  async function runTest(): Promise<void> {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      // The server composes the message, so its wording cannot drift from what the
      // verification script asserts or from what a future client would send.
      const result = await channelsApi.testTelegram();
      if (result.ok) setNotice(result.lastTestDetail ?? t('telegram.test.sent'));
      else setError(result.lastTestDetail ?? t('telegram.test.failed'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('telegram.error.test'));
    } finally {
      setTesting(false);
    }
  }

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
        icon={<Send className="size-4" aria-hidden />}
        title={<T k="telegram.title" />}
        subtitle={<T k="telegram.subtitle" />}
        action={<ChannelSwitch enabled={enabled} onChange={setEnabled} />}
      />

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <SettingsStack>
        <SettingsGroup
          title={<T k="telegram.group.bot" />}
          icon={<Bot className="size-3.5" aria-hidden />}
          action={
            config?.botUsername !== null && config?.botUsername !== undefined ? (
              <Badge tone="success">
                <BadgeCheck className="size-3" aria-hidden />@{config.botUsername}
              </Badge>
            ) : (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600">
                <T k="telegram.unverified" />
              </span>
            )
          }
        >
          <ChannelHint>
            {/*
              One sentence with three nodes in it rather than four labels. The bot name and the
              two examples are the parts that must not move relative to the prose, and splitting
              them would assume the same word order in every language.
            */}
            <T
              k="telegram.hint"
              vars={{
                botFather: <strong className="font-medium">@BotFather</strong>,
                channelName: <code className="font-mono text-[11px]">@namachannel</code>,
                channelId: <code className="font-mono text-[11px]">-1001234567890</code>,
              }}
            />
          </ChannelHint>

          <SettingRow
            label={<T k="telegram.botToken" />}
            hint={<T k="telegram.botToken.hint" />}
            required
          >
            <input
              type="password"
              value={botToken}
              onChange={(event) => setBotToken(event.target.value)}
              autoComplete="off"
              aria-label={t('telegram.botToken')}
              placeholder={config?.botTokenSet === true ? t('telegram.botToken.stored') : ''}
              className={CONTROL}
            />
            {/* The only way out. Blank means keep, so without this a decommissioned bot's
                token would stay in the database indefinitely. */}
            {config?.botTokenSet === true && botToken.length === 0 && (
              <button
                type="button"
                onClick={() => void clearToken()}
                disabled={busy}
                className="mt-1.5 text-xs font-medium text-rose-700 hover:underline disabled:opacity-50"
              >
                <T k="telegram.botToken.clear" />
              </button>
            )}
          </SettingRow>

          {/*
            Read from Telegram rather than typed. A hand-entered username can disagree with
            the token, and the screen would then name a bot that is not the one posting.
          */}
          <SettingRow
            label={<T k="telegram.botUsername" />}
            hint={<T k="telegram.botUsername.hint" />}
          >
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-600">
              {config?.botUsername === null || config?.botUsername === undefined
                ? t('telegram.botUsername.none')
                : `@${config.botUsername}`}
            </p>
          </SettingRow>

          <SettingRow
            label={<T k="telegram.chatId" />}
            hint={<T k="telegram.chatId.hint" />}
            required
          >
            <input
              value={chatId}
              onChange={(event) => setChatId(event.target.value)}
              placeholder="@kehadiran_hospital atau -1001234567890"
              aria-label={t('telegram.chatId')}
              className={cn(CONTROL, 'font-mono')}
            />
          </SettingRow>

          <SettingRow
            label={<T k="telegram.ownerUserId" />}
            hint={<T k="telegram.ownerUserId.hint" />}
          >
            <input
              value={ownerUserId}
              onChange={(event) => setOwnerUserId(event.target.value.replace(/\D/g, ''))}
              placeholder="123456789"
              aria-label={t('telegram.ownerUserId')}
              className={cn(CONTROL, 'max-w-56 font-mono')}
            />
          </SettingRow>

          <SettingRow
            label={<T k="telegram.ownerUsername" />}
            hint={<T k="telegram.ownerUsername.hint" />}
          >
            <input
              value={ownerUsername}
              onChange={(event) => setOwnerUsername(event.target.value)}
              placeholder="@nama_admin"
              aria-label={t('telegram.ownerUsername')}
              className={cn(CONTROL, 'max-w-56 font-mono')}
            />
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="telegram.group.triggers" />}
          icon={<Bell className="size-3.5" aria-hidden />}
          subtitle={<T k="telegram.group.triggers.subtitle" />}
          action={
            <span className="text-[11px] text-slate-400">
              <T k="telegram.triggers.count" vars={{ count: selected.length }} />
            </span>
          }
        >
          <TriggerToggles triggers={triggers} selected={selected} onChange={setSelected} />
        </SettingsGroup>
      </SettingsStack>

      <PanelActions hint={enabled ? undefined : <T k="telegram.disabled.hint" />}>
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Save className="size-4" aria-hidden />
          )}
          <T k="telegram.action.save" />
        </Button>
      </PanelActions>

      <SettingsStack>
        <SettingsGroup
          title={<T k="telegram.group.test" />}
          icon={<BadgeCheck className="size-3.5" aria-hidden />}
          subtitle={<T k="telegram.group.test.subtitle" />}
        >
          <SettingRow label={<T k="telegram.test.lastResult" />}>
            <LastTestResult
              at={config?.lastTestAt ?? null}
              ok={config?.lastTestOk ?? null}
              detail={config?.lastTestDetail ?? null}
            />
          </SettingRow>

          <div className="my-2 flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => void verify()}
            disabled={verifying || config?.botTokenSet !== true}
          >
            {verifying ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <BadgeCheck className="size-4" aria-hidden />
            )}
            <T k="telegram.action.verify" />
          </Button>
          <Button
            variant="ghost"
            onClick={() => void runTest()}
            disabled={testing || !enabled || chatId.trim() === ''}
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
            <T k="telegram.action.send" />
          </Button>
        </div>

          <div className="my-2 space-y-2">
            {/*
              The two buttons answer different questions, and saying so is what stops somebody
              retyping a perfectly good token because the channel post failed.
            */}
            <PanelNote>
              <T
                k="telegram.test.note"
                vars={{
                  verify: (
                    <strong className="font-medium">
                      <T k="telegram.test.note.verify" />
                    </strong>
                  ),
                  send: (
                    <strong className="font-medium">
                      <T k="telegram.test.note.send" />
                    </strong>
                  ),
                }}
              />
            </PanelNote>

            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T
                k="telegram.test.usesStored"
                vars={{
                  emphasis: (
                    <strong className="font-medium">
                      <T k="telegram.test.usesStored.emphasis" />
                    </strong>
                  ),
                }}
              />
            </PanelNote>
          </div>
        </SettingsGroup>
      </SettingsStack>
    </>
  );
}
