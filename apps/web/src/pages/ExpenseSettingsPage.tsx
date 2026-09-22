import { Bell, GitBranch, Mail, Tags } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { ApprovalWorkflow } from '../components/ApprovalWorkflow';
import { EmailTemplates } from '../components/EmailTemplates';
import { ModuleNotifications } from '../components/ModuleNotifications';
import { PanelCard, PanelTabs } from '../components/RecordPanel';
import { T, useLabels } from '../lib/translation';
import { ExpenseCategoriesPanel } from './ExpensesPage';

const SCREEN = 'hr.expenses';

/**
 * Expense settings.
 *
 * Same split and the same three shared panels as the modules beside it, over
 * `module="expenses"`. Four screens answering "who signs" four different ways would be four
 * rules for one question.
 */
export function ExpenseSettingsPage(): ReactNode {
  const [tab, setTab] = useState('categories');
  const { t } = useLabels();

  return (
    <PanelCard
      title={<T k="expense.settings.title" />}
      subtitle={<T k="expense.settings.subtitle" />}
    >
      <PanelTabs
        label={t('expense.settings.title')}
        active={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'categories',
            label: <T k="expense.tab.categories" />,
            labelText: t('expense.tab.categories'),
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

      {tab === 'categories' && <ExpenseCategoriesPanel />}
      {tab === 'approval' && <ApprovalWorkflow module="expenses" screen={SCREEN} />}
      {tab === 'notify' && <ModuleNotifications module="expenses" screen={SCREEN} />}
      {tab === 'templates' && <EmailTemplates module="expenses" screen={SCREEN} />}
    </PanelCard>
  );
}
