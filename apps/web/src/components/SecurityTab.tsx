import {
  Activity,
  KeyRound,
  Loader2,
  Lock,
  RotateCcw,
  Save,
  Server,
  ShieldCheck,
  TriangleAlert,
  UserX,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { apiAdminApi, type SecurityConfig, type SecurityPolicy } from '../lib/settings-api';
import { T, useLabels } from '../lib/translation';
import { CONTROL, ChannelHint, SettingRow } from './ChannelForm';
import { Feedback } from './Dialog';
import {
  KeyValue,
  KeyValueList,
  PanelActions,
  PanelBody,
  PanelNote,
  PanelSection,
  SettingsGroup,
  SettingsStack,
} from './RecordPanel';
import { Button } from './ui';

/**
 * Authentication policy and the live security posture.
 *
 * Every control here is one the server actually reads. The fixtures that are decided at
 * deploy time — whether administrators must use a second factor, how long a session lasts —
 * are shown but not editable: they are read once at boot, so a switch for them would be a
 * control that silently does nothing, which is worse than no control at all.
 *
 * Separate from the API tab on purpose. Deciding the lockout policy and deciding who may
 * mint API tokens are different jobs, and they are held by different people.
 */
export function SecurityTab(): ReactNode {
  const { can } = useAuth();
  const { t } = useLabels();
  const [data, setData] = useState<SecurityConfig | null>(null);
  const [form, setForm] = useState<SecurityPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const current = await apiAdminApi.security();
      setData(current);
      setForm(current.policy);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('security.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(): Promise<void> {
    if (form === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiAdminApi.saveSecurity(form);
      setNotice(t('security.saved'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
    } finally {
      setBusy(false);
    }
  }

  if (loading && data === null) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('app.loading')} />
      </div>
    );
  }

  if (data === null || form === null) {
    return (
      <PanelBody>
        <Feedback error={error} />
      </PanelBody>
    );
  }

  const editable = can('settings.security', 'edit');
  const changed = JSON.stringify(form) !== JSON.stringify(data.policy);

  function set<K extends keyof SecurityPolicy>(key: K, value: string): void {
    setForm((current) => (current === null ? current : { ...current, [key]: Number(value) }));
  }

  return (
    <>
      <PanelSection
        icon={<ShieldCheck className="size-4" aria-hidden />}
        title={<T k="security.title" />}
        subtitle={<T k="security.subtitle" />}
        action={
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
            {data.environment.nodeEnv}
          </span>
        }
      />

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <SettingsStack>
        {/* Worth opening even when nothing is being changed, which a screen of switches
            alone is not. */}
        <SettingsGroup
          title={<T k="security.group.posture" />}
          icon={<Activity className="size-3.5" aria-hidden />}
          subtitle={<T k="security.group.posture.subtitle" />}
        >
          <div className="my-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Posture
              label={<T k="security.posture.locked" />}
              value={data.posture.lockedAccounts}
              icon={<UserX className="size-3.5" aria-hidden />}
              tone={data.posture.lockedAccounts > 0 ? 'warn' : 'calm'}
            />
            <Posture
              label={<T k="security.posture.failed" />}
              value={data.posture.failedLoginsLastDay}
              icon={<Lock className="size-3.5" aria-hidden />}
              tone={data.posture.failedLoginsLastDay > 20 ? 'warn' : 'calm'}
            />
            <Posture
              label={<T k="security.posture.tokens" />}
              value={data.posture.activeTokens}
              icon={<KeyRound className="size-3.5" aria-hidden />}
              tone="calm"
            />
            <Posture
              label={<T k="security.posture.expiring" />}
              value={data.posture.tokensExpiringSoon}
              icon={<RotateCcw className="size-3.5" aria-hidden />}
              tone={data.posture.tokensExpiringSoon > 0 ? 'warn' : 'calm'}
            />
            <Posture
              label={<T k="security.posture.webhooks" />}
              value={data.posture.webhooksFailing}
              icon={<TriangleAlert className="size-3.5" aria-hidden />}
              tone={data.posture.webhooksFailing > 0 ? 'danger' : 'calm'}
            />
          </div>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="security.group.login" />}
          icon={<Lock className="size-3.5" aria-hidden />}
          subtitle={<T k="security.group.login.subtitle" />}
          action={
            <span className="text-[11px] text-slate-400 tabular-nums">
              <T
                k="security.group.login.summary"
                vars={{
                  attempts: form.maxFailedLogins,
                  minutes: form.lockoutMinutes,
                  characters: form.passwordMinLength,
                }}
              />
            </span>
          }
        >
          <ChannelHint>
            <T k="security.group.login.hint" />
          </ChannelHint>

          <SettingRow
            label={<T k="security.maxFailedLogins" />}
            hint={<T k="security.maxFailedLogins.hint" />}
          >
            <NumberInput
              value={form.maxFailedLogins}
              min={3}
              max={50}
              unit={t('security.unit.attempts')}
              disabled={!editable}
              onChange={(value) => set('maxFailedLogins', value)}
              fallback={data.defaults.maxFailedLogins}
            />
          </SettingRow>

          <SettingRow
            label={<T k="security.lockoutMinutes" />}
            hint={<T k="security.lockoutMinutes.hint" />}
          >
            <NumberInput
              value={form.lockoutMinutes}
              min={1}
              max={1440}
              unit={t('security.unit.minutes')}
              disabled={!editable}
              onChange={(value) => set('lockoutMinutes', value)}
              fallback={data.defaults.lockoutMinutes}
            />
          </SettingRow>

          <SettingRow
            label={<T k="security.passwordMinLength" />}
            hint={<T k="security.passwordMinLength.hint" />}
          >
            <NumberInput
              value={form.passwordMinLength}
              min={8}
              max={128}
              unit={t('security.unit.characters')}
              disabled={!editable}
              onChange={(value) => set('passwordMinLength', value)}
              fallback={data.defaults.passwordMinLength}
            />
          </SettingRow>

          <PanelNote className="my-2">
            <T k="security.passwordMinLength.note" />
          </PanelNote>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="security.group.tokens" />}
          icon={<KeyRound className="size-3.5" aria-hidden />}
          subtitle={<T k="security.group.tokens.subtitle" />}
          action={
            <span className="text-[11px] text-slate-400 tabular-nums">
              <T
                k="security.group.tokens.summary"
                vars={{
                  validity:
                    form.tokenDefaultDays === 0
                      ? t('security.noExpiry')
                      : t('security.validity.days', { count: form.tokenDefaultDays }),
                  grace: form.rotationGraceHours,
                }}
              />
            </span>
          }
        >
          <SettingRow
            label={<T k="security.tokenDefaultDays" />}
            hint={<T k="security.tokenDefaultDays.hint" />}
          >
            <NumberInput
              value={form.tokenDefaultDays}
              min={0}
              max={3650}
              unit={
                form.tokenDefaultDays === 0
                  ? t('security.unit.daysNoExpiry')
                  : t('security.unit.days')
              }
              disabled={!editable}
              onChange={(value) => set('tokenDefaultDays', value)}
              fallback={data.defaults.tokenDefaultDays}
            />
          </SettingRow>

          <SettingRow
            label={<T k="security.rotationGraceHours" />}
            hint={<T k="security.rotationGraceHours.hint" />}
          >
            <NumberInput
              value={form.rotationGraceHours}
              min={1}
              max={720}
              unit={t('security.unit.hours')}
              disabled={!editable}
              onChange={(value) => set('rotationGraceHours', value)}
              fallback={data.defaults.rotationGraceHours}
            />
          </SettingRow>

          <PanelNote
            tone="warn"
            icon={<TriangleAlert className="size-3.5" aria-hidden />}
            className="my-2"
          >
            <T
              k="security.rotation.note"
              vars={{
                emphasis: (
                  <strong className="font-medium">
                    <T k="security.rotation.note.emphasis" />
                  </strong>
                ),
              }}
            />
          </PanelNote>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="security.group.env" />}
          icon={<Server className="size-3.5" aria-hidden />}
          subtitle={<T k="security.group.env.subtitle" />}
        >
          <div className="my-2 space-y-3">
            <KeyValueList>
              <KeyValue
                label={<T k="security.env.require2fa" />}
                value={
                  <span
                    className={
                      data.environment.requireAdmin2fa ? 'text-emerald-700' : 'text-rose-700'
                    }
                  >
                    <T k={data.environment.requireAdmin2fa ? 'security.env.yes' : 'security.env.no'} />
                  </span>
                }
              />
              <KeyValue
                label={<T k="security.env.sessionTtl" />}
                value={
                  <T
                    k="security.env.sessionTtl.value"
                    vars={{ hours: data.environment.sessionTtlHours }}
                  />
                }
              />
              <KeyValue
                label={<T k="security.env.connectorMode" />}
                value={data.environment.connectorMode}
              />
              <KeyValue label={<T k="security.env.nodeEnv" />} value={data.environment.nodeEnv} />
            </KeyValueList>

            {/*
              A switch here would be a lie: these are read once at boot, so flipping a
              database row would leave the screen disagreeing with the running server.
            */}
            <PanelNote>
              <T
                k="security.env.note"
                vars={{ envFile: <code className="font-mono text-[11px]">.env</code> }}
              />
            </PanelNote>

            {!data.environment.requireAdmin2fa && (
              <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                <T
                  k="security.env.no2fa"
                  vars={{
                    emphasis: (
                      <strong className="font-medium">
                        <T k="security.env.no2fa.emphasis" />
                      </strong>
                    ),
                  }}
                />
              </PanelNote>
            )}
          </div>
        </SettingsGroup>
      </SettingsStack>

      {editable && (
        <PanelActions
          hint={changed ? <T k="security.dirty" /> : <T k="security.clean" />}
        >
          <Button onClick={() => void save()} disabled={busy || !changed}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            <T k="security.action.save" />
          </Button>
          <Button variant="ghost" onClick={() => setForm(data.defaults)} disabled={busy}>
            <RotateCcw className="size-4" aria-hidden />
            <T k="security.action.reset" />
          </Button>
        </PanelActions>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function NumberInput({
  value,
  min,
  max,
  unit,
  disabled,
  onChange,
  fallback,
}: {
  value: number;
  min: number;
  max: number;
  unit: string;
  disabled: boolean;
  onChange: (value: string) => void;
  /** The shipped default, stated so a changed value can be judged against it. */
  fallback: number;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="number"
        min={min}
        max={max}
        value={String(value)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-label={unit}
        className={cn(CONTROL, 'max-w-24 disabled:bg-slate-50 disabled:text-slate-500')}
      />
      <span className="text-sm text-slate-500">{unit}</span>
      {value !== fallback && (
        <span className="text-[11px] text-slate-400">
          <T k="security.default" vars={{ value: fallback }} />
        </span>
      )}
    </div>
  );
}

function Posture({
  label,
  value,
  icon,
  tone,
}: {
  /** A node so it can carry the label number badge, like every other widened prop. */
  label: ReactNode;
  value: number;
  icon: ReactNode;
  tone: 'calm' | 'warn' | 'danger';
}): ReactNode {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2',
        tone === 'calm' && 'border-slate-200 bg-slate-50',
        tone === 'warn' && 'border-amber-300 bg-amber-50',
        tone === 'danger' && 'border-rose-300 bg-rose-50',
      )}
    >
      <p
        className={cn(
          'flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase',
          tone === 'calm' && 'text-slate-500',
          tone === 'warn' && 'text-amber-800',
          tone === 'danger' && 'text-rose-800',
        )}
      >
        {icon}
        {label}
      </p>
      <p
        className={cn(
          'mt-0.5 text-xl font-semibold tabular-nums',
          tone === 'calm' && 'text-slate-800',
          tone === 'warn' && 'text-amber-900',
          tone === 'danger' && 'text-rose-900',
        )}
      >
        {new Intl.NumberFormat('ms-MY').format(value)}
      </p>
    </div>
  );
}
