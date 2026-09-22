import { Bell, GitBranch, Mail, Tags } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { ApprovalWorkflow } from '../components/ApprovalWorkflow';
import { EmailTemplates } from '../components/EmailTemplates';
import { ModuleNotifications } from '../components/ModuleNotifications';
import { PanelCard, PanelTabs } from '../components/RecordPanel';
import { T, useLabels } from '../lib/translation';
import { ClaimTypesPanel } from './ClaimsPage';

const SCREEN = 'hr.claims';

/**
 * Claim settings.
 *
 * Split from the claims list for the same reason every module here is: deciding a claim and
 * deciding who signs for claims are different jobs, and the permission model already separated
 * them with `approve` against `configure`.
 *
 * The three configuration panels are the shared ones, over `module="claim"`.
 */
export function ClaimSettingsPage(): ReactNode {
  const [tab, setTab] = useState('types');
  const { t } = useLabels();

  return (
    <PanelCard
      title={<T k="claim.settings.title" />}
      subtitle={<T k="claim.settings.subtitle" />}
    >
      <PanelTabs
        label={t('claim.settings.title')}
        active={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'types',
            label: <T k="claim.tab.types" />,
            labelText: t('claim.tab.types'),
            icon: <Tags className="size-4" aria-hidden />,
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

      {tab === 'types' && <ClaimTypesPanel />}
      {tab === 'approval' && <ApprovalWorkflow module="claim" screen={SCREEN} />}
      {tab === 'notify' && <ModuleNotifications module="claim" screen={SCREEN} />}
      {tab === 'templates' && <EmailTemplates module="claim" screen={SCREEN} />}
    </PanelCard>
  );
}
