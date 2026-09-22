import type { LabelKey } from '@attendance/shared';
import {
  Bell,
  CalendarRange,
  CircleAlert,
  CircleCheck,
  Landmark,
  Mail,
  Settings,
  ShieldCheck,
  TriangleAlert,
  Umbrella,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { SettingRow, Switch } from '../components/ChannelForm';
import { Feedback } from '../components/Dialog';
import { EmailTemplates } from '../components/EmailTemplates';
import { ModuleNotifications } from '../components/ModuleNotifications';
import {
  PanelActions,
  PanelBody,
  PanelCard,
  PanelNote,
  PanelSection,
  PanelTabs,
  SettingsGroup,
  SettingsStack,
} from '../components/RecordPanel';
import { Button, Field } from '../components/ui';
import { useAuth } from '../lib/auth';
import { payrollApi, type PayrollSettingsPayload } from '../lib/payroll-api';
import { T, useLabels } from '../lib/translation';

const SCREEN = 'hr.payrollSettings';

/**
 * Statutory rates and the pay cycle.
 *
 * The rates are data, not constants, and the file that computes with them says why: the EIS
 * ceiling has moved twice by government announcement, and a rate in a source file means a release
 * to obey the law.
 *
 * The part of this screen that matters most is the review flag at the bottom. Seeded rates that
 * nobody has checked look identical to rates finance signed off, and the difference is every
 * deduction on every payslip. Until it is set, every payroll screen and every exported file carries
 * a warning saying so.
 */
export function PayrollSettingsPage(): ReactNode {
  const [tab, setTab] = useState('rates');
  const { t } = useLabels();

  return (
    <PanelCard title={<T k="pay.settings.title" />} subtitle={<T k="pay.settings.subtitle" />}>
      {/*
        No approval tab. A payroll period is `draft → processing → approved → paid → closed` with
        no rung anybody is on and no rejection, so a chain here would be a screen of rungs nothing
        consults. The server agrees: the chain endpoints answer 404 for this module.
      */}
      <PanelTabs
        label={t('pay.settings.title')}
        active={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'rates',
            label: <T k="pay.settings.tab.rates" />,
            labelText: t('pay.settings.tab.rates'),
            icon: <Landmark className="size-4" aria-hidden />,
          },
          {
            id: 'notify',
            label: <T k="hr.notify.tab" />,
            labelText: t('hr.notify.tab'),
            icon: <Bell className="size-4" aria-hidden />,
          },
          {
            id: 'templates',
            label: <T k="hr.template.tab" />,
            labelText: t('hr.template.tab'),
            icon: <Mail className="size-4" aria-hidden />,
          },
        ]}
      />

      {tab === 'rates' && <RatesTab />}
      {tab === 'notify' && <ModuleNotifications module="payroll" screen={SCREEN} />}
      {tab === 'templates' && <EmailTemplates module="payroll" screen={SCREEN} />}
    </PanelCard>
  );
}

function RatesTab(): ReactNode {
  const [payload, setPayload] = useState<PayrollSettingsPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const mayEdit = can(SCREEN, 'edit');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await payrollApi.settings();
      setPayload(result);
      setDraft(result.settings);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('pay.settings.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (key: string, value: string): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await payrollApi.saveSettings(draft);
      setNotice(t('pay.settings.saved'));
      setError(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
    } finally {
      setBusy(false);
    }
  };

  const reviewed = draft.ratesReviewed === '1';

  /** A percentage or amount field, so the eleven of them read the same way. */
  const numberRow = (
    key: string,
    label: LabelKey,
    hint?: LabelKey,
    step = '0.01',
  ): ReactNode => (
    <SettingRow label={<T k={label} />} hint={hint === undefined ? undefined : <T k={hint} />}>
      <Field
        label={<span className="sr-only">{t(label)}</span>}
        type="number"
        step={step}
        min={0}
        value={draft[key] ?? ''}
        disabled={!mayEdit}
        onChange={(event) => set(key, event.target.value)}
      />
    </SettingRow>
  );

  return (
    <>
      <PanelSection
        icon={<Settings className="size-4" aria-hidden />}
        title={<T k="pay.settings.tab.rates" />}
      />

      <PanelBody className="space-y-2 pb-0">
        <Feedback error={error} notice={notice} />

        {/*
          The caveats come from the server as keys.
          Sent rather than written here so a caveat cannot be true of the engine and absent from
          the screen — these are approximations somebody has to know about before signing a period.
        */}
        {!reviewed && (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="pay.settings.caveat.unverified" />
          </PanelNote>
        )}
      </PanelBody>

      {loading ? (
        <PanelBody>
          <p className="py-8 text-center text-sm text-slate-500">
            <T k="app.loading" />
          </p>
        </PanelBody>
      ) : (
        <>
          <SettingsStack>
            <SettingsGroup
              title={<T k="pay.settings.group.epf" />}
              icon={<Landmark className="size-3.5" aria-hidden />}
              action={
                <span className="text-xs tabular-nums text-slate-500">
                  {`${draft.epfEmployeeRate ?? '—'}% / ${draft.epfEmployerRate ?? '—'}%`}
                </span>
              }
            >
              {numberRow('epfEmployeeRate', 'pay.settings.epfEmployeeRate')}
              {numberRow('epfEmployerRate', 'pay.settings.epfEmployerRate')}
              {numberRow(
                'epfEmployerRateHigh',
                'pay.settings.epfEmployerRateHigh',
                'pay.settings.epfEmployerRateHigh.hint',
              )}
              {numberRow('epfWageThreshold', 'pay.settings.epfWageThreshold', undefined, '1')}
              <SettingRow
                label={<T k="pay.settings.epfIncludeBonus" />}
                hint={<T k="pay.settings.epfIncludeBonus.hint" />}
              >
                <Switch
                  checked={draft.epfIncludeBonus === '1'}
                  onChange={(value) => set('epfIncludeBonus', value ? '1' : '0')}
                  disabled={!mayEdit}
                  label={t('pay.settings.epfIncludeBonus')}
                  showLabel={false}
                />
              </SettingRow>
              <div className="pt-2">
                <PanelNote icon={<CircleAlert className="size-3.5" aria-hidden />}>
                  <T k="pay.settings.epf.note" />
                </PanelNote>
              </div>
            </SettingsGroup>

            <SettingsGroup
              title={<T k="pay.settings.group.socso" />}
              icon={<ShieldCheck className="size-3.5" aria-hidden />}
              action={
                <span className="text-xs tabular-nums text-slate-500">
                  {`${draft.socsoEmployeeRate ?? '—'}% / ${draft.socsoEmployerRate ?? '—'}%`}
                </span>
              }
            >
              {numberRow('socsoEmployeeRate', 'pay.settings.socsoEmployeeRate')}
              {numberRow('socsoEmployerRate', 'pay.settings.socsoEmployerRate')}
              {numberRow(
                'socsoWageCeiling',
                'pay.settings.socsoWageCeiling',
                'pay.settings.socsoWageCeiling.hint',
                '1',
              )}
              <div className="pt-2">
                <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                  <T k="pay.settings.caveat.socsoBands" />
                </PanelNote>
              </div>
            </SettingsGroup>

            <SettingsGroup
              title={<T k="pay.settings.group.eis" />}
              icon={<Umbrella className="size-3.5" aria-hidden />}
              action={
                <span className="text-xs tabular-nums text-slate-500">
                  {`${draft.eisEmployeeRate ?? '—'}% / ${draft.eisEmployerRate ?? '—'}%`}
                </span>
              }
            >
              {numberRow('eisEmployeeRate', 'pay.settings.eisEmployeeRate')}
              {numberRow('eisEmployerRate', 'pay.settings.eisEmployerRate')}
              {numberRow('eisWageCeiling', 'pay.settings.eisWageCeiling', undefined, '1')}
            </SettingsGroup>

            <SettingsGroup
              title={<T k="pay.settings.group.cycle" />}
              icon={<CalendarRange className="size-3.5" aria-hidden />}
              action={
                <span className="text-xs tabular-nums text-slate-500">
                  {draft.payDay ?? '—'}
                </span>
              }
            >
              {numberRow('payDay', 'pay.settings.payDay', 'pay.settings.payDay.hint', '1')}
              <div className="pt-2">
                <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                  <T k="pay.settings.caveat.pcb" />
                </PanelNote>
              </div>
            </SettingsGroup>

            {/*
              The review flag, last and on its own.
              It is the one setting that exists to be answered rather than tuned, so it does not
              sit among the numbers it is a statement about.
            */}
            <SettingsGroup
              title={<T k="pay.settings.group.review" />}
              icon={
                reviewed ? (
                  <CircleCheck className="size-3.5" aria-hidden />
                ) : (
                  <TriangleAlert className="size-3.5" aria-hidden />
                )
              }
              action={
                <span
                  className={
                    reviewed
                      ? 'text-xs font-medium uppercase text-emerald-700'
                      : 'text-xs font-medium uppercase text-amber-700'
                  }
                >
                  <T k={reviewed ? 'app.status.active' : 'app.status.inactive'} />
                </span>
              }
            >
              <div className="pb-3">
                <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
                  <T k="pay.settings.caveat.heading" />
                </p>
                <div className="space-y-2">
                  {(payload?.caveatKeys ?? []).map((key) => (
                    <PanelNote key={key} icon={<CircleAlert className="size-3.5" aria-hidden />}>
                      <T k={key as LabelKey} />
                    </PanelNote>
                  ))}
                </div>
              </div>

              <SettingRow
                label={<T k="pay.settings.ratesReviewed" />}
                hint={<T k="pay.settings.ratesReviewed.hint" />}
              >
                <Switch
                  checked={reviewed}
                  onChange={(value) => set('ratesReviewed', value ? '1' : '0')}
                  disabled={!mayEdit}
                  label={t('pay.settings.ratesReviewed')}
                  showLabel={false}
                />
              </SettingRow>
            </SettingsGroup>
          </SettingsStack>

          {mayEdit && (
            <PanelActions>
              <Button disabled={busy} onClick={() => void save()}>
                <T k="pay.settings.action.save" />
              </Button>
            </PanelActions>
          )}
        </>
      )}
    </>
  );
}
