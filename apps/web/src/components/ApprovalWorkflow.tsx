import { ArrowDown, ArrowUp, Pause, Play, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from './Dialog';
import {
  CodePill,
  PanelBody,
  PanelFooter,
  PanelNote,
  PanelSection,
  RecordTable,
  RowAction,
  RowActions,
} from './RecordPanel';
import { Badge, Button, Field, SelectField } from './ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { hrApi, type ApprovalChain, type ApprovalLevel, type ApprovalModule } from '../lib/hr-api';
import { T, useLabels } from '../lib/translation';

/**
 * The approval chain editor, shared by every HR request module.
 *
 * Generic over `module` the way `ChannelForm` is generic over a notification channel: the
 * question each module asks is identical, and a copy per module would be four places for the
 * next rule to be applied in three of them.
 *
 * An empty chain is a supported state, not an unconfigured one. With no rungs, one decision
 * settles a request — which is how this application behaved before chains existed, and what
 * every installation that never opens this tab keeps doing.
 */
export function ApprovalWorkflow({
  module,
  screen,
}: {
  module: ApprovalModule;
  /** Permission screen for this module, so the editor can hide what the caller cannot do. */
  screen: string;
}): ReactNode {
  const [data, setData] = useState<ApprovalChain | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<ApprovalLevel | 'new' | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const mayConfigure = can(screen, 'configure');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await hrApi.chain(module));
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

  /** Structural edits are refused while requests sit part-way up the chain. */
  const blocked = (data?.partway ?? 0) > 0;

  const move = async (index: number, delta: number): Promise<void> => {
    if (data === null) return;
    const ids = data.levels.map((row) => row.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;

    const swapped = [...ids];
    const a = swapped[index];
    const b = swapped[target];
    if (a === undefined || b === undefined) return;
    swapped[index] = b;
    swapped[target] = a;

    try {
      await hrApi.reorder(module, swapped);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
    }
  };

  const activeCount = data?.levels.filter((row) => row.active).length ?? 0;

  return (
    <>
      {/*
        The count sits in the title, the way the leave types tab does it.
        It used to be a `PanelNote` under the header, one of three stacked strips that between them
        pushed the table below the fold. A figure that answers "how many rungs" belongs in the
        heading that introduces the list, not in a paragraph above it.
      */}
      <PanelSection
        title={
          activeCount === 0 ? (
            <T k="hr.approval.chainLength.none" />
          ) : (
            <T k="hr.approval.chainLength" vars={{ count: activeCount }} />
          )
        }
        subtitle={<T k="hr.approval.subtitle" />}
        action={
          mayConfigure ? (
            <Button
              disabled={blocked}
              title={blocked ? t('hr.approval.blocked.note') : undefined}
              onClick={() => setEditing('new')}
            >
              <Plus className="size-4" aria-hidden />
              <T k="hr.approval.action.add" />
            </Button>
          ) : undefined
        }
      />

      {/*
        Only the blocked warning survives as a strip, because it is the one that is actionable and
        explains why the buttons are dead. The override note moved into the dialog, where the
        decision it describes is actually made; the suspended-rung note moved into the label on the
        mark itself.
      */}
      {(error !== null || notice !== null || blocked) && (
        <PanelBody className="space-y-2 pb-0">
          <Feedback error={error} notice={notice} />
          {blocked && (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="hr.approval.blocked" vars={{ count: data?.partway ?? 0 }} />{' '}
              <T k="hr.approval.blocked.note" />
            </PanelNote>
          )}
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={data?.levels.length ?? 0}
        empty={
          <span className="block space-y-1">
            <span className="block">
              <T k="hr.approval.empty" />
            </span>
            <span className="block text-xs text-slate-400">
              <T k="hr.approval.empty.hint" />
            </span>
          </span>
        }
        columns={[
          { header: <T k="hr.approval.column.level" />, width: 'w-20' },
          { header: <T k="hr.approval.column.approver" /> },
          { header: <T k="hr.approval.column.kind" />, width: 'w-28' },
          { header: <T k="hr.approval.column.note" /> },
          { header: <T k="panel.column.status" />, width: 'w-24' },
          { header: <T k="panel.column.actions" />, width: 'w-40', align: 'right' },
        ]}
      >
        {(data?.levels ?? []).map((row, index) => (
          <tr
            key={row.id}
            className={cn(
              'border-b border-slate-100 hover:bg-slate-50/70',
              !row.active && 'bg-slate-50/60 text-slate-400',
            )}
          >
            {/* `CodePill` with no colour, so the rung number reads as an identifier like a code. */}
            <td className="px-5 py-2.5">
              <CodePill code={String(row.level)} />
            </td>
            <td className="px-2 py-2.5">
              <span
                className={cn('block font-medium', row.active ? 'text-slate-800' : 'text-slate-400')}
              >
                {row.approverLabel}
              </span>
            </td>
            {/*
              A `Badge` rather than bare text, because this column has two values and a reader is
              picking one out rather than reading it. `info` and `accent` carry register, not
              severity — neither kind is a fault.
            */}
            <td className="px-2 py-2.5">
              <Badge tone={row.byRole ? 'info' : 'accent'}>
                <T k={row.byRole ? 'hr.approval.kind.role' : 'hr.approval.kind.account'} />
              </Badge>
            </td>
            <td className="px-2 py-2.5 text-xs text-slate-500">{row.note ?? '—'}</td>
            <td className="px-2 py-2.5">
              <Badge tone={row.active ? 'success' : 'neutral'}>
                <T k={row.active ? 'app.status.active' : 'hr.approval.suspended'} />
              </Badge>
            </td>
            <td className="px-2 py-2.5 pr-4">
              {mayConfigure && (
                <RowActions>
                  <RowAction
                    icon={<ArrowUp className="size-4" aria-hidden />}
                    label={t('hr.approval.action.up')}
                    disabled={blocked || index === 0}
                    onClick={() => void move(index, -1)}
                  />
                  <RowAction
                    icon={<ArrowDown className="size-4" aria-hidden />}
                    label={t('hr.approval.action.down')}
                    disabled={blocked || index === (data?.levels.length ?? 0) - 1}
                    onClick={() => void move(index, 1)}
                  />
                  <RowAction
                    icon={
                      row.active ? (
                        <Pause className="size-4" aria-hidden />
                      ) : (
                        <Play className="size-4" aria-hidden />
                      )
                    }
                    /*
                      The consequence rides on the tooltip of the control that causes it.
                      It used to be a `PanelNote` under the table, which meant the one fact somebody
                      needs — a suspended rung is skipped, so the chain gets shorter rather than
                      stuck on a rung with nobody on it — was read after the decision or not at all.
                    */
                    label={
                      row.active
                        ? `${t('hr.approval.action.suspend')} — ${t('hr.approval.suspended.note')}`
                        : t('hr.approval.action.resume')
                    }
                    tone="warn"
                    onClick={async () => {
                      try {
                        await hrApi.updateLevel(module, row.id, { active: !row.active });
                        await load();
                      } catch (cause) {
                        setError(cause instanceof Error ? cause.message : null);
                      }
                    }}
                  />
                  <RowAction
                    icon={<Trash2 className="size-4" aria-hidden />}
                    label={t('hr.approval.action.remove')}
                    tone="danger"
                    disabled={blocked}
                    onClick={async () => {
                      try {
                        await hrApi.removeLevel(module, row.id);
                        setNotice(null);
                        await load();
                      } catch (cause) {
                        setError(cause instanceof Error ? cause.message : null);
                      }
                    }}
                  />
                </RowActions>
              )}
            </td>
          </tr>
        ))}
      </RecordTable>

      {/*
        The footer states what is shown out of what, like every other list in the application. The
        chain is never paged — it is at most a handful of rungs — so the page controls are fixed at
        one and the count is the point.
      */}
      <PanelFooter
        shown={data?.levels.length ?? 0}
        total={data?.levels.length ?? 0}
        page={1}
        pageSize={Math.max(1, data?.levels.length ?? 1)}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => void load()}
      />

      {editing !== null && data !== null && (
        <LevelDialog
          module={module}
          chain={data}
          target={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </>
  );
}

function LevelDialog({
  module,
  chain,
  target,
  onClose,
  onDone,
}: {
  module: ApprovalModule;
  chain: ApprovalChain;
  target: ApprovalLevel | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}): ReactNode {
  const [byRole, setByRole] = useState(target?.byRole ?? false);
  const [accountId, setAccountId] = useState(
    target?.approverAccountId === null || target?.approverAccountId === undefined
      ? ''
      : String(target.approverAccountId),
  );
  const [roleId, setRoleId] = useState(
    target?.approverRoleId === null || target?.approverRoleId === undefined
      ? ''
      : String(target.approverRoleId),
  );
  const [note, setNote] = useState(target?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  const noCandidates = chain.candidateAccounts.length === 0 && chain.candidateRoles.length === 0;

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      // Exactly one of the two is sent; the other is explicitly null so switching a rung
      // from a person to a role clears what it used to name.
      const body = {
        approverAccountId: byRole ? null : Number(accountId),
        approverRoleId: byRole ? Number(roleId) : null,
        note,
      };
      if (target === null) await hrApi.addLevel(module, body);
      else await hrApi.updateLevel(module, target.id, body);
      await onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k="hr.approval.form.title" />}
      titleText={t('hr.approval.form.title')}
      description={<T k="hr.approval.form.override" />}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {noCandidates ? (
          <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="hr.approval.form.candidates.empty" />
          </PanelNote>
        ) : (
          <>
            {/*
              `SelectField`, not `FacetSelect`. `FacetSelect` prepends a blank option carrying its
              own label — correct for a filter where empty means "no filter", and a bug here: all
              three of these always hold a value, and the blank entry was a selectable state that
              submitted an empty approver.
            */}
            <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
              <SelectField
                label={<T k="hr.approval.form.by" />}
                value={byRole ? 'role' : 'account'}
                onChange={(event) => setByRole(event.target.value === 'role')}
              >
                <option value="account">{t('hr.approval.form.byAccount')}</option>
                <option value="role">{t('hr.approval.form.byRole')}</option>
              </SelectField>

              {byRole ? (
                <SelectField
                  label={<T k="hr.approval.form.role" />}
                  value={roleId}
                  onChange={(event) => setRoleId(event.target.value)}
                  hint={<T k="hr.approval.form.byRole.hint" />}
                >
                  <option value="">{t('hr.approval.form.role')}</option>
                  {chain.candidateRoles.map((role) => (
                    <option key={role.id} value={String(role.id)}>
                      {role.name}
                    </option>
                  ))}
                </SelectField>
              ) : (
                <SelectField
                  label={<T k="hr.approval.form.account" />}
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                >
                  <option value="">{t('hr.approval.form.account')}</option>
                  {chain.candidateAccounts.map((account) => (
                    <option key={account.id} value={String(account.id)}>
                      {`${account.label} — ${account.roleName}`}
                    </option>
                  ))}
                </SelectField>
              )}
            </div>

            <Field
              label={<T k="hr.approval.form.note" />}
              hint={<T k="hr.approval.form.note.hint" />}
              value={note}
              maxLength={255}
              onChange={(event) => setNote(event.target.value)}
            />
          </>
        )}

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={noCandidates || (byRole ? roleId === '' : accountId === '')}
          submitLabel={<T k="dialog.save" />}
        />
      </div>
    </Dialog>
  );
}
