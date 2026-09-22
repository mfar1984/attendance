import { Bell, GitBranch, Mail, Settings2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { ApprovalWorkflow } from '../components/ApprovalWorkflow';
import { EmailTemplates } from '../components/EmailTemplates';
import { ModuleNotifications } from '../components/ModuleNotifications';
import { PanelCard, PanelTabs } from '../components/RecordPanel';
import { T, useLabels } from '../lib/translation';
import { LeaveTypesPanel } from './LeaveRequestsPage';

const SCREEN = 'schedule.leave';

/**
 * Leave settings.
 *
 * Split from the applications list, which is what this screen is for. Both used to be tabs on one
 * page, and that put "approve Siti's leave" and "change who approves leave" behind the same door
 * — two jobs the permission model already separated, with `view`/`approve` for one and
 * `configure` for the other.
 *
 * The three configuration panels are the same components Recruitment, Overtime, Claims and
 * Expenses use, over `module="leave"`. Leave answering "who signs" differently from the modules
 * beside it would be two rules for one question, and the one nobody documented would be the one
 * in force.
 *
 * `LeaveTypesPanel` is imported from the applications page rather than moved here. It was written
 * there with its dialog and validation beside it, and relocating four hundred lines to satisfy a
 * naming instinct is risk with no behaviour attached.
 */
export function LeaveSettingsPage(): ReactNode {
  const [tab, setTab] = useState('types');
  const { t } = useLabels();

  return (
    <PanelCard
      title={<T k="leave.settings.title" />}
      subtitle={<T k="leave.settings.subtitle" />}
    >
      <PanelTabs
        label={t('leave.settings.title')}
        active={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'types',
            label: <T k="leave.tab.types" />,
            labelText: t('leave.tab.types'),
            icon: <Settings2 className="size-4" aria-hidden />,
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

      {tab === 'types' && <LeaveTypesPanel />}
      {tab === 'approval' && <ApprovalWorkflow module="leave" screen={SCREEN} />}
      {tab === 'notify' && <ModuleNotifications module="leave" screen={SCREEN} />}
      {tab === 'templates' && <EmailTemplates module="leave" screen={SCREEN} />}
    </PanelCard>
  );
}
