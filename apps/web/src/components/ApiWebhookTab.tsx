import {
  Gauge,
  Globe,
  Loader2,
  Lock,
  Plug,
  Route,
  Save,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { apiAdminApi, type ApiConfig, type SecurityConfig } from '../lib/settings-api';
import { T, useLabels } from '../lib/translation';
import { ApiTokenList, TokenPolicyNote } from './ApiTokenList';
import { CONTROL, ChannelHint, ChannelSwitch, SettingRow, Switch } from './ChannelForm';
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
import { WebhookList } from './WebhookList';

/**
 * The public API and its webhooks.
 *
 * Everything on this screen widens what can be reached from outside the application, so
 * each control states its consequence rather than leaving it to be discovered. The
 * combination that matters is enabled, no token required and no address filter — the whole
 * staff directory available to anything that can route to the port — and the server refuses
 * to save it rather than warning about it after the fact.
 */
export function ApiWebhookTab(): ReactNode {
  const { can } = useAuth();
  const { t } = useLabels();
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [security, setSecurity] = useState<SecurityConfig | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [requireToken, setRequireToken] = useState(true);
  const [logRequests, setLogRequests] = useState(true);
  const [allowAllOrigins, setAllowAllOrigins] = useState(false);
  const [origins, setOrigins] = useState('');
  const [rateLimitEnabled, setRateLimitEnabled] = useState(true);
  const [maxPerMinute, setMaxPerMinute] = useState('120');
  const [whitelist, setWhitelist] = useState('');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const current = await apiAdminApi.config();
      setConfig(current);
      setEnabled(current.enabled);
      setRequireToken(current.requireToken);
      setLogRequests(current.logRequests);
      setAllowAllOrigins(current.allowAllOrigins);
      setOrigins(current.allowedOrigins.join('\n'));
      setRateLimitEnabled(current.rateLimitEnabled);
      setMaxPerMinute(String(current.maxPerMinute));
      setWhitelist(current.ipWhitelist.join('\n'));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('api.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Only for the grace-window figure quoted beside the token list. Failing quietly is
  // right here: the tab is about the API, not about the policy.
  useEffect(() => {
    if (!can('settings.security', 'view')) return;
    apiAdminApi
      .security()
      .then(setSecurity)
      .catch(() => setSecurity(null));
  }, [can]);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiAdminApi.saveConfig({
        enabled,
        requireToken,
        logRequests,
        allowAllOrigins,
        allowedOrigins: lines(origins),
        rateLimitEnabled,
        maxPerMinute: Number(maxPerMinute),
        ipWhitelist: lines(whitelist),
      });
      setNotice(t(enabled ? 'api.notice.saved.on' : 'api.notice.saved.off'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
    } finally {
      setBusy(false);
    }
  }

  if (loading && config === null) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('app.loading')} />
      </div>
    );
  }

  const wideOpen = enabled && !requireToken && lines(whitelist).length === 0;
  const editable = can('settings.integration.api', 'edit');

  return (
    <>
      <PanelSection
        icon={<Plug className="size-4" aria-hidden />}
        title={<T k="integration.tab.api" />}
        subtitle={<T k="api.subtitle" />}
        action={
          editable ? (
            <ChannelSwitch enabled={enabled} onChange={setEnabled} />
          ) : (
            <span
              className={cn('text-xs font-medium', enabled ? 'text-emerald-700' : 'text-slate-500')}
            >
              <T k={enabled ? 'api.state.on' : 'api.state.off'} />
            </span>
          )
        }
      />

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <SettingsStack>
        {wideOpen && (
          <PanelNote tone="danger" icon={<ShieldAlert className="size-3.5" aria-hidden />}>
            <T
              k="api.wideOpen"
              vars={{
                emphasis: (
                  <strong className="font-medium">
                    <T k="api.wideOpen.emphasis" />
                  </strong>
                ),
              }}
            />
          </PanelNote>
        )}

        <SettingsGroup
          title={<T k="api.access.group" />}
          icon={<ShieldCheck className="size-3.5" aria-hidden />}
          action={
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
                enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600',
              )}
            >
              <T k={enabled ? 'api.access.answering' : 'api.access.silent'} />
            </span>
          }
        >
          <ChannelHint>
            <T
              k="api.access.note"
              vars={{
                code: (
                  <strong className="font-medium">
                    <T k="api.access.silent" />
                  </strong>
                ),
              }}
            />
          </ChannelHint>

          <SettingRow
            label={<T k="api.requireToken" />}
            hint={<T k="api.requireToken.hint" />}
          >
            <Switch
              checked={requireToken}
              onChange={setRequireToken}
              label={t('api.requireToken.switch')}
              disabled={!editable}
            />
          </SettingRow>

          <SettingRow label={<T k="api.logRequests" />} hint={<T k="api.logRequests.hint" />}>
            <Switch
              checked={logRequests}
              onChange={setLogRequests}
              label={t('api.logRequests.switch')}
              disabled={!editable}
            />
          </SettingRow>

          <SettingRow label={<T k="api.baseUrl" />} hint={<T k="api.baseUrl.hint" />}>
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-600">
              {config?.baseUrl}
            </p>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="api.endpoints.group" />}
          icon={<Route className="size-3.5" aria-hidden />}
          subtitle={<T k="api.endpoints.subtitle" />}
          action={
            <span className="text-[11px] text-slate-400">
              <T
                k="api.endpoints.count"
                vars={{ count: (config?.endpoints ?? []).length }}
              />
            </span>
          }
        >
          <ul className="my-1.5 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
            {(config?.endpoints ?? []).map((endpoint) => (
              <li
                key={endpoint.path}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2"
              >
                <span className="w-12 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-center text-[10px] font-semibold text-slate-600">
                  {endpoint.method}
                </span>
                <span className="font-mono text-xs text-slate-700">{endpoint.path}</span>
                {/*
                  A literal scope name stays in the mono face — it is a value somebody
                  copies. The one endpoint whose requirement is a sentence resolves through
                  the registry instead, so it is not set in mono either.
                */}
                {endpoint.scopeKey === undefined ? (
                  <span className="ml-auto font-mono text-[11px] text-slate-400">
                    {endpoint.scope}
                  </span>
                ) : (
                  <span className="ml-auto text-[11px] text-slate-400">
                    <T k={endpoint.scopeKey} />
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mb-2 text-xs text-slate-500">
            <T k="api.endpoints.privacy" />
          </p>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="api.rate.group" />}
          icon={<Gauge className="size-3.5" aria-hidden />}
          subtitle={<T k="api.rate.subtitle" />}
          action={
            <span className="text-[11px] text-slate-400 tabular-nums">
              {rateLimitEnabled
                ? t('api.rate.summary.limited', { count: maxPerMinute })
                : t('api.rate.summary.unlimited')}
              {lines(whitelist).length > 0 &&
                t('api.rate.summary.whitelist', { count: lines(whitelist).length })}
            </span>
          }
        >
          <SettingRow label={<T k="api.rate.enable" />}>
            <Switch
              checked={rateLimitEnabled}
              onChange={setRateLimitEnabled}
              label={t('api.rate.enable')}
              disabled={!editable}
            />
          </SettingRow>

          <SettingRow
            label={<T k="api.rate.perMinute" />}
            hint={<T k="api.rate.perMinute.hint" />}
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={100000}
                value={maxPerMinute}
                onChange={(event) => setMaxPerMinute(event.target.value)}
                disabled={!rateLimitEnabled || !editable}
                aria-label={t('api.rate.perMinute')}
                className={cn(CONTROL, 'max-w-28 disabled:bg-slate-50 disabled:text-slate-400')}
              />
              <span className="text-sm text-slate-500">
                <T k="api.rate.perMinute.unit" />
              </span>
            </div>
          </SettingRow>

          <SettingRow label={<T k="api.whitelist" />} hint={<T k="api.whitelist.hint" />}>
            <textarea
              value={whitelist}
              onChange={(event) => setWhitelist(event.target.value)}
              rows={3}
              disabled={!editable}
              placeholder={'10.20.0.0/16\n192.168.1.50'}
              aria-label={t('api.whitelist')}
              className={cn(CONTROL, 'font-mono disabled:bg-slate-50')}
            />
            <p className="mt-1 text-xs text-slate-500">
              {lines(whitelist).length === 0 ? (
                <T k="api.whitelist.empty" />
              ) : (
                <T k="api.whitelist.count" vars={{ count: lines(whitelist).length }} />
              )}
            </p>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="api.cors.group" />}
          icon={<Globe className="size-3.5" aria-hidden />}
          subtitle={<T k="api.cors.subtitle" />}
          action={
            <span className="text-[11px] text-slate-400">
              {allowAllOrigins
                ? t('api.cors.summary.all')
                : t('api.cors.summary.listed', { count: lines(origins).length })}
            </span>
          }
        >
          {/*
            Said plainly because it is the most commonly misread control on a screen like
            this: relaxing CORS does not open the API, and tightening it does not protect it.
          */}
          <PanelNote
            tone="warn"
            icon={<TriangleAlert className="size-3.5" aria-hidden />}
            className="mt-1.5 mb-1"
          >
            <T
              k="api.cors.note"
              vars={{
                browser: (
                  <strong className="font-medium">
                    <T k="api.cors.note.browser" />
                  </strong>
                ),
                notAccessControl: (
                  <strong className="font-medium">
                    <T k="api.cors.note.notAccessControl" />
                  </strong>
                ),
              }}
            />
          </PanelNote>

          <SettingRow
            label={<T k="api.cors.allowAll" />}
            hint={<T k="api.cors.allowAll.hint" />}
          >
            <Switch
              checked={allowAllOrigins}
              onChange={setAllowAllOrigins}
              label={t('api.cors.allowAll')}
              disabled={!editable}
            />
          </SettingRow>

          <SettingRow
            label={<T k="api.cors.origins" />}
            hint={<T k="api.cors.origins.hint" />}
          >
            <textarea
              value={origins}
              onChange={(event) => setOrigins(event.target.value)}
              rows={3}
              disabled={allowAllOrigins || !editable}
              placeholder={'https://portal.hospital.local\nhttps://hr.hospital.local'}
              aria-label={t('api.cors.origins')}
              className={cn(CONTROL, 'font-mono disabled:bg-slate-50 disabled:text-slate-400')}
            />
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="api.install.group" />}
          icon={<Lock className="size-3.5" aria-hidden />}
        >
          <SettingRow
            label={<T k="api.install.mode" />}
            hint={<T k="api.install.mode.hint" />}
          >
            <p className="text-sm text-slate-600">
              {/* The mode name is the stored value, so it stays as it is. */}
              <strong className="font-medium">{config?.connectorMode}</strong>
              {config?.connectorMode === 'direct' && (
                <span className="mt-0.5 block text-xs text-slate-500">
                  <T k="api.install.mode.lanNote" />
                </span>
              )}
            </p>
          </SettingRow>
        </SettingsGroup>
      </SettingsStack>

      {editable && (
        <PanelActions
          hint={<T k={enabled ? 'api.save.hint.on' : 'api.save.hint.off'} />}
        >
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            <T k="api.save" />
          </Button>
        </PanelActions>
      )}

      {/* Tokens and webhooks own their own loading and feedback: they talk to their own
          endpoints rather than to the configuration above. Both stay full-bleed, because
          they are tables and their cells carry the padding. */}
      <ApiTokenList />

      <PanelBody className="pt-0">
        <TokenPolicyNote graceHours={security?.policy.rotationGraceHours ?? 24} />
      </PanelBody>

      <WebhookList />
    </>
  );
}

/** One entry per line, blanks dropped. Paste-friendly, which a chip input is not. */
function lines(value: string): string[] {
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
