import { Bell, GitBranch, Mail, Percent } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { ApprovalWorkflow } from '../components/ApprovalWorkflow';
import { EmailTemplates } from '../components/EmailTemplates';
import { ModuleNotifications } from '../components/ModuleNotifications';
import { PanelCard, PanelTabs } from '../components/RecordPanel';
import { T, useLabels } from '../lib/translation';
import { OvertimeRatesPanel } from './OvertimePage';

const SCREEN = 'hr.overtime';

/**
 * Overtime settings.
 *
 * Rates first, because that is the tab with money in it: a rate multiplies hours somebody already
 * worked, so it is the setting on this screen that changes a payslip.
 *
 * Reachable by anybody who can view overtime — the write controls inside each tab are gated on
 * `configure` separately. An approver has a legitimate reason to read who signs after them.
 */
export function OvertimeSettingsPage(): ReactNode {
  const [tab, setTab] = useState('rates');
  const { t } = useLabels();

  return (
    <PanelCard
      title={<T k="overtime.settings.title" />}
      subtitle={<T k="overtime.settings.subtitle" />}
    >
      <PanelTabs
        label={t('overtime.settings.title')}
        active={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'rates',
            label: <T k="overtime.tab.rates" />,
            labelText: t('overtime.tab.rates'),
            icon: <Percent className="size-4" aria-hidden />,
          },
          {
            id: 'approval',
            label: <T k="hr.approval.tab" />,
            labelText: t('hr.approval.tab'),
            icon: <GitBranch className="size-4" aria-hidden />,
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

      {tab === 'rates' && <OvertimeRatesPanel />}
      {tab === 'approval' && <ApprovalWorkflow module="overtime" screen={SCREEN} />}
      {tab === 'notify' && <ModuleNotifications module="overtime" screen={SCREEN} />}
      {tab === 'templates' && <EmailTemplates module="overtime" screen={SCREEN} />}
    </PanelCard>
  );
}
