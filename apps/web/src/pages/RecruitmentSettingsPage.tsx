import { Bell, GitBranch, Mail } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { ApprovalWorkflow } from '../components/ApprovalWorkflow';
import { EmailTemplates } from '../components/EmailTemplates';
import { ModuleNotifications } from '../components/ModuleNotifications';
import { PanelCard, PanelTabs } from '../components/RecordPanel';
import { T, useLabels } from '../lib/translation';

const SCREEN = 'hr.careerSettings';

/**
 * Recruitment settings.
 *
 * Three tabs and no master data of its own — the vacancies are the master data, and they live on
 * their own screen. The chain configured here decides offers, which is the one recruitment
 * decision somebody signs for.
 *
 * The components are the same ones Leave, Overtime, Claims and Expenses use, over
 * `module="applicants"`. Recruitment answering "who signs" differently from the request modules
 * would be a second rule for one question.
 */
export function RecruitmentSettingsPage(): ReactNode {
  const [tab, setTab] = useState('approval');
  const { t } = useLabels();

  return (
    <PanelCard
      title={<T k="recruit.settings.title" />}
      subtitle={<T k="recruit.settings.subtitle" />}
    >
      <PanelTabs
        label={t('recruit.settings.title')}
        active={tab}
        onChange={setTab}
        tabs={[
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

      {tab === 'approval' && <ApprovalWorkflow module="applicants" screen={SCREEN} />}
      {tab === 'notify' && <ModuleNotifications module="applicants" screen={SCREEN} />}
      {tab === 'templates' && <EmailTemplates module="applicants" screen={SCREEN} />}
    </PanelCard>
  );
}
