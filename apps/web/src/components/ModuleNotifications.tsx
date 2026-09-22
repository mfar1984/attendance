import { Bell, Mail, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Feedback } from './Dialog';
import {
  PanelActions,
  PanelBody,
  PanelNote,
  PanelSection,
  SettingsGroup,
  SettingsStack,
} from './RecordPanel';
import { SelectControl, SettingRow, Switch } from './ChannelForm';
import { Button, Field } from './ui';
import { useAuth } from '../lib/auth';
import {
  hrApi,
  isOn,
  type NotifyModule,
  type ModuleSettings,
  type TemplatePayload,
} from '../lib/hr-api';
import { T, useLabels } from '../lib/translation';

/**
 * Who a request module tells about a decision, shared by every module.
 *
 * Only the timing lives here. The channels themselves — which relay, which SMS gateway,
 * which Telegram chat — are configured once under Tetapan › Integrasi, because a module that
 * carried its own SMTP settings would be a second place for the same credential to go stale.
 */
export function ModuleNotifications({
  module,
  screen,
}: {
  module: NotifyModule;
  screen: string;
}): ReactNode {
  const [settings, setSettings] = useState<ModuleSettings | null>(null);
  const [chainLength, setChainLength] = useState(0);
  const [profiles, setProfiles] = useState<TemplatePayload['profiles']>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const mayConfigure = can(screen, 'configure');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      /*
       * The profile list comes from the templates endpoint, which already returns it.
       * Fetching both together keeps the picker from painting with no options for a moment,
       * which reads as "none configured" rather than "still loading".
       */
      const [payload, templates] = await Promise.all([
        hrApi.settings(module),
        hrApi.templates(module),
      ]);
      setSettings(payload.settings);
      setChainLength(payload.chainLength);
      setProfiles(templates.profiles);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
    } finally {
      setLoading(false);
    }
  }, [module]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    if (settings === null) return;
    setBusy(true);
    try {
      const result = await hrApi.saveSettings(module, {
        emailProfileKey: settings.emailProfileKey,
        notifyApplicant: isOn(settings.notifyApplicant),
        notifyApprover: isOn(settings.notifyApprover),
        notifyEveryLevel: isOn(settings.notifyEveryLevel),
        ccEmail: settings.ccEmail,
      });
      setSettings(result.settings);
      setNotice(t('hr.notify.saved'));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
    } finally {
      setBusy(false);
    }
  };

  const set = (key: keyof ModuleSettings, value: string): void => {
    setSettings((current) => (current === null ? current : { ...current, [key]: value }));
  };

  /**
   * `Switch`, not a bare checkbox.
   *
   * Every other settings row in this application — Integrasi, Konfigurasi Umum, Keselamatan — uses
   * it, and this tab sat beside them using a native tick. The state of a channel is something read
   * from across a desk, which is the reason `Switch` exists.
   */
  const toggle = (key: keyof ModuleSettings, label: string): ReactNode => (
    <Switch
      checked={settings !== null && isOn(settings[key])}
      disabled={!mayConfigure}
      label={label}
      onChange={(next) => set(key, next ? '1' : '0')}
    />
  );

  return (
    <>
      <PanelSection
        icon={<Bell className="size-4" aria-hidden />}
        title={<T k="hr.notify.title" />}
        subtitle={<T k="hr.notify.subtitle" />}
      />

      <PanelBody className="space-y-2 pb-0">
        <Feedback error={error} notice={notice} />
      </PanelBody>

      {settings !== null && (
        <>
          <SettingsStack>
            {/*
              The profile picker sits above the switches because it gates them. With no
              profile nominated the toggles still govern SMS and Telegram, but nothing about
              email — and that is worth reading before the switches, not after.
            */}
            <SettingsGroup
              title={<T k="hr.notify.profile" />}
              icon={<Mail className="size-3.5" aria-hidden />}
              action={
                settings.emailProfileKey.trim() === '' ? (
                  <span className="text-[11px] tracking-wide text-amber-700 uppercase">
                    <T k="hr.notify.profile.none" />
                  </span>
                ) : undefined
              }
            >
              {/*
                `SelectControl`, not `FacetSelect`. The blank option here is deliberate and written
                out — "no profile" is a real choice — where `FacetSelect` would have added a second
                blank of its own carrying the field label.
              */}
              {/*
                The hint changes when nothing is nominated, rather than a second note appearing
                below. With no profile this module sends no email at all — which is the one thing
                worth saying here, and saying it in the hint means it cannot be scrolled past.
              */}
              <SettingRow
                label={<T k="hr.notify.profile" />}
                hint={
                  settings.emailProfileKey.trim() === '' && profiles.length > 0 ? (
                    <T k="hr.notify.profile.notSending" />
                  ) : (
                    <T k="hr.notify.profile.hint" />
                  )
                }
              >
                {profiles.length === 0 ? (
                  <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                    <T k="hr.notify.profile.empty" />
                  </PanelNote>
                ) : (
                  <SelectControl
                    label={t('hr.notify.profile')}
                    value={settings.emailProfileKey}
                    disabled={!mayConfigure}
                    onChange={(event) => set('emailProfileKey', event.target.value)}
                  >
                    <option value="">{t('hr.notify.profile.none')}</option>
                    {profiles.map((profile) => (
                      <option key={profile.key} value={profile.key}>
                        {`${profile.name} — ${profile.fromEmail}${
                          profile.active ? '' : ` ${t('hr.notify.profile.inactive')}`
                        }`}
                      </option>
                    ))}
                  </SelectControl>
                )}
              </SettingRow>
            </SettingsGroup>

            <SettingsGroup
              title={<T k="hr.notify.title" />}
              icon={<Bell className="size-3.5" aria-hidden />}
            >
              <SettingRow label={<T k="hr.notify.applicant" />} hint={<T k="hr.notify.applicant.hint" />}>
                {toggle('notifyApplicant', t('hr.notify.applicant'))}
              </SettingRow>

              <SettingRow label={<T k="hr.notify.approver" />} hint={<T k="hr.notify.approver.hint" />}>
                {toggle('notifyApprover', t('hr.notify.approver'))}
              </SettingRow>

              <SettingRow
                label={<T k="hr.notify.everyLevel" />}
                hint={
                  /*
                   * The switch is shown even on a single-step module, with the reason it does
                   * nothing yet. Hiding it would leave somebody looking for a setting the
                   * reference has and finding nothing at all.
                   */
                  chainLength > 1 ? (
                    <T k="hr.notify.everyLevel.hint" />
                  ) : (
                    <T k="hr.notify.everyLevel.notApplicable" />
                  )
                }
              >
                {toggle('notifyEveryLevel', t('hr.notify.everyLevel'))}
              </SettingRow>

              <SettingRow label={<T k="hr.notify.cc" />} hint={<T k="hr.notify.cc.hint" />}>
                <Field
                  label={<span className="sr-only">{t('hr.notify.cc')}</span>}
                  type="email"
                  value={settings.ccEmail}
                  disabled={!mayConfigure}
                  maxLength={190}
                  onChange={(event) => set('ccEmail', event.target.value)}
                />
              </SettingRow>
            </SettingsGroup>
          </SettingsStack>

          {/*
            The channel note is the action strip's hint, not a paragraph of its own.
            `PanelActions` puts it beside the button, which is where what the save will and will not
            do gets read — at the moment of deciding to press it.
          */}
          {mayConfigure && (
            <PanelActions hint={<T k="hr.notify.channels" />}>
              <Button disabled={busy || loading} onClick={() => void save()}>
                <T k="dialog.save" />
              </Button>
            </PanelActions>
          )}
        </>
      )}
    </>
  );
}
