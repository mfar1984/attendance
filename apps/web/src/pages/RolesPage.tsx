import { Eye, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { groupByDomain, type LabelKey } from '@attendance/shared';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { Feedback } from '../components/Dialog';
import {
  ChipBar,
  Detail,
  DetailGrid,
  ExpandButton,
  FilterRow,
  PanelBody,
  PanelCard,
  PanelFooter,
  PanelSection,
  RecordTable,
  RowAction,
  RowActions,
} from '../components/RecordPanel';
import { RemoveDialog } from '../components/RemoveDialog';
import { Badge, Button } from '../components/ui';
import { useAuth } from '../lib/auth';
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

const SCREEN = 'settings.roles';

/**
 * Roles list.
 *
 * The matrix lives on its own page rather than in a dialog. Thirty-five screens with up to nine
 * actions each makes a grid that needs the width of the viewport, and the section a row belongs to
 * has to stay visible while its checkbox is being ticked.
 */
export function RolesPage(): ReactNode {
  const navigate = useNavigate();
  const { t } = useLabels();
  const { can } = useAuth();
  const [rows, setRows] = useState<RoleRow[] | null>(null);
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [removing, setRemoving] = useState<RoleRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, definition] = await Promise.all([rolesApi.list(), rolesApi.matrix()]);
      setRows(list);
      setMatrix(definition);
      setLoadedAt(new Date().toISOString());
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

  const searched = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (rows ?? []).filter(
      (row) =>
        needle.length === 0 ||
        row.name.toLowerCase().includes(needle) ||
        (row.description ?? '').toLowerCase().includes(needle),
    );
  }, [rows, search]);
  const filtered =
    status === undefined ? searched : searched.filter((row) => row.status === status);

  // Counted over the search but not over the chip, so choosing one does not zero the other.
  const counts = {
    active: searched.filter((row) => row.status === 'active').length,
    inactive: searched.filter((row) => row.status === 'inactive').length,
  };

  return (
    <PanelCard title={<T k="roles.title" />} subtitle={<T k="roles.subtitle" />}>
      <PanelSection
        title={<T k="roles.count" vars={{ count: rows?.length ?? 0 }} />}
        subtitle={<T k="roles.section.subtitle" />}
        action={
          can(SCREEN, 'create') ? (
            <Button onClick={() => void navigate('/tetapan/peranan/baharu')}>
              <Plus className="size-4" aria-hidden />
              <T k="roles.action.new" />
            </Button>
          ) : undefined
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
            dot: 'bg-slate-400',
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

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={filtered.length}
        empty={<T k="roles.empty" />}
        columns={[
          { header: <T k="roles.column.name" />, width: 'w-56' },
          { header: <T k="roles.column.description" /> },
          { header: <T k="roles.column.accounts" />, width: 'w-24', align: 'right' },
          { header: <T k="roles.column.permissions" />, width: 'w-36' },
          { header: <T k="panel.column.created" />, width: 'w-28' },
          { header: <T k="panel.column.status" />, width: 'w-28' },
          { header: <T k="panel.column.actions" />, width: 'w-36', align: 'right' },
        ]}
      >
        {filtered.map((role) => (
          <RoleRowView
            key={role.id}
            role={role}
            matrix={matrix}
            mayEdit={can(SCREEN, 'edit')}
            mayRemove={can(SCREEN, 'delete')}
            expanded={open === role.id}
            onToggle={() => setOpen(open === role.id ? null : role.id)}
            onView={() => void navigate(`/tetapan/peranan/${String(role.id)}?baca=1`)}
            onEdit={() => void navigate(`/tetapan/peranan/${String(role.id)}`)}
            onDelete={() => setRemoving(role)}
          />
        ))}
      </RecordTable>

      <PanelFooter
        shown={filtered.length}
        total={rows?.length ?? 0}
        page={1}
        pageSize={Math.max(1, rows?.length ?? 1)}
        pageSizes={[Math.max(1, rows?.length ?? 1)]}
        generatedAt={loadedAt}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => void load()}
      />

      {removing !== null && (
        <RemoveDialog
          title={<T k="roles.remove.title" vars={{ name: removing.name }} />}
          titleText={t('roles.remove.title', { name: removing.name })}
          description={<T k="roles.remove.safe" />}
          onConfirm={async () => {
            await rolesApi.remove(removing.id);
            setRemoving(null);
            setError(null);
            setNotice(t('roles.notice.removed', { name: removing.name }));
            await load();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </PanelCard>
  );
}

function RoleRowView({
  role,
  matrix,
  mayEdit,
  mayRemove,
  expanded,
  onToggle,
  onView,
  onEdit,
  onDelete,
}: {
  role: RoleRow;
  matrix: PermissionMatrix | null;
  mayEdit: boolean;
  mayRemove: boolean;
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
   * Dashboard maps to no domain and keeps its place first, unlabelled — it summarises every domain
   * rather than sitting in one.
   */
  const coverageClusters = useMemo(() => {
    if (matrix === null) return [];

    const { ungrouped, domains } = groupByDomain(matrix.sections, (section) => section.labelKey);

    return [
      ...(ungrouped.length > 0 ? [{ key: 'ungrouped', labelKey: undefined, sections: ungrouped }] : []),
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
          inactive && !expanded && 'bg-amber-50/40',
        )}
      >
        <td className="px-5 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={mayEdit ? onEdit : onView}
              className="hover:text-brand-600 font-medium text-slate-800 hover:underline"
            >
              {role.name}
            </button>
            {role.systemRole && (
              <Badge tone="info" className="uppercase">
                <T k="roles.badge.system" />
              </Badge>
            )}
          </div>
        </td>

        <td className="px-2 py-2.5 text-slate-600">
          {role.description ?? <span className="text-slate-400">—</span>}
        </td>

        <td className="px-2 py-2.5 text-right">
          <span className="inline-flex items-center gap-1.5 text-slate-700">
            <Users className="size-3.5 text-slate-400" aria-hidden />
            <span className="tabular-nums">{role.accountCount}</span>
          </span>
        </td>

        <td className="px-2 py-2.5">
          <PermissionCoverage granted={role.permissionCount} total={role.permissionTotal} />
        </td>

        <td className="px-2 py-2.5 text-xs whitespace-nowrap text-slate-500">
          {formatDate(role.createdAt)}
        </td>

        <td className="px-2 py-2.5">
          {/* Upper case comes from the class: `.toUpperCase()` on a translated word is not safe. */}
          <Badge tone={inactive ? 'neutral' : 'success'} className="uppercase">
            <T k={inactive ? 'app.status.inactive' : 'app.status.active'} />
          </Badge>
        </td>

        <td className="px-2 py-2.5 pr-4">
          <RowActions>
            <RowAction
              icon={<Eye className="size-4" aria-hidden />}
              label={t('roles.row.view')}
              tone="view"
              onClick={onView}
            />
            {mayEdit && (
              <RowAction
                icon={<Pencil className="size-4" aria-hidden />}
                label={t('roles.row.edit')}
                tone="edit"
                onClick={onEdit}
              />
            )}
            {/*
              Absent rather than disabled for system roles: the seed and operator habit both refer
              to them by name, so there is no state in which this should act.
            */}
            {mayRemove && !role.systemRole && (
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
                  role.systemRole ? t('roles.detail.systemRole.yes') : t('roles.detail.systemRole.no')
                }
              />
              <Detail label={<T k="roles.detail.accounts" />} value={String(role.accountCount)} />
              <Detail
                label={<T k="roles.detail.permissions" />}
                value={t('roles.detail.permissions.value', {
                  granted: role.permissionCount,
                  total: role.permissionTotal,
                })}
              />
              <Detail label={<T k="panel.column.created" />} value={formatDateTime(role.createdAt)} />
              <Detail label={<T k="roles.detail.updated" />} value={formatDateTime(role.updatedAt)} />
              <Detail label={<T k="roles.detail.id" />} value={String(role.id)} mono />
            </DetailGrid>

            {/*
              Coverage per section rather than a list of every grant. Thirty-five rows of detail
              belongs on the editor page; what is useful here is which areas the role reaches at all.
            */}
            {matrix !== null && (
              <div className="mt-3 border-t border-slate-200 pt-3">
                <p className="mb-2 text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                  <T k="roles.detail.coverage" />
                </p>
                {/*
                  Clustered by domain, from the same shared mapping the rail and the matrix use. "Covers
                  all of Operasi, none of Sumber Manusia" is the shape of a role, and a flat row of
                  chips does not show it.
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
function ReadOnlyScreens({ matrix, role }: { matrix: PermissionMatrix; role: RoleRow }): ReactNode {
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
 * The ratio matters more than the number: "63 / 123" tells you at a glance whether a role is narrow
 * or nearly unrestricted, which a bare count does not.
 */
function PermissionCoverage({ granted, total }: { granted: number; total: number }): ReactNode {
  const { t } = useLabels();
  const share = total === 0 ? 0 : granted / total;

  return (
    <div className="min-w-28">
      <p className="text-xs text-slate-700 tabular-nums">
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
