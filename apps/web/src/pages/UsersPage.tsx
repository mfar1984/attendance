import {
  Ban,
  CircleCheck,
  Copy,
  Eye,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  TriangleAlert,
  UserRound,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  ChipBar,
  Detail,
  DetailGrid,
  ExpandButton,
  FacetSelect,
  FilterRow,
  PanelCard,
  PanelFooter,
  PanelSection,
  PanelTabs,
  RecordTable,
  RowAction,
  RowActions,
} from '../components/RecordPanel';
import { Badge, Button, Field } from '../components/ui';
import { cn } from '../lib/cn';
import { formatDate, formatDateTime } from '../lib/operations-api';
import {
  USER_STATUS_LABELS,
  appClientsApi,
  rolesApi,
  usersApi,
  type AccountCandidate,
  type AppClientRow,
  type RoleRow,
  type UserCounts,
  type UserPage,
  type UserRow,
  type UserStatus,
} from '../lib/settings-api';
import { T, TEnum, useLabels } from '../lib/translation';

/**
 * Account management.
 *
 * Split by what the account is for rather than by permission level: an administrator
 * login and a staff app login are the same table row but completely different
 * operational concerns, and mixing a dozen administrators into five thousand app
 * logins makes neither usable.
 */
export function UsersPage(): ReactNode {
  const [tab, setTab] = useState('admin');
  const [counts, setCounts] = useState<UserCounts | null>(null);
  const { t } = useLabels();

  const reloadCounts = useCallback(() => {
    void usersApi
      .counts()
      .then(setCounts)
      .catch(() => setCounts(null));
  }, []);

  useEffect(reloadCounts, [reloadCounts]);

  return (
    <PanelCard
      title={<T k="users.title" />}
      subtitle={<T k="users.subtitle" />}
    >
      <PanelTabs
        label={t('users.tabs.label')}
        active={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'admin',
            label: <T k="users.tab.admin" />,
            labelText: t('users.tab.admin'),
            icon: <ShieldCheck className="size-4" aria-hidden />,
            count: counts?.admin,
          },
          {
            id: 'staff',
            label: <T k="users.tab.staff" />,
            labelText: t('users.tab.staff'),
            icon: <Users className="size-4" aria-hidden />,
            count: counts?.staff,
          },
          {
            id: 'apps',
            label: <T k="users.tab.apps" />,
            labelText: t('users.tab.apps'),
            icon: <Smartphone className="size-4" aria-hidden />,
            count: counts?.apps,
          },
        ]}
      />

      {tab === 'apps' ? (
        <AppsPanel onChanged={reloadCounts} />
      ) : (
        <AccountsPanel
          key={tab}
          accountType={tab === 'admin' ? 'admin' : 'staff'}
          onChanged={reloadCounts}
        />
      )}
    </PanelCard>
  );
}

const STATUS_DOT: Record<UserStatus, string> = {
  active: 'bg-emerald-500',
  pending: 'bg-amber-500',
  suspended: 'bg-rose-500',
};

const STATUS_BADGE: Record<UserStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-amber-50 text-amber-800',
  suspended: 'bg-rose-50 text-rose-700',
};

function StatusBadge({ status }: { status: UserStatus }): ReactNode {
  return (
    <span
      className={cn(
        'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
        STATUS_BADGE[status],
        // Uppercased in CSS: a translated word cannot be upper-cased safely in every language.
        'uppercase',
      )}
    >
      <TEnum k={USER_STATUS_LABELS[status]} fallback={status} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Administrator / Staff
// ---------------------------------------------------------------------------

function AccountsPanel({
  accountType,
  onChanged,
}: {
  accountType: 'admin' | 'staff';
  onChanged: () => void;
}): ReactNode {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [status, setStatus] = useState<UserStatus | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [data, setData] = useState<UserPage | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [confirming, setConfirming] = useState<UserRow | null>(null);
  const { t } = useLabels();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await usersApi.list({
          accountType,
          status,
          search: debounced.length > 0 ? debounced : undefined,
          page,
          pageSize,
        }),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('users.error.load'));
    } finally {
      setLoading(false);
    }
  }, [accountType, status, debounced, page, pageSize, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void rolesApi
      .list()
      .then(setRoles)
      .catch(() => setRoles([]));
  }, []);

  const refresh = useCallback(() => {
    void load();
    onChanged();
  }, [load, onChanged]);

  async function setAccountStatus(row: UserRow, next: UserStatus): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await usersApi.update(row.id, { status: next });
      setNotice(
        next === 'suspended'
          ? t('users.suspended', { email: row.email })
          : t('users.reactivated', { email: row.email }),
      );
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('users.error.status'));
    }
  }

  async function remove(row: UserRow): Promise<void> {
    setConfirming(null);
    setError(null);
    setNotice(null);
    try {
      await usersApi.remove(row.id);
      setNotice(t('users.removed', { email: row.email }));
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('users.error.remove'));
    }
  }

  const admin = accountType === 'admin';

  return (
    <>
      <PanelSection
        title={<T k={admin ? 'users.section.admin' : 'users.section.staff'} />}
        subtitle={
          <T k={admin ? 'users.section.admin.subtitle' : 'users.section.staff.subtitle'} />
        }
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            <T k={admin ? 'users.action.newAdmin' : 'users.action.newStaff'} />
          </Button>
        }
      />

      <ChipBar
        active={status}
        onChange={(id) => {
          setStatus(id as UserStatus | undefined);
          setPage(1);
        }}
        chips={(['active', 'pending', 'suspended'] as UserStatus[]).map((key) => ({
          id: key,
          label: <TEnum k={USER_STATUS_LABELS[key]} fallback={key} />,
          count: data?.statuses[key] ?? 0,
          dot: STATUS_DOT[key],
        }))}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('users.search')}
        dirty={search.length > 0 || status !== undefined}
        onReset={() => {
          setSearch('');
          setStatus(undefined);
          setPage(1);
        }}
      >
        <FacetSelect
          label={t('users.filter.roles')}
          value=""
          onChange={() => undefined}
          options={[]}
          className="hidden"
        />
      </FilterRow>

      <div className="px-5 pt-3">
        <Feedback error={error} notice={notice} />
      </div>

      {accountType === 'staff' && (
        <p className="mx-5 mt-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <Smartphone className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
          <span>
            <T
              k="users.staff.note"
              vars={{
                pending: (
                  <strong>
                    <T k="users.staff.note.pending" />
                  </strong>
                ),
              }}
            />
          </span>
        </p>
      )}

      <div className="mt-3">
        <RecordTable
          loading={loading}
          rowCount={data?.rows.length ?? 0}
          empty={<T k={admin ? 'users.empty.admin' : 'users.empty.staff'} />}
          columns={
            admin
              ? [
                  { header: <T k="users.column.email" />, width: 'w-64' },
                  { header: <T k="users.column.role" />, width: 'w-40' },
                  { header: <T k="panel.column.created" />, width: 'w-28' },
                  { header: <T k="panel.column.status" />, width: 'w-24' },
                  { header: <T k="users.column.twoFactor" />, width: 'w-28' },
                  { header: <T k="users.column.lastLogin" /> },
                  { header: <T k="panel.column.actions" />, width: 'w-44', align: 'right' },
                ]
              : [
                  { header: <T k="users.column.email" />, width: 'w-56' },
                  { header: <T k="users.column.staff" /> },
                  { header: <T k="users.column.device" />, width: 'w-32' },
                  { header: <T k="panel.column.status" />, width: 'w-24' },
                  { header: <T k="users.column.lastLogin" />, width: 'w-44' },
                  { header: <T k="panel.column.actions" />, width: 'w-44', align: 'right' },
                ]
          }
        >
          {(data?.rows ?? []).map((row) => (
            <AccountRow
              key={row.id}
              row={row}
              admin={admin}
              expanded={open === row.id}
              onToggle={() => setOpen(open === row.id ? null : row.id)}
              onEdit={() => setEditing(row)}
              onReset={() => setResetting(row)}
              onSuspend={() =>
                void setAccountStatus(row, row.status === 'suspended' ? 'active' : 'suspended')
              }
              onDelete={() => setConfirming(row)}
            />
          ))}
        </RecordTable>
      </div>

      <PanelFooter
        shown={data?.rows.length ?? 0}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        generatedAt={data?.generatedAt}
        loading={loading}
        onPage={setPage}
        onPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onRefresh={refresh}
      />

      {creating && (
        <CreateAccountDialog
          accountType={accountType}
          roles={roles}
          onClose={() => setCreating(false)}
          onSaved={(message) => {
            setCreating(false);
            setNotice(message);
            refresh();
          }}
        />
      )}

      {editing !== null && (
        <EditAccountDialog
          account={editing}
          roles={roles}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice(message);
            refresh();
          }}
        />
      )}

      {resetting !== null && (
        <ResetPasswordDialog
          account={resetting}
          onClose={() => setResetting(null)}
          onSaved={(message) => {
            setResetting(null);
            setNotice(message);
            refresh();
          }}
        />
      )}

      {confirming !== null && (
        <ConfirmDelete
          title={<T k="users.remove.title" vars={{ email: confirming.email }} />}
          titleText={t('users.remove.title', { email: confirming.email })}
          body={
            <T
              k={
                confirming.status === 'suspended'
                  ? 'users.remove.suspended'
                  : 'users.remove.active'
              }
            />
          }
          onClose={() => setConfirming(null)}
          onConfirm={() => void remove(confirming)}
        />
      )}
    </>
  );
}

function AccountRow({
  row,
  admin,
  expanded,
  onToggle,
  onEdit,
  onReset,
  onSuspend,
  onDelete,
}: {
  row: UserRow;
  admin: boolean;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onReset: () => void;
  onSuspend: () => void;
  onDelete: () => void;
}): ReactNode {
  const locked = row.lockedUntil !== null && new Date(row.lockedUntil) > new Date();
  const suspended = row.status === 'suspended';
  const { t } = useLabels();

  return (
    <>
      <tr
        className={cn(
          'border-b border-slate-100',
          expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
          // A suspended row is tinted, so scanning the list surfaces it before the
          // status column is read.
          suspended && !expanded && 'bg-rose-50/40',
        )}
      >
        <td className="px-5 py-2.5">
          <span className="block truncate font-medium text-slate-800" title={row.email}>
            {row.email}
          </span>
          {row.staff !== null && !admin && (
            <span className="block font-mono text-[11px] text-slate-400">
              {row.staff.employeeNo}
            </span>
          )}
        </td>

        {admin ? (
          <>
            <td className="px-2 py-2.5">
              <Badge tone="neutral">{row.role.name}</Badge>
            </td>
            <td className="px-2 py-2.5 text-xs whitespace-nowrap text-slate-500">
              {formatDate(row.createdAt)}
            </td>
            <td className="px-2 py-2.5">
              <div className="flex flex-wrap items-center gap-1">
                <StatusBadge status={row.status} />
                {locked && (
                  <Badge tone="danger">
                    <T k="users.locked" />
                  </Badge>
                )}
              </div>
            </td>
            <td className="px-2 py-2.5">
              {row.twoFactorEnabled ? (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                  <ShieldCheck className="size-3.5" aria-hidden />
                  <T k="users.twoFactor.on" />
                </span>
              ) : (
                <span className="text-xs text-amber-700">
                  <T k="users.twoFactor.off" />
                </span>
              )}
            </td>
          </>
        ) : (
          <>
            <td className="px-2 py-2.5">
              {row.staff === null ? (
                <span className="text-xs text-slate-400">—</span>
              ) : (
                <>
                  <span className="block text-slate-800">{row.staff.fullName}</span>
                  <span className="block text-[11px] tracking-wide text-slate-400 uppercase">
                    {row.staff.department?.name ?? t('users.noDepartment')}
                    {!row.staff.active && t('users.staffInactive')}
                  </span>
                </>
              )}
            </td>
            <td className="px-2 py-2.5">
              {row.boundDeviceId === null ? (
                <span className="text-xs text-slate-400">
                  <T k="users.device.unclaimed" />
                </span>
              ) : (
                <span
                  className="font-mono text-[11px] text-slate-600"
                  title={row.boundDeviceId}
                >
                  {row.boundDeviceId.slice(0, 10)}…
                </span>
              )}
            </td>
            <td className="px-2 py-2.5">
              <div className="flex flex-wrap items-center gap-1">
                <StatusBadge status={row.status} />
                {locked && (
                  <Badge tone="danger">
                    <T k="users.locked" />
                  </Badge>
                )}
              </div>
            </td>
          </>
        )}

        <td className="px-2 py-2.5 text-xs whitespace-nowrap text-slate-500">
          {row.lastLoginAt === null ? t('users.never') : formatDateTime(row.lastLoginAt)}
        </td>

        <td className="px-2 py-2.5 pr-4">
          <RowActions>
            <RowAction
              icon={<Eye className="size-4" aria-hidden />}
              label={t('users.action.view')}
              tone="view"
              onClick={onToggle}
            />
            <RowAction
              icon={<Pencil className="size-4" aria-hidden />}
              label={t('users.action.edit')}
              tone="edit"
              onClick={onEdit}
            />
            <RowAction
              icon={<KeyRound className="size-4" aria-hidden />}
              label={t('users.action.reset')}
              tone="success"
              onClick={onReset}
            />
            {/*
              The suspend toggle. Suspending ends live sessions immediately, which is
              the whole point of it existing next to delete: it stops access now and
              keeps the record.
            */}
            <RowAction
              icon={
                suspended ? (
                  <CircleCheck className="size-4" aria-hidden />
                ) : (
                  <Ban className="size-4" aria-hidden />
                )
              }
              label={suspended ? t('users.action.reactivate') : t('users.action.suspend')}
              tone="warn"
              onClick={onSuspend}
            />
            <RowAction
              icon={<Trash2 className="size-4" aria-hidden />}
              label={suspended ? t('users.action.remove') : t('users.action.suspendFirst')}
              tone="danger"
              disabled={!suspended}
              onClick={onDelete}
            />
            <ExpandButton expanded={expanded} onClick={onToggle} label={t('users.expand')} />
          </RowActions>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={admin ? 7 : 6} className="px-5 py-3">
            <DetailGrid>
              <Detail label={<T k="users.detail.staffName" />} value={row.staff?.fullName ?? '—'} />
              <Detail
                label={<T k="users.detail.employeeNo" />}
                value={row.staff?.employeeNo ?? '—'}
                mono
              />
              <Detail
                label={<T k="users.detail.department" />}
                value={row.staff?.department?.name ?? '—'}
              />
              <Detail label={<T k="users.detail.role" />} value={row.role.name} />
              <Detail label={<T k="users.detail.accountType" />} value={row.accountType} />
              <Detail
                label={<T k="users.detail.created" />}
                value={formatDateTime(row.createdAt)}
              />
              <Detail
                label={<T k="users.detail.appCheckIn" />}
                value={
                  <T
                    k={
                      row.allowAppCheckIn
                        ? 'users.detail.appCheckIn.allowed'
                        : 'users.detail.appCheckIn.denied'
                    }
                  />
                }
              />
              <Detail
                label={<T k="users.detail.boundDevice" />}
                value={
                  row.boundDeviceId === null ? (
                    <T k="users.device.unclaimed" />
                  ) : (
                    <T
                      k="users.detail.boundDevice.value"
                      vars={{
                        id: row.boundDeviceId,
                        when: formatDateTime(row.boundDeviceAt),
                      }}
                    />
                  )
                }
                mono
              />
              <Detail
                label={<T k="users.detail.failedLogins" />}
                value={
                  row.failedLoginCount === 0 ? (
                    <T k="users.detail.failedLogins.none" />
                  ) : (
                    <T
                      k="users.detail.failedLogins.count"
                      vars={{ count: row.failedLoginCount }}
                    />
                  )
                }
              />
              {locked && (
                <Detail
                  label={<T k="users.detail.lockedUntil" />}
                  value={formatDateTime(row.lockedUntil)}
                />
              )}
              <Detail label={<T k="users.detail.accountId" />} value={String(row.id)} mono />
            </DetailGrid>

            {row.staff !== null && !row.staff.active && (
              <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <T k="users.detail.staffInactiveWarning" />
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Apps
// ---------------------------------------------------------------------------

function AppsPanel({ onChanged }: { onChanged: () => void }): ReactNode {
  const [rows, setRows] = useState<AppClientRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<AppClientRow | null>(null);
  const [revealed, setRevealed] = useState<{ clientId: string; secret: string; note: string } | null>(
    null,
  );
  const { t } = useLabels();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await appClientsApi.list());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('users.apps.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    void load();
    onChanged();
  }, [load, onChanged]);

  async function setStatus(row: AppClientRow, status: 'active' | 'suspended'): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await appClientsApi.update(row.id, { status });
      setNotice(
        status === 'suspended'
          ? t('users.apps.suspended', { name: row.name })
          : t('users.apps.reactivated', { name: row.name }),
      );
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('users.error.status'));
    }
  }

  async function rotate(row: AppClientRow): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      const outcome = await appClientsApi.update(row.id, { rotateSecret: true });
      if (outcome.secret !== undefined) {
        setRevealed({
          clientId: row.clientId,
          secret: outcome.secret,
          // The server's own wording when it has one; the registry line is the fallback.
          note: outcome.note ?? t('users.apps.rotated'),
        });
      }
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('users.apps.error.rotate'));
    }
  }

  async function remove(row: AppClientRow): Promise<void> {
    setConfirming(null);
    setError(null);
    try {
      await appClientsApi.remove(row.id);
      setNotice(t('users.apps.removed', { name: row.name }));
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('users.apps.error.remove'));
    }
  }

  const all = rows ?? [];
  const needle = search.trim().toLowerCase();
  const filtered = all.filter((row) => {
    if (statusFilter !== undefined && row.status !== statusFilter) return false;
    if (needle.length === 0) return true;
    return (
      row.name.toLowerCase().includes(needle) || row.clientId.toLowerCase().includes(needle)
    );
  });

  const counts = {
    active: all.filter((row) => row.status === 'active').length,
    suspended: all.filter((row) => row.status === 'suspended').length,
  };

  return (
    <>
      <PanelSection
        title={<T k="users.apps.title" />}
        subtitle={<T k="users.apps.subtitle" />}
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            <T k="users.apps.action.add" />
          </Button>
        }
      />

      <ChipBar
        active={statusFilter}
        onChange={setStatusFilter}
        chips={[
          {
            id: 'active',
            label: <T k="users.apps.chip.active" />,
            count: counts.active,
            dot: 'bg-emerald-500',
          },
          {
            id: 'suspended',
            label: <T k="users.apps.chip.suspended" />,
            count: counts.suspended,
            dot: 'bg-rose-500',
          },
        ]}
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('users.apps.search')}
        dirty={search.length > 0 || statusFilter !== undefined}
        onReset={() => {
          setSearch('');
          setStatusFilter(undefined);
        }}
      />

      <div className="px-5 pt-3">
        <Feedback error={error} notice={notice} />
      </div>

      <p className="mx-5 mt-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <Smartphone className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
        <span>
          <T k="users.apps.note" />
        </span>
      </p>

      <div className="mt-3">
        <RecordTable
          loading={loading}
          rowCount={filtered.length}
          empty={<T k="users.apps.empty" />}
          columns={[
            { header: <T k="users.apps.column.name" /> },
            { header: <T k="users.apps.column.platform" />, width: 'w-28' },
            { header: <T k="users.apps.column.minVersion" />, width: 'w-32' },
            { header: <T k="panel.column.status" />, width: 'w-28' },
            { header: <T k="panel.column.created" />, width: 'w-28' },
            { header: <T k="panel.column.actions" />, width: 'w-44', align: 'right' },
          ]}
        >
          {filtered.map((row) => {
            const suspended = row.status === 'suspended';
            const expanded = open === row.id;
            return (
              <>
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-slate-100',
                    expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
                    suspended && !expanded && 'bg-rose-50/40',
                  )}
                >
                  <td className="px-5 py-2.5">
                    <span className="block font-medium text-slate-800">{row.name}</span>
                    <span className="block font-mono text-[11px] text-slate-400">
                      {row.clientId}
                    </span>
                  </td>
                  <td className="px-2 py-2.5">
                    <Badge tone="neutral">{row.platform}</Badge>
                  </td>
                  <td className="px-2 py-2.5">
                    {row.minVersion === null ? (
                      <span className="text-xs text-slate-400">
                        <T k="users.apps.noLimit" />
                      </span>
                    ) : (
                      <span className="font-mono text-xs text-slate-600">{row.minVersion}</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    <span
                      className={cn(
                        'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
                        suspended ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700',
                      )}
                    >
                      <T
                        k={
                          suspended ? 'users.apps.status.suspended' : 'users.apps.status.active'
                        }
                      />
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-xs whitespace-nowrap text-slate-500">
                    {formatDate(row.createdAt)}
                  </td>
                  <td className="px-2 py-2.5 pr-4">
                    <RowActions>
                      <RowAction
                        icon={<Eye className="size-4" aria-hidden />}
                        label={t('users.action.view')}
                        tone="view"
                        onClick={() => setOpen(expanded ? null : row.id)}
                      />
                      <RowAction
                        icon={<RefreshCw className="size-4" aria-hidden />}
                        label={t('users.apps.action.rotate')}
                        tone="edit"
                        onClick={() => void rotate(row)}
                      />
                      <RowAction
                        icon={
                          suspended ? (
                            <CircleCheck className="size-4" aria-hidden />
                          ) : (
                            <Ban className="size-4" aria-hidden />
                          )
                        }
                        label={
                          suspended
                            ? t('users.apps.action.reactivate')
                            : t('users.apps.action.suspend')
                        }
                        tone="warn"
                        onClick={() => void setStatus(row, suspended ? 'active' : 'suspended')}
                      />
                      <RowAction
                        icon={<Trash2 className="size-4" aria-hidden />}
                        label={
                          suspended
                            ? t('users.apps.action.remove')
                            : t('users.action.suspendFirst')
                        }
                        tone="danger"
                        disabled={!suspended}
                        onClick={() => setConfirming(row)}
                      />
                      <ExpandButton
                        expanded={expanded}
                        onClick={() => setOpen(expanded ? null : row.id)}
                        label={t('users.apps.expand')}
                      />
                    </RowActions>
                  </td>
                </tr>

                {expanded && (
                  <tr key={`${String(row.id)}-detail`} className="border-b border-slate-200 bg-slate-50">
                    <td colSpan={6} className="px-5 py-3">
                      <DetailGrid>
                        <Detail
                          label={<T k="users.apps.detail.clientId" />}
                          value={row.clientId}
                          mono
                        />
                        <Detail
                          label={<T k="users.apps.column.platform" />}
                          value={row.platform}
                        />
                        <Detail
                          label={<T k="users.apps.column.minVersion" />}
                          value={row.minVersion ?? t('users.apps.noLimit')}
                        />
                        <Detail
                          label={<T k="users.detail.created" />}
                          value={formatDateTime(row.createdAt)}
                        />
                        <Detail
                          label={<T k="users.apps.detail.updated" />}
                          value={formatDateTime(row.updatedAt)}
                        />
                        <Detail
                          label={<T k="users.apps.detail.secret" />}
                          value={<T k="users.apps.detail.secret.value" />}
                        />
                      </DetailGrid>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </RecordTable>
      </div>

      <PanelFooter
        shown={filtered.length}
        total={all.length}
        page={1}
        pageSize={Math.max(1, all.length)}
        pageSizes={[Math.max(1, all.length)]}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={refresh}
      />

      {creating && (
        <CreateAppClientDialog
          onClose={() => setCreating(false)}
          onCreated={(secret) => {
            setCreating(false);
            setRevealed(secret);
            refresh();
          }}
        />
      )}

      {revealed !== null && <SecretDialog value={revealed} onClose={() => setRevealed(null)} />}

      {confirming !== null && (
        <ConfirmDelete
          title={<T k="users.apps.remove.title" vars={{ name: confirming.name }} />}
          titleText={t('users.apps.remove.title', { name: confirming.name })}
          body={<T k="users.apps.remove.body" />}
          onClose={() => setConfirming(null)}
          onConfirm={() => void remove(confirming)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

const SELECT = 'mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';

function CreateAccountDialog({
  accountType,
  roles,
  onClose,
  onSaved,
}: {
  accountType: 'admin' | 'staff';
  roles: RoleRow[];
  onClose: () => void;
  onSaved: (message: string) => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<AccountCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<AccountCandidate | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [allowAppCheckIn, setAllowAppCheckIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  useEffect(() => {
    if (chosen !== null) return;
    setSearching(true);
    const timer = setTimeout(() => {
      void usersApi
        .searchStaff(query)
        .then(setCandidates)
        .catch(() => setCandidates([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, chosen]);

  useEffect(() => {
    if (roleId !== null || roles.length === 0) return;
    // Defaults to the least privileged role rather than the first listed, so a
    // mis-click on save does not hand out administration.
    const fewest = [...roles].sort(
      (left, right) => left.permissionCount - right.permissionCount,
    )[0];
    if (fewest) setRoleId(fewest.id);
  }, [roleId, roles]);

  async function submit(): Promise<void> {
    if (chosen === null || roleId === null) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await usersApi.create({
        staffId: chosen.id,
        email: email.trim(),
        accountType,
        roleId,
        password,
        allowAppCheckIn,
      });
      onSaved(
        // The server's note, when it sent one, appended to the registry sentence. It names
        // something specific to this account that no fixed wording could cover.
        t('users.created', { name: chosen.fullName }) +
          (outcome.note === undefined ? '' : ` ${outcome.note}`),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('users.error.create'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={<T k={accountType === 'admin' ? 'users.create.admin' : 'users.create.staff'} />}
      titleText={t(accountType === 'admin' ? 'users.create.admin' : 'users.create.staff')}
      description={<T k="users.create.description" />}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {chosen === null ? (
          <div>
            <Field
              label={<T k="users.create.searchStaff" />}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('users.create.searchStaff.placeholder')}
              autoFocus
            />

            <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-slate-200">
              {searching && candidates.length === 0 ? (
                <div className="flex min-h-24 items-center justify-center">
                  <Loader2
                    className="size-4 animate-spin text-slate-400"
                    aria-label={t('users.create.searching')}
                  />
                </div>
              ) : candidates.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-slate-500">
                  <T k="users.create.noMatch" />
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {candidates.map((candidate) => {
                    const taken = candidate.existingAccountEmail !== null;
                    return (
                      <li key={candidate.id}>
                        <button
                          type="button"
                          disabled={taken}
                          onClick={() => {
                            setChosen(candidate);
                            setEmail(candidate.email ?? '');
                          }}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50/60"
                        >
                          <UserRound className="size-4 shrink-0 text-slate-400" aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-800">
                              {candidate.fullName}
                            </span>
                            <span className="block truncate font-mono text-xs text-slate-500">
                              {candidate.employeeNo}
                              {candidate.department !== null && ` · ${candidate.department.name}`}
                            </span>
                          </span>
                          {taken && (
                            <Badge tone="neutral">
                              <T
                                k="users.create.taken"
                                vars={{ email: candidate.existingAccountEmail }}
                              />
                            </Badge>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <UserRound className="size-4 text-slate-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{chosen.fullName}</p>
                <p className="font-mono text-xs text-slate-500">{chosen.employeeNo}</p>
              </div>
              <Button variant="ghost" onClick={() => setChosen(null)}>
                <T k="users.create.change" />
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={<T k="users.create.email" />}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                wrapperClassName="sm:col-span-2"
              />
              <div>
                <label htmlFor="new-role" className="block text-sm font-medium text-slate-700">
                  <T k="users.create.role" />
                </label>
                <select
                  id="new-role"
                  value={roleId ?? ''}
                  onChange={(event) => setRoleId(Number(event.target.value))}
                  className={SELECT}
                >
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {t('users.create.role.option', {
                        name: role.name,
                        granted: role.permissionCount,
                        total: role.permissionTotal,
                      })}
                    </option>
                  ))}
                </select>
              </div>
              <Field
                label={<T k="users.create.password" />}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                hint={<T k="users.create.password.hint" />}
                error={
                  password.length > 0 && password.length < 12
                    ? t('users.create.password.short', { count: 12 - password.length })
                    : undefined
                }
              />
            </div>

            {accountType === 'staff' && (
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={allowAppCheckIn}
                  onChange={(event) => setAllowAppCheckIn(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <T k="users.create.allowAppCheckIn" />
                  <span className="mt-0.5 block text-xs text-slate-500">
                    <T k="users.create.allowAppCheckIn.hint" />
                  </span>
                </span>
              </label>
            )}

            {accountType === 'admin' && (
              <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <T k="users.create.adminWarning" />
              </p>
            )}

            <DialogFooter
              onClose={onClose}
              onSubmit={() => void submit()}
              busy={busy}
              disabled={email.trim().length === 0 || password.length < 12 || roleId === null}
              submitLabel={<T k="users.create.submit" />}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}

function EditAccountDialog({
  account,
  roles,
  onClose,
  onSaved,
}: {
  account: UserRow;
  roles: RoleRow[];
  onClose: () => void;
  onSaved: (message: string) => void;
}): ReactNode {
  const [roleId, setRoleId] = useState(account.role.id);
  const [status, setStatus] = useState<UserStatus>(account.status);
  const [allowAppCheckIn, setAllowAppCheckIn] = useState(account.allowAppCheckIn);
  const [resetBinding, setResetBinding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await usersApi.update(account.id, {
        ...(roleId !== account.role.id ? { roleId } : {}),
        ...(status !== account.status ? { status } : {}),
        ...(allowAppCheckIn !== account.allowAppCheckIn ? { allowAppCheckIn } : {}),
        ...(resetBinding ? { resetDeviceBinding: true } : {}),
      });
      onSaved(t('users.updated', { email: account.email }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('users.error.update'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={account.email} description={account.staff?.fullName} onClose={onClose}>
      <div className="space-y-4">
        <Feedback error={error} />

        <div>
          <label htmlFor="edit-role" className="block text-sm font-medium text-slate-700">
            <T k="users.create.role" />
          </label>
          <select
            id="edit-role"
            value={roleId}
            onChange={(event) => setRoleId(Number(event.target.value))}
            className={SELECT}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {t('users.create.role.option', {
                  name: role.name,
                  granted: role.permissionCount,
                  total: role.permissionTotal,
                })}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="edit-status" className="block text-sm font-medium text-slate-700">
            <T k="users.edit.status" />
          </label>
          <select
            id="edit-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as UserStatus)}
            className={SELECT}
          >
            <option value="active">{t('users.edit.status.active')}</option>
            <option value="pending">{t('users.edit.status.pending')}</option>
            <option value="suspended">{t('users.edit.status.suspended')}</option>
          </select>
          {status === 'suspended' && account.status !== 'suspended' && (
            <p className="mt-1.5 text-xs text-amber-800">
              <T k="users.edit.status.warning" />
            </p>
          )}
        </div>

        {account.accountType === 'staff' && (
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={allowAppCheckIn}
              onChange={(event) => setAllowAppCheckIn(event.target.checked)}
              className="mt-0.5"
            />
            <T k="users.create.allowAppCheckIn" />
          </label>
        )}

        {account.boundDeviceId !== null && (
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={resetBinding}
              onChange={(event) => setResetBinding(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              <T k="users.edit.resetBinding" />
              <span className="mt-0.5 block text-xs text-slate-500">
                <T k="users.edit.resetBinding.hint" />
              </span>
            </span>
          </label>
        )}

        <DialogFooter onClose={onClose} onSubmit={() => void submit()} busy={busy} />
      </div>
    </Dialog>
  );
}

/**
 * Password reset, separated from the edit form.
 *
 * A different permission (`reset`) and a different consequence: it ends every session
 * the person holds. Mixing it into the same dialog as the role dropdown invites it to
 * be changed by accident.
 */
function ResetPasswordDialog({
  account,
  onClose,
  onSaved,
}: {
  account: UserRow;
  onClose: () => void;
  onSaved: (message: string) => void;
}): ReactNode {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await usersApi.update(account.id, { password });
      onSaved(t('users.reset.done', { email: account.email }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('users.error.password'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={<T k="users.reset.title" />}
      titleText={t('users.reset.title')}
      description={
        <T
          k="users.reset.description"
          vars={{ email: account.email, name: account.staff?.fullName ?? '—' }}
        />
      }
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <Field
          label={<T k="users.reset.password" />}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
          hint={<T k="users.reset.password.hint" />}
          error={
            password.length > 0 && password.length < 12
              ? t('users.create.password.short', { count: 12 - password.length })
              : undefined
          }
        />

        <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <T k="users.reset.warning" />
        </p>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={password.length < 12}
          submitLabel={<T k="users.reset.submit" />}
        />
      </div>
    </Dialog>
  );
}

function CreateAppClientDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (secret: { clientId: string; secret: string; note: string }) => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<'android' | 'ios' | 'web'>('android');
  const [minVersion, setMinVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const outcome = await appClientsApi.create({
        name: name.trim(),
        platform,
        minVersion: minVersion.trim(),
      });
      onCreated({ clientId: outcome.clientId, secret: outcome.secret, note: outcome.note });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('users.apps.error.create'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={<T k="users.apps.create.title" />}
      titleText={t('users.apps.create.title')}
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <Field
          label={<T k="users.apps.create.name" />}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('users.apps.create.name.placeholder')}
          autoFocus
        />

        <div>
          <label htmlFor="platform" className="block text-sm font-medium text-slate-700">
            <T k="users.apps.create.platform" />
          </label>
          <select
            id="platform"
            value={platform}
            onChange={(event) => setPlatform(event.target.value as typeof platform)}
            className={SELECT}
          >
            <option value="android">Android</option>
            <option value="ios">iOS</option>
            <option value="web">Web</option>
          </select>
        </div>

        <Field
          label={<T k="users.apps.create.minVersion" />}
          value={minVersion}
          onChange={(event) => setMinVersion(event.target.value)}
          placeholder="1.0.0"
          hint={<T k="users.apps.create.minVersion.hint" />}
        />

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={name.trim().length === 0}
          submitLabel={<T k="users.apps.create.submit" />}
        />
      </div>
    </Dialog>
  );
}

/** Shows a freshly generated secret. The only moment it is visible. */
function SecretDialog({
  value,
  onClose,
}: {
  value: { clientId: string; secret: string; note: string };
  onClose: () => void;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  const { t } = useLabels();

  return (
    <Dialog
      title={<T k="users.apps.secret.title" />}
      titleText={t('users.apps.secret.title')}
      onClose={onClose}
    >
      <div className="space-y-3">
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {value.note}
        </p>

        <div>
          <p className="text-xs font-medium text-slate-600">
            <T k="users.apps.secret.clientId" />
          </p>
          <code className="mt-1 block overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-100">
            {value.clientId}
          </code>
        </div>

        <div>
          <p className="text-xs font-medium text-slate-600">
            <T k="users.apps.secret.secret" />
          </p>
          <code className="mt-1 block overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-100">
            {value.secret}
          </code>
        </div>

        <Button
          variant="ghost"
          onClick={() => {
            void navigator.clipboard.writeText(`${value.clientId}\n${value.secret}`).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          <Copy className="size-4" aria-hidden />
          <T k={copied ? 'users.apps.secret.copied' : 'users.apps.secret.copy'} />
        </Button>

        <DialogFooter onClose={onClose} closeLabel={<T k="users.apps.secret.close" />} />
      </div>
    </Dialog>
  );
}

function ConfirmDelete({
  title,
  titleText,
  body,
  onClose,
  onConfirm,
}: {
  /** A node so it can carry the label number badge. */
  title: ReactNode;
  /** The panel's ria-label cannot take a node, so the text arrives beside it. */
  titleText: string;
  body: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
}): ReactNode {
  return (
    <Dialog title={title} titleText={titleText} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-700">{body}</p>
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <Button variant="ghost" onClick={onClose}>
            <T k="dialog.cancel" />
          </Button>
          <Button onClick={onConfirm} className="bg-rose-600 hover:bg-rose-500">
            <T k="app.remove" />
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
