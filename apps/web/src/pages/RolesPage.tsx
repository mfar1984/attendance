import { Eye, Lock, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { groupByDomain, type LabelKey } from '@attendance/shared';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { Dialog, Feedback } from '../components/Dialog';
import {
  ChipBar,
  Detail,
  DetailGrid,
  ExpandButton,
  FilterRow,
  PanelBody,
  PanelCard,
  PanelFooter,
  PanelNote,
  PanelSection,
  RecordTable,
  RowAction,
  RowActions,
} from '../components/RecordPanel';
import { Badge, Button } from '../components/ui';
import { cn } from '../lib/cn';
import { formatDate, formatDateTime } from '../lib/operations-api';
import {
  rolesApi,
  screenActions,
  sectionProgress,
  type PermissionMatrix,
  type RoleRow,
} from '../lib/settings-api';
import { T, useLabels } from '../lib/translation';

/**
 * Roles list.
 *
 * The matrix lives on its own page rather than in a dialog. Thirty-five screens with
 * up to nine actions each makes a grid that needs the width of the viewport, and the
 * section a row belongs to has to stay visible while its checkbox is being ticked.
 */
export function RolesPage(): ReactNode {
  const navigate = useNavigate();
  const { t } = useLabels();
  const [rows, setRows] = useState<RoleRow[] | null>(null);
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<RoleRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, definition] = await Promise.all([rolesApi.list(), rolesApi.matrix()]);
      setRows(list);
      setMatrix(definition);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('roles.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (status !== undefined && row.status !== status) return false;
      if (needle.length === 0) return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        (row.description ?? '').toLowerCase().includes(needle)
      );
    });
  }, [rows, search, status]);

  const counts = {
    active: (rows ?? []).filter((row) => row.status === 'active').length,
    inactive: (rows ?? []).filter((row) => row.status === 'inactive').length,
  };

  async function remove(role: RoleRow): Promise<void> {
    setConfirming(null);
    setError(null);
    setNotice(null);
    try {
      await rolesApi.remove(role.id);
      setNotice(t('roles.notice.removed', { name: role.name }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('roles.error.remove'));
    }
  }

  return (
    <PanelCard title={<T k="roles.title" />} subtitle={<T k="roles.subtitle" />}>
      <PanelSection
        title={<T k="roles.section.title" />}
        subtitle={<T k="roles.section.subtitle" />}
        action={
          <Button onClick={() => void navigate('/tetapan/peranan/baharu')}>
            <Plus className="size-4" aria-hidden />
            <T k="roles.action.new" />
          </Button>
        }
      />

      <ChipBar
        active={status}
        onChange={setStatus}
        chips={[
          {
            id: 'active',
            label: <T k="app.status.active" />,
            count: counts.active,
            dot: 'bg-emerald-500',
          },
          {
            id: 'inactive',
            label: <T k="app.status.inactive" />,
            count: counts.inactive,
            dot: 'bg-rose-500',
          },
        ]}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('roles.search')}
        dirty={search.length > 0 || status !== undefined}
        onReset={() => {
          setSearch('');
          setStatus(undefined);
        }}
      />

      <PanelBody className="space-y-3 pb-0">
        <Feedback error={error} notice={notice} />

        {/*
          The immutability of the device log is stated on the screen, not just enforced
          in the request handler. An administrator who cannot find the permission will
          otherwise assume it is a bug and go looking for a way round it.
        */}
        <PanelNote icon={<Lock className="size-3.5" aria-hidden />}>
          <T
            k="roles.note.immutable"
            vars={{
              emphasis: (
                <strong className="font-medium text-slate-700">
                  <T k="roles.note.immutable.emphasis" />
                </strong>
              ),
            }}
          />
        </PanelNote>
      </PanelBody>

      <div className="mt-3">
        <RecordTable
          loading={loading}
          rowCount={filtered.length}
          empty={<T k="roles.empty" />}
          columns={[
            { header: <T k="roles.column.name" />, width: 'w-56' },
            { header: <T k="roles.column.description" /> },
            { header: <T k="roles.column.accounts" />, width: 'w-24' },
            { header: <T k="roles.column.permissions" />, width: 'w-36' },
            { header: <T k="panel.column.status" />, width: 'w-28' },
            { header: <T k="panel.column.created" />, width: 'w-28' },
            { header: <T k="panel.column.actions" />, width: 'w-36', align: 'right' },
          ]}
        >
          {filtered.map((role) => (
            <RoleRowView
              key={role.id}
              role={role}
              matrix={matrix}
              expanded={open === role.id}
              onToggle={() => setOpen(open === role.id ? null : role.id)}
              onView={() => void navigate(`/tetapan/peranan/${String(role.id)}?baca=1`)}
              onEdit={() => void navigate(`/tetapan/peranan/${String(role.id)}`)}
              onDelete={() => setConfirming(role)}
            />
          ))}
        </RecordTable>
      </div>

      <PanelFooter
        shown={filtered.length}
        total={rows?.length ?? 0}
        page={1}
        pageSize={Math.max(1, rows?.length ?? 1)}
        pageSizes={[Math.max(1, rows?.length ?? 1)]}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => void load()}
      />

      {confirming !== null && (
        <Dialog
          title={<T k="roles.remove.title" vars={{ name: confirming.name }} />}
          titleText={t('roles.remove.title', { name: confirming.name })}
          onClose={() => setConfirming(null)}
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              {confirming.accountCount > 0 ? (
                <T k="roles.remove.blocked" vars={{ count: confirming.accountCount }} />
              ) : (
                <T k="roles.remove.safe" />
              )}
            </p>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                <T k="dialog.cancel" />
              </Button>
              <Button
                onClick={() => void remove(confirming)}
                className="bg-rose-600 hover:bg-rose-500"
              >
                <T k="app.remove" />
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </PanelCard>
  );
}

function RoleRowView({
  role,
  matrix,
  expanded,
  onToggle,
  onView,
  onEdit,
  onDelete,
}: {
  role: RoleRow;
  matrix: PermissionMatrix | null;
  expanded: boolean;
  onToggle: () => void;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): ReactNode {
  const { t } = useLabels();
  const inactive = role.status === 'inactive';

  /**
   * Coverage chips clustered by domain, in the same order the rail and the matrix use.
   *
   * Dashboard maps to no domain and keeps its place first, unlabelled — it summarises every
   * domain rather than sitting in one.
   */
  const coverageClusters = useMemo(() => {
    if (matrix === null) return [];

    const { ungrouped, domains } = groupByDomain(matrix.sections, (section) => section.labelKey);

    return [
      ...(ungrouped.length > 0
        ? [{ key: 'ungrouped', labelKey: undefined, sections: ungrouped }]
        : []),
      ...domains.map((domain) => ({
        key: domain.key as string,
        labelKey: domain.labelKey as LabelKey | undefined,
        sections: domain.groups,
      })),
    ];
  }, [matrix]);

  return (
    <>
      <tr
        className={cn(
          'border-b border-slate-100',
          expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
          inactive && !expanded && 'bg-rose-50/40',
        )}
      >
        <td className="px-5 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onEdit}
              className="hover:text-brand-600 font-medium text-slate-800 hover:underline"
            >
              {role.name}
            </button>
            {role.systemRole && (
              <Badge tone="neutral">
                <T k="roles.badge.system" />
              </Badge>
            )}
          </div>
        </td>

        <td className="px-2 py-2.5 text-slate-600">
          {role.description ?? <span className="text-slate-400">—</span>}
        </td>

        <td className="px-2 py-2.5">
          <span className="inline-flex items-center gap-1.5 text-slate-700">
            <Users className="size-3.5 text-slate-400" aria-hidden />
            <span className="tabular-nums">{role.accountCount}</span>
          </span>
        </td>

        <td className="px-2 py-2.5">
          <PermissionCoverage granted={role.permissionCount} total={role.permissionTotal} />
        </td>

        <td className="px-2 py-2.5">
          {/*
            Upper case comes from the class, not from the string. `.toUpperCase()` on a
            translated word is not safe in every language, and the badge is presentation.
          */}
          <span
            className={cn(
              'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
              inactive ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700',
            )}
          >
            <T k={inactive ? 'app.status.inactive' : 'app.status.active'} />
          </span>
        </td>

        <td className="px-2 py-2.5 text-xs whitespace-nowrap text-slate-500">
          {formatDate(role.createdAt)}
        </td>

        <td className="px-2 py-2.5 pr-4">
          <RowActions>
            <RowAction
              icon={<Eye className="size-4" aria-hidden />}
              label={t('roles.row.view')}
              tone="view"
              onClick={onView}
            />
            <RowAction
              icon={<Pencil className="size-4" aria-hidden />}
              label={t('roles.row.edit')}
              tone="edit"
              onClick={onEdit}
            />
            {/*
              Absent rather than disabled for system roles: the seed and operator habit
              both refer to them by name, so there is no state in which this should act.
            */}
            {!role.systemRole && (
              <RowAction
                icon={<Trash2 className="size-4" aria-hidden />}
                label={
                  role.accountCount > 0
                    ? t('roles.row.locked', { count: role.accountCount })
                    : t('roles.row.remove')
                }
                tone="danger"
                disabled={role.accountCount > 0}
                onClick={onDelete}
              />
            )}
            <ExpandButton expanded={expanded} onClick={onToggle} label={t('roles.row.expand')} />
          </RowActions>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={7} className="px-5 py-3">
            <DetailGrid>
              <Detail
                label={<T k="roles.detail.systemRole" />}
                value={
                  role.systemRole
                    ? t('roles.detail.systemRole.yes')
                    : t('roles.detail.systemRole.no')
                }
              />
              <Detail
                label={<T k="roles.detail.accounts" />}
                value={String(role.accountCount)}
              />
              <Detail
                label={<T k="roles.detail.permissions" />}
                value={t('roles.detail.permissions.value', {
                  granted: role.permissionCount,
                  total: role.permissionTotal,
                })}
              />
              <Detail label={<T k="panel.column.created" />} value={formatDateTime(role.createdAt)} />
              <Detail
                label={<T k="roles.detail.updated" />}
                value={formatDateTime(role.updatedAt)}
              />
              <Detail label={<T k="roles.detail.id" />} value={String(role.id)} mono />
            </DetailGrid>

            {/*
              Coverage per section rather than a list of every grant. Thirty-five rows of
              detail belongs on the editor page; what is useful here is which areas the
              role reaches at all.
            */}
            {matrix !== null && (
              <div className="mt-3 border-t border-slate-200 pt-3">
                <p className="mb-2 text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                  <T k="roles.detail.coverage" />
                </p>
                {/*
                  Clustered by domain, from the same shared mapping the rail and the matrix use.

                  Ten chips in one wrap could be read in any order, so the clusters do real work
                  here beyond matching the other screens: "covers all of Operasi, none of Sumber
                  Manusia" is the shape of a role, and a flat row of chips does not show it.
                */}
                {coverageClusters.map((cluster) => (
                  <div key={cluster.key} className="mb-2 flex flex-wrap items-baseline gap-2">
                    {cluster.labelKey !== undefined && (
                      <span className="w-full text-[10px] font-semibold tracking-wider text-slate-400 uppercase sm:w-28">
                        <T k={cluster.labelKey} />
                      </span>
                    )}
                    {cluster.sections.map((section) => {
                      const progress = sectionProgress(section, role.permissions);
                      return (
                        <span
                          key={section.key}
                          className={cn(
                            'inline-flex items-baseline gap-1.5 rounded-lg border px-2 py-1 text-xs',
                            progress.granted === 0
                              ? 'border-slate-200 bg-white text-slate-400'
                              : progress.granted === progress.total
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                : 'border-amber-200 bg-amber-50 text-amber-800',
                          )}
                        >
                          <span className="font-medium">
                            <T k={section.labelKey} />
                          </span>
                          <span className="tabular-nums opacity-70">
                            {progress.granted}/{progress.total}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {matrix !== null && <ReadOnlyScreens matrix={matrix} role={role} />}
          </td>
        </tr>
      )}
    </>
  );
}

/** Screens the role can open but not change, which is the common source of confusion. */
function ReadOnlyScreens({
  matrix,
  role,
}: {
  matrix: PermissionMatrix;
  role: RoleRow;
}): ReactNode {
  const { t } = useLabels();
  const viewOnly = matrix.sections
    .flatMap((section) => section.screens)
    .filter((screen) => {
      const held = role.permissions[screen.key] ?? [];
      if (!held.includes('view')) return false;
      const writes = screenActions(screen).filter(
        (action) => action !== 'view' && action !== 'export',
      );
      return writes.length > 0 && writes.every((action) => !held.includes(action));
    });

  if (viewOnly.length === 0) return null;

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <p className="mb-1.5 text-[11px] font-medium tracking-wide text-slate-500 uppercase">
        <T k="roles.viewOnly.heading" vars={{ count: viewOnly.length }} />
      </p>
      <p className="text-xs text-slate-600">
        {viewOnly.map((screen) => t(screen.labelKey)).join(' · ')}
      </p>
    </div>
  );
}

/**
 * Granted against available, with a bar.
 *
 * The ratio matters more than the number: "63 / 123" tells you at a glance whether a
 * role is narrow or nearly unrestricted, which a bare count does not.
 */
function PermissionCoverage({ granted, total }: { granted: number; total: number }): ReactNode {
  const { t } = useLabels();
  const share = total === 0 ? 0 : granted / total;

  return (
    <div className="min-w-28">
      <p className="text-xs tabular-nums text-slate-700">
        {granted} <span className="text-slate-400">/ {total}</span>
      </p>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={t('roles.coverage.aria', { granted, total })}
      >
        <div
          className={
            share > 0.9
              ? 'h-full rounded-full bg-rose-500'
              : share > 0.5
                ? 'h-full rounded-full bg-amber-500'
                : 'h-full rounded-full bg-emerald-500'
          }
          style={{ width: `${String(Math.round(share * 100))}%` }}
        />
      </div>
    </div>
  );
}


